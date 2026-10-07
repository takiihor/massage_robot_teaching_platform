"""Exercise stop confirmation and reconnect failure with stubbed RTDE only."""
import sys
from types import SimpleNamespace
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, Mock, patch

from robot import ur10e_middleware_local_mode as middleware


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class RobotRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.robot = middleware.UR10eMiddlewareLocalMode(default_ip='test-robot')
        self.robot._ip = 'test-robot'
        self.robot._seq = 99  # Must not mistake another command's seq for STOP's.
        self.robot._hard_stop_rtde_control = Mock()
        self.robot._restore_speed_slider = Mock()
        self.clock = FakeClock()
        self.clock_patch = patch.multiple(middleware.time, monotonic=self.clock.monotonic,
                                         sleep=self.clock.sleep)
        self.clock_patch.start()
        self.addCleanup(self.clock_patch.stop)
        self.addCleanup(self.robot.disconnect)

    def registers(self, seq, state=0, error=0):
        return dict(ok=True, ack_seq=seq, state=state, error_code=error)

    def test_stop_requires_its_own_ack_and_idle_state(self):
        self.robot.send_mode = Mock(return_value=dict(ok=True, seq=7))
        self.robot.read_urscript_registers = Mock(return_value=self.registers(7))
        result = self.robot.stop_massage()
        self.assertTrue(result['ok'])
        self.assertEqual(result['seq'], 7)
        self.robot._hard_stop_rtde_control.assert_not_called()

    def test_wrong_ack_or_running_state_cannot_confirm_stop(self):
        for registers in (self.registers(99), self.registers(7, state=1)):
            with self.subTest(registers=registers):
                self.robot.send_mode = Mock(side_effect=[dict(ok=True, seq=7), dict(ok=True, seq=8)])
                self.robot.read_urscript_registers = Mock(return_value=registers)
                result = self.robot.stop_massage()
                self.assertFalse(result['ok'])
                self.assertEqual(result['seq'], 8)
                self.assertTrue(result['fallback_triggered'])
                self.robot._restore_speed_slider.assert_not_called()

    def test_fallback_stop_is_confirmed_before_success(self):
        self.robot.send_mode = Mock(side_effect=[dict(ok=True, seq=7), dict(ok=True, seq=8)])
        self.robot.read_urscript_registers = Mock(side_effect=lambda: self.registers(
            8 if self.robot.send_mode.call_count == 2 else 6))
        result = self.robot.stop_massage()
        self.assertTrue(result['ok'])
        self.assertEqual(result['seq'], 8)
        self.assertTrue(result['fallback_triggered'])
        self.robot._hard_stop_rtde_control.assert_called_once()

    def test_failed_write_does_not_become_success_or_trigger_more_writes(self):
        self.robot.send_mode = Mock(return_value=dict(ok=False, error='RTDE disconnected'))
        self.robot.read_urscript_registers = Mock()
        self.assertFalse(self.robot.stop_massage()['ok'])
        self.robot.send_mode.assert_called_once()
        self.robot.read_urscript_registers.assert_called_once()

    def test_failed_fallback_write_is_reported(self):
        self.robot.send_mode = Mock(side_effect=[dict(ok=True, seq=7),
                                                dict(ok=False, error='connection lost')])
        self.robot.read_urscript_registers = Mock(return_value=self.registers(6))
        result = self.robot.stop_massage()
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'connection lost')

    def test_rejected_stop_does_not_confirm_success(self):
        self.robot.send_mode = Mock(return_value=dict(ok=True, seq=7))
        self.robot.read_urscript_registers = Mock(return_value=self.registers(7, error=1))
        self.assertFalse(self.robot.stop_massage()['ok'])

    def test_returning_home_ack_does_not_trigger_hard_stop_fallback(self):
        self.robot.send_mode = Mock(return_value=dict(ok=True, seq=7))
        self.robot.read_urscript_registers = Mock(return_value=self.registers(7, state=3))
        result = self.robot.stop_massage()
        self.assertTrue(result['ok'])
        self.assertTrue(result['return_home_pending'])
        self.robot._hard_stop_rtde_control.assert_not_called()

    def test_home_pose_is_captured_once_and_uploaded_in_acknowledged_halves(self):
        home = [0.3, 0.1, 0.35, 3.14, 0.2, 0.1]
        self.robot.rtde_r = Mock()
        self.robot.rtde_r.getActualTCPPose.return_value = home
        self.robot._capture_home_pose()
        self.robot.rtde_r.getActualTCPPose.return_value = [0.0] * 6
        self.robot._capture_home_pose()
        self.assertEqual(self.robot._home_pose, home)
        self.robot.send_mode = Mock(side_effect=[
            dict(ok=True, urscript=dict(current_mode=7)),
            dict(ok=True, urscript=dict(current_mode=8))])
        self.assertTrue(self.robot._upload_home_pose()['ok'])
        calls = self.robot.send_mode.call_args_list
        self.assertEqual([call.args[0] for call in calls], [7, 8])
        self.assertEqual([call.kwargs['home_values'] for call in calls], [home[:3], home[3:]])

    def test_home_upload_rejects_an_old_host_that_acks_without_support(self):
        self.robot._home_pose = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.robot.send_mode = Mock(return_value=dict(ok=True, urscript=dict(current_mode=0)))
        self.assertFalse(self.robot._upload_home_pose()['ok'])
        self.robot.send_mode.assert_called_once()

    def test_start_cannot_interrupt_a_home_return(self):
        self.robot.rtde_io = Mock()
        self.robot.read_urscript_registers = Mock(return_value=self.registers(7, state=3))
        result = self.robot.send_mode(4)
        self.assertFalse(result['ok'])
        self.robot.rtde_io.setInputIntRegister.assert_not_called()

    def test_unreachable_reconnect_never_enters_native_rtde_connect(self):
        self.robot._create_rtde_receive = Mock()
        with patch.object(middleware.socket, 'create_connection', side_effect=OSError('unreachable')):
            self.robot._maybe_reconnect()
        self.robot._create_rtde_receive.assert_not_called()
        self.assertIn('reconnect probe failed', self.robot._last_error)

    def test_deliberate_disconnect_cannot_trigger_reconnect(self):
        self.robot._stop_evt.set()
        with patch.object(middleware.socket, 'create_connection') as probe:
            self.robot._maybe_reconnect()
        probe.assert_not_called()

    def test_disconnect_during_probe_cancels_reconnect(self):
        self.robot._create_rtde_receive = Mock()
        def probe(*args, **kwargs):
            self.robot._stop_evt.set()
            return MagicMock()
        with patch.object(middleware.socket, 'create_connection', side_effect=probe):
            self.robot._maybe_reconnect()
        self.robot._create_rtde_receive.assert_not_called()

    def test_successful_reconnect_resynchronizes_and_neutralizes_stale_motion(self):
        receive = Mock()
        receive.getActualTCPPose.return_value = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.robot._upload_home_pose = Mock(return_value=dict(ok=True))
        io = Mock()
        self.robot._create_rtde_receive = Mock(return_value=receive)
        self.robot._resync_sequence_from_robot = Mock()
        self.robot._neutralize_motion_on_connect = Mock(return_value=dict(ok=True))
        with patch.object(middleware.socket, 'create_connection'), patch.dict(sys.modules, {
                'rtde_receive': SimpleNamespace(RTDEReceiveInterface=Mock()),
                'rtde_io': SimpleNamespace(RTDEIOInterface=Mock(return_value=io))}):
            self.robot._maybe_reconnect()
        self.assertTrue(self.robot.connected)
        self.assertEqual(self.robot.neutralized_connection_id, self.robot.connection_id)
        self.robot._resync_sequence_from_robot.assert_called_once()
        self.robot._neutralize_motion_on_connect.assert_called_once()
        self.robot._restore_speed_slider.assert_not_called()

    def test_reconnect_without_stop_ack_cannot_claim_neutralized_connection(self):
        receive = Mock()
        receive.getActualTCPPose.return_value = [0.3, 0.1, 0.35, 3.14, 0, 0]
        self.robot._create_rtde_receive = Mock(return_value=receive)
        self.robot._resync_sequence_from_robot = Mock()
        self.robot._neutralize_motion_on_connect = Mock(return_value=dict(ok=False))
        self.robot._capture_home_pose = Mock()
        self.robot._upload_home_pose = Mock()
        with patch.object(middleware.socket, 'create_connection'), patch.dict(sys.modules, {
                'rtde_receive': SimpleNamespace(RTDEReceiveInterface=Mock()),
                'rtde_io': SimpleNamespace(RTDEIOInterface=Mock(return_value=Mock()))}):
            self.robot._maybe_reconnect()
        self.assertTrue(self.robot.connected, 'RTDE connectivity alone is not motion confirmation')
        self.assertIsNone(self.robot.neutralized_connection_id)
        self.robot._capture_home_pose.assert_not_called()
        self.robot._upload_home_pose.assert_not_called()


