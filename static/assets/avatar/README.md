# Avatar Assets Directory

This directory contains full-body (half-body) PNGs for the Year65 nursing simulation. It is served from `/static/assets/avatar/`.

## Current Files
- `male_patient_base.png` (default avatar when not running)
- `face_pain_0_neutral.png`
- `face_pain_1_moderate.png`
- `face_pain_2_high.png`
- `face_anxiety_low.png`
- `face_anxiety_high.png`
- `overlay_sweat_light.png` (compatibility asset, unused)
- `overlay_sweat_heavy.png` (compatibility asset, unused)

## Rendering Behavior
- The UI swaps the `#y65AvatarBase` image source per expression.
- `uiMode !== RUNNING` uses `male_patient_base.png`.
- Face/sweat overlay layers are hidden; sweat is baked into the PNGs.

## Asset Specifications
- Format: PNG with transparent background
- Content: Half-body (head/neck/upper torso)
- Canvas size: Match `male_patient_base.png`
