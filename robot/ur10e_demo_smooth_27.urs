# ============================================================
# UR10e DEMO - movel based (mode1_to4 movement) + Z-only force_mode
# URSim / PolyScope 5.x
# ============================================================

# ---------------------------
# RTDE Register Map
# ---------------------------
IN_CMD = 18   # 0=Stop, 1..4=Mode, 5=Pause, 6=Resume, 7/8=home XYZ/rotation
IN_SPEED_X100 = 19   # optional speed scaling (not mandatory)
IN_FORCE_X10 = 20   # target contact force in N*10 (e.g. 25=2.5N, 50=5N, 80=8N)
IN_DURATION_S = 21   # duration in seconds
IN_CMD_SEQ = 22
IN_HEARTBEAT = 21 # double register; backend increments every 250ms
 # IN_FORCE_ENABLE register not used here (RTDE IO supports only 18-22)

OUT_STATE = 12 # 0=IDLE, 1=RUNNING, 2=PAUSED, 3=RETURNING_HOME
OUT_ERROR_CODE = 13 # 0=OK, 1=Unknown, 2=Force, 3=Unarmed, 4=Duration, 5=Heartbeat
OUT_CURRENT_MODE = 14
OUT_PROGRESS = 15
OUT_ACK_SEQ = 16
OUT_CAL_STATUS = 17

STATE_IDLE = 0
STATE_RUNNING = 1
STATE_PAUSED = 2
STATE_RETURNING_HOME = 3

# Upload home in two acknowledged halves using supported double inputs.
IN_HOME_0 = 18
IN_HOME_1 = 19
IN_HOME_2 = 20
CMD_HOME_XYZ = 7
CMD_HOME_ROTATION = 8

ERR_OK = 0
ERR_UNKNOWN_CMD = 1
ERR_OVERFORCE = 2
ERR_NOT_ARMED = 3
ERR_DURATION = 4
ERR_HEARTBEAT = 5
HEARTBEAT_TIMEOUT_S = 3.0

# ---------------------------
# Motion parameters (validate with the installed tool and workspace)
# ---------------------------
A_SLOW = 0.40
V_SLOW = 0.3
R_BLEND = 0.005   # 5mm blend for smooth continuous motion
R_BLEND_VIB = 0.001  # 1mm blend for micro-vibration mode
DT = 0.05   # logical time step for movement math (movel is blocking anyway)

# ---------------------------
# RG2 parameters (mode 4)
# ---------------------------
RG2_CLOSE_WIDTH = 20
RG2_CLOSE_FORCE = 10.0
RG2_OPEN_WIDTH = 80
RG2_OPEN_FORCE = 10.0
RG2_STEP_UP_M = 0.050
RG2_STEP_Y_M = 0.050
MODE4_REPEAT_COUNT = 4
RG2_GRIPPER_CYCLES = 1
MOVE_STEPS_UP = 1
MOVE_STEPS_YZ = 1

# ---------------------------
# Force control parameters
# ---------------------------
FZ_HARD_LIMIT = 25.0      # N, force-vector magnitude guard; not a certified safety limit
FORCE_Z_SPEED_MPS = 0.10 # compliant-axis speed limit in m/s; not a travel-distance limit

# ============================================================
# Helpers
# ============================================================
# Blocking arm/gripper calls run in one worker so the command loop can keep
# polling STOP/PAUSE. Kill the worker before taking control with stopj().
blocking_action_handle = 0
blocking_action_done = False
blocking_action_kind = 0
blocking_action_pose = p[0, 0, 0, 0, 0, 0]
blocking_action_blend = 0
blocking_return_lift = p[0, 0, 0, 0, 0, 0]
blocking_return_travel = p[0, 0, 0, 0, 0, 0]
blocking_return_end = p[0, 0, 0, 0, 0, 0]
blocking_action_width = 0
blocking_action_force = 0

