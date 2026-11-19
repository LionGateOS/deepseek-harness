#!/usr/bin/env bash
# CPU-only tests for the multi-instance candidate launcher.
# Uses PATH injection and mock files to simulate port state, process identity,
# and process environment; no GPU, no systemd, no real model process required.
#
# Run: bash owner/local-model-manager/tests/launcher-multi-instance.test.sh
# from the repo root, or from inside owner/local-model-manager/.
#
# The candidate launcher is at:
#   owner/local-model-manager/candidate/dsh-model-server-multi-instance
# The installed launcher is NOT referenced or modified by these tests.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANDIDATE="${SCRIPT_DIR}/../candidate/dsh-model-server-multi-instance"

if [ ! -x "$CANDIDATE" ]; then
  echo "SKIP: candidate launcher not found or not executable: ${CANDIDATE}"
  exit 1
fi

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

CAPTURE_FILE="${TMPDIR_TEST}/args.txt"
PASS=0
FAIL=0

# ── Test-mode sentinel ─────────────────────────────────────────────────────────
# _DSH_LAUNCHER_TEST_MODE must point to a readable file, not the string "1".
# Create a sentinel once; pass its path wherever test-mode injection is needed.
TEST_SENTINEL="${TMPDIR_TEST}/launcher-test-mode"
touch "$TEST_SENTINEL"

# ── XDG lock-dir override ─────────────────────────────────────────────────────
# All start/stop/switch invocations use XDG_RUNTIME_DIR="${TEST_XDG_LOCK}" so
# that lock files, ownership records, and flock tests all stay inside TMPDIR_TEST
# and never touch /run/user/<uid>/dsh-launcher. The test cleanup (rm -rf) handles
# everything on exit.
TEST_XDG_LOCK="${TMPDIR_TEST}/xdg_lock"
mkdir -p "${TEST_XDG_LOCK}/dsh-launcher"
chmod 700 "${TEST_XDG_LOCK}/dsh-launcher"

# Export globally so every invocation inherits it by default.
# Groups that need to test the fallback (HOME path) still override explicitly.
export XDG_RUNTIME_DIR="${TEST_XDG_LOCK}"

# ── Helpers ────────────────────────────────────────────────────────────────────

ok()     { printf 'ok - %s\n' "$1";                   PASS=$((PASS + 1)); }
not_ok() { printf 'not ok - %s\n# %s\n' "$1" "$2";    FAIL=$((FAIL + 1)); }

assert_contains() {
  local label="$1" expected="$2" file="${3:-$CAPTURE_FILE}"
  if grep -qF -- "$expected" "$file" 2>/dev/null; then
    ok "$label"
  else
    not_ok "$label" "expected '${expected}' not found in: ${file}"
    sed 's/^/  # /' "$file" 2>/dev/null || true
  fi
}

assert_exit() {
  local label="$1" expected_code="$2"
  shift 2
  local actual_code=0
  "$@" >/dev/null 2>&1 || actual_code=$?
  if [ "$actual_code" -eq "$expected_code" ]; then
    ok "$label"
  else
    not_ok "$label" "expected exit ${expected_code}, got ${actual_code}"
  fi
}

# write_test_rec <port> [<gpu_uuid>]
# Writes a synthetic ownership record to the test lock dir.
write_test_rec() {
  local port="$1" gpu="${2:-GPU-TEST}"
  printf 'unit=test-unit-p%s\ngpu=%s\nmodel=%s\nport=%s\n' \
    "$port" "$gpu" "$QWEN27_PATH" "$port" \
    > "${TEST_XDG_LOCK}/dsh-launcher/instance-p${port}.rec"
}

# clean_recs
# Removes all instance records from the test lock dir.
# Call at the start of each group so leftover records from prior groups don't
# interfere with the stale-record check in start_model.
clean_recs() {
  rm -f "${TEST_XDG_LOCK}/dsh-launcher"/instance-p*.rec
}

# ── Known model paths ──────────────────────────────────────────────────────────
QWEN27_PATH="/home/liongateos/models/gguf/Qwen3.8-27B/Qwen3.8-27B-Uncensored-Q8_0.gguf"
QWEN35_PATH="/home/liongateos/models/gguf/Qwen3.5-27B-Q5_K_M/Qwen_Qwen3.5-27B-Q5_K_M.gguf"
VISION_PATH="/home/liongateos/models/gguf/Qwen3.8-27B-HauhauCS-Vision/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf"
CODER_PATH="/home/liongateos/models/gguf/Qwen3-Coder-30B-A3B/qwen3-coder-30b-a3b-instruct-q8_0.gguf"
STABLE_SERVER_PATH="/home/liongateos/build-tools/llama.cpp/build-cuda/bin/llama-server"

# Models JSON returned by the curl mock so wait_ready succeeds immediately.
printf '{"data":[{"id":"%s"},{"id":"%s"},{"id":"%s"},{"id":"%s"}]}\n' \
  "$QWEN27_PATH" "$QWEN35_PATH" "$VISION_PATH" "$CODER_PATH" \
  > "${TMPDIR_TEST}/models.json"

# ── Static mock binaries ───────────────────────────────────────────────────────

# systemd-run: write each argument to CAPTURE_FILE, exit 0.
cat > "${TMPDIR_TEST}/systemd-run" <<MOCKEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${CAPTURE_FILE}"
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/systemd-run"

# systemctl: responds to MainPID queries with MOCK_SYSTEMCTL_MAINPID env var.
# Other systemctl calls (e.g., unit stop on wait_ready failure) exit 0 silently.
# MOCK_SYSTEMCTL_EXIT defaults to 0; set to non-zero to simulate a missing unit.
cat > "${TMPDIR_TEST}/systemctl" <<'MOCKEOF'
#!/usr/bin/env bash
if [[ "$*" == *"--property=MainPID"* ]]; then
  printf '%s\n' "${MOCK_SYSTEMCTL_MAINPID:-0}"
  exit "${MOCK_SYSTEMCTL_EXIT:-0}"
fi
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/systemctl"

# curl: /health → 0; /v1/models → all known models (wait_ready succeeds at
# first iteration); anything else → 1.
cat > "${TMPDIR_TEST}/curl" <<MOCKEOF
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    */health*)    exit 0 ;;
    */v1/models*) cat "${TMPDIR_TEST}/models.json"; exit 0 ;;
  esac
done
exit 1
MOCKEOF
chmod +x "${TMPDIR_TEST}/curl"

# ss: default — no port in use (empty output, exit 0).
cat > "${TMPDIR_TEST}/ss" <<'MOCKEOF'
#!/usr/bin/env bash
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/ss"

# kill: record calls, do nothing real.
cat > "${TMPDIR_TEST}/kill" <<MOCKEOF
#!/usr/bin/env bash
printf 'kill %s\n' "\$@" >> "${TMPDIR_TEST}/kill.log"
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/kill"

# sleep: instant (prevents wait_ready loops from blocking).
cat > "${TMPDIR_TEST}/sleep" <<'MOCKEOF'
#!/usr/bin/env bash
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/sleep"

export PATH="${TMPDIR_TEST}:${PATH}"

# ── Group 1: Legacy behavior — no env variables set ───────────────────────────
printf '\n# Group 1: legacy port-8001 behavior\n'

clean_recs
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
if grep -qF "$QWEN27_PATH" "$CAPTURE_FILE" 2>/dev/null; then
  ok "legacy start-qwen27 passes model path"
else
  not_ok "legacy start-qwen27 passes model path" "QWEN27_PATH not found"
