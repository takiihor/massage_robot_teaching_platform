"""Execute URScript interruption helpers with a cooperative worker simulator.

This checks control flow, not UR controller scheduling or physical deceleration.
"""
import re
import math
import unittest

from test_robot_reference_frame import SCRIPT, python_block, pose_trans


class ActionHarness:
    def __init__(self, stalled=False, command=0, force_guard=True):
        source = SCRIPT.read_text()
        self.ns = {}
        self.calls = []
        self.elapsed = 0
        self.output_int = {}
        self.output_float = {}
        exec(source.split('# Blocking arm/gripper calls', 1)[0], self.ns)
        # Guard logic stays covered; the shipped default is checked separately.
        self.ns['FORCE_GUARD_ENABLED'] = force_guard
        initial = source.split('blocking_action_handle = 0', 1)[1].split('thread blocking_action_worker', 1)[0]
        exec(python_block('blocking_action_handle = 0' + initial), self.ns)
        self.ns.update(last_seq=1, active_mode=4, paused_mode=0, return_home_pending=False,
                       heartbeat_elapsed_s=0, session_elapsed_s=0, session_duration_s=300,
                       system_armed=True, safety_fault_latched=False, safety_fault_error=0, output_seq=-1, output_error=0,
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
            sqrt=math.sqrt, get_tcp_force=lambda: [0] * 6,
            write_output_integer_register=self.output_int.__setitem__,
            write_output_float_register=self.output_float.__setitem__, textmsg=lambda *args: None,
            set_outputs=lambda *args: self.calls.append(('outputs', args)))
        for name in ('blocking_action_worker', 'cancel_blocking_action', 'rg2_open_only', 'force_fault_reason', 'force_limit_exceeded',
                     'capture_safety_fault', 'publish_safety_fault', 'overforce_check_and_stop',
                     'request_stop', 'approach_from_above', 'return_home', 'check_session_safety', 'check_stop_or_pause', 'wait_for_blocking_action', 'movel_interruptible',
                     'grip_interruptible', 'rg2_close_open_interruptible', 'batch_return_interruptible'):
            block = re.search(r'^(?:def|thread) ' + name + r'\(.*?^end$', source,
                              re.MULTILINE | re.DOTALL).group()
            exec(python_block(block), self.ns)


