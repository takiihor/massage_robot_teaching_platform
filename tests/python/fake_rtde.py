"""Shared fakes for the Python backend test suite.

These implement just enough of the ur_rtde Receive/IO surfaces and the
Dashboard client to exercise the middleware logic deterministically, with no
physical robot and no ur-rtde dependency.
"""

from __future__ import annotations

import threading

from robot import protocol


class FakeRTDEIO:
    """Records input registers; optionally blocks to simulate a hung RTDE call."""

    def __init__(self):
        self.inputs = {}
        self.block_event: threading.Event | None = None
        self.block_reg = None
        self.write_count = 0

    def setInputIntRegister(self, reg, value):  # noqa: N802 (mirrors ur_rtde)
        if self.block_event is not None and reg == self.block_reg:
            self.block_event.wait()
        self.inputs[reg] = int(value)
        self.write_count += 1

    def setInputDoubleRegister(self, reg, value):  # noqa: N802
        self.inputs[reg] = float(value)

    def setSpeedSlider(self, value):  # noqa: N802
        self.speed_slider = float(value)

    def disconnect(self):
        pass


class FakeRTDEReceive:
    """Echoes the last written command sequence as ACK and reports configurable state."""

    def __init__(self, io: FakeRTDEIO | None = None):
        self.io = io
        self.outputs = {
            protocol.OUT_STATE: int(protocol.State.IDLE),
            protocol.OUT_ERROR_CODE: 0,
            protocol.OUT_CURRENT_MODE: 0,
            protocol.OUT_PROGRESS: 0,
            protocol.OUT_ACK_SEQ: -1,
            protocol.OUT_CAL_STATUS: 0,
        }
        self.tcp = [0.0, 0.0, 0.3, 0.0, 0.0, 0.0]
        self.force = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        self.speed_scaling = 1.0
        self.read_count = 0

    def getOutputIntRegister(self, reg):  # noqa: N802
        self.read_count += 1
        # Live-echo the command sequence the backend just wrote, so send_mode's
        # ACK poll sees it (mimics a host program that responds).
        if reg == protocol.OUT_ACK_SEQ and self.io is not None:
            return int(self.io.inputs.get(protocol.IN_CMD_SEQ, -1))
        return self.outputs.get(reg, 0)

    def getActualTCPPose(self):  # noqa: N802
        return list(self.tcp)

    def getActualTCPForce(self):  # noqa: N802
        return list(self.force)

    def getSpeedScaling(self):  # noqa: N802
        return self.speed_scaling

    def disconnect(self):
        pass


class FakeDashboard:
    def __init__(self, program_state="PLAYING", robot_mode="RUNNING", safety_status="NORMAL"):
        self.program_state_value = program_state
        self.robot_mode_value = robot_mode
        self.safety_status_value = safety_status

    def program_state(self):
        return self.program_state_value

    def robot_mode(self):
        return self.robot_mode_value

    def safety_status(self):
        return self.safety_status_value

    def get_loaded_program(self):
        return "fake.urp"


def attach_fake_transport(mw, *, connected=True, cal_status=0, ack_ok=True,
                          program_state="PLAYING", safety_status="NORMAL",
                          error_code=0, state=int(protocol.State.IDLE)):
    """Wire fake RTDE + dashboard onto a middleware instance for testing."""
    io = FakeRTDEIO()
    rx = FakeRTDEReceive(io)
    rx.outputs[protocol.OUT_CAL_STATUS] = cal_status
    rx.outputs[protocol.OUT_ERROR_CODE] = error_code
    rx.outputs[protocol.OUT_STATE] = state
    mw.rtde_io = io
    mw.rtde_r = rx
    mw.dashboard = FakeDashboard(program_state=program_state, safety_status=safety_status)
    mw.connected = connected
    if not ack_ok:
        # Make the receive side never echo the sequence: simulate a host program
        # that does not ACK (stale ack register).
        rx.io = None
        rx.outputs[protocol.OUT_ACK_SEQ] = -12345
    return io, rx
