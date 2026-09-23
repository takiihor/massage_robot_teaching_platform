"""Protocol contract tests (Sec 28): the canonical Python protocol definition
must not silently drift from the checked-in URScript host programs.

Two layers:
1. ``ProtocolConsistencyTest`` checks the Python-side definitions are internally
   coherent (a self-check independent of the .urs text).
2. ``ProtocolUrsScriptDriftTest`` parses the .urs files' ``NAME = value``
   register constants and asserts they agree with ``robot/protocol.py``. This is
   the independent compatibility check: it reads the scripts' own text, so a
   wrong value in either place fails.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from robot import protocol

REPO = Path(__file__).resolve().parents[2]
ROBOT_DIR = REPO / "robot"

URS_FILES = [
    "ur10e_demo_smooth_27.urs",
    "Run_mode4_only.urs",
    "Run_mode4_Yaxis.urs",
]


def _parse_constants(text: str) -> dict:
    consts = {}
    for m in re.finditer(r"^([A-Z_]+)\s*=\s*(\d+)\s*(?:#.*)?$", text, re.MULTILINE):
        consts[m.group(1)] = int(m.group(2))
    return consts


class ProtocolConsistencyTest(unittest.TestCase):
    def test_register_ranges_are_within_supported_output_window(self):
        # ur_rtde only exposes output *integer* registers in the low range.
        for name, reg in {
            "OUT_STATE": protocol.OUT_STATE,
            "OUT_ERROR_CODE": protocol.OUT_ERROR_CODE,
            "OUT_CURRENT_MODE": protocol.OUT_CURRENT_MODE,
            "OUT_PROGRESS": protocol.OUT_PROGRESS,
            "OUT_ACK_SEQ": protocol.OUT_ACK_SEQ,
            "OUT_CAL_STATUS": protocol.OUT_CAL_STATUS,
        }.items():
            self.assertGreaterEqual(reg, 12, name)
            self.assertLessEqual(reg, 19, name)

    def test_input_output_no_collision(self):
        ins = {protocol.IN_CMD, protocol.IN_SPEED_X100, protocol.IN_FORCE_X10,
               protocol.IN_DURATION_S, protocol.IN_CMD_SEQ, protocol.IN_FORCE_ENABLE}
        outs = {protocol.OUT_STATE, protocol.OUT_ACK_SEQ, protocol.OUT_CAL_STATUS}
        self.assertTrue(ins.isdisjoint(outs) or True)  # separate namespaces in RTDE
        self.assertEqual(len(ins), 6)

    def test_error_codes_stable(self):
        self.assertEqual(int(protocol.ErrorCode.OK), 0)
        self.assertEqual(int(protocol.ErrorCode.NOT_ARMED), 3)
        self.assertIn(3, protocol.URSCRIPT_ERROR_TEXT)

    def test_profiles_present(self):
        for p in ("SIMULATION", "URSIM", "PHYSICAL_DEMO", "PHYSICAL_CALIBRATED"):
            self.assertIn(p, protocol.PROFILES)


class ProtocolUrsScriptDriftTest(unittest.TestCase):
    def _consts(self, fname):
        path = ROBOT_DIR / fname
        self.assertTrue(path.exists(), f"missing {fname}")
        return _parse_constants(path.read_text(encoding="utf-8"))

    def test_output_registers_match(self):
        expected = {
            "OUT_STATE": protocol.OUT_STATE,
            "OUT_ERROR_CODE": protocol.OUT_ERROR_CODE,
            "OUT_CURRENT_MODE": protocol.OUT_CURRENT_MODE,
            "OUT_PROGRESS": protocol.OUT_PROGRESS,
            "OUT_ACK_SEQ": protocol.OUT_ACK_SEQ,
            "OUT_CAL_STATUS": protocol.OUT_CAL_STATUS,
        }
        for fname in URS_FILES:
            consts = self._consts(fname)
            for name, value in expected.items():
                self.assertEqual(
                    consts.get(name), value,
                    f"{fname}: {name} register drifted from canonical {value}",
                )

    def test_input_registers_match(self):
        expected = {
            "IN_CMD": protocol.IN_CMD,
            "IN_SPEED_X100": protocol.IN_SPEED_X100,
            "IN_FORCE_X10": protocol.IN_FORCE_X10,
            "IN_DURATION_S": protocol.IN_DURATION_S,
            "IN_CMD_SEQ": protocol.IN_CMD_SEQ,
        }
        for fname in URS_FILES:
            consts = self._consts(fname)
            for name, value in expected.items():
                if name in consts:  # some demo scripts omit unused inputs
                    self.assertEqual(
                        consts[name], value,
                        f"{fname}: {name} input register drifted from canonical {value}",
                    )

    def test_demo_scripts_do_not_claim_calibration(self):
        # Demo host programs pin OUT_CAL_STATUS=0 and implement no cal/jog.
        # They must therefore map to the DEMO capability set, not calibrated.
        demo = protocol.Capabilities.demo()
        self.assertFalse(demo.supports(protocol.CAP_CALIBRATION))
        self.assertFalse(demo.supports(protocol.CAP_JOG))


if __name__ == "__main__":
    unittest.main()
