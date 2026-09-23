"""Validated application settings — the single source of truth for host, port,
CORS, robot targeting and the operating profile.

This module intentionally has **no FastAPI / Azure / ur-rtde imports** so it can
be imported and unit-tested anywhere. ``main.py`` reads from here instead of
scattering ``os.getenv`` defaults (which previously disagreed: 5000 vs 5033, and
a hardcoded ``0.0.0.0`` bind that ignored ``start.sh``'s ``HOST``).

Security posture (docs/security/robot-control-boundary.md):
- Default bind is loopback only. LAN exposure is an explicit opt-in.
- The robot controller address comes from trusted config / an allowlist, never
  from a browser-supplied value, unless an engineer endpoint is explicitly used.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from typing import List, Optional

from robot import protocol


DEFAULT_PORT = 5033
DEFAULT_HOST = "127.0.0.1"

_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    val = raw.strip().lower()
    if val in _TRUE:
        return True
    if val in _FALSE:
        return False
    return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def normalize_host(value: Optional[str]) -> str:
    """Validate a bind host. Reject anything that is not a concrete address.

    ``0.0.0.0``/``::`` are bind-all addresses; they are only allowed when
    ``ALLOW_LAN_BINDING`` is set, and even then we keep them as-is for uvicorn.
    """
    host = (value or DEFAULT_HOST).strip()
    if not host:
        host = DEFAULT_HOST
    if host in ("localhost",):
        return "127.0.0.1"
    try:
        ipaddress.ip_address(host)
    except ValueError as exc:
        raise ValueError(f"HOST must be a valid IP address, got {host!r}") from exc
    return host


def is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_bind_all(host: str) -> bool:
    return host in ("0.0.0.0", "::", "[::]")


def parse_ip_list(raw: Optional[str]) -> List[str]:
    out: List[str] = []
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            ipaddress.ip_address(item)
        except ValueError:
            # Ignore malformed entries rather than crashing startup.
            continue
        out.append(item)
    return out


@dataclass
class Settings:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    allow_lan_binding: bool = False
    simulation_enabled: bool = False
    profile: str = "PHYSICAL_DEMO"
    default_robot_ip: str = "127.0.0.1"
    robot_ip_allowlist: List[str] = field(default_factory=list)
    cors_allowed_origins: List[str] = field(default_factory=list)
    operator_token: Optional[str] = None
    telemetry_hz: int = 5

    @property
    def robot_targeting_locked(self) -> bool:
        """When True a browser-supplied robot IP is never trusted."""
        return True


def _resolve_default_profile(settings: "Settings") -> str:
    """Choose the runtime profile from explicit config, never from mere connectivity."""
    env_profile = os.getenv("MASSAGE_PROFILE", "").strip().upper()
    if env_profile in protocol.PROFILES:
        return env_profile
    if settings.simulation_enabled:
        return "SIMULATION"
    # No explicit profile and not simulation: assume a demo physical setup, which
    # still requires a connected, PLAYING host program before motion (preflight).
    return "PHYSICAL_DEMO"


def load_settings() -> Settings:
    port = _env_int("PORT", DEFAULT_PORT)
    raw_host = os.getenv("HOST", DEFAULT_HOST)
    allow_lan = _env_bool("ALLOW_LAN_BINDING", False)
    try:
        host = normalize_host(raw_host)
    except ValueError:
        # Fail closed to loopback if an operator set an invalid HOST.
        host = DEFAULT_HOST
    if not allow_lan and not (is_loopback(host)):
        # LAN exposure must be an explicit choice; refuse a non-loopback bind.
        host = DEFAULT_HOST

    simulation = _env_bool("MASSAGE_SIMULATION_MODE", False)
    default_robot_ip = (os.getenv("UR10E_IP", "127.0.0.1") or "127.0.0.1").strip()
    allowlist = parse_ip_list(os.getenv("UR10E_ALLOWED_IPS", ""))
    if default_robot_ip not in allowlist:
        allowlist = [default_robot_ip] + allowlist

    if simulation:
        cors_default = "http://127.0.0.1:{p},http://localhost:{p}".format(p=port)
    else:
        cors_default = "http://127.0.0.1:{p},http://localhost:{p}".format(p=port)
    cors = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", cors_default).split(",") if o.strip()]

    operator_token = (os.getenv("ROBOT_OPERATOR_TOKEN") or "").strip() or None

    settings = Settings(
        host=host,
        port=port,
        allow_lan_binding=allow_lan,
        simulation_enabled=simulation,
        default_robot_ip=default_robot_ip,
        robot_ip_allowlist=allowlist,
        cors_allowed_origins=cors,
        operator_token=operator_token,
        telemetry_hz=_env_int("UR10E_TELEM_HZ", 5),
    )
    settings.profile = _resolve_default_profile(settings)
    return settings


def validate_robot_target(settings: Settings, requested_ip: Optional[str]) -> "TargetResult":
    """Resolve + validate a robot controller address against trusted config.

    A browser/attacker cannot make the backend dial an arbitrary host.
    """
    ip = (requested_ip or "").strip()
    if not ip:
        return TargetResult(True, settings.default_robot_ip, None)
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return TargetResult(False, None, "robot_target_invalid")
    if ip not in settings.robot_ip_allowlist:
        return TargetResult(False, None, "robot_target_not_allowed")
    return TargetResult(True, ip, None)


@dataclass
class TargetResult:
    ok: bool
    ip: Optional[str]
    error_code: Optional[str]