class RobotActionStopTest(unittest.TestCase):
    def test_heartbeat_loss_cancels_stalled_action_and_releases_without_return_travel(self):
        h = ActionHarness(stalled=True)
        h.ns['sleep'] = lambda seconds: h.ns.update(heartbeat_elapsed_s=3.0)
        self.assertTrue(h.ns['movel_interruptible']([0] * 6, 0, 40))
        self.assertIn(('kill', 77), h.calls)
        self.assertFalse(h.ns['return_home_pending'])
        self.assertFalse(h.ns['system_armed'])
        self.assertEqual(h.calls[-1], ('outputs', (0, 0, 40, 1, 5)))
        self.assertFalse(any(call[0] == 'move' for call in h.calls))

    def test_duration_expires_during_stalled_grip_without_browser_stop(self):
        h = ActionHarness(stalled=True)
        h.registers[h.ns['IN_DURATION_S']] = 300
        h.ns['sleep'] = lambda seconds: h.ns.update(session_elapsed_s=300)
        self.assertTrue(h.ns['grip_interruptible'](20, 10, 99))
        self.assertIn(('kill', 77), h.calls)
        self.assertEqual(h.ns['active_mode'], 0)
        self.assertTrue(h.ns['return_home_pending'])

    def test_force_limit_covers_all_axes_and_signs_during_blocking_action(self):
        for axis in range(3):
            for sign in (-1, 1):
                with self.subTest(axis=axis, sign=sign):
                    h = ActionHarness(stalled=True)
                    force = [0] * 6
                    h.ns['get_tcp_force'] = lambda: force
                    h.ns['sleep'] = lambda seconds: force.__setitem__(axis, sign * 26)
                    self.assertTrue(h.ns['movel_interruptible']([0] * 6, 0, 30))
                    self.assertIn(('kill', 77), h.calls)
                    self.assertFalse(h.ns['return_home_pending'])
                    self.assertEqual(h.calls[-1][1][-1], 2)

    def test_fault_captures_trigger_before_release_and_publishes_after_stopping(self):
        h = ActionHarness(stalled=True)
        sample = [15.0, -20.1, 0.0, 0, 0, 0]
        h.ns.update(blocking_action_handle=77, blocking_action_kind=2,
                    blocking_action_width=20, session_elapsed_s=24.0,
                    get_tcp_force=lambda: sample[:])
        original_grip = h.ns['rg_grip']
        def release(*args, **kwargs):
            sample[:3] = [0, 0, 0]
            original_grip(*args, **kwargs)
        h.ns['rg_grip'] = release
        def write(reg, value):
            self.assertIn(('stop',), h.calls)
            h.output_float[reg] = value
        h.ns['write_output_float_register'] = write
        self.assertTrue(h.ns['overforce_check_and_stop']())
        self.assertEqual(h.output_int[h.ns['OUT_FAULT_REASON']], 1)
        self.assertEqual(h.output_int[h.ns['OUT_FAULT_ACTION']], 2)
        self.assertEqual([h.output_float[h.ns[key]] for key in ('OUT_FAULT_FX', 'OUT_FAULT_FY', 'OUT_FAULT_FZ')], [15, -20.1, 0])
        self.assertEqual(h.output_float[h.ns['OUT_FAULT_SESSION_S']], 24)
        saved = h.output_float.copy()
        h.registers[h.ns['IN_DURATION_S']] = -1
        h.ns['request_stop']()
        self.assertEqual(h.output_float, saved)
        self.assertEqual(h.output_int[h.ns['OUT_FAULT_REASON']], 1)

    def test_invalid_sample_has_separate_error_and_never_writes_nonfinite_registers(self):
        h = ActionHarness(stalled=True)
        h.ns['get_tcp_force'] = lambda: [float('nan'), float('inf'), -float('inf'), 0, 0, 0]
        self.assertTrue(h.ns['overforce_check_and_stop']())
        self.assertEqual(h.calls[-1][1][-1], 6)
        self.assertEqual(h.output_int[h.ns['OUT_FAULT_REASON']], 72)
        self.assertTrue(all(math.isfinite(value) for value in h.output_float.values()))
        self.assertEqual([h.output_float[h.ns[key]] for key in ('OUT_FAULT_FX', 'OUT_FAULT_FY', 'OUT_FAULT_FZ')], [0, 0, 0])

    def test_nonfinite_force_fails_closed_without_return_travel(self):
        for axis in range(3):
            for value in (float('nan'), float('inf'), float('-inf'), 1e308, -1e308):
                with self.subTest(axis=axis, value=value):
                    h = ActionHarness(stalled=True)
                    force = [0.0] * 6
                    h.ns['get_tcp_force'] = lambda: force
                    h.ns['sleep'] = lambda seconds: force.__setitem__(axis, value)
                    self.assertTrue(h.ns['movel_interruptible']([0] * 6, 0, 30))
                    self.assertIn(('kill', 77), h.calls)
                    self.assertIn(('stop',), h.calls)
                    self.assertTrue(any(call[0] == 'grip' and not call[2] for call in h.calls))
                    self.assertFalse(h.ns['return_home_pending'])
                    self.assertFalse(h.ns['system_armed'])
                    self.assertTrue(h.ns['safety_fault_latched'])
                    self.assertEqual(h.calls[-1][1][-1], 6)

    def test_force_guard_keeps_vector_limit_and_negative_readings_without_square_root(self):
        h = ActionHarness()
        def reject_sqrt(value):
            raise RuntimeError('Controller square-root domain error')
        h.ns['sqrt'] = reject_sqrt
        for force, exceeded in (([0, 0, 0], False), ([-3, 4, -5], False),
                                ([15, -20, 0], False), ([0, 0, -25], False),
                                ([15.0001, -20, 0], True), ([20, -20, 0], True),
                                ([-26, 0, 0], True)):
            with self.subTest(force=force):
                h.ns['get_tcp_force'] = lambda: force + [0, 0, 0]
                self.assertEqual(h.ns['overforce_check_and_stop'](), exceeded)

    def test_invalid_or_overlimit_force_is_rejected_before_multiplication(self):
        class UnsafeArithmetic(float):
            def __mul__(self, other):
                raise ArithmeticError('Controller cannot square this reading')
        h = ActionHarness()
        for axis in range(3):
            for value in (float('nan'), float('inf'), float('-inf'), 1e308, -1e308):
                with self.subTest(axis=axis, value=value):
                    force = [0.0] * 6
                    force[axis] = UnsafeArithmetic(value)
                    self.assertTrue(h.ns['force_limit_exceeded'](force))

    def test_heartbeat_loss_clears_paused_mode_and_interrupts_return(self):
        for paused, returning in ((4, False), (0, True)):
            h = ActionHarness()
            h.ns.update(active_mode=0, paused_mode=paused, return_home_pending=returning,
                        heartbeat_elapsed_s=3)
            self.assertEqual(h.ns['check_session_safety'](0), 3)
            self.assertEqual(h.ns['paused_mode'], 0)
            self.assertFalse(h.ns['return_home_pending'])

    def test_stop_after_a_safety_fault_never_requests_return_travel(self):
        h = ActionHarness()
        h.ns.update(heartbeat_elapsed_s=3)
        self.assertEqual(h.ns['check_session_safety'](0), 3)
        h.ns['request_stop']()
        self.assertFalse(h.ns['return_home_pending'])
        self.assertTrue(h.ns['safety_fault_latched'])
        h.registers[h.ns['IN_DURATION_S']] = -1
        h.ns['request_stop']()
        self.assertFalse(h.ns['return_home_pending'])
        self.assertFalse(h.ns['safety_fault_latched'])

    def test_connection_stop_preserves_every_safety_fault_until_explicit_acknowledgement(self):
        for error in (2, 5, 6):
            with self.subTest(error=error):
                h = ActionHarness()
                h.ns.update(safety_fault_latched=True, safety_fault_error=error)
                h.registers[h.ns['IN_DURATION_S']] = -2
                h.ns['request_stop']()
                self.assertFalse(h.ns['return_home_pending'])
                self.assertTrue(h.ns['safety_fault_latched'])
                self.assertFalse(h.ns['system_armed'])
                self.assertEqual(h.calls[-1], ('outputs', (0, 0, 0, 1, error)))
                self.assertFalse(any(call[0] == 'move' for call in h.calls))
                h.registers[h.ns['IN_DURATION_S']] = -1
                h.ns['request_stop']()
                self.assertFalse(h.ns['safety_fault_latched'])
                self.assertEqual(h.calls[-1], ('outputs', (0, 0, 0, 1, 0)))

    def test_controller_clock_counts_running_time_and_detects_heartbeat_changes(self):
        h = ActionHarness()
        heartbeat = [1.0]
        h.ns.update(get_steptime=lambda: .002, last_heartbeat=0,
                    read_input_float_register=lambda register: heartbeat[0])
        def one_tick():
            raise StopIteration()
        h.ns['sync'] = one_tick
        source = re.search(r'^thread session_clock\(.*?^end$', SCRIPT.read_text(), re.MULTILINE | re.DOTALL).group()
        exec(python_block(source), h.ns)
        def tick():
            with self.assertRaises(StopIteration):
                h.ns['session_clock']()
        tick()
        self.assertAlmostEqual(h.ns['session_elapsed_s'], .002)
        self.assertEqual(h.ns['heartbeat_elapsed_s'], 0)
        h.ns['active_mode'] = 0
        tick()
        self.assertAlmostEqual(h.ns['session_elapsed_s'], .002)
        self.assertAlmostEqual(h.ns['heartbeat_elapsed_s'], .002)
        heartbeat[0] = 2
        h.ns['active_mode'] = 4
        tick()
        self.assertAlmostEqual(h.ns['session_elapsed_s'], .004)
        self.assertEqual(h.ns['heartbeat_elapsed_s'], 0)

    def test_ack_is_published_after_state_and_error(self):
        h = ActionHarness()
        writes = []
        h.ns['write_output_integer_register'] = lambda reg, value: writes.append((reg, value))
        source = re.search(r'^def set_outputs\(.*?^end$', SCRIPT.read_text(), re.MULTILINE | re.DOTALL).group()
        exec(python_block(source), h.ns)
        h.ns['set_outputs'](0, 0, 0, 10, 3)
        self.assertEqual(writes[-1], (h.ns['OUT_ACK_SEQ'], 10))
        self.assertIn((h.ns['OUT_ERROR_CODE'], 3), writes[:-1])

    def test_unsupported_active_command_is_rejected_until_a_new_sequence(self):
        h = ActionHarness()
        writes = []
        h.ns['write_output_integer_register'] = lambda reg, value: writes.append((reg, value))
        source = re.search(r'^def set_outputs\(.*?^end$', SCRIPT.read_text(), re.MULTILINE | re.DOTALL).group()
        exec(python_block(source), h.ns)
        h.registers[h.ns['IN_CMD']] = 101
        h.registers[h.ns['IN_CMD_SEQ']] = 2
        self.assertEqual(h.ns['check_stop_or_pause'](30), 0)
        self.assertEqual(h.ns['active_mode'], 4)
        h.ns['set_outputs'](1, 4, 40, 2, 0)
        errors = [value for reg, value in writes if reg == h.ns['OUT_ERROR_CODE']]
        self.assertEqual(errors, [1, 1])
        h.ns['set_outputs'](0, 0, 0, 3, 0)
        self.assertEqual(h.ns['output_error'], 0)

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

    def test_resume_returns_to_start_pose_before_stations_continue(self):
        source = SCRIPT.read_text()
        block = source.split('    if active_mode == 4:\n', 1)[1].split('      while active_mode == 4:', 1)[0]
        for resumed in (False, True):
            with self.subTest(resumed=resumed):
                h = ActionHarness()
                start = [0.3, 0.1, 0.35, 3.141592653589793, 0, 0]
                paused_mid_lift = [0.3, 0.2, 0.38, 3.141592653589793, 0, 0]
                h.ns.update(session_start_pose=start, resume_from_pause=resumed,
                            start_pose=paused_mid_lift, get_actual_tcp_pose=lambda: paused_mid_lift)
                exec(python_block('if active_mode == 4:\n' + block + 'end'), h.ns)
                self.assertEqual(h.ns['start_pose'], start)
                self.assertEqual(h.ns['task_frame'], start)
                self.assertFalse(h.ns['resume_from_pause'])
                moves = [call[1][0] for call in h.calls if call[0] == 'move']
                if not resumed:
                    self.assertEqual(moves, [])
                    continue
                grips = [call for call in h.calls if call[0] == 'grip']
                self.assertEqual(grips[0][1][0], h.ns['RG2_OPEN_WIDTH'])
                self.assertLess(h.calls.index(grips[0]), next(i for i, c in enumerate(h.calls) if c[0] == 'move'))
                # Lift to clearance at the paused XY, travel above start, then lower onto start.
                self.assertEqual(len(moves), 3)
                self.assertAlmostEqual(moves[0][2], 0.40)
                self.assertAlmostEqual(moves[0][1], 0.2)
                self.assertAlmostEqual(moves[1][1], 0.1)
                self.assertAlmostEqual(moves[1][2], 0.40)
                self.assertEqual(moves[2], start)

    def test_shipped_position_only_script_has_force_checking_off(self):
        self.assertRegex(SCRIPT.read_text(), r'(?m)^FORCE_GUARD_ENABLED = False$')

    def test_force_readings_never_stop_motion_when_checking_is_off(self):
        for force in ([0, 0, 26], [18.5, 11.2, -18.2], [float('nan'), 0, 0], [float('inf'), 0, 0]):
            with self.subTest(force=force):
                h = ActionHarness(force_guard=False)
                h.ns['get_tcp_force'] = lambda: force + [0, 0, 0]
                self.assertFalse(h.ns['overforce_check_and_stop']())
                self.assertEqual(h.ns['check_session_safety'](30), 0)
                self.assertFalse(h.ns['movel_interruptible']([0] * 6, 0, 30))
                self.assertNotIn(('kill', 77), h.calls)
                self.assertFalse(h.ns['safety_fault_latched'])
                self.assertEqual(h.ns['active_mode'], 4)


if __name__ == '__main__':
    unittest.main()
