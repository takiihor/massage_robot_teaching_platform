# Reliability review — 7 October 2026

The review found and fixed failure paths in backend scheduling, RTDE writes and
recovery, controller interruption, browser session state, and speech startup.
Fault-injection regressions and CI now cover those paths. This is a tested software
candidate, not a guarantee against future failures or approval for physical contact
with a person. The controller program and installed robot/tool still require the
acceptance work below.

## Scope and operating assumptions

Reviewed `main.py`, the active browser runtime and robot transport, speech
providers, scenario contracts, `robot/ur10e_middleware_local_mode.py`, the bundled
`robot/ur10e_demo_smooth_27.urs`, dependencies, and setup/test scripts. The Python
middleware talks to an already loaded PolyScope host through RTDE; it does not
upload the repository's `.urs` file automatically. Commands 1–4 intentionally
execute the same mode-4 demonstration sequence.

All tests used stubbed RTDE, speech SDK callbacks, simulated poses, or an isolated
HTTP server with hardware auto-connect disabled. No robot commands were sent and
the existing running application was not restarted. Existing instructor keyboard
preview changes and their test were preserved.

## Highest-priority findings still open

| Priority | Finding and consequence | Evidence and required action |
| --- | --- | --- |
| P0 | Physical speed, force, workspace, and return paths remain unvalidated. A software pass cannot establish safe stopping distance, collision clearance, or RG2 pressure. | The script uses `V_SLOW=0.3` m/s, a 25 N force-vector guard, and fixed 10 N RG2 grip settings. `robot/config.json` is not loaded by this runtime and its different speed/force/workspace values do not constrain movement. Validate the installed TCP, payload, pendant safety settings, paths, grip release, and measured stopping behavior with the robot integrator. |
| P1 | Native RTDE work still runs in the HTTP process. A blocking native call can outlive Python deadlines; one that holds the GIL can stall HTTP and speech too. | `main.py::_run_blocking_robot_op` uses threads. TCP probes, cancellation generations, and a dedicated Stop executor reduce failures but cannot terminate native work. Move robot IO into a supervised process with bounded IPC for stronger availability isolation. The controller heartbeat is a separate physical interruption mechanism, not proof that HTTP remains responsive. |
| P1 | The control API has no authentication, authorization, or operator ownership. Multiple clients can issue control commands. | `main.py` robot routes have no identity check; the instructor PIN lives in browser code/storage. Loopback binding and Origin rejection reduce exposure but do not authenticate direct clients or prevent every browser/network attack. Add server-side authentication, operator/session ownership, and appropriate network/TLS controls before shared access. |
| P2 | Streaming speech has incomplete resource limits. Slow clients or hung SDK work can consume memory/threads. | `websocket_stt_stream` has an unbounded result queue, no per-client session quota, and no bounded SDK lifecycle wait. Bound queues and audio frames, limit session lifetime/concurrency, and close stalled clients while surfacing loss of voice control. |
| P2 | HTTP transcription accepts bytes without validating/decoding the audio container. General WAV/WebM uploads are not guaranteed to match the PCM input stream. | `_recognize_speech_from_bytes` writes uploaded bytes directly into `PushAudioInputStream`. The active browser path sends 16 kHz mono PCM over WebSocket. Specify and enforce an HTTP audio contract, or decode supported containers before exposing uploads as a general feature. |
| P2 | The shell launcher is not a supervised production service. PID reuse, forced termination, and log replacement can obscure or worsen failures. | `start.sh` trusts an existing PID and truncates `server.log`; `kill_all.sh` can escalate to SIGKILL after two seconds. Use process identity checks, service supervision, rotating logs, and a controller-aware shutdown procedure for unattended use. |

