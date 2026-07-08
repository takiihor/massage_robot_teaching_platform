# Massage Robot Teaching Platform Stable

Stable ASR virtual patient teaching platform for massage robot simulation and UR10e-connected teaching sessions.

## Start

```bash
./start.sh
```

Default local URL:

```text
http://127.0.0.1:5033/
```

## Stop

```bash
./kill_all.sh
```

## Local Configuration

Copy `.env.example` to `.env` and fill local API keys. Do not commit `.env`, certificates, logs, or runtime pid files.

## Tests

```bash
npm test
npm run test:e2e
```
