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

## Stop

```bash
./kill_all.sh
```

## Tests

```bash
npm test
npm run test:e2e
venv/bin/python -m unittest discover -s tests -p 'test_robot_reference_frame.py' -v
```

The robot reference-frame tests execute the script's motion logic with simulated
poses; they do not validate controller dynamics or physical robot movement.
