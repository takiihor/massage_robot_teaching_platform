# ===== IMPORTS AND CONFIG =====
from fastapi import (
    FastAPI,
    Request,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    UploadFile,
    File,
    Form,
)
from fastapi.responses import StreamingResponse, HTMLResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv
import time
from pydantic import BaseModel
from typing import Optional, Dict, Any
import logging
from contextlib import asynccontextmanager
import asyncio
import json
import base64
import uuid
import threading

# Azure Speech SDK for STT (Speech-to-Text) - CRITICAL for voice commands
try:
    import azure.cognitiveservices.speech as speechsdk

    AZURE_SPEECH_SDK_AVAILABLE = True
except ImportError:
    speechsdk = None
    AZURE_SPEECH_SDK_AVAILABLE = False
    print("[WARNING] Azure Speech SDK not installed - STT unavailable")


# 配置日誌
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 載入環境變量
load_dotenv()

# UR10e Local Mode configuration
UR10E_IP = os.getenv("UR10E_IP", "192.168.1.10")
AUTO_CONNECT_RTDE = os.getenv("AUTO_CONNECT_RTDE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
# Simulation must be an explicit teaching-mode choice.  A physical session must
# never appear to start successfully merely because RTDE is disconnected.
MASSAGE_SIMULATION_MODE = os.getenv("MASSAGE_SIMULATION_MODE", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
try:
    UR10E_TELEM_HZ = int(os.getenv("UR10E_TELEM_HZ", "5"))
except Exception:
    UR10E_TELEM_HZ = 5

# Azure Cognitive Services (for STT - Speech-to-Text) - CRITICAL for voice commands
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION")
ENABLE_AZURE_SPEECH_STT = os.getenv("ENABLE_AZURE_SPEECH_STT", "true").lower() == "true"
AZURE_SPEECH_STT_ENABLED = bool(
    AZURE_SPEECH_SDK_AVAILABLE
    and speechsdk
    and AZURE_SPEECH_KEY
    and AZURE_SPEECH_REGION
    and ENABLE_AZURE_SPEECH_STT
)


# Short command phrases should finalize promptly after the speaker pauses.
# Increase this for speakers who pause within a phrase (Azure range: 100–5000 ms).
try:
    STT_SEGMENTATION_SILENCE_MS = int(os.getenv("STT_SEGMENTATION_SILENCE_MS", "300"))
    if not 100 <= STT_SEGMENTATION_SILENCE_MS <= 5000:
        raise ValueError("out of range")
except ValueError:
    logger.warning("Invalid STT_SEGMENTATION_SILENCE_MS; using 300 ms")
    STT_SEGMENTATION_SILENCE_MS = 300


# HTML 文件配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
# Default to Year65 dashboard UI; override via HTML_FILE when needed.
# Example (alternate UI): HTML_FILE=static/index.html python3 main.py
HTML_FILE = os.getenv("HTML_FILE", "static/year65_v3_avatar_v3.html")
if os.path.isabs(HTML_FILE):
    HTML_PATH = HTML_FILE
elif HTML_FILE.startswith(("static/", "static\\")):
    HTML_PATH = os.path.join(BASE_DIR, HTML_FILE)
else:
    HTML_PATH = os.path.join(STATIC_DIR, HTML_FILE)


# ===== SYSTEM CONFIG =====
PERFORMANCE_CONFIG = {
    "MAX_CONNECTIONS_PER_VOICE": 5,
    "CONNECTION_IDLE_TIMEOUT": 480,  # 8 分鐘
    "CACHE_MAX_SIZE": 500,
    "CACHE_TTL": 3600,  # 1 小時
    "PRELOAD_ENABLED": True,
    "CHUNK_SIZE": 2048,
    "FIRST_CHUNK_SIZE": 512,
    "MONITORING_ENABLED": True,
}


def _csv_env(name: str, default: str) -> "list[str]":
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


CORS_ALLOWED_ORIGINS = _csv_env(
    "CORS_ALLOWED_ORIGINS",
    "http://127.0.0.1:5000,http://localhost:5000,http://127.0.0.1:5017,http://localhost:5017",
)

try:
    MAX_STT_UPLOAD_BYTES = int(os.getenv("MAX_STT_UPLOAD_BYTES", str(20 * 1024 * 1024)))
except Exception:
    MAX_STT_UPLOAD_BYTES = 20 * 1024 * 1024


# 全局服务实例
from robot.ur10e_middleware_local_mode import (
    UR10eMiddlewareLocalMode,
    MassageCommand,
)

ur10e_middleware = UR10eMiddlewareLocalMode(
    default_ip=UR10E_IP,
    telemetry_hz=UR10E_TELEM_HZ,
)


# ===== Robot reachability preflight =====
# ur-rtde 1.6.x ships as a compiled extension whose blocking ``connect`` holds the
# GIL for the whole TCP handshake.  Against an unroutable host that is ~136 s, which
# starves the event loop and freezes *every* request (including /health) - and at
# startup it happens before uvicorn binds its socket, so the server never comes up.
# Probing in pure Python first (socket releases the GIL) fails in a couple of seconds.
RTDE_PORTS = tuple(
    p for p in (int(x) for x in _csv_env("UR10E_RTDE_PORTS", "30004")) if p > 0
) or (30004,)
try:
    RTDE_PROBE_TIMEOUT_S = float(os.getenv("UR10E_PROBE_TIMEOUT_S", "3"))
except Exception:
    RTDE_PROBE_TIMEOUT_S = 3.0


def _probe_robot_tcp(ip: str, timeout_s: float = None):
    """Return (reachable, detail) for the robot's RTDE port(s).

    Cheap, non-blocking-in-practice preflight so an unreachable robot produces a fast,
    clear error instead of a long event-loop stall.
    """
    import socket

    if not ip:
        return False, "no robot IP configured"
    if timeout_s is None:
        timeout_s = RTDE_PROBE_TIMEOUT_S
    detail = "no RTDE port configured"
    for port in RTDE_PORTS or (30004,):
        try:
            with socket.create_connection((ip, port), timeout=timeout_s):
                return True, f"tcp/{port} reachable"
        except Exception as exc:
            detail = f"tcp/{port} unreachable ({type(exc).__name__}: {exc})"
    return False, detail


# ===== Lifespan Context Manager =====
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        # Keep startup minimal for massage-only mode.

        # UR10e 連線改為非阻塞背景任務，避免卡住前端啟動。
        if AUTO_CONNECT_RTDE:
            # Fail fast when the robot is off/absent so lifespan startup - and
            # therefore socket binding - is never held up by a dead RTDE connect.
            reachable, detail = _probe_robot_tcp(UR10E_IP)
            if not reachable:
                logger.warning(
                    "UR10e RTDE auto-connect skipped: %s is %s", UR10E_IP, detail
                )
            else:

                def _connect_robot():
                    try:
                        ur10e_middleware.connect(UR10E_IP)
                        logger.info("UR10e local-mode RTDE connected to %s", UR10E_IP)
                    except Exception as exc:
                        logger.warning("UR10e RTDE connect failed: %s", exc)

                try:
                    loop = asyncio.get_running_loop()
                    loop.run_in_executor(None, _connect_robot)
                except RuntimeError:
                    threading.Thread(target=_connect_robot, daemon=True).start()

        yield
    except asyncio.CancelledError:
        # Allow Ctrl+C shutdown without noisy stack traces.
        pass
    finally:
        try:
            ur10e_middleware.disconnect()
        except Exception:
            pass


# ===== 創建 FastAPI 實例 =====
app = FastAPI(
    title="Massage Robot Control",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def no_cache_frontend_assets(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    frontend_asset = (
        path == "/"
        or path.endswith(".html")
        or path.endswith(".js")
        or path.endswith(".css")
    )
    if frontend_asset:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ===== 靜態文件服務配置 =====
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)
    logger.debug("Created 'static' directory")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Mount scenario design assets (flowchart PNGs for instructor quick-reference)
scenario_design_dir = os.path.join(BASE_DIR, "new_scenario_design")
if os.path.exists(scenario_design_dir):
    app.mount("/new_scenario_design", StaticFiles(directory=scenario_design_dir), name="new_scenario_design")
    logger.debug("Mounted new_scenario_design directory")


# Mount emoji_png folder for emoji images
emoji_dir = os.path.join(BASE_DIR, "emoji_png")
if os.path.exists(emoji_dir):
    app.mount("/emoji_png", StaticFiles(directory=emoji_dir), name="emoji_png")
    logger.debug("Mounted emoji_png directory")

# Mount male_emoji folder for male emoji images
male_emoji_dir = os.path.join(BASE_DIR, "male_emoji")
if os.path.exists(male_emoji_dir):
    app.mount("/male_emoji", StaticFiles(directory=male_emoji_dir), name="male_emoji")
    logger.debug("Mounted male_emoji directory")

# Mount predefined local audio assets (preset prompts for massage mode)
predefined_sound_dir = os.path.join(BASE_DIR, "predefined_sound_track")
if os.path.exists(predefined_sound_dir):
    app.mount(
        "/predefined_sound_track",
        StaticFiles(directory=predefined_sound_dir),
        name="predefined_sound_track",
    )
    logger.debug("Mounted predefined_sound_track directory")

# Mount bundled preset audio library (assets/audio/*)
assets_dir = os.path.join(BASE_DIR, "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    logger.debug("Mounted assets directory")


# ===== MAIN API ROUTES =====
# 添加根路徑路由
@app.get("/")
async def root(request: Request):
    """根路徑 - 返回主頁面或 API 資訊"""
    port = request.url.port or int(os.getenv("PORT", 5000))
    static_path = HTML_PATH

    html_content = ""
    if os.path.exists(static_path):
        with open(static_path, "r", encoding="utf-8") as f:
            html_content = f.read()
    elif os.path.exists(HTML_FILE):
        with open(HTML_FILE, "r", encoding="utf-8") as f:
            html_content = f.read()

    if html_content:
        # Inject actual host/port/protocol to frontend
        host = request.url.hostname or "127.0.0.1"
        try:
            host_header = (request.headers.get("host") or "").strip()
            if host_header:
                # Host header may include port.
                host = host_header.split(":", 1)[0].strip() or host
        except Exception:
            pass
        # 0.0.0.0 is a bind-all address and not reachable from the browser.
        if host in ("0.0.0.0", "::", "[::]"):
            host = "127.0.0.1"
        protocol = request.url.scheme or "http"

        # Create server config injection
        server_config = {
            "port": port,
            "host": host,
            "protocol": protocol,
            "api_url": f"{protocol}://{host}:{port}",
            "robot_ip": ur10e_middleware.default_ip,
        }

        injection = f"""<script>
window.SERVER_CONFIG = {json.dumps(server_config)};
console.log('🔌 Server config injected:', window.SERVER_CONFIG);
</script>"""

        # Inject before </head>
        if "</head>" in html_content:
            html_content = html_content.replace("</head>", injection + "\n</head>")
        else:
            # Fallback: inject at beginning
            html_content = injection + "\n" + html_content

        return HTMLResponse(content=html_content)
    else:
        # If file not found, show detailed error
        return {
            "error": "HTML file not found",
            "searched_paths": [HTML_FILE, static_path],
            "current_dir": os.getcwd(),
            "files_in_current_dir": os.listdir("."),
            "files_in_static": os.listdir(STATIC_DIR)
            if os.path.exists(STATIC_DIR)
            else [],
        }


# ===== 請求模型 =====
class ClientLogRequest(BaseModel):
    """Client-side log forwarding (debug/diagnostics)."""

    level: str = "info"  # debug/info/warn/error
    source: str = "client"
    tag: str = "log"
    message: str
    data: Optional[dict] = None
    ts: Optional[float] = None


class MassageCommandRequest(BaseModel):
    body_part: Optional[str] = None
    action: Optional[str] = None
    intensity: Optional[str] = None
    duration: Optional[int] = None
    mode: Optional[int] = None
    force_assist: Optional[bool] = None
    ip: Optional[str] = None  # Optional override for robot IP


class RobotConnectRequest(BaseModel):
    ip: Optional[str] = None
    frequency: Optional[int] = None
    control_mode: Optional[str] = None


class RobotJogRequest(BaseModel):
    duration_s: Optional[float] = None


class SpeedAdjustRequest(BaseModel):
    delta: float = 0.0


# ===== Log function =====
def log(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}")


# ===== API 端點 =====
@app.get("/health")
async def health_check():
    """健康檢查"""
    return {
        "status": "healthy",
        "robot_connected": ur10e_middleware.connected,
        "timestamp": time.time(),
    }


@app.post("/api/client-log")
async def client_log(req: ClientLogRequest):
    """
    Receive client-side logs and print to server terminal.
    Intended for debugging only; callers should rate-limit on the client.
    """
    try:
        level = (req.level or "info").lower()
        prefix = f"[ClientLog][{req.source}][{req.tag}]"
        msg = (req.message or "").strip()
        if len(msg) > 500:
            msg = msg[:500] + "…"
        payload = req.data

        if level == "debug":
            logger.debug("%s %s | data=%s", prefix, msg, payload)
        elif level in ("warn", "warning"):
            logger.warning("%s %s | data=%s", prefix, msg, payload)
        elif level == "error":
            logger.error("%s %s | data=%s", prefix, msg, payload)
        else:
            logger.info("%s %s | data=%s", prefix, msg, payload)
        return {"status": "ok"}
    except Exception as e:
        logger.error("client_log error: %s", e)
        return {"status": "error"}


# ===== UR10e Local Mode API =====
@app.post("/robot/connect")
async def robot_connect(req: RobotConnectRequest):
    """Connect to UR10e via RTDE (local mode)."""
    target_ip = req.ip or ur10e_middleware.default_ip

    # Preflight before handing the socket to ur-rtde.  The compiled RTDE client
    # blocks the GIL for the full TCP handshake, so an unreachable robot would
    # otherwise stall every other request in the process.
    reachable, detail = await asyncio.get_running_loop().run_in_executor(
        None, _probe_robot_tcp, target_ip
    )
    if not reachable:
        logger.warning("Robot connect rejected: %s is %s", target_ip, detail)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Robot {target_ip} is not reachable ({detail}). "
                "Check the network route, the robot power, and the RTDE port."
            ),
        )

    try:
        await _run_robot_op(ur10e_middleware.connect, target_ip, timeout_s=10.0)
        return {
            "ok": True,
            "ip": target_ip,
            "message": "connected",
            "calibration_restore": {
                "ok": True,
                "message": "auto restore disabled; use /calibration/restore manually",
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Robot connect failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/robot/disconnect")
async def robot_disconnect():
    """Disconnect from UR10e."""

    def _disconnect():
        ur10e_middleware.disconnect()
        return True

    try:
        await _run_robot_op(_disconnect, timeout_s=3.0)
        return {"ok": True, "message": "disconnected"}
    except Exception as exc:
        logger.exception("Robot disconnect failed")
        raise HTTPException(status_code=500, detail=str(exc))


class LocalModeCommandRequest(BaseModel):
    mode: str
    intensity: Optional[str] = None
    duration: Optional[int] = None
    force_assist: Optional[bool] = None


ROBOT_OPERATION_LOCK = asyncio.Lock()
ROBOT_STOP_LOCK = asyncio.Lock()
ROBOT_STOP_GENERATION = 0
ROBOT_PENDING_STOPS = 0


async def _run_blocking_robot_op(fn, *args):
    """Run a blocking RTDE call on every supported Python version.

    ``asyncio.to_thread`` is only available from Python 3.9, while the deployed
    virtual environment currently uses Python 3.8.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


async def _run_robot_op(fn, *args, timeout_s: float = 8.0, stop_on_timeout: bool = False,
                        priority_stop: bool = False):
    """Serialize ordinary operations, but let STOP preempt their ACK waits."""
    global ROBOT_STOP_GENERATION, ROBOT_PENDING_STOPS
    if priority_stop:
        # STOP must reach RTDE even while a motion command is waiting for ACK.
        ROBOT_STOP_GENERATION += 1
        ROBOT_PENDING_STOPS += 1
        try:
            async with ROBOT_STOP_LOCK:
                return await asyncio.wait_for(_run_blocking_robot_op(fn, *args), timeout=timeout_s)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Robot stop confirmation timed out")
        finally:
            ROBOT_PENDING_STOPS -= 1
    if ROBOT_PENDING_STOPS:
        return {"ok": False, "error": "Robot stop confirmation is pending; retry after Stop"}
    generation = ROBOT_STOP_GENERATION
    async with ROBOT_OPERATION_LOCK:
        if generation != ROBOT_STOP_GENERATION:
            return {"ok": False, "error": "Robot operation cancelled by Stop"}

        def invoke():
            # The executor may itself be queued behind other blocking work.
            if generation != ROBOT_STOP_GENERATION:
                return {"ok": False, "error": "Robot operation cancelled by Stop"}
            return fn(*args)

        try:
            return await asyncio.wait_for(_run_blocking_robot_op(invoke), timeout=timeout_s)
        except asyncio.TimeoutError:
            logger.error("Robot operation timed out after %.1fs: %s", timeout_s, getattr(fn, "__name__", fn))
            if stop_on_timeout:
                try:
                    await _run_robot_op(ur10e_middleware.stop_massage, timeout_s=2.0, priority_stop=True)
                except Exception as stop_exc:
                    logger.error("Timeout fallback stop failed: %s", stop_exc)
            raise HTTPException(
                status_code=504, detail=f"Operation timed out after {timeout_s:.1f}s"
            )


@app.get("/healthz")
async def healthz():
    return PlainTextResponse("ok\n")


@app.get("/robot/state")
async def robot_state():
    """Return latest RTDE telemetry snapshot (local mode)."""
    state = ur10e_middleware.get_state_snapshot()
    return {
        "connected": ur10e_middleware.connected,
        "simulation_enabled": MASSAGE_SIMULATION_MODE,
        "ip": ur10e_middleware._ip or ur10e_middleware.default_ip,
        "state": state,
    }


@app.get("/robot/stream")
async def robot_stream():
    """Stream RTDE telemetry via SSE."""

    async def event_generator():
        try:
            while True:
                telemetry = ur10e_middleware.get_telemetry()
                telemetry["robot_connected"] = ur10e_middleware.connected
                payload = {
                    "connected": ur10e_middleware.connected,
                    "state": telemetry,
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            # Client disconnect or server shutdown; exit quietly.
            return

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/robot/jog/z_up")
async def robot_jog_z_up(req: Optional[RobotJogRequest] = None):
    """Manual jog: move Z upward. Press-and-hold in UI, release to stop."""
    try:
        result = await _run_robot_op(
            ur10e_middleware.start_jog,
            "z_up",
            (req.duration_s if req else None),
            timeout_s=6.0,
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Jog failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Robot jog z_up failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/robot/jog/z_down")
async def robot_jog_z_down(req: Optional[RobotJogRequest] = None):
    """Manual jog: move Z downward. Press-and-hold in UI, release to stop."""
    try:
        result = await _run_robot_op(
            ur10e_middleware.start_jog,
            "z_down",
            (req.duration_s if req else None),
            timeout_s=6.0,
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Jog failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Robot jog z_down failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/health")
async def local_mode_health():
    return {
        "status": "ok",
        "robot_connected": ur10e_middleware.connected,
        "timestamp": time.time(),
    }


@app.get("/api/telemetry")
async def local_mode_telemetry():
    payload = ur10e_middleware.get_telemetry()
    payload.setdefault("timestamp", payload.get("ts", time.time()))
    payload["robot_connected"] = ur10e_middleware.connected
    return payload


@app.post("/api/command")
async def local_mode_command(req: LocalModeCommandRequest):
    command = MassageCommand(
        mode=req.mode,
        intensity=req.intensity,
        duration=req.duration,
        force_assist=req.force_assist,
    )
    result = await _run_robot_op(ur10e_middleware.start_massage, command, timeout_s=4.0, stop_on_timeout=True)
    return result


@app.post("/api/stop")
async def local_mode_stop():
    return await _run_robot_op(ur10e_middleware.stop_massage, timeout_s=2.0, priority_stop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Legacy massage endpoints (local mode register control)
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/massage/start")
async def massage_start(req: MassageCommandRequest):
    if not req.action and not req.mode:
        raise HTTPException(
            status_code=400,
            detail="Massage mode must be specified. Use 'action' or 'mode'.",
        )
    command = MassageCommand(
        mode=str(req.mode) if req.mode is not None else req.action,
        intensity=req.intensity,
        duration=req.duration,
        force_assist=req.force_assist,
    )
    result = await _run_robot_op(ur10e_middleware.start_massage, command, timeout_s=6.0, stop_on_timeout=True)
    result["connected"] = ur10e_middleware.connected
    return result


@app.post("/massage/stop")
async def massage_stop():
    return await _run_robot_op(ur10e_middleware.stop_massage, timeout_s=4.0, priority_stop=True)


@app.post("/massage/pause")
async def massage_pause():
    return await _run_robot_op(ur10e_middleware.pause_massage, timeout_s=4.0)


@app.post("/massage/resume")
async def massage_resume():
    return await _run_robot_op(ur10e_middleware.resume_massage, timeout_s=4.0)


@app.post("/massage/speed_faster")
async def massage_speed_faster(req: Optional[SpeedAdjustRequest] = None):
    delta = req.delta if req and req.delta else 0.1
    return await _run_robot_op(ur10e_middleware.adjust_speed, abs(delta), timeout_s=2.0)


@app.post("/massage/speed_slower")
async def massage_speed_slower(req: Optional[SpeedAdjustRequest] = None):
    delta = req.delta if req and req.delta else -0.1
    return await _run_robot_op(
        ur10e_middleware.adjust_speed, -abs(delta), timeout_s=2.0
    )


@app.post("/massage/change_action_knead")
async def massage_change_action_knead():
    return await massage_start(MassageCommandRequest(action="knead"))


@app.post("/massage/change_action_push_up")
async def massage_change_action_push_up():
    return await massage_start(MassageCommandRequest(action="push_up"))


@app.post("/massage/change_action_wave_push")
async def massage_change_action_wave_push():
    return await massage_start(MassageCommandRequest(action="wave_push"))


@app.post("/massage/change_action_spiral_press")
async def massage_change_action_spiral_press():
    return await massage_start(MassageCommandRequest(action="spiral_press"))


@app.post("/massage/change_action_tap")
async def massage_change_action_tap():
    return await massage_start(MassageCommandRequest(action="wave_push"))


@app.post("/massage/change_action_massage")
async def massage_change_action_massage():
    return await massage_start(MassageCommandRequest(action="spiral_press"))


@app.post("/massage/change_action_acupressure")
async def massage_change_action_acupressure():
    return await massage_start(MassageCommandRequest(action="knead"))


@app.post("/massage/extend_duration")
async def massage_extend_duration():
    return {"ok": True, "message": "Duration updated for next cycle"}


@app.post("/massage/shorten_duration")
async def massage_shorten_duration():
    return {"ok": True, "message": "Duration updated for next cycle"}


# ─────────────────────────────────────────────────────────────────────────────
# Calibration Endpoints (local mode register control)
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/calibration/status")
async def calibration_status():
    try:
        result = await _run_robot_op(
            ur10e_middleware.get_calibration_status, timeout_s=3.0
        )
        result["connected"] = ur10e_middleware.connected
        return result
    except Exception as exc:
        logger.exception("Calibration status failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/save-point-a")
async def calibration_save_point_a():
    try:
        result = await _run_robot_op(
            ur10e_middleware.save_calibration_point_a, timeout_s=10.0
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Save Point A failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration save Point A failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/save-point-b")
async def calibration_save_point_b():
    try:
        result = await _run_robot_op(
            ur10e_middleware.save_calibration_point_b, timeout_s=10.0
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Save Point B failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration save Point B failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/move-to-a")
async def calibration_move_to_a():
    try:
        result = await _run_robot_op(
            ur10e_middleware.move_to_calibration_point_a, timeout_s=15.0
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Move to Point A failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration move to Point A failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/move-to-b")
async def calibration_move_to_b():
    try:
        result = await _run_robot_op(
            ur10e_middleware.move_to_calibration_point_b, timeout_s=15.0
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503, detail=result.get("error") or "Move to Point B failed"
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration move to Point B failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/move-to-safe")
async def calibration_move_to_safe():
    try:
        result = await _run_robot_op(
            ur10e_middleware.move_to_safe_height, timeout_s=15.0
        )
        if not result.get("ok"):
            raise HTTPException(
                status_code=503,
                detail=result.get("error") or "Move to safe height failed",
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration move to safe height failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/clear")
async def calibration_clear():
    try:
        result = await _run_robot_op(ur10e_middleware.clear_calibration, timeout_s=5.0)
        if not result.get("ok"):
            raise HTTPException(
                status_code=503,
                detail=result.get("error") or "Clear calibration failed",
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration clear failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/calibration/restore")
async def calibration_restore():
    try:
        result = await _run_robot_op(
            ur10e_middleware.restore_calibration, timeout_s=10.0
        )
        if not result.get("ok"):
            if "No saved calibration found" in result.get("message", ""):
                return {
                    "ok": True,
                    "message": "No saved calibration to restore",
                    "restored": [],
                }
            raise HTTPException(
                status_code=503,
                detail=result.get("message") or "Restore calibration failed",
            )
        result["connected"] = ur10e_middleware.connected
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Calibration restore failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ===== WebSocket Endpoint =====
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")
    try:
        while True:
            # Keep the connection alive and wait for client to disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


# ===== WebSocket Streaming STT =====
@app.websocket("/ws/stt/stream")
async def websocket_stt_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time streaming speech-to-text.

    Client sends:
    - {"type": "config", "language": "zh-HK"} - Configure recognition
    - {"type": "audio", "data": "<base64 audio>"} - Audio chunks
    - {"type": "stop"} - Stop recognition

    Server sends:
    - {"type": "partial", "text": "...", "confidence": 0.0} - Interim results
    - {"type": "final", "text": "...", "confidence": 0.9, "alternatives": [...]} - Final result
    - {"type": "error", "message": "..."} - Error message
    - {"type": "status", "state": "listening|processing|stopped"} - State changes
    """
    await websocket.accept()
    logger.info("STT WebSocket client connected")

    if not AZURE_SPEECH_STT_ENABLED:
        await websocket.send_json(
            {"type": "error", "message": "Azure Speech SDK STT not configured"}
        )
        await websocket.close()
        return

    # Session state
    session_id = str(uuid.uuid4())
    language = "zh-HK"
    recognizer = None
    audio_stream = None
    is_running = False
    result_queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()

    def on_recognizing(evt):
        """Callback for interim/partial results"""
        if evt.result.text:
            asyncio.run_coroutine_threadsafe(
                result_queue.put(
                    {"type": "partial", "text": evt.result.text, "confidence": 0.0}
                ),
                main_loop,
            )

    def on_recognized(evt):
        """Callback for final results"""
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            confidence = 0.0
            alternatives = []

            if hasattr(evt.result, "json") and evt.result.json:
                try:
                    detail_data = json.loads(evt.result.json)
                    nbest = detail_data.get("NBest", [])
                    if nbest:
                        confidence = nbest[0].get("Confidence", 0.0)
                        alternatives = [
                            {
                                "text": alt.get("Display", ""),
                                "confidence": alt.get("Confidence", 0.0),
                            }
                            for alt in nbest[1:4]
                        ]
                except json.JSONDecodeError:
                    pass

            asyncio.run_coroutine_threadsafe(
                result_queue.put(
                    {
                        "type": "final",
                        "text": evt.result.text,
                        "confidence": confidence,
                        "alternatives": alternatives,
                    }
                ),
                main_loop,
            )

    def on_canceled(evt):
        """Callback for cancellation"""
        reason = str(evt.reason)
        error_details = getattr(evt, "error_details", "") or ""
        message = {
            "type": "status",
            "state": "canceled",
            "reason": reason,
        }
        if evt.reason == speechsdk.CancellationReason.Error:
            message = {
                "type": "error",
                "message": f"Recognition error: {error_details or reason}",
            }
        asyncio.run_coroutine_threadsafe(result_queue.put(message), main_loop)

    def on_session_stopped(evt):
        """Callback for session end"""
        asyncio.run_coroutine_threadsafe(
            result_queue.put(
                {"type": "status", "state": "stopped", "reason": "session_stopped"}
            ),
            main_loop,
        )

    async def send_results():
        """Task to send results from queue to WebSocket"""
        while is_running:
            try:
                result = await asyncio.wait_for(result_queue.get(), timeout=0.1)
                await websocket.send_json(result)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error sending STT result: {e}")
                break

    try:
        is_running = True
        result_task = asyncio.create_task(send_results())

        while True:
            try:
                message = await websocket.receive_json()
            except Exception:
                break

            msg_type = message.get("type")

            if msg_type == "config":
                new_language = message.get("language", "zh-HK")
                if new_language in ["zh-HK", "zh-CN", "en-US", "en-GB", "yue-CN"]:
                    language = new_language

                if recognizer is None:
                    speech_config = speechsdk.SpeechConfig(
                        subscription=AZURE_SPEECH_KEY, region=AZURE_SPEECH_REGION
                    )
                    speech_config.speech_recognition_language = language
                    speech_config.output_format = speechsdk.OutputFormat.Detailed
                    speech_config.set_property(
                        speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
                        str(STT_SEGMENTATION_SILENCE_MS),
                    )
                    # Emit tentative words promptly for wake detection. Massage
                    # parameters and start still require a final transcript.
                    speech_config.set_property(
                        speechsdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold,
                        "1",
                    )

                    stream_format = speechsdk.audio.AudioStreamFormat(
                        samples_per_second=16000, bits_per_sample=16, channels=1
                    )
                    audio_stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_format)
                    audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)

                    recognizer = speechsdk.SpeechRecognizer(
                        speech_config=speech_config, audio_config=audio_config
                    )

                    # Apply phrase boosting for English (helps non-native speakers)
                    _apply_phrase_boosting(recognizer, language)

                    recognizer.recognizing.connect(on_recognizing)
                    recognizer.recognized.connect(on_recognized)
                    recognizer.canceled.connect(on_canceled)
                    recognizer.session_stopped.connect(on_session_stopped)

                    # SDK lifecycle calls wait synchronously; keep audio/result
                    # delivery and other WebSocket sessions responsive meanwhile.
                    await asyncio.get_running_loop().run_in_executor(
                        None, recognizer.start_continuous_recognition
                    )

                    await websocket.send_json(
                        {
                            "type": "status",
                            "state": "listening",
                            "language": language,
                            "session_id": session_id,
                        }
                    )

            elif msg_type == "audio":
                if audio_stream and "data" in message:
                    try:
                        audio_data = base64.b64decode(message["data"])
                        audio_stream.write(audio_data)
                    except Exception as e:
                        logger.error(f"Error processing audio chunk: {e}")

            elif msg_type == "stop":
                if recognizer:
                    await asyncio.get_running_loop().run_in_executor(
                        None, recognizer.stop_continuous_recognition
                    )
                if audio_stream:
                    audio_stream.close()
                await websocket.send_json({"type": "status", "state": "stopped"})
                break

    except WebSocketDisconnect:
        logger.info(f"STT WebSocket client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"STT WebSocket error: {e}")
    finally:
        is_running = False
        if recognizer:
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None, recognizer.stop_continuous_recognition
                )
            except Exception:
                pass
        if audio_stream:
            try:
                audio_stream.close()
            except Exception:
                pass
        logger.info(f"STT WebSocket session ended: {session_id}")


# ===== STT HTTP Endpoints =====
@app.post("/api/stt/transcribe")
async def stt_transcribe(
    file: UploadFile = File(...),
    language: str = Form("zh-HK"),
):
    """
    Transcribe audio using Azure Cognitive Services Speech SDK.
    Supports Cantonese (zh-HK), Mandarin (zh-CN), and English (en-US).
    """
    if not AZURE_SPEECH_STT_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Azure Speech SDK STT not configured",
        )

    supported_languages = ["zh-HK", "zh-CN", "en-US", "en-GB", "yue-CN"]
    if language not in supported_languages:
        language = "zh-HK"

    audio_bytes = await file.read(MAX_STT_UPLOAD_BYTES + 1)
    if len(audio_bytes) > MAX_STT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large")
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _recognize_speech_from_bytes, audio_bytes, language
        )
        return result
    except Exception as e:
        logger.error(f"Azure Speech STT error: {e}")
        raise HTTPException(
            status_code=500, detail=f"Speech recognition failed: {str(e)}"
        )