fi
if grep -qF -- '--host' "$CAPTURE_FILE" 2>/dev/null; then
  ok "legacy start-qwen27 passes --host"
else
  not_ok "legacy start-qwen27 passes --host" "--host not found"
fi
if grep -qF -- '--port' "$CAPTURE_FILE" 2>/dev/null; then
  ok "legacy start-qwen27 passes --port flag"
else
  not_ok "legacy start-qwen27 passes --port flag" "--port not found"
fi
# The port value line following '--port' must be 8001.
PORT_LINE="$(grep -n '^--port$' "$CAPTURE_FILE" 2>/dev/null | head -1 | cut -d: -f1)"
if [ -n "$PORT_LINE" ]; then
  PORT_VAL="$(sed -n "$((PORT_LINE + 1))p" "$CAPTURE_FILE")"
  if [ "$PORT_VAL" = "8001" ]; then
    ok "legacy start-qwen27 uses port 8001"
  else
    not_ok "legacy start-qwen27 uses port 8001" "got: '${PORT_VAL}'"
  fi
else
  not_ok "legacy start-qwen27 uses port 8001" "--port flag not found"
fi

# ── Group 2: Port override via MODEL_SERVER_PORT ───────────────────────────────
printf '\n# Group 2: port override\n'

clean_recs
rm -f "$CAPTURE_FILE"
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-TI" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
if grep -qF "$QWEN27_PATH" "$CAPTURE_FILE" 2>/dev/null; then
  ok "port-8002 start-qwen27 passes model path"
else
  not_ok "port-8002 start-qwen27 passes model path" "QWEN27_PATH not found"
fi
PORT_LINE="$(grep -n '^--port$' "$CAPTURE_FILE" 2>/dev/null | head -1 | cut -d: -f1)"
if [ -n "$PORT_LINE" ]; then
  PORT_VAL="$(sed -n "$((PORT_LINE + 1))p" "$CAPTURE_FILE")"
  if [ "$PORT_VAL" = "8002" ]; then
    ok "port-8002 start-qwen27 uses port 8002"
  else
    not_ok "port-8002 start-qwen27 uses port 8002" "got: '${PORT_VAL}'"
  fi
else
  not_ok "port-8002 start-qwen27 uses port 8002" "--port flag not found"
fi
# Port 8001 must NOT be the --port value.
if [ "${PORT_VAL:-}" = "8001" ]; then
  not_ok "port-8002 does not use port 8001 as the server port" "got 8001"
else
  ok "port-8002 does not use port 8001 as the server port"
fi

# ── Group 3: Per-instance log and unit names ───────────────────────────────────
printf '\n# Group 3: per-instance log and unit names\n'

clean_recs
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-CASE" \
  bash "$CANDIDATE" start-qwen35 >/dev/null 2>&1 || true
if grep -qF -- 'p8001.log' "$CAPTURE_FILE" 2>/dev/null; then
  ok "default-port start-qwen35 log file includes p8001 suffix"
else
  not_ok "default-port start-qwen35 log file includes p8001 suffix" \
    "expected 'p8001.log' not found"
  sed 's/^/  # /' "$CAPTURE_FILE" 2>/dev/null || true
fi
if grep -qF -- '-p8001' "$CAPTURE_FILE" 2>/dev/null; then
  ok "default-port start-qwen35 unit name includes -p8001 suffix"
else
  not_ok "default-port start-qwen35 unit name includes -p8001 suffix" \
    "expected '-p8001' not found"
fi

clean_recs
rm -f "$CAPTURE_FILE"
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-TI" \
  bash "$CANDIDATE" start-qwen35 >/dev/null 2>&1 || true
if grep -qF -- 'p8002.log' "$CAPTURE_FILE" 2>/dev/null; then
  ok "port-8002 start-qwen35 log file includes p8002 suffix"
else
  not_ok "port-8002 start-qwen35 log file includes p8002 suffix" \
    "expected 'p8002.log' not found"
  sed 's/^/  # /' "$CAPTURE_FILE" 2>/dev/null || true
fi
if grep -qF -- '-p8002' "$CAPTURE_FILE" 2>/dev/null; then
  ok "port-8002 start-qwen35 unit name includes -p8002 suffix"
else
  not_ok "port-8002 start-qwen35 unit name includes -p8002 suffix" \
    "expected '-p8002' not found"
fi

# ── Group 4: Same GGUF on two ports — unit names are distinct ─────────────────
printf '\n# Group 4: same GGUF on two separate ports — distinct unit names\n'

UNIT_8001_FILE="${TMPDIR_TEST}/unit-8001.txt"
UNIT_8002_FILE="${TMPDIR_TEST}/unit-8002.txt"
rm -f "$UNIT_8001_FILE" "$UNIT_8002_FILE"

# systemd-run mock that writes to the instance-specific file.
# We run the two starts sequentially and swap the mock between them.

clean_recs
cat > "${TMPDIR_TEST}/systemd-run" <<MOCKEOF_A
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${UNIT_8001_FILE}"
exit 0
MOCKEOF_A
chmod +x "${TMPDIR_TEST}/systemd-run"
CUDA_VISIBLE_DEVICES="GPU-CASE" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
UNIT_8001="$(grep '^--unit=' "$UNIT_8001_FILE" 2>/dev/null | head -1 | cut -d= -f2 || true)"

clean_recs
cat > "${TMPDIR_TEST}/systemd-run" <<MOCKEOF_B
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${UNIT_8002_FILE}"
exit 0
MOCKEOF_B
chmod +x "${TMPDIR_TEST}/systemd-run"
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-TI" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
UNIT_8002="$(grep '^--unit=' "$UNIT_8002_FILE" 2>/dev/null | head -1 | cut -d= -f2 || true)"

# Restore main capture mock.
cat > "${TMPDIR_TEST}/systemd-run" <<MOCKEOF_RESTORE
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${CAPTURE_FILE}"
exit 0
MOCKEOF_RESTORE
chmod +x "${TMPDIR_TEST}/systemd-run"

if [ -n "$UNIT_8001" ] && [ -n "$UNIT_8002" ] && [ "$UNIT_8001" != "$UNIT_8002" ]; then
  ok "same GGUF on two ports produces distinct systemd unit names"
else
  not_ok "same GGUF on two ports produces distinct systemd unit names" \
    "unit-8001='${UNIT_8001:-<empty>}' unit-8002='${UNIT_8002:-<empty>}'"
fi
if [ -n "$UNIT_8001" ] && printf '%s' "$UNIT_8001" | grep -qF -- '-p8001'; then
  ok "port-8001 unit name contains -p8001 suffix"
else
  not_ok "port-8001 unit name contains -p8001 suffix" "unit: '${UNIT_8001:-<empty>}'"
fi
if [ -n "$UNIT_8002" ] && printf '%s' "$UNIT_8002" | grep -qF -- '-p8002'; then
  ok "port-8002 unit name contains -p8002 suffix"
else
  not_ok "port-8002 unit name contains -p8002 suffix" "unit: '${UNIT_8002:-<empty>}'"
fi

# ── Group 5: GPU UUID mismatch — stop is refused (exit 8) ─────────────────────
printf '\n# Group 5: GPU UUID stop guard\n'

# Fake process facts: a cmdline that passes the known-server check and two
# different environ files (one per GPU UUID).
CMDLINE_FILE="${TMPDIR_TEST}/proc_cmdline.txt"
ENV_CASE_FILE="${TMPDIR_TEST}/proc_env_case.txt"
ENV_TI_FILE="${TMPDIR_TEST}/proc_env_ti.txt"

printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_FILE"
printf 'CUDA_VISIBLE_DEVICES=GPU-CASE\nHOME=/home/liongateos\n' > "$ENV_CASE_FILE"
printf 'CUDA_VISIBLE_DEVICES=GPU-TI\nHOME=/home/liongateos\n'   > "$ENV_TI_FILE"

# Use a dead PID — a subprocess that has exited and been fully reaped.
bash -c 'exit 0' &
DEAD_PID_5=$!
wait "$DEAD_PID_5" 2>/dev/null || true

# ss mock: reports DEAD_PID_5 as owning port 8001.
cat > "${TMPDIR_TEST}/ss" <<SSEOF_MISMATCH
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=${DEAD_PID_5},fd=3))\n'
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_MISMATCH
chmod +x "${TMPDIR_TEST}/ss"

# Write ownership record so safe_stop_known passes the record check.
# MOCK_SYSTEMCTL_MAINPID is set per-invocation so the MainPID matches DEAD_PID_5.
clean_recs
write_test_rec 8001 GPU-CASE

# Test 5a: EXPECTED_GPU_UUID set, process env has a different UUID → exit 8.
exit_code=0
MODEL_SERVER_GPU_UUID="GPU-TI" \
  MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_5}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FILE" \
  _MOCK_PROC_ENV_FILE="$ENV_CASE_FILE" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 8 ]; then
  ok "stop refused with exit 8 when GPU UUID does not match"
else
  not_ok "stop refused with exit 8 when GPU UUID does not match" \
    "expected exit 8, got ${exit_code}"
fi

# Test 5b: refusal message is informative (contains REFUSED and the actual UUID).
out="$(MODEL_SERVER_GPU_UUID="GPU-TI" \
  MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_5}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FILE" \
  _MOCK_PROC_ENV_FILE="$ENV_CASE_FILE" \
  bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'REFUSED'; then
  ok "GPU UUID mismatch stop prints REFUSED"
else
  not_ok "GPU UUID mismatch stop prints REFUSED" "no REFUSED in output"
  printf '%s\n' "$out" | sed 's/^/  # /'
fi
if printf '%s\n' "$out" | grep -qF 'GPU-CASE'; then
  ok "GPU UUID mismatch message shows the actual process GPU UUID"
else
  not_ok "GPU UUID mismatch message shows the actual process GPU UUID" \
    "expected GPU-CASE in output"
  printf '%s\n' "$out" | sed 's/^/  # /'
fi

# Test 5c: EXPECTED_GPU_UUID matches → stop proceeds past the GPU check.
# DEAD_PID_5 is reaped so kill -0 fails (ESRCH) → "already exited" path →
# port-wait loop exhausts → exit 7 (proving the GPU check passed).
exit_code=0
MODEL_SERVER_GPU_UUID="GPU-CASE" \
  MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_5}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FILE" \
  _MOCK_PROC_ENV_FILE="$ENV_CASE_FILE" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 7 ]; then
  ok "stop with matching GPU UUID proceeds past GPU check (exit 7: port-wait timeout)"
else
  not_ok "stop with matching GPU UUID proceeds past GPU check" \
    "expected exit 7 (timeout-after-kill), got ${exit_code}"
fi

# Test 5d: EXPECTED_GPU_UUID not set → no GPU check, stop proceeds regardless.
exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_5}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FILE" \
  _MOCK_PROC_ENV_FILE="$ENV_TI_FILE" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 7 ]; then
  ok "stop with no EXPECTED_GPU_UUID skips GPU check and proceeds (exit 7: timeout)"
else
  not_ok "stop with no EXPECTED_GPU_UUID skips GPU check and proceeds" \
    "expected exit 7, got ${exit_code}"
fi

# ── Group 6: Port isolation — stop targets the configured PORT only ────────────
printf '\n# Group 6: stop targets the configured port\n'

# ss reports only port 8001; stop with MODEL_SERVER_PORT=8002 finds port 8002
# is free and exits 0 without touching port 8001's process.
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_PORT_ISOLATION'
#!/usr/bin/env bash
if [[ "$*" == *"-ltnp"* ]]; then
  # Only port 8001 has a listener.
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=99,fd=3))\n'
fi
if [[ "$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_PORT_ISOLATION
chmod +x "${TMPDIR_TEST}/ss"

# No record for port 8002 (it was never started by this launcher).
clean_recs

exit_code=0
MODEL_SERVER_PORT=8002 bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "stop on port 8002 exits 0 when only port 8001 is occupied"
else
  not_ok "stop on port 8002 exits 0 when only port 8001 is occupied" \
    "exit ${exit_code}"
fi
# Confirm the stop message mentions port 8002, not 8001 (targets the right instance).
out="$(MODEL_SERVER_PORT=8002 bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qF '8002'; then
  ok "stop on port 8002 output mentions port 8002"
else
  not_ok "stop on port 8002 output mentions port 8002" \
    "8002 not in stop output"
fi

# ── Group 7: Status queries the configured port ────────────────────────────────
printf '\n# Group 7: status queries the configured port\n'

CURL_LOG="${TMPDIR_TEST}/curl.log"
cat > "${TMPDIR_TEST}/curl" <<CURLEOF_STATUS
#!/usr/bin/env bash
printf '%s\n' "\$@" >> "${CURL_LOG}"
for arg in "\$@"; do
  case "\$arg" in
    *:8001/health*)    exit 0 ;;
    *:8002/health*)    exit 0 ;;
    *:8001/v1/models*) cat "${TMPDIR_TEST}/models.json"; exit 0 ;;
    *:8002/v1/models*) cat "${TMPDIR_TEST}/models.json"; exit 0 ;;
  esac
done
exit 1
CURLEOF_STATUS
chmod +x "${TMPDIR_TEST}/curl"

rm -f "$CURL_LOG"
bash "$CANDIDATE" status >/dev/null 2>&1 || true
if grep -qF ':8001' "$CURL_LOG" 2>/dev/null; then
  ok "default status queries port 8001"
else
  not_ok "default status queries port 8001" "8001 not seen in curl log"
fi

rm -f "$CURL_LOG"
MODEL_SERVER_PORT=8002 bash "$CANDIDATE" status >/dev/null 2>&1 || true
if grep -qF ':8002' "$CURL_LOG" 2>/dev/null; then
  ok "port-8002 status queries port 8002"
else
  not_ok "port-8002 status queries port 8002" "8002 not seen in curl log"
fi

# Restore the models-returning curl mock for subsequent tests.
cat > "${TMPDIR_TEST}/curl" <<CURLEOF_RESTORE
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    */health*)    exit 0 ;;
    */v1/models*) cat "${TMPDIR_TEST}/models.json"; exit 0 ;;
  esac
done
exit 1
CURLEOF_RESTORE
chmod +x "${TMPDIR_TEST}/curl"

# ── Group 8: Port collision — start refuses when port already in use ───────────
printf '\n# Group 8: start refuses when the target port is already in use\n'

