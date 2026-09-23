# Full-Repository Engineering Audit

Branch: `audit/full-repo-remediation`
Starting commit: `dc9f0e0` (main)
Auditor: Qoder agent
Scope: complete runtime audit of the UR10e massage-robot teaching platform, with
priority on robot-command correctness, fail-closed behaviour and operator safety.

## Severity legend
- **P0** — robot safety / security / data-loss / incorrect physical behaviour
- **P1** — major reliability / correctness / architecture
- **P2** — maintainability / performance / UX
- **P3** — cleanup

---

## 0. Runtime architecture (as found)

Entrypoints:
- HTTP/WS server: `main.py` (FastAPI + Uvicorn), `if __name__ == "__main__"` block.
- Startup: `start.sh` → `python3 main.py`; build: `build.sh`; stop: `kill_all.sh`;
  export: `create_project_zip.sh`.
- Frontend page: `static/year65_v3_avatar_v3.html` → `static/main.module.js` →
  `static/module-bridge.js` → `static/app.js` + `static/src/**` ES modules.
- Robot transport: `robot/ur10e_middleware_local_mode.py` (RTDE receive + IO +
  Dashboard TCP), driven by a background telemetry thread.
- STT: `/ws/stt/stream`, `/api/stt/transcribe` (Azure Speech SDK) + browser
  Web Speech fallback in `static/src/voice/*`.

Physical robot command path (end-to-end):
`app.js sendRobotStart/sendRobotControl` → `RobotController.sendRobotCommand`
→ `POST /api/command` | `/massage/*` → `main.py _run_robot_op` →
`middleware.start_massage/stop_massage/...` → `send_mode()` → RTDE input
registers → URScript host program (`.urs`, PLAYING in PolyScope) → output
registers → `read_urscript_registers()` → ACK/state → back to UI.

Simulation path: currently **frontend-only** (see A4). `MASSAGE_SIMULATION_MODE`
env is read by the backend and surfaced on `/robot/state.simulation_enabled`
but is *not* consumed by any control decision.

STT path: `Recognition.js` → `stt-service.js` (Azure WS `pushAudio` 16k PCM with
native-rate→16k resampling, browser fallback).

---

## Audit ledger

### A1. `main.py`
- Responsibility: HTTP/WS app, robot route surface, STT, static serving, bootstrap.
- External effects: spawns executor threads, RTDE connect on startup, STT sockets.
- Findings:
  - **P0 (A4/A5/A6/A7):** thin surface; delegates to middleware; several issues below.
  - **P0 — port/host not single source of truth** (Sec 3,16): `__main__` hardcodes
    `run_options["host"]="0.0.0.0"` and `port=int(os.getenv("PORT",5000))`; `root()`
    uses `5000` fallback. `start.sh` default `5033`. CORS defaults `5000/5017`.
    Binds **all interfaces by default** → robot controls exposed to LAN. ACTION:
    validated `HOST`/`PORT` env, default bind `127.0.0.1`, default port `5033`.
  - **P0 — browser-supplied robot target** (Sec 5): `/robot/connect` accepts
    arbitrary `req.ip`. ACTION: strict allowlist / trusted config; engineer gate.
  - **P0 — `_run_robot_op` race** (Sec 6): `asyncio.Lock` + `wait_for` does not
    terminate the executor thread on timeout; a timed-out blocking RTDE call may
    still be running when the next op begins. ACTION: serialized command actor.
  - **P1 — inconsistent response semantics** (Sec 18): some ops return HTTP 200
    `{ok:false}`, others raise HTTPException. ACTION: unified error contract.
  - **P1 — health conflates liveness with robot state** (Sec 19): `/health`,
    `/api/health` report `robot_connected`. ACTION: separate liveness/readiness.
  - **P1 — `/api/client-log` unbounded** (Sec 30): rate/size unbounded, prod risk.
  - **P2 — dead/dup routes**: `change_action_tap`→`wave_push`,
    `change_action_massage`→`spiral_press`, `change_action_acupressure`→`knead`
    (mapping looks like placeholder bugs); `extend/shorten_duration` are no-ops
    that always return `ok:true`.
  - **P1 — STT WS hardening** (Sec 20): no max chunk size, idle timeout, client
    cap; `result_task` never explicitly cancelled/awaited.
- Test coverage before: none (no Python suite). ACTION: add `tests/python/*`.

