#!/usr/bin/env bash
# Software-only regression tests for launcher argument forwarding.
# Uses PATH injection to mock systemd-run, ss, and curl; no hardware required.
# Run: bash owner/local-model-manager/tests/launcher-arg-forwarding.test.sh

LAUNCHER="/home/liongateos/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

CAPTURE_FILE="${TMPDIR_TEST}/args.txt"
PASS=0
FAIL=0

ok()     { printf 'ok - %s\n' "$1";                              PASS=$((PASS + 1)); }
not_ok() { printf 'not ok - %s\n# %s\n' "$1" "$2";              FAIL=$((FAIL + 1)); }

assert_contains() {
  local label="$1" expected="$2" file="$3"
  if grep -qF -- "$expected" "$file" 2>/dev/null; then
    ok "$label"
  else
    not_ok "$label" "expected '${expected}' not found in captured args"
    sed 's/^/  # /' "$file" 2>/dev/null || true
  fi
}

assert_before() {
  # Pass when the line containing string $2 appears before the line containing $3.
  local label="$1" a="$2" b="$3" file="$4"
  local line_a line_b
  line_a="$(grep -nF -- "$a" "$file" 2>/dev/null | head -1 | cut -d: -f1)" || line_a=""
  line_b="$(grep -nF -- "$b" "$file" 2>/dev/null | head -1 | cut -d: -f1)" || line_b=""
  if [ -n "$line_a" ] && [ -n "$line_b" ] && [ "$line_a" -lt "$line_b" ]; then
    ok "$label"
  else
    not_ok "$label" "'$a' (line ${line_a:-?}) must appear before '$b' (line ${line_b:-?})"
  fi
}

# ── Mock binaries ─────────────────────────────────────────────────────────────

# systemd-run: write each argument on its own line to the capture file, exit 0.
cat > "${TMPDIR_TEST}/systemd-run" <<MOCKEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${CAPTURE_FILE}"
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/systemd-run"

# ss: no output — port not in use.
cat > "${TMPDIR_TEST}/ss" <<'MOCKEOF'
#!/usr/bin/env bash
exit 0
MOCKEOF
chmod +x "${TMPDIR_TEST}/ss"

# Write models JSON so the curl mock can cat it.
QWEN27_PATH="/home/liongateos/models/gguf/Qwen3.8-27B/Qwen3.8-27B-Uncensored-Q8_0.gguf"
QWEN35_PATH="/home/liongateos/models/gguf/Qwen3.5-27B-Q5_K_M/Qwen_Qwen3.5-27B-Q5_K_M.gguf"
VISION_PATH="/home/liongateos/models/gguf/Qwen3.8-27B-HauhauCS-Vision/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf"
CODER_PATH="/home/liongateos/models/gguf/Qwen3-Coder-30B-A3B/qwen3-coder-30b-a3b-instruct-q8_0.gguf"
printf '{"data":[{"id":"%s"},{"id":"%s"},{"id":"%s"},{"id":"%s"}]}\n' \
  "$QWEN27_PATH" "$QWEN35_PATH" "$VISION_PATH" "$CODER_PATH" \
  > "${TMPDIR_TEST}/models.json"

# curl: /health exits 0; /v1/models streams the models JSON file.
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

export PATH="${TMPDIR_TEST}:${PATH}"

# ── Tests ─────────────────────────────────────────────────────────────────────

# start-qwen27 with one extra profile arg
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-test" bash "$LAUNCHER" start-qwen27 --ctx-size 131072 >/dev/null 2>&1 || true
assert_contains "extra arg --ctx-size forwarded to start-qwen27"      "--ctx-size"    "$CAPTURE_FILE"
assert_contains "extra arg value 131072 forwarded to start-qwen27"    "131072"        "$CAPTURE_FILE"
assert_contains "model path present in start-qwen27 args"             "$QWEN27_PATH"  "$CAPTURE_FILE"
assert_contains "--host 127.0.0.1 present in start-qwen27 args"       "127.0.0.1"     "$CAPTURE_FILE"

# Arg ordering: hardcoded inference default → profile override → fixed safety arg
assert_before "hardcoded --flash-attn comes before profile --ctx-size" \
  "--flash-attn" "--ctx-size" "$CAPTURE_FILE"
assert_before "profile --ctx-size comes before fixed --host" \
  "--ctx-size" "--host" "$CAPTURE_FILE"

# start-qwen35 with multiple extra args
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-test" bash "$LAUNCHER" start-qwen35 --ctx-size 65536 --n-predict 512 >/dev/null 2>&1 || true
assert_contains "first extra arg forwarded to start-qwen35"           "--ctx-size"    "$CAPTURE_FILE"
assert_contains "second extra arg forwarded to start-qwen35"          "--n-predict"   "$CAPTURE_FILE"

# ── Selected-context pin (llama.cpp last-wins `-c`) ───────────────────────────

# The launcher derives -c from the provider config; the appended pin must be
# accepted as a second -c occurrence ordered AFTER the launcher's own value.
rm -f "$CAPTURE_FILE"
CUDA_VISIBLE_DEVICES="GPU-test" bash "$LAUNCHER" start-qwen35 -c 32768 >/dev/null 2>&1 || true
PIN_COUNT="$(grep -cxF -- '-c' "$CAPTURE_FILE")"
if [ "$PIN_COUNT" -ge 2 ]; then
  ok "appended context pin appears alongside the launcher-derived -c (count: $PIN_COUNT)"
else
  not_ok "appended context pin alongside the launcher-derived -c" "expected >= 2 occurrences of '-c', found: ${PIN_COUNT:-0}"
fi

pin_order_ok() {
  local label="$1" file="$2"
  local values first second
  # Values on the line immediately after each '-c' argument line.
  values="$(awk '$0 == "-c" { getline nextline; v = v nextline " " } END { sub(/ $/, "", v); print v }' "$file")"
  first="${values%% *}"
  second="$(printf '%s' "$values" | cut -d' ' -f2)"
  if [ "$first" = "65536" ] && [ "$second" = "32768" ]; then
    ok "$label"
  else
    not_ok "$label" "expected launcher-derived 65536 then pin 32768, got: '$first' then '$second'"
  fi
}
pin_order_ok "the appended context pin is ordered after the launcher-derived -c" "$CAPTURE_FILE"

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
printf '\n1..%s\n# passed: %s  failed: %s\n' "$TOTAL" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
