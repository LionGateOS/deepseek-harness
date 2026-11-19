# Local Model Manager — durable handoff / status

Last updated: 2026-10-26. If this chat session is gone, this file (plus
`ACTIVATION.md`) contains everything needed to continue the project.

**Project-wide current state and next-action authority:** `../PROJECT_STATE.md`

## Status: ACTIVATED — **JOB 17 COMPLETE (2026-10-26) — Adopt External Server implemented; planAdoptInstance/confirmAdoptInstance with 7-check plan + 4-check confirm; AdoptDialog UI; 328/328 tests pass; Harness restart required to deploy; live adoption pending owner approval**

### Electricity Phase 2 — measured GPU energy and per-job cost — PREPARED (2026-11-06)

**Scope:** live GPU energy and its electricity cost per job, built on the Phase 1
wattage reading. Board power only (never wall power); no CPU package power, no
whole-system estimate, no historical storage, no second poller/plugin, no
WorkRunner change, and no Strata lifecycle or GPU-config authority.

**Why the sampler exists:** Strata's own `telemetry.py` keeps `HISTORY = 60`
samples with **no timestamps**, and measurement showed four of six recent jobs
were 0 % observable in that window, so a per-job figure cannot be derived from
it. `/metrics` power history is therefore never used as the authoritative
series; only its request timing may inform attribution.

**New modules (pure, no I/O):**
- `core/tariff.js` — the verified OEB energy-component rates effective
  **2026-11-01** (`TOU_RATES` 9.1 / 14.6 / 18.9 ¢/kWh), the winter/summer
  weekday shapes, weekends and every 2026 OEB holiday priced off-peak, the
  weekend-holiday shift rule, `America/Toronto` local time via `Intl`,
  `instantForLocalHour` (DST fall-back resolves to the first occurrence),
  `nextBoundary`, and `splitAtBoundaries` which tiles a span with no gap and
  no overlap.
- `core/energy.js` — trapezoidal `integrate(samples, from, to, {maxGapMs})`
  returning `{wh, cents, coverage, coveredMs, gapMs, sampleCount, pieces,
  gaps}`. An interval longer than the gap threshold is a **gap**, never an
  interpolation; coverage is reported as measured and is never scaled up.
  Consecutive slices at one rate coalesce into a single piece.
  `classifyAttribution` yields `exclusive` / `shared` / `overlapping-jobs` /
  `partial`, with `approximate` and human-readable reasons.
- `core/power-sampler.js` — `PowerRing` (bounded, default 7200 records ≈ 2 h),
  `buildRecord` keeping `{t, gpus:[{uuid, watts, limitW, utilPct}],
  processes:[{uuid, pid, processName}]}`, and `createSampler` whose timer and
  clock are injected. `stop()` is idempotent and awaits any in-flight sample.
  `activeWindow` derives the job window from observed card activity: it starts
  at the first busy sample and ends at the last one, and reports `open` rather
  than inventing time up to the present.

**Attribution:** PIDs come from `--query-compute-apps`, re-read on every sample,
so the real GPU worker is attributed and a restart is observed. The port
listener is never used — for Strata, port 8080's listener is the proxy
(`python3.12`) while the worker is `strata-dsv41`.

**Lifecycle:** `apply()` registers a second `ctx.effect` that starts the
sampler and releases it on unload, so no timer outlives the plugin. Nothing is
written to disk at 1 Hz; the ring is in memory only.

**Config:** `powerSamplingEnabled` (default `false` — Phase 1 behaviour is
unchanged when off), `powerRingCapacity` (7200), `powerSampleIntervalMs`
(1000), `tariffGpuUuid` (defaults to `preferredLaunchGpuUuid`). The deployed
`cordis.patch.yml` enables it and pins `tariffGpuUuid` to the RTX 3090 Ti.

**Snapshot:** `electricity` names the measurement class, the GPU, the current
TOU period/rate/season/effective date/source, the live draw and limit, the cost
per hour, the sampler's retention, and the last job's energy, cost, runtime,
coverage, sample count, gap count, PIDs, attribution, and per-rate pieces.
`job` is `null` when sampling is disabled or nothing was observed.

**UI:** an **Electricity** card after the GPU cards shows the current draw, the
period and rate, the hourly cost, and the measured job (energy, cost, observed
runtime, coverage with sample count, GPU PIDs, and each rate change). The
measurement-class note is always present; a shared or partial measurement is
labelled as such instead of presenting an exact figure. Sampling off explains
how to enable it and shows no invented job.

**Tests:** `tests/tariff.test.js` (11), `tests/energy.test.js` (13),
`tests/power-sampler.test.js` (12), plus electricity cases in
`tests/service.test.js` and `tests/client-render.test.js`. The only failing
test is the permanent canonical-parity gate while the Capability Dashboard V1
candidate exists only in the canonical copy.

**Checkpoint before modification:**
`~/.local/share/liongateos/deepseek-update/checkpoints/local-model-manager-pre-energy-20261106T111429-0500.tgz`
(sha256 `88b185a6b377e10e44b47fa72ea2b8584f13ff9f1120cb29382ce8488df04c33`),
covering both the source tree and the canonical bundle.

**Harness restart required to deploy.**

### GPU Wattage Phase 1 — verified live wattage on the existing cards — PREPARED (2026-11-06)

**Scope:** display-only wattage in the existing Local Model Manager. No tariff,
cost, energy accumulation, sampler, ledger, history, CPU/package power,
whole-system estimate, new plugin/tab/daemon, or Strata/WorkRunner change. Strata
stays an observed GPU workload; LMM gains no start/stop/GPU-mode authority.

**`core/gpus.js`** — the existing read-only query gains three columns after the
untouched identity/memory/utilization columns:

- `GPU_COLUMNS = 'index,name,uuid,memory.used,memory.total,utilization.gpu'`
- `POWER_COLUMNS = 'power.draw.instant,power.draw,power.limit'`
- `parseWatts` accepts a decimal with an optional trailing `W`, and returns null
  for `[N/A]`, `[Not Supported]`, blank, negative, or garbage cells.
- `parseGpuLine` now takes `powerDrawW: parseWatts(powerInstant) ?? parseWatts(powerDraw)`
  (instant preferred, average fallback) and `powerLimitW: parseWatts(powerLimit)`.
  A 6-column row still parses, so a driver without power fields loses no card fact.
- `queryGpus` tries the full query, retries `GPU_COLUMNS` alone when the driver
  rejects the power fields, and only then reports `status: 'unavailable'`.

**`index.js`** — the GPU rows spread the parsed fields and normalize both to
`null` when absent, so every snapshot row carries `powerDrawW`/`powerLimitW`
explicitly. Identity, reservation, lock, process, and launch paths are untouched.

**`client.js`** — new `fmtPower` renders `XXX.X W / XXX W limit`; a card whose
draw is unreadable renders the localized **Not reported by this driver** (with
the limit still named when readable), and a failed query renders only the
existing error row. New keys `powerDraw`, `powerNotReported` in both locales.

**Tests:** `tests/gpus.test.js` covers decimal parsing, the `power.draw`
fallback, unsupported/blank/malformed/negative cells, both card identities,
the reduced-query retry, and the unavailable state. `tests/service.test.js`
checks the snapshot fields per card. `tests/client-render.test.js` checks both
cards' rows, the unavailable state, the limit-only state, and that a failed
query renders no power row. 338 LMM JS tests; the only pre-existing failures were
the two canonical-parity gates, cleared by this sync.

**Canonical sync:** changed files copied source → canonical with
`.before-wattage-20261106T084620-0500` backups; the canonical `client.js` was
patched surgically so the owner's Capability Dashboard V1 candidate survives;
`SHASUMS-v1.sha256` regenerated (83 entries) and `CUSTOMIZATIONS-MANIFEST.txt`
updated to that file's digest plus a history line. Both checksum files are
regenerated last, because they cover these documents: read the recorded digest
from the manifest row, not from this file.
The canonical bundle runs 341/341 with the Dashboard intact.

**Harness restart required to deploy** — live activation is the owner's
explicit approval. Source `SHASUMS-v1.sha256` holds 46 entries and verifies
clean; its digest changes whenever this file does.

### Multi-instance integration Job 17 — Adopt External Server — COMPLETE (2026-10-26)

**Goal:** Allow the owner to take LMM ownership of a running model server that was started outside the LMM (no `.rec` file). Port 8001 is currently `owned: false` (External) because it was restarted by the original `dsh-model-server` launcher which does not write `.rec`. The Adopt feature verifies the server's identity and writes the ownership record.

**Root cause for port 8001 External state:** After the Job 16 Harness restart the owner performed previously, port 8001 was restarted by the original `dsh-model-server` launcher (unit name has no `-p8001` suffix; no `.rec` written). The candidate launcher writes the `.rec`; the original one does not.

**New service methods — `owner/local-model-manager/index.js`:**
- `planAdoptInstance(port)` — seven-check verification: (1) port is a configured instance, (2) no existing `.rec`, (3) server is reachable (probe), (4) PID listening on port (`getServerPid`), (5) PID appears in GPU process list (`queryGpus`), (6) GPU UUID matches the configured instance UUID, (7) systemd unit found via `findUnitForPid`. Returns `{ status: 'planned', confirmToken, port, pid, unitName, gpuUuid, impact }` on success, or `{ status: 'refused', reason }` on any check failure. Token format: `adopt-<nowMs.base36>-<randomHex>`.
- `confirmAdoptInstance(confirmToken)` — four re-check verification: (1) token valid and not expired, (2) `.rec` still absent, (3) PID unchanged on port, (4) systemd unit still owns same PID. On success, writes `.rec` atomically (tmp→rename) in the same format as the candidate launcher. Returns `{ status: 'ok' }` or `{ status: 'refused', reason }`.
- `#adoptTokens = new Map()` — token store separate from `#launchTokens`.
- New module-level `findUnitForPid(pid, deps)` helper: lists active `dsh-model-*` services via `systemctl --user list-units`, then `systemctl --user show <unit> --property=Id,MainPID` for each until a match is found.
- Updated imports: `writeFile`, `rename` from `node:fs/promises`; `execFile` from `node:child_process`; `promisify` from `node:util`.
- `REMOTE_METHODS` updated: 11 → 13 (added `planAdoptInstance`, `confirmAdoptInstance`).
- `apply()` state extended: `findUnitForPid: undefined, writeFile: undefined, rename: undefined`.

**New client UI — `owner/local-model-manager/client.js`:**
- `AdoptDialog` component: shown when `adoptDialog` state is non-null. Displays plan summary (unitName, PID, impact), Confirm and Cancel buttons. Shows success/failed/refused overlays based on result status.
- Adopt button added to `MultiServerSection` card: visible only when `srv.state === 'running' && srv.owned === false`.
- `Page` updated: `planAdoptInstance`/`confirmAdoptInstance` props injected; `adoptDialog` React state added; `onAdopt`/`onAdoptConfirm` handlers; `AdoptDialog` rendered.
- 10 new en locale keys + 10 zh keys: `adoptLabel, adoptPlanTitle, adoptImpact, adoptUnitNote, adoptConfirmButton, adoptCancel, adoptDone, adoptFailed, adoptRefused, adoptClose`.
- `registerPanel` inject and `$mount` descriptors updated.

