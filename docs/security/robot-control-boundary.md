# Robot control access boundary

This document records the security threat model and the controls that gate
access to anything that can move the physical UR10e. It is a P0 control:
misconfiguration must fail **closed**, never open the robot to unauthenticated
network control.

## Trust model

- **Loopback = trusted operator console.** The teaching UI is served from and
  driven on the same machine as the backend (`127.0.0.1` / `::1`). Requests
  arriving on loopback are treated as the on-site operator.
- **Anything else is untrusted network input.** A browser on the LAN is *not*
  an operator. It must not be able to move the robot, dial an arbitrary
  controller, or open a control channel unless an explicit, opt-in credential
  is presented.

## Controls (implemented)

### 1. Bind is loopback by default
`app/settings.py:load_settings()` resolves `HOST` and, unless
`ALLOW_LAN_BINDING=1`, forces a non-loopback bind back to `127.0.0.1`. An
invalid `HOST` also fails closed to loopback. `main.py` binds uvicorn to
`SETTINGS.host`/`SETTINGS.port` — there is no longer a hardcoded `0.0.0.0`/`5000`.

| Env var | Default | Effect |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; non-loopback refused without opt-in |
| `PORT` | `5033` | Single source of truth for port (see `start.sh`) |
| `ALLOW_LAN_BINDING` | `false` | Opt-in to bind LAN/all interfaces |

### 2. Robot controller IP comes from config, not the browser
`validate_robot_target()` only accepts an address that is in
`UR10E_ALLOWED_IPS` (plus `UR10E_IP` as the default target). A
browser-supplied IP that is malformed returns `robot_target_invalid`; a valid
but non-allowlisted IP returns `robot_target_not_allowed`. The backend therefore
cannot be coerced into dialing an attacker-chosen host.

| Env var | Default | Effect |
| --- | --- | --- |
| `UR10E_IP` | `127.0.0.1` | Trusted default controller address |
| `UR10E_ALLOWED_IPS` | (empty) | Comma-separated allowlist for explicit targets |

### 3. Operator token on robot-changing routes
`require_operator` (a FastAPI dependency) is applied to every route that can
change robot state: `/robot/connect`, `/robot/disconnect`, `/robot/jog/*`,
`/api/command`, `/api/stop`, `/massage/*`, `/calibration/*`.

- Loopback clients pass.
- Non-loopback clients must send `X-Robot-Operator: <token>` matching
  `ROBOT_OPERATOR_TOKEN`.
- **If no token is configured, non-loopback control is refused (403
  `operator_auth_required`).** LAN exposure can never silently become
  unauthenticated robot control.

| Env var | Default | Effect |
| --- | --- | --- |
| `ROBOT_OPERATOR_TOKEN` | (unset) | Shared secret required for non-local control |

### 4. CORS from validated settings
CORS origins are built from `SETTINGS.cors_allowed_origins`
(`CORS_ALLOWED_ORIGINS`, defaulting to the loopback origins for the active
port) rather than a wildcard, so a foreign page cannot drive the local console.

## Fail-closed safety posture (independent of auth)

Even for a trusted operator, the middleware refuses motion unless preflight
passes (connected, host program `PLAYING`, safe safety status, capability
advertised, calibration present when the profile requires it). See
`docs/robot/rtde-protocol.md`. `STOP` (cmd 0) is deliberately **always**
available — including when faulted — so an operator can never be locked out of
stopping the arm.

## Known limitations / manual review

- Loopback trust assumes a single-operator, on-machine console. If other
  processes/users share the host, loopback is not a strong boundary — set
  `ROBOT_OPERATOR_TOKEN` regardless and keep `ALLOW_LAN_BINDING` off.
- `request.client.host` is only authoritative when uvicorn is the direct
  peer. Do **not** put this behind a reverse proxy that forwards arbitrary
  clients as a loopback peer without re-establishing authentication.
  - **MANUAL HARDWARE VALIDATION REQUIRED:** confirm the deployed topology
    (direct uvicorn vs. proxied) and that no proxy rewrites client IP to
    loopback before relying on the loopback-trust rule in production.
