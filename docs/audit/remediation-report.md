# Remediation Report & Definition of Done

Branch: `audit/full-repo-remediation` (not merged to `main`).
Starting commit: `dc9f0e0`.
See `docs/audit/full-repo-audit.md` for the per-script findings ledger, and
`docs/security/robot-control-boundary.md`, `docs/robot/rtde-protocol.md`,
`docs/robot/calibration-migration.md` for the maintained contracts.

## Guiding constraints honoured

- Real UR10e controls: robot-command correctness, fail-closed behaviour, state
  sync and operator safety were prioritised over UI/architecture polish.
- No automated test moves a physical robot: Python safety tests run against a
  fake RTDE transport (`tests/python/fake_rtde.py`); CI runs in simulation.
- No safety mechanism was weakened to make a test pass. A failing test was fixed
  at the source; one test assertion (`export-safety`) was made *stricter*, not
  looser (see below).
- No merge into `main`.

## P0 items closed

1. **Simulation / profile contract is backend-authoritative.**
   `robot/protocol.py` defines four explicit profiles with policies;
   `app/settings.py` resolves the profile from env, never from connectivity;
   the middleware returns `ok:true, simulation:true` only for a simulation
   profile. The frontend now decides from the polled
   `get_operating_state()` and **fails closed** when the robot is not
   `PHYSICAL_READY` — a network error no longer reports a successful start.
2. **Secure robot-control access boundary.** Default bind loopback;
   `ALLOW_LAN_BINDING` opt-in; `validate_robot_target` allowlist so a browser
   cannot dial an arbitrary controller; `require_operator` on every
   robot-changing route (fail-closed when `ROBOT_OPERATOR_TOKEN` unset and the
   client is non-loopback). CORS from validated settings.
3. **Serialized robot command executor.** A middleware motion slot is held for
   the *actual* duration of the blocking call (`_motion_cmd` releases in
   `finally`), so an asyncio `wait_for` timeout cannot let a second motion race
   a still-running RTDE call. A timed-out motion marks the controller `FAULTED`
   (via `_run_robot_op` → `mark_faulted`) and blocks further motion until
   reconnect; **STOP stays available** because it is not motion-guarded.
4. **Truthful, verifiable STOP.** `stop_massage` returns structured fields
   (`command_sent`, `soft_stop_acknowledged`, `fallback_*`, `host_state`,
   `robot_state`, `verified_idle`, `error_code`, `ok`). `ok` is true only when
   ACKed **and** idle-verified; otherwise it faults (`stop_unverified`) rather
   than claiming success.
5. **Canonical protocol + contract tests.** One definition in `protocol.py`;
   `test_protocol_contract.py` parses the checked-in `.urs` files and asserts
   they still agree, and capability flags gate calibration/jog that the demo
   programs do not implement.

## P1 items closed

- Unified motion preflight across jog / calibration moves / resume / pause.
- Health split: liveness (`/healthz`) vs. robot operating state surfaced on
  `/robot/state` and `get_operating_state()`.
- STT WebSocket hardening: concurrent-session cap, chunk-size limit, session
  byte/second ceilings, idle timeout, and `result_task` cancel+await on exit.
  The budget guards are now a pure, FastAPI-free module (`app/stt_limits.py`)
  covered by unit tests.
- `/api/stt/status` browser provider no longer mislabels itself `offline`
  (Web Speech is network-backed); the fallback chain is derived from real
  availability.
- `massage/extend_duration` and `massage/shorten_duration` no longer fabricate
  `ok:true`; they honestly return `not_supported` (no live-duration mechanism in
  local mode, no callers).
- Calibration moved to a gitignored, versioned, atomically-written runtime
  directory with a non-destructive one-time migration.
- ZIP export excludes secrets/runtime state; `start.sh` and `main.py` share a
  single port/host default (`127.0.0.1:5033`).

## Test suite (all green, no hardware)

- JS: `node --test` → 48 passing (includes `tests/export-safety.test.mjs`).
- Scenario: `verify-scenarios` 41/41 and `scenario-config` 134/134.
- Python: `unittest` → 37 passing (protocol contract, settings, STT limits,
  robot safety).
- `npm test` exit code 0. `python -m compileall` clean (3.8 target).
- `.github/workflows/ci.yml` runs all of the above in simulation on push/PR to
  `main`.

### Note on the export-safety test fix (rule: never weaken a test)

The one genuine failure was a **false positive in the test itself**: it used a
loose substring check (`listing.includes('proj/.env')`) that also matched the
*allowed* `proj/.env.example` entry. The archive was correct; the assertion was
imprecise. It was rewritten to match whole archive paths and to *additionally*
assert that the exact secret `proj/.env` is absent while `.env.example` is kept
— strictly stronger than before.

## Deferred (documented, not silently ignored)

- Watchdog / comm-loss enforcement needs a robot-side host-program change →
  **MANUAL HARDWARE VALIDATION REQUIRED** (procedure in `rtde-protocol.md`).
- URScript blocking-move worst-case interrupt latency — documented, hardware-
  dependent.
- Frontend global-state reduction, oversized-module splits, CSS chain cleanup,
  AudioWorklet migration — behaviour-preserving refactors behind the now-green
  suite; lower priority than the P0 robot/security work.
- Legacy `change_action_*` → mode aliases and `extend/shorten_duration`
  "next cycle" no-ops are intentional and left unchanged.

## Definition of Done

- [x] Full script-by-script audit completed and recorded before refactoring.
- [x] P0 simulation/profile contract: backend authoritative, fails closed.
- [x] P0 secure control access: loopback default, LAN opt-in, operator auth,
      trusted robot IP from allowlist.
- [x] P0 serialized command executor; timeout cannot race a running motion;
      FAULTED on timeout; STOP always available.
- [x] P0 truthful/verifiable STOP with structured result.
- [x] P0 single canonical protocol + `.urs` contract tests + capability gating.
- [x] Profiles distinguish physical / demo / simulation explicitly.
- [x] Calibration → local, gitignored, versioned, non-destructive migration.
- [x] ZIP export secret leak fixed + fixture test (stricter, not weaker).
- [x] Port/host single source of truth (loopback default).
- [x] STT WebSocket hardened (caps, idle timeout, task cleanup).
- [x] Health split; dead/misleading config removed.
- [x] Automated tests require no hardware and never move a real arm.
- [x] CI added, running the suite in simulation.
- [x] No merge into `main`; work isolated on `audit/full-repo-remediation`.
- [ ] Hardware-dependent safety verification — **MANUAL VALIDATION REQUIRED**
      (free-space test, comm-loss, interrupt latency) before physical use.
