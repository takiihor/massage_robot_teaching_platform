"""Robot-safety behaviour tests (Sec 4, 6, 7, 9, 11, 27).

Every case runs against the fake RTDE transport — no physical robot, no ur-rtde.
"""

from __future__ import annotations

import threading
import time
import unittest

from robot.ur10e_middleware_local_mode import (
    UR10eMiddlewareLocalMode,
    MassageCommand,
)
from robot import protocol
from tests.python.fake_rtde import attach_fake_transport


def make_mw(profile="PHYSICAL_DEMO", sim=False, capabilities=None):
    mw = UR10eMiddlewareLocalMode(default_ip="127.0.0.1", telemetry_hz=1)
    mw.configure_runtime(
        profile=profile,
        simulation_enabled=sim,
        capabilities=capabilities or protocol.Capabilities.demo(),
    )
    return mw


class SimulationProfileContractTest(unittest.TestCase):
    def test_disconnected_no_simulation_is_not_a_successful_start(self):
        mw = make_mw(profile="PHYSICAL_DEMO", sim=False)
        mw.connected = False
        res = mw.start_massage(MassageCommand(mode="knead"))
        self.assertFalse(res.get("ok"))
        self.assertNotEqual(res.get("simulation"), True)

    def test_explicit_simulation_session_starts_without_robot(self):
        mw = make_mw(profile="SIMULATION", sim=True)
        mw.connected = False
        res = mw.start_massage(MassageCommand(mode="knead"))
        self.assertTrue(res.get("ok"))
        self.assertTrue(res.get("simulation"))

    def test_physical_ready_requires_preflight(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True, program_state="STOPPED")
        res = mw.start_massage(MassageCommand(mode="knead"))
        self.assertFalse(res.get("ok"))
        self.assertIn("host program", (res.get("error") or "").lower())

    def test_operating_state_disconnected_is_not_ready_not_sim(self):
        mw = make_mw(sim=False)
        mw.connected = False
        os = mw.get_operating_state()
        self.assertEqual(os["state"], "PHYSICAL_NOT_READY")
        self.assertFalse(os["motion_ready"])
        self.assertFalse(os["simulation_enabled"])

    def test_calibrated_profile_rejects_no_calibration(self):
        mw = make_mw(profile="PHYSICAL_CALIBRATED",
                     capabilities=protocol.Capabilities.calibrated())
        attach_fake_transport(mw, connected=True, cal_status=0)  # demo/no-cal
        res = mw.start_massage(MassageCommand(mode="knead"))
        self.assertFalse(res.get("ok"))
        self.assertEqual(res.get("error_code"), "calibration_not_ready")

    def test_calibrated_profile_accepts_valid_calibration(self):
        mw = make_mw(profile="PHYSICAL_CALIBRATED",
                     capabilities=protocol.Capabilities.calibrated())
        attach_fake_transport(mw, connected=True, cal_status=3)
        res = mw.start_massage(MassageCommand(mode="knead"))
        self.assertTrue(res.get("ok"))


class PreflightTest(unittest.TestCase):
    def test_safety_stop_blocks_motion(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True, safety_status="PROTECTIVE_STOP")
        self.assertFalse(mw.start_massage(MassageCommand(mode="knead")).get("ok"))
        self.assertFalse(mw.start_jog("z_up").get("ok"))

    def test_jog_and_resume_use_preflight(self):
        mw = make_mw(capabilities=protocol.Capabilities.calibrated())
        attach_fake_transport(mw, connected=True, program_state="STOPPED")
        self.assertFalse(mw.start_jog("z_up").get("ok"))
        self.assertFalse(mw.resume_massage().get("ok"))
        self.assertFalse(mw.move_to_calibration_point_a().get("ok"))


