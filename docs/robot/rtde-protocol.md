# UR10e local-mode RTDE protocol

The canonical definition of the register map, command/state/error IDs and
capability model lives in **`robot/protocol.py`** — that file is the single
source of truth. The middleware (`robot/ur10e_middleware_local_mode.py`),
`main.py` and the tests all import from it. Do not hardcode these numbers
anywhere else; `robot/config.json` is advisory only.

`tests/python/test_protocol_contract.py` parses the checked-in `.urs` host
programs and asserts their `NAME = value` constants still match `protocol.py`,
so backend↔RTDE↔URScript drift fails a test rather than reaching the arm.

## Runtime model (Local Mode)

PolyScope runs a URScript host program (state `PLAYING`). The backend:
- **writes** RTDE input registers (commands, speed, force, duration, seq, pose),
- **reads** RTDE output registers (state, error, mode, progress, ack, cal status),
- opens a Dashboard TCP connection (port 29999) for `programState` and
  `safetyStatus` used by motion preflight.

Protocol version: `PROTOCOL_VERSION = "1.0.0"` in `robot/protocol.py`.

## Register map

### Inputs (backend → URScript)

| Reg | Constant | Meaning |
| --- | --- | --- |
| 18 | `IN_CMD` | Command ID (see below) |
| 19 | `IN_SPEED_X100` | Speed ×100 (int) |
| 20 | `IN_FORCE_X10` | Force ×10 (int) |
| 21 | `IN_DURATION_S` | Duration seconds |
| 22 | `IN_CMD_SEQ` | Monotonic command sequence |
| 23 | `IN_FORCE_ENABLE` | Force assist enable |
| 24–29 | `IN_POSE_X`…`IN_POSE_RZ` | Calibration pose doubles |

### Outputs (URScript → backend)

Outputs use the **low integer range [12–17]**. Several `ur_rtde` builds only
expose output integer registers in this range; a stale map that claimed outputs
at [18–22] lived in `robot/config.json` and was wrong — it has been removed.

| Reg | Constant | Meaning |
| --- | --- | --- |
| 12 | `OUT_STATE` | 0 idle / 1 running / 2 paused (`State`) |
| 13 | `OUT_ERROR_CODE` | `ErrorCode` (see below) |
| 14 | `OUT_CURRENT_MODE` | Active mode ID |
| 15 | `OUT_PROGRESS` | Progress fraction |
| 16 | `OUT_ACK_SEQ` | Last acknowledged `IN_CMD_SEQ` |
| 17 | `OUT_CAL_STATUS` | Calibration status; demo programs pin this to 0 |

## Command IDs (`Cmd`)

| ID | Name | Class |
| --- | --- | --- |
| 0 | `STOP` | always-available control (NOT motion-guarded) |
| 1–4 | `MODE_PUSH_UP` / `MODE_WAVE_PUSH` / `MODE_SPIRAL_PRESS` / `MODE_KNEAD` | motion (massage) |
| 5 | `PAUSE` | control |
| 6 | `RESUME` | motion |
| 10–14 | `SAVE_POINT_A/B`, `MOVE_TO_A/B`, `MOVE_TO_SAFE` | calibration (motion) |
| 20–22 | `CLEAR_CALIBRATION`, `SET_POINT_A`, `SET_POINT_B` | calibration |
| 101/102 | `JOG_Z_UP` / `JOG_Z_DOWN` | jog (motion) |

`MOTION_CMD_IDS` is the set that must be serialized (one in flight at a time)
and must pass full physical preflight. `STOP` is intentionally excluded so it
can always be sent.

## Error codes (`ErrorCode`)

| ID | Name | Text |
| --- | --- | --- |
| 0 | `OK` | ok |
| 1 | `UNKNOWN_CMD` | unknown command |
| 2 | `OVERFORCE_STOP` | overforce stop |
| 3 | `NOT_ARMED` | host program is not armed |

## Capabilities

`Capabilities` declares what the *loaded* host program actually implements, so
the backend gates features rather than assuming a register match:

- `Capabilities.demo()` → `{massage}` only. Matches the checked-in demo programs
  (`Run_mode4_*`, `ur10e_demo_smooth_27`), which implement massage + arm/stop/
  ACK/overforce and always report `OUT_CAL_STATUS = 0`.
- `Capabilities.calibrated()` → `{massage, calibration, jog, force_assist}`.

`send_mode` refuses an unsupported mode with `unsupported_capability` instead of
writing a register the program ignores.

## Deployment profiles (`PROFILES` / `PROFILE_POLICIES`)

| Profile | physical | requires calibration | demo-no-cal allowed |
| --- | --- | --- | --- |
| `SIMULATION` | no | no | yes |
| `URSIM` | no | no | yes |
| `PHYSICAL_DEMO` | yes | no | yes |
| `PHYSICAL_CALIBRATED` | yes | **yes** | no |

A calibrated profile must not silently run with `cal_status == 0`. Choose the
profile with `MASSAGE_PROFILE`; if unset and `MASSAGE_SIMULATION_MODE` is on the
profile resolves to `SIMULATION`, otherwise `PHYSICAL_DEMO`. The profile is never
inferred from mere connectivity.

## Preflight, serialization and STOP truthfulness

- **Motion preflight** (`_motion_preflight`): connected, program state contains
  `PLAYING`, safety status safe, capability advertised, and calibration present
  when the profile requires it. Applied to every `MOTION_CMD_ID`.
- **Serialized executor**: the middleware holds a motion slot for the *actual*
  duration of the blocking RTDE call, so a `wait_for` timeout on the FastAPI
  side cannot let a second command race a still-running motion. A timed-out
  command marks the middleware `FAULTED` (`mark_faulted`) until reconciled;
  `STOP`/`PAUSE` stay available while faulted.
- **Structured STOP** returns `command_sent`, `soft_stop_acknowledged`,
  `fallback_required/available/attempted/result`, `host_state`, `robot_state`,
  `verified_idle`, `error_code`, `ok`. If idle cannot be verified it marks
  faulted (`stop_unverified`) rather than claiming success.

## Manual hardware validation required

The following cannot be verified without a real UR10e and are kept fail-closed
by design; do not relax them to make a demo pass:

- Exact `OUT_*` register visibility on the deployed `ur_rtde` build (low range
  assumption).
- Dashboard `programState`/`safetyStatus` string formats across PolyScope
  versions.
- ACK/`OUT_ACK_SEQ` timing vs. the motion-slot timeout.

**Procedure:** with the arm in free-space / guarded mode, run one command per
category, confirm `get_operating_state()` transitions and that a forced timeout
yields `FAULTED` while `STOP` still returns `verified_idle = true`. Record the
observed values; only then adjust constants in `robot/protocol.py`.
