# ASR Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Azure streaming ASR work with native-rate Firefox microphones and reliably surface or recover from provider failures.

**Architecture:** Keep the existing `STTService` provider abstraction and WebSocket protocol. Capture at the device rate, resample to Azure's required 16 kHz PCM at the browser boundary, and make provider termination propagate through the existing fallback mechanism.

**Tech Stack:** Browser Web Audio API, WebSocket, Azure Speech SDK, Node test runner, Playwright.

---

### Task 1: Browser audio capture regression

**Files:**
- Create: `tests/stt-service.test.mjs`
- Modify: `static/stt-service.js:123-245`

1. Write a test harness with fake `AudioContext`, microphone stream, and WebSocket implementations.
2. Assert that the provider constructs a native-rate context without a requested rate.
3. Feed a 44.1 kHz buffer through `onaudioprocess` and assert the transmitted PCM is approximately 16 kHz mono PCM16.
4. Run `node --test tests/stt-service.test.mjs` and verify the committed forced-rate implementation fails.
5. Keep the minimal native-rate capture and resampling implementation, then verify the tests pass.

### Task 2: Actionable startup failure

**Files:**
- Modify: `tests/stt-service.test.mjs`
- Modify: `static/stt-service.js:678-779`

1. Add a test asserting `STTService.start()` rejects with the primary provider's error when no fallback can start.
2. Run the test and verify it fails because `start()` currently resolves.
3. Make `_switchToFallback()` return success or failure and preserve the last error.
4. Make `start()` throw the preserved error after exhausted fallback.
5. Run the focused test and verify it passes.

### Task 3: Unexpected WebSocket closure

**Files:**
- Modify: `tests/stt-service.test.mjs`
- Modify: `static/stt-service.js:138-178`

1. Add tests showing unexpected closure requests fallback and intentional stop does not.
2. Run them and verify the unexpected-close test fails.
3. Emit one provider error from an unexpected close while suppressing expected shutdown.
4. Run the focused tests and verify they pass.

### Task 4: Full verification

**Files:**
- Test: `tests/stt-service.test.mjs`
- Test: `tests/scenario-flow.spec.js`

1. Run `npm test`.
2. Run the targeted Chromium ASR scenario tests against the local server.
3. Run a live Chromium fake-microphone transcription and confirm a final Azure result.
4. Inspect `git diff --check` and the final diff, preserving unrelated user changes.
