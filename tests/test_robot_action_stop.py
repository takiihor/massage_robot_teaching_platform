"""Execute URScript interruption helpers with a cooperative worker simulator.

This checks control flow, not UR controller scheduling or physical deceleration.
"""
import re
import unittest

from test_robot_reference_frame import SCRIPT, python_block


class ActionHarness:
    def __init__(self, stalled=False, command=0):
        source = SCRIPT.read_text()
        self.ns = {}
        self.calls = []
        self.elapsed = 0
        exec(source.split('# Blocking arm/gripper calls', 1)[0], self.ns)
        initial = source.split('blocking_action_handle = 0', 1)[1].split('thread blocking_action_worker', 1)[0]
        exec(python_block('blocking_action_handle = 0' + initial), self.ns)
        self.ns.update(last_seq=1, active_mode=4, paused_mode=0)
        registers = {self.ns['IN_CMD']: 4, self.ns['IN_CMD_SEQ']: 1}

        def run(worker):
            self.calls.append(('run', self.ns['blocking_action_kind']))
            if not stalled:
                worker()
            return 77

        def sleep(seconds):
            self.elapsed += seconds
            registers[self.ns['IN_CMD']] = command
            registers[self.ns['IN_CMD_SEQ']] = 2

        self.ns.update(
            _run_thread=run,
            _kill_thread=lambda handle: self.calls.append(('kill', handle)),
            _join_thread=lambda handle: self.calls.append(('join', handle)),
            sleep=sleep, read_input_integer_register=registers.__getitem__,
            stop_motion=lambda: self.calls.append(('stop',)),
            end_force_safe=lambda: self.calls.append(('end_force',)),
            rg_grip=lambda *args, **kwargs: self.calls.append(('grip', args, kwargs['blocking'])),
            movel=lambda *args, **kwargs: self.calls.append(('move', args, kwargs)),
            set_outputs=lambda *args: self.calls.append(('outputs', args)))
        for name in ('blocking_action_worker', 'cancel_blocking_action', 'rg2_open_only',
                     'check_stop_or_pause', 'wait_for_blocking_action', 'movel_interruptible',
                     'grip_interruptible', 'rg2_close_open_interruptible'):
            block = re.search(r'^(?:def|thread) ' + name + r'\(.*?^end$', source,
                              re.MULTILINE | re.DOTALL).group()
            exec(python_block(block), self.ns)


class RobotActionStopTest(unittest.TestCase):
    def test_stop_and_pause_cancel_a_stalled_move_or_grip_without_waiting_for_completion(self):
        for action in ('move', 'grip'):
            for command in (0, 5):
                with self.subTest(action=action, command=command):
                    h = ActionHarness(stalled=True, command=command)
                    interrupted = (h.ns['movel_interruptible']([0] * 6, 0, 50) if action == 'move'
                                   else h.ns['rg2_close_open_interruptible'](50))
                    self.assertTrue(interrupted)
                    self.assertLessEqual(h.elapsed, 0.02)
                    self.assertEqual(h.ns['blocking_action_handle'], 0)
                    self.assertEqual(h.ns['active_mode'], 0)
                    self.assertLess(h.calls.index(('kill', 77)), h.calls.index(('stop',)))
                    self.assertEqual(len([call for call in h.calls if call[0] == 'run']), 1)
                    outputs = next(call[1] for call in h.calls if call[0] == 'outputs')
                    self.assertEqual(outputs[0], 0 if command == 0 else 2)
                    self.assertEqual(outputs[3], 2)
                    if command == 0:
                        release = next(call for call in h.calls if call[0] == 'grip')
                        self.assertEqual(release[1][0], h.ns['RG2_OPEN_WIDTH'])
                        self.assertFalse(release[2], 'STOP must not wait for gripper travel')
                    else:
                        self.assertEqual(h.ns['paused_mode'], 4)

    def test_normal_close_open_finishes_each_gripper_action_before_the_next(self):
        h = ActionHarness()
        self.assertFalse(h.ns['rg2_close_open_interruptible'](50))
        self.assertEqual([call[0] for call in h.calls], ['run', 'grip', 'join', 'run', 'grip', 'join'])
        grips = [call for call in h.calls if call[0] == 'grip']
        self.assertEqual([call[1][0] for call in grips], [h.ns['RG2_CLOSE_WIDTH'], h.ns['RG2_OPEN_WIDTH']])
        self.assertTrue(all(call[2] for call in grips))


if __name__ == '__main__':
    unittest.main()