def _get_massage_phrase_lists():
    """
    Returns phrase lists with common mispronunciations and homophones
    to help non-native English speakers with massage command recognition.
    """
    return {
        # Action commands - with common mispronunciations
        "actions": [
            "knead",
            "need",
            "kneed",
            "nid",  # knead → need/nid
            "push",
            "posh",
            "poosh",  # push
            "tap",
            "top",
            "tep",  # tap
            "spiral press",
            "spiral",
            "press",  # spiral_press
            "wave push",
            "wave",
            "wave pooch",  # wave_push
            "acupressure",
            "acupress",
            "akupressure",
            "acu pressure",  # acupressure
            "massage",
            "masage",
            "massaj",  # massage
        ],
        # Body parts - with common mispronunciations
        "body_parts": [
            "shoulder",
            "should",
            "sholder",  # shoulder
            "neck",
            "nek",
            "kneck",  # neck
            "back",
            "bak",  # back
            "waist",
            "waste",  # waist → waste (homophone)
            "leg",
            "legs",  # leg
            "arm",
            "arms",  # arm
            "hip",
            "hips",  # hip
            "thigh",
            "thighs",  # thigh
        ],
        # Intensity/adjustment commands
        "intensity": [
            "lighter",
            "light",
            "lite",  # lighter
            "harder",
            "hard",
            "more hard",  # harder
            "faster",
            "fast",
            "more fast",  # faster
            "slower",
            "slow",
            "more slow",  # slower
            "gentle",
            "soft",
            "softer",  # gentle/soft
            "strong",
            "stronger",  # strong
        ],
        # Control commands
        "control": [
            "stop",
            "stop it",  # stop
            "resume",
            "continue",
            "go on",  # resume
            "pause",
            "hold",  # pause
            "start",
            "begin",  # start
        ],
    }


