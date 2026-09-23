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
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------
# RTDE Register Map (MUST match ur10e_modes_local_mode.urs)
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

UR_SCRIPT_ERROR_TEXT = {
    0: "ok",
    1: "unknown command",
    2: "overforce stop",
    3: "host program is not armed",
}

# Optional input float registers used by your URScript for calibration points
# Align with ur10e_modes.urs and known RTDE IO support.
IN_POSE_X = 24
IN_POSE_Y = 25
IN_POSE_Z = 26
IN_POSE_RX = 27
IN_POSE_RY = 28
IN_POSE_RZ = 29

# Calibration command IDs (must match .urs)
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

        self._stop_evt = threading.Event()
        self._telemetry_thread: Optional[threading.Thread] = None
        self._latest: Dict[str, Any] = {}
        self.connected = False
        saved = self._load_calibration_from_file()
        if saved:
            self._cal_point_a_pose = saved.get("point_a_pose") or None
            self._cal_point_b_pose = saved.get("point_b_pose") or None

    # --------------------------
    # Connection lifecycle
    # --------------------------
    def connect(self, ip: Optional[str] = None) -> None:
        # Disconnect any existing connection first to avoid register conflicts
        if self.connected or self.rtde_r or self.rtde_io:
            self.disconnect()

        ip = ip or self.default_ip
        self._ip = ip

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
        self.connected = True
        self._last_error = None
        self._last_error_ts = None
        self._restore_speed_slider()
        self._write_force_enable(False)
        self._resync_sequence_from_robot()
        self._neutralize_motion_on_connect()

        self._stop_evt.clear()
        self._telemetry_thread = threading.Thread(target=self._telemetry_loop, daemon=True)
        self._telemetry_thread.start()

    def _neutralize_motion_on_connect(self) -> None:
        """Best-effort STOP edge to prevent stale auto motion after connect."""
        if not self.rtde_io:
            return
        try:
            seq = self._next_seq()
            self.rtde_io.setInputIntRegister(IN_SPEED_X100, int(self._speed_scale_x100))
            self.rtde_io.setInputIntRegister(IN_FORCE_X10, 0)
            self.rtde_io.setInputIntRegister(IN_DURATION_S, 0)
            self.rtde_io.setInputIntRegister(IN_CMD, 0)
            self.rtde_io.setInputIntRegister(IN_CMD_SEQ, int(seq))
            logger.info("connect: sent startup STOP neutralization seq=%d", seq)
        except Exception:
            logger.warning("connect: failed to send startup STOP neutralization", exc_info=True)

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
        if self._telemetry_thread:
            self._telemetry_thread.join(timeout=1.0)
            self._telemetry_thread = None

        # ur_rtde interfaces have disconnect() in some versions; safe-guard
        for obj_name in ("rtde_io", "rtde_r"):
            obj = getattr(self, obj_name, None)
            if obj:
                try:
                    if hasattr(obj, "disconnect"):
                        obj.disconnect()
                except Exception:
                    logger.exception("Failed to disconnect %s", obj_name)

        self.rtde_r = None
        self.rtde_io = None
        self.dashboard = None
        self.connected = False

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
        for obj_name in ("rtde_io", "rtde_r"):
            obj = getattr(self, obj_name, None)
            if obj:
                try:
                    if hasattr(obj, "disconnect"):
                        obj.disconnect()
                except Exception:
                    logger.exception("Failed to disconnect %s during reset", obj_name)
        self.rtde_r = None
        self.rtde_io = None
        self.dashboard = None
        self.connected = False

    def _maybe_reconnect(self) -> None:
        if not self._ip:
            return
        now = time.time()
        if now - self._last_reconnect_attempt < self._reconnect_backoff_s:
            return
        self._last_reconnect_attempt = now
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
            self.connected = True
            self._clear_error()
        except Exception as exc:
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

    def _telemetry_loop(self) -> None:
        interval = 1.0 / float(self.telemetry_hz)
        dashboard_poll_s = max(0.5, float(os.getenv("UR10E_DASHBOARD_POLL_S", "1.0")))
        last_dashboard_poll = 0.0
        dashboard_snapshot = {"program_state": None, "robot_mode": None, "safety_status": None}
        while not self._stop_evt.is_set():
            t0 = time.time()
            try:
                if not self.rtde_r:
                    self._mark_error("rtde_receive not connected")
                    self.connected = False
                    self._maybe_reconnect()
                    time.sleep(interval)
                    continue

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

                with self._lock:
                    self._latest = {
                        "telemetry": tel,
                        "urscript": urs,
                        "rtde_connected": True,
                        "error": None,
                    }
                self._clear_error()
            except Exception:
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
                self._stop_evt.wait(timeout=sleep_s)

    def get_telemetry(self) -> Dict[str, Any]:
        """UI-friendly dict (safe to JSON serialize)."""
        with self._lock:
            tel: Optional[Telemetry] = self._latest.get("telemetry")
            urs: Dict[str, Any] = self._latest.get("urscript") or {}
            last_error = self._latest.get("error") or self._last_error
            rtde_connected = bool(self._latest.get("rtde_connected", False))

        if not tel:
            return {
                "ok": False,
                "error": last_error or "no telemetry yet",
                "rtde_connected": rtde_connected,
                "ts": time.time(),
            }

        tcp = tel.tcp_m
        ft = tel.ft
        roll, pitch, yaw = self._rotvec_to_rpy(tcp[3], tcp[4], tcp[5])
        return {
            "ok": True,
            "ts": tel.ts,
            "rtde_connected": rtde_connected,
            "error": last_error,
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
            "speed_scaling": tel.speed_scaling,
            "program_state": tel.program_state,
            "robot_mode": tel.robot_mode,
            "safety_status": tel.safety_status,
            "urscript": urs,
        }

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Compatibility snapshot for UI state payload."""
        tel = self.get_telemetry()
        if not tel.get("ok"):
            return {"ok": False, "error": tel.get("error")}
        return {
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
            },
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
            state = int(self.rtde_r.getOutputIntRegister(OUT_STATE))
            error_code = int(self.rtde_r.getOutputIntRegister(OUT_ERROR_CODE))
            current_mode = int(self.rtde_r.getOutputIntRegister(OUT_CURRENT_MODE))
            progress = int(self.rtde_r.getOutputIntRegister(OUT_PROGRESS))
            ack_seq = int(self.rtde_r.getOutputIntRegister(OUT_ACK_SEQ))
            self._last_ack_seq = ack_seq
            cal_status = int(self.rtde_r.getOutputIntRegister(OUT_CAL_STATUS))
            logger.debug("read_urscript_registers: state=%d, ack_seq=%d", state, ack_seq)
            return {
                "ok": True,
                "state": state,
                "error_code": error_code,
                "current_mode": current_mode,
                "progress": progress,
                "ack_seq": ack_seq,
                "cal_status": cal_status,
            }
        except Exception as e:
            logger.error("read_urscript_registers FAILED: %s", e)
            return {"ok": False, "error": str(e)}

    def _latest_tcp_pose_m(self) -> Optional[Tuple[float, float, float, float, float, float]]:
        with self._lock:
            tel: Optional[Telemetry] = self._latest.get("telemetry")
            if tel:
                return tel.tcp_m
        if self.rtde_r:
            try:
                pose = self.rtde_r.getActualTCPPose()
                pose_vals = [float(x) for x in pose]
                if len(pose_vals) < 6:
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
                return json.load(fh)
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
            with CALIBRATION_FILE.open("w", encoding="utf-8") as fh:
                json.dump(data, fh)
            return True
        except Exception as exc:
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
        return last or {"ok": False, "error": "timeout waiting for calibration update"}

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
            self.rtde_io.setInputIntRegister(IN_FORCE_ENABLE, 1 if enabled else 0)
        except Exception:
            self._force_enable_supported = False
            logger.warning(
                "IN_FORCE_ENABLE unsupported; using signed IN_FORCE_X10 encoding",
                exc_info=True,
            )

    def _ensure_speed_slider_for_motion(self, mode: int) -> None:
        # Avoid restoring speed slider on pause; restore for any motion-related command.
        if int(mode) != 0 and int(mode) != 5:
            self._restore_speed_slider()

    def _motion_preflight(self) -> Dict[str, Any]:
        """Return a clear, fail-closed explanation when the robot cannot move."""
        if not self.rtde_io or not self.connected:
            return {"ok": False, "error": "RTDE is not connected"}

        dashboard = self.get_dashboard_debug()
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
        return {"ok": True, "dashboard": dashboard}

    def _arm_host_program(self) -> Dict[str, Any]:
        """Send and confirm the STOP edge required by the local-mode URScript."""
        result = self.send_mode(
            0,
            speed_x100=100,
            force_x10=0,
            duration_s=0,
            force_enable=False,
            wait_ack=True,
        )
        if not result.get("ok"):
            result.setdefault("error", "Unable to arm the PolyScope host program")
            result.setdefault(
                "hint",
                "Confirm the correct host program is PLAYING and its RTDE register map matches this middleware.",
            )
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
        force_mode4_only = os.getenv("UR10E_FORCE_MODE4_ONLY", "0").lower() in ("1", "true", "yes", "on")
        effective_mode = 4 if force_mode4_only and requested_mode in (1, 2, 3, 4) else requested_mode
        if effective_mode != requested_mode:
            logger.info("send_mode: UR10E_FORCE_MODE4_ONLY remapped requested mode %d -> %d", requested_mode, effective_mode)
        with self._send_mode_lock:
            self._ensure_speed_slider_for_motion(effective_mode)
            seq = self._next_seq()
            logger.info("send_mode: generated seq=%d", seq)

            try:
                # Write command registers
                logger.info("send_mode: Writing registers IN_CMD=%d, IN_CMD_SEQ=%d", IN_CMD, IN_CMD_SEQ)
                self._write_force_enable(bool(force_enable))
                effective_force_x10 = -abs(int(force_x10)) if force_enable else 0
                logger.info("send_mode: effective_force_x10=%d", effective_force_x10)
                self.rtde_io.setInputIntRegister(IN_SPEED_X100, int(speed_x100))
                self.rtde_io.setInputIntRegister(IN_FORCE_X10, int(effective_force_x10))
                self.rtde_io.setInputIntRegister(IN_DURATION_S, int(duration_s))
                self.rtde_io.setInputIntRegister(IN_CMD, int(effective_mode))
                self.rtde_io.setInputIntRegister(IN_CMD_SEQ, int(seq))
                logger.info("send_mode: Registers written successfully")
            except Exception as e:
                logger.exception("send_mode: Failed to write registers")
                return {"ok": False, "error": f"failed to write registers: {e}"}

            if not wait_ack:
                return {"ok": True, "seq": seq, "note": "sent (no ack wait)"}

            # Wait for URScript to echo ack seq
            logger.info("send_mode: Waiting for ACK (timeout=%ss)...", ack_timeout_s)
            t_end = time.time() + float(ack_timeout_s)
            last_ack = None
            while time.time() < t_end:
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
        mode_id = self._resolve_mode_id(command.mode)
        if mode_id is None:
            return {"ok": False, "error": "unknown or missing mode"}
        preflight = self._motion_preflight()
        if not preflight.get("ok"):
            return preflight
        cal = self.read_urscript_registers()
        if cal.get("ok"):
            cal_status = cal.get("cal_status")
            # Allow cal_status 0 (demo mode - no calibration) or 3 (fully calibrated)
            # Demo script (ur10e_demo.urs) outputs 0 because it doesn't use calibration
            if cal_status not in (0, 3):
                return {
                    "ok": False,
                    "error": "calibration not ready",
                    "calibration_status": cal_status,
                    "calibration_status_text": self._calibration_status_to_text(cal_status),
                }
        arm_result = self._arm_host_program()
        if not arm_result.get("ok"):
            return arm_result
        force_x10 = self._resolve_force_x10(command.intensity)
        duration_s = self._resolve_duration_s(command.duration)
        force_enable = bool(getattr(command, "force_assist", False))
        return self.send_mode(
            mode_id,
            speed_x100=100,
            force_x10=force_x10,
            duration_s=duration_s,
            force_enable=force_enable,
            wait_ack=True,
        )

    def stop_massage(self) -> Dict[str, Any]:
        """Send CMD=0 (stop). Escalates to hard-stop if URScript does not ACK within 0.4 s."""
        logger.info("stop_massage: Sending CMD=0 (soft stop)...")
        result = self.send_mode(0, speed_x100=100, force_x10=0, duration_s=0, force_enable=False, wait_ack=False)

        # Brief wait then confirm ACK
        time.sleep(0.4)
        current_sent = self._seq
        urs = self.read_urscript_registers()
        ack_received = urs.get("ok") and int(urs.get("ack_seq", -1)) == int(current_sent)

        if not ack_received:
            logger.warning("stop_massage: ACK not received after 0.4 s — escalating to hard-stop")
            self._hard_stop_rtde_control()
            # Restore speed slider so the URScript recovery movel can execute.
            # Do NOT zero the speed here: the .urs handles its own stop and
            # needs the speed slider at 1.0 to move back to the start pose.
            self._restore_speed_slider()
            # Re-send CMD=0 with a fresh seq so URScript registers the stop
            self.send_mode(0, speed_x100=100, force_x10=0, duration_s=0, force_enable=False, wait_ack=False)
            result["fallback_triggered"] = True
        else:
            logger.info("stop_massage: Soft stop ACK confirmed.")

        return result

    def pause_massage(self) -> Dict[str, Any]:
        """
        Send CMD=5 (pause).
        URScript stops motion immediately but remembers the active mode.
        Call resume_massage() to restart from current pose.
        """
        logger.info("pause_massage: Sending CMD=5 (pause)...")
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        return self.send_mode(5, speed_x100=100, force_x10=0, duration_s=0, force_enable=False, wait_ack=True)

    def resume_massage(self) -> Dict[str, Any]:
        """
        Send CMD=6 (resume).
        URScript restores the previously paused mode and restarts motion from current TCP pose.
        Returns an error if nothing was paused (URScript will ACK with STATE_IDLE).
        """
        logger.info("resume_massage: Sending CMD=6 (resume)...")
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        result = self.send_mode(6, speed_x100=100, force_x10=0, duration_s=0, force_enable=False, wait_ack=True)
        if result.get("ok"):
            urs = result.get("urscript") or {}
            if int(urs.get("state", 0)) != 1:  # STATE_RUNNING = 1
                result["warning"] = "resume sent but URScript did not transition to RUNNING (was nothing paused?)"
        return result

    def adjust_speed(self, delta: float) -> Dict[str, Any]:
        if not self.rtde_io:
            return {"ok": False, "error": "rtde_io not connected"}
        try:
            self._speed_scale_x100 = max(10, min(200, int(self._speed_scale_x100 + delta * 100)))
            self.rtde_io.setInputIntRegister(IN_SPEED_X100, int(self._speed_scale_x100))
            return {"ok": True, "speed_scale_x100": self._speed_scale_x100}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def start_jog(self, direction: str, duration_s: Optional[float] = None) -> Dict[str, Any]:
        mode_id = CMD_JOG_Z_UP if direction == "z_up" else CMD_JOG_Z_DOWN
        result = self.send_mode(mode_id, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
        if duration_s and duration_s > 0:
            stop_at = time.time() + float(duration_s)
            while time.time() < stop_at:
                time.sleep(0.02)
            self.stop_massage()
        return result

    def save_calibration_point_a(self) -> Dict[str, Any]:
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
            self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
        result = self.send_mode(CMD_SAVE_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
        logger.info("save_calibration_point_a: send_mode result=%s", result)
        pose = self._latest_tcp_pose_m()
        logger.info("save_calibration_point_a: latest_tcp_pose=%s", pose)
        if pose:
            self._cal_point_a_pose = list(pose)
            self._save_calibration_to_file()
            result["point_a_xyz"] = self._xyz_mm_from_pose(pose)
        cal = self._wait_for_calibration_update(CMD_SAVE_POINT_A)
        logger.info("save_calibration_point_a: urscript_registers=%s", cal)
        if cal.get("ok"):
            result["calibration_status"] = cal.get("cal_status")
            result["calibration_status_text"] = self._calibration_status_to_text(result.get("calibration_status"))
        self._clear_input_command()
        return result

    def save_calibration_point_b(self) -> Dict[str, Any]:
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
                self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
            pose_a = self._cal_point_a_pose
            if not pose_a:
                saved = self._load_calibration_from_file() or {}
                pose_a = saved.get("point_a_pose")
            if pose_a and len(pose_a) >= 6:
                logger.info("save_calibration_point_b: restoring Point A before saving B")
                pose_result = self.set_calibration_pose(*pose_a[:6])
                if not pose_result.get("ok"):
                    return {"ok": False, "message": pose_result.get("error") or "Failed to write Point A pose"}
                restore_result = self.send_mode(CMD_SET_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
                if not restore_result.get("ok"):
                    return {"ok": False, "message": restore_result.get("error") or "Failed to restore Point A"}
        result = self.send_mode(CMD_SAVE_POINT_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
        logger.info("save_calibration_point_b: send_mode result=%s", result)
        pose = self._latest_tcp_pose_m()
        logger.info("save_calibration_point_b: latest_tcp_pose=%s", pose)
        if pose:
            self._cal_point_b_pose = list(pose)
            self._save_calibration_to_file()
            result["point_b_xyz"] = self._xyz_mm_from_pose(pose)
        cal = self._wait_for_calibration_update(CMD_SAVE_POINT_B)
        logger.info("save_calibration_point_b: urscript_registers=%s", cal)
        if cal.get("ok"):
            result["calibration_status"] = cal.get("cal_status")
            result["calibration_status_text"] = self._calibration_status_to_text(result.get("calibration_status"))
            # If URScript still marks calibration invalid, force-set A/B from RTDE poses.
            if result.get("calibration_status") == -1:
                logger.info("save_calibration_point_b: forcing set_point_a/b from RTDE poses")
                pose_a = self._cal_point_a_pose
                if not pose_a:
                    saved = self._load_calibration_from_file() or {}
                    pose_a = saved.get("point_a_pose")
                pose_b = self._cal_point_b_pose or pose
                if pose_a and pose_b and len(pose_a) >= 6 and len(pose_b) >= 6:
                    self.set_calibration_pose(*pose_a[:6])
                    self.send_mode(CMD_SET_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
                    self.set_calibration_pose(*pose_b[:6])
                    self.send_mode(CMD_SET_POINT_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
                    cal_retry = self._wait_for_calibration_update(CMD_SET_POINT_B)
                    logger.info("save_calibration_point_b: post-retry urscript_registers=%s", cal_retry)
                    if cal_retry.get("ok"):
                        result["calibration_status"] = cal_retry.get("cal_status")
                        result["calibration_status_text"] = self._calibration_status_to_text(
                            result.get("calibration_status")
                        )
        self._clear_input_command()
        return result

    def move_to_calibration_point_a(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def move_to_calibration_point_b(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def move_to_safe_height(self) -> Dict[str, Any]:
        return self.send_mode(CMD_MOVE_TO_SAFE, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)

    def clear_calibration(self) -> Dict[str, Any]:
        self._cal_point_a_pose = None
        self._cal_point_b_pose = None
        if CALIBRATION_FILE.exists():
            try:
                CALIBRATION_FILE.unlink()
            except Exception:
                pass
        result = self.send_mode(CMD_CLEAR_CALIBRATION, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
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
            self.set_calibration_pose(*pose_a[:6])
            self.send_mode(CMD_SET_POINT_A, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
            self._cal_point_a_pose = list(pose_a[:6])
            restored.append("A")
        if pose_b and len(pose_b) >= 6 and not skip_b:
            self.set_calibration_pose(*pose_b[:6])
            self.send_mode(CMD_SET_POINT_B, speed_x100=100, force_x10=30, duration_s=0, wait_ack=True)
            self._cal_point_b_pose = list(pose_b[:6])
            restored.append("B")
        cal = self.read_urscript_registers()
        return {
            "ok": True,
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
            self.rtde_io.setInputDoubleRegister(IN_POSE_X, float(x))
            self.rtde_io.setInputDoubleRegister(IN_POSE_Y, float(y))
            self.rtde_io.setInputDoubleRegister(IN_POSE_Z, float(z))
            self.rtde_io.setInputDoubleRegister(IN_POSE_RX, float(rx))
            self.rtde_io.setInputDoubleRegister(IN_POSE_RY, float(ry))
            self.rtde_io.setInputDoubleRegister(IN_POSE_RZ, float(rz))
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
