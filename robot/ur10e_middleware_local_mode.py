"""
ur10e_middleware_local_mode.py

Stable **LOCAL MODE** middleware for UR10e / URSim.

Design goal
-----------
- Robot stays in **Local mode** (PolyScope is authoritative).
- A PolyScope program (e.g. massage_modes.urp) is kept PLAYING on the robot.
- External UI/backend only **writes RTDE registers** to request a mode/action.
- Backend also **monitors** TCP pose + force/torque (read-only) for UI display.

This file intentionally does NOT use RTDEControlInterface (remote motion),
because that path is commonly blocked in Local mode and is a major source of
"connected but not moving" instability.

Dependencies
-----------
- ur-rtde (pip: ur-rtde) providing:
    - rtde_receive.RTDEReceiveInterface
    - rtde_io.RTDEIOInterface
Optionally, we use the Dashboard server (29999) to check programState.
"""

from __future__ import annotations

import os
import socket
import time
import json
import math
import logging
import threading
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------
# RTDE Register Map (MUST match ur10e_demo_smooth_27.urs)
# ---------------------------------------------------------------------
# Input integers (UI/backend -> URScript host program)
IN_CMD = 18            # 0 stop, 1..4 modes, 5 pause, 6 resume, 20/21 calibration etc (per your .urs)
IN_SPEED_X100 = 19     # speed scaling (int) e.g. 15 means 0.15x baseline (interpretation by URScript)
IN_FORCE_X10 = 20      # force (N) * 10  (e.g. 35 => 3.5N)
IN_DURATION_S = 21     # seconds
IN_CMD_SEQ = 22        # monotonically increasing sequence number
IN_FORCE_ENABLE = 23   # 0=Force OFF, 1=Force ON (if not supported, URScript falls back to IN_FORCE_X10<0)

# Output integers (URScript -> UI/backend)
# NOTE: Some ur_rtde builds only support output int registers in the lower range [12-19].
# Keep outputs within that range to avoid getOutputIntRegister() failures.
OUT_STATE = 12
OUT_ERROR_CODE = 13
OUT_CURRENT_MODE = 14
OUT_PROGRESS = 15
OUT_ACK_SEQ = 16
OUT_CAL_STATUS = 17
OUT_FAULT_REASON = 18
OUT_FAULT_ACTION = 19
OUT_FAULT_FLOATS = tuple(range(12, 19))  # Fx/Fy/Fz, session seconds, TCP XYZ
OUT_DIAGNOSTICS_VERSION = 19
DIAGNOSTICS_VERSION = 2026100904
FORCE_HARD_LIMIT_N = 25.0  # MUST match FZ_HARD_LIMIT in the host script.
# Position-only demo: no intended contact, so force checks are OFF. MUST match
# FORCE_GUARD_ENABLED in the host script. See README "Force checking".
FORCE_CHECK_ENABLED = False
SAFETY_FAULT_CODES = (2, 5, 6)
FAULT_REASON_TEXT = {1: "overforce", 2: "invalid_force_sample", 3: "invalid_force_arithmetic", 4: "heartbeat_lost"}
FAULT_ACTION_TEXT = {0: "between actions", 1: "arm movement", 2: "gripper closing", 3: "gripper opening",
                     4: "batch return", 5: "paused", 6: "home return"}

UR_SCRIPT_ERROR_TEXT = {
    0: "ok",
    1: "unknown command",
    2: "overforce stop",
    3: "host program is not armed",
    4: "invalid session duration",
    5: "backend heartbeat lost",
    6: "invalid controller force reading",
}

# Optional input float registers used by your URScript for calibration points
# Reserved for optional calibration-capable host programs; the demo does not use these.
IN_POSE_X = 24
IN_POSE_Y = 25
IN_POSE_Z = 26
IN_POSE_RX = 27
IN_POSE_RY = 28
IN_POSE_RZ = 29

# Calibration command IDs (must match .urs)
CMD_HOME_XYZ = 7
CMD_HOME_ROTATION = 8
IN_HOME_REGISTERS = (18, 19, 20)
IN_HEARTBEAT = 21  # double register; independent of integer duration register 21
STATE_RETURNING_HOME = 3

CMD_SAVE_POINT_A = 10
CMD_SAVE_POINT_B = 11
CMD_MOVE_TO_A = 12
CMD_MOVE_TO_B = 13
CMD_MOVE_TO_SAFE = 14
CMD_CLEAR_CALIBRATION = 20
CMD_SET_POINT_A = 21
CMD_SET_POINT_B = 22
CMD_JOG_Z_UP = 101
CMD_JOG_Z_DOWN = 102

CALIBRATION_FILE = Path(__file__).parent / "calibration_data.json"


# ---------------------------------------------------------------------
# Dashboard client (read-only is enough for Local-mode stability)
# ---------------------------------------------------------------------
class DashboardClient:
    def __init__(self, host: str, port: int = 29999, timeout: float = 2.5):
        self.host = host
        self.port = port
        self.timeout = timeout

    def _send_cmd(self, cmd: str) -> str:
        # Dashboard server is plain TCP, one-line commands.
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        try:
            s.connect((self.host, self.port))
            # Consume the welcome banner so the next recv is the command response.
            try:
                s.recv(4096)
            except Exception:
                pass
            s.sendall((cmd.strip() + "\n").encode("utf-8"))
            data = s.recv(4096)
            return data.decode("utf-8", errors="ignore").strip()
        finally:
            try:
                s.close()
            except Exception:
                pass

    def program_state(self) -> str:
        # Example returns: "STOPPED", "PLAYING", "PAUSED"
        try:
            resp = self._send_cmd("programState")
            return resp
        except Exception:
            return "UNKNOWN"

    def robot_mode(self) -> str:
        try:
            return self._send_cmd("robotmode")
        except Exception:
            return "UNKNOWN"

    def safety_status(self) -> str:
        try:
            return self._send_cmd("safetystatus")
        except Exception:
            return "UNKNOWN"

    def get_loaded_program(self) -> str:
        try:
            return self._send_cmd("get loaded program")
        except Exception:
            return "UNKNOWN"

    # NOTE: We deliberately do NOT auto power on / brake release here; you said you already handle those.


# ---------------------------------------------------------------------
# Public DTOs
# ---------------------------------------------------------------------
@dataclass
class Telemetry:
    """UI-friendly telemetry (read-only)."""
    ts: float
    tcp_m: Tuple[float, float, float, float, float, float]   # [x,y,z,Rx,Ry,Rz]
    ft: Tuple[float, float, float, float, float, float]      # [Fx,Fy,Fz,Tx,Ty,Tz]
    speed_scaling: Optional[float] = None
    program_state: Optional[str] = None
    robot_mode: Optional[str] = None
    safety_status: Optional[str] = None


@dataclass
class MassageCommand:
    mode: Optional[str] = None
    intensity: Optional[str] = None
    duration: Optional[int] = None
    force_assist: Optional[bool] = None