**New tests:**
- `tests/service.test.js`: updated from "eleven" → "thirteen methods"; `planAdoptInstance`/`confirmAdoptInstance` added to expected method list.
- `tests/multi-instance.test.js`: `makeAdoptService` factory + 13 new service tests (plan success, plan refuses unconfigured/already-owned/stopped/PID-not-found/PID-absent-from-GPU/UUID-mismatch/no-unit; confirm success with atomic write, confirm refuses invalid-token/single-use/PID-changed/unit-changed).
- `tests/client-render.test.js`: `renderPage` updated; `SNAP_ADOPT` fixture; 3 new render tests (Adopt button shown for running unowned, absent for stopped, clicking opens plan dialog).
- `tests/load-client.js`: METHODS updated to 13.

**Test evidence:** 328/328 LMM JS tests pass.

**Canonical bundle synced:**
- `index.js` copied + backup `index.js.before-job17-adopt-20261026-140536`
- `client.js` copied + backup `client.js.before-job17-adopt-20261026-140536`
- `tests/service.test.js` copied + backup `tests/service.test.js.before-job17-adopt-20261026-140536`
- `tests/multi-instance.test.js` copied + backup `tests/multi-instance.test.js.before-job17-adopt-20261026-140536`
- `tests/client-render.test.js` copied + backup `tests/client-render.test.js.before-job17-adopt-20261026-140536`
- `tests/load-client.js` copied + backup `tests/load-client.js.before-job17-adopt-20261026-140536`
- `SHASUMS-v1.sha256` regenerated (excluding itself); digest `fc4d27a9…`
- `CUSTOMIZATIONS-MANIFEST.txt` sha256 updated to `fc4d27a90221b39626ac3334557d98285728dfadfb1dc194d804cbfe6f929ab7`

**Activation:** Requires Harness restart to deploy `index.js` and `client.js`. Both running model servers are unaffected by this code change. Live adoption of port 8001 must be performed by the owner via the panel after the restart: `planAdoptInstance(8001)` → review plan → `confirmAdoptInstance(token)`.

---

### Multi-instance integration Job 16 — per-slot planLaunch/confirmLaunch — COMPLETE (2026-10-26)

**Goal:** Fix the bug where `planLaunch` probed the global `endpointBase` (port 8001) instead of the target slot. When port 8001 was running Qwen3.5 and you tried to launch Qwen3.5 on port 8002 via a profile, it returned "Qwen3.5 27B Q5_K_M is already the running model — nothing to launch." Same bug in `confirmLaunch` (wrong re-probe and wrong launcher).

**Root cause:** `planLaunch` (and `confirmLaunch`) always called `state.probe()` which probes `endpointBase` regardless of which instance the launch profile targets.

**Fix — `owner/local-model-manager/index.js`:**
- `planLaunch`: after model lookup, compute `targetInstance` by matching the profile's single GPU UUID against `config.instances`. Use the per-instance probe for the target slot; use `config.candidateLauncherPath` for the launcher check.
- `confirmLaunch`: destructure `targetInstance` from the token; apply the same per-slot probe before re-checking and for context verification; spread `MODEL_SERVER_PORT`, `MODEL_SERVER_GPU_UUID`, `CUDA_VISIBLE_DEVICES` into the spawn env; use `config.candidateLauncherPath` via a config override.
- Both-GPU profiles (`gpuMode: 'both'`) and profiles whose GPU UUID has no matching instance continue to use the global probe and installed launcher (no behavior change).

**New tests — `owner/local-model-manager/tests/launch-profile-plan.test.js`:**
7 new tests: per-slot probe routing, same-model-second-slot allowed, target-slot-already-running refused, target-slot-different-model refused, both-GPU uses global probe, confirmLaunch uses candidateLauncherPath + injects env, confirmLaunch probes only target slot.

**Test evidence:** 312/312 LMM JS tests pass. 1377/1377 session-controller + agent-default-model + headless + llm-pi-ai tests pass.

**Canonical bundle synced:**
- `index.js` copied + backup `index.js.before-job16-per-slot-planlaunch-<STAMP>`
- `tests/launch-profile-plan.test.js` copied + backup
- `SHASUMS-v1.sha256` regenerated; digest `c1063460…`
- `CUSTOMIZATIONS-MANIFEST.txt` sha256 updated to `c1063460…`

**Activation:** Requires Harness restart to deploy `index.js`. Both running model servers are unaffected (no live config or process changes).

### Multi-instance integration Job 15 — ownership transition of both model servers — COMPLETE (2026-10-25)

**Goal:** Transition both model servers from "External" (no `.rec` ownership files) to LMM-owned by stopping each one and restarting via the LMM plan/confirm workflow.

**Procedure:**
1. Port 8001 (previously started by original launcher `dsh-model-server`): stopped via `dsh-model-server stop`. Started via LMM `planAction('start', {modelKey:'qwen35', instancePort:8001})` → `confirmAction(token)`. Unit: `dsh-model-1792971140186-qwen3.5-27b-q5-k-m-p8001`.
2. Port 8002 (previously an orphaned direct process, PID 2531315): killed via `kill 2531315`. Started via LMM `planAction('start', {modelKey:'qwen35', instancePort:8002})` → `confirmAction(token)`. Unit: `dsh-model-1792971486907-qwen3.5-27b-q5-k-m-p8002`.

**Final snapshot (verified via RPC at 2026-10-25 23:38):**
- Port 8001: `owned: true`, state: running, model: qwen35, context: 65536, actualGpu: NVIDIA GeForce RTX 3090 Ti (UUID: `GPU-009aea9f-1bb8-d43b-b56a-abe166f629b0`)
- Port 8002: `owned: true`, state: running, model: qwen35, context: 65536, actualGpu: NVIDIA GeForce RTX 3090 (UUID: `GPU-4144e557-ad9a-83b3-014a-61f67141c547`)

**Ownership records written by candidate launcher:**
- `${XDG_RUNTIME_DIR}/dsh-launcher/instance-p8001.rec` — `gpu=GPU-009aea9f…`, `port=8001`
- `${XDG_RUNTIME_DIR}/dsh-launcher/instance-p8002.rec` — `gpu=GPU-4144e557…`, `port=8002`

**RPC endpoint format confirmed:** `POST /api/localModelManager/<method>` with body `{"type":"client-request","rpcId":"<id>","method":"localModelManager/<method>","payload":{"args":{<named-params>}}}` — the `method` field in the payload must match the full `namespace/method` URL endpoint.

**Switch model UI:** Both servers are now `owned=true` and running, so the Switch model section is active for both cards in the LMM panel. Switch buttons are enabled.

**No code or test changes.** This job was a live operational transition only.

---

### Multi-instance integration Job 14 — GPU-to-port mapping correction — COMPLETE (2026-10-25)

**Goal:** Correct the `instances` configuration so the configured GPU UUIDs match the actual running servers.

**Root cause:** The original `instances` array had port 8001 → RTX 3090 (CASE UUID) and port 8002 → RTX 3090 Ti. The actual running servers are reversed: port 8001 runs on RTX 3090 Ti and port 8002 runs on RTX 3090 (CASE). This caused the snapshot to show a mismatch badge on every server card.

**Change — `cordis.patch.yml` `instances` only:**
- Port 8001: `gpuUuid: GPU-009aea9f-1bb8-d43b-b56a-abe166f629b0`, `gpuName: RTX 3090 Ti`
- Port 8002: `gpuUuid: GPU-4144e557-ad9a-83b3-014a-61f67141c547`, `gpuName: RTX 3090`

`launchProfiles` and all other config fields are unchanged.

**Effect after Harness restart:**
- `snapshot()` `servers` entries will show `gpuName` matching `actualGpuName` — no mismatch badge
- `planLaunch`/`confirmLaunch` for a Ti profile will correctly target port 8001; for a CASE profile, port 8002
- `planAction('start', {instancePort: 8001})` will pass `MODEL_SERVER_GPU_UUID=GPU-009aea9f…` (Ti) to the candidate launcher — correct
- `planAction('start', {instancePort: 8002})` will pass `MODEL_SERVER_GPU_UUID=GPU-4144e557…` (CASE) — correct

**Both model servers untouched:** PIDs 2530070 (port 8001) and 2531315 (port 8002) verified unchanged.

**Backup:** `~/.local/share/liongateos/deepseek-update/customizations/local-model-manager/cordis.patch.yml.before-gpu-mapping-correction-20261025-184521` (sha256 `f1a9670f…`)

**Test counts:** 305/305 pass (no test changes needed)

**SHASUMS regenerated:** sha256 `aaeb764a893350e27c4475a481791d4ced35554de03fddb9505412430c28edcb`

**Canonical bundle synced:** `cordis.patch.yml` copied to canonical.

**CUSTOMIZATIONS-MANIFEST.txt updated:** Entry 5 sha256 = `aaeb764a893350e27c4475a481791d4ced35554de03fddb9505412430c28edcb`

**Activation:** Requires Harness restart. The running Harness holds the old (inverted) config in memory. After restart, the corrected mapping takes effect.

---

### Multi-instance integration Job 13 — per-server model switch UI — COMPLETE (2026-10-25)

**Goal:** The owner must be able to select a GPU, select a managed model, and switch models from the LMM interface.