clean_recs
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_PORT_IN_USE'
#!/usr/bin/env bash
# port_in_use() checks `-ltn`; report port 8001 as occupied.
if [[ "$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_PORT_IN_USE
chmod +x "${TMPDIR_TEST}/ss"

assert_exit "start refused with exit 3 when port 8001 already in use" 3 \
  bash "$CANDIDATE" start-qwen35

# Port 8002 is free while 8001 is in use — start on 8002 must succeed.
clean_recs
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_8001_ONLY'
#!/usr/bin/env bash
if [[ "$*" == *"-ltn"* ]]; then
  # Only port 8001 is occupied.
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_8001_ONLY
chmod +x "${TMPDIR_TEST}/ss"

rm -f "$CAPTURE_FILE"
exit_code=0
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-TI" \
  bash "$CANDIDATE" start-qwen35 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "start on port 8002 succeeds while port 8001 is occupied"
else
  not_ok "start on port 8002 succeeds while port 8001 is occupied" \
    "exit ${exit_code}"
fi

# ── Group 9: CUDA_VISIBLE_DEVICES forwarded to systemd unit ───────────────────
printf '\n# Group 9: GPU UUID forwarded to the systemd unit environment\n'

# Restore the clean ss (no ports in use) and capture mock.
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_CLEAN'
#!/usr/bin/env bash
exit 0
SSEOF_CLEAN
chmod +x "${TMPDIR_TEST}/ss"

clean_recs
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-CASE-UUID" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
if grep -qF 'GPU-CASE-UUID' "$CAPTURE_FILE" 2>/dev/null; then
  ok "CUDA_VISIBLE_DEVICES forwarded into systemd unit Environment property"
else
  not_ok "CUDA_VISIBLE_DEVICES forwarded into systemd unit Environment property" \
    "GPU-CASE-UUID not found in systemd-run args"
  sed 's/^/  # /' "$CAPTURE_FILE"
fi

clean_recs
rm -f "$CAPTURE_FILE"
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-TI-UUID" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
if grep -qF 'GPU-TI-UUID' "$CAPTURE_FILE" 2>/dev/null; then
  ok "port-8002 instance: different CUDA_VISIBLE_DEVICES forwarded correctly"
else
  not_ok "port-8002 instance: different CUDA_VISIBLE_DEVICES forwarded correctly" \
    "GPU-TI-UUID not found in systemd-run args"
  sed 's/^/  # /' "$CAPTURE_FILE"
fi

# ── Group 10: switch uses the configured port throughout ──────────────────────
printf '\n# Group 10: switch on a port with a GPU UUID mismatch is refused\n'

# ss: PID 55 owns port 8002.
CMDLINE_8002="${TMPDIR_TEST}/proc_cmdline_8002.txt"
ENV_TI2="${TMPDIR_TEST}/proc_env_ti2.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_8002"
printf 'CUDA_VISIBLE_DEVICES=GPU-TI\nHOME=/home/liongateos\n'   > "$ENV_TI2"

cat > "${TMPDIR_TEST}/ss" <<'SSEOF_SWITCH'
#!/usr/bin/env bash
if [[ "$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8002 0.0.0.0:* users:(("llama-server",pid=55,fd=3))\n'
fi
if [[ "$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8002 0.0.0.0:*\n'
fi
SSEOF_SWITCH
chmod +x "${TMPDIR_TEST}/ss"

# Write ownership record for port 8002 with PID 55 as MainPID.
clean_recs
write_test_rec 8002 GPU-TI

# switch with the wrong GPU UUID → safe_stop_known refuses immediately (exit 8).
exit_code=0
MODEL_SERVER_PORT=8002 MODEL_SERVER_GPU_UUID="GPU-WRONG" \
  MOCK_SYSTEMCTL_MAINPID=55 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_8002" \
  _MOCK_PROC_ENV_FILE="$ENV_TI2" \
  bash "$CANDIDATE" switch qwen35 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 8 ]; then
  ok "switch on port 8002 with wrong GPU UUID refused (exit 8)"
else
  not_ok "switch on port 8002 with wrong GPU UUID refused (exit 8)" \
    "expected exit 8, got ${exit_code}"
fi

# ── Group 11: Extra args forwarded; -np (Multiple Jobs) flag unmodified ────────
printf '\n# Group 11: extra args forwarded; -np unmodified\n'

cat > "${TMPDIR_TEST}/ss" <<'SSEOF_NOPORT'
#!/usr/bin/env bash
exit 0
SSEOF_NOPORT
chmod +x "${TMPDIR_TEST}/ss"

clean_recs
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 --ctx-size 131072 >/dev/null 2>&1 || true
if grep -qF -- '--ctx-size' "$CAPTURE_FILE" 2>/dev/null; then
  ok "extra arg --ctx-size forwarded to systemd-run"
else
  not_ok "extra arg --ctx-size forwarded to systemd-run" "--ctx-size not found"
fi
# -np 1 must be present (Multiple Jobs mode unchanged).
if grep -xF -- '-np' "$CAPTURE_FILE" 2>/dev/null; then
  ok "-np flag present (Multiple Jobs mode unchanged)"
else
  not_ok "-np flag present (Multiple Jobs mode unchanged)" "-np not found"
fi
if grep -xF -- '1' "$CAPTURE_FILE" 2>/dev/null; then
  ok "-np value 1 present (single slot, unchanged)"
else
  not_ok "-np value 1 present" "1 not found after -np"
fi

# ── Group 12: Unknown command exits 2 ─────────────────────────────────────────
printf '\n# Group 12: unknown command\n'
assert_exit "unknown command exits 2" 2 bash "$CANDIDATE" frobulate

# ── Group 13: Concurrent launch lock — same port refuses while lock is held ────
printf '\n# Group 13: per-port flock prevents concurrent start on the same port\n'

# Restore clean ss (no ports in use) so port_in_use does not trigger first.
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_CLEAN13'
#!/usr/bin/env bash
exit 0
SSEOF_CLEAN13
chmod +x "${TMPDIR_TEST}/ss"

# The candidate uses _get_lock_dir() → ${XDG_RUNTIME_DIR}/dsh-launcher.
# XDG_RUNTIME_DIR is already exported as TEST_XDG_LOCK.
LOCK_FILE_8003="${TEST_XDG_LOCK}/dsh-launcher/p8003.lock"
clean_recs
exec 9>"${LOCK_FILE_8003}"
flock -x 9

exit_code=0
MODEL_SERVER_PORT=8003 CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 3 ]; then
  ok "concurrent start on port 8003 refused (exit 3) while lock is held"
else
  not_ok "concurrent start on port 8003 refused (exit 3) while lock is held" \
    "expected exit 3, got ${exit_code}"
fi

# Verify the refusal message is informative.
out="$(MODEL_SERVER_PORT=8003 CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'already in progress'; then
  ok "concurrent start refusal message mentions 'already in progress'"
else
  not_ok "concurrent start refusal message mentions 'already in progress'" \
    "output: $(printf '%s\n' "$out" | head -3)"
fi

# Release the lock; subsequent starts for the same port must now succeed.
exec 9>&-

exit_code=0
MODEL_SERVER_PORT=8003 CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "start on port 8003 succeeds once the lock is released"
else
  not_ok "start on port 8003 succeeds once the lock is released" \
    "expected exit 0, got ${exit_code}"
fi

# Verify port 8001 and 8003 use DIFFERENT lock files (per-port isolation):
# hold the 8003 lock, verify 8001 starts without contention.
clean_recs
exec 9>"${LOCK_FILE_8003}"
flock -x 9

exit_code=0
CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "port 8001 start succeeds while port 8003 lock is held (different lock files)"
else
  not_ok "port 8001 start succeeds while port 8003 lock is held" \
    "expected exit 0, got ${exit_code}"
fi

exec 9>&-

# ── Group 14: Mock variables ignored without _DSH_LAUNCHER_TEST_MODE=1 ──────
printf '\n# Group 14: mock procfs variables are inactive without _DSH_LAUNCHER_TEST_MODE=1\n'

# Use this test script's own PID ($$). It definitely exists, and its /proc cmdline
# is bash — not a known model server — so the candidate exits 6 when it reads
# the real /proc rather than the fake cmdline file.
TEST_PID="$$"
CMDLINE_FAKE="${TMPDIR_TEST}/proc_cmdline_fake.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_FAKE"
# CMDLINE_FAKE contains a valid server cmdline — if honored, stop would proceed;
# if ignored (real /proc read), bash cmdline fails the known-server check → exit 6.

cat > "${TMPDIR_TEST}/ss" <<SSEOF_TESTPID
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("bash",pid=${TEST_PID},fd=3))\n'
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_TESTPID
chmod +x "${TMPDIR_TEST}/ss"

# Write ownership record; MOCK_SYSTEMCTL_MAINPID=TEST_PID so record + MainPID pass.
clean_recs
write_test_rec 8001 GPU-TEST

# Without _DSH_LAUNCHER_TEST_MODE=1: real /proc/${TEST_PID}/cmdline is read.
# That cmdline is bash, which does not match any known server → exit 6.
exit_code=0
MOCK_SYSTEMCTL_MAINPID="${TEST_PID}" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FAKE" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 6 ]; then
  ok "mock cmdline ignored without _DSH_LAUNCHER_TEST_MODE: real /proc read → exit 6"
else
  not_ok "mock cmdline ignored without _DSH_LAUNCHER_TEST_MODE: real /proc read → exit 6" \
    "expected exit 6, got ${exit_code}"
fi

# With _DSH_LAUNCHER_TEST_MODE=<sentinel>: mock file IS honored, valid server cmdline
# passes the check, and stop proceeds to the kill section.
# Use a dead PID so kill-0 returns ESRCH → "already exited" path → exit 7.
bash -c 'exit 0' &
DEAD_PID_14=$!
wait "$DEAD_PID_14" 2>/dev/null || true

cat > "${TMPDIR_TEST}/ss" <<SSEOF_DEAD14
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=${DEAD_PID_14},fd=3))\n'
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_DEAD14
chmod +x "${TMPDIR_TEST}/ss"

# Refresh the record so its MainPID matches DEAD_PID_14.
clean_recs
write_test_rec 8001 GPU-TEST

exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_14}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_FAKE" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 7 ]; then
  ok "mock cmdline honored with _DSH_LAUNCHER_TEST_MODE=1: passes cmdline check → exit 7"
else
  not_ok "mock cmdline honored with _DSH_LAUNCHER_TEST_MODE=1: passes cmdline check → exit 7" \
    "expected exit 7, got ${exit_code}"
fi

# ── Group 15: Process-already-exited graceful path (ESRCH, not EPERM) ─────────
printf '\n# Group 15: process that exited before stop is handled gracefully (not exit 9)\n'

bash -c 'exit 0' &
DEAD_PID=$!
wait "$DEAD_PID" 2>/dev/null || true
# DEAD_PID is now reaped: kill -0 $DEAD_PID will fail, /proc/$DEAD_PID won't exist.

CMDLINE_DEAD="${TMPDIR_TEST}/proc_cmdline_dead.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_DEAD"

cat > "${TMPDIR_TEST}/ss" <<SSEOF_DEAD
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf "LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:((\"llama-server\",pid=${DEAD_PID},fd=3))\n"
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_DEAD
chmod +x "${TMPDIR_TEST}/ss"

clean_recs
write_test_rec 8001 GPU-TEST

# stop with a dead PID: kill -0 fails (ESRCH) + /proc absent → "already exited"
# message, then port-wait loop exhausts → exit 7 (not exit 9 which is EPERM).
exit_code=0
out="$(MOCK_SYSTEMCTL_MAINPID="${DEAD_PID}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_DEAD" \
  bash "$CANDIDATE" stop 2>&1)" || exit_code=$?
if [ "$exit_code" -eq 7 ]; then
  ok "process-already-exited path: exits 7 (port-wait timeout, not exit 9 EPERM)"
else
  not_ok "process-already-exited path: exits 7" \
    "expected exit 7, got ${exit_code}"
fi
if printf '%s\n' "$out" | grep -qiF 'already exited'; then
  ok "process-already-exited path: output mentions process already exited"
else
  not_ok "process-already-exited path: output mentions process already exited" \
    "no 'already exited' in output"
  printf '%s\n' "$out" | head -5 | sed 's/^/  # /'
fi

# ── Group 16: PORT validation ──────────────────────────────────────────────────
printf '\n# Group 16: malformed MODEL_SERVER_PORT values are rejected (exit 2)\n'

# Restore clean ss for port validation tests.
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_CLEAN16'
#!/usr/bin/env bash
exit 0
SSEOF_CLEAN16
chmod +x "${TMPDIR_TEST}/ss"

# Non-numeric value.
exit_code=0
MODEL_SERVER_PORT=abc bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 2 ]; then
  ok "MODEL_SERVER_PORT=abc rejected (exit 2)"
