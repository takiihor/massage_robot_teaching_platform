"""Execute the real URScript motion helpers and mode-4 loop without hardware.

This adapter covers the Python-compatible URScript subset used by those blocks;
it models pose_trans and movel, not the robot controller or its motion dynamics.
"""
import math
from pathlib import Path
import re
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'robot/ur10e_demo_smooth_27.urs'


def python_block(source):
    """Convert explicit URScript end delimiters into Python indentation."""
    lines = []
    depth = 0
    for raw in source.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if line == 'end':
            depth -= 1
            if depth < 0:
                raise ValueError('Unbalanced URScript block')
            continue
        branch = line.startswith(('elif ', 'else:'))
        if branch:
            depth -= 1
        line = re.sub(r'\bp\[', '[', line)
        lines.append('    ' * depth + line)
        if line.endswith(':'):
            depth += 1
    if depth:
        raise ValueError('Unclosed URScript block')
    return '\n'.join(lines)


def pose_trans(frame, offset):
    """Apply a tool-frame translation using Rodrigues' rotation formula."""
    if offset[3:] != [0, 0, 0]:
        raise ValueError('This harness supports translation offsets only')
    angle = math.sqrt(sum(value * value for value in frame[3:]))
    vector = offset[:3]
    if angle:
        axis = [value / angle for value in frame[3:]]
        cross = [axis[1] * vector[2] - axis[2] * vector[1],
                 axis[2] * vector[0] - axis[0] * vector[2],
                 axis[0] * vector[1] - axis[1] * vector[0]]
        dot = sum(a * b for a, b in zip(axis, vector))
        vector = [vector[i] * math.cos(angle) + cross[i] * math.sin(angle)
                  + axis[i] * dot * (1 - math.cos(angle)) for i in range(3)]
    return [frame[i] + vector[i] for i in range(3)] + frame[3:]


class MotionHarness:
    def __init__(self, reference, batches=1, interrupt_after=None, pause=False,
                 force=False, overforce_after=None):
        self.reference = reference[:]
        self.actual = reference[:]
        self.moves = []
        self.completed = 0
        self.force_active = False
        self.force_frames = []
        self.grip_positions = []
        self.interrupted = False
        self.source = SCRIPT.read_text()
        self.ns = {}
        exec(self.source.split('def set_outputs', 1)[0], self.ns)

        def move(target, a, v, r):
            if len(self.moves) >= batches * 50:
                raise AssertionError('Motion did not return to the saved pose within the expected batches')
            self.moves.append((target[:], r, self.force_active))
            self.actual = target[:]
            if r:
                # A blended waypoint need not be physically reached.
                self.actual[0] += 0.001
                self.actual[2] -= 0.002

        def check(prog):
            if interrupt_after is not None and len(self.moves) >= interrupt_after:
                self.interrupted = True
                self.force_active = False
                self.ns['active_mode'] = 0
                return 2 if pause else 1
            return 0

        def sync():
            if all(abs(a - b) < 1e-10 for a, b in zip(self.actual, self.reference)):
                self.completed += 1
                if self.completed >= batches:
                    self.ns['active_mode'] = 0

        def end_force():
            self.force_active = False

        def apply_force(frame, target):
            self.force_active = True
            self.force_frames.append(frame[:])
            # Disturb live TCP without changing the saved trajectory reference.
            self.actual[2] -= 0.003

        def grip(prog):
            if check(prog):
                return True
            self.grip_positions.append(self.actual[:])
            return False

        def overforce():
            return overforce_after is not None and len(self.moves) >= overforce_after

        self.ns.update(
            get_actual_tcp_pose=lambda: self.actual[:], pose_trans=pose_trans,
            movel=move, check_stop_or_pause=check, sync=sync,
            end_force_safe=end_force, apply_force_mode_z=apply_force,
            rg2_cycles_interruptible=grip, overforce_check_and_stop=overforce,
            read_input_integer_register=lambda register: -50 if force else 0,
            set_outputs=lambda *args: None, textmsg=lambda *args: None,
            to_str=str, floor=math.floor, active_mode=4, last_seq=1,
            last_force_x10=0, start_pose=reference[:], task_frame=reference[:])

        for name in ('move_to_pose_interruptible', 'move_in_frame_interruptible'):
            helper = re.search(r'^def ' + name + r'\(.*?^end$', self.source,
                               re.MULTILINE | re.DOTALL).group()
            exec(python_block(helper), self.ns)

    def run(self):
        # Execute the actual complete batch loop, including interruption and
        # force-mode branches, rather than a separately copied trajectory.
        block = self.source.split('      while active_mode == 4:\n', 1)[1]
        block = block.split('    else:\n      duration = ', 1)[0]
        exec(python_block('while active_mode == 4:\n' + block), self.ns)


