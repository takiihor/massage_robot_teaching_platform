# Massage Robot Teaching Platform Stable

Stable ASR virtual patient teaching platform for massage robot simulation and UR10e-connected teaching sessions.

## UI Screenshot

![Massage Robot Teaching Platform UI](photos/UI_screenshot.png)

## Quick Setup After Clone/Pull

```bash
git clone <repo-url>
cd massage_robot_teaching_platform
./build.sh
```

`build.sh` prepares the local runtime:

- creates or updates `venv`
- installs Python dependencies from `requirements.txt`
- installs Node dependencies with `npm ci`
- installs Playwright Chromium for E2E tests
- creates `.env` from `.env.example` if `.env` is missing

For a faster setup without Playwright browser download:

```bash
./build.sh --skip-playwright
```

To install dependencies and run unit/scenario tests:

```bash
./build.sh --with-tests
```

## Local Configuration

Copy `.env.example` to `.env` and fill local API keys. Do not commit `.env`, certificates, logs, or runtime pid files.

Default port is `5033`. You can override it in `.env`:

```bash
PORT=5033
```

## Start

```bash
./start.sh
```

To run the server directly, activate the same environment used by `start.sh`:

```bash
source venv/bin/activate
python3 main.py
```

Both commands serve the same dashboard and voice setup runtime. Use the URL
printed at startup; `main.py` reads the configured `PORT` from `.env`.

Default local URL:

```text
http://127.0.0.1:5033/
```

## UR10e Robot Program

Load `robot/ur10e_demo_smooth_27.urs` into the pendant program with the RG2
URCap helpers available. After updating this file, reload it on the pendant;
restarting the backend does not update the robot's loaded script.
This is the repository's only `.urs` program. The backend requests actions via
RTDE registers and does not load script files from the repository automatically.

Mode 4 saves the starting TCP pose once per start command. Every station and
return lift uses that same TCP reference frame, and each completed batch returns
to the exact starting pose without endpoint blending. Physical lift is TCP -Z
for the downward-facing tool used by this demo. Confirm the selected TCP matches
the installed tool before positioning the starting pose.

The demo currently maps commands 1–4 to the mode-4 movement sequence.

For a connected demo, open the UI at `http://127.0.0.1:PORT/` on the server
computer (or use HTTPS on another computer), allow microphone access, and click
once if the browser requests it. Connect to the pendant IP in Settings, then
keep the host program PLAYING in PolyScope. RTDE connectivity alone does not
mean the host program is running.

Voice recognition uses the Cantonese command profile by default, which accepts
the Cantonese and English commands used by this demo. Settings' Voice Response
Language controls spoken response audio only; selecting English no longer
changes recognition to an English-only profile. The ASR indicator shows both
languages, and previously saved voice-language preferences do not change ASR.

During voice setup, mode, intensity, and duration selections give visual feedback
after an interim result settles for 200 ms. The current question stays in place
until final recognition commits the selection and plays the next spoken prompt.
Revised interim results update the preview without advancing setup. Duplicate
finals and corrections within a step do not replay its prompt.
Hiding and reopening the setup drawer, repeating the wake phrase, or restarting
recognition preserves completed steps; a new setup begins after cancellation.
Start and Resume still require final recognition, while Stop uses interim results.
Spoken Cancel (English) and 取消 (Chinese) close setup and restore its saved
settings on interim recognition, interrupt pending guidance, and play a
cancellation response in the selected response language. Delayed final cancel
results neither reopen setup nor repeat the response.

Current demo behavior:

- The UI's intensity selection does not change the RG2 gripping force: the demo
  uses its script constants and the UI sends `force_assist: false`.
- The UI timer sends Stop when the selected duration expires. Keep the demo tab
  open and active until Stop is confirmed; the mode-4 script repeats until it
  receives Stop/Pause and does not enforce the duration independently.
- An unconfirmed robot Stop leaves the UI session active for retry. Automatic
  reconnection sends Stop and resynchronizes command sequences; it does not
  resume massage automatically.
- Spoken Stop is handled on interim recognition, including "please stop". It
  interrupts pending Start requests and bypasses ordinary backend operations.
  The host script polls Stop/Pause every 20 ms while arm or gripper actions run,
  cancels their worker, stops the arm, and requests gripper release for Stop.
  Recognition, network transport, and physical deceleration still take time.
  After updating, restart the backend, reload the browser, and replace the
  pendant's script with `robot/ur10e_demo_smooth_27.urs` before pressing Play.

## Stop

```bash
./kill_all.sh
```

## Tests

```bash
npm test
npm run test:e2e
venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

The robot reference-frame tests execute the script's motion logic with simulated
poses; they do not validate controller dynamics or physical robot movement.