def _apply_phrase_boosting(recognizer, language: str):
    """
    Apply phrase list boosting to help non-native speakers.
    Only applies to English recognition.
    """
    if not language.startswith("en"):
        return

    try:
        phrase_list = speechsdk.languageconfig.PhraseListGrammar.from_recognizer(
            recognizer
        )
        phrases = _get_massage_phrase_lists()

        # Add all phrase categories
        for category, words in phrases.items():
            for word in words:
                phrase_list.addPhrase(word)
    except Exception as e:
        logger.debug(f"Phrase boosting failed (non-critical): {e}")


def _recognize_speech_from_bytes(audio_bytes: bytes, language: str) -> dict:
    """
    Synchronous speech recognition using Azure Speech SDK.
    Called from thread pool executor.
    """
    speech_config = speechsdk.SpeechConfig(
        subscription=AZURE_SPEECH_KEY, region=AZURE_SPEECH_REGION
    )
    speech_config.speech_recognition_language = language
    speech_config.output_format = speechsdk.OutputFormat.Detailed

    audio_stream = speechsdk.audio.PushAudioInputStream()
    audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, audio_config=audio_config
    )

    # Apply phrase boosting for English (helps non-native speakers)
    _apply_phrase_boosting(recognizer, language)

    audio_stream.write(audio_bytes)
    audio_stream.close()

    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        detailed = result.json if hasattr(result, "json") else None
        confidence = 0.0
        alternatives = []

        if detailed:
            try:
                detail_data = json.loads(detailed)
                nbest = detail_data.get("NBest", [])
                if nbest:
                    confidence = nbest[0].get("Confidence", 0.0)
                    alternatives = [
                        {
                            "text": alt.get("Display", ""),
                            "confidence": alt.get("Confidence", 0.0),
                        }
                        for alt in nbest[1:5]
                    ]
            except json.JSONDecodeError:
                pass

        return {
            "text": result.text,
            "confidence": confidence,
            "language": language,
            "alternatives": alternatives,
            "provider": "azure-speech-sdk",
            "success": True,
        }

    elif result.reason == speechsdk.ResultReason.NoMatch:
        return {
            "text": "",
            "confidence": 0.0,
            "language": language,
            "alternatives": [],
            "provider": "azure-speech-sdk",
            "success": False,
            "error": "No speech recognized",
        }

    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        error_msg = f"Recognition canceled: {cancellation.reason}"
        if cancellation.reason == speechsdk.CancellationReason.Error:
            error_msg = f"Error: {cancellation.error_details}"
        return {
            "text": "",
            "confidence": 0.0,
            "language": language,
            "alternatives": [],
            "provider": "azure-speech-sdk",
            "success": False,
            "error": error_msg,
        }

    return {
        "text": "",
        "confidence": 0.0,
        "language": language,
        "alternatives": [],
        "provider": "azure-speech-sdk",
        "success": False,
        "error": f"Unknown result reason: {result.reason}",
    }