class RobotReferenceFrameTest(unittest.TestCase):
    def assert_pose_equal(self, actual, expected):
        for a, b in zip(actual, expected):
            self.assertAlmostEqual(a, b, places=10)

    def test_return_reaches_original_pose_for_rotated_tools_and_repeated_batches(self):
        orientations = [
            [0, 0, 0], [math.pi, 0, 0], [0, math.pi / 2, 0],
            [-2.1934150721, 2.2112495907, -0.07268867925],
            [0.4, -0.8, 1.2]]
        for rotation in orientations:
            with self.subTest(rotation=rotation):
                reference = [0.293, 0.143, 0.335] + rotation
                robot = MotionHarness(reference, batches=20)
                robot.run()
                self.assertEqual(robot.completed, 20)
                for batch in range(20):
                    moves = robot.moves[batch * 22:(batch + 1) * 22]
                    self.assertEqual(len(moves), 22)
                    # Each station ends at an absolute offset of the SAME frame.
                    for station in range(4):
                        expected = pose_trans(reference, [0, (station + 1) * .05, 0, 0, 0, 0])
                        self.assert_pose_equal(moves[station * 3 + 2][0], expected)
                    lifted_start = pose_trans(reference, [0, 0, -.05, 0, 0, 0])
                    self.assert_pose_equal(moves[-2][0], lifted_start)
                    self.assert_pose_equal(moves[-1][0], reference)
                    self.assertEqual(moves[-1][1], 0)
                self.assert_pose_equal(robot.actual, reference)

    def test_inverted_tool_lifts_above_contact_and_returns_at_same_height(self):
        reference = [0.3, 0.1, 0.35, math.pi, 0, 0]
        robot = MotionHarness(reference)
        robot.run()
        for index in [0, 1, 3, 4, 6, 7, 9, 10, 12, 20]:
            self.assertAlmostEqual(robot.moves[index][0][2], 0.40)
        self.assertAlmostEqual(robot.moves[-1][0][2], 0.35)
        for grip_pose in robot.grip_positions:
            self.assertAlmostEqual(grip_pose[2], 0.35)

    def test_force_deviation_does_not_shift_reference_and_return_ends_force_mode(self):
        reference = [0.3, 0.1, 0.35, math.pi, 0, 0]
        robot = MotionHarness(reference, batches=3, force=True)
        robot.run()
        self.assertEqual(robot.completed, 3)
        self.assertEqual(len(robot.force_frames), 12)
        for frame in robot.force_frames:
            self.assert_pose_equal(frame, reference)
        for batch in range(3):
            for _, _, force_active in robot.moves[batch * 22 + 12:(batch + 1) * 22]:
                self.assertFalse(force_active)
        self.assert_pose_equal(robot.actual, reference)

    def test_stop_and_pause_abort_forward_or_return_without_recovery_movement(self):
        for pause in (False, True):
            for after in (0, 2, 12, 13, 17, 21):
                with self.subTest(pause=pause, after=after):
                    robot = MotionHarness([0.3, 0.1, 0.35, math.pi, 0, 0],
                                          interrupt_after=after, pause=pause)
                    robot.run()
                    self.assertTrue(robot.interrupted)
                    self.assertEqual(len(robot.moves), after)
                    self.assertEqual(robot.completed, 0)

    def test_overforce_aborts_without_return_motion(self):
        robot = MotionHarness([0.3, 0.1, 0.35, math.pi, 0, 0],
                              overforce_after=3)
        robot.run()
        self.assertEqual(len(robot.moves), 3)
        self.assertEqual(robot.completed, 0)
        self.assertEqual(robot.ns['active_mode'], 0)


if __name__ == '__main__':
    unittest.main()
