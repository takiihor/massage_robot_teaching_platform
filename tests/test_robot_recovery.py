"""Exercise stop confirmation and reconnect failure with stubbed RTDE only."""
import sys
from types import SimpleNamespace
import unittest
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
        self.robot.read_urscript_registers.assert_not_called()

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
        io = Mock()
        self.robot._create_rtde_receive = Mock(return_value=receive)
        self.robot._resync_sequence_from_robot = Mock()
        self.robot._neutralize_motion_on_connect = Mock()
        with patch.object(middleware.socket, 'create_connection'), patch.dict(sys.modules, {
                'rtde_receive': SimpleNamespace(RTDEReceiveInterface=Mock()),
                'rtde_io': SimpleNamespace(RTDEIOInterface=Mock(return_value=io))}):
            self.robot._maybe_reconnect()
        self.assertTrue(self.robot.connected)
        self.robot._resync_sequence_from_robot.assert_called_once()
        self.robot._neutralize_motion_on_connect.assert_called_once()
        self.robot._restore_speed_slider.assert_not_called()


if __name__ == '__main__':
    unittest.main()
