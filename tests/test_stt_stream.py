"""Exercise the streaming endpoint with an SDK stub; no cloud credentials needed."""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
import time
import unittest
import uuid
import base64
import json


class StreamingLatencyTest(unittest.IsolatedAsyncioTestCase):
    async def test_endpoint_configures_fast_finalization_and_keeps_loop_responsive(self):
        source = ast.parse(Path(__file__).resolve().parents[1].joinpath('main.py').read_text())
        endpoint = next(node for node in source.body
                        if isinstance(node, ast.AsyncFunctionDef) and node.name == 'websocket_stt_stream')
        endpoint.decorator_list = []
        properties = {}
        loop_advanced = []
        stream_writes = []

        class Config:
            def __init__(self, **kwargs):
                pass

            def set_property(self, key, value):
                properties[key] = value

        class Recognizer:
            def __init__(self, **kwargs):
                signal = SimpleNamespace(connect=lambda callback: None)
                self.recognizing = self.recognized = self.canceled = self.session_stopped = signal

            def start_continuous_recognition(self):
                # Model the SDK waiting synchronously on its service connection.
                time.sleep(0.05)
                self.started_without_blocking_loop = bool(loop_advanced)
                if not self.started_without_blocking_loop:
                    raise AssertionError('SDK startup blocked the asyncio loop')

            def stop_continuous_recognition(self):
                time.sleep(0.01)

        sdk = SimpleNamespace(
            SpeechConfig=Config, SpeechRecognizer=Recognizer,
            OutputFormat=SimpleNamespace(Detailed='detailed'),
            PropertyId=SimpleNamespace(Speech_SegmentationSilenceTimeoutMs='silence',
                                       SpeechServiceResponse_StablePartialResultThreshold='partial_threshold'),
            audio=SimpleNamespace(
                AudioStreamFormat=lambda **kwargs: kwargs,
                PushAudioInputStream=lambda **kwargs: SimpleNamespace(
                    write=stream_writes.append, close=lambda: None),
                AudioConfig=lambda **kwargs: kwargs))

        class Socket:
            def __init__(self):
                self.messages = iter([
                    {'type': 'config', 'language': 'zh-HK'},
                    {'type': 'audio', 'data': base64.b64encode(b'\x00\x00').decode()},
                    {'type': 'stop'}])
                self.sent = []

            async def accept(self):
                pass

            async def receive_json(self):
                return next(self.messages)

            async def send_json(self, message):
                self.sent.append(message)

        namespace = dict(asyncio=asyncio, speechsdk=sdk, WebSocket=Socket,
                         WebSocketDisconnect=type('Disconnected', (Exception,), {}),
                         logger=logging.getLogger(__name__), uuid=uuid, json=json, base64=base64,
                         AZURE_SPEECH_STT_ENABLED=True, AZURE_SPEECH_KEY='fake',
                         AZURE_SPEECH_REGION='fake', STT_SEGMENTATION_SILENCE_MS=300,
                         _apply_phrase_boosting=lambda *args: None)
        exec(compile(ast.Module(body=[endpoint], type_ignores=[]), 'main.py', 'exec'), namespace)

        async def tick():
            await asyncio.sleep(0.005)
            loop_advanced.append(True)

        socket = Socket()
        await asyncio.gather(namespace['websocket_stt_stream'](socket), tick())
        self.assertEqual(properties, {'silence': '300', 'partial_threshold': '1'})
        self.assertEqual(stream_writes, [b'\x00\x00'])
        self.assertEqual([msg['state'] for msg in socket.sent], ['listening', 'stopped'])


if __name__ == '__main__':
    unittest.main()