else
  not_ok "MODEL_SERVER_PORT=abc rejected (exit 2)" "got ${exit_code}"
fi

# Zero is not a valid port.
exit_code=0
MODEL_SERVER_PORT=0 bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 2 ]; then
  ok "MODEL_SERVER_PORT=0 rejected (exit 2)"
else
  not_ok "MODEL_SERVER_PORT=0 rejected (exit 2)" "got ${exit_code}"
fi

# Out-of-range high value.
exit_code=0
MODEL_SERVER_PORT=65536 bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 2 ]; then
  ok "MODEL_SERVER_PORT=65536 rejected (exit 2)"
else
  not_ok "MODEL_SERVER_PORT=65536 rejected (exit 2)" "got ${exit_code}"
fi

# Leading zeros rejected (octal ambiguity).
exit_code=0
MODEL_SERVER_PORT=08001 bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 2 ]; then
  ok "MODEL_SERVER_PORT=08001 (leading zero) rejected (exit 2)"
else
  not_ok "MODEL_SERVER_PORT=08001 (leading zero) rejected (exit 2)" "got ${exit_code}"
fi

# Shell metacharacters in port value.
exit_code=0
MODEL_SERVER_PORT='8001;id' bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 2 ]; then
  ok "MODEL_SERVER_PORT='8001;id' (injection attempt) rejected (exit 2)"
else
  not_ok "MODEL_SERVER_PORT='8001;id' (injection attempt) rejected (exit 2)" "got ${exit_code}"
fi

# Empty string falls through to the default via ${MODEL_SERVER_PORT:-8001} — valid.
exit_code=0
MODEL_SERVER_PORT='' bash "$CANDIDATE" status >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "MODEL_SERVER_PORT='' (empty) uses default 8001 (exit 0)"
else
  not_ok "MODEL_SERVER_PORT='' (empty) uses default 8001 (exit 0)" "got ${exit_code}"
fi

# Highest valid port (65535) is accepted; unset defaults to 8001.
clean_recs
exit_code=0
MODEL_SERVER_PORT=65535 CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "MODEL_SERVER_PORT=65535 (boundary) accepted"
else
  not_ok "MODEL_SERVER_PORT=65535 (boundary) accepted" "got ${exit_code}"
fi

clean_recs
exit_code=0
CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "unset MODEL_SERVER_PORT defaults to 8001 (accepted)"
else
  not_ok "unset MODEL_SERVER_PORT defaults to 8001 (accepted)" "got ${exit_code}"
fi

# Error output mentions the invalid value.
out="$(MODEL_SERVER_PORT=99999 bash "$CANDIDATE" status 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'MODEL_SERVER_PORT'; then
  ok "malformed port error message names MODEL_SERVER_PORT"
