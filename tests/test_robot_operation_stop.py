"""Exercise API scheduling without importing app/cloud startup dependencies."""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from fastapi import HTTPException, Request


class RobotOperationStopTest(unittest.IsolatedAsyncioTestCase):
    def make_runtime(self):
        source = ast.parse(Path(__file__).resolve().parents[1].joinpath('main.py').read_text())
        names = {'_run_blocking_robot_op', '_run_robot_op', '_observe_robot_task', '_log_robot_stop_request', 'local_mode_stop', 'massage_stop'}
        nodes = [node for node in source.body if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name in names]
        for node in nodes:
            node.decorator_list = []
        ns = dict(asyncio=asyncio, ROBOT_OPERATION_LOCK=asyncio.Lock(), ROBOT_STOP_GENERATION=0,
                  ROBOT_STOP_LOCK=asyncio.Lock(), ROBOT_PENDING_STOPS=0,
                  logger=logging.getLogger(__name__))
        executor = ThreadPoolExecutor(max_workers=1)
        self.addCleanup(executor.shutdown)
        ns.update(ROBOT_STOP_EXECUTOR=executor, HTTPException=HTTPException, Request=Request,
                  stop_request=SimpleNamespace(headers={'x-robot-stop-reason': 'voice_endsession'},
                                               url=SimpleNamespace(path='/api/stop')))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), ns)
        return ns

    async def wait_started(self, event):
        for _ in range(100):
            if event.is_set():
                return
            await asyncio.sleep(0.005)
        self.fail('Worker did not start')

    async def test_timeout_keeps_lock_until_worker_finishes_and_expired_queue_never_runs(self):
        ns = self.make_runtime()
        started, release = threading.Event(), threading.Event()
        calls = []

        def blocked():
            started.set()
            release.wait(2)
            calls.append('finished')

        busy = asyncio.create_task(ns['_run_robot_op'](blocked, timeout_s=0.03))
        await self.wait_started(started)
        try:
            with self.assertRaises(HTTPException) as failure:
                await busy
            self.assertEqual(failure.exception.status_code, 504)
            self.assertTrue(ns['ROBOT_OPERATION_LOCK'].locked())
            with self.assertRaises(HTTPException):
                await ns['_run_robot_op'](lambda: calls.append('expired'), timeout_s=0.01)
            next_op = asyncio.create_task(ns['_run_robot_op'](lambda: calls.append('next')))
            await asyncio.sleep(0.01)
            self.assertEqual(calls, [])
        finally:
            release.set()
        await next_op
        self.assertEqual(calls, ['finished', 'next'])

    async def test_stop_timeout_still_blocks_motion_until_actual_stop_worker_returns(self):
        ns = self.make_runtime()
        started, release = threading.Event(), threading.Event()

        def stop():
            started.set()
            release.wait(2)
            return dict(ok=True)

        stopping = asyncio.create_task(ns['_run_robot_op'](stop, priority_stop=True, timeout_s=0.03))
        await self.wait_started(started)
        try:
            with self.assertRaises(HTTPException):
                await stopping
            self.assertEqual(ns['ROBOT_PENDING_STOPS'], 1)
            called = []
            self.assertFalse((await ns['_run_robot_op'](lambda: called.append('motion')))['ok'])
            self.assertEqual(called, [])
        finally:
            release.set()
        for _ in range(100):
            if not ns['ROBOT_PENDING_STOPS']:
                break
            await asyncio.sleep(0.005)
        self.assertEqual(ns['ROBOT_PENDING_STOPS'], 0)

    async def test_stop_has_capacity_when_default_executor_is_saturated(self):
        ns = self.make_runtime()
        pool = ThreadPoolExecutor(max_workers=1)
        asyncio.get_running_loop().set_default_executor(pool)
        started, release = threading.Event(), threading.Event()

        def speech_work():
            started.set()
            release.wait(2)

        waiting = asyncio.get_running_loop().run_in_executor(None, speech_work)
        await self.wait_started(started)
        try:
            stopped = await asyncio.wait_for(ns['_run_robot_op'](lambda: dict(ok=True), priority_stop=True), 0.5)
            self.assertTrue(stopped['ok'])
            self.assertFalse(waiting.done())
        finally:
            release.set()
            await waiting

    async def test_failed_motion_ack_triggers_stop_before_returning_failure(self):
        ns = self.make_runtime()
        calls = []
        ns['ur10e_middleware'] = SimpleNamespace(stop_massage=lambda: calls.append('stop') or dict(ok=True))
        result = await ns['_run_robot_op'](lambda: dict(ok=False, seq=19, error='ack timeout'), stop_on_timeout=True)
        self.assertFalse(result['ok'])
        self.assertEqual(calls, ['stop'])

    async def test_stop_bypasses_busy_operation_and_cancels_queued_start(self):
        ns = self.make_runtime()
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
            with self.assertLogs(ns['logger'], level='INFO') as logs:
                for endpoint in ('local_mode_stop', 'massage_stop'):
                    self.assertTrue((await asyncio.wait_for(ns[endpoint](ns['stop_request']), 0.5))['ok'])
            self.assertTrue(all('reason=voice_endsession' in line for line in logs.output))
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
        stopping = asyncio.create_task(ns['local_mode_stop'](ns['stop_request']))
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