The compliant Z-axis limit passed to `force_mode` is a **speed limit**, not a travel
bound. The misleading 100 mm comment was corrected, but no equivalent software
displacement bound was added. This makes configured controller workspace limits
and trajectory validation essential. [Universal Robots force-mode documentation](https://www.universal-robots.com/manuals/EN/HTML/SW5_26/Content/prod-scriptmanual/all_scripts/force_mode_task_frame_selection_vector.htm)

## Failure paths fixed

| Area | Previous failure | Resulting behavior and regression coverage |
| --- | --- | --- |
| Backend operation ownership | An HTTP timeout released the operation mutex while its blocking worker continued; an expired queued request could execute later. | The worker retains the mutex until the actual call ends. Queued work rechecks abandonment and Stop generation before invocation. Tests delay workers and verify no concurrent or expired execution. |
| Stop availability and confirmation | Ordinary executor saturation delayed Stop; a timed-out Stop could permit new motion while still pending. | Stop has a dedicated executor and retains its pending gate through worker completion. Tests saturate ordinary capacity and delay Stop confirmation. Native/GIL limitations remain as described above. |
| Ambiguous Start/Resume/jog | An ACK or response failure could leave movement possible while the browser discarded the session. | Motion timeouts and failed published commands attempt Stop. Known preflight rejections report `motion_possible=false`; indeterminate browser failures remain Stop-retryable until confirmation. |
| RTDE command publication | Setter failures could be ignored, publishing a sequence after an incomplete payload. | False writes fail explicitly, payload precedes the sequence, and a possibly published command remains marked indeterminate. Tests inject failure at every integer payload register. |
| Dashboard preflight and Resume | UNKNOWN safety or an idle Resume acknowledgement could be treated as success. | Motion requires PLAYING and a known NORMAL/REDUCED safety state. Resume also requires a RUNNING ACK. Tests exercise unknown safety and idle ACKs. |
| Operator speed | Starting/connecting could restore the pendant slider to 100%. | Network commands preserve the operator's slider. Unsupported live speed and duration changes return errors rather than success. |
| Connection recovery | Cached measurements could hide a dead transport; old threads or requests could write through a replacement connection. | Native connection state is checked, telemetry is cleared on reset, connection events are never reused, and transport reset invalidates old motion generations. Reconnect never resumes a massage. |
| Home capture and shutdown | Home could be sampled while motion was active, reused for another robot, or transport closed before confirmed Stop. | First home capture follows an acknowledged stationary Stop; reconnect to the same IP preserves it, another IP recaptures it. Disconnect requests stationary Stop first and retains the connection if unconfirmed. |
| Calibration integrity | Rejected/unsupported calibration commands could report success, save stale poses, or overwrite/delete valid data. | Successful command ACK and valid host status are required. Poses come from fresh RTDE reads; numeric shapes are checked; files use atomic replacement. Rejections preserve local calibration. |
| Controller duration | Closing/suspending the browser could remove the only duration limit. | A controller clock counts active time using `get_steptime()` and interrupts blocked movement/gripping at expiry. Pause time is excluded. Normal expiry uses the existing return path. |
| Controller heartbeat | Losing the backend could leave the demonstration repeating indefinitely. | A separate double-register heartbeat is checked during movement, pause, and return. Three seconds without change cancels the worker, stops, releases, disarms, and avoids return travel. The backend writer runs independently of Dashboard polling. |
| Controller force fault | Only one signed force axis, or only force-assist mode, could be checked; faults could launch recovery travel. | All three force components contribute to the magnitude guard, including negative values; NaN fails closed. Checks run while arm/gripper workers block and during return. The fault latch prevents a later ordinary Stop from initiating recovery travel. |
| Command acknowledgement | ACK could precede state/error fields; progress updates could erase a rejection for the same sequence. | ACK is written last, middleware rejects mixed sequence snapshots, and command errors remain latched until a new sequence. Unsupported commands during blocking actions receive explicit errors. |
| Browser session control | Duplicate Pause/Resume or late replies could restore an ended session; controller faults could leave the UI running. | Pending controls are deduplicated. Late replies cannot revive a stopped session. Only fresh, connected controller idle state or an explicitly neutralized replacement connection completes the UI session without more travel. |
| Speech lifecycle | Stop during microphone permission, duplicate Start, or stale socket/browser callbacks could leak tracks or emit old commands. | Startup generations invalidate old work; late microphone tracks are released; callbacks are bound to their recognition instance. A stalled availability response is bounded, and backend result sender tasks are cancelled/awaited on cleanup. |
| API validation and browser exposure | Nonfinite input could turn a validation rejection into HTTP 500; backend binding ignored `HOST`; foreign browser origins could mutate the robot. | Invalid values produce serializable HTTP 422 errors. The default bind is `127.0.0.1`; `HOST` is honored. Robot mutations reject unapproved Origin headers. Embedded server config uses the browser origin and escapes HTML-sensitive JSON. |
| Test reproducibility and dependencies | Browser fixtures assumed simulation, expected an old label, or matched a module URL; Python dependencies were partially unpinned and included known vulnerabilities. | Fixtures use explicit isolated simulation and await initialization. Exact tested Python versions are locked, vulnerable framework packages are upgraded, and CI runs the full suites plus dependency audits. |

The controller clock uses the documented duration of a robot step. The simulated
tests check interruption decisions; they do not establish real scheduler timing
or physical deceleration. [Universal Robots `get_steptime` documentation](https://www.universal-robots.com/manuals/EN/HTML/SW5_21/Content/prod-scriptmanual/all_scripts/get_steptime.htm)

## Supported demo contract

- Commands 1–4 all use mode 4. UI intensity does not change the RG2 script constants;
  the active UI sends `force_assist=false`.
- Normal Stop interrupts massage and can return home. State 3 and
  `return_home_pending=true` mean that return motion has not finished. Start must
  wait for idle, and cannot replace a running or paused session.
- Disconnect, arming, force faults, and heartbeat faults use stationary release
  rather than the normal return path. Gripper release is requested nonblocking;
  an ACK does not prove that the gripper has physically opened.
- Live speed/duration changes are unsupported. Calibration and jog require a
  different host implementing those command IDs; the bundled host rejects them.
- RTDE connected, host PLAYING, command accepted, robot idle, and safe-to-contact
  are distinct facts. The UI/API must not collapse them into a single indicator.

## Validation

Validated on Linux, Python 3.12, Node 22.14, and headless Chromium. The patched
dependency set was installed and tested in a separate temporary virtual
environment; the workspace's existing `venv` and live process remain unchanged.

| Check | Result |
| --- | --- |
| Python API, scheduler, middleware, controller control-flow, and streaming tests | 76 passed |
| JavaScript unit tests | 99 passed |
| Scenario behavior / configuration checks | 41 / 134 passed |
| Complete Chromium browser suite with isolated server and patched runtime | 83 passed |
| `pip check`, Python compilation, Bash syntax, `git diff --check` | Passed |
| Locked Python dependency audit and npm audit | No known vulnerabilities reported at review time |

The original baseline passed 35 Python tests and 81 JavaScript tests, plus the
scenario checks. The first browser baseline passed 73 of 83 tests; ten scenario
fixture failures were corrected without enabling hardware. The full browser suite
then passed all 83 before the final dependency upgrade.

The original Python audit flagged four packages: FastAPI 0.104.1, Starlette 0.27.0,
AnyIO 3.7.1, and python-dotenv 1.0.0. The lock now uses FastAPI 0.142.2, Starlette
1.7.0, AnyIO 4.15.1, and python-dotenv 1.2.4. Starlette's multipart memory issue
was relevant to the upload endpoint because parsing occurs before its file-size
check. Advisory counts can contain duplicate records and do not imply every
advisory was exploitable in this Linux application.
[Starlette multipart advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-f96h-pmfr-66vw),
[form-limit advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-82w8-qh3p-5jfq),
[AnyIO TLS advisory](https://github.com/agronholm/anyio/security/advisories/GHSA-82r6-8w77-94w6).

The new GitHub workflow is present locally; a hosted CI run has not been performed.
Dependency audits reflect currently published advisories and
are not a claim that dependencies contain no undiscovered defects.

## PolyScope 5.24.0 runtime-error follow-up

The user reported `sqrt: cannot calculate square root of a negative number` on
PolyScope 5.24.0, without an error line number. The demo's only square-root call
was in the new force guard. A sum of squares of valid, stable force components
cannot be negative, so the message alone does not prove which calculation in the
full pendant/URCap-generated program failed. The earlier Python adapter tests
did not reproduce this controller exception.

The guard now has **no square-root call**. It rejects NaN and any component whose
absolute value already exceeds 25 N before multiplication, then compares the
squared force magnitude with 625 N². Products and sums are separate statements;
temporary variables are explicitly local to avoid binding to pendant/URCap
globals. Invalid arithmetic also takes the existing force-fault release/disarm
path. Valid negative force components remain supported and the threshold is
unchanged. The regressions cover mixed signs, combined-axis force, the exact
threshold, nonfinite/huge values, and rejection before potentially failing
arithmetic. [PolyScope 5.24 square-root documentation](https://www.universal-robots.com/manuals/EN/HTML/SW5_24/Content/prod-scriptmanual/all_scripts/sqrt_f.htm),
[variable scoping rules](https://www.universal-robots.com/manuals/EN/HTML/SW5_24/Content/prod-scriptmanual/all_scripts/ScopingRules.htm).

The accompanying local backend log acknowledged Start sequence 78 but showed no
ACK for Stop sequences 79–86; the last snapshot still showed ACK 78 and RUNNING.
This is consistent with the host command loop having stopped executing. The
backend later shut down; the browser's connection-refused errors and local socket
check confirmed that port 5000 was no longer serving HTTP. These logs do not
establish why the backend shut down. The force-enable register-23 warning is the
existing supported signed-register fallback, separate from the pendant error.

The scenario completion path now handles a rejected Stop promise rather than
leaving an unhandled rejection. Automatic duration-expiry Stop retries wait at
least five seconds between attempts and skip an in-flight Stop; manual Stop stays
immediate and an unconfirmed physical session remains available for retry.

The corrected script remains a local file pending reload and validation on the
user's controller. No PolyScope 5.24/URCap runtime test, hardware commands, or
automatic restart of the live backend was performed during this follow-up.

## Live read-only checks after the user's successful movement test

The user confirmed the area was clear and they were at the pendant. Live PC
checks reached the backend on port 5000 and the robot at 192.168.1.10. Dashboard
reported `PLAYING massage_robot.urp` and safety `NORMAL`; script feedback was
idle, error 0, and acknowledged sequence 111. These checks did not establish
which revision of the script was loaded in the pendant program.

Independent RTDE protocol-v2 output subscriptions confirmed the controller was
sending NaN for all three `actual_TCP_force` components and `tcp_force_scalar`.
Raw `ft_raw_wrench` was also invalid: sampled Fx was approximately -5.56e287,
Fy approximately -22715, and Fz NaN. Joint-current-derived wrench was finite.
Payload settings were finite (1.07 kg; CoG [0.002, 0.003, 0.057] m). The cause of
the controller-side force measurement failure remains unresolved; these results
do not prove a particular sensor, configuration, or firmware defect.

The user subsequently confirmed there was no force/torque warning and no external
force/torque sensor configured. A further live API sample still returned null
for Fx/Fy/Fz. Dashboard independently confirmed software 5.24.0.1219432 and the
loaded program `/programs/massage_robot.urp`. The checked-in RG2 example uses
the same finite payload settings observed on the controller and does not enable
an external force sensor; the currently loaded controller program was not
retrieved, so its full settings cannot be inferred from that example.

No input registers, motion commands, tool settings, or backend process were
changed during the live checks. The requested movement test was withheld because
force monitoring could not be trusted. The additional local backend change
blocks Start, Resume, and jog before command publication when cached telemetry
is absent, older than two seconds, or contains an invalid force/torque or TCP
pose. Stop remains available. This change requires a backend restart to take
effect. All 77 Python tests passed, including fault injection proving a rejected
Start makes no register writes. Controller force diagnostics and subsequent
controlled hardware validation remain required.

### Verification after controller reboot

After the user restarted the UR10e, both the live backend and an independent
RTDE output-only subscription returned finite TCP force/torque measurements.
Ten samples at 5 Hz showed TCP force magnitude approximately 2.05–3.20 N, with
no NaN or infinity in the sampled force fields. Dashboard reported the same
5.24.0.1219432 software, `PLAYING massage_robot.urp`, and safety `NORMAL`.
Script feedback remained idle, error 0, ACK 8; sequence reset is consistent
with the controller restart. Raw wrench was finite again, although large
offsets remained (approximately [1510, -7875, 31538] for its first three
components); no sensor calibration or accuracy conclusion was established.
No motion or input-register commands were sent. This verifies recovery of
finite readings over the observation window, not resolution of the root cause,
long-term reliability, or hardware validation of the updated script.

## Rollout and acceptance

1. Use a controlled maintenance window. Confirm the arm is idle, the gripper is
   released, and the pendant stop is available before stopping the old backend.
   Install the locked dependencies with `./build.sh --with-tests`, using Python
   3.12 and Node 22. Review `HOST`, simulation, and auto-connect configuration.
2. Reload the updated `.urs` into the pendant program with the actual RG2 URCap
   helpers. Restart the backend and reload the browser. A backend restart alone
   does not replace the pendant program. Compile/run first in the matching
   PolyScope/URSim environment.
3. On an unloaded robot with validated safety limits, verify Start, Pause, Resume,
   normal Stop, and stationary disconnect. Interrupt arm travel, blocked gripping,
   and home return. Measure actual interruption/release timing and stopping
   distance; inspect `state`, `ack_seq`, `error_code`, and `return_home_pending`.
4. Stop the backend or break its robot network link during movement, pause, and
   return. Verify heartbeat error 5, cancellation, release, disarming, and no
   recovery travel. Reconnect and verify no motion resumes automatically.
5. Verify selected duration expires with the browser closed/suspended, paused time
   is excluded, and a second client cannot replace the active Start. Verify the
   pendant slider remains reduced through connect, Start, Stop, and reconnect.
6. With the integrator's controlled force test setup, validate force error 2 across
   tool orientations, its release behavior, and the lack of return travel. Confirm
   workspace and contact/grip limits before any human-contact session.

These hardware and architecture items remain open even when every automated test
passes. Preserve the controller stop as the independent operator intervention;
speech recognition and HTTP are not emergency-stop channels.