else
  not_ok "malformed port error message names MODEL_SERVER_PORT" \
    "output: $(printf '%s\n' "$out" | head -2)"
fi

# ── Group 17: Lock directory safety ───────────────────────────────────────────
printf '\n# Group 17: lock directory creation and safety\n'

# Normal case: XDG_RUNTIME_DIR (TEST_XDG_LOCK) → lock dir created, chmod 700.
clean_recs
rm -f "$CAPTURE_FILE"
exit_code=0
CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "start succeeds when XDG_RUNTIME_DIR points to an owner-controlled directory"
else
  not_ok "start succeeds with valid XDG_RUNTIME_DIR" "got ${exit_code}"
fi
if [ -d "${TEST_XDG_LOCK}/dsh-launcher" ]; then
  ok "dsh-launcher directory was created inside XDG_RUNTIME_DIR"
else
  not_ok "dsh-launcher directory was created inside XDG_RUNTIME_DIR" "dir not found"
fi
lock_perms="$(stat -c '%a' "${TEST_XDG_LOCK}/dsh-launcher" 2>/dev/null)"
if [ "${lock_perms}" = "700" ]; then
  ok "lock directory has owner-only permissions (700)"
else
  not_ok "lock directory has owner-only permissions (700)" "got ${lock_perms:-<unknown>}"
fi

# Fallback: unset XDG_RUNTIME_DIR → uses ~/.local/state/dsh/launcher.
# Override HOME to a temp dir so we don't write into the real home.
TEST_HOME="${TMPDIR_TEST}/home_fallback"
mkdir -p "$TEST_HOME"
clean_recs
exit_code=0
HOME="$TEST_HOME" XDG_RUNTIME_DIR="" CUDA_VISIBLE_DEVICES="GPU-TEST" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "start succeeds when XDG_RUNTIME_DIR is empty (uses HOME fallback)"
else
  not_ok "start succeeds when XDG_RUNTIME_DIR is empty (uses HOME fallback)" "got ${exit_code}"
fi
if [ -d "${TEST_HOME}/.local/state/dsh/launcher" ]; then
  ok "fallback lock directory created under HOME/.local/state/dsh/launcher"
else
  not_ok "fallback lock directory created under HOME/.local/state/dsh/launcher" "dir not found"
fi

# Test mode guard: _DSH_LAUNCHER_TEST_MODE=1 (a plain string, not a file path)
# must NOT activate test mode — the sentinel file check must fail.
CMDLINE_GUARD="${TMPDIR_TEST}/proc_cmdline_guard.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_GUARD"

bash -c 'exit 0' &
DEAD_PID_17=$!
wait "$DEAD_PID_17" 2>/dev/null || true

cat > "${TMPDIR_TEST}/ss" <<SSEOF_GUARD17
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("bash",pid=${DEAD_PID_17},fd=3))\n'
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_GUARD17
chmod +x "${TMPDIR_TEST}/ss"

# Write record for all three guard tests (DEAD_PID_17 as MainPID).
clean_recs
write_test_rec 8001 GPU-TEST

# "1" is not a file path → test mode must NOT activate → real /proc read → exit 6.
exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_17}" \
  _DSH_LAUNCHER_TEST_MODE=1 \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_GUARD" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 6 ]; then
  ok "_DSH_LAUNCHER_TEST_MODE=1 (string, not file) does NOT activate test mode → exit 6"
else
  not_ok "_DSH_LAUNCHER_TEST_MODE=1 (string, not file) does NOT activate test mode" \
    "expected exit 6 (real /proc read, bash cmdline rejected), got ${exit_code}"
fi

# Non-existent path also must not activate test mode.
# Re-write record (previous test may not have cleared port/exited cleanly).
clean_recs
write_test_rec 8001 GPU-TEST

exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_17}" \
  _DSH_LAUNCHER_TEST_MODE="/tmp/dsh-does-not-exist-$$" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_GUARD" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 6 ]; then
  ok "_DSH_LAUNCHER_TEST_MODE=<nonexistent-path> does NOT activate test mode → exit 6"
else
  not_ok "_DSH_LAUNCHER_TEST_MODE=<nonexistent-path> does NOT activate test mode" \
    "expected exit 6, got ${exit_code}"
fi

# Correct sentinel path DOES activate test mode → mock honored → valid cmdline → exit 7.
clean_recs
write_test_rec 8001 GPU-TEST

exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_17}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_GUARD" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 7 ]; then
  ok "_DSH_LAUNCHER_TEST_MODE=<sentinel-file> activates test mode → mock honored → exit 7"
else
  not_ok "_DSH_LAUNCHER_TEST_MODE=<sentinel-file> activates test mode" \
    "expected exit 7, got ${exit_code}"
fi

# ── Group 18: Instance record lifecycle ───────────────────────────────────────
printf '\n# Group 18: ownership record lifecycle\n'

# Restore clean ss (no ports in use).
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_CLEAN18'
#!/usr/bin/env bash
exit 0
SSEOF_CLEAN18
chmod +x "${TMPDIR_TEST}/ss"

# 18a: start success — record written with correct fields.
clean_recs
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-18A" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
REC_8001="${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec"
if [ -f "$REC_8001" ]; then
  ok "18a: start success creates ownership record"
else
  not_ok "18a: start success creates ownership record" "record not found at ${REC_8001}"
fi
if grep -q '^unit=dsh-model-' "$REC_8001" 2>/dev/null; then
  ok "18a: record unit field has dsh-model- prefix"
else
  not_ok "18a: record unit field has dsh-model- prefix" \
    "got: $(grep '^unit=' "$REC_8001" 2>/dev/null || echo '<missing>')"
fi
if grep -q '^gpu=GPU-18A$' "$REC_8001" 2>/dev/null; then
  ok "18a: record gpu field matches CUDA_VISIBLE_DEVICES"
else
  not_ok "18a: record gpu field matches CUDA_VISIBLE_DEVICES" \
    "got: $(grep '^gpu=' "$REC_8001" 2>/dev/null || echo '<missing>')"
fi
if grep -q "^model=${QWEN27_PATH}$" "$REC_8001" 2>/dev/null; then
  ok "18a: record model field matches QWEN27 path"
else
  not_ok "18a: record model field matches QWEN27 path" \
    "got: $(grep '^model=' "$REC_8001" 2>/dev/null || echo '<missing>')"
fi
if grep -q '^port=8001$' "$REC_8001" 2>/dev/null; then
  ok "18a: record port field is 8001"
else
  not_ok "18a: record port field is 8001" \
    "got: $(grep '^port=' "$REC_8001" 2>/dev/null || echo '<missing>')"
fi
if grep -q -- '-p8001' "$REC_8001" 2>/dev/null; then
  ok "18a: record unit field includes -p8001 port suffix"
else
  not_ok "18a: record unit field includes -p8001 port suffix" \
    "unit: $(grep '^unit=' "$REC_8001" 2>/dev/null || echo '<missing>')"
fi

# 18b: start port 8002 independently — record written with port=8002, distinct unit.
clean_recs
rm -f "$CAPTURE_FILE"
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-18B" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
REC_8002="${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec"
if [ -f "$REC_8002" ]; then
  ok "18b: start on port 8002 creates record at instance-p8002.rec"
else
  not_ok "18b: start on port 8002 creates record at instance-p8002.rec" "not found"
fi
if grep -q '^port=8002$' "$REC_8002" 2>/dev/null; then
  ok "18b: record port field is 8002"