thread blocking_action_worker():
  if blocking_action_kind == 1:
    movel(blocking_action_pose, a = A_SLOW, v = V_SLOW, r = blocking_action_blend)
  elif blocking_action_kind == 3:
    # Keep all three moves in one thread so the planner can blend the corners.
    # No polling sleeps, joins, or thread restarts between these moves.
    movel(blocking_return_lift, a = A_SLOW, v = V_SLOW, r = R_BLEND)
    movel(blocking_return_travel, a = A_SLOW, v = V_SLOW, r = R_BLEND)
    movel(blocking_return_end, a = A_SLOW, v = V_SLOW, r = 0)
  else:
    rg_grip(blocking_action_width, blocking_action_force, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
  end
  global blocking_action_done = True
end

def cancel_blocking_action():
  if blocking_action_handle != 0:
    kill blocking_action_handle
    global blocking_action_handle = 0
  end
end

def set_outputs(state, mode, prog, ack, err):
  # Repeated progress updates for the same sequence must not erase a command
  # rejection before the backend can observe its ACK.
  if ack != output_seq:
    global output_seq = ack
    global output_error = err
  elif err != ERR_OK:
    global output_error = err
  end
  write_output_integer_register(OUT_STATE, state)
  write_output_integer_register(OUT_CURRENT_MODE, mode)
  write_output_integer_register(OUT_PROGRESS, prog)
  write_output_integer_register(OUT_ERROR_CODE, output_error)
  write_output_integer_register(OUT_CAL_STATUS, 0)
  # Publish ACK last so it cannot confirm stale state/error fields.
  write_output_integer_register(OUT_ACK_SEQ, ack)
end

def stop_motion():
  stopj(0.5)
end

def end_force_safe():
  # end_force_mode() is safe even if not in force mode (on most versions)
  end_force_mode()
end

def force_limit_exceeded(force_sample):
  # Validate each force component before arithmetic. Reject invalid samples
  # and values already beyond the limit without squaring them (overflow).
  local fx = force_sample[0]
  local fy = force_sample[1]
  local fz = force_sample[2]
  if (fx != fx) or (fy != fy) or (fz != fz):
    return True
  end
  if (fx > FZ_HARD_LIMIT) or (fx < -FZ_HARD_LIMIT):
    return True
  end
  if (fy > FZ_HARD_LIMIT) or (fy < -FZ_HARD_LIMIT):
    return True
  end
  if (fz > FZ_HARD_LIMIT) or (fz < -FZ_HARD_LIMIT):
    return True
  end
  # Compare squared magnitude with squared limit; no square root is needed.
  # Keep products and additions separate for unambiguous controller arithmetic.
  local fx_sq = fx * fx
  local fy_sq = fy * fy
  local fz_sq = fz * fz
  local force_sq = fx_sq + fy_sq
  force_sq = force_sq + fz_sq
  local limit_sq = FZ_HARD_LIMIT * FZ_HARD_LIMIT
  return (force_sq != force_sq) or (force_sq < 0.0) or (force_sq > limit_sq)
end

def overforce_check_and_stop():
  local force_sample = get_tcp_force()
  # Force can point along any base-frame axis when the TCP is rotated.
  if force_limit_exceeded(force_sample):
    cancel_blocking_action()
    end_force_safe()
    stop_motion()
    rg2_open_only()
    global active_mode = 0
    global paused_mode = 0
    global return_home_pending = False
    global system_armed = False
    global safety_fault_latched = True
    set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OVERFORCE)
    return True
  end
  return False
end

def apply_force_mode_z(task_frame, fz_target):
  # Z-only compliant, keep others stiff
  sel = [0, 0, 1, 0, 0, 0]
  wrench = [0, 0, fz_target, 0, 0, 0]   # Fz positive (you confirmed contact force is positive)
  # Compliant Z uses a speed limit; other axes use deviation limits.
  lim = [0.0, 0.0, FORCE_Z_SPEED_MPS, 0.0, 0.0, 0.0]

  # type=2 commonly used in examples for "force frame/task frame" behavior.
  # If you observe direction reversed, change type to 1 or flip wrench sign.
  force_mode(task_frame, sel, wrench, 2, lim)
