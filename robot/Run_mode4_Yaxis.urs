# ============================================================
# UR10e DEMO - movel based (mode 4: Y-axis calf massage)
# URSim / PolyScope 5.x
# ============================================================

# ---------------------------
# RTDE Register Map
# ---------------------------
IN_CMD = 18   # 0=Stop, 4=Mode4, 5=Pause, 6=Resume
IN_CMD_SEQ = 22

OUT_STATE = 12 # 0=IDLE, 1=RUNNING, 2=PAUSED
OUT_ERROR_CODE = 13 # 0=OK, 1=Unknown cmd
OUT_CURRENT_MODE = 14
OUT_PROGRESS = 15
OUT_ACK_SEQ = 16
OUT_CAL_STATUS = 17

STATE_IDLE = 0
STATE_RUNNING = 1
STATE_PAUSED = 2

ERR_OK = 0
ERR_UNKNOWN_CMD = 1

# ---------------------------
# Motion parameters (SAFE & SLOW)
# ---------------------------
A_SLOW = 0.40
V_SLOW = 0.3
R_BLEND = 0.005   # 5mm blend for smooth continuous motion

# ---------------------------
# RG2 parameters (mode 4)
# ---------------------------
RG2_CLOSE_WIDTH = 30
RG2_CLOSE_FORCE = 5.0
RG2_OPEN_WIDTH = 80
RG2_OPEN_FORCE = 10.0
RG2_STEP_UP_M = 0.050
RG2_CONTACT_MARGIN = 0.010   # 10mm gap: gripper close bridges the last distance to calf
RG2_STEP_Y_M = 0.050
MODE4_REPEAT_COUNT = 4
RG2_GRIPPER_CYCLES = 1
MOVE_STEPS_UP = 1
MOVE_STEPS_YZ = 1
MOVE_STEPS_RETURN = 8

# ============================================================
# Helpers
# ============================================================
def set_outputs(state, mode, prog, ack, err):
  write_output_integer_register(OUT_STATE, state)
  write_output_integer_register(OUT_CURRENT_MODE, mode)
  write_output_integer_register(OUT_PROGRESS, prog)
  write_output_integer_register(OUT_ACK_SEQ, ack)
  write_output_integer_register(OUT_ERROR_CODE, err)
  write_output_integer_register(OUT_CAL_STATUS, 0)
end

def stop_motion():
  stopj(0.5)
end

