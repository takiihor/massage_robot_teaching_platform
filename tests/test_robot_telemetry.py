"""Telemetry serialization regression tests; no robot connection is opened."""
import ast
import asyncio
import json
from pathlib import Path
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from robot.ur10e_middleware_local_mode import Telemetry, UR10eMiddlewareLocalMode


class RobotTelemetryTest(unittest.TestCase):
    def setUp(self):
        self.robot = UR10eMiddlewareLocalMode(default_ip='test-robot')
        self.robot.connected = True
        self.telemetry = Telemetry(
            ts=time.time(), tcp_m=(0.44, -0.09, 0.35, 0.0, 3.14, 0.0),
            ft=(1.0, 2.0, 3.0, 0.1, 0.2, 0.3), speed_scaling=1.0)
        self.robot._latest = dict(telemetry=self.telemetry, rtde_connected=True,
                                  urscript=dict(ok=True, state=0, ack_seq=21))

    def test_nonfinite_force_and_speed_do_not_break_status_or_stream(self):
        self.telemetry.ft = (float('nan'), float('inf'), -float('inf'), 0.1, 0.2, 0.3)
        self.telemetry.speed_scaling = float('nan')
        tel = self.robot.get_telemetry()
        self.assertTrue(tel['ok'])
        self.assertEqual(list(tel['ft'].values()), [None, None, None, 0.1, 0.2, 0.3])
        self.assertIsNone(tel['speed_scaling'])
        self.assertEqual(tel['measurement_error']['code'], 'INVALID_FORCE')
        self.assertEqual(tel['measurement_error']['invalid_components'], ['Fx', 'Fy', 'Fz'])
        json.dumps(tel, allow_nan=False)

        # Exercise the real status handler without app startup or RTDE writes.
        source = ast.parse(Path(__file__).resolve().parents[1].joinpath('main.py').read_text())
        handler = next(node for node in source.body
                       if isinstance(node, ast.AsyncFunctionDef) and node.name == 'robot_state')
        handler.decorator_list = []
        ns = dict(ur10e_middleware=self.robot, MASSAGE_SIMULATION_MODE=False)
        exec(compile(ast.Module(body=[handler], type_ignores=[]), 'main.py', 'exec'), ns)
        state = asyncio.run(ns['robot_state']())
        json.dumps(state, allow_nan=False)
        self.assertTrue(state['connected'])
        self.assertEqual(state['state']['actual_TCP_force'], [None, None, None, 0.1, 0.2, 0.3])
        self.assertEqual(state['state']['measurement_error'], tel['measurement_error'])

    def test_ui_force_warning_matches_motion_rejection_and_clears_on_recovery(self):
        self.robot.rtde_io = Mock()
        self.robot.dashboard = SimpleNamespace(program_state=lambda: 'PLAYING', safety_status=lambda: 'NORMAL')
        self.telemetry.ft = (float('nan'), 0, 0, 0, 0, 0)
        warning = self.robot.get_state_snapshot()['measurement_error']
        rejection = self.robot._motion_preflight()
        self.assertFalse(rejection['ok'])
        self.assertEqual(rejection['code'], warning['code'])
        self.assertEqual(rejection['error'], warning['error'])
        self.robot.rtde_io.setInputIntRegister.assert_not_called()
        self.telemetry.ft = (0, 0, 0, 0, 0, 0)
        self.assertIsNone(self.robot.get_state_snapshot()['measurement_error'])
        self.assertTrue(self.robot._motion_preflight()['ok'])

    def test_stale_telemetry_warning_survives_json_serialization(self):
        self.telemetry.ts = time.time() - 3
        snapshot = self.robot.get_state_snapshot()
        self.assertEqual(snapshot['measurement_error']['code'], 'STALE_TELEMETRY')
        json.dumps(snapshot, allow_nan=False)

    def test_invalid_pose_is_reported_without_serialization_or_math_errors(self):
        for value in (float('nan'), float('inf'), -float('inf')):
            for index in (0, 3):
                with self.subTest(value=value, index=index):
                    pose = [0.44, -0.09, 0.35, 0, 3.14, 0]
                    pose[index] = value
                    self.telemetry.tcp_m = tuple(pose)
                    tel = self.robot.get_telemetry()
                    self.assertFalse(tel['ok'])
                    self.assertIn('non-finite', tel['error'])
                    self.assertEqual(tel['measurement_error']['code'], 'INVALID_POSE')
                    json.dumps(tel, allow_nan=False)
                    json.dumps(self.robot.get_state_snapshot(), allow_nan=False)

    def test_valid_measurements_are_preserved(self):
        snapshot = self.robot.get_state_snapshot()
        self.assertEqual(snapshot['actual_TCP_pose'], list(self.telemetry.tcp_m))
        self.assertEqual(snapshot['actual_TCP_force'], list(self.telemetry.ft))
        self.assertEqual(snapshot['speed_scaling'], 1.0)
        json.dumps(snapshot, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