end

def rg2_close_open():
  # Keep RG2 calls minimal and non-interactive to avoid stopping the host program
  # on installations where optional helper APIs differ.
  rg_grip(RG2_CLOSE_WIDTH, RG2_CLOSE_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
  rg_grip(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
end

def rg2_open_only():
  # Release after stopping without delaying the STOP acknowledgement for travel.
  rg_grip(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, tool_index = 0, blocking = False, depth_comp = False, popupmsg = False)
end

def rg2_cycles():
  # Perform 3 close/open cycles at current position
  i = 0
  while i < RG2_GRIPPER_CYCLES:
    rg2_close_open()
    i = i + 1
  end
end

def request_stop():
  cancel_blocking_action()
  end_force_safe()
  stop_motion()
  rg2_open_only()
  global active_mode = 0
  global paused_mode = 0
  # duration=-1 is a connection/arming STOP: never initiate travel.
  global return_home_pending = (read_input_integer_register(IN_DURATION_S) != -1) and (not safety_fault_latched)
  if read_input_integer_register(IN_DURATION_S) == -1:
    global safety_fault_latched = False
  end
  if return_home_pending:
    set_outputs(STATE_RETURNING_HOME, 0, 0, last_seq, ERR_OK)
  else:
    set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
  end
end

def return_home():
  # Open fully before moving. Release and travel remain interruptible.
  if grip_interruptible(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, 0):
    return None
  end
  # Reach the home clearance plane along the saved tool's physical-up axis.
  # Repeated STOPs or a STOP during a lift must not add another 50mm each time.
  home_lifted = pose_trans(home_pose, p[0, 0, -RG2_STEP_UP_M, 0, 0, 0])
  cur = get_actual_tcp_pose()
  ux = (home_lifted[0] - home_pose[0]) / RG2_STEP_UP_M
  uy = (home_lifted[1] - home_pose[1]) / RG2_STEP_UP_M
  uz = (home_lifted[2] - home_pose[2]) / RG2_STEP_UP_M
  height = (cur[0] - home_pose[0]) * ux + (cur[1] - home_pose[1]) * uy + (cur[2] - home_pose[2]) * uz
  lift_m = RG2_STEP_UP_M - height
  if lift_m > 0:
    lifted = p[cur[0] + ux * lift_m, cur[1] + uy * lift_m, cur[2] + uz * lift_m, cur[3], cur[4], cur[5]]
    if movel_interruptible(lifted, 0, 0):
      return None
    end
  end
  if movel_interruptible(home_lifted, 0, 0):
    return None
  end
  if movel_interruptible(home_pose, 0, 0):
    return None
  end
  global return_home_pending = False
  set_outputs(STATE_IDLE, 0, 100, last_seq, ERR_OK)
end

def check_session_safety(prog):
  # Poll these while movel/rg_grip workers are blocked as well as between legs.
  if (active_mode > 0) or (paused_mode > 0) or return_home_pending:
    if heartbeat_elapsed_s >= HEARTBEAT_TIMEOUT_S:
      cancel_blocking_action()
      end_force_safe()
      stop_motion()
      rg2_open_only()
      global active_mode = 0
      global paused_mode = 0
      global return_home_pending = False
      global system_armed = False
      global safety_fault_latched = True
      set_outputs(STATE_IDLE, 0, prog, last_seq, ERR_HEARTBEAT)
      return 3
    end
    if overforce_check_and_stop():
      return 3
    end
  end
  if (active_mode > 0) and (session_duration_s > 0) and (session_elapsed_s >= session_duration_s):
    request_stop()
    return 1
  end
  return 0
end

def check_stop_or_pause(prog):
  safety_result = check_session_safety(prog)
  if safety_result > 0:
    return safety_result
  end
  live_cmd = read_input_integer_register(IN_CMD)
  live_seq = read_input_integer_register(IN_CMD_SEQ)
  if live_seq != last_seq:
    if return_home_pending and (live_cmd != 0) and (live_cmd != 5):
      return 0
    end
    global last_seq = live_seq
    if live_cmd == 0:
      # STOP
      request_stop()
      return 1
    elif live_cmd == 5:
      # PAUSE
      cancel_blocking_action()
      end_force_safe()
      stop_motion()
      global return_home_pending = False
      global paused_mode = active_mode
      global active_mode = 0
      set_outputs(STATE_PAUSED, paused_mode, prog, last_seq, ERR_OK)
      return 2
    else:
      # Only STOP/PAUSE are supported during an active blocking action.
      # Report a rejection without replacing the current movement.
      set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_UNKNOWN_CMD)
    end
  end
  return 0
end

def wait_for_blocking_action(prog):
  global blocking_action_done = False
  global blocking_action_handle = run blocking_action_worker()
  while not blocking_action_done:
    if check_stop_or_pause(prog) > 0:
      return True
    end
    sleep(0.02)
  end
  join blocking_action_handle
  global blocking_action_handle = 0
  # Catch a command that arrived as the worker completed.
  return check_stop_or_pause(prog) > 0
end

def movel_interruptible(target_pose, blend, prog):
  if check_stop_or_pause(prog) > 0:
    return True
  end
  global blocking_action_kind = 1
  global blocking_action_pose = target_pose
  global blocking_action_blend = blend
  return wait_for_blocking_action(prog)
end

def batch_return_interruptible(frame, station_y, prog):
  if check_stop_or_pause(prog) > 0:
    return True
  end
  global blocking_return_lift = pose_trans(frame, p[0, station_y, -RG2_STEP_UP_M, 0, 0, 0])
  global blocking_return_travel = pose_trans(frame, p[0, 0, -RG2_STEP_UP_M, 0, 0, 0])
  global blocking_return_end = frame
  global blocking_action_kind = 3
  return wait_for_blocking_action(prog)
end

def grip_interruptible(width, force, prog):
  if check_stop_or_pause(prog) > 0:
    return True
  end
  global blocking_action_kind = 2
  global blocking_action_width = width
  global blocking_action_force = force
  return wait_for_blocking_action(prog)
end

def wait_interruptible(wait_s, prog):
  t = 0.0
  while t < wait_s:
    if check_stop_or_pause(prog) > 0:
      return True
    end
    sleep(0.02)
    t = t + 0.02
  end
  return False
end

def rg2_close_open_interruptible(prog):
  if check_stop_or_pause(prog) > 0:
    return True
  end
  # Blocking gripper action ensures we don't move before close/open is complete.
  if grip_interruptible(RG2_CLOSE_WIDTH, RG2_CLOSE_FORCE, prog):
    return True
  end
  if grip_interruptible(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, prog):
    return True
  end
  return False
end

def rg2_cycles_interruptible(prog):
  i = 0
  while i < RG2_GRIPPER_CYCLES:
    if rg2_close_open_interruptible(prog):
      return True
    end
    i = i + 1
  end
  return False
end

def move_to_pose_interruptible(target_pose, steps, prog):
  i = 0
  cur = get_actual_tcp_pose()
  while i < steps:
    if check_stop_or_pause(prog) > 0:
      return True
    end
    a = (i + 1) / steps
    px = cur[0] + (target_pose[0] - cur[0]) * a
    py = cur[1] + (target_pose[1] - cur[1]) * a
    pz = cur[2] + (target_pose[2] - cur[2]) * a
    waypoint = p[px, py, pz, target_pose[3], target_pose[4], target_pose[5]]
    # Reach every leg endpoint exactly before gripping or starting the next leg.
    # A blended endpoint can be skipped and must not become the next reference.
    blend = R_BLEND
    if i == steps - 1:
      blend = 0
    end
    if movel_interruptible(waypoint, blend, prog):
      return True
    end
    i = i + 1
  end
  return False
end

def move_in_frame_interruptible(frame, dx, dy, dz, steps, prog):
  # Offsets are absolute within the saved TCP frame, never accumulated from
  # the live TCP pose (which can differ due to blending or force compliance).
  target = pose_trans(frame, p[dx, dy, dz, 0, 0, 0])
  return move_to_pose_interruptible(target, steps, prog)
end

# ============================================================
# Main loop
# ============================================================

active_mode = 0
output_seq = -1
output_error = ERR_OK
paused_mode = 0
last_seq = -1
last_force_x10 = 0
system_armed = False
safety_fault_latched = False
return_home_pending = False
# Backend replaces this standalone fallback with its startup pose.
home_pose = get_actual_tcp_pose()
home_xyz = p[0, 0, 0, 0, 0, 0]
session_duration_s = 0
session_elapsed_s = 0.0
heartbeat_elapsed_s = 0.0
last_heartbeat = read_input_float_register(IN_HEARTBEAT)

# Controller time advances independently of blocking arm/gripper calls and the
# browser's timer. Paused time does not consume the selected session duration.
thread session_clock():
  while True:
    if active_mode > 0:
      global session_elapsed_s = session_elapsed_s + get_steptime()
    end
    heartbeat = read_input_float_register(IN_HEARTBEAT)
    if heartbeat != last_heartbeat:
      global last_heartbeat = heartbeat
      global heartbeat_elapsed_s = 0.0
    else:
      global heartbeat_elapsed_s = heartbeat_elapsed_s + get_steptime()
    end
    sync()
  end
end
session_clock_handle = run session_clock()

# Safety bootstrapping:
# - Latch current seq at startup so stale pre-existing cmd/seq is not replayed.
# - Require an explicit STOP command with a NEW seq to arm command execution.
last_seq = read_input_integer_register(IN_CMD_SEQ)
set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)

