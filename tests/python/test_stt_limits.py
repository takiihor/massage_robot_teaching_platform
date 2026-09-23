import unittest

from app.stt_limits import SttLimits


def _limits(**over):
    base = dict(
        max_concurrent_sessions=4,
        max_chunk_b64_chars=100,
        max_session_bytes=250,
        max_session_seconds=60.0,
        idle_timeout_seconds=10.0,
    )
    base.update(over)
    return SttLimits(**base)


class SttAdmissionTest(unittest.TestCase):
    def test_accepts_below_cap_and_rejects_at_cap(self):
        lim = _limits()
        self.assertTrue(lim.can_accept_new_session(0))
        self.assertTrue(lim.can_accept_new_session(3))
        self.assertFalse(lim.can_accept_new_session(4))
        self.assertFalse(lim.can_accept_new_session(5))

    def test_zero_cap_fails_closed(self):
        lim = _limits(max_concurrent_sessions=0)
        self.assertFalse(lim.can_accept_new_session(0))


class SttChunkSizeTest(unittest.TestCase):
    def test_boundary_is_inclusive(self):
        lim = _limits(max_chunk_b64_chars=100)
        self.assertFalse(lim.chunk_too_large(99))
        self.assertFalse(lim.chunk_too_large(100))  # == cap is allowed
        self.assertTrue(lim.chunk_too_large(101))


class SttSessionBudgetTest(unittest.TestCase):
    def test_accumulates_until_ceiling(self):
        lim = _limits(max_session_bytes=250)
        total, ok = lim.add_chunk(0, 100)
        self.assertEqual((total, ok), (100, True))
        total, ok = lim.add_chunk(total, 100)
        self.assertEqual((total, ok), (200, True))
        # 200 + 60 == cap 250 -> still within budget
        total, ok = lim.add_chunk(total, 50)
        self.assertEqual((total, ok), (250, True))
        # one more byte breaches the ceiling; caller must stop.
        total, ok = lim.add_chunk(total, 1)
        self.assertEqual(total, 251)
        self.assertFalse(ok)


class SttDurationTest(unittest.TestCase):
    def test_expiry(self):
        lim = _limits(max_session_seconds=60.0)
        self.assertFalse(lim.session_expired(now=1000.0, started=950.0))
        self.assertFalse(lim.session_expired(now=1060.0, started=1000.0))  # == cap
        self.assertTrue(lim.session_expired(now=1061.0, started=1000.0))


if __name__ == "__main__":
    unittest.main()