else
  not_ok "18b: record port field is 8002" \
    "got: $(grep '^port=' "$REC_8002" 2>/dev/null || echo '<missing>')"
fi
if grep -q '^gpu=GPU-18B$' "$REC_8002" 2>/dev/null; then
  ok "18b: record gpu field matches CUDA_VISIBLE_DEVICES for port-8002 instance"
else
  not_ok "18b: record gpu field matches CUDA_VISIBLE_DEVICES for port-8002 instance" \
    "got: $(grep '^gpu=' "$REC_8002" 2>/dev/null || echo '<missing>')"
fi

# 18c: start failure (wait_ready timeout) — record NOT written.
cat > "${TMPDIR_TEST}/curl" <<'CURL_FAIL'
#!/usr/bin/env bash
exit 1
CURL_FAIL
chmod +x "${TMPDIR_TEST}/curl"

clean_recs
exit_code=0
CUDA_VISIBLE_DEVICES="GPU-18C" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 4 ]; then
  ok "18c: start failure (wait_ready timeout) exits 4"
else
  not_ok "18c: start failure (wait_ready timeout) exits 4" "got ${exit_code}"
fi
if [ ! -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" ]; then
  ok "18c: no ownership record written on start failure"
else
  not_ok "18c: no ownership record written on start failure" "record found unexpectedly"
fi

# Restore normal curl mock.
cat > "${TMPDIR_TEST}/curl" <<CURLEOF_R18
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    */health*)    exit 0 ;;
    */v1/models*) cat "${TMPDIR_TEST}/models.json"; exit 0 ;;
  esac
done
exit 1
CURLEOF_R18
chmod +x "${TMPDIR_TEST}/curl"

# 18d: stale record (port free) blocks new start (exit 10) with recovery hint.
clean_recs
printf 'unit=stale-unit-p8001\ngpu=GPU-OLD\nmodel=%s\nport=8001\n' \
  "$QWEN27_PATH" > "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec"

exit_code=0
CUDA_VISIBLE_DEVICES="GPU-NEW" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "18d: stale record blocks new start (exit 10)"
else
  not_ok "18d: stale record blocks new start (exit 10)" "got ${exit_code}"
fi
out="$(CUDA_VISIBLE_DEVICES="GPU-NEW" \
  bash "$CANDIDATE" start-qwen27 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'REFUSED'; then
  ok "18d: stale record refusal output includes REFUSED"
else
  not_ok "18d: stale record refusal output includes REFUSED" \
    "output: $(printf '%s\n' "$out" | head -2)"
fi
if printf '%s\n' "$out" | grep -qF 'rm '; then
  ok "18d: stale record refusal provides rm recovery guidance"
else
  not_ok "18d: stale record refusal provides rm recovery guidance" \
    "no 'rm ' in output"
fi

# 18e: stop success — record deleted after port clears.
# Uses a counting ss mock: call 1 (-ltnp) reports PID+port-in-use;
# call 2+ (-ltn) reports port free → wait loop exits after first iteration.
bash -c 'exit 0' &
DEAD_PID_18E=$!
wait "$DEAD_PID_18E" 2>/dev/null || true

SS_COUNT_18E="${TMPDIR_TEST}/ss_count_18e"
printf '0\n' > "$SS_COUNT_18E"
cat > "${TMPDIR_TEST}/ss" <<SSEOF_18E
#!/usr/bin/env bash
count=\$(cat "${SS_COUNT_18E}" 2>/dev/null || printf '0')
count=\$((count + 1))
printf '%s\n' "\$count" > "${SS_COUNT_18E}"
if [ "\$count" -le 1 ]; then
  if [[ "\$*" == *"-ltnp"* ]]; then
    printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=${DEAD_PID_18E},fd=3))\n'
  elif [[ "\$*" == *"-ltn"* ]]; then
    printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
  fi
fi
# count > 1: no output → port free
SSEOF_18E
chmod +x "${TMPDIR_TEST}/ss"

CMDLINE_18E="${TMPDIR_TEST}/proc_cmdline_18e.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_18E"

clean_recs
write_test_rec 8001 GPU-18E

exit_code=0
out="$(MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_18E}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_18E" \
  bash "$CANDIDATE" stop 2>&1)" || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "18e: stop success exits 0 when port clears after kill"
else
  not_ok "18e: stop success exits 0" "got ${exit_code}: ${out}"
fi
if [ ! -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" ]; then
  ok "18e: ownership record deleted after successful stop"
else
  not_ok "18e: ownership record deleted after successful stop" "record still exists"
fi

# ── Group 19: Ownership record authorization failures ─────────────────────────
printf '\n# Group 19: ownership record authorization failures\n'

bash -c 'exit 0' &
DEAD_PID_19=$!
wait "$DEAD_PID_19" 2>/dev/null || true

cat > "${TMPDIR_TEST}/ss" <<SSEOF_19
#!/usr/bin/env bash
if [[ "\$*" == *"-ltnp"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=${DEAD_PID_19},fd=3))\n'
fi
if [[ "\$*" == *"-ltn"* ]]; then
  printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
fi
SSEOF_19
chmod +x "${TMPDIR_TEST}/ss"

CMDLINE_19="${TMPDIR_TEST}/proc_cmdline_19.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_19"

# 19a: MainPID=0 from systemctl → exit 10 (unit not active).
clean_recs
write_test_rec 8001 GPU-19A

exit_code=0
MOCK_SYSTEMCTL_MAINPID=0 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "19a: MainPID=0 (unit stopped/absent) → stop refused (exit 10)"
else
  not_ok "19a: MainPID=0 → stop refused (exit 10)" "got ${exit_code}"
fi
out="$(MOCK_SYSTEMCTL_MAINPID=0 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'REFUSED'; then
  ok "19a: MainPID=0 refusal output includes REFUSED"
else
  not_ok "19a: MainPID=0 refusal output includes REFUSED" \
    "output: $(printf '%s\n' "$out" | head -2)"
fi
if printf '%s\n' "$out" | grep -qF 'rm '; then
  ok "19a: MainPID=0 refusal provides rm recovery guidance"
else
  not_ok "19a: MainPID=0 refusal provides rm recovery guidance" \
    "no 'rm ' in output"
fi

# 19b: systemctl exits non-zero (unit does not exist) → exit 10.
clean_recs
write_test_rec 8001 GPU-19B

exit_code=0
MOCK_SYSTEMCTL_MAINPID="" MOCK_SYSTEMCTL_EXIT=4 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "19b: systemctl non-zero exit (unit absent) → stop refused (exit 10)"
else
  not_ok "19b: systemctl non-zero exit → stop refused (exit 10)" "got ${exit_code}"
fi

# 19c: MainPID mismatches ss PID → exit 10.
clean_recs
write_test_rec 8001 GPU-19C

exit_code=0
MOCK_SYSTEMCTL_MAINPID=99999 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "19c: MainPID mismatch (${DEAD_PID_19} vs 99999) → stop refused (exit 10)"
else
  not_ok "19c: MainPID mismatch → stop refused (exit 10)" "got ${exit_code}"
fi
out="$(MOCK_SYSTEMCTL_MAINPID=99999 \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'REFUSED'; then
  ok "19c: MainPID mismatch refusal output includes REFUSED"
else
  not_ok "19c: MainPID mismatch refusal output includes REFUSED" \
    "output: $(printf '%s\n' "$out" | head -2)"
fi

# 19d: No record + port in use → exit 10 (Option B: no legacy fallback).
clean_recs

exit_code=0
MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_19}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "19d: no record + port in use → stop refused (exit 10, Option B)"
else
  not_ok "19d: no record + port in use → stop refused (exit 10)" "got ${exit_code}"