@app.get("/api/stt/status")
async def stt_status():
    """
    Get STT service status and available providers.
    """
    providers = []

    if AZURE_SPEECH_STT_ENABLED:
        providers.append(
            {
                "name": "azure-speech-sdk",
                "available": True,
                "languages": ["zh-HK", "zh-CN", "en-US", "yue-CN"],
                "features": ["confidence", "alternatives", "streaming"],
            }
        )

    providers.append(
        {
            "name": "browser",
            "available": True,
            "languages": ["zh-HK", "zh-CN", "en-US"],
            "features": ["offline", "no-api-key"],
        }
    )

    return {
        "primary": "azure-speech-sdk" if AZURE_SPEECH_STT_ENABLED else "browser",
        "providers": providers,
        "fallback_chain": ["azure-speech-sdk", "browser"],
    }


@app.get("/api/stt/transcribe/health")
async def stt_transcribe_health():
    """Lightweight health check for frontend monitors."""
    return {
        "ok": True,
        "azure_speech_enabled": AZURE_SPEECH_STT_ENABLED,
    }


# ===== 啟動配置 =====
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 5000))
    # Force HTTP for local WSL + Windows development; do not enable SSL even if certs exist.
    protocol = "http"

    print("Massage Control Server")
    print(
        f"UI: {protocol}://127.0.0.1:{port}/  |  API docs: {protocol}://127.0.0.1:{port}/docs"
    )
    print("Press Ctrl+C to stop.")

    run_options = {
        "host": "0.0.0.0",
        "port": port,
        "reload": False,
        "access_log": False,
        "log_level": "warning",
    }

    uvicorn.run(app, **run_options)
