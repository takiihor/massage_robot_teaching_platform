# Calibration data: location, versioning and migration

Calibration poses (point A / point B, TCP offsets, workcell-specific) are
**runtime data, not source code**. They are machine/workcell-specific, can be
large, must never leak in a shared ZIP, and must survive code updates. They are
therefore stored in a local, git-ignored state directory rather than the repo
tree.

## Where it lives now

- **Runtime path:** `runtime_state_dir()/calibration_data.json`
  - Default state dir: `<repo>/.massage_state/`
  - Override with the `MASSAGE_STATE_DIR` env var.
- `.massage_state/` and `robot/calibration_data.json` are both in `.gitignore`,
  so calibration never gets committed again.
- `robot/calibration_data.json` has been **removed from version control**
  (`git rm --cached`) as part of this change. Deleting the local copy after the
  migration has run is safe — the runtime copy is authoritative.

## Versioning + validation

Each record is written with `CALIBRATION_SCHEMA_VERSION` (currently `1`) and is
validated on load:

- A file whose `schema_version` does not match the running version is rejected
  and treated as "no calibration" (motion stays fail-closed) rather than
  silently trusted.
- Poses must be well-formed (six finite floats) before they can authorise a
  motion (`_valid_pose`).
- Writes are atomic: the record is written to a `.json.tmp` sibling and
  `replace()`d into place, so a crash mid-write cannot leave a half-written,
  unsafe calibration file.

## One-time migration

On first run the middleware calls `_migrate_legacy_calibration()`, which copies
the old tracked `robot/calibration_data.json` into the runtime path **without
deleting the original**. This is non-destructive; the legacy file is left in
place for manual inspection/removal.

## Capability / profile interaction

Calibration only gates motion on the `PHYSICAL_CALIBRATED` profile, whose
`ProfilePolicy.requires_calibration = True` (see
`docs/robot/rtde-protocol.md`). The checked-in demo host programs pin
`OUT_CAL_STATUS = 0`, so a demo profile is allowed to run without calibration;
a calibrated profile is not.

**MANUAL HARDWARE VALIDATION REQUIRED:** re-capture points A/B against the real
workcell after upgrading (the on-machine poses are unchanged by this refactor,
but confirm `cal_status` reporting and that a rejected/absent calibration blocks
motion as expected before running at production speed).