def rg2_close_open():
  rg_grip(RG2_CLOSE_WIDTH, RG2_CLOSE_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
  rg_grip(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
end

def rg2_open_only():
  rg_grip(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
end

def check_stop_or_pause(prog):
  live_cmd = read_input_integer_register(IN_CMD)
  live_seq = read_input_integer_register(IN_CMD_SEQ)
  if live_seq != last_seq:
    global last_seq = live_seq
    if live_cmd == 0:
      # STOP — robot is already stationary (called between blocking ops);
      # do NOT call stop_motion() here as stopj zeros the PolyScope speed
      # slider, which prevents the recovery movel from executing.
      rg2_open_only()
      global active_mode = 0
      global paused_mode = 0
      set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
      return 1
    elif live_cmd == 5:
      # PAUSE — same reason: no stopj here.
      global paused_mode = active_mode
      global active_mode = 0
      set_outputs(STATE_PAUSED, paused_mode, prog, last_seq, ERR_OK)
      return 2
    end
  end
  return 0
end

def rg2_close_open_interruptible(prog):
  if check_stop_or_pause(prog) > 0:
    return True
  end
  rg_grip(RG2_CLOSE_WIDTH, RG2_CLOSE_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
  if check_stop_or_pause(prog) > 0:
    return True
  end
  rg_grip(RG2_OPEN_WIDTH, RG2_OPEN_FORCE, tool_index = 0, blocking = True, depth_comp = False, popupmsg = False)
  if check_stop_or_pause(prog) > 0:
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

def move_tcp_offset_interruptible(dx, dy, dz, steps, prog):
  i = 0
  stepx = dx / steps
  stepy = dy / steps
  stepz = dz / steps
  while i < steps:
    if check_stop_or_pause(prog) > 0:
      return True
    end
    target = pose_trans(get_actual_tcp_pose(), p[stepx, stepy, stepz, 0, 0, 0])
    movel(target, a = A_SLOW, v = V_SLOW, r = R_BLEND)
    i = i + 1
  end
  return False
end

# ============================================================
# Main loop
# ============================================================

active_mode = 0
paused_mode = 0
last_seq = -1
system_armed = True

# Safety bootstrapping:
# - Latch current seq at startup so stale pre-existing cmd/seq is not replayed.
# - Require an explicit STOP command with a NEW seq to arm command execution.
last_seq = read_input_integer_register(IN_CMD_SEQ)
set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)

while True:

  cmd = read_input_integer_register(IN_CMD)
  seq = read_input_integer_register(IN_CMD_SEQ)

  # ----------------------------------------------------------
  # New command (seq/ack handshake)
  # ----------------------------------------------------------
  if seq != last_seq:
    last_seq = seq

    if not system_armed:
      # Ignore all non-stop commands until we receive an explicit STOP edge.
      # This blocks stale motion commands after backend/URScript restarts.
      if cmd == 0:
        system_armed = True
        stop_motion()
        rg2_open_only()
        active_mode = 0
        paused_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
      else:
        active_mode = 0
        paused_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)
      end
    else:
      if cmd == 0:
        # STOP: abort everything, clear any paused state
        stop_motion()
        rg2_open_only()
        active_mode = 0
        paused_mode = 0
        set_outputs(STATE_IDLE, 0, 0, last_seq, ERR_OK)

      elif cmd == 4:
        # START mode 4
        active_mode = 4
        paused_mode = 0
        set_outputs(STATE_RUNNING, active_mode, 0, last_seq, ERR_OK)

      elif cmd == 5:
        # PAUSE: stop motion, save active mode so Resume can restore it
        stop_motion()
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
  # Run mode 4
  # ----------------------------------------------------------
  if active_mode == 4:
    while active_mode == 4:
      start_pose = get_actual_tcp_pose()
      rx = start_pose[3]
      ry = start_pose[4]
      rz = start_pose[5]
      duration = MODE4_REPEAT_COUNT
      elapsed = 0.0
      prog = 0
      completed_normally = True
      set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_OK)

      while elapsed < duration:
        if check_stop_or_pause(prog) > 0:
          completed_normally = False
          break
        end

        # Calf massage sequence (TCP frame):
        # 1) close/open at contact position
        # 2) up 50mm, +Y 50mm
        # 3) down 50mm, close/open at new position
        if rg2_cycles_interruptible(prog):
          completed_normally = False
          break
        end

        # NOTE: In this setup, physical "up" is opposite TCP +Z.
        if move_tcp_offset_interruptible(0, 0, -RG2_STEP_UP_M, MOVE_STEPS_UP, prog):
          completed_normally = False
          break
        end
        if move_tcp_offset_interruptible(0, RG2_STEP_Y_M, 0, MOVE_STEPS_YZ, prog):
          completed_normally = False
          break
        end
        if move_tcp_offset_interruptible(0, 0, RG2_STEP_UP_M, MOVE_STEPS_UP, prog):
          completed_normally = False
          break
        end

        if rg2_cycles_interruptible(prog):
          completed_normally = False
          break
        end
        sync()

        elapsed = elapsed + 1
        prog = floor(100 * elapsed / duration)
        if prog > 99:
          prog = 99
        end
        set_outputs(STATE_RUNNING, active_mode, prog, last_seq, ERR_OK)
      end

      interrupted_in_massage = completed_normally == False

      if completed_normally:
        # Single-loop return: pre-compute lifted positions, then issue
        # lift + travel + descend as one continuous sequence for smooth blending.
        curr = get_actual_tcp_pose()
        clx = curr[0]
        cly = curr[1]
        clz = curr[2] + RG2_STEP_UP_M
        slx = start_pose[0]
        sly = start_pose[1]
        slz = start_pose[2] + RG2_STEP_UP_M
        srx = start_pose[3]
        sry = start_pose[4]
        srz = start_pose[5]
        dx_travel = slx - clx
        dy_travel = sly - cly
        i = 0
        while i <= MOVE_STEPS_RETURN + 1:
          if check_stop_or_pause(prog) > 0:
            completed_normally = False
            break
          end
          if i == 0:
            movel(p[clx, cly, clz, srx, sry, srz], a = A_SLOW, v = V_SLOW, r = R_BLEND)
          elif i <= MOVE_STEPS_RETURN:
            t = i / MOVE_STEPS_RETURN
            movel(p[clx + dx_travel * t, cly + dy_travel * t, slz, srx, sry, srz], a = A_SLOW, v = V_SLOW, r = R_BLEND)
          else:
            movel(start_pose, a = A_SLOW, v = V_SLOW, r = R_BLEND)
          end
          i = i + 1
        end
        if completed_normally:
          sync()
        end
      end

      if completed_normally == False:
        interrupted_in_massage = True
      end

      if interrupted_in_massage:
        # Recovery: stopped mid-massage - lift up and return to original start_pose
        curr = get_actual_tcp_pose()
        clx = curr[0]
        cly = curr[1]
        clz = curr[2] + RG2_STEP_UP_M
        slz = start_pose[2] + RG2_STEP_UP_M
        dx_travel = start_pose[0] - clx
        dy_travel = start_pose[1] - cly
        i = 0
        while i <= MOVE_STEPS_RETURN + 1:
          if i == 0:
            movel(p[clx, cly, clz, rx, ry, rz], a = A_SLOW, v = V_SLOW, r = R_BLEND)
          elif i <= MOVE_STEPS_RETURN:
            t = i / MOVE_STEPS_RETURN
            movel(p[clx + dx_travel * t, cly + dy_travel * t, slz, rx, ry, rz], a = A_SLOW, v = V_SLOW, r = R_BLEND)
          else:
            movel(start_pose, a = A_SLOW, v = V_SLOW, r = R_BLEND)
          end
          i = i + 1
        end
        sync()
      end

      if completed_normally == False:
        break
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