while True:

  check_session_safety(0)
  cmd = read_input_integer_register(IN_CMD)
  seq = read_input_integer_register(IN_CMD_SEQ)

  # ----------------------------------------------------------
  # New command (seq/ack handshake)
  # ----------------------------------------------------------
  if seq != last_seq:
    last_seq = seq
    end_force_safe()

    if cmd == CMD_HOME_XYZ:
      home_xyz = p[read_input_float_register(IN_HOME_0), read_input_float_register(IN_HOME_1), read_input_float_register(IN_HOME_2), 0, 0, 0]
      set_outputs(STATE_IDLE, CMD_HOME_XYZ, 0, last_seq, ERR_OK)
    elif cmd == CMD_HOME_ROTATION:
      home_pose = p[home_xyz[0], home_xyz[1], home_xyz[2], read_input_float_register(IN_HOME_0), read_input_float_register(IN_HOME_1), read_input_float_register(IN_HOME_2)]
      set_outputs(STATE_IDLE, CMD_HOME_ROTATION, 0, last_seq, ERR_OK)
    elif not system_armed:
      # Ignore all non-stop commands until we receive an explicit STOP edge.
      # This blocks stale motion commands after backend/URScript restarts.
      if cmd == 0:
        system_armed = True
        request_stop()
      else:
        active_mode = 0
        paused_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_NOT_ARMED)
      end
    else:
      if cmd == 0:
        # STOP: abort everything, clear any paused state
        request_stop()

      elif (cmd >= 1) and (cmd <= 4):
        # START / RESUME-AS-NEW: start massage (all modes map to mode 4)
        session_duration_s = read_input_integer_register(IN_DURATION_S)
        session_elapsed_s = 0.0
        if (session_duration_s <= 0) or (session_duration_s > 1800):
          active_mode = 0
          paused_mode = 0
          set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_DURATION)
        elif heartbeat_elapsed_s >= HEARTBEAT_TIMEOUT_S:
          active_mode = 0
          paused_mode = 0
          set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_HEARTBEAT)
        else:
          active_mode = 4
          paused_mode = 0
          set_outputs(STATE_RUNNING, active_mode, 0, last_seq, ERR_OK)
        end

      elif cmd == 5:
        # PAUSE: stop motion, save active mode so Resume can restore it
        end_force_safe()
        stop_motion()
        return_home_pending = False
        if active_mode > 0:
          paused_mode = active_mode
        end
        active_mode = 0
        set_outputs(STATE_PAUSED, paused_mode, 0, last_seq, ERR_OK)

      elif cmd == 6:
        # RESUME: restore paused mode (if any) and restart motion
        if paused_mode > 0:
          active_mode = paused_mode
          paused_mode = 0
          set_outputs(STATE_RUNNING, active_mode, 0, last_seq, ERR_OK)
        else:
          # Nothing was paused; treat as idle ack
          set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
        end

      else:
        active_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_UNKNOWN_CMD)
      end
    end
  end

  # ----------------------------------------------------------
  # Run active mode (movel based, with Z-only force_mode)
  # ----------------------------------------------------------
  if return_home_pending:
    return_home()
  elif active_mode > 0:

    # capture center pose once (like mode1_to4)
    start_pose = get_actual_tcp_pose()
    rx = start_pose[3]
    ry = start_pose[4]
    rz = start_pose[5]

    if active_mode == 4:
      # Mode4 runs continuously in batches until STOP/PAUSE/overforce.
      task_frame = start_pose
      while active_mode == 4:
        duration = MODE4_REPEAT_COUNT
        elapsed = 0.0
        prog = 0
        completed_normally = True
        set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_OK)

        while elapsed < duration:
          # Interrupt handling with fast polling.
          if check_stop_or_pause(prog) > 0:
            completed_normally = False
            break
          end

          fx10 = read_input_integer_register(IN_FORCE_X10)
          if fx10 != last_force_x10:
            if fx10 < 0:
              textmsg("force_active=1 fx10=" + to_str(fx10))
            else:
              textmsg("force_active=0 fx10=" + to_str(fx10))
            end
            last_force_x10 = fx10
          end

          if fx10 < 0:
            # NOTE: URScript has no built-in abs(); use explicit if/else for safety.
            fz_target = (-fx10) / 10.0
            apply_force_mode_z(task_frame, fz_target)
            if overforce_check_and_stop():
              active_mode = 0
              completed_normally = False
              set_outputs(STATE_IDLE, 0, prog, last_seq, ERR_OVERFORCE)
              break
            end
          else:
            end_force_safe()
          end

          # Requested calf massage sequence (TCP frame):
          # 1) close/open
          # 2) while open: up 50mm, +Y 50mm
          # 3) down 50mm, close/open
          if rg2_cycles_interruptible(prog):
            completed_normally = False
            break
          end

          # In this setup, physical "up" is opposite TCP +Z. All stations
          # share the original TCP frame, even when that frame is rotated.
          station_y = elapsed * RG2_STEP_Y_M
          next_station_y = (elapsed + 1) * RG2_STEP_Y_M
          if move_in_frame_interruptible(start_pose, 0, station_y, -RG2_STEP_UP_M, MOVE_STEPS_UP, prog):
            completed_normally = False
            break
          end
          if move_in_frame_interruptible(start_pose, 0, next_station_y, -RG2_STEP_UP_M, MOVE_STEPS_YZ, prog):
            completed_normally = False
            break
          end

          if move_in_frame_interruptible(start_pose, 0, next_station_y, 0, MOVE_STEPS_UP, prog):
            completed_normally = False
            break
          end
          if rg2_cycles_interruptible(prog):
            completed_normally = False
            break
          end
          sync()

          # Post-move safety check too (catch transient spike)
          if overforce_check_and_stop():
            active_mode = 0
            completed_normally = False
            set_outputs(STATE_IDLE, 0, prog, last_seq, ERR_OVERFORCE)
            break
          end

          elapsed = elapsed + 1
          prog = floor(100 * elapsed / duration)
          if prog > 99:
            prog = 99
          end
          set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_OK)
        end

        end_force_safe()

        if completed_normally:
          # One continuous lift/travel/descent path in the saved TCP frame.
          # Only the final contact pose is a stop point before the next clamp.
          if batch_return_interruptible(start_pose, elapsed * RG2_STEP_Y_M, prog):
            completed_normally = False
          else:
            sync()
          end
        end

        if completed_normally == False:
          break
        end
      end
    else:
      duration = read_input_integer_register(IN_DURATION_S)
      if duration <= 0:
        active_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
        continue
      end
      elapsed = 0.0
      prog = 0

      # Use start_pose as task frame reference
      task_frame = start_pose

      completed_normally = True
      while elapsed < duration:

        # Interrupt handling with fast polling.
        if check_stop_or_pause(prog) > 0:
          completed_normally = False
          break
        end

        fx10 = read_input_integer_register(IN_FORCE_X10)
        if fx10 != last_force_x10:
          if fx10 < 0:
            textmsg("force_active=1 fx10=" + to_str(fx10))
          else:
            textmsg("force_active=0 fx10=" + to_str(fx10))
          end
          last_force_x10 = fx10
        end

        if fx10 < 0:
          # NOTE: URScript has no built-in abs(); use explicit if/else for safety.
          fz_target = (-fx10) / 10.0
          apply_force_mode_z(task_frame, fz_target)
          if overforce_check_and_stop():
            active_mode = 0
            completed_normally = False
            set_outputs(STATE_IDLE, 0, prog, last_seq, ERR_OVERFORCE)
            break
          end
        else:
          end_force_safe()
        end

        # Time variable for patterns (logical)
        t = elapsed

        # ----------------------
        # Mode 1: slow circle
        # ----------------------
        if active_mode == 1:
          r = 0.02        # 20mm
          f = 0.5         # 0.5Hz
          dx = r * cos(2 * 3.1415926 * f * t)
          dy = r * sin(2 * 3.1415926 * f * t)
          dz = 0.0

          # ----------------------
          # Mode 2: slow push (Y)
          # ----------------------
        elif active_mode == 2:
          a = 0.03        # 30mm
          f = 0.8
          dx = 0.0
          dy = a * sin(2 * 3.1415926 * f * t)
          dz = 0.0

          # ----------------------
          # Mode 3: spiral knead
          # ----------------------
        else:
          max_r = 0.025   # 25mm
          f = 0.6
          p = elapsed / duration
          if p > 1.0:
            p = 1.0
          end
          r = max_r * p
          dx = r * cos(2 * 3.1415926 * f * t)
          dy = r * sin(2 * 3.1415926 * f * t)
          dz = 0.0
        end

        # target pose keeps orientation fixed (stable like mode1_to4)
        target = p[
          start_pose[0] + dx,
          start_pose[1] + dy,
          start_pose[2] + dz,
          rx, ry, rz
        ]

        # Smoothness: use blend radius so the TCP doesn't decel-to-zero at every waypoint
        if movel_interruptible(target, R_BLEND, prog):
          completed_normally = False
          break
        end
        sync()

        # Post-move safety check too (catch transient spike)
        if overforce_check_and_stop():
          active_mode = 0
          completed_normally = False
          set_outputs(STATE_IDLE, 0, prog, last_seq, ERR_OVERFORCE)
          break
        end

        elapsed = elapsed + DT

        prog = floor(100 * elapsed / duration)
        if prog > 99:
          prog = 99
        end
        set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_OK)

      end

      # ensure force mode cleared when finishing normally
      end_force_safe()

      # Return to start pose (A) after a normal completion so next task starts at A
      if completed_normally:
        if movel_interruptible(start_pose, 0, prog):
          completed_normally = False
        end
        sync()
      end
    end

    if active_mode != 0:
      active_mode = 0
      set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
    end

  else:
    sync()
  end

end
