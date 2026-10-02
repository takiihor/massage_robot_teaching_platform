"""Execute URScript interruption helpers with a cooperative worker simulator.

This checks control flow, not UR controller scheduling or physical deceleration.
"""
import re
import unittest

from test_robot_reference_frame import SCRIPT, python_block, pose_trans


class ActionHarness:
    def __init__(self, stalled=False, command=0):
        source = SCRIPT.read_text()
        self.ns = {}
        self.calls = []
        self.elapsed = 0
        exec(source.split('# Blocking arm/gripper calls', 1)[0], self.ns)
        initial = source.split('blocking_action_handle = 0', 1)[1].split('thread blocking_action_worker', 1)[0]
        exec(python_block('blocking_action_handle = 0' + initial), self.ns)
        self.ns.update(last_seq=1, active_mode=4, paused_mode=0, return_home_pending=False,
                       home_pose=[0.3, 0.1, 0.35, 3.141592653589793, 0, 0])
        registers = {self.ns['IN_CMD']: 4, self.ns['IN_CMD_SEQ']: 1,
                     self.ns['IN_DURATION_S']: 0}
        self.registers = registers

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
            pose_trans=pose_trans, get_actual_tcp_pose=lambda: [0.3, 0.25, 0.35, 3.141592653589793, 0, 0],
            movel=lambda *args, **kwargs: self.calls.append(('move', args, kwargs)),
            set_outputs=lambda *args: self.calls.append(('outputs', args)))
        for name in ('blocking_action_worker', 'cancel_blocking_action', 'rg2_open_only',
                     'request_stop', 'return_home', 'check_stop_or_pause', 'wait_for_blocking_action', 'movel_interruptible',
                     'grip_interruptible', 'rg2_close_open_interruptible', 'batch_return_interruptible'):
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
                    self.assertEqual(outputs[0], 3 if command == 0 else 2)
                    self.assertEqual(outputs[3], 2)
                    if command == 0:
                        release = next(call for call in h.calls if call[0] == 'grip')
                        self.assertEqual(release[1][0], h.ns['RG2_OPEN_WIDTH'])
                        self.assertFalse(release[2], 'STOP must not wait for gripper travel')
                    else:
                        self.assertEqual(h.ns['paused_mode'], 4)

    def test_return_opens_fully_then_lifts_travels_and_reaches_saved_home(self):
        h = ActionHarness()
        h.ns['return_home_pending'] = True
        h.ns['return_home']()
        actions = [call for call in h.calls if call[0] in ('grip', 'move')]
        self.assertEqual([call[0] for call in actions], ['grip', 'move', 'move', 'move'])
        self.assertTrue(actions[0][2])
        self.assertEqual(actions[0][1][0], h.ns['RG2_OPEN_WIDTH'])
        self.assertAlmostEqual(actions[1][1][0][2], 0.40)
        self.assertAlmostEqual(actions[2][1][0][2], 0.40)
        self.assertEqual(actions[-1][1][0], h.ns['home_pose'])
        self.assertEqual(actions[-1][2]['r'], 0)
        self.assertFalse(h.ns['return_home_pending'])
        self.assertEqual(h.calls[-1], ('outputs', (0, 0, 100, 1, 0)))

    def test_stop_while_already_lifted_does_not_stack_another_lift(self):
        h = ActionHarness()
        h.ns['return_home_pending'] = True
        h.ns['get_actual_tcp_pose'] = lambda: [0.3, 0.25, 0.42, 3.141592653589793, 0, 0]
        h.ns['return_home']()
        moves = [call[1][0] for call in h.calls if call[0] == 'move']
        self.assertEqual(len(moves), 2)
        self.assertAlmostEqual(moves[0][2], 0.40)
        self.assertEqual(moves[-1], h.ns['home_pose'])

    def test_pause_interrupts_return_without_restarting_it(self):
        h = ActionHarness(stalled=True, command=5)
        h.ns['return_home_pending'] = True
        h.ns['active_mode'] = 0
        h.ns['return_home']()
        self.assertFalse(h.ns['return_home_pending'])
        self.assertFalse(any(call[0] == 'move' for call in h.calls))
        self.assertIn(('kill', 77), h.calls)

    def test_connection_stop_releases_without_returning_home(self):
        h = ActionHarness()
        h.registers[h.ns['IN_DURATION_S']] = -1
        h.ns['request_stop']()
        self.assertFalse(h.ns['return_home_pending'])
        self.assertEqual(h.calls[-1], ('outputs', (0, 0, 0, 1, 0)))

    def test_batch_return_keeps_blended_moves_in_one_worker_and_stops_at_start(self):
        h = ActionHarness()
        frame = h.ns['home_pose']
        self.assertFalse(h.ns['batch_return_interruptible'](frame, 0.2, 99))
        self.assertEqual([call[0] for call in h.calls],
                         ['run', 'move', 'move', 'move', 'join'])
        moves = [call for call in h.calls if call[0] == 'move']
        self.assertEqual([call[2]['r'] for call in moves],
                         [h.ns['R_BLEND'], h.ns['R_BLEND'], 0])
        self.assertEqual(moves[-1][1][0], frame)
        self.assertEqual(h.elapsed, 0)

    def test_stop_and_pause_cancel_the_batch_return_worker(self):
        for command in (0, 5):
            with self.subTest(command=command):
                h = ActionHarness(stalled=True, command=command)
                self.assertTrue(h.ns['batch_return_interruptible'](h.ns['home_pose'], 0.2, 99))
                self.assertIn(('run', 3), h.calls)
                self.assertLess(h.calls.index(('kill', 77)), h.calls.index(('stop',)))
                self.assertLessEqual(h.elapsed, 0.02)
                self.assertFalse(any(call[0] == 'move' for call in h.calls))

    def test_normal_close_open_finishes_each_gripper_action_before_the_next(self):
        h = ActionHarness()
        self.assertFalse(h.ns['rg2_close_open_interruptible'](50))
        self.assertEqual([call[0] for call in h.calls], ['run', 'grip', 'join', 'run', 'grip', 'join'])
        grips = [call for call in h.calls if call[0] == 'grip']
        self.assertEqual([call[1][0] for call in grips], [h.ns['RG2_CLOSE_WIDTH'], h.ns['RG2_OPEN_WIDTH']])
        self.assertTrue(all(call[2] for call in grips))


if __name__ == '__main__':
    unittest.main()
