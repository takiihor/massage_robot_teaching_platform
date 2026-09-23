# ASR Browser Reliability Design

## Problem

The committed Azure browser provider creates a 16 kHz `AudioContext` even when
the microphone stream uses 44.1 or 48 kHz. Firefox refuses to connect audio
nodes across those rates, so capture stops before any PCM reaches the backend.
When startup or the WebSocket later fails, the service can also hide the cause
or remain falsely active.

## Design

Capture audio with an `AudioContext` at the browser/device native rate. Resample
each captured mono buffer to 16 kHz, convert it to signed 16-bit PCM, and keep
the existing WebSocket protocol and Azure stream declaration unchanged.

Keep fallback selection in `STTService`, but make fallback return whether a
provider actually started. If none starts, reject `start()` with the original
provider failure so the UI can show an actionable message. Treat an unexpected
Azure WebSocket close as a provider error so the browser fallback is attempted;
an intentional stop must remain quiet.

## Verification

Add a Node test harness that evaluates the real browser script with fake Web
Audio and WebSocket boundaries. It will cover native-rate context creation,
16 kHz PCM output, failed-start rejection, unexpected-close fallback, and quiet
intentional shutdown. Keep the existing Chromium scenario tests and run the
full unit/scenario suite. Finally, inject known audio through Chromium and the
live Azure WebSocket to verify an actual final transcript.