### A2. `robot/ur10e_middleware_local_mode.py`
- Responsibility: RTDE register control, telemetry thread, calibration, dashboard.
- Findings:
  - **P0 — `stop_massage` untruthful** (Sec 7): sends CMD=0 `wait_ack=False`
    (always `ok:True`), sleeps 0.4 s, and returns that success result even when
    no ACK. `fallback_triggered` only hints. `_hard_stop_rtde_control` disabled
    by default (`UR10E_HARD_STOP_ENABLE=0`). ACTION: structured, verified result.
  - **P0 — no explicit profile** (Sec 9): `start_massage` accepts `cal_status==0`
    as demo; nothing distinguishes SIM / URSIM / PHYSICAL_DEMO / CALIBRATED.
  - **P0/P1 — preflight not unified** (Sec 11): only `start_massage` runs
    `_motion_preflight()`; `start_jog`, `move_to_calibration_point_a/b`,
    `move_to_safe_height`, `resume_massage`, `pause_massage` do not.
  - **P1 — blocking calls + shared `_seq`** (Sec 6): `send_mode` holds
    `_send_mode_lock`, reads/ACKs by polling; timeout at API layer can't cancel.
  - **P1 — config.json largely unused** (Sec 13): middleware hardcodes register
    constants; heartbeat/workspace/max_force/speed limits in config are not read.
  - **P1 — calibration in source tree** (Sec 14): real pose JSON committed.
  - ACK wait windows are short (2.0 s) vs URScript blocking-move latency (Sec 12).
- Action taken: see remediation commits.

### A3. `static/app.js` (robot sections)
- **P0 — silent simulation fallback** (Sec 4): `refreshRobotHealth()` sets
  `simulation = !connected`; on fetch failure sets `simulation=true`.
  `sendRobotStart()` returns `{ok:true, simulation:true}` when disconnected;
  `sendRobotControl()` returns `true` when disconnected. A physical
  failure/network error is reported as a successful simulation start.
  ACTION: consume backend-authoritative operating state; fail closed.
- **P1 — connect/disconnect UI unwired** (Sec 15): `robotConnectBtn`,
  `robotDisconnectBtn`, `robotIpInput` exist in HTML + `RobotController`
  but no active handler binds them.

### A4. `robot/config.json`
- **P0 — stale register map** (Sec 8): `rtde_registers.output` claims registers
  18–22 and bit registers 64–67; canonical `.urs` + middleware use output
  **12–17**, input **18–23**. Misleading.
- **P1 — dead safety settings** (Sec 13): `max_force_n`, `workspace_*`,
  `heartbeat_*`, `payload`, `jog_speed` not enforced anywhere.
- **P0 — implies heartbeat/watchdog exists** (Sec 10): it does not in the
  checked-in `.urs`; motion continues if host PC dies.

### A5. URScript host programs
- `ur10e_demo_smooth_27.urs`, `Run_mode4_only.urs`, `Run_mode4_Yaxis.urs`:
  - Use input 18–22, output 12–17, arm-on-STOP, ACK echo, over-force → all
    consistent with the middleware output map.
  - **Do not** implement calibration (10/11/12/13/14/20/21/22), jog (101/102)
    or heartbeat. They always write `OUT_CAL_STATUS=0`. Backend exposing
    cal/jog/calibration against these is a capability mismatch (Sec 8/9).
- ACTION: define canonical protocol + capability flags; gate commands on
  negotiated capabilities.

### A6. Shell scripts
- `start.sh` (P1): exports `HOST` (default `0.0.0.0`) that `main.py` ignores;
  port default 5033 inconsistent with `main.py` 5000. PID handling is safe.
- `create_project_zip.sh` (P0, Sec 17): only excludes venv/venv/node_modules;
  would package `.env`, keys, logs, pid, `calibration_data.json`, `.git`.
- `build.sh`, `kill_all.sh`: reviewed; `build.sh` prints 5033 (truthful after fix).

### A7. STT / voice frontend
- Resampling native→16k preserved (Sec 21). `ScriptProcessorNode` deprecated
  (P2, future). Browser provider labelled "offline" in `/api/stt/status`
  (Sec 21) — not guaranteed; wording must change.

### A8. Frontend state & modules (Sec 22–25) — noted, deferred
- Heavy `window.*` globals (`APP_STATE`, `currentMassageSession`,
  `nursingVitalsMonitorInstance`), oversized modules, long CSS chain. Large
  refactor; **deferred** behind protected behaviour (Phase J/K).

---

## Fix plan status (this engagement)
Implemented and covered by automated tests:
- A1 port/host single source of truth + safe default bind (127.0.0.1).
- A1/A5 trusted robot target validation (allowlist) + operator gate.
- A2 structured, verified STOP result; STOP stays available when faulted.
- A2/A1 serialized robot command actor (timeout cannot race next motion op).
- A2 unified motion preflight across jog/calibration-move/resume/pause.
- A2/A3 backend-authoritative operating mode + deployment profile; frontend
  fails closed instead of inventing simulation.
- A4/A5 canonical protocol definition + contract tests (Python ↔ .urs).
- A4 config validated at startup; stale/dead safety entries removed or honoured.
- A14 calibration → local runtime dir, gitignored, versioned schema, migration.
- A6 ZIP export secret exclusion + fixture test.
- A1 health endpoint split (liveness vs readiness vs robot).

Documented as remaining / manual (not silently ignored):
- Watchdog enforcement requires a robot-side host program change → **MANUAL
  HARDWARE VALIDATION REQUIRED** (CI must not drive the real robot).
- URScript blocking-move worst-case interrupt latency — documented.
- Frontend global-state reduction, module splits, CSS cleanup, AudioWorklet —
  deferred phases; no behaviour regressed.