fi
out="$(MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_19}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_19" \
  bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qiF 'installed launcher'; then
  ok "19d: no-record refusal mentions installed launcher"
else
  not_ok "19d: no-record refusal mentions installed launcher" \
    "output: $(printf '%s\n' "$out" | head -3)"
fi

# 19e: No record + port free → exit 0 ("nothing to stop").
cat > "${TMPDIR_TEST}/ss" <<'SSEOF_19E'
#!/usr/bin/env bash
exit 0
SSEOF_19E
chmod +x "${TMPDIR_TEST}/ss"

clean_recs

exit_code=0
bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "19e: no record + port free → exit 0 (nothing to stop)"
else
  not_ok "19e: no record + port free → exit 0" "got ${exit_code}"
fi

# 19f: Stale record (record present + port free) → stop refused (exit 10 + rm hint).
printf 'unit=stale-unit\ngpu=GPU-STALE\nmodel=%s\nport=8001\n' \
  "$QWEN27_PATH" > "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec"

exit_code=0
bash "$CANDIDATE" stop >/dev/null 2>&1 || exit_code=$?
if [ "$exit_code" -eq 10 ]; then
  ok "19f: stale record (record present + port free) → stop refused (exit 10)"
else
  not_ok "19f: stale record (record present + port free) → stop refused (exit 10)" \
    "got ${exit_code}"
fi
out="$(bash "$CANDIDATE" stop 2>&1 || true)"
if printf '%s\n' "$out" | grep -qF 'rm '; then
  ok "19f: stale-record stop provides rm recovery guidance"
else
  not_ok "19f: stale-record stop provides rm recovery guidance" \
    "output: $(printf '%s\n' "$out" | head -3)"
fi

# ── Group 20: Two-port independence ───────────────────────────────────────────
printf '\n# Group 20: two-port record independence\n'

cat > "${TMPDIR_TEST}/ss" <<'SSEOF_CLEAN20'
#!/usr/bin/env bash
exit 0
SSEOF_CLEAN20
chmod +x "${TMPDIR_TEST}/ss"

# 20a: write record for port 8001 → only instance-p8001.rec exists.
clean_recs
write_test_rec 8001 GPU-20A

if [ -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" ]; then
  ok "20a: record for port 8001 exists at instance-p8001.rec"
else
  not_ok "20a: record for port 8001 exists" "not found"
fi
if [ ! -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" ]; then
  ok "20a: port 8001 record does not appear at instance-p8002.rec path"
else
  not_ok "20a: port 8001 record does not appear at instance-p8002.rec path" \
    "unexpected file found"
fi

# 20b: start port 8001 and port 8002 independently → two distinct records.
clean_recs
CUDA_VISIBLE_DEVICES="GPU-20B-CASE" \
  bash "$CANDIDATE" start-qwen27 >/dev/null 2>&1 || true
MODEL_SERVER_PORT=8002 CUDA_VISIBLE_DEVICES="GPU-20B-TI" \
  bash "$CANDIDATE" start-qwen35 >/dev/null 2>&1 || true

if [ -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" ] && \
   [ -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" ]; then
  ok "20b: both port-8001 and port-8002 records created independently"
else
  not_ok "20b: both records created" \
    "p8001=$(ls "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" 2>/dev/null || echo absent) p8002=$(ls "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" 2>/dev/null || echo absent)"
fi

UNIT_20B_8001="$(grep '^unit=' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" 2>/dev/null | cut -d= -f2- || true)"
UNIT_20B_8002="$(grep '^unit=' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" 2>/dev/null | cut -d= -f2- || true)"
if [ -n "$UNIT_20B_8001" ] && [ -n "$UNIT_20B_8002" ] && \
   [ "$UNIT_20B_8001" != "$UNIT_20B_8002" ]; then
  ok "20b: port-8001 and port-8002 records have distinct unit names"
else
  not_ok "20b: records have distinct unit names" \
    "8001='${UNIT_20B_8001:-<empty>}' 8002='${UNIT_20B_8002:-<empty>}'"
fi
if grep -q '^gpu=GPU-20B-CASE$' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" 2>/dev/null; then
  ok "20b: port-8001 record gpu field is GPU-20B-CASE"
else
  not_ok "20b: port-8001 record gpu field is GPU-20B-CASE" \
    "got: $(grep '^gpu=' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" 2>/dev/null || echo '<missing>')"
fi
if grep -q '^gpu=GPU-20B-TI$' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" 2>/dev/null; then
  ok "20b: port-8002 record gpu field is GPU-20B-TI"
else
  not_ok "20b: port-8002 record gpu field is GPU-20B-TI" \
    "got: $(grep '^gpu=' "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" 2>/dev/null || echo '<missing>')"
fi

# 20c: stop port 8001 (via counting ss mock) → p8001 record deleted, p8002 intact.
bash -c 'exit 0' &
DEAD_PID_20C=$!
wait "$DEAD_PID_20C" 2>/dev/null || true

SS_COUNT_20C="${TMPDIR_TEST}/ss_count_20c"
printf '0\n' > "$SS_COUNT_20C"
cat > "${TMPDIR_TEST}/ss" <<SSEOF_20C
#!/usr/bin/env bash
count=\$(cat "${SS_COUNT_20C}" 2>/dev/null || printf '0')
count=\$((count + 1))
printf '%s\n' "\$count" > "${SS_COUNT_20C}"
if [ "\$count" -le 1 ]; then
  if [[ "\$*" == *"-ltnp"* ]]; then
    printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:* users:(("llama-server",pid=${DEAD_PID_20C},fd=3))\n'
  elif [[ "\$*" == *"-ltn"* ]]; then
    printf 'LISTEN 0 128 127.0.0.1:8001 0.0.0.0:*\n'
  fi
fi
SSEOF_20C
chmod +x "${TMPDIR_TEST}/ss"

CMDLINE_20C="${TMPDIR_TEST}/proc_cmdline_20c.txt"
printf '%s %s\n' "$STABLE_SERVER_PATH" "$QWEN27_PATH" > "$CMDLINE_20C"

# Overwrite p8001 record with the dead PID's unit so MainPID cross-check passes.
printf 'unit=test-unit-p8001\ngpu=GPU-20C\nmodel=%s\nport=8001\n' \
  "$QWEN27_PATH" > "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec"

exit_code=0
out="$(MOCK_SYSTEMCTL_MAINPID="${DEAD_PID_20C}" \
  _DSH_LAUNCHER_TEST_MODE="$TEST_SENTINEL" \
  _MOCK_PROC_CMDLINE_FILE="$CMDLINE_20C" \
  bash "$CANDIDATE" stop 2>&1)" || exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  ok "20c: stop port 8001 exits 0"
else
  not_ok "20c: stop port 8001 exits 0" "got ${exit_code}: ${out}"
fi
if [ ! -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8001.rec" ]; then
  ok "20c: port-8001 record deleted after stop"
else
  not_ok "20c: port-8001 record deleted after stop" "record still exists"
fi
if [ -f "${TEST_XDG_LOCK}/dsh-launcher/instance-p8002.rec" ]; then
  ok "20c: port-8002 record untouched by port-8001 stop"
else
  not_ok "20c: port-8002 record untouched by port-8001 stop" "port-8002 record gone"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
printf '\n1..%s\n# passed: %s  failed: %s\n' "$TOTAL" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
