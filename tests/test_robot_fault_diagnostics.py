"""Fault evidence and recovery checks with output-register stubs only."""
import json
import re
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from robot import ur10e_middleware_local_mode as middleware
from test_robot_action_stop import ActionHarness
from test_robot_reference_frame import SCRIPT


class RobotFaultDiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.robot = middleware.UR10eMiddlewareLocalMode(default_ip='test-robot')
        self.integers = {12: 0, 13: 2, 14: 0, 15: 0, 16: 12, 17: 0, 18: 1, 19: 2}
        self.floats = {12: 15.0, 13: -20.1, 14: 0.0, 15: 24.018,
                       16: .434, 17: .006, 18: .354, 19: middleware.DIAGNOSTICS_VERSION}
        self.robot.rtde_r = SimpleNamespace(getOutputIntRegister=self.integers.__getitem__,
                                           getOutputDoubleRegister=self.floats.__getitem__)
        self.robot.rtde_io = Mock()
        self.robot.connected = True
        self.robot.dashboard = SimpleNamespace(program_state=lambda: 'PLAYING', safety_status=lambda: 'NORMAL')
        self.telemetry = middleware.Telemetry(ts=time.time(), tcp_m=(.434, .006, .354, 0, 0, 0),
                                             ft=(0, 0, 1, 0, 0, 0))
        self.robot._latest = dict(telemetry=self.telemetry, rtde_connected=True)

    def test_register_map_and_force_limit_match_the_real_host(self):
        source = SCRIPT.read_text()
        for name in ('OUT_FAULT_REASON', 'OUT_FAULT_ACTION', 'OUT_DIAGNOSTICS_VERSION', 'DIAGNOSTICS_VERSION'):
            actual = int(re.search(r'^' + name + r' = (\d+)', source, re.MULTILINE)[1])
            self.assertEqual(actual, getattr(middleware, name))
        self.assertEqual(float(re.search(r'^FZ_HARD_LIMIT = ([\d.]+)', source, re.MULTILINE)[1]), middleware.FORCE_HARD_LIMIT_N)
        self.assertEqual([int(re.search(r'^' + name + r' = (\d+)', source, re.MULTILINE)[1])
                          for name in ('OUT_FAULT_FX', 'OUT_FAULT_FY', 'OUT_FAULT_FZ', 'OUT_FAULT_SESSION_S',
                                       'OUT_FAULT_TCP_X', 'OUT_FAULT_TCP_Y', 'OUT_FAULT_TCP_Z')], list(middleware.OUT_FAULT_FLOATS))

    def test_fault_force_remains_distinct_from_low_force_after_release(self):
        urs = self.robot.read_urscript_registers()
        fault = urs['diagnostics']['fault']
        self.assertEqual(fault['force_n'], [15, -20.1, 0])
        self.assertGreater(fault['force_magnitude_n'], 25)
        self.assertEqual(fault['action'], 'gripper closing')
        self.assertAlmostEqual(fault['session_elapsed_s'], 24.018)
        self.assertEqual(fault['tcp_xyz_m'], [.434, .006, .354])
        self.robot._latest['urscript'] = urs
        self.robot._record_safety_fault(self.telemetry, urs)
        snapshot = self.robot.get_state_snapshot()
        self.assertEqual(snapshot['actual_TCP_force'][:3], [0, 0, 1])
        self.assertEqual(snapshot['urscript_state']['diagnostics']['fault'], fault)
        self.assertTrue(snapshot['last_fault']['controller_captured'])
        json.dumps(snapshot, allow_nan=False)

    def test_invalid_component_mask_is_serialized_as_null(self):
        self.integers[13] = 6
        self.integers[18] = 52  # invalid Fx and Fz, reason 2
        self.floats[12] = self.floats[14] = 0
        self.floats[13] = 1.0
        urs = self.robot.read_urscript_registers()
        fault = urs['diagnostics']['fault']
        self.assertEqual(fault['reason'], 'invalid_force_sample')
        self.assertEqual(fault['force_n'], [None, 1, None])
        self.assertEqual(fault['invalid_components'], ['Fx', 'Fz'])
        self.assertIsNone(fault['force_magnitude_n'])
        json.dumps(urs, allow_nan=False)

    def test_incomplete_fault_publication_is_not_reported_as_a_captured_sample(self):
        reads = iter([1, 0])
        self.robot.rtde_r.getOutputIntRegister = lambda reg: next(reads) if reg == 18 else self.integers[reg]
        diagnostics = self.robot._read_fault_diagnostics()
        self.assertTrue(diagnostics['pending'])
        self.assertIsNone(diagnostics['fault'])

    def test_fault_is_logged_once_and_evidence_survives_acknowledgement(self):
        urs = self.robot.read_urscript_registers()
        with patch.object(middleware.logger, 'error') as log:
            for _ in range(5):
                self.robot._record_safety_fault(self.telemetry, urs)
            self.robot._record_safety_fault(self.telemetry, dict(ok=False))
            self.robot._record_safety_fault(self.telemetry, urs)
            log.assert_called_once()
        saved = self.robot._last_fault
        self.integers[13] = 0
        self.integers[16] = 13
        self.robot._record_safety_fault(self.telemetry, self.robot.read_urscript_registers())
        self.assertEqual(self.robot._last_fault, saved)

    def test_start_cannot_implicitly_clear_a_safety_fault(self):
        for error in middleware.SAFETY_FAULT_CODES:
            with self.subTest(error=error):
                self.integers[13] = error
                result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=300))
                self.assertFalse(result['ok'])
                self.assertEqual(result['code'], 'LATCHED_SAFETY_FAULT')
                self.robot.rtde_io.setInputIntRegister.assert_not_called()
        self.integers[13] = 0
        self.assertTrue(self.robot._motion_preflight()['ok'])

    def test_startup_neutralization_preserves_fault_and_keeps_legacy_stop_stationary(self):
        self.robot._wait_for_stop_ack = Mock(return_value=dict(ok=True, safety_fault_latched=True))
        self.assertTrue(self.robot._neutralize_motion_on_connect()['ok'])
        self.robot.rtde_io.setInputIntRegister.assert_any_call(middleware.IN_DURATION_S, -2)
        self.assertTrue(self.robot._wait_for_stop_ack.call_args.kwargs['allow_latched_fault'])
        self.floats[19] = 0
        self.robot.rtde_io.reset_mock()
        self.robot._neutralize_motion_on_connect()
        self.robot.rtde_io.setInputIntRegister.assert_any_call(middleware.IN_DURATION_S, -1)
        self.assertFalse(self.robot._wait_for_stop_ack.call_args.kwargs['allow_latched_fault'])

    def test_fault_between_start_preflight_and_arming_cannot_be_acknowledged_by_start(self):
        self.integers[13] = 0
        host = ActionHarness()
        self.robot._capture_home_pose = Mock()
        self.robot._upload_home_pose = Mock(return_value=dict(ok=True))

        def controller_command(mode, **kwargs):
            if mode != 0:
                return dict(ok=True, seq=99)
            # A real guard event occurs after the backend's healthy reads and
            # immediately before the controller processes the arming STOP.
            host.ns['get_tcp_force'] = lambda: [0, 0, 26, 0, 0, 0]
            host.ns['overforce_check_and_stop']()
            host.registers[host.ns['IN_DURATION_S']] = kwargs['duration_s']
            host.ns['request_stop']()
            error = host.calls[-1][1][-1]
            return dict(ok=error == 0, seq=99, urscript=dict(state=0, error_code=error))

        self.robot.send_mode = Mock(side_effect=controller_command)
        result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=300))
        self.assertFalse(result['ok'])
        self.assertTrue(host.ns['safety_fault_latched'])
        self.assertEqual(result['urscript']['error_code'], 2)
        self.assertEqual([call.args[0] for call in self.robot.send_mode.call_args_list], [0])
        self.robot._upload_home_pose.assert_not_called()

    def test_only_connection_ack_can_accept_an_idle_latched_fault_as_neutralized(self):
        for error in middleware.SAFETY_FAULT_CODES:
            with self.subTest(error=error):
                self.integers[13] = error
                self.assertFalse(self.robot._wait_for_stop_ack(12, 0)['ok'])
                result = self.robot._wait_for_stop_ack(12, 0, allow_latched_fault=True)
                self.assertTrue(result['ok'])
                self.assertTrue(result['safety_fault_latched'])
                self.integers[12] = middleware.STATE_RETURNING_HOME
                self.assertFalse(self.robot._wait_for_stop_ack(12, 0, allow_latched_fault=True)['ok'])
                self.integers[12] = 0

    @patch.object(middleware, 'FORCE_CHECK_ENABLED', True)
    def test_finite_overlimit_measurements_block_motion_without_publishing_a_command(self):
        self.integers[13] = 0
        for force in ((20, -20, 0), (0, 0, -26), (1e308, 1e308, 0)):
            with self.subTest(force=force):
                self.telemetry.ft = (*force, 0, 0, 0)
                result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=300))
                self.assertEqual(result['code'], 'FORCE_LIMIT_EXCEEDED')
                self.robot.rtde_io.setInputIntRegister.assert_not_called()
                json.dumps(result, allow_nan=False)
        self.telemetry.ft = (15, -20, 0, 0, 0, 0)
        self.assertTrue(self.robot._motion_preflight()['ok'])

    def test_old_host_cannot_start_but_stop_still_uses_stationary_release_after_fault(self):
        self.floats[19] = 0
        self.integers[13] = 0
        result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=300))
        self.assertEqual(result['code'], 'HOST_UPDATE_REQUIRED')
        self.robot.rtde_io.setInputIntRegister.assert_not_called()
        self.integers[13] = 6
        self.robot.send_mode = Mock(return_value=dict(ok=True, seq=13))
        self.robot._wait_for_stop_ack = Mock(return_value=dict(ok=True))
        self.assertTrue(self.robot.stop_massage()['ok'])
        self.assertEqual(self.robot.send_mode.call_args.kwargs['duration_s'], -1)


if __name__ == '__main__':
    unittest.main()
