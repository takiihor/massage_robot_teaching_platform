"""Exercise real HTTP validation and control routes with a stubbed robot."""
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import httpx

with patch.dict(os.environ, {'AUTO_CONNECT_RTDE': '0', 'ENABLE_AZURE_SPEECH_STT': 'false'}):
    import main


class ApiReliabilityTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.robot = SimpleNamespace(
            start_massage=Mock(return_value=dict(ok=False, error='host not ready')),
            stop_massage=Mock(return_value=dict(ok=True)),
            start_jog=Mock(), adjust_speed=Mock(), connected=False,
            rtde_io=object(), disconnect=Mock(), connection_id=1, neutralized_connection_id=1)
        self.robot_patch = patch.object(main, 'ur10e_middleware', self.robot)
        self.robot_patch.start()
        self.addCleanup(self.robot_patch.stop)
        # ASGITransport does not run lifespan; all robot operations are stubbed.
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver')
        self.addAsyncCleanup(self.client.aclose)

    async def test_invalid_durations_jogs_and_nonfinite_speed_never_reach_robot(self):
        for path, payload in (
            ('/api/command', dict(mode='knead', duration=0)),
            ('/api/command', dict(mode='knead', duration=1801)),
            ('/massage/start', dict(mode=101, duration=60)),
            ('/robot/jog/z_up', dict(duration_s=-1)),
            ('/robot/jog/z_down', dict(duration_s=4))):
            with self.subTest(path=path, payload=payload):
                response = await self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 422)
        response = await self.client.post('/massage/speed_faster', content='{"delta":NaN}',
                                          headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 422)
        for method in (self.robot.start_massage, self.robot.start_jog, self.robot.adjust_speed):
            method.assert_not_called()

    async def test_preflight_failure_explicitly_reports_no_possible_motion(self):
        response = await self.client.post('/api/command', json=dict(mode='knead', duration=60))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['motion_possible'], False)
        self.robot.stop_massage.assert_not_called()

    async def test_cross_origin_browser_cannot_start_resume_or_disconnect_robot(self):
        for path, payload in (('/api/command', dict(mode='knead', duration=60)),
                              ('/massage/resume', {}), ('/robot/disconnect', {})):
            response = await self.client.post(path, json=payload, headers={'Origin': 'https://untrusted.example'})
            self.assertEqual(response.status_code, 403)
        self.robot.start_massage.assert_not_called()
        self.robot.stop_massage.assert_not_called()
        self.robot.disconnect.assert_not_called()

    async def test_same_origin_browser_commands_remain_available(self):
        response = await self.client.post('/api/command', json=dict(mode='knead', duration=60),
                                          headers={'Origin': 'http://testserver'})
        self.assertEqual(response.status_code, 200)
        self.robot.start_massage.assert_called_once()

    async def test_failed_ack_runs_stop_and_reports_possible_motion(self):
        self.robot.start_massage.return_value = dict(ok=False, seq=7, error='ack timeout')
        response = await self.client.post('/api/command', json=dict(mode='knead', duration=60))
        self.assertFalse(response.json()['ok'])
        self.assertTrue(response.json()['motion_possible'])
        self.robot.stop_massage.assert_called_once()

    async def test_disconnect_preserves_connection_when_stop_is_unconfirmed(self):
        self.robot.stop_massage.return_value = dict(ok=False, error='Stop was not confirmed')
        response = await self.client.post('/robot/disconnect')
        self.assertFalse(response.json()['ok'])
        self.robot.stop_massage.assert_called_once_with(return_home=False)
        self.robot.disconnect.assert_not_called()

    async def test_disconnect_confirms_stationary_stop_before_closing_transport(self):
        calls = []
        self.robot.stop_massage.side_effect = lambda **kwargs: calls.append('stop') or dict(ok=True)
        self.robot.disconnect.side_effect = lambda: calls.append('disconnect')
        response = await self.client.post('/robot/disconnect')
        self.assertTrue(response.json()['ok'])
        self.assertEqual(calls, ['stop', 'disconnect'])

    async def test_unimplemented_duration_changes_are_explicit_errors(self):
        for endpoint in ('extend_duration', 'shorten_duration'):
            response = await self.client.post('/massage/' + endpoint)
            self.assertEqual(response.status_code, 501)


if __name__ == '__main__':
    unittest.main()
