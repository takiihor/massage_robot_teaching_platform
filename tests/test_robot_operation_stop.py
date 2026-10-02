"""Exercise API scheduling without importing app/cloud startup dependencies."""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest


class RobotOperationStopTest(unittest.IsolatedAsyncioTestCase):
    async def test_stop_bypasses_busy_operation_and_cancels_queued_start(self):
        source = ast.parse(Path(__file__).resolve().parents[1].joinpath('main.py').read_text())
        names = {'_run_blocking_robot_op', '_run_robot_op', 'local_mode_stop', 'massage_stop'}
        nodes = [node for node in source.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
        for node in nodes:
            node.decorator_list = []
        ns = dict(asyncio=asyncio, ROBOT_OPERATION_LOCK=asyncio.Lock(), ROBOT_STOP_GENERATION=0,
                  ROBOT_STOP_LOCK=asyncio.Lock(), ROBOT_PENDING_STOPS=0,
                  logger=logging.getLogger(__name__))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), ns)
        waiting = threading.Event()
        release = threading.Event()
        called = []

        def blocked():
            waiting.set()
            release.wait(2)
            return dict(ok=True)

        def stop():
            called.append('stop')
            return dict(ok=True)

        ns['ur10e_middleware'] = SimpleNamespace(stop_massage=stop)
        busy = asyncio.create_task(ns['_run_robot_op'](blocked))
        queued = None
        try:
            for _ in range(100):
                if waiting.is_set():
                    break
                await asyncio.sleep(0.005)
            self.assertTrue(waiting.is_set())
            queued = asyncio.create_task(ns['_run_robot_op'](lambda: called.append('start')))
            await asyncio.sleep(0)
            for endpoint in ('local_mode_stop', 'massage_stop'):
                self.assertTrue((await asyncio.wait_for(ns[endpoint](), 0.5))['ok'])
            self.assertFalse(busy.done(), 'Stop should complete while the earlier operation remains blocked')
        finally:
            release.set()
            await busy
        self.assertFalse((await queued)['ok'])
        self.assertEqual(called, ['stop', 'stop'])

        # A new Start must also be rejected while STOP is awaiting confirmation.
        stop_waiting = threading.Event()
        stop_release = threading.Event()

        def pending_stop():
            stop_waiting.set()
            stop_release.wait(2)
            return dict(ok=True)

        ns['ur10e_middleware'].stop_massage = pending_stop
        stopping = asyncio.create_task(ns['local_mode_stop']())
        try:
            for _ in range(100):
                if stop_waiting.is_set():
                    break
                await asyncio.sleep(0.005)
            self.assertTrue(stop_waiting.is_set())
            attempt = await ns['_run_robot_op'](lambda: called.append('start'))
            self.assertFalse(attempt['ok'])
            self.assertIn('pending', attempt['error'])
        finally:
            stop_release.set()
            await stopping
        self.assertEqual(ns['ROBOT_PENDING_STOPS'], 0)
        self.assertNotIn('start', called)


if __name__ == '__main__':
    unittest.main()