class CapabilityGatingTest(unittest.TestCase):
    def test_demo_capabilities_hide_calibration_and_jog(self):
        mw = make_mw(capabilities=protocol.Capabilities.demo())
        attach_fake_transport(mw, connected=True)
        jog = mw.start_jog("z_up")
        self.assertFalse(jog.get("ok"))
        self.assertEqual(jog.get("error_code"), "unsupported_capability")
        move = mw.move_to_calibration_point_a()
        self.assertEqual(move.get("error_code"), "unsupported_capability")

    def test_calibrated_capabilities_allow_calibration_moves(self):
        mw = make_mw(profile="PHYSICAL_CALIBRATED",
                     capabilities=protocol.Capabilities.calibrated())
        attach_fake_transport(mw, connected=True, cal_status=3)
        self.assertTrue(mw.move_to_calibration_point_a().get("ok"))


class StopTruthfulnessTest(unittest.TestCase):
    def test_stop_ok_only_when_ack_and_idle(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True, state=int(protocol.State.IDLE))
        res = mw.stop_massage()
        self.assertTrue(res.get("ok"))
        self.assertTrue(res.get("soft_stop_acknowledged"))
        self.assertTrue(res.get("verified_idle"))

    def test_stop_without_ack_is_uncertain_not_true(self):
        mw = make_mw()
        # Host never ACKs; report RUNNING so it is not idle either.
        io, rx = attach_fake_transport(
            mw, connected=True, ack_ok=False, state=int(protocol.State.RUNNING)
        )
        res = mw.stop_massage()
        self.assertFalse(res.get("ok"))
        self.assertEqual(res.get("error_code"), "stop_unverified")
        self.assertTrue(res.get("command_sent"))
        self.assertFalse(res.get("verified_idle"))
        # An unverified stop must latch motion-blocking uncertainty.
        self.assertTrue(mw.faulted)
        followup = mw.start_massage(MassageCommand(mode="knead"))
        self.assertFalse(followup.get("ok"))
        self.assertEqual(followup.get("error_code"), "robot_uncertain")

    def test_stop_available_while_preflight_would_fail(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True, program_state="STOPPED")
        # Motion is blocked...
        self.assertFalse(mw.start_massage(MassageCommand(mode="knead")).get("ok"))
        # ...but STOP must still dispatch (it does not require PLAYING).
        res = mw.stop_massage()
        self.assertTrue(res.get("command_sent"))


class CommandSerializationTest(unittest.TestCase):
    def test_second_motion_cannot_race_a_still_running_command(self):
        mw = make_mw(capabilities=protocol.Capabilities.calibrated())
        io, rx = attach_fake_transport(mw, connected=True)
        # Block the register write of the first command on the SEQ register.
        gate = threading.Event()
        io.block_reg = protocol.IN_CMD_SEQ
        io.block_event = gate

        released = threading.Event()

        def first():
            mw.start_massage(MassageCommand(mode="knead"))
            released.set()

        t = threading.Thread(target=first)
        t.start()
        # Give the worker time to enter the blocked write and take the slot.
        deadline = time.time() + 1.0
        while time.time() < deadline and not mw._motion_inflight:
            time.sleep(0.01)
        self.assertTrue(mw._motion_inflight, "first command should hold the motion slot")

        second = mw.start_massage(MassageCommand(mode="push_up"))
        self.assertFalse(second.get("ok"))
        self.assertEqual(second.get("error_code"), "robot_busy")

        gate.set()
        t.join(timeout=2.0)
        self.assertTrue(released.is_set())
        self.assertFalse(mw._motion_inflight)

    def test_faulted_state_blocks_motion_until_clear(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True)
        mw.mark_faulted("test")
        self.assertEqual(
            mw.start_massage(MassageCommand(mode="knead")).get("error_code"),
            "robot_uncertain",
        )
        mw.clear_fault()
        self.assertTrue(mw.start_massage(MassageCommand(mode="knead")).get("ok"))


class ReconnectResyncTest(unittest.TestCase):
    def test_clear_fault_on_successful_stop(self):
        mw = make_mw()
        attach_fake_transport(mw, connected=True, state=int(protocol.State.IDLE))
        mw.mark_faulted("prior-timeout")
        self.assertTrue(mw.faulted)
        mw.stop_massage()  # verified idle -> clears
        self.assertFalse(mw.faulted)


if __name__ == "__main__":
    unittest.main()
