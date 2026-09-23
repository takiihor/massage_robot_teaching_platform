"""Settings / access-boundary tests (Sec 3, 5, 16)."""

from __future__ import annotations

import os
import unittest

from app import settings


class EnvCase(unittest.TestCase):
    KEYS = ("HOST", "PORT", "ALLOW_LAN_BINDING", "MASSAGE_SIMULATION_MODE",
            "UR10E_IP", "UR10E_ALLOWED_IPS", "ROBOT_OPERATOR_TOKEN",
            "MASSAGE_PROFILE", "CORS_ALLOWED_ORIGINS")

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in self.KEYS}
        for k in self.KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class PortHostTest(EnvCase):
    def test_defaults_are_loopback_and_single_port(self):
        s = settings.load_settings()
        self.assertEqual(s.host, "127.0.0.1")
        self.assertEqual(s.port, settings.DEFAULT_PORT)
        self.assertEqual(s.port, 5033)
        self.assertFalse(s.simulation_enabled)

    def test_lan_bind_requires_opt_in(self):
        os.environ["HOST"] = "192.168.10.20"
        self.assertEqual(settings.load_settings().host, "127.0.0.1")  # forced back
        os.environ["ALLOW_LAN_BINDING"] = "1"
        self.assertEqual(settings.load_settings().host, "192.168.10.20")

    def test_invalid_host_fails_closed_to_loopback(self):
        os.environ["HOST"] = "not-an-ip"
        os.environ["ALLOW_LAN_BINDING"] = "1"
        self.assertEqual(settings.load_settings().host, "127.0.0.1")


class RobotTargetTest(EnvCase):
    def test_default_target_allowed(self):
        os.environ["UR10E_IP"] = "192.168.1.10"
        s = settings.load_settings()
        r = settings.validate_robot_target(s, None)
        self.assertTrue(r.ok)
        self.assertEqual(r.ip, "192.168.1.10")

    def test_arbitrary_browser_ip_rejected(self):
        s = settings.load_settings()
        r = settings.validate_robot_target(s, "8.8.8.8")
        self.assertFalse(r.ok)
        self.assertEqual(r.error_code, "robot_target_not_allowed")

    def test_malformed_ip_rejected(self):
        s = settings.load_settings()
        r = settings.validate_robot_target(s, "999.1.1.1; rm -rf")
        self.assertFalse(r.ok)
        self.assertEqual(r.error_code, "robot_target_invalid")

    def test_allowlisted_extra_ip_accepted(self):
        os.environ["UR10E_ALLOWED_IPS"] = "10.0.0.5,10.0.0.6"
        s = settings.load_settings()
        self.assertTrue(settings.validate_robot_target(s, "10.0.0.6").ok)


class ProfileTest(EnvCase):
    def test_explicit_profile_respected(self):
        os.environ["MASSAGE_PROFILE"] = "PHYSICAL_CALIBRATED"
        self.assertEqual(settings.load_settings().profile, "PHYSICAL_CALIBRATED")

    def test_simulation_flag_maps_to_sim_profile(self):
        os.environ["MASSAGE_SIMULATION_MODE"] = "1"
        s = settings.load_settings()
        self.assertTrue(s.simulation_enabled)
        self.assertEqual(s.profile, "SIMULATION")


if __name__ == "__main__":
    unittest.main()