**Design decision:**
- `planAction('switch', {instancePort, modelKey})` already works for `owned=true` instances (the candidate launcher's `switch` command stops the current model via `.rec` ownership check, then starts the new model).
- For `owned=false` instances (both current servers — externally started, no `.rec` files), switch is correctly refused by the host and must be blocked in the UI.
- No backend changes needed: the ownership check in `planAction` is already in place from Job 12.

**Changes — `client.js`:**
- Added 3 new locale keys (`en` + `zh`): `instanceSwitchTitle`, `instanceSwitchHint`, `instanceSwitchBlockedNote`
- Updated `MultiServerSection`: when a server is running and `owned=true`, shows a "Switch model" section with one button per installed model (excluding the currently running one); buttons are disabled only when the server is busy. When running and `owned=false`, shows a plain-language blocked note directing the owner to stop manually and then use "Start on this GPU" from a model card.
- Switch buttons call `onAction('switch', m, srv.port)` → `planAction('switch', {modelKey: m.key, instancePort: srv.port})` → plan/confirm dialog (same flow as all other actions).

**Transition path for current unowned servers:**
- Port 8001 (original launcher's transient systemd unit): stop via `dsh-model-server stop`; then use "Start on RTX 3090" from any model card to start under candidate launcher management (writes `.rec`, becomes `owned=true`).
- Port 8002 (orphaned direct process): stop manually (`kill <PID>` or `systemctl --user stop` on its session); then use "Start on RTX 3090 Ti" from any model card.
- After either transition, the newly started instance is `owned=true` and the Switch model section appears with buttons for all other installed models.

**Changes — `tests/client-render.test.js`:**
- 3 new tests: switch buttons shown for owned running server; switch buttons absent for unowned server; switch button calls `planAction('switch', {instancePort, modelKey})` correctly.

**Test counts:** 305/305 pass (up from 302; 3 new tests)

**SHASUMS regenerated:** sha256 of SHASUMS-v1.sha256 = `2f5aaecae84bedad55be6ff765d3ae3d4a7999e49df30a476e619534be0dd7ac`

**Canonical bundle synced:** `client.js` and `tests/client-render.test.js` copied to canonical.

**CUSTOMIZATIONS-MANIFEST.txt updated:** Entry 5 sha256 = `2f5aaecae84bedad55be6ff765d3ae3d4a7999e49df30a476e619534be0dd7ac`

**Harness restart:** Required to serve updated `client.js`. Both model servers remain unaffected (no backend changes).

---

### Multi-instance integration Job 12 — GPU label fix and ownership-aware controls — COMPLETE (2026-10-25)

**Status:** Both documented issues resolved. Harness restarted (PID 2771333). 302/302 JS tests pass (9 new tests added). Snapshot verified via RPC.

**Issue A — Actual GPU identity (FIXED):**
- `snapshot()` now calls `getServerPid(port)` for each instance to identify the PID listening on the port
- Cross-references the PID with `gpus.processes` (nvidia-smi compute-apps data) to find the actual GPU UUID and name
- Each server entry in `snap.servers` now includes `actualGpuUuid` and `actualGpuName` (both `null` when unverifiable)
- Client `MultiServerSection` shows: when mismatch detected, GPU display reads `"<configured> (Configured target) / <actual> (Actual GPU)"`; when actual unknown, appends `"— Actual GPU unknown"`
- Live verification (2026-10-25 21:41 UTC via RPC):
  - port 8001: gpuName=RTX 3090 (config), actualGpuUuid=GPU-009aea9f (Ti), actualGpuName=NVIDIA GeForce RTX 3090 Ti → **mismatch correctly detected**
  - port 8002: gpuName=RTX 3090 Ti (config), actualGpuUuid=GPU-4144e557 (CASE), actualGpuName=NVIDIA GeForce RTX 3090 → **mismatch correctly detected**

**Issue B — Ownership-aware controls (FIXED):**
- `snapshot()` checks `${XDG_RUNTIME_DIR}/dsh-launcher/instance-p${port}.rec` for each instance; adds `owned: boolean` to each server entry
- `planAction()` for instance stop/switch refuses with plain-language reason when the `.rec` ownership file is absent (defense in depth; host-side enforcement)
- Client `MultiServerSection`: Stop button disabled when `srv.owned === false`; "External" badge shown; note explains stop is unavailable
- Client `ModelCard` per-instance Stop buttons also disabled when `srv?.owned === false`
- Live verification: `planAction('stop', { instancePort: 8001 })` → `status: refused`, reason: "instance on port 8001 was not started by this panel's launcher"
- Both current instances: `owned: false` (externally started, no .rec files) — Stop buttons correctly disabled

**Files changed:**
- `index.js`: import `getServerPid`; add `instancePids`/`instanceOwned` queries in `snapshot()`; add `actualGpuUuid`, `actualGpuName`, `owned` to server entries; add ownership check in `planAction()` for instance stop/switch
- `client.js`: add 7 new locale keys (en/zh); update `MultiServerSection` (ownership badge, GPU mismatch display, disabled Stop); update `ModelCard` per-instance Stop buttons
- `tests/multi-instance.test.js`: 7 new tests (owned/unowned states, actualGpu lookup, planAction refusal)
- `tests/client-render.test.js`: 2 new tests (Stop disabled for unowned, Stop enabled for owned)

**Test counts:** 302/302 pass (up from 293; 9 new tests added)

**SHASUMS regenerated:** sha256 of SHASUMS-v1.sha256 = `6c966954fed564766fc1d56759474f608843cb691b4139ebaf050ae73b905eaa` (4 file entries updated: index.js, client.js, tests/multi-instance.test.js, tests/client-render.test.js)

**Canonical bundle synced:** All 4 changed files copied to `~/.local/share/liongateos/deepseek-update/customizations/local-model-manager/`

**CUSTOMIZATIONS-MANIFEST.txt updated:** Entry 5 sha256 updated to `6c966954fed564766fc1d56759474f608843cb691b4139ebaf050ae73b905eaa`

---

### Multi-instance integration Job 11 — final Harness activation and snapshot verification — COMPLETE (2026-10-25)

**Status:** Harness restarted (PID 2556868). LMM snapshot verified via authenticated RPC. Both instances active. 293/293 JS tests pass.

**Harness restart (2026-10-25 14:06 EDT):**
- Service: `deepseek-harness-web.service` restarted to new PID 2556868
- Web endpoint: `http://127.0.0.1:3080/` — responds with 200 OK
- Log: clean startup; no LMM or client-module errors
- Both model servers survived restart with unchanged PIDs and GPU assignments

**LMM snapshot verification (2026-10-25 18:37 UTC via RPC):**
- `servers[0]`: port 8001, gpuName="RTX 3090" (config label), state=running, liveContext=65536
- `servers[1]`: port 8002, gpuName="RTX 3090 Ti" (config label), state=running, liveContext=4096
- `models.qwen35`: runtime=running, runningOnPorts=[8001, 8002]
- `gpus`: Ti (preferred, 21768 MiB), CASE (secondary, 19448 MiB) — both have active processes
- `actionsAvailable`: start=true, stop=true, switch=true, multipleJobs=false
- `errors`: []

**GPU label inversion (documented limitation):**
The instances config assigns port 8001 → RTX 3090 (CASE UUID) and port 8002 → RTX 3090 Ti.
However, the currently running servers were started by external means (original launcher and orphaned process) which assigned them in the opposite order:
- Port 8001 is actually on Ti GPU (original launcher prefers Ti)
- Port 8002 is actually on CASE GPU (orphaned process)
The LMM panel will display "RTX 3090" for port 8001 and "RTX 3090 Ti" for port 8002, but the true GPU assignments are reversed until servers are restarted via the candidate launcher (which will enforce the config-correct assignments).

**Multi-instance UI client bundle:**
The client.js (Job 9, per-instance Stop buttons) is served via the symlink to the canonical bundle. The client-modules system reads the source file directly; no separate build step is needed. Per-instance Stop buttons appear in multi-instance ModelCard mode.

**Regression tests (2026-10-25):**
- JS tests: 293/293 pass (no regressions)

**What remains (at Job 11 close, both resolved in Job 12):**
- ~~GPU label inversion~~ — FIXED in Job 12: actual GPU identity now detected and displayed; mismatch badge shown.
- ~~Unsafe Stop buttons for externally started servers~~ — FIXED in Job 12: `owned` field in snapshot; Stop disabled when unowned; host refuses stop/switch without .rec file.

---

### Multi-instance integration Job 10 — supervised live activation and restoration — COMPLETE (2026-10-25)

**Status:** Live multi-instance start/stop/isolation tested on both GPUs. Candidate launcher installed. Original workloads restored. 293/293 JS tests pass.

**Phase 1 — Baseline snapshot (2026-10-25):**
- Port 8001: llama-server PID 2526015, GPU-009aea9f (RTX 3090 Ti), n_ctx=65536, managed by dsh-model-server original launcher (transient systemd unit)
- Port 8002: llama-server PID 2526016, GPU-4144e557 (CASE RTX 3090), n_ctx=4096, orphaned direct process
- No candidate launcher file at stable path (first install)

**Phase 2 — Backup (2026-10-25):**
- No pre-existing candidate to back up — confirmed: `(no existing candidate to back up — first install)`

**Phase 3 — Candidate launcher install and Harness restart:**
- Candidate installed: `~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate`
- Source: `owner/local-model-manager/candidate/dsh-model-server-multi-instance` (695-line bash script)
- chmod +x applied
- Harness restart: Harness restart pending (Job 10 tested the candidate launcher directly; the LMM panel's UI path is not yet exercised)

**Phase 4 — Supervised live tests (2026-10-25, candidate launcher invoked directly):**
- Test A: Start port 8001 (CASE GPU, GPU-4144e557) via candidate ✓ — ownership record `instance-p8001.rec` created; transient unit active
- Test B: Start port 8002 (Ti GPU, GPU-009aea9f) via candidate while 8001 running ✓ — simultaneous operation; `instance-p8002.rec` created
- Test C: Stop port 8001 via candidate ✓ — `instance-p8001.rec` deleted; port 8001 cleared; port 8002 unaffected (cross-instance isolation confirmed)
- Test D: Stop port 8001 when free and no record ✓ — exit 0 "No model server running" (correct fail-safe)
- Test E: Stop port 8002 via candidate ✓ — `instance-p8002.rec` deleted; port 8002 cleared; exit 0
- Both GPUs idle after Phase 4; only advisory lock files remained

**Phase 5 — Restore original workloads (2026-10-25):**
- Port 8001: started via original launcher `dsh-model-server start-qwen35` → PID 2530070, GPU-009aea9f (Ti), n_ctx=65536 ✓
- Port 8002: started via original command with CUDA_VISIBLE_DEVICES=GPU-4144e557... → PID 2531315, n_ctx=4096 ✓
- Both GPUs active: Ti at 21758 MiB, CASE at 19438 MiB

**Phase 6 — Verification (2026-10-25):**
- JS tests: 293/293 pass (no regressions from Job 10)
- Current deployment: Harness still running pre-Job-9 bundle (restart not yet done); original workloads active and serving

**Remaining before multi-instance is ready to use via LMM panel:**
1. Restart the Harness (deploys Job 9 bundle with per-instance Stop buttons and stable candidateLauncherPath)
2. Supervised first launch of each per-instance profile through the LMM panel (see ACTIVATION.md "Owner-approval gate")

---

### Multi-instance integration Job 9 — offline release-readiness repairs — COMPLETE (2026-10-25)

**Status:** All 4 source-level gaps patched, 4 regression tests added, canonical synced (46 entries), ACTIVATION.md updated with installation runbook. NOT deployed. No git staging.

**Files changed in Job 9:**

- `owner/local-model-manager/index.js` — `confirmAction` now tracks `instanceEntry` in its token-search loop; passes a per-instance `probeFn` to `#verifyStartedContext`. `#verifyStartedContext` signature extended with optional `probeFn`; uses `probeFn ?? (() => this.state.probe())` so single-instance behavior is unchanged.
- `owner/local-model-manager/client.js` — added `stopOnGpu` locale key (English: "Stop on", Chinese: "停止"); replaced single generic Stop button in multi-instance ModelCard branch with per-instance Stop buttons derived from `m.runningOnPorts`, each passing `instancePort` to `onAction`.
- `owner/local-model-manager/cordis.patch.yml` — `candidateLauncherPath` changed from worktree-absolute path to stable installed path `~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate`; added install-gate comment.
- `owner/local-model-manager/tests/multi-instance.test.js` — added 2 regression tests: "confirmAction uses the port-8002 probe for context verification after port-8002 start" and "confirmAction uses the main probe for context verification after port-8001 start".
- `owner/local-model-manager/tests/client-render.test.js` — added 2 regression tests: multi-instance ModelCard renders per-instance Stop and Start buttons; Stop button passes `instancePort` to planAction.
- `owner/local-model-manager/ACTIVATION.md` — added multi-instance Job 9 section with candidate launcher installation runbook, backup/rollback instructions, and owner-approval gate for supervised first launch.

**Test results (2026-10-25):**
- JS tests: 293/293 pass (4 new Job 9 regression tests; 289 prior tests)
- Bash launcher tests: 93/93 pass (unchanged)
- No real systemd, GPU, or model process invoked.

**Canonical sync (2026-10-25):**
- Files copied: `index.js`, `client.js`, `cordis.patch.yml`, `ACTIVATION.md`, `tests/multi-instance.test.js` (new), `tests/client-render.test.js`
- `SHASUMS-v1.sha256` regenerated: 46 entries (added `tests/multi-instance.test.js`; updated 5 source files + ACTIVATION.md)
- Manifest entry 5 sha256 updated to `0c793a15b17ec49453ce6a36302c0afb602c454143be8580ad2f4a5fb373bc7b`

**What remains before multi-instance is ready to use:**
1. Copy candidate launcher to stable path (see ACTIVATION.md "Installing the candidate launcher")
2. Restart the Harness
3. Supervised first launch of each per-instance profile (see ACTIVATION.md "Owner-approval gate")

---

### Multi-instance integration Job 7 — full LMM plugin integration — COMPLETE (2026-10-25)

**Status:** All source files updated, 289/289 JS tests pass, canonical sync complete (45 entries, manifest entry 5 sha256 `ab94128b…`). NOT deployed. No git staging.

**Files changed:**
- `owner/local-model-manager/core/config.js` — added `candidateLauncherPath` (optional absolute path, default `''`) and `instances` (optional array of `{port, gpuUuid, gpuName}`, default `[]`) config validation.
- `owner/local-model-manager/core/actions.js` — added exported `runLauncherForInstance(config, instanceConfig, action, model, deps)` that uses `candidateLauncherPath` and injects `MODEL_SERVER_PORT`, `MODEL_SERVER_GPU_UUID`, `CUDA_VISIBLE_DEVICES` into the env. Extended `createActions` to accept `instanceConfig`; `plan()` routes launcher path check; `confirm()` routes between `runLauncher` and `runLauncherForInstance`.
- `owner/local-model-manager/index.js` — added `this.instanceActions` array (one `createActions` per instance); per-instance token routing in `confirmAction`; `instancePort` routing in `planAction`; `snap.servers` array (present only when `instances.length > 0`); `runningOnPorts` model field; per-instance probes in `apply()`.
- `owner/local-model-manager/client.js` — added `MultiServerSection` component (per-instance server cards with Stop buttons carrying `instancePort`); `ModelCard` updated with `servers` prop; "Start on [GPU]" buttons per stopped instance; `onAction` updated to `async (action, model, instancePort)`.
- `owner/local-model-manager/cordis.patch.yml` — added `candidateLauncherPath`, `instances` array (port 8001 → RTX 3090, port 8002 → RTX 3090 Ti), `launchProfiles` extended with Ti/both profiles for all 5 models.
- `owner/local-model-manager/tests/multi-instance.test.js` — NEW; 25 CPU-only tests: config validation (5), `runLauncherForInstance` env injection (4), `createActions` with `instanceConfig` (2), snapshot `servers` array (6), planAction/confirmAction routing (5), cross-instance isolation (3).

**Architecture summary:**

- When `instances.length === 0` (default): behavior is identical to before. `this.instanceActions` is empty; `snap.servers` is absent; all tokens route through `this.actions`.
- When `instances.length > 0`: each configured `{port, gpuUuid, gpuName}` gets its own `createActions` machine. `planAction` with an `instancePort` routes to the matching machine. `confirmAction` searches `this.actions._tokens` first, then `this.instanceActions[*].actions._tokens` — the token was created by exactly one machine, so only one map contains it.
- Candidate launcher path: `config.candidateLauncherPath` is used instead of `config.launcherPath` for any `instanceConfig`-scoped action. This is the path to `dsh-model-server-multi-instance` (Job 6).
- `snap.servers` array: `[{port, gpuUuid, gpuName, endpoint, state, runningModelKey?, slots, busy?, ...}]` derived from per-instance probes.
- `snap.models[].runningOnPorts`: lists all ports where a model is currently running (same GGUF can run on both instances simultaneously).
- Backward compat: all existing tests unaffected (`instances: []` and `candidateLauncherPath: ''` default).

**Test results (2026-10-25):**
- JS tests: 289/289 pass (25 new multi-instance tests; 264 unchanged prior tests)
- Bash launcher tests: 93/93 pass (unchanged)
- No real systemd, GPU, or model process invoked in any test.

**Canonical sync (2026-10-25):**
- Files copied to `~/.local/share/liongateos/deepseek-update/customizations/local-model-manager/`: `index.js`, `client.js`, `cordis.patch.yml`, `core/config.js`, `core/actions.js`, `tests/multi-instance.test.js`
- `SHASUMS-v1.sha256` regenerated: 45 entries (added `tests/multi-instance.test.js`; updated 5 source files)
- Manifest entry 5 sha256 updated to `ab94128b5ffeb1b9f811f1728249c7a7dcff4b8a7048c8b7634c542251afefd1`
- `manifest-recovery.test.js`: 5/5 pass; canonical bundle directory test: all 45 files byte-identical

### Multi-instance launcher Job 6 — ownership record system — COMPLETE (2026-10-25, candidate only)

**Status:** candidate file and tests updated; NOT deployed; no git staging.

**Files changed (candidate, not installed):**
- `owner/local-model-manager/candidate/dsh-model-server-multi-instance` — 695 lines
- `owner/local-model-manager/tests/launcher-multi-instance.test.sh` — 1511 lines, 93/93 pass

**What was implemented:**

Option B (fail-closed, owner decision confirmed): stop refuses when no ownership record exists. No legacy cmdline-only fallback.

1. Exit code 10 added: ownership record absent, malformed, stale, or PID cross-check failed.
2. `_query_mainpid(unit)` — queries `systemctl --user show UNIT.service --property=MainPID --value`. Returns "0" on non-zero exit or empty output.
3. `start_model` changes:
   - Computes `lock_dir` once via `_get_lock_dir()`; derives both lock file and record file.
   - Fails closed (exit 10) if `instance-p${PORT}.rec` already exists (stale or conflicting).
   - After `wait_ready` succeeds: writes record atomically (tmp→rename) with fields: unit, gpu, model, port.
   - On `wait_ready` failure: no record written (exit 4 as before).
4. `safe_stop_known` changes:
   - Computes `lock_dir` at top.
   - Port free + record present → stale record → exit 10 with `rm` guidance.
   - Port in use + no record → exit 10 (Option B).
   - Port in use + record: reads/validates all 4 fields → exit 10 if missing or port-mismatch.
   - Queries `_query_mainpid(rec_unit)` → exit 10 if "0" or empty (unit not active).
   - Cross-checks MainPID vs ss PID → exit 10 if mismatch.
   - Existing cmdline check (exit 6) and GPU UUID check (exit 8) follow.
   - On successful stop (port clear): deletes the record.
5. Test infrastructure:
   - Global `export XDG_RUNTIME_DIR="${TEST_XDG_LOCK}"` — all invocations use the test lock dir; no writes to `/run/user/1000`.
   - `systemctl` mock updated to return `MOCK_SYSTEMCTL_MAINPID` env var for `--property=MainPID` queries.
   - `write_test_rec <port> [<gpu>]` and `clean_recs` helpers added.
   - All stop/switch test groups now write records + set `MOCK_SYSTEMCTL_MAINPID`.
   - Groups 18–20 added: record lifecycle, authorization failures, two-port independence.

**Test results (2026-10-25):**
- Bash launcher tests: 93/93 pass (was 57/57 before Job 6)
- JS unit tests: 264/264 pass (unchanged)
- Arg-forwarding tests: 12/12 pass (unchanged)
- No real systemd, GPU, or model process invoked in any test.

**Residual risks (documented, not mitigated):**
- PID reuse window between `kill` and port-clear (eliminated to near-zero by MainPID cross-check; pidfd would close it fully but bash cannot use it).
- XDG_RUNTIME_DIR tmpfs cleared on logout: stale records vanish automatically on XDG path; HOME fallback path persists across reboots (benign: start will refuse and give rm guidance).

**Next owner decision required before deployment:**
None — Option B was confirmed by owner. The deployment step is the only remaining gate. See PROJECT_STATE.md for deployment instructions.

### Phase 2D — automatic RTX 3090 Ti reservation removal (owner policy change) — IMPLEMENTED (worktree, 2026-10-23)

Owner directive: the automatic RTX 3090 Ti reservation is **permanently
removed** — not just released once. Every mechanism that automatically
creates, restores, defaults, initializes, or re-applies the reservation was
removed. The manual Lock/Reserve feature remains available and generic.

Canonical policy statements (verbatim):

- OLD/HISTORICAL: RTX 3090 Ti automatically reserved for GD Bible.
- RETIRED: automatic GD/Ti reservation policy.
- ACTIVE: no GPU is automatically reserved by default.
- ACTIVE: RTX 3090 Ti is preferred, RTX 3090 second, Both third.
- ACTIVE: owner can manually Lock/Reserve and Unlock/Release GPUs through LMM.

**Every removed mechanism (complete trace):**

1. `core/actions.js` — the `let protectedGpuReserved = true` module default
   recreated the reservation in memory at every service start; the
   `RELEASE_DISCLOSURE` / impact copy promised "automatically restored when
   the service restarts"; `planReleaseProtectedGpu` /
   `confirmReleaseProtectedGpu` released only the Ti. All removed.
2. `core/actions.js` `runLauncher` — env pin `CUDA_VISIBLE_DEVICES` was
   `config.caseGpuUuid` (RTX 3090 always); now the **preferred launch GPU**
   (RTX 3090 Ti by default), refusing loudly when none is configured.
3. `index.js` — snapshot rows carried `protected: true` on the Ti and a
   top-level `protectedGpuReserved`; `planLaunch` keyed the protected refusal
   off that auto-flag. Removed; replaced by the generic model below.
4. `client.js` — GD-Bible copy ("Reserved for the GD Bible workload…"),
   `gpuReleasedNote` promising automatic restoration, `needsRelease` gating
   on the auto-flag. Removed; badges/notes/handlers now read the owner's
   persisted state only. Verified: no "GD Bible" or "自动恢复" copy remains.
5. `core/profiles.js` — recommendations claimed "the reservation must be
   released first"; now describe the Ti→3090→Both preference and that no GPU
   is reserved automatically.
6. `cordis.patch.yml` — profile order reordered per model to Ti → case →
   Both; all "Reservation must be released first" notes removed; adds
   `preferredLaunchGpuUuid` and `gpuLaunchStatePath`.
7. Trusted launcher `dsh-model-server` — `start_model`'s fallback
   `CUDA_VISIBLE_DEVICES` defaulted to the RTX 3090; now the RTX 3090 Ti.
   Context fallbacks (`-c 131072` etc.) untouched.

**The generic replacement model (single source of truth = the owner's
explicit actions):**

- `core/gpu-launch-state.js` (NEW) — durable JSON
  (`{version:1, reservations:[uuid], updatedAt}`) at `gpuLaunchStatePath`;
  atomic tmp+rename writes; **absent, unreadable, or unrecognized files all
  mean unreserved**; malformed entries are dropped and counted, never kept.
- `core/actions.js` — generic `planGpuReservation(uuid, desired)` /
  `confirmGpuReservation(token)` for every allowlisted GPU in both
  directions; the in-memory set starts empty and is the only writer via the
  `reservedGpus` / `setReservedGpus` deps; apply results are verified and a
  non-applied update reports `failed` instead of pretending success.
- `index.js` — reads that file on every reservation query (never caches a
  stale copy), persists on confirm, exposes `planGpuReservation` /
  `confirmGpuReservation` (REMOTE_METHODS still eleven methods), snapshot
  rows carry `launchReserved` + `preferredLaunchTarget`, GPU rows ordered
  Ti first.
- `client.js` — one `ReservationDialog` for reserve/release; GpuCard shows
  Reserve when unreserved and Release when reserved; launch gating keys off
  `launchReserved` only.

**Configuration:** `preferredLaunchGpuUuid` (optional; defaults to
`protectedGpuUuid`, so the RTX 3090 Ti stays the preferred launch target) and
`gpuLaunchStatePath` (optional absolute path; configured to
`/home/liongateos/.local/share/liongateos/deepseek-update/gpu-launch-state.json`).
Context configuration untouched: `contextSelectionsPath`,
`reservedOutputTokens: 8192`, `headroomTokens: 16384`, provider
`contextWindow: 131072`, launcher `-c` fallbacks.

**Tests:** `tests/gpu-launch-state.test.js` (NEW, 11 tests), rewritten
reservation suites in `tests/actions.test.js` (22 tests), `tests/service.test.js`
(37), `tests/launch-profile-plan.test.js` (17), `tests/config.test.js` (15),
`tests/client-render.test.js` (22), `tests/profiles.test.js` (5) — 263/263
node tests pass; `tests/launcher-arg-forwarding.test.sh` 12/12.

**Pre-change backups:** see ACTIVATION.md Phase 2D (canonical bundle +
launcher, timestamped `…-launch-reservation-policy-20261023-122254`).

**Status:** Canonical sync complete (2026-10-23): SHASUMS regenerated (45
entries, digest `b20728c4…`), manifest entry 5 updated, launcher fallback
changed, backups verified. A Harness restart is required before the panel and
service run the new code; nothing restarts the Harness automatically. A Harness restart is required before the panel and service run
the new code; nothing restarts the Harness automatically.

### Phase 2C — automatic context selection and pre-dispatch protection — COMPLETED (2026-10-23)

Motivation: a routed qwen-local request reached the server at ~114k tokens
against a 65,536-token context (`exceed_context_size_error`, prompt tokens
95,739–114,477) because the compaction estimator undercounts code-dense
content ~2–3× and a failed compaction summarizer was treated as
"continue the turn". Two halves, shipped together:

1. **DSH half (compaction-basic).** A failed `compactRegion()` is now
   classified against the effective budget: over budget →
   `CompactionExhaustedError` blocks the turn before any model call; within
   budget → warn + continue. Cancellation unchanged. See
   `.agents/notes/implemented/bug-fix/2026-10-23-compaction-failure-dispatch-last-resort.md`
   and the package README.

2. **LMM half (automatic context selection).** For every managed model the
   service resolves four values — advertised (GGUF header best-effort via
   `core/gguf-meta.js`), configured (`contextWindow` from the provider
   configuration), optional `hardwareContextCaps`, any persisted manual
   override — and selects `manual` else min-of-bounds (`auto`, never above
   configured). Selected values persist atomically to
   `contextSelectionsPath` (`context-selections.json` next to the
   update-safe directory), survive restarts, and manual overrides are never
   replaced. Every confirmed start/app launch appends the selection as a
   trailing `-c <n>` pin through `createActions({ contextArgs })`; profiles
   with their own `-c`/`--ctx-size` are refused at plan time; after start the
   live `meta.n_ctx` is compared to the pin and mismatches are recorded
   loudly (`context-verify` error-ring rows; outcome `.context.verified`).
   The panel shows selected/source/advertised/configured/hardware cap/DSH
   usable (selected − 8192 output − 16384 headroom), the reasons list, and
   the mismatch/verified note.

**Known limits (accepted):** the automatic path never raises a window above
the configured value (an unproven larger window needs a supervised run, then
either a manual override or a `hardwareContextCaps`/provider change); the
GGUF parse is bounded and best-effort (large headers may report
`truncated` facts only); legacy `switch` does not carry the pin (launcher
execs `start-<target>` without extras) — covered by post-start
verification; models already running keep their old window until stop/start.

**Canonical sync 2026-10-23.** SHASUMS-v1.sha256 has 45 entries (added
`core/context-sizer.js`, `core/context-selections.js`, `core/gguf-meta.js`,
`tests/context-sizer.test.js`, `tests/context-selections.test.js`,
`tests/gguf-meta.test.js`; removed stale `tests/gpu-lock.test.js`;
`tests/launcher-arg-forwarding.test.sh` stays worktree-only). Manifest entry
5 sha256 `7c5b8d31de2d60f61615ece74275adcff614a6e46173f5908f3bdd4558fbe4fb`.
Pre-sync backup: `local-model-manager-backup-20261023-120524-context-auto-pre-sync/`.

### vLLM Phase A — GGUF plugin mapping repair — COMPLETED (CPU-verified, 2026-10-23)

Scope: the installed vLLM 0.32 GGUF plugin only. No Local Model Manager, trusted
launcher, GPU, or service change was made in this phase. The previous
`/tmp/vllm-032-qwen35-test.log` was not reachable from the sandboxed shell (private
`/tmp`, no GPU device nodes), so the failure was reproduced directly instead.

**Environment (corrected).** The working vLLM is **0.32.0** at
`/home/liongateos/vllm-0.32-env` (`vllm-gguf-plugin 0.0.5`, torch 2.13.0+cu130,
transformers 5.19.0). The older system install at `/home/liongateos/.local/bin/vllm`
is **0.19.0** and is not the target; the LMM `vllmBinPath` still points at it
(Phase B task).

**Root cause, reproduced without a GPU.** Running the plugin's own `prepare_loading` /
`build_name_map` against the real GGUF + tokenizer (meta device only) failed with:

```
RuntimeError: Failed to map GGUF parameters (432): ['model.layers.0.linear_attn.dt_bias', …]
```

The GGUF is text-only (`general.architecture = qwen35`, 64 layers + `blk.64.*` MTP, no
mmproj), while the tokenizer directory carries the multimodal `Qwen3_5Config`
(`vision_config`, `depth: 27`). The plugin therefore took `is_multimodal = True` and
stripped the `model.` prefix, which lost all 432 linear-attention alias matches
(48 linear layers × 9 tensors). Independently, gguf's QWEN35 map aliases
`blk.N.ssm_dt` only to the Qwen3-Next spelling `…linear_attn.dt_proj`, so the 48
Qwen3.5 `…linear_attn.dt_bias` parameters had no mapping at all.

**Patch applied** — `…/site-packages/vllm_gguf_plugin/weights_adapter/default.py`
(6 asserted edits): import `detect_gguf_multimodal`; add the
`_QWEN35_LINEAR_ATTN_NAMES` table plus `_qwen35_linear_attention_layers` /
`_seed_qwen35_linear_attention_names` helpers (layers selected from
`text_config.layer_types`); widen `build_name_map` with `model_path`; require an actual
mmproj companion before treating a model as multimodal (fallback to the previous
`vision_config` test when no path is supplied); seed the nine Qwen3.5 linear-attention
gguf→HF names for `model_type == "qwen35"`; pass `model_path` from `prepare_loading`.

```text
--- default.py.pre-phaseA-qwen35-linear-attn-20261023-095903
+++ default.py
@@ from ..gguf_utils import maybe_patch_hf_config_from_gguf
-from ..gguf_utils import maybe_patch_hf_config_from_gguf
+from ..gguf_utils import detect_gguf_multimodal, maybe_patch_hf_config_from_gguf
@@ (module level, after logger)
+_QWEN35_LINEAR_ATTN_NAMES = (
+    ("ssm_a", "linear_attn.A_log"),
+    ("ssm_conv1d.weight", "linear_attn.conv1d.weight"),
+    ("ssm_dt.bias", "linear_attn.dt_bias"),
+    ("ssm_norm.weight", "linear_attn.norm.weight"),
+    ("ssm_out.weight", "linear_attn.out_proj.weight"),
+    ("ssm_alpha.weight", "linear_attn.in_proj_a.weight"),
+    ("ssm_beta.weight", "linear_attn.in_proj_b.weight"),
+    ("attn_qkv.weight", "linear_attn.in_proj_qkv.weight"),
+    ("attn_gate.weight", "linear_attn.in_proj_z.weight"),
+)
+
+def _qwen35_linear_attention_layers(text_config: PretrainedConfig) -> list[int]:
+    n_layers = text_config.num_hidden_layers
+    layer_types = getattr(text_config, "layer_types", None)
+    if isinstance(layer_types, (list, tuple)) and len(layer_types) == n_layers:
+        return [idx for idx, kind in enumerate(layer_types) if kind != "full_attention"]
+    return list(range(n_layers))
+
+def _seed_qwen35_linear_attention_names(
+    name_map: dict[str, str], text_config: PretrainedConfig
+) -> None:
+    for idx in _qwen35_linear_attention_layers(text_config):
+        for gguf_suffix, hf_suffix in _QWEN35_LINEAR_ATTN_NAMES:
+            name_map[f"blk.{idx}.{gguf_suffix}"] = f"model.layers.{idx}.{hf_suffix}"
@@ def build_name_map
-    def build_name_map(self, model_config: ModelConfig) -> dict[str, str]:
+    def build_name_map(
+        self, model_config: ModelConfig, model_path: str | None = None
+    ) -> dict[str, str]:
@@ is_multimodal
-        is_multimodal = (
-            hasattr(config, "vision_config") and config.vision_config is not None
-        )
+        has_mmproj = (
+            model_path is not None and detect_gguf_multimodal(model_path) is not None
+        )
+        is_multimodal = (
+            hasattr(config, "vision_config")
+            and config.vision_config is not None
+            and (model_path is None or has_mmproj)
+        )
@@ model_type mapping
         if model_type == "qwen3_5":
             model_type = "qwen35"
+        if model_type == "qwen35":
+            _seed_qwen35_linear_attention_names(gguf_to_hf_name_map, text_config)
@@ prepare_loading
-        gguf_to_hf_name_map = self.build_name_map(model_config)
+        gguf_to_hf_name_map = self.build_name_map(model_config, model_path)
```

The authoritative unified diff is regenerated at any time with
`diff -u default.py.pre-phaseA-qwen35-linear-attn-20261023-095903 default.py` from the
plugin's `weights_adapter` directory; the backup stays byte-identical to the pre-edit
source.

**Backups (same directory):**

| File | sha256 |
|---|---|
| `default.py.pre-qwen35-fix-20261023` (pre-existing) | `1132520bdb55ca58414d431b080317c4fce95738d63afe9976ebba89f58b3144` |
| `default.py.pre-vision-depth-fix-20261023` (pre-existing) | `299a32a5cb67c8aca652adcd6c3ba57dbdc790fcd6142a56714eed863254f6e4` |
| `default.py.pre-phaseA-qwen35-linear-attn-20261023-095903` (new, `cmp` identical before edit) | `53b6613f5fb7561daf2900992194d5b26a4704a269d46af28e2c161f33514843` |
| `default.py` (after patch) | `764d3d3a64d4cbb5c1284ebaceaf054c2bc3e8ecda97466efee2fda79bea54dc` |

**CPU-only verification** (no GPU used, no weights loaded, no process started):

- `prepare_loading` completes: config patch, name map (899 entries), tie-embedding
  check, and weight-type map (353 unquantized modules).
- **851/851 expected HF parameters map, 0 unmapped**, including
  `linear_attn.dt_bias`, `in_proj_qkv`, `in_proj_z`, `A_log`, and every full-attention
  `self_attn.*` parameter.
- GGUF coverage: 866 tensors → 851 mapped; the 15 uncovered are exactly the
  `blk.64.*` MTP tensors, which `gguf_quant_weights_iterator_multi` skips by design.
- mmproj detection: `None` for the Qwen3.5 GGUF; the mmproj path for the HauhauCS
  Vision model, so multimodal behaviour is unchanged.
- Regression: `python3 -m py_compile` OK; LMM suite **201/201 pass** (no worktree
  change in this phase).

**Not verified:** weight loading, KV-cache fit, and inference still require the CASE
GPU; none was attempted. The patch is a local site-packages change, so re-apply it
(and keep the diff above) if the vLLM environment is rebuilt.

### vLLM Phase B — supervised GPU load test — FAILED (2026-10-23)

Test-only run on the CASE RTX 3090 (vLLM 0.32.0, `--max-model-len 8192
--max-num-seqs 1 --enforce-eager`, temporary port 8097). The protected RTX 3090 Ti
was never in `CUDA_VISIBLE_DEVICES` and stayed at 2 MiB with no processes before,
during, and after. Evidence: `evidence/vllm-phaseB-20261023/` (`SUMMARY.md`, full
engine log, GPU before/after snapshots, exact command).

**Result: FAIL at weight loading — a later stage than vLLM Phase A.**

- Reached: `Resolved architecture: Qwen3_5ForCausalLM`, `quantization=gguf`,
  plugin `GGUFModelLoader`/`GGUFConfigParser` registered, max model len 8192,
  `Loading model from scratch...`. The Phase A map is used by the real engine with
  no mapping error.
- Failed: `ValueError: There is no module or parameter named
  'embed_tokens.qweight_type' in Qwen3_5Model. The available parameters belonging
  to embed_tokens (VocabParallelEmbedding) are: {'embed_tokens.weight'}`.
- Cause: this GGUF stores `token_embd` as Q5_K and `output` as Q6_K, so the plugin's
  iterator emits `qweight`/`qweight_type`, but vLLM's `Qwen3_5Model` builds
  `VocabParallelEmbedding` **without `quant_config`** (`qwen3_5.py:253`), so the
  module accepts only `embed_tokens.weight`. The plugin's `GGUFEmbeddingMethod`
  exists but is never selected for this model. `output.weight` was not reached.
- Not reached: `/health`, `/v1/models`, inference (the server never became ready).
- VRAM: 330 MiB observed on the 3090 during engine init; released on failure.
- Cleanup: unit exited and was collected, no vLLM process remained, port 8097 free,
  both GPUs back to 2 MiB.
- Candidate repairs, none applied (detail in `SUMMARY.md`): plugin-side
  dequantization of the quantized embedding (≈+1.6 GB VRAM on a 24 GB card), or
  re-quantizing the GGUF with F16 embeddings/output (new artifact), or enabling the
  plugin's quantized-embedding path by passing `quant_config` in `qwen3_5.py`
  (edits vLLM core). A decision is required before any further edit.

### Core bundle — IMPLEMENTED, VERIFIED (offline)

Full implementation in `owner/local-model-manager/` — the standard owner
bundle shape used by Model Guide & Cost Router and PCOG Theme:
`index.js` (Host service, Typert remote `localModelManager`, six endpoints),
`client.js` (Web panel + sidebar entry), `core/*` (config, catalog, runtime,
gpus, actions, profiles, engine-adapter, model-advisor-adapter, discovery),
bilingual dictionaries, `cordis.patch.yml` (profile row + validated config),
icon, README.

Live evidence validated during Phase 1 (read-only, no services touched):
endpoint `http://127.0.0.1:8001` healthy, Qwen3.5 running, `/slots` reports
slot n_ctx **32768** while the provider config says **65536** — confirms the
pending 64K change is NOT active; the panel detects and explains this.

The launcher audit: every `start_model` invocation pins `CUDA_VISIBLE_DEVICES`
to the RTX 3090 (CASE) UUID, including `start-flash`'s multi-GPU-looking flags
(`--split-mode layer`, `-ngl auto`, `--fit`) — with a single pinned visible
device the protected Ti cannot be selected. The plugin pins the same UUID a
second time in its own spawn environment (defense in depth) and refuses to
launch any action at all if the CASE UUID is not configured.

**Simulated/pending activation only** (nothing pretends otherwise):

- The Start / Stop / Switch buttons are fully implemented against the
  allowlisted launcher with the plan → confirm two-step gate, single-use
  expiring tokens, fail-closed busy checks, and honest failure reporting —
  but they have never executed a real disruptive action (assignment
  boundary; all destructive paths were tested with mocks only).
- The panel is not visible yet: bundle staged + preserved, profile
  registration + client build + one Harness restart are pending (runbook:
  `ACTIVATION.md`). The recovery tool reports Needs Review until then.

### Phase 2A: GPU Selection and Reservation Safety — IMPLEMENTED (worktree, 2026-10-22)

Repairs all four GPU authorization enforcement layers and adds per-model GPU selection UI using the existing launch-profile architecture. Does not touch the trusted launcher, Start/Stop/Switch buttons, GPU lock controls, or any destructive runtime path.

**Problem addressed:** `planLaunch` refused the protected GPU unconditionally — the two-step release workflow (`planReleaseProtectedGpu` / `confirmReleaseProtectedGpu`) had no effect on launch authorization. `recommendations()` had hardcoded text that did not reflect `allowedGpuUuids`. No GPU selection UI existed. No Ti or dual-GPU launch profiles were configured.

**Changes:**

- `index.js` — `planLaunch` protected-GPU check is now conditional on `this.actions.getProtectedGpuReserved()`. Was: unconditional refusal on any UUID matching `protectedGpuUuid`. Now: fires only while the reservation is active. The `allowedGpuUuids` outer boundary (`allowedSet.has(uuid)`) is unchanged — still enforced even after release. Error message updated to say "which is currently reserved; release the reservation in My Graphics Cards before targeting this GPU."
- `core/profiles.js` — `recommendations()` text conditioned on `config.allowedGpuUuids`. When `protectedGpuUuid` is in `allowedGpuUuids`: directs owner to "the GPU Selection section." When not: says "not configured as a launch target." Safe fallbacks for minimal test configs.
- `cordis.patch.yml` — Added `allowedGpuUuids: [CASE_UUID, PROT_UUID]` and 15 `launchProfiles` entries (CASE + Ti + Both for each of 5 managed models: qwen27, qwen35, vision, coder, flash). CASE profiles: `[caseGpuUuid]`, `gpuMode: single`. Ti profiles: `[protectedGpuUuid]`, `gpuMode: single`. Both-GPU profiles: `[caseGpuUuid, protectedGpuUuid]`, `gpuMode: both`. Ti and Both include `notes` about the Ti reservation requirement. Flash profiles use `engineVersion: flash-next`.
- `client.js` — Added 3 locale keys each in `en`/`zh` (`gpuSelectionTitle`, `gpuSelectionHint`, `gpuSelectionReserved`). `ModelCard`: added `gpuProfiles`, `onLaunch`, `protectedGpuUuid`, `protectedGpuReserved` props. GPU selection section renders between operating profiles and action buttons. Each button is disabled when the profile includes `protectedGpuUuid` AND `protectedGpuReserved === true`. `protectedGpuUuid` is derived dynamically from `snap.gpus` (no hardcoded UUIDs). `protectedGpuReserved` = `snap.protectedGpuReserved === true`.

**Complete launch-path trace (Finding 1 — verified correct):**
- Profile-based path: `confirmLaunch` → `buildLlamaCppLaunch(profile, model, process.env)` sets `CUDA_VISIBLE_DEVICES = profile.gpuUuids.join(',')` → `runLauncherRaw(config, argv, env)` passes env as-is (no injection). The selected GPU UUIDs reach the process.
- Legacy path: `confirmAction` → `runLauncher(config, action, model)` hardcodes `CUDA_VISIBLE_DEVICES: config.caseGpuUuid`. Only Start/Switch/Stop use this path.
- `runLauncher` does NOT affect profile-based launches. `runLauncherRaw` does NOT override env.

**New tests (16 total):**
- `tests/launch-profile-plan.test.js` — 8 tests: refuses Ti while reserved; allows Ti after release; refuses both-GPU while reserved; allows both-GPU after release (CUDA_VISIBLE_DEVICES = both UUIDs); failed Ti launch doesn't release reservation; Ti UUID not in allowedGpuUuids still refused after release; Ti-only confirmLaunch sets CUDA_VISIBLE_DEVICES to protected UUID only; legacy confirmAction pins CUDA_VISIBLE_DEVICES to CASE UUID.
- `tests/profiles.test.js` — 1 test: recommendations text reflects `allowedGpuUuids` (both cases).
- `tests/client-render.test.js` — 7 tests: GPU selection absent; Ti button disabled while reserved; Ti button enabled after release; button click triggers `planLaunch`; RTX 3090 profile shows "Verified"; Ti profile shows "Unverified — supervised launch required"; Both-GPU profile shows "Unverified — supervised launch required".

**Qualification representation (Phase 2A label correction):**
- Carried entirely in the `notes` field of each `launchProfile` in `cordis.patch.yml`. No new data model, no new locale keys, no new service logic.
- CASE profiles: `notes: "Verified — uses the production RTX 3090 launch path."`
- Ti profiles: `notes: "Unverified — supervised launch required. Reservation must be released in My Graphics Cards first."`
- Both-GPU profiles: `notes: "Unverified — supervised launch required. Uses RTX 3090 + RTX 3090 Ti. Reservation must be released first."`
- Client renders `profile.notes` as small secondary text below each button row in the GPU selection section.
- `gpuSelectionHint` updated (en + zh): removed false "using a verified profile" claim → now "Launch on a specific GPU. The server must be stopped first. See profile notes for qualification status."
- Launch authorization unchanged: `planLaunch` enforces reservation + `allowedGpuUuids` regardless of qualification text.

**Pre-change backup:** `local-model-manager-backup-20261022-225226-phase2a-pre/` (index.js SHA `432fa493…`). Created and verified before any Phase 2A changes.

**Status:** Canonical sync complete (2026-10-23). 201/201 tests pass. Harness restart pending (requires owner approval, GD Bible must not be running). Ti-only and both-GPU model launches not yet live-qualified — require supervised qualification runs after Harness restart. Browser verification pending.

### Phase B: Persistent Add Directory — IMPLEMENTED, VERIFIED (2026-10-22)

Adds a user-controlled list of GGUF discovery directories that persists across
restarts in a JSON settings file, without touching model registration, provider
config, launcher, or GPU policy.

- `core/user-dirs.js` (NEW) — `readUserDirs` / `writeUserDirs` / `MAX_USER_DIRS=20`;
  atomic write via `.tmp`+rename; schema `{ version: 1, dirs: string[] }`.
  ENOENT → `{ dirs: [] }`. All invalid entries silently dropped at read time.
- `core/config.js` — `userDiscoveryDirsPath` optional field (default `''`;
  must be absolute if set). Loud throw at load on bad value.
- `index.js` — `addDiscoveryDir(dirPath)` added to REMOTE_METHODS (now 11).
  Refuses: feature disabled, non-absolute, not found, not a dir, duplicate
  (static or user), capacity exceeded (MAX_USER_DIRS). `snapshot()` merges
  static + user dirs with `Set` dedup; includes `snap.userDiscoveryDirs` only
  when `userDiscoveryDirsPath` is configured.
- `client.js` — `AddDirectorySection` component: user-added dirs list (or
  empty-state), read-error banner, input + Add button, success/error feedback,
  auto-refresh on success. Shown when `snap.userDiscoveryDirs !== undefined`.
- `cordis.patch.yml` — `userDiscoveryDirsPath:
  /home/liongateos/.local/share/liongateos/deepseek-update/user-discovery-dirs.json`
- `tests/user-dirs.test.js` (NEW) — 11 tests covering all read/write paths.
- `tests/config.test.js`, `tests/service.test.js`, `tests/load-client.js`,
  `tests/client-mount.test.js`, `tests/client-render.test.js` — all updated.

Safety boundary (unchanged): discovery only; no model registration, no
provider/launcher/GPU changes.

Canonical bundle synced 2026-10-22. SHASUMS-v1.sha256 now has 36 entries
(added `core/user-dirs.js`, `tests/user-dirs.test.js`, updated 10 changed
files). Manifest entry 5 sha256 `834511f33f12cf60998522ab5e3a3cceff188849d78ae454e86a6793d5687c60`.

**DEPLOYED 2026-10-22 18:42:01 EDT.** Harness restarted (PID 3116881). Phase B code
confirmed loaded via node_modules symlink — `index.js` sha256 `432fa493…`, `core/user-dirs.js`
present, `addDiscoveryDir` in REMOTE_METHODS, `userDiscoveryDirsPath` in `cordis.patch.yml`,
14 Phase B tokens present in `client.js`. `user-discovery-dirs.json` does not exist yet —
the panel will start with an empty user-added list and create the file on the first `addDiscoveryDir`
call. UI browser confirmation pending (Add Directory section, existing Start/Stop/GPU/Discovery sections).

### Phase A: GGUF Discovery — IMPLEMENTED, VERIFIED (2026-10-22)

Added bounded GGUF filesystem discovery to the snapshot flow:

- `core/discovery.js` — two-level scanner (root + immediate subdirs only),
  multi-shard grouping, exclusion of managed paths and mmproj companions,
  atomic cache write, 200-candidates-per-root cap. Never registers providers,
  modifies guidance, authorizes launches, changes GPU policy, or starts models.
- `core/config.js` — `discoveryDirs` (list of absolute paths) and
  `discoveryResultsPath` (absolute path for the shared cache JSON) added to
  `validateConfig`. Both default to empty/absent.
- `index.js` — `snapshot()` calls `buildDiscoveryResult()`, writes the cache
  fire-and-forget, includes `snap.discovery` only when dirs are configured.
- `client.js` — Discovery section in the panel UI with candidate cards,
  empty-state message, and scan-error indicator.
- `cordis.patch.yml` — `discoveryDirs: [/home/liongateos/models/gguf]` and
  `discoveryResultsPath: ~/.local/share/liongateos/deepseek-update/gguf-discovery-cache.json`.

Live scan result (2026-10-22, read-only pre-activation): Qwen3.6-35B-A3B-abliterated-v4-Q4_K_M
found under `/home/liongateos/models/gguf/Qwen3.6-35B-A3B-abliterated-v4/`.
Managed models (Qwen3.5 and Flash shards) correctly excluded.

**LIVE VERIFIED (2026-10-22, post-activation):** After Harness restart at
14:12:56 EDT, the LMM snapshot ran and wrote the cache at 14:13 UTC:
`/home/liongateos/.local/share/liongateos/deepseek-update/gguf-discovery-cache.json`
Cache contains version 1, root `/home/liongateos/models/gguf`, 1 candidate:
Qwen3.6-35B-A3B-abliterated-v4-Q4_K_M (21.2 GB, single file). Cache is now
shared with Model Guide & Cost Router (see that bundle's HANDOFF.md).

**Canonical bundle synced** to `~/.local/share/liongateos/deepseek-update/
customizations/local-model-manager/` with 33 SHASUMS entries. Manifest entry
sha256 `0f704cda23374cd73d170c55a802e8b32c89c825da7acad9ee8fcbe06d0ff1f7`.

### Interface repairs — HISTORICAL

- **Double-wrapped Typert response**: fixed; 11/11 render tests passing.
- **Scroll defect**: fixed by restoring the panel's own scroll container
  (`overflow: auto; height: 100%`). Canonical bundle checksums and manifest
  updated at the time.

**Unsupported / needs separate approval:**

- Multiple Jobs: the panel now reads the launcher's `parallel-mode` file
  (`dirname(launcherPath)/parallel-mode`). The current deployment has mode
  4 (PARALLEL, 4 slots); `actionsAvailable.multipleJobs` reflects this
  evidence. Single-slot mode and unreadable state both keep it disabled
  with an honest reason (fail-closed). The launcher uses `-kvu` for
  parallel mode: slots share the unified KV cache, not a fixed per-slot
  division of the context.
- vLLM: the working engine is **0.32.0** at `/home/liongateos/vllm-0.32-env`; the
  system `~/.local/bin/vllm` is the older 0.19.0 and is not the target. The 2026-10-22
  tokenizer blocker is resolved (tokenizer directory staged at
  `…/deepseek-harness-local-models/tokenizers/qwen3.5-27b`), and the 2026-10-23
  vLLM Phase A repair fixed the GGUF name map (see the vLLM Phase A section above), and
  the vLLM Phase B supervised GPU run was attempted on 2026-10-23: it reaches weight
  loading but fails on the quantized token embedding (see the vLLM Phase B section).
  The panel keeps **Not configured — requires setup**; LMM integration must not start
  until a serving run succeeds.

## Tests

`cd owner/local-model-manager && node --test tests/*.test.js`

Current result (2026-10-25, Job 7 multi-instance integration): **289/289 passing, 0 failures.**

Job 7 test additions (2026-10-25):
- `tests/multi-instance.test.js` (NEW, 25 tests): config validation (5); `runLauncherForInstance` env injection (4); `createActions` with `instanceConfig` (2); snapshot `servers` array (6); planAction/confirmAction routing (5); cross-instance isolation (3). All CPU-only (no GPU, no systemd, no real file access).

Phase 2A test additions (2026-10-22):
- `tests/launch-profile-plan.test.js`: 8 new tests — Ti refused while reserved; Ti allowed after release; both-GPU refused while reserved; both-GPU allowed after release (CUDA_VISIBLE_DEVICES = both UUIDs); failed Ti launch does not release reservation; allowedGpuUuids outer boundary enforced after release; Ti-only profile sets CUDA_VISIBLE_DEVICES to protected UUID only (process env proof); legacy confirmAction pins CUDA_VISIBLE_DEVICES to CASE UUID (process env proof).
- `tests/profiles.test.js`: 1 new test — `recommendations GPU text reflects allowedGpuUuids configuration` (two sub-cases: Ti not in allowed → no "GPU Selection"; Ti in allowed → "GPU Selection" mentioned).
- `tests/client-render.test.js`: 4 new tests — GPU selection section absent; Ti button disabled while reserved; Ti button enabled after release; button click triggers planLaunch dialog.

All previous failures resolved:
- Test 105 `canonical bundle directory matches worktree` — resolved by canonical sync.
- Test 106 `profile registration` — resolved by correcting the test assertion (see below).

Test changes in prior sessions:
- `tests/profiles.test.js`: updated the "unknown context" assertion to check for
  `not readable` and `doesNotMatch /below the/`; added explicit test for the
  known-but-below-minimum case (checks `32,768`, `below the`, `65,536`).
- `tests/manifest-recovery.test.js`: replaced incorrect `cordis.yml` assertion with
  correct `cordis.patch.yml` assertion.

4 regression tests added in prior session (tests 153–156), all continue to pass:
- `parseComputeAppLine parses the gpu_uuid column value as the first CSV column`
- `queryGpus uses gpu_uuid and not uuid in the compute-apps query args`
- `readProviderFacts handles reasoningEfforts dicts with mixed bool/str YAML keys`
- `readProviderFacts returns local GGUF model facts correctly when cloud models have mixed-key reasoningEfforts`

9 GPU lock tests (tests 145–152) all continue to pass.

All disk/network/spawn/GPU access is stubbed; no inference, no GPU work, and
no destructive runtime action is ever executed by the tests. The two catalog
regression tests use real python3 via temporary YAML files in `tmpdir()`.

### Profile registration test — correction record

The original assertion checked `/home/liongateos/.dsh/profiles/web/cordis.yml`
for `name: '@local/local-model-manager'`. That file is permanently empty (`[]`)
because the profile uses **patch-based composition**: all plugin rows live in
each bundle's own `cordis.patch.yml` and are merged at Harness load time. The
`cordis.yml` comment explicitly states this: "Edit cordis.patch.yml, not this file."

The corrected assertion reads the bundle's own `cordis.patch.yml` through the
profile's `node_modules/@local/local-model-manager` symlink and checks that it
declares `name: '@local/local-model-manager'`. This is the actual registration
mechanism that makes the plugin load in the running Harness.

## Preservation

- Worktree: `owner/local-model-manager/` on branch `voice-dictation-test`.
  Changes are untracked/unstaged (not committed — push is out of scope without
  owner authorization). Last commit on branch: `538e93c`.
- Canonical copy + checksums:
  `~/.local/share/liongateos/deepseek-update/customizations/local-model-manager/SHASUMS-v1.sha256`
  (45 entries; sha256 `ab94128b5ffeb1b9f811f1728249c7a7dcff4b8a7048c8b7634c542251afefd1`
  in `CUSTOMIZATIONS-MANIFEST.txt` entry 5 "Local Model Manager").
  Updated 2026-10-25 Job 7 canonical sync: index.js, client.js, cordis.patch.yml,
  core/config.js, core/actions.js, tests/multi-instance.test.js added; 289/289 tests pass.
- Backups (most recent first):
  - `customizations/local-model-manager-backup-20261023-122254-launch-reservation-policy/` — pre-Phase 2D
  - `customizations/local-model-manager-backup-20261023-000023-phase2a-pre-sync/` — pre-Phase 2A canonical sync
    sha256 `834511f33f12cf60998522ab5e3a3cceff188849d78ae454e86a6793d5687c60`
  - `customizations/local-model-manager-backup-20261022-171652/` — pre-final-repair
    sha256 `7891239d48e81e536eb9993017af43f9c6def7c539a31907ad4eb9dbd3c99453`
  - `customizations/local-model-manager-backup-20261022-165147/` — pre-gpu-monitoring-repair
    sha256 `7a55fbb49031ff415b1d78de6350009bc95989df5164cf0de1b184f00190f6cb`
- After any Harness update: recovery tool dry-run → `--apply` → re-register
  via plugin manager (profile rows are never hand-edited).

## New regressions identified and REPAIRED 2026-10-22 — canonical bundle sync + Harness restart pending

Two live-panel regressions identified by read-only investigation and REPAIRED
2026-10-22. Canonical bundle sync and Harness restart are still pending.

### Regression 1 — GPU monitoring always unavailable

**Symptom:** Panel reports GPU monitoring unavailable; any GPU row shows the
error `Command failed: nvidia-smi --query-compute-apps=uuid,...`.

**Root cause:** `core/gpus.js` line 81 uses `uuid` as a field name in the
`--query-compute-apps` query. That field does not exist for this sub-command;
the correct name is `gpu_uuid`. nvidia-smi exits with code 2 and prints
`Field "uuid" is not a valid field to query.` Because both `--query-gpu` and
`--query-compute-apps` run in `Promise.all`, the failure of the second call
causes `queryGpus` to return `{ status: 'unavailable' }`, discarding the valid
GPU hardware info that the first call returned successfully.

**Confirmed live:** `nvidia-smi --query-compute-apps=uuid,...` exits 2.
`nvidia-smi --query-compute-apps=gpu_uuid,...` exits 0 and returns current
processes (PID 2325979 on both GPUs, llama-server, CASE GPU 15,824 MiB,
protected Ti 15,506 MiB).

**Repair applied (2026-10-22):** One token change in `core/gpus.js:81`:
`--query-compute-apps=uuid,...` → `--query-compute-apps=gpu_uuid,...`
No parser change needed: `parseComputeAppLine` reads by column position;
the UUID value at column 0 is the same regardless of field name.

**Tests added:** `parseComputeAppLine parses the gpu_uuid column value as the first CSV column`
and `queryGpus uses gpu_uuid and not uuid in the compute-apps query args` (tests 153–154).

### Regression 2 — All models show "Context configured: not readable from configuration"

**Symptom:** All 5 managed models show "Context configured: not readable from
configuration" and "Reasoning options: not readable from configuration" in the
panel.

**Root cause:** The Python helper in `core/catalog.js` (`PYTHON_HELPER` string)
calls `sorted(efforts.keys())` on the `reasoningEfforts` dict of each model in
the provider config. The `providerPatchPath` (`/home/liongateos/.dsh/profiles/web/cordis.patch.yml`)
contains not just local GGUF models but also cloud models with a YAML pattern:

```yaml
reasoningEfforts:
  false: none
  low: low
  high: high
  max: max
```

Python's `yaml.safe_load` parses the bare `false` key as Python `False` (bool),
producing a dict with mixed key types: `{False: 'none', 'low': 'low', ...}`.
Python 3 cannot compare booleans and strings with `<`, so `sorted(efforts.keys())`
raises `TypeError: '<' not supported between instances of 'str' and 'bool'`.
The helper exits with code 1. `readProviderFacts` returns
`{ status: 'unavailable', error: 'provider-facts helper exited 1' }`.
This fails for ALL models because the crash happens mid-iteration, before any
local model facts are serialized.

**Confirmed live:** Running the exact Python helper against
`/home/liongateos/.dsh/profiles/web/cordis.patch.yml` reproduces the crash.
Cloud models `deepseek-v4.1-flash`, `glm-5.2`, `nemotron-3-ultra`, `kimi-k3`,
and others each have a `{False: 'none', ...}` mixed-type dict. Local GGUF
models (5 managed models) have clean string-only dicts and would succeed in
isolation.

**Repair applied (2026-10-22):** One-line change inside `PYTHON_HELPER` in `core/catalog.js`:

```python
# Before:
facts["reasoningEfforts"] = sorted(efforts.keys())
# After:
facts["reasoningEfforts"] = sorted(k for k in efforts.keys() if isinstance(k, str))
```

Filters the `False` key (a YAML `false:` key used by cloud models to represent
"disabled reasoning") before sorting, returning only the string effort level
names. No other changes.

**Tests added:** `readProviderFacts handles reasoningEfforts dicts with mixed bool/str YAML keys`
and `readProviderFacts returns local GGUF model facts correctly when cloud models have mixed-key reasoningEfforts`
(tests 155–156). Both use real python3 via temporary YAML files in `tmpdir()`.

### Additional context for both repairs

- `settingsPath` (`/home/liongateos/.dsh/settings.yaml`) does not exist on disk
  (the Harness may have migrated to a different location). The Python helper
  silently skips missing files, so this is NOT a bug — the helper finds the
  `llm-pi-ai` entry in `providerPatchPath` before reaching `settingsPath`.
  If `settingsPath` is no longer valid, it can be removed from the config
  or updated to the actual path, but it is not blocking.

- GPU 0 (CASE RTX 3090) is currently in `Exclusive_Process` compute mode.
  This is expected — PID 2325979 (GD Bible llama-server) is running on it.
  This is NOT a bug.

- The live provider config lookup for local GGUF models is structurally correct:
  model IDs in the provider config ARE the gguf file paths, matching
  `model.ggufPath` in `cordis.patch.yml`. The lookup would succeed once the
  sorted() crash is fixed.

### Phase B: Persistent Add Directory — APPROVED, IMPLEMENTING (2026-10-22)

Owner approved implementing user-added GGUF discovery directories via a
separate JSON settings file. Design: a new `userDiscoveryDirsPath` config
field points to a versioned JSON file (outside `cordis.patch.yml`). The
service reads this file on every snapshot, merges the user-added dirs with
the static `discoveryDirs`, deduplicates, and passes the combined list to
the existing scanner. A new `addDiscoveryDir` endpoint validates the path
(must exist, must be a directory), checks for duplicates, enforces a 20-dir
cap, and writes atomically. The snapshot includes a `userDiscoveryDirs`
field so the client can show configured user dirs. The client adds an "Add
Directory" form and a scan locations list to the discovery section.

Files changed: `core/user-dirs.js` (new), `core/config.js`, `cordis.patch.yml`,
`index.js`, `client.js`, `package.json`, `tests/user-dirs.test.js` (new),
`tests/config.test.js`, `tests/service.test.js`, `tests/client-mount.test.js`,
`tests/load-client.js`, `tests/client-render.test.js`.

Pre-implementation backup: `customizations/local-model-manager-backup-20261022-180141/`
(SHASUMS sha256 `e5d9d9f22ff99baa9e6edb4d1545d1c4ca6b45a29fc769ea54421095e4e11a4f`).

Settings file path: `/home/liongateos/.local/share/liongateos/deepseek-update/user-discovery-dirs.json`

Safety boundary: discovery only. No model registration, no provider changes,
no launcher changes, no GPU policy changes. `addDiscoveryDir` validates path
existence before accepting; missing/inaccessible dirs during scanning are
handled gracefully by the existing `scanRootDir` ENOENT path.

## Known next work items (each needs owner approval where marked)

1. **Phase 2A canonical sync** — copies Phase 2A changes (index.js, core/profiles.js, cordis.patch.yml, client.js, 3 test files) to the canonical bundle and updates SHASUMS. Separate step from Harness restart.
2. **Harness restart** — deploys all repairs and Phase 2A to the live panel (needs explicit owner approval; do not restart while GD Bible is active). After restart, browser-verify GPU monitoring rows, model context/reasoning display, GPU lock buttons, discovery section, and GPU selection buttons on model cards.
2. **Add Model** — adding a new local GGUF to the managed catalog (needs approval;
   touches `cordis.patch.yml` config; requires a separate safe change).
3. **Interactive Add Directory** — directory picker for additional GGUF roots
   (PLANNED, separate approval required; beyond the current `discoveryDirs` config
   mechanism).
4. **vLLM embedding blocker decision** — the supervised run (2026-10-23) failed at
   weight loading on the quantized `token_embd` (`embed_tokens.qweight_type`). Choose
   one repair from the vLLM Phase B section (plugin dequantization, F16 re-quant, or
   `quant_config` in `qwen3_5.py`) before any further GPU run. Never run while the GD
   Bible workload shares the machine's GPUs.
5. **Launcher upgrade for Multiple Jobs** (needs approval; touches the trusted
   launcher script — its multi-GPU flags stay pinned to the CASE UUID).
6. **Model Guide Web UI — local files display** — surface `localFiles` from
   snapshot in the MG panel (separate scope, separate approval).

## Deferred (not in scope without further approval)

- Broader automatic discovery of local models in Model Guide & Cost Router.
- Cloud-model discovery and availability through Ollama.com.
- Supervised vLLM compatibility and serving verification.