# ---------------------------------------------------------------------
# UR10e Local Mode Middleware
# ---------------------------------------------------------------------
class UR10eMiddlewareLocalMode:
    """
    Local-mode middleware:
    - write commands via RTDE IO registers
    - monitor pose/force via RTDE Receive
    """

    def __init__(
        self,
        default_ip: Optional[str] = None,
        rtde_frequency_hz: int = 50,
        telemetry_hz: int = 25,
        dashboard_timeout: float = 2.5,
    ):
        self.default_ip = default_ip or os.getenv("UR10E_IP", "127.0.0.1")
        self.rtde_frequency_hz = int(rtde_frequency_hz)
        self.telemetry_hz = max(1, min(10, int(telemetry_hz)))
        self.dashboard_timeout = float(dashboard_timeout)

        self.rtde_r = None
        self.rtde_io = None
        self.dashboard: Optional[DashboardClient] = None

        self._seq = 0
        self._lock = threading.Lock()
        self._ip: Optional[str] = None
        self._reconnect_backoff_s = 2.0
        self._last_reconnect_attempt = 0.0
        self._last_error: Optional[str] = None
        self._last_error_ts: Optional[float] = None
        self._last_ack_seq: Optional[int] = None
        self._cal_point_a_pose: Optional[List[float]] = None
        self._cal_point_b_pose: Optional[List[float]] = None
        self._speed_scale_x100 = 100
        self._speed_slider = 1.0
        self._force_enable_supported = True
        self._send_mode_lock = threading.Lock()
        self._stop_generation = 0
        self._home_pose: Optional[List[float]] = None
        self._home_ip: Optional[str] = None
        self._connection_lock = threading.RLock()

        self._stop_evt = threading.Event()
        self._telemetry_thread: Optional[threading.Thread] = None
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._latest: Dict[str, Any] = {}
        self._last_fault: Optional[Dict[str, Any]] = None
        self._last_fault_key = None
        self.connected = False
        self.connection_id = 0
        self.neutralized_connection_id = None
        saved = self._load_calibration_from_file()
        if saved:
            self._cal_point_a_pose = saved.get("point_a_pose") or None
            self._cal_point_b_pose = saved.get("point_b_pose") or None

    # --------------------------
    # Connection lifecycle
    # --------------------------
    def connect(self, ip: Optional[str] = None) -> None:
        with self._connection_lock:
            if self.rtde_io:
                stopped = self.stop_massage(return_home=False)
                if not stopped.get("ok"):
                    raise RuntimeError("Cannot replace connection before robot Stop is confirmed")
            try:
                self._connect(ip)
            except Exception:
                self._reset_connections()
                raise

    def _connect(self, ip: Optional[str] = None) -> None:
        # Disconnect any existing connection first to avoid register conflicts
        if self.connected or self.rtde_r or self.rtde_io:
            self.disconnect()

        ip = ip or self.default_ip
        self._ip = ip
        self._stop_evt = threading.Event()

        # Import here so the file can be imported even when ur_rtde isn't installed.
        try:
            from rtde_receive import RTDEReceiveInterface as RTDEReceive
            from rtde_io import RTDEIOInterface as RTDEIO
        except Exception as e:
            raise RuntimeError(
                "ur-rtde not available. Install with: pip install ur-rtde"
            ) from e

        logger.info("Connecting RTDE (receive + io) to %s", ip)
        self.rtde_r = self._create_rtde_receive(RTDEReceive, ip)
        try:
            self.rtde_io = RTDEIO(ip)
        except Exception:
            # Clean up rtde_r if rtde_io fails to connect
            if self.rtde_r and hasattr(self.rtde_r, 'disconnect'):
                self.rtde_r.disconnect()
            self.rtde_r = None
            raise
        self.dashboard = DashboardClient(ip, timeout=self.dashboard_timeout)
        if self._stop_evt.is_set():
            raise RuntimeError("Robot connection cancelled by disconnect")
        self._last_error = None
        self._last_error_ts = None
        self._write_force_enable(False)
        self._resync_sequence_from_robot()
        neutralized = self._neutralize_motion_on_connect()
        if neutralized.get("ok") and not neutralized.get("return_home_pending") and not neutralized.get("safety_fault_latched"):
            self._capture_home_pose()
            uploaded = self._upload_home_pose()
            if not uploaded.get("ok"):
                logger.warning("Startup home upload pending: %s", uploaded.get("error"))

        # An old thread may still be inside a Dashboard socket call. Never
        # clear its cancellation event when creating a replacement connection.
        if self._stop_evt.is_set():
            raise RuntimeError("Robot connection cancelled by disconnect")
        self.connected = True
        self.connection_id += 1
        self.neutralized_connection_id = self.connection_id if neutralized.get("ok") and not neutralized.get("return_home_pending") else None
        self._telemetry_thread = threading.Thread(target=self._telemetry_loop, args=(self._stop_evt,), daemon=True)
        self._start_heartbeat()
        self._telemetry_thread.start()

    def _start_heartbeat(self) -> None:
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop,
            args=(self._stop_evt, self.rtde_io), daemon=True)
        self._heartbeat_thread.start()

    def _heartbeat_loop(self, stop_evt, io) -> None:
        counter = 0
        while not stop_evt.is_set():
            try:
                # A disconnected native IO setter may attempt a blocking
                # reconnect. Leave recovery to the probed reconnect path.
                if hasattr(io, "isConnected") and not io.isConnected():
                    return
                with self._send_mode_lock:
                    if stop_evt.is_set() or io is not self.rtde_io:
                        return
                    counter = (counter + 1) % 2_000_000_000
                    if io.setInputDoubleRegister(IN_HEARTBEAT, float(counter)) is False:
                        raise ConnectionError("Heartbeat write failed")
            except Exception as exc:
                if not stop_evt.is_set():
                    self.connected = False
                    self._mark_error(f"Robot heartbeat failed: {exc}")
                return
            stop_evt.wait(0.25)

    def _capture_home_pose(self, refresh: bool = False) -> None:
        """Capture the session return pose; reconnects preserve the saved target."""
        if not refresh and self._home_pose is not None and self._home_ip == self._ip:
            return
        pose = list(self.rtde_r.getActualTCPPose())
        if len(pose) != 6 or not all(math.isfinite(value) for value in pose):
            raise RuntimeError("Robot return TCP pose is invalid")
        self._home_pose = pose
        self._home_ip = self._ip
        logger.info("Captured %s return pose: %s", "massage session start" if refresh else "connection", pose)

    def _upload_home_pose(self, expected_stop_generation: Optional[int] = None) -> Dict[str, Any]:
        if self._home_pose is None:
            return {"ok": False, "error": "Robot return pose has not been captured"}
        generation = self._stop_generation if expected_stop_generation is None else expected_stop_generation
        for mode, values in ((CMD_HOME_XYZ, self._home_pose[:3]),
                             (CMD_HOME_ROTATION, self._home_pose[3:])):
            result = self.send_mode(mode, duration_s=-1, force_x10=0,
                                    home_values=values, expected_stop_generation=generation)
            if not result.get("ok"):
                return result
            if (result.get("urscript") or {}).get("current_mode") != mode:
                return {"ok": False, "error": "Host does not support the return pose; load the updated ur10e_demo_smooth_27.urs"}
        return result

    def _neutralize_motion_on_connect(self) -> Dict[str, Any]:
        """Confirm a non-travelling STOP before sending startup home payloads."""
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        try:
            urs = self.read_urscript_registers()
            current_host = bool((urs.get("diagnostics") or {}).get("available"))
            # The current host reserves -2 for connection neutralization that
            # preserves a fault. Legacy hosts only understand -1 as no-travel.
            stop_duration = -2 if current_host else -1
            seq = self._next_seq()
            for register, value in ((IN_SPEED_X100, self._speed_scale_x100),
                                    (IN_FORCE_X10, 0), (IN_DURATION_S, stop_duration),
                                    (IN_CMD, 0), (IN_CMD_SEQ, seq)):
                self._write_int_register(register, int(value))
            logger.info("connect: sent startup STOP neutralization seq=%d", seq)
            return self._wait_for_stop_ack(seq, 0.4, allow_latched_fault=current_host)
        except Exception:
            logger.warning("connect: failed to send startup STOP neutralization", exc_info=True)
            return {"ok": False, "error": "Startup STOP failed"}

    def _resync_sequence_from_robot(self) -> None:
        """Choose a new command sequence that cannot equal the host's last ACK.

        The PolyScope host program only treats a command as new when its sequence
        differs from the last one it processed.  A backend restart used to reset
        ``_seq`` to zero and could repeat the host's sequence, leaving its safety
        arming STOP unseen and making the next Start a no-op.
        """
        urs = self.read_urscript_registers()
        if not urs.get("ok"):
            return
        try:
            ack = int(urs["ack_seq"])
        except (KeyError, TypeError, ValueError):
            return
        with self._lock:
            self._seq = ack % 2_000_000_000
        logger.info("connect: command sequence synchronized to host ACK %d", ack)

    def _rtde_receive_variables(self) -> List[str]:
        # Include output registers so ack/state reads work on RTDE builds that require
        # explicit recipes. Keep this small and focused.
        return [
            "actual_TCP_pose",
            "actual_TCP_force",
            "speed_scaling",
            f"output_int_register_{OUT_STATE}",
            f"output_int_register_{OUT_ERROR_CODE}",
            f"output_int_register_{OUT_CURRENT_MODE}",
            f"output_int_register_{OUT_PROGRESS}",
            f"output_int_register_{OUT_ACK_SEQ}",
            f"output_int_register_{OUT_CAL_STATUS}",
            f"output_int_register_{OUT_FAULT_REASON}",
            f"output_int_register_{OUT_FAULT_ACTION}",
            *[f"output_double_register_{index}" for index in (*OUT_FAULT_FLOATS, OUT_DIAGNOSTICS_VERSION)],
        ]

    def _create_rtde_receive(self, rtde_receive_cls, ip: str):
        """Create RTDEReceiveInterface with a custom recipe when supported."""
        variables = self._rtde_receive_variables()
        try:
            return rtde_receive_cls(ip, self.rtde_frequency_hz, variables=variables)
        except TypeError:
            pass
        # Avoid silent misbinding of "variables" to "verbose" by only trying
        # signatures with >3 positional args.
        for args in (
            (ip, self.rtde_frequency_hz, variables, False, False),
            (ip, self.rtde_frequency_hz, variables, False),
        ):
            try:
                return rtde_receive_cls(*args)
            except TypeError:
                continue
        return rtde_receive_cls(ip, self.rtde_frequency_hz)

    def disconnect(self) -> None:
        self._stop_evt.set()
        with self._connection_lock:
            if self._telemetry_thread:
                self._telemetry_thread.join(timeout=1.0)
                self._telemetry_thread = None
            if self._heartbeat_thread:
                self._heartbeat_thread.join(timeout=1.0)
                self._heartbeat_thread = None
            self._reset_connections()

    # --------------------------
    # Telemetry
    # --------------------------
    def _mark_error(self, message: str) -> None:
        self._last_error = message
        self._last_error_ts = time.time()

    def _clear_error(self) -> None:
        self._last_error = None
        self._last_error_ts = None

    def _reset_connections(self) -> None:
        with self._send_mode_lock:
            # Operations begun on the old transport must never publish a
            # late Start/Resume through a replacement connection.
            self._stop_generation += 1
            interfaces = [(name, getattr(self, name, None)) for name in ("rtde_io", "rtde_r")]
            self.rtde_r = None
            self.rtde_io = None
            self.dashboard = None
            self.connected = False
            self.neutralized_connection_id = None
        for obj_name, obj in interfaces:
            if obj:
                try:
                    if hasattr(obj, "disconnect"):
                        obj.disconnect()
                except Exception:
                    logger.exception("Failed to disconnect %s during reset", obj_name)
        with self._lock:
            self._latest = {}

    def _maybe_reconnect(self) -> None:
        # Explicit connection changes take precedence over background recovery.
        if not self._connection_lock.acquire(blocking=False):
            return
        try:
            self._reconnect()
        finally:
            self._connection_lock.release()

    def _reconnect(self) -> None:
        if not self._ip or self._stop_evt.is_set():
            return
        now = time.time()
        if now - self._last_reconnect_attempt < self._reconnect_backoff_s:
            return
        self._last_reconnect_attempt = now
        # Native RTDE connect can hold the GIL for minutes against a lost robot,
        # freezing HTTP and speech even when called from the telemetry thread.
        try:
            with socket.create_connection((self._ip, 30004), timeout=1.0):
                pass
        except OSError as exc:
            self._mark_error(f"reconnect probe failed: {exc}")
            return
        if self._stop_evt.is_set():
            return
        try:
            from rtde_receive import RTDEReceiveInterface as RTDEReceive
            from rtde_io import RTDEIOInterface as RTDEIO
        except Exception as exc:
            self._mark_error(f"ur-rtde not available: {exc}")
            return

        logger.warning("RTDE reconnect attempt to %s", self._ip)
        try:
            self._reset_connections()
            self.rtde_r = self._create_rtde_receive(RTDEReceive, self._ip)
            self.rtde_io = RTDEIO(self._ip)
            self.dashboard = DashboardClient(self._ip, timeout=self.dashboard_timeout)
            if self._stop_evt.is_set():
                self._reset_connections()
                return
            self._start_heartbeat()
            self._resync_sequence_from_robot()
            neutralized = self._neutralize_motion_on_connect()
            if neutralized.get("ok") and not neutralized.get("return_home_pending") and not neutralized.get("safety_fault_latched"):
                self._capture_home_pose()
                self._upload_home_pose()
            if self._stop_evt.is_set():
                self._reset_connections()
                return
            self.connected = True
            self.connection_id += 1
            self.neutralized_connection_id = self.connection_id if neutralized.get("ok") and not neutralized.get("return_home_pending") else None
            self._clear_error()
        except Exception as exc:
            self._reset_connections()
            self._mark_error(f"reconnect failed: {exc}")

    @staticmethod
    def _rotvec_to_rpy(rx: float, ry: float, rz: float) -> Tuple[float, float, float]:
        import math

        angle = math.sqrt(rx * rx + ry * ry + rz * rz)
        if angle < 1e-9:
            return 0.0, 0.0, 0.0
        ux, uy, uz = rx / angle, ry / angle, rz / angle
        c = math.cos(angle)
        s = math.sin(angle)
        t = 1.0 - c

        r00 = t * ux * ux + c
        r01 = t * ux * uy - s * uz
        r02 = t * ux * uz + s * uy
        r10 = t * ux * uy + s * uz
        r11 = t * uy * uy + c
        r12 = t * uy * uz - s * ux
        r20 = t * ux * uz - s * uy
        r21 = t * uy * uz + s * ux
        r22 = t * uz * uz + c

        roll = math.atan2(r21, r22)
        pitch = math.atan2(-r20, math.sqrt(r21 * r21 + r22 * r22))
        yaw = math.atan2(r10, r00)
        return roll, pitch, yaw

    def _telemetry_loop(self, stop_evt=None) -> None:
        stop_evt = stop_evt or self._stop_evt
        interval = 1.0 / float(self.telemetry_hz)
        dashboard_poll_s = max(0.5, float(os.getenv("UR10E_DASHBOARD_POLL_S", "1.0")))
        last_dashboard_poll = 0.0
        dashboard_snapshot = {"program_state": None, "robot_mode": None, "safety_status": None}
        while not stop_evt.is_set():
            t0 = time.time()
            try:
                if not self.rtde_r:
                    self._mark_error("rtde_receive not connected")
                    self.connected = False
                    self._maybe_reconnect()
                    time.sleep(interval)
                    continue
                if not self.connected:
                    self._maybe_reconnect()
                    continue

                for interface in (self.rtde_r, self.rtde_io):
                    if interface is None or (hasattr(interface, "isConnected") and not interface.isConnected()):
                        raise ConnectionError("RTDE transport disconnected")

                tcp = self.rtde_r.getActualTCPPose()          # [x,y,z,Rx,Ry,Rz]
                ft = self.rtde_r.getActualTCPForce()          # [Fx,Fy,Fz,Tx,Ty,Tz]
                speed_scaling = None
                try:
                    speed_scaling = float(self.rtde_r.getSpeedScaling())
                except Exception:
                    speed_scaling = None

                now = time.time()
                if self.dashboard and (now - last_dashboard_poll >= dashboard_poll_s):
                    dashboard_snapshot = {
                        "program_state": self.dashboard.program_state(),
                        "robot_mode": self.dashboard.robot_mode(),
                        "safety_status": self.dashboard.safety_status(),
                    }
                    last_dashboard_poll = now
                prog_state = dashboard_snapshot.get("program_state")
                robot_mode = dashboard_snapshot.get("robot_mode")
                safety = dashboard_snapshot.get("safety_status")
                tcp_vals = [float(x) for x in tcp]
                ft_vals = [float(x) for x in ft]
                if len(tcp_vals) < 6 or len(ft_vals) < 6:
                    raise ValueError("Unexpected RTDE pose/force vector length")

                tel = Telemetry(
                    ts=time.time(),
                    tcp_m=(tcp_vals[0], tcp_vals[1], tcp_vals[2], tcp_vals[3], tcp_vals[4], tcp_vals[5]),
                    ft=(ft_vals[0], ft_vals[1], ft_vals[2], ft_vals[3], ft_vals[4], ft_vals[5]),
                    speed_scaling=speed_scaling,
                    program_state=prog_state,
                    robot_mode=robot_mode,
                    safety_status=safety,
                )

                # Also store URScript register state if available (helpful for UI status)
                urs = self.read_urscript_registers()

                if stop_evt.is_set():
                    return

                self._record_safety_fault(tel, urs)
                with self._lock:
                    self._latest = {
                        "telemetry": tel,
                        "urscript": urs,
                        "rtde_connected": True,
                        "error": None,
                    }
                self._clear_error()
            except Exception:
                if stop_evt.is_set():
                    return
                logger.exception("Telemetry loop error")
                self._mark_error("telemetry loop error")
                self.connected = False
                with self._lock:
                    self._latest["rtde_connected"] = False
                    self._latest["error"] = self._last_error
                self._maybe_reconnect()
            finally:
                dt = time.time() - t0
                sleep_s = max(0.0, interval - dt)
                stop_evt.wait(timeout=sleep_s)

    @staticmethod
    def _measurement_error(tel: Optional[Telemetry]) -> Optional[Dict[str, Any]]:
        """Shared read-only diagnostics for motion preflight and the UI."""
        if tel is None or not math.isfinite(tel.ts) or not 0 <= time.time() - tel.ts <= 2.0:
            return {
                "code": "STALE_TELEMETRY",
                "error": "Fresh robot telemetry is required before motion",
                "hint": "Check the robot connection. Start and Resume are blocked until fresh readings return.",
            }
        if FORCE_CHECK_ENABLED and (len(tel.ft) != 6 or not all(math.isfinite(value) for value in tel.ft)):
            return {
                "code": "INVALID_FORCE",
                "error": "Robot force/torque readings are invalid; motion is blocked",
                "invalid_components": [name for name, value in zip(("Fx", "Fy", "Fz", "Tx", "Ty", "Tz"), tel.ft)
                                       if not math.isfinite(value)],
                "hint": "Check the force sensor and tool configuration in PolyScope before retrying.",
            }
        if len(tel.tcp_m) != 6 or not all(math.isfinite(value) for value in tel.tcp_m):
            return {
                "code": "INVALID_POSE",
                "error": "Robot TCP pose is invalid; motion is blocked",
                "hint": "Check the pendant. Start and Resume are blocked until valid position readings return.",
            }
        if not FORCE_CHECK_ENABLED:
            return None
        magnitude = math.hypot(*tel.ft[:3])
        if magnitude > FORCE_HARD_LIMIT_N:
            return {
                "code": "FORCE_LIMIT_EXCEEDED",
                "error": f"Measured robot force {magnitude:.1f} N exceeds the {FORCE_HARD_LIMIT_N:g} N limit; motion is blocked",
                "force_magnitude_n": magnitude if math.isfinite(magnitude) else None,
                "hint": "Remove unexpected contact and check grip, TCP, and payload settings on the pendant before retrying.",
            }
        return None

    def _record_safety_fault(self, tel: Telemetry, urs: Dict[str, Any]) -> None:
        """Log each latched fault once, retaining its evidence after Stop/reconnect."""
        if not urs.get("ok"):
            return
        if urs.get("error_code") not in SAFETY_FAULT_CODES:
            self._last_fault_key = None
            return
        key = (self.connection_id, urs.get("ack_seq"), urs.get("error_code"))
        diagnostics = urs.get("diagnostics") or {}
        captured = diagnostics.get("fault")
        key += (bool(captured),)
        if key == self._last_fault_key:
            return
        finite = lambda value: value if math.isfinite(value) else None
        record = {
            "observed_at": tel.ts, "robot_ip": self._ip,
            "ack_seq": urs.get("ack_seq"), "error_code": urs.get("error_code"),
            "controller_captured": bool(captured), "fault": captured,
            # Observations after release are explicitly distinct from the trigger.
            "observed_force_n": [finite(value) for value in tel.ft[:3]],
            "observed_tcp_xyz_m": [finite(value) for value in tel.tcp_m[:3]],
        }
        with self._lock:
            self._last_fault = record
        self._last_fault_key = key
        logger.error("Robot safety fault: %s", json.dumps(record, allow_nan=False))

    def get_telemetry(self) -> Dict[str, Any]:
        """UI-friendly dict (safe to JSON serialize)."""
        with self._lock:
            tel: Optional[Telemetry] = self._latest.get("telemetry")
            urs: Dict[str, Any] = self._latest.get("urscript") or {}
            last_error = self._latest.get("error") or self._last_error
            rtde_connected = self.connected and bool(self._latest.get("rtde_connected", False))
        measurement_error = self._measurement_error(tel)

        if not tel:
            return {
                "ok": False,
                "error": last_error or "no telemetry yet",
                "rtde_connected": rtde_connected,
                "measurement_error": measurement_error,
                "ts": time.time(),
            }

        tcp = tel.tcp_m
        # RTDE can report unavailable measurements as NaN/Infinity. JSON APIs
        # must expose those as null, not fail the connection status request.
        # Reject invalid poses before the trigonometric conversion as well.
        if not all(math.isfinite(value) for value in tcp):
            return {
                "ok": False,
                "error": "RTDE TCP pose contains non-finite values",
                "rtde_connected": rtde_connected,
                "measurement_error": measurement_error,
                "ts": time.time(),
            }
        ft = tuple(value if math.isfinite(value) else None for value in tel.ft)
        speed_scaling = tel.speed_scaling
        if speed_scaling is not None and not math.isfinite(speed_scaling):
            speed_scaling = None
        roll, pitch, yaw = self._rotvec_to_rpy(tcp[3], tcp[4], tcp[5])
        return {
            "ok": True,
            "ts": tel.ts,
            "rtde_connected": rtde_connected,
            "error": last_error,
            "measurement_error": measurement_error,
            "tcp": {
                "x_m": tcp[0], "y_m": tcp[1], "z_m": tcp[2],
                "rx_rad": tcp[3], "ry_rad": tcp[4], "rz_rad": tcp[5],
                "rpy_rad": {"roll": roll, "pitch": pitch, "yaw": yaw},
                "rpy_deg": {
                    "roll": roll * 57.2957795,
                    "pitch": pitch * 57.2957795,
                    "yaw": yaw * 57.2957795,
                },
                "x_mm": tcp[0] * 1000.0, "y_mm": tcp[1] * 1000.0, "z_mm": tcp[2] * 1000.0,
            },
            "ft": {
                "fx_n": ft[0], "fy_n": ft[1], "fz_n": ft[2],
                "tx_nm": ft[3], "ty_nm": ft[4], "tz_nm": ft[5],
            },
            "speed_scaling": speed_scaling,
            "program_state": tel.program_state,
            "robot_mode": tel.robot_mode,
            "safety_status": tel.safety_status,
            "urscript": urs,
            "last_fault": self._last_fault,
        }

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Compatibility snapshot for UI state payload."""
        tel = self.get_telemetry()
        if not tel.get("ok"):
            return {"ok": False, "error": tel.get("error"), "measurement_error": tel.get("measurement_error")}
        return {
            "measurement_error": tel.get("measurement_error"),
            "actual_TCP_pose": [
                tel["tcp"]["x_m"],
                tel["tcp"]["y_m"],
                tel["tcp"]["z_m"],
                tel["tcp"]["rx_rad"],
                tel["tcp"]["ry_rad"],
                tel["tcp"]["rz_rad"],
            ],
            "actual_TCP_force": [
                tel["ft"]["fx_n"],
                tel["ft"]["fy_n"],
                tel["ft"]["fz_n"],
                tel["ft"]["tx_nm"],
                tel["ft"]["ty_nm"],
                tel["ft"]["tz_nm"],
            ],
            "speed_scaling": tel.get("speed_scaling"),
            "program_state": tel.get("program_state"),
            "robot_mode": tel.get("robot_mode"),
            "safety_status": tel.get("safety_status"),
            "urscript_state": {
                "state": tel.get("urscript", {}).get("state"),
                "error_code": tel.get("urscript", {}).get("error_code"),
                "current_mode": tel.get("urscript", {}).get("current_mode"),
                "progress": tel.get("urscript", {}).get("progress"),
                "ack_seq": tel.get("urscript", {}).get("ack_seq"),
                "calibration_status": tel.get("urscript", {}).get("cal_status"),
                "diagnostics": tel.get("urscript", {}).get("diagnostics"),
            },
            "last_fault": tel.get("last_fault"),
            "rtde_connected": tel.get("rtde_connected"),
        }

    # --------------------------
    # URScript register state (read-only)
    # --------------------------
    def read_urscript_registers(self) -> Dict[str, Any]:
        # NOTE: Output registers must be read via RTDEReceiveInterface (rtde_r),
        # not RTDEIOInterface (rtde_io) which only supports writing input registers
        if not self.rtde_r:
            logger.warning("read_urscript_registers: rtde_r not connected")
            return {"ok": False, "error": "rtde_r not connected"}
        try:
            # Read output integers written by .urs using rtde_r (RTDEReceiveInterface)
            ack_before = int(self.rtde_r.getOutputIntRegister(OUT_ACK_SEQ))
            state = int(self.rtde_r.getOutputIntRegister(OUT_STATE))
            error_code = int(self.rtde_r.getOutputIntRegister(OUT_ERROR_CODE))
            current_mode = int(self.rtde_r.getOutputIntRegister(OUT_CURRENT_MODE))
            progress = int(self.rtde_r.getOutputIntRegister(OUT_PROGRESS))
            cal_status = int(self.rtde_r.getOutputIntRegister(OUT_CAL_STATUS))
            diagnostics = self._read_fault_diagnostics()
            ack_seq = int(self.rtde_r.getOutputIntRegister(OUT_ACK_SEQ))
            if ack_before != ack_seq:
                return {"ok": False, "error": "Robot register snapshot changed while reading"}
            self._last_ack_seq = ack_seq
            logger.debug("read_urscript_registers: state=%d, ack_seq=%d", state, ack_seq)
            return {
                "ok": True,
                "state": state,
                "error_code": error_code,
                "current_mode": current_mode,
                "progress": progress,
                "ack_seq": ack_seq,
                "cal_status": cal_status,
                "diagnostics": diagnostics,
            }
        except Exception as e:
            logger.error("read_urscript_registers FAILED: %s", e)
            return {"ok": False, "error": str(e)}

    def _read_fault_diagnostics(self) -> Dict[str, Any]:
        """Older hosts remain stoppable; motion requires the matching new host."""
        unavailable = {"available": False, "required_version": DIAGNOSTICS_VERSION}
        try:
            version = float(self.rtde_r.getOutputDoubleRegister(OUT_DIAGNOSTICS_VERSION))
            if version != DIAGNOSTICS_VERSION:
                return unavailable
            marker = int(self.rtde_r.getOutputIntRegister(OUT_FAULT_REASON))
            result = {"available": True, "version": DIAGNOSTICS_VERSION, "fault": None}
            if marker == 0:
                return result
            reason, invalid_mask = marker % 10, marker // 10
            action = int(self.rtde_r.getOutputIntRegister(OUT_FAULT_ACTION))
            values = [float(self.rtde_r.getOutputDoubleRegister(index)) for index in OUT_FAULT_FLOATS]
            marker_after = int(self.rtde_r.getOutputIntRegister(OUT_FAULT_REASON))
            if marker != marker_after or reason not in FAULT_REASON_TEXT or action not in FAULT_ACTION_TEXT or not 0 <= invalid_mask <= 7:
                return {**result, "pending": True}
            force = [value if math.isfinite(value) and not invalid_mask & (1 << index) else None
                     for index, value in enumerate(values[:3])]
            magnitude = math.hypot(*force) if all(value is not None for value in force) else None
            result["fault"] = {
                "reason": FAULT_REASON_TEXT[reason], "action": FAULT_ACTION_TEXT[action],
                "force_n": force, "force_magnitude_n": magnitude if magnitude is not None and math.isfinite(magnitude) else None,
                "invalid_components": [axis for axis, value in zip(("Fx", "Fy", "Fz"), force) if value is None],
                "limit_n": FORCE_HARD_LIMIT_N,
                "session_elapsed_s": values[3] if math.isfinite(values[3]) else None,
                "tcp_xyz_m": [value if math.isfinite(value) else None for value in values[4:]],
            }
            return result
        except (AttributeError, TypeError, ValueError, RuntimeError):
            return unavailable

    def _latest_tcp_pose_m(self) -> Optional[Tuple[float, float, float, float, float, float]]:
        # Saving calibration must sample the current RTDE pose, not a cached
        # pose from before the operator moved the tool.
        if self.rtde_r:
            try:
                pose = self.rtde_r.getActualTCPPose()
                pose_vals = [float(x) for x in pose]
                if len(pose_vals) != 6 or not all(math.isfinite(x) for x in pose_vals):
                    return None
                return (pose_vals[0], pose_vals[1], pose_vals[2], pose_vals[3], pose_vals[4], pose_vals[5])
            except Exception:
                return None
        return None

    @staticmethod
    def _xyz_mm_from_pose(pose: Optional[Tuple[float, ...]]) -> Optional[List[float]]:
        if not pose or len(pose) < 3:
            return None
        return [pose[0] * 1000.0, pose[1] * 1000.0, pose[2] * 1000.0]

    def _load_calibration_from_file(self) -> Optional[Dict[str, Any]]:
        if not CALIBRATION_FILE.exists():
            return None
        try:
            with CALIBRATION_FILE.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                raise ValueError("Calibration must be an object")
            for key in ("point_a_pose", "point_b_pose"):
                pose = data.get(key)
                if pose is not None and (not isinstance(pose, list) or len(pose) != 6
                                         or any(isinstance(x, bool) or not isinstance(x, (int, float))
                                                or not math.isfinite(x) for x in pose)):
                    raise ValueError(f"Invalid calibration pose: {key}")
            return data
        except Exception as exc:
            logger.warning("Failed to load calibration file: %s", exc)
            return None

    def _save_calibration_to_file(self) -> bool:
        if not self._cal_point_a_pose and not self._cal_point_b_pose:
            return False
        data = {
            "saved_at": time.time(),
            "point_a_pose": self._cal_point_a_pose,
            "point_b_pose": self._cal_point_b_pose,
        }
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=CALIBRATION_FILE.parent,
                                             delete=False) as fh:
                temporary_path = fh.name
                json.dump(data, fh, allow_nan=False)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(temporary_path, CALIBRATION_FILE)
            return True
        except Exception as exc:
            if 'temporary_path' in locals():
                Path(temporary_path).unlink(missing_ok=True)
            logger.warning("Failed to save calibration file: %s", exc)
            return False

    @staticmethod
    def _calibration_status_to_text(status: Optional[int]) -> str:
        mapping = {
            0: "none",
            1: "A_set",
            2: "B_set",
            3: "valid",
            -1: "invalid",
        }
        return mapping.get(int(status) if status is not None else 0, "unknown")

    def _wait_for_calibration_update(self, mode_id: int, timeout_s: float = 1.0) -> Dict[str, Any]:
        """Wait for URScript to finish a calibration command and update status."""
        t_end = time.time() + float(timeout_s)
        last = None
        while time.time() < t_end:
            cal = self.read_urscript_registers()
            if cal.get("ok"):
                last = cal
                if int(cal.get("current_mode", -1)) == int(mode_id) and int(cal.get("progress", -1)) == 100:
                    return cal
            time.sleep(0.05)
        return {"ok": False, "error": "timeout waiting for calibration update", "urscript": last}

    def _clear_input_command(self) -> None:
        """Clear the IN_CMD register to avoid replaying one-shot commands after restart."""
        if not self.rtde_io:
            return
        try:
            self.rtde_io.setInputIntRegister(IN_CMD, 0)
        except Exception:
            logger.warning("Failed to clear IN_CMD register", exc_info=True)

    def _set_speed_slider(self, value: float) -> None:
        """Best-effort speed slider override (0.0 = stop, 1.0 = normal)."""
        if not self.rtde_io or not hasattr(self.rtde_io, "setSpeedSlider"):
            return
        try:
            self.rtde_io.setSpeedSlider(float(value))
            self._speed_slider = float(value)
        except Exception:
            logger.warning("Failed to set speed slider", exc_info=True)

    def _restore_speed_slider(self) -> None:
        self._set_speed_slider(1.0)

    def _write_force_enable(self, enabled: bool) -> None:
        if not self.rtde_io or not self._force_enable_supported:
            return
        try:
            self._write_int_register(IN_FORCE_ENABLE, 1 if enabled else 0)
        except Exception as exc:
            self._force_enable_supported = False
            logger.info("IN_FORCE_ENABLE unsupported (%s); using signed IN_FORCE_X10 encoding", exc)

    def _write_int_register(self, register: int, value: int) -> None:
        if self.rtde_io.setInputIntRegister(register, value) is False:
            raise RuntimeError(f"RTDE input register {register} write failed")

    def _ensure_speed_slider_for_motion(self, mode: int) -> None:
        # Avoid restoring speed slider on pause; restore for any motion-related command.
        if int(mode) not in (0, 5, CMD_HOME_XYZ, CMD_HOME_ROTATION):
            self._restore_speed_slider()

    def _motion_preflight(self) -> Dict[str, Any]:
        """Return a clear, fail-closed explanation when the robot cannot move."""
        if not self.rtde_io or not self.connected:
            return {"ok": False, "error": "RTDE is not connected"}

        dashboard = ({"ok": True, "programState": self.dashboard.program_state(),
                      "safetystatus": self.dashboard.safety_status()} if self.dashboard
                     else {"ok": False, "error": "dashboard not connected"})
        if not dashboard.get("ok"):
            return {
                "ok": False,
                "error": "Unable to read PolyScope safety state",
                "dashboard": dashboard,
            }

        safety = str(dashboard.get("safetystatus") or "").upper()
        program_state = str(dashboard.get("programState") or "").upper()
        if any(token in safety for token in (
            "EMERGENCY_STOP",
            "PROTECTIVE_STOP",
            "SAFEGUARD_STOP",
            "SYSTEM_EMERGENCY_STOP",
            "FAULT",
            "VIOLATION",
        )):
            return {
                "ok": False,
                "error": "Robot safety stop is active",
                "hint": "Release the physical emergency stop, clear the safety popup, power on, and release brakes in PolyScope.",
                "dashboard": dashboard,
            }
        if "PLAYING" not in program_state:
            return {
                "ok": False,
                "error": "PolyScope host program is not PLAYING",
                "hint": "Load the massage host program and press Play in PolyScope before starting massage.",
                "dashboard": dashboard,
            }
        if safety.replace("SAFETYSTATUS:", "", 1).strip() not in ("NORMAL", "REDUCED"):
            return {"ok": False, "error": "Robot safety state is unavailable or not ready", "dashboard": dashboard}
        with self._lock:
            telemetry = self._latest.get("telemetry")
        measurement_error = self._measurement_error(telemetry)
        if measurement_error:
            return {"ok": False, **measurement_error, "dashboard": dashboard}
        urs = self.read_urscript_registers()
        if not urs.get("ok"):
            return {"ok": False, "error": "Fresh controller register feedback is required before motion"}
        if urs.get("error_code") in SAFETY_FAULT_CODES:
            return {"ok": False, "code": "LATCHED_SAFETY_FAULT",
                    "error": f"Robot safety fault remains latched: {UR_SCRIPT_ERROR_TEXT[urs['error_code']]}",
                    "hint": "Resolve the cause on the pendant, then press Stop to acknowledge it before a new Start.",
                    "urscript": urs}
        if not (urs.get("diagnostics") or {}).get("available"):
            return {"ok": False, "code": "HOST_UPDATE_REQUIRED",
                    "error": "Load the updated robot/ur10e_demo_smooth_27.urs on the pendant before starting",
                    "hint": "Restart the backend and reload the updated script in the pendant program, then press Play.",
                    "urscript": urs}
        return {"ok": True, "dashboard": dashboard}

    def _arm_host_program(self, expected_stop_generation: Optional[int] = None,
                          refresh_home: bool = False) -> Dict[str, Any]:
        """Arm through a stationary STOP that cannot acknowledge a safety fault."""
        urs = self.read_urscript_registers()
        if urs.get("state") == STATE_RETURNING_HOME:
            return {"ok": False, "error": "Robot is returning home; wait until it is idle"}
        result = self.send_mode(
            0,
            speed_x100=100,
            force_x10=0,
            duration_s=-2,
            force_enable=False,
            wait_ack=True,
            expected_stop_generation=expected_stop_generation,
        )
        if not result.get("ok"):
            result.setdefault("error", "Unable to arm the PolyScope host program")
            result.setdefault(
                "hint",
                "Confirm the correct host program is PLAYING and its RTDE register map matches this middleware.",
            )
        if result.get("ok"):
            if (result.get("urscript") or {}).get("state") != 0:
                return {"ok": False, "seq": result.get("seq"), "error": "Arming Stop did not confirm an idle robot"}
            try:
                self._capture_home_pose(refresh=refresh_home)
            except Exception as exc:
                return {"ok": False, "error": f"Unable to capture robot return pose: {exc}"}
            return self._upload_home_pose(expected_stop_generation)
        return result

    def _hard_stop_rtde_control(self) -> None:
        """Optional hard stop via RTDEControlInterface (may be blocked in Local mode)."""
        if os.getenv("UR10E_HARD_STOP_ENABLE", "0").strip() not in ("1", "true", "yes"):
            return
        try:
            from rtde_control import RTDEControlInterface as RTDEControl
        except Exception:
            return
        if not self._ip:
            return
        try:
            ctrl = RTDEControl(self._ip)
            try:
                ctrl.speedStop(0.5)
                ctrl.stopJ(2.0)
            finally:
                if hasattr(ctrl, "disconnect"):
                    ctrl.disconnect()
        except Exception:
            logger.warning("RTDEControl stop failed (likely Local mode)", exc_info=True)

    # --------------------------
    # Command sending (UI -> UR)
    # --------------------------
    def _next_seq(self) -> int:
        with self._lock:
            self._seq = (self._seq + 1) % 2_000_000_000
            return self._seq

    @staticmethod
    def _resolve_mode_id(mode: Optional[str]) -> Optional[int]:
        if mode is None:
            return None
        if isinstance(mode, int):
            return mode
        if isinstance(mode, str):
            m = mode.strip().lower()
            if not m:
                return None
            if m.isdigit():
                return int(m)
            mapping = {
                "向上推": 1,
                "波浪推": 2,
                "螺旋按": 3,
                "揉捏": 4,
                "push_up": 1,
                "wave_push": 2,
                "spiral_press": 3,
                "knead": 4,
                "stroking": 1,
                "kneading": 2,
                "tapping": 3,
                "vibration": 4,
                "pause": 5,
                "resume": 6,
                "stop": 0,
            }
            if m in mapping:
                return mapping[m]
        return None

    @staticmethod
    def _resolve_force_x10(intensity: Optional[str]) -> int:
        mapping = {
            "輕": 60,
            "小": 60,
            "輕柔": 60,
            "low": 60,
            "中": 80,
            "medium": 80,
            "適中": 80,
            "大": 100,
            "重": 100,
            "強力": 100,
            "high": 100,
        }
        force = mapping.get((intensity or "").strip(), 80)
        return max(30, min(150, int(force)))

    @staticmethod
    def _resolve_duration_s(duration: Optional[int]) -> int:
        if duration is None:
            return 0
        try:
            dur = int(duration)
        except Exception:
            return 0
        return max(0, dur)

    def send_mode(
        self,
        mode: int,
        speed_x100: int = 100,
        force_x10: int = 35,
        duration_s: int = 10,
        force_enable: bool = False,
        wait_ack: bool = True,
        ack_timeout_s: float = 2.0,
        expected_stop_generation: Optional[int] = None,
        home_values: Optional[List[float]] = None,
    ) -> Dict[str, Any]:
        """
        Send a mode request via RTDE registers.
        mode:
          0 stop
          1..4 massage modes (per your URScript)
          5 pause
          6 resume
          20 set point A (cal)
          21 set point B (cal)
          22 save calibration (optional, depends on your .urs)
        """
        logger.info("send_mode: mode=%d, speed=%d, force=%d, dur=%d, force_enable=%s, wait_ack=%s",
                    mode, speed_x100, force_x10, duration_s, force_enable, wait_ack)
        if not self.rtde_io:
            logger.error("send_mode: rtde_io not connected!")
            return {"ok": False, "error": "rtde_io not connected"}
        requested_mode = int(mode)
        generation = self._stop_generation if expected_stop_generation is None else expected_stop_generation
        force_mode4_only = os.getenv("UR10E_FORCE_MODE4_ONLY", "0").lower() in ("1", "true", "yes", "on")
        effective_mode = 4 if force_mode4_only and requested_mode in (1, 2, 3, 4) else requested_mode
        if effective_mode != requested_mode:
            logger.info("send_mode: UR10E_FORCE_MODE4_ONLY remapped requested mode %d -> %d", requested_mode, effective_mode)
        with self._send_mode_lock:
            if generation != self._stop_generation:
                return {"ok": False, "error": "Command cancelled by Stop"}
            urs = self.read_urscript_registers()
            if (urs.get("ok") and urs.get("state") == STATE_RETURNING_HOME
                    and effective_mode not in (0, 5)):
                return {"ok": False, "error": "Robot is returning home; wait until it is idle"}
            # Preserve the pendant's speed slider; a network command must not
            # silently raise an operator's reduced speed to 100 percent.
            seq = self._next_seq()
            logger.info("send_mode: generated seq=%d", seq)

            try:
                # Publish each home half before its command sequence.
                if home_values is not None:
                    for register, value in zip(IN_HOME_REGISTERS, home_values):
                        if self.rtde_io.setInputDoubleRegister(register, float(value)) is False:
                            raise RuntimeError("Home pose register write failed")
                # Write command registers
                logger.info("send_mode: Writing registers IN_CMD=%d, IN_CMD_SEQ=%d", IN_CMD, IN_CMD_SEQ)
                self._write_force_enable(bool(force_enable))
                effective_force_x10 = -abs(int(force_x10)) if force_enable else 0
                logger.info("send_mode: effective_force_x10=%d", effective_force_x10)
                for register, value in ((IN_SPEED_X100, speed_x100), (IN_FORCE_X10, effective_force_x10),
                                        (IN_DURATION_S, duration_s), (IN_CMD, effective_mode), (IN_CMD_SEQ, seq)):
                    self._write_int_register(register, int(value))
                logger.info("send_mode: Registers written successfully")
            except Exception as e:
                logger.exception("send_mode: Failed to write registers")
                return {"ok": False, "seq": seq, "error": f"failed to write registers: {e}"}

        # Only register writes are serialized. Waiting here must never hold up STOP.
        if not wait_ack:
            return {"ok": True, "seq": seq, "note": "sent (no ack wait)"}

        logger.info("send_mode: Waiting for ACK (timeout=%ss)...", ack_timeout_s)
        t_end = time.monotonic() + float(ack_timeout_s)
        last_ack = None
        while time.monotonic() < t_end:
            if generation != self._stop_generation:
                return {"ok": False, "seq": seq, "error": "Command cancelled by Stop"}
            urs = self.read_urscript_registers()
            if urs.get("ok"):
                last_ack = urs.get("ack_seq")
                if last_ack is not None and int(last_ack) == int(seq):
                    logger.info("send_mode: ACK received! ack_seq=%d", last_ack)
                    error_code = int(urs.get("error_code", 0))
                    if error_code != 0:
                        return {
                            "ok": False,
                            "seq": seq,
                            "error": f"URScript rejected command: {UR_SCRIPT_ERROR_TEXT.get(error_code, f'error code {error_code}')}",
                            "urscript": urs,
                        }
                    return {"ok": True, "seq": seq, "urscript": urs}
            time.sleep(0.02)

        logger.warning("send_mode: ACK TIMEOUT! sent_seq=%d, last_ack=%s", seq, last_ack)
        dbg = self.get_dashboard_debug()
        if dbg.get("ok"):
            logger.warning("send_mode: Dashboard state on ACK timeout: %s", dbg)
        hint = None
        if dbg.get("programState") and "PLAYING" not in str(dbg.get("programState")).upper():
            hint = "PolyScope program not PLAYING; load and press Play on the URP host program."
        return {
            "ok": False,
            "seq": seq,
            "error": f"ack timeout (last_ack={last_ack})",
            "dashboard": dbg,
            "hint": hint,
            "urscript": self.read_urscript_registers(),
        }

    def start_massage(self, command: MassageCommand) -> Dict[str, Any]:
        generation = self._stop_generation
        mode_id = self._resolve_mode_id(command.mode)
        if mode_id not in (1, 2, 3, 4):
            return {"ok": False, "error": "unknown or missing mode"}
        duration_s = 300 if command.duration is None else self._resolve_duration_s(command.duration)
        if not 1 <= duration_s <= 1800:
            return {"ok": False, "error": "Duration must be between 1 and 1800 seconds"}
        preflight = self._motion_preflight()
        if not preflight.get("ok"):
            return preflight
        cal = self.read_urscript_registers()
        if cal.get("ok"):
            if cal.get("state") in (1, 2):
                return {"ok": False, "error": "A robot session is already running or paused; Stop it before a new Start"}
            cal_status = cal.get("cal_status")
            # Allow cal_status 0 (demo mode - no calibration) or 3 (fully calibrated)
            # ur10e_demo_smooth_27.urs outputs 0 because it doesn't use calibration
            if cal_status not in (0, 3):
                return {
                    "ok": False,
                    "error": "calibration not ready",
                    "calibration_status": cal_status,
                    "calibration_status_text": self._calibration_status_to_text(cal_status),
                }
        arm_result = self._arm_host_program(expected_stop_generation=generation, refresh_home=True)
        if not arm_result.get("ok"):
            return arm_result
        force_x10 = self._resolve_force_x10(command.intensity)
        force_enable = bool(getattr(command, "force_assist", False))
        if force_enable and not FORCE_CHECK_ENABLED:
            return {"ok": False, "error": "Force assist is unavailable while force checking is off"}
        return self.send_mode(
            mode_id,
            speed_x100=100,
            force_x10=force_x10,
            duration_s=duration_s,
            force_enable=force_enable,
            wait_ack=True,
            expected_stop_generation=generation,
        )

    def _wait_for_stop_ack(self, seq: int, timeout_s: float, allow_latched_fault: bool = False) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        urs = {}
        while True:
            urs = self.read_urscript_registers()
            if urs.get("ok") and int(urs.get("ack_seq", -1)) == seq:
                error_code = int(urs.get("error_code", 0))
                state = int(urs.get("state", -1))
                if allow_latched_fault and error_code in SAFETY_FAULT_CODES and state == 0:
                    return {"ok": True, "seq": seq, "urscript": urs,
                            "return_home_pending": False, "safety_fault_latched": True}
                if error_code != 0:
                    return {"ok": False, "seq": seq, "error": "Robot rejected stop", "urscript": urs}
                if state in (0, STATE_RETURNING_HOME):
                    return {"ok": True, "seq": seq, "urscript": urs,
                            "return_home_pending": state == STATE_RETURNING_HOME}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(0.02, remaining))
        return {"ok": False, "seq": seq, "urscript": urs,
                "error": "Robot stop was not confirmed. Retry Stop or use the pendant Stop button."}

    def stop_massage(self, return_home: bool = True) -> Dict[str, Any]:
        """Confirm STOP promptly; telemetry reports completion of its home return."""
        logger.info("stop_massage: Sending CMD=0 (soft stop)...")
        with self._send_mode_lock:
            self._stop_generation += 1
        urs = self.read_urscript_registers()
        # Safety faults require a stationary release, not recovery travel.
        if urs.get("error_code") in SAFETY_FAULT_CODES:
            return_home = False
        stop_duration = 0 if return_home else -1
        result = self.send_mode(0, speed_x100=100, force_x10=0, duration_s=stop_duration, force_enable=False, wait_ack=False)
        if not result.get("ok"):
            return result
        confirmed = self._wait_for_stop_ack(result["seq"], 0.4)
        if confirmed.get("ok"):
            return confirmed

        logger.warning("stop_massage: STOP not confirmed after 0.4 s; attempting fallback")
        self._hard_stop_rtde_control()
        # A future START/RESUME restores speed; do not raise the slider while
        # a STOP is unconfirmed. Retry with a fresh sequence and verify it too.
        result = self.send_mode(0, speed_x100=100, force_x10=0, duration_s=stop_duration, force_enable=False, wait_ack=False)
        if result.get("ok"):
            result = self._wait_for_stop_ack(result["seq"], 1.0)
        result["fallback_triggered"] = True
        return result

    def pause_massage(self) -> Dict[str, Any]:
        """
        Send CMD=5 (pause).
        URScript stops motion immediately but remembers the active mode.
        resume_massage() returns to the session Start pose before continuing.
        """
        logger.info("pause_massage: Sending CMD=5 (pause)...")
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        return self.send_mode(5, speed_x100=100, force_x10=0, duration_s=0, force_enable=False, wait_ack=True)

    def resume_massage(self) -> Dict[str, Any]:
        """
        Send CMD=6 (resume).
        URScript opens the gripper, returns to the session Start pose from above,
        then restarts the station sequence there.
        Returns an error if nothing was paused (URScript will ACK with STATE_IDLE).
        """
        generation = self._stop_generation
        logger.info("resume_massage: Sending CMD=6 (resume)...")
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        preflight = self._motion_preflight()
        if not preflight.get("ok"):
            return preflight
        result = self.send_mode(6, speed_x100=100, force_x10=0, duration_s=0, force_enable=False,
                                wait_ack=True, expected_stop_generation=generation)
        if result.get("ok"):
            urs = result.get("urscript") or {}
            if int(urs.get("state", 0)) != 1:  # STATE_RUNNING = 1
                result["ok"] = False
                result["error"] = "Robot did not resume; no paused massage is available"
        return result

    def adjust_speed(self, delta: float) -> Dict[str, Any]:
        return {"ok": False, "error": "The bundled demo does not support live speed commands; use the pendant speed slider"}

    def start_jog(self, direction: str, duration_s: Optional[float] = None) -> Dict[str, Any]:
        generation = self._stop_generation
        if direction not in ("z_up", "z_down"):
            return {"ok": False, "error": "Unknown jog direction"}
        preflight = self._motion_preflight()
        if not preflight.get("ok"):
            return preflight
        mode_id = CMD_JOG_Z_UP if direction == "z_up" else CMD_JOG_Z_DOWN
        duration_s = 1.0 if duration_s is None else float(duration_s)
        if not math.isfinite(duration_s) or not 0 < duration_s <= 3:
            return {"ok": False, "error": "Jog duration must be greater than 0 and at most 3 seconds"}
        result = self.send_mode(mode_id, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                expected_stop_generation=generation)
        if result.get("ok"):
            stop_at = time.monotonic() + duration_s
            while time.monotonic() < stop_at and generation == self._stop_generation:
                time.sleep(0.02)
            if generation == self._stop_generation:
                stopped = self.stop_massage(return_home=False)
                if not stopped.get("ok"):
                    return stopped
        return result

    def save_calibration_point_a(self) -> Dict[str, Any]:
        generation = self._stop_generation
        logger.info("save_calibration_point_a: Sending CMD_SAVE_POINT_A=%d", CMD_SAVE_POINT_A)
        dbg = self.get_dashboard_debug()
        if dbg.get("ok"):
            state = str(dbg.get("programState") or "").upper()
            if "PLAYING" not in state:
                return {
                    "ok": False,
                    "error": "PolyScope program not PLAYING; press Play before saving Point A.",
                    "dashboard": dbg,
                }
        # If a stale Point B exists, clear first to avoid invalid calibration.
        cal_before = self.read_urscript_registers()
        if cal_before.get("ok") and cal_before.get("cal_status") in (-1, 2, 3):
            logger.info("save_calibration_point_a: clearing stale calibration (status=%s)", cal_before.get("cal_status"))
            cleared = self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                     expected_stop_generation=generation)
            if not cleared.get("ok"):
                return cleared
        result = self.send_mode(CMD_SAVE_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                expected_stop_generation=generation)
        if not result.get("ok"):
            return result
        cal = self._wait_for_calibration_update(CMD_SAVE_POINT_A)
        if not cal.get("ok") or cal.get("cal_status") not in (1, 3):
            return {"ok": False, "error": cal.get("error") or "Host did not save Point A", "urscript": cal}
        logger.info("save_calibration_point_a: send_mode result=%s", result)
        pose = self._latest_tcp_pose_m()
        logger.info("save_calibration_point_a: latest_tcp_pose=%s", pose)
        if pose:
            self._cal_point_a_pose = list(pose)
            self._save_calibration_to_file()
            result["point_a_xyz"] = self._xyz_mm_from_pose(pose)
        logger.info("save_calibration_point_a: urscript_registers=%s", cal)
        if cal.get("ok"):
            result["calibration_status"] = cal.get("cal_status")
            result["calibration_status_text"] = self._calibration_status_to_text(result.get("calibration_status"))
        self._clear_input_command()
        return result

    def save_calibration_point_b(self) -> Dict[str, Any]:
        generation = self._stop_generation
        logger.info("save_calibration_point_b: Sending CMD_SAVE_POINT_B=%d", CMD_SAVE_POINT_B)
        dbg = self.get_dashboard_debug()
        if dbg.get("ok"):
            state = str(dbg.get("programState") or "").upper()
            if "PLAYING" not in state:
                return {
                    "ok": False,
                    "error": "PolyScope program not PLAYING; press Play before saving Point B.",
                    "dashboard": dbg,
                }

        # Pre-check: Verify robot has moved at least 50mm from Point A
        min_distance_m = 0.05  # 50mm
        pose_a = self._cal_point_a_pose
        if not pose_a:
            saved = self._load_calibration_from_file() or {}
            pose_a = saved.get("point_a_pose")

        current_pose = self._latest_tcp_pose_m()
        if pose_a and current_pose and len(pose_a) >= 3 and len(current_pose) >= 3:
            dx = pose_a[0] - current_pose[0]
            dy = pose_a[1] - current_pose[1]
            dz = pose_a[2] - current_pose[2]
            distance = (dx*dx + dy*dy + dz*dz) ** 0.5
            logger.info("save_calibration_point_b: distance from A = %.1fmm (min=50mm)", distance * 1000)
            if distance < min_distance_m:
                return {
                    "ok": False,
                    "error": f"Robot too close to Point A ({distance*1000:.0f}mm < 50mm minimum). Move robot first!",
                    "distance_mm": distance * 1000
                }

        # If Point A was saved earlier but the URScript state lost it (e.g., program restart),
        # restore Point A from the persisted pose before saving B.
        cal_before = self.read_urscript_registers()
        if cal_before.get("ok") and cal_before.get("cal_status") not in (1, 3):
            # If cal_status=-1 (both set but invalid), clear stale calibration first
            # This removes the stale point_b that would cause path calculation to fail
            if cal_before.get("cal_status") == -1:
                logger.info("save_calibration_point_b: clearing stale calibration (status=-1)")
                cleared = self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                         expected_stop_generation=generation)
                if not cleared.get("ok"):
                    return cleared
            pose_a = self._cal_point_a_pose
            if not pose_a:
                saved = self._load_calibration_from_file() or {}
                pose_a = saved.get("point_a_pose")
            if pose_a and len(pose_a) >= 6:
                logger.info("save_calibration_point_b: restoring Point A before saving B")
                pose_result = self.set_calibration_pose(*pose_a[:6])
                if not pose_result.get("ok"):
                    return {"ok": False, "message": pose_result.get("error") or "Failed to write Point A pose"}
                restore_result = self.send_mode(CMD_SET_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                                expected_stop_generation=generation)
                if not restore_result.get("ok"):
                    return {"ok": False, "message": restore_result.get("error") or "Failed to restore Point A"}
        result = self.send_mode(CMD_SAVE_POINT_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                expected_stop_generation=generation)
        if not result.get("ok"):
            return result
        cal = self._wait_for_calibration_update(CMD_SAVE_POINT_B)
        if not cal.get("ok") or cal.get("cal_status") != 3:
            return {"ok": False, "error": cal.get("error") or "Host did not validate Point B", "urscript": cal}
        logger.info("save_calibration_point_b: send_mode result=%s", result)
        pose = self._latest_tcp_pose_m()
        logger.info("save_calibration_point_b: latest_tcp_pose=%s", pose)
        if pose:
            self._cal_point_b_pose = list(pose)
            self._save_calibration_to_file()
            result["point_b_xyz"] = self._xyz_mm_from_pose(pose)
        logger.info("save_calibration_point_b: urscript_registers=%s", cal)
        if cal.get("ok"):
            result["calibration_status"] = cal.get("cal_status")
            result["calibration_status_text"] = self._calibration_status_to_text(result.get("calibration_status"))
        self._clear_input_command()
        return result

    def move_to_calibration_point_a(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def move_to_calibration_point_b(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def move_to_safe_height(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_SAFE, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def clear_calibration(self) -> Dict[str, Any]:
        result = self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
        if not result.get("ok"):
            return result
        self._cal_point_a_pose = None
        self._cal_point_b_pose = None
        if CALIBRATION_FILE.exists():
            try:
                CALIBRATION_FILE.unlink()
            except Exception:
                pass
        result["calibration_status"] = 0
        result["calibration_status_text"] = self._calibration_status_to_text(0)
        return result

    def get_calibration_status(self) -> Dict[str, Any]:
        cal = self.read_urscript_registers()
        status = cal.get("cal_status") if cal.get("ok") else None
        return {
            "ok": bool(cal.get("ok")),
            "calibration_status": status,
            "calibration_status_text": self._calibration_status_to_text(status),
            "point_a_xyz": self._xyz_mm_from_pose(tuple(self._cal_point_a_pose)) if self._cal_point_a_pose else None,
            "point_b_xyz": self._xyz_mm_from_pose(tuple(self._cal_point_b_pose)) if self._cal_point_b_pose else None,
        }

    def restore_calibration(self) -> Dict[str, Any]:
        generation = self._stop_generation
        dbg = self.get_dashboard_debug()
        if dbg.get("ok"):
            state = str(dbg.get("programState") or "").upper()
            if "PLAYING" not in state:
                return {
                    "ok": False,
                    "message": "PolyScope program not PLAYING; press Play before restore.",
                    "dashboard": dbg,
                    "restored": [],
                }
        data = self._load_calibration_from_file()
        if not data:
            return {"ok": False, "message": "No saved calibration found", "restored": []}
        restored = []
        pose_a = data.get("point_a_pose")
        pose_b = data.get("point_b_pose")

        # Calculate distance between A and B to check validity
        min_distance_m = 0.05  # 50mm minimum
        skip_b = False
        if pose_a and pose_b and len(pose_a) >= 3 and len(pose_b) >= 3:
            dx = pose_a[0] - pose_b[0]
            dy = pose_a[1] - pose_b[1]
            dz = pose_a[2] - pose_b[2]
            distance = (dx*dx + dy*dy + dz*dz) ** 0.5
            if distance < min_distance_m:
                logger.warning("restore_calibration: A and B too close (%.1fmm < 50mm), skipping B restore", distance * 1000)
                skip_b = True

        if pose_a and len(pose_a) >= 6:
            pose_result = self.set_calibration_pose(*pose_a[:6])
            if not pose_result.get("ok"):
                return {"ok": False, "error": pose_result.get("error"), "restored": restored}
            result = self.send_mode(CMD_SET_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                    expected_stop_generation=generation)
            if not result.get("ok"):
                return {**result, "restored": restored}
            self._cal_point_a_pose = list(pose_a[:6])
            restored.append("A")
        if pose_b and len(pose_b) >= 6 and not skip_b:
            pose_result = self.set_calibration_pose(*pose_b[:6])
            if not pose_result.get("ok"):
                return {"ok": False, "error": pose_result.get("error"), "restored": restored}
            result = self.send_mode(CMD_SET_POINT_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True,
                                    expected_stop_generation=generation)
            if not result.get("ok"):
                return {**result, "restored": restored}
            self._cal_point_b_pose = list(pose_b[:6])
            restored.append("B")
        cal = self.read_urscript_registers()
        return {
            "ok": bool(restored) and bool(cal.get("ok")),
            "restored": restored,
            "calibration_status": cal.get("cal_status") if cal.get("ok") else None,
            "calibration_status_text": self._calibration_status_to_text(
                cal.get("cal_status") if cal.get("ok") else None
            ),
            "point_a_xyz": self._xyz_mm_from_pose(tuple(self._cal_point_a_pose)) if self._cal_point_a_pose else None,
            "point_b_xyz": self._xyz_mm_from_pose(tuple(self._cal_point_b_pose)) if self._cal_point_b_pose else None,
        }

    def set_calibration_pose(self, x: float, y: float, z: float, rx: float, ry: float, rz: float) -> Dict[str, Any]:
        """Write a pose to the input float registers (used by your .urs calibration)."""
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        try:
            values = [float(value) for value in (x, y, z, rx, ry, rz)]
            if not all(math.isfinite(value) for value in values):
                return {"ok": False, "error": "Calibration pose contains non-finite values"}
            for register, value in zip((IN_POSE_X, IN_POSE_Y, IN_POSE_Z, IN_POSE_RX, IN_POSE_RY, IN_POSE_RZ), values):
                if self.rtde_io.setInputDoubleRegister(register, value) is False:
                    return {"ok": False, "error": f"Calibration register {register} write failed"}
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # --------------------------
    # Dashboard debug (helpful when "connected but not moving")
    # --------------------------
    def get_dashboard_debug(self) -> Dict[str, Any]:
        if not self.dashboard:
            return {"ok": False, "error": "dashboard not connected"}
        return {
            "ok": True,
            "programState": self.dashboard.program_state(),
            "robotmode": self.dashboard.robot_mode(),
            "safetystatus": self.dashboard.safety_status(),
            "loaded_program": self.dashboard.get_loaded_program(),
        }


# Convenience singleton-style factory (optional)
def create_middleware() -> UR10eMiddlewareLocalMode:
    return UR10eMiddlewareLocalMode()
