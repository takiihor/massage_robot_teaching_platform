"""Canonical RTDE protocol definition for the UR10e local-mode massage host programs.

This module is the single source of truth for the register map, command IDs,
state IDs, error codes and per-host-program capability flags. The middleware
(``ur10e_middleware_local_mode``), the FastAPI surface (``main.py``) and the
contract tests all import from here so they cannot silently drift apart.

A separate, independent contract test (``tests/python/test_protocol_contract.py``)
parses the checked-in ``.urs`` programs and asserts they still agree with these
constants, so a mistake here is caught rather than propagated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Dict, FrozenSet


PROTOCOL_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Input registers (backend -> URScript host program)
# ---------------------------------------------------------------------------
IN_CMD = 18
IN_SPEED_X100 = 19
IN_FORCE_X10 = 20
IN_DURATION_S = 21
IN_CMD_SEQ = 22
IN_FORCE_ENABLE = 23

# Optional input double registers used for calibration pose transfer.
IN_POSE_X = 24
IN_POSE_Y = 25
IN_POSE_Z = 26
IN_POSE_RX = 27
IN_POSE_RY = 28
IN_POSE_RZ = 29

# ---------------------------------------------------------------------------
# Output registers (URScript host program -> backend)
#
# NOTE: several ur_rtde builds only expose output *integer* registers in the
# low range [12-19]. The canonical host programs write exactly these. A stale
# map claiming outputs at [18-22] used to live in robot/config.json; it was
# wrong and is now removed in favour of this definition.
# ---------------------------------------------------------------------------
OUT_STATE = 12
OUT_ERROR_CODE = 13
OUT_CURRENT_MODE = 14
OUT_PROGRESS = 15
OUT_ACK_SEQ = 16
OUT_CAL_STATUS = 17


class State(IntEnum):
    IDLE = 0
    RUNNING = 1
    PAUSED = 2


class ErrorCode(IntEnum):
    OK = 0
    UNKNOWN_CMD = 1
    OVERFORCE_STOP = 2
    NOT_ARMED = 3


URSCRIPT_ERROR_TEXT: Dict[int, str] = {
    int(ErrorCode.OK): "ok",
    int(ErrorCode.UNKNOWN_CMD): "unknown command",
    int(ErrorCode.OVERFORCE_STOP): "overforce stop",
    int(ErrorCode.NOT_ARMED): "host program is not armed",
}


class Cmd(IntEnum):
    """Command IDs written to IN_CMD. Motion and non-motion share the register."""

    STOP = 0
    MODE_PUSH_UP = 1
    MODE_WAVE_PUSH = 2
    MODE_SPIRAL_PRESS = 3
    MODE_KNEAD = 4
    PAUSE = 5
    RESUME = 6
    # Calibration / setup
    SAVE_POINT_A = 10
    SAVE_POINT_B = 11
    MOVE_TO_A = 12
    MOVE_TO_B = 13
    MOVE_TO_SAFE = 14
    CLEAR_CALIBRATION = 20
    SET_POINT_A = 21
    SET_POINT_B = 22
    # Manual jogging
    JOG_Z_UP = 101
    JOG_Z_DOWN = 102


# Massage motion modes the demo host programs always support.
MASSAGE_MODE_IDS: FrozenSet[int] = frozenset(
    {int(Cmd.MODE_PUSH_UP), int(Cmd.MODE_WAVE_PUSH), int(Cmd.MODE_SPIRAL_PRESS), int(Cmd.MODE_KNEAD)}
)

# Calibration commands require a host program that implements calibration state.
CALIBRATION_CMD_IDS: FrozenSet[int] = frozenset(
    {
        int(Cmd.SAVE_POINT_A),
        int(Cmd.SAVE_POINT_B),
        int(Cmd.MOVE_TO_A),
        int(Cmd.MOVE_TO_B),
        int(Cmd.MOVE_TO_SAFE),
        int(Cmd.CLEAR_CALIBRATION),
        int(Cmd.SET_POINT_A),
        int(Cmd.SET_POINT_B),
    }
)

JOG_CMD_IDS: FrozenSet[int] = frozenset({int(Cmd.JOG_Z_UP), int(Cmd.JOG_Z_DOWN)})

# Motion-changing commands: exactly one may execute at a time and each requires
# the full physical preflight (STOP is intentionally excluded so it can always
# be sent even when the robot is otherwise faulted / not ready).
MOTION_CMD_IDS: FrozenSet[int] = frozenset(
    set(MASSAGE_MODE_IDS) | {int(Cmd.RESUME)} | CALIBRATION_CMD_IDS | JOG_CMD_IDS
    | {int(Cmd.MOVE_TO_A), int(Cmd.MOVE_TO_B), int(Cmd.MOVE_TO_SAFE)}
)

# Non-motion / control commands that must remain available outside preflight.
STOP_CMD_IDS: FrozenSet[int] = frozenset({int(Cmd.STOP)})
PAUSE_CMD_IDS: FrozenSet[int] = frozenset({int(Cmd.PAUSE)})


# ---------------------------------------------------------------------------
# Capability model
# ---------------------------------------------------------------------------
CAP_MASSAGE = "massage"
CAP_CALIBRATION = "calibration"
CAP_JOG = "jog"
CAP_FORCE_ASSIST = "force_assist"
CAP_HEARTBEAT = "heartbeat"


@dataclass(frozen=True)
class Capabilities:
    """What a loaded host program actually supports.

    Backend must not expose calibration / jog when the loaded program does not
    advertise it, instead of hoping the register map matches.
    """

    flags: FrozenSet[str] = field(default_factory=lambda: frozenset({CAP_MASSAGE}))

    def supports(self, cap: str) -> bool:
        return cap in self.flags

    # The checked-in demo host programs (Run_mode4_*, ur10e_demo_smooth_27)
    # implement massage modes + arm/stop/ACK/overforce only, and always pin
    # OUT_CAL_STATUS=0.
    @classmethod
    def demo(cls) -> "Capabilities":
        return cls(flags=frozenset({CAP_MASSAGE}))

    @classmethod
    def calibrated(cls) -> "Capabilities":
        return cls(
            flags=frozenset({CAP_MASSAGE, CAP_CALIBRATION, CAP_JOG, CAP_FORCE_ASSIST})
        )

    def as_dict(self) -> Dict[str, bool]:
        return {
            "massage": self.supports(CAP_MASSAGE),
            "calibration": self.supports(CAP_CALIBRATION),
            "jog": self.supports(CAP_JOG),
            "force_assist": self.supports(CAP_FORCE_ASSIST),
            "heartbeat": self.supports(CAP_HEARTBEAT),
        }


# ---------------------------------------------------------------------------
# Deployment / runtime profiles
# ---------------------------------------------------------------------------
PROFILES = ("SIMULATION", "URSIM", "PHYSICAL_DEMO", "PHYSICAL_CALIBRATED")


@dataclass(frozen=True)
class ProfilePolicy:
    """Per-profile rules for what authorises physical motion.

    ``requires_calibration`` gates real massage motion: a calibrated profile
    must not silently run with ``cal_status == 0`` (which is only legitimate
    for a demo host program).
    """

    requires_calibration: bool
    allows_demo_no_calibration: bool
    is_physical: bool


PROFILE_POLICIES: Dict[str, ProfilePolicy] = {
    "SIMULATION": ProfilePolicy(
        requires_calibration=False, allows_demo_no_calibration=True, is_physical=False
    ),
    "URSIM": ProfilePolicy(
        requires_calibration=False, allows_demo_no_calibration=True, is_physical=False
    ),
    "PHYSICAL_DEMO": ProfilePolicy(
        requires_calibration=False, allows_demo_no_calibration=True, is_physical=True
    ),
    "PHYSICAL_CALIBRATED": ProfilePolicy(
        requires_calibration=True, allows_demo_no_calibration=False, is_physical=True
    ),
}