class StopPreemptionTest(unittest.TestCase):
    def test_stop_writes_while_start_waits_for_ack(self):
        robot = middleware.UR10eMiddlewareLocalMode(default_ip='test-robot')
        registers = {}
        waiting = threading.Event()
        robot.rtde_io = Mock()
        robot.rtde_io.setInputIntRegister.side_effect = registers.__setitem__
        robot._restore_speed_slider = Mock()

        def read():
            seq = registers.get(middleware.IN_CMD_SEQ, -1)
            if registers.get(middleware.IN_CMD) == 0:
                return dict(ok=True, ack_seq=seq, state=0, error_code=0)
            waiting.set()
            return dict(ok=True, ack_seq=-1, state=1, error_code=0)

        robot.read_urscript_registers = read
        with ThreadPoolExecutor(max_workers=2) as pool:
            starting = pool.submit(robot.send_mode, 4)
            self.assertTrue(waiting.wait(1), 'Start should be waiting for ACK')
            stopping = pool.submit(robot.stop_massage)
            self.assertTrue(stopping.result(timeout=0.5)['ok'])
            self.assertIn('cancelled', starting.result(timeout=0.5)['error'])
        self.assertEqual(registers[middleware.IN_CMD], 0)

    def test_stop_during_preflight_prevents_late_motion_write(self):
        robot = middleware.UR10eMiddlewareLocalMode(default_ip='test-robot')
        robot.rtde_io = Mock()
        robot._restore_speed_slider = Mock()
        robot._arm_host_program = Mock(return_value=dict(ok=True))
        robot.read_urscript_registers = Mock(return_value=dict(ok=True, cal_status=0))

        def preflight():
            # STOP completed while the earlier Start was still inspecting state.
            with robot._send_mode_lock:
                robot._stop_generation += 1
            return dict(ok=True)

        robot._motion_preflight = preflight
        result = robot.start_massage(middleware.MassageCommand(mode='knead'))
        self.assertFalse(result['ok'])
        self.assertIn('cancelled', result['error'])
        robot.rtde_io.setInputIntRegister.assert_not_called()


if __name__ == '__main__':
    unittest.main()
