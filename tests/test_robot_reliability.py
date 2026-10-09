"""Fault-injection coverage for robot middleware without network or hardware."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from robot import ur10e_middleware_local_mode as middleware
from test_robot_action_stop import ActionHarness


class RobotReliabilityTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.calibration = Path(self.directory.name) / 'calibration.json'
        self.file_patch = patch.object(middleware, 'CALIBRATION_FILE', self.calibration)
        self.file_patch.start()
        self.addCleanup(self.file_patch.stop)
        self.robot = middleware.UR10eMiddlewareLocalMode(default_ip='fake-robot')
        self.addCleanup(self.robot.disconnect)

    def configure_robot(self):
        self.robot.connected = True
        self.robot.rtde_io = Mock()
        self.robot._restore_speed_slider = Mock()
        self.robot._force_enable_supported = False
        self.robot.read_urscript_registers = Mock(return_value=dict(ok=True, state=0, error_code=0, ack_seq=0,
                                                                 diagnostics=dict(available=True)))

    def test_failed_payload_write_never_publishes_command_sequence(self):
        for register in (middleware.IN_SPEED_X100, middleware.IN_FORCE_X10,
                         middleware.IN_DURATION_S, middleware.IN_CMD, middleware.IN_CMD_SEQ):
            with self.subTest(register=register):
                self.configure_robot()
                self.robot.rtde_io.setInputIntRegister.side_effect = lambda r, v: r != register
                result = self.robot.send_mode(4, wait_ack=False)
                self.assertFalse(result['ok'])
                self.assertIn('write failed', result['error'])
                writes = [call.args[0] for call in self.robot.rtde_io.setInputIntRegister.call_args_list]
                if register != middleware.IN_CMD_SEQ:
                    self.assertNotIn(middleware.IN_CMD_SEQ, writes)

    def test_resume_requires_running_state_and_valid_safety_preflight(self):
        self.configure_robot()
        self.robot._motion_preflight = Mock(return_value=dict(ok=True))
        self.robot.send_mode = Mock(return_value=dict(ok=True, urscript=dict(state=0)))
        self.assertFalse(self.robot.resume_massage()['ok'])
        self.robot._motion_preflight.return_value = dict(ok=False, error='UNKNOWN safety')
        self.robot.send_mode.reset_mock()
        self.assertFalse(self.robot.resume_massage()['ok'])
        self.robot.send_mode.assert_not_called()

    def test_motion_preserves_operator_speed_slider_and_unsupported_speed_is_not_success(self):
        self.configure_robot()
        self.assertTrue(self.robot.send_mode(4, wait_ack=False)['ok'])
        self.robot._restore_speed_slider.assert_not_called()
        self.assertFalse(self.robot.adjust_speed(-0.1)['ok'])

    def test_arming_cannot_interrupt_home_but_stationary_stop_can(self):
        self.configure_robot()
        self.robot.read_urscript_registers.return_value = dict(ok=True, state=3, ack_seq=0, error_code=0)
        self.assertFalse(self.robot._arm_host_program()['ok'])
        self.robot.rtde_io.setInputIntRegister.assert_not_called()
        self.assertTrue(self.robot.send_mode(0, duration_s=-1, wait_ack=False)['ok'])
        self.assertIn(((middleware.IN_DURATION_S, -1), {}),
                      [(call.args, call.kwargs) for call in self.robot.rtde_io.setInputIntRegister.call_args_list])

    def test_force_checking_off_never_blocks_position_motion(self):
        self.assertFalse(middleware.FORCE_CHECK_ENABLED)
        source = (Path(__file__).resolve().parents[1] / 'robot/ur10e_demo_smooth_27.urs').read_text()
        self.assertIn('FORCE_GUARD_ENABLED = False', source)
        self.configure_robot()
        self.robot.dashboard = SimpleNamespace(program_state=lambda: 'PLAYING', safety_status=lambda: 'NORMAL')
        for force in ((float('nan'), 0, 0, 0, 0, 0), (18.5, 11.2, -18.2, 0, 0, 0), (0, 0, 40, 0, 0, 0)):
            with self.subTest(force=force):
                self.robot._latest['telemetry'] = middleware.Telemetry(
                    ts=time.time(), tcp_m=(0.4, 0, 0.3, 0, 0, 0), ft=force, speed_scaling=1)
                self.assertIsNone(middleware.UR10eMiddlewareLocalMode._measurement_error(self.robot._latest['telemetry']))
        # Position and freshness checks still apply.
        self.robot._latest['telemetry'] = middleware.Telemetry(
            ts=time.time(), tcp_m=(float('nan'), 0, 0.3, 0, 0, 0), ft=(0,) * 6, speed_scaling=1)
        self.assertEqual(middleware.UR10eMiddlewareLocalMode._measurement_error(self.robot._latest['telemetry'])['code'], 'INVALID_POSE')
        self.robot._latest['telemetry'] = middleware.Telemetry(
            ts=time.time() - 3, tcp_m=(0.4, 0, 0.3, 0, 0, 0), ft=(0,) * 6, speed_scaling=1)
        self.assertEqual(middleware.UR10eMiddlewareLocalMode._measurement_error(self.robot._latest['telemetry'])['code'], 'STALE_TELEMETRY')

    def test_force_assist_is_refused_while_force_checking_is_off(self):
        self.robot._motion_preflight = Mock(return_value=dict(ok=True))
        self.robot.read_urscript_registers = Mock(return_value=dict(ok=True, state=0, cal_status=0))
        self.robot._arm_host_program = Mock(return_value=dict(ok=True))
        self.robot.send_mode = Mock()
        result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=60, force_assist=True))
        self.assertFalse(result['ok'])
        self.robot.send_mode.assert_not_called()

    def test_unknown_safety_cannot_allow_motion(self):
        self.configure_robot()
        self.robot._latest['telemetry'] = middleware.Telemetry(
            ts=time.time(), tcp_m=(0.4, 0, 0.3, 0, 0, 0), ft=(0, 0, 0, 0, 0, 0), speed_scaling=1)
        self.robot.dashboard = SimpleNamespace(program_state=lambda: 'PLAYING', safety_status=lambda: 'UNKNOWN')
        self.assertFalse(self.robot._motion_preflight()['ok'])
        self.robot.dashboard.safety_status = lambda: 'Safetystatus: NORMAL'
        self.assertTrue(self.robot._motion_preflight()['ok'])

    @patch.object(middleware, 'FORCE_CHECK_ENABLED', True)
    def test_bad_or_stale_measurements_block_start_before_any_register_write(self):
        self.configure_robot()
        self.robot.dashboard = SimpleNamespace(program_state=lambda: 'PLAYING', safety_status=lambda: 'NORMAL')
        self.robot._arm_host_program = Mock()
        for force, pose, age in (
            ((float('nan'), 0, 0, 0, 0, 0), (0.4, 0, 0.3, 0, 0, 0), 0),
            ((0, 0, 0, 0, 0, float('inf')), (0.4, 0, 0.3, 0, 0, 0), 0),
            ((0, 0, 0, 0, 0, 0), (float('nan'), 0, 0.3, 0, 0, 0), 0),
            ((0, 0, 0, 0, 0, 0), (0.4, 0, 0.3, 0, 0, 0), 3),
        ):
            with self.subTest(force=force, pose=pose, age=age):
                self.robot._latest['telemetry'] = middleware.Telemetry(
                    ts=time.time()-age, tcp_m=pose, ft=force, speed_scaling=1)
                result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=1))
                self.assertFalse(result['ok'])
                self.robot._arm_host_program.assert_not_called()
                self.robot.rtde_io.setInputIntRegister.assert_not_called()
        self.robot._latest.pop('telemetry')
        self.assertFalse(self.robot._motion_preflight()['ok'])

    def test_arm_captures_home_only_after_stationary_stop_ack(self):
        self.configure_robot()
        calls = []
        self.robot.send_mode = Mock(side_effect=lambda *args, **kwargs:
            calls.append('stop') or dict(ok=True, seq=1, urscript=dict(state=0)))
        self.robot._capture_home_pose = Mock(side_effect=lambda **kwargs: calls.append('pose'))
        self.robot._upload_home_pose = Mock(side_effect=lambda *args: calls.append('upload') or dict(ok=True))
        self.assertTrue(self.robot._arm_host_program()['ok'])
        self.assertEqual(calls, ['stop', 'pose', 'upload'])

    def test_each_new_session_returns_to_its_start_pose_after_repositioning(self):
        self.configure_robot()
        self.robot._ip = 'fake-robot'
        self.robot.rtde_r = Mock()
        self.robot.rtde_r.getActualTCPPose.return_value = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.robot._capture_home_pose()
        self.robot._motion_preflight = Mock(return_value=dict(ok=True))
        self.robot.read_urscript_registers.return_value['cal_status'] = 0
        self.robot._wait_for_stop_ack = Mock(return_value=dict(ok=True, return_home_pending=True))
        h = ActionHarness()

        def controller_command(mode, **kwargs):
            if mode == middleware.CMD_HOME_XYZ:
                h.ns['home_xyz'] = kwargs['home_values'][:]
            elif mode == middleware.CMD_HOME_ROTATION:
                h.ns['home_pose'] = h.ns['home_xyz'] + kwargs['home_values']
            elif mode == 0:
                h.registers[h.ns['IN_DURATION_S']] = kwargs['duration_s']
                h.ns['request_stop']()
            return dict(ok=True, seq=1, urscript=dict(state=0, current_mode=mode))

        self.robot.send_mode = Mock(side_effect=controller_command)
        for pose in ([0.4, -0.1, 0.33, 3.14, 0, 0],
                     [0.42, -0.15, 0.36, 3.13, 0.02, 0]):
            with self.subTest(start_pose=pose):
                self.robot.send_mode.reset_mock()
                self.robot.rtde_r.getActualTCPPose.return_value = pose
                self.assertTrue(self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=60))['ok'])
                self.assertEqual([call.args[0] for call in self.robot.send_mode.call_args_list], [0, 7, 8, 4])
                self.assertEqual(h.ns['home_pose'], pose)
                # The RTDE pose now represents a displaced massage station.
                self.robot.rtde_r.getActualTCPPose.return_value = [0.44, -0.2, 0.34, 3.14, 0, 0]
                self.assertTrue(self.robot.stop_massage()['ok'])
                h.calls.clear()
                h.ns['return_home']()
                moves = [call[1][0] for call in h.calls if call[0] == 'move']
                self.assertEqual(moves[-1], pose)
                self.assertEqual(h.calls[-1], ('outputs', (0, 0, 100, 1, 0)))
                # Reconnecting during a session/return must not replace its target.
                self.robot._capture_home_pose()
                self.assertEqual(self.robot._home_pose, pose)

    def test_invalid_fresh_start_pose_cannot_upload_home_or_start_motion(self):
        self.configure_robot()
        self.robot._motion_preflight = Mock(return_value=dict(ok=True))
        self.robot.read_urscript_registers.return_value['cal_status'] = 0
        self.robot._home_pose = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.robot._home_ip = self.robot._ip
        self.robot.rtde_r = Mock()
        self.robot.send_mode = Mock(return_value=dict(ok=True, seq=1, urscript=dict(state=0)))
        for pose in ([float('nan'), 0, 0.3, 0, 0, 0], [0.4, 0, 0.3]):
            with self.subTest(pose=pose):
                self.robot.send_mode.reset_mock()
                self.robot.rtde_r.getActualTCPPose.return_value = pose
                result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=60))
                self.assertFalse(result['ok'])
                self.assertIn('return pose', result['error'])
                self.assertEqual([call.args[0] for call in self.robot.send_mode.call_args_list], [0])
                self.assertEqual(self.robot._home_pose, [0.3, 0.1, 0.35, 3.14, 0, 0])

    def test_arming_cannot_capture_or_upload_home_from_unconfirmed_stationary_state(self):
        self.configure_robot()
        self.robot._capture_home_pose = Mock()
        self.robot._upload_home_pose = Mock()
        for result in (dict(ok=False, error='timeout'), dict(ok=True, seq=1, urscript=dict(state=3))):
            self.robot.send_mode = Mock(return_value=result)
            self.assertFalse(self.robot._arm_host_program()['ok'])
        self.robot._capture_home_pose.assert_not_called()
        self.robot._upload_home_pose.assert_not_called()

    def test_invalid_mode_and_duration_fail_before_preflight_or_register_writes(self):
        self.robot._motion_preflight = Mock()
        for command in (middleware.MassageCommand(mode='101', duration=10),
                        middleware.MassageCommand(mode='stop', duration=10),
                        middleware.MassageCommand(mode='knead', duration=0),
                        middleware.MassageCommand(mode='knead', duration=-1),
                        middleware.MassageCommand(mode='knead', duration=1801)):
            self.assertFalse(self.robot.start_massage(command)['ok'])
        self.robot._motion_preflight.assert_not_called()

    def test_new_start_cannot_replace_an_existing_running_or_paused_session(self):
        self.configure_robot()
        self.robot._motion_preflight = Mock(return_value=dict(ok=True))
        self.robot._arm_host_program = Mock()
        for state in (1, 2):
            self.robot.read_urscript_registers.return_value = dict(ok=True, state=state, cal_status=0)
            self.assertFalse(self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=60))['ok'])
        self.robot._arm_host_program.assert_not_called()
        self.robot.rtde_io.setInputIntRegister.assert_not_called()

    def test_connection_reset_cancels_start_begun_on_previous_transport(self):
        self.configure_robot()
        self.robot.read_urscript_registers.return_value = dict(ok=True, cal_status=0, state=0)
        self.robot._arm_host_program = Mock(return_value=dict(ok=True))
        replacement = Mock()
        def reconnect():
            self.robot._reset_connections()
            self.robot.rtde_io = replacement
            self.robot.connected = True
            return dict(ok=True)
        self.robot._motion_preflight = reconnect
        result = self.robot.start_massage(middleware.MassageCommand(mode='knead', duration=60))
        self.assertFalse(result['ok'])
        self.assertIn('cancelled', result['error'])
        replacement.setInputIntRegister.assert_not_called()

    def test_rejected_calibration_save_clear_and_restore_preserve_local_data(self):
        pose = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.calibration.write_text(json.dumps(dict(point_a_pose=pose, point_b_pose=None)))
        original = self.calibration.read_bytes()
        self.robot._cal_point_a_pose = pose
        self.robot.get_dashboard_debug = Mock(return_value=dict(ok=True, programState='PLAYING'))
        self.robot.read_urscript_registers = Mock(return_value=dict(ok=True, cal_status=0))
        self.robot.send_mode = Mock(return_value=dict(ok=False, error='unknown command'))
        self.robot.set_calibration_pose = Mock(return_value=dict(ok=True))
        self.robot._latest_tcp_pose_m = Mock(return_value=tuple(pose))
        self.assertFalse(self.robot.save_calibration_point_a()['ok'])
        self.assertFalse(self.robot.clear_calibration()['ok'])
        self.assertFalse(self.robot.restore_calibration()['ok'])
        self.assertEqual(self.calibration.read_bytes(), original)
        self.assertEqual(self.robot._cal_point_a_pose, pose)

    def test_corrupt_calibration_files_are_ignored_without_crashing_startup(self):
        for data in ([], dict(point_a_pose=[1, 2, 3]),
                     dict(point_a_pose=[0, 0, 0, 0, 0, float('nan')]),
                     dict(point_a_pose=[0, 0, 0, 0, 0, 'bad'])):
            self.calibration.write_text(json.dumps(data))
            self.assertIsNone(self.robot._load_calibration_from_file())

    def test_calibration_pose_rejects_nonfinite_or_failed_registers(self):
        self.configure_robot()
        self.assertFalse(self.robot.set_calibration_pose(0, 0, 0, 0, 0, float('inf'))['ok'])
        self.robot.rtde_io.setInputDoubleRegister.assert_not_called()
        self.robot.rtde_io.setInputDoubleRegister.return_value = False
        self.assertFalse(self.robot.set_calibration_pose(0, 0, 0, 0, 0, 0)['ok'])
        self.robot.rtde_io.setInputDoubleRegister.assert_called_once()

    def test_home_pose_is_recaptured_for_a_different_robot(self):
        self.robot._ip = 'first-robot'
        first = [0.3, 0.1, 0.35, 3.14, 0, 0]
        second = [0.4, 0.2, 0.45, 0, 0, 0]
        self.robot.rtde_r = Mock()
        self.robot.rtde_r.getActualTCPPose.return_value = first
        self.robot._capture_home_pose()
        self.robot.rtde_r.getActualTCPPose.return_value = second
        self.robot._capture_home_pose()
        self.assertEqual(self.robot._home_pose, first)
        self.robot._ip = 'second-robot'
        self.robot._capture_home_pose()
        self.assertEqual(self.robot._home_pose, second)

    def test_heartbeat_failure_reports_disconnect(self):
        self.configure_robot()
        self.robot.rtde_io.setInputDoubleRegister.return_value = False
        self.robot._heartbeat_loop(threading.Event(), self.robot.rtde_io)
        self.assertFalse(self.robot.connected)
        self.assertIn('heartbeat failed', self.robot._last_error.lower())

    def test_heartbeat_never_writes_through_an_old_or_disconnected_interface(self):
        self.configure_robot()
        previous = Mock()
        self.robot._heartbeat_loop(threading.Event(), previous)
        previous.setInputDoubleRegister.assert_not_called()
        self.robot.rtde_io.isConnected.return_value = False
        self.robot._heartbeat_loop(threading.Event(), self.robot.rtde_io)
        self.robot.rtde_io.setInputDoubleRegister.assert_not_called()

    def test_cached_measurements_cannot_hide_transport_disconnect(self):
        self.configure_robot()
        self.robot.rtde_r = Mock()
        self.robot.rtde_r.isConnected.return_value = False
        self.robot._maybe_reconnect = lambda: self.robot._stop_evt.set()
        self.robot._telemetry_loop()
        self.assertFalse(self.robot.connected)
        self.assertFalse(self.robot.get_telemetry()['rtde_connected'])


if __name__ == '__main__':
    unittest.main()
