# @local/local-model-manager

Local Model Manager — an owner customization bundle for the DeepSeek Harness
Web profile. One panel that shows the installed local models, the two GPUs,
and the live server state in plain language, and performs **start / stop /
switch only through the trusted `dsh-model-server` launcher** behind a
plan-then-confirm owner gate.

## What it shows (all verified, never guessed)

- **My Local Models** — installed/missing state with the on-disk file size of
  each GGUF; running/stopped/problem state from the live endpoint probe;
  serving engine; **configured context** (from the active provider
  configuration, labeled as such) beside the **live context** the running
  server actually reports; reasoning options read from the provider
  configuration (labeled "not readable" when absent); GPU assignment; per-card
  file size. The Qwen3.5 64K pending-restart state is detected and explained
  (configured 65536 vs runtime-reported smaller value).
- **My Graphics Cards** — read-only `nvidia-smi` queries plus the generic
  compute-mode Lock/Unlock controls and the manual launch-reserve/release
  flow. No GPU is reserved automatically: the RTX 3090 Ti is the preferred
  launch target, the RTX 3090 second, and Both-GPU profiles third. A manual
  reservation renders its **Reserved (manual lock)** badge until the owner
  releases it; absence of state is the normal, unreserved state. Unused
  memory is never treated as permission. Each card also shows its live
  **Power draw** (`power.draw.instant`, falling back to the `power.draw`
  average) against `power.limit`; a driver that does not report wattage leaves
  the row saying **Not reported by this driver** while every other fact stays
  visible.
- **Electricity** — measured GPU energy and its cost, built on the same
  `nvidia-smi` power reading the cards already show. A lifecycle-owned sampler
  (started and stopped through `ctx.effect`, one sample a second, no disk
  writes) keeps timestamped records in a bounded in-memory ring (7200 records,
  about two hours). Each record keeps the instant, the per-card wattage and
  limit, the utilization, and the compute-apps PID evidence, so the real GPU
  worker is attributed — never the port listener, which for Strata is a proxy.
  The panel shows the live draw, the applicable Ontario TOU period and rate,
  the cost per hour at the current draw, and for the most recent job the
  measured energy, its cost, the observed runtime, coverage, sample count, the
  GPU PIDs, and every rate change the job crossed. A span that crosses a tariff
  boundary is split at the exact boundary instant in `America/Toronto`, with
  DST handled explicitly; the verified rates effective **2026-11-01** are
  9.1 / 14.6 / 18.9 ¢/kWh (off/mid/on, energy component including Global
  Adjustment, excluding delivery, regulatory charges, and tax).
  Measurement class is always stated: this is **board power for the card**, not
  wall power, so CPU, drives, cooling, and PSU losses are outside the figure
  and the real electricity cost is higher. A card shared with another process,
  or a window the sampler did not observe, is labelled approximate or partial;
  missing coverage is never extrapolated, and no idle baseline is charged to a
  job. Sampling is on by default here but off unless enabled in config, and
  turning it off restores the display-only behaviour exactly.
  The same ring and the same integration path are also reachable as the
  `energyWindow` Remote method, which prices a caller-supplied list of
  windows over the retained records. That is how the Active Sessions sidebar
  prices each Session's turns without a second sampler: it never samples, it
  reads this ring, and it inherits every measurement caveat stated above.
- **Simple Operating Modes** — Reliable (available; the tested launcher
  settings), Multiple Jobs (available when the launcher's `parallel-mode`
  file reports two or more slots; disabled when set to single-slot or when
  the file cannot be read — fail-closed in both cases), Long Research
  (available only when the configured context reaches 65536 tokens, with a
  pending-restart note when the live context is behind), Advanced (the real
  launcher facts, read-only).
- **Serving engines** — llama.cpp verified; vLLM labeled **Not configured —
  requires setup** with the evidence actually found (installed binary vs
  nothing verified for these GGUF models).
- **Recent operational errors** — a bounded in-memory ring of the plan and
  execution outcomes of this session.

## Automatic context selection

For every managed model the panel resolves four distinct values and shows all
of them:

1. **Advertised context** — the model's trained window (GGUF / provider
   configuration), read best-effort from the GGUF header when present.
2. **Configured context** — the `contextWindow` the provider configuration
   declares; the automatic selection never raises above it, because a larger
   window is unproven without a supervised runtime run on the actual hardware.
3. **Hardware cap** — an optional `hardwareContextCaps` entry per model when
   supervised evidence shows a smaller practical limit.
4. **Selected context** — `manual override`, or automatically the **minimum**
   of the bounds above (`source` chip says `auto` / `manual` /
   `unavailable`). The panel additionally shows **DSH usable** =
   selected − `reservedOutputTokens` − `headroomTokens` (a session budget,
   not a server limit).

Selections persist atomically to `contextSelectionsPath` so a restart keeps
the same value; a persisted `manual` override is never replaced by an
automatic decision. At every confirmed start the selected context is applied
as a trailing `-c <n>` pin to the launcher argv (profiles with their own
`-c`/`--ctx-size` are refused at plan time instead of producing an ambiguous
request) and, after the server comes up, the live `meta.n_ctx` is compared to
the pin — a mismatch is recorded loudly in the error ring, never hidden.
Models already running keep their old window until stopped and started again.

## How control works

Every operational action is a two-step flow against allowlisted launcher
invocations (`stop`, `start-<model>`, `switch <model>`; fixed argv, no shell):

1. **Plan** — validates the action and target against the catalog, checks the
   launcher exists and is executable, and probes the server. Refusals carry a
   plain-language reason: unknown model, server already stopped, another
   model running, launcher missing, or — **fail closed** — when `/slots`
   cannot be read, stop/switch are refused because the system cannot verify
   whether work is running. An active job (`is_processing` on any slot)
   marks the plan `requiresAcknowledge` and lists the jobs. The plan issues a
   single-use, expiring confirm token.
2. **Confirm** — re-probes immediately before execution and refuses when the
   state changed (new job appeared without the owner's explicit
   acknowledgment, token expired/used). The launcher runs with a bounded
   timeout and its real output is reported: success is never assumed, a
   failed start names the exit code in plain words, and the previous model
   can be started again from its card (no silent auto-restart).

`runLauncher` spawns with no shell and pins `CUDA_VISIBLE_DEVICES` to the
preferred launch GPU (the RTX 3090 Ti by default) — defense in depth on top
of the launcher's own pin; a profile launch pins its own `gpuUuids` instead,
and a manual reservation on a profile's GPU refuses the launch at plan time
until the owner releases it. GPU reservations persist to
`gpuLaunchStatePath`: absence of the file or of an entry means unreserved,
and nothing re-applies or removes a reservation automatically. The plugin
never restarts DeepSeek Harness, never touches any GPU, and talks only to the
loopback endpoint (validated at config load; external exposure is impossible
by construction).

## Configuration (cordis.patch.yml)

| Field | Meaning |
|---|---|
| `endpointBase` | Loopback-only endpoint URL (enforced: 127.0.0.1). |
| `launcherPath` | Trusted launcher script (the only execution path). |
| `providerPatchPath` / `settingsPath` | Provider configuration files the per-model facts (context, reasoning) are read from via a read-only python3 helper. |
| `caseGpuUuid` / `caseGpuName` | The second-choice launch GPU (RTX 3090); profile launch targets come from `launchProfiles`. |
| `protectedGpuUuid` / `protectedGpuName` | The preferred launch GPU (key keeps its historical name — the RTX 3090 Ti); also the default spawn pin. |
| `preferredLaunchGpuUuid` | Optional override for the plain start/switch spawn pin; defaults to `protectedGpuUuid`. |
| `gpuLaunchStatePath` | Optional absolute path for the durable manual launch-reservation file (atomic writes; absent or unreadable means nothing is reserved). |
| `allowedGpuUuids` | The outer allowlist boundary for profile launches, GPU locks, and reservation changes. |
| `vllmBinPath` | Presence check only — detection, never verification. |
| `probeTimeoutMs` / `actionTimeoutMs` / `confirmTtlMs` / `maxErrorRecords` | Bounded timeouts, token lifetime, error-ring size. |
| `powerSamplingEnabled` | Turns the energy sampler on (default `false`: wattage stays display-only). The timer is owned by the plugin's `ctx.effect`, so it stops with the plugin. |
| `powerRingCapacity` / `powerSampleIntervalMs` | Bounded in-memory retention (default 7200 records at 1000 ms, about two hours) and the sampling period. Nothing is written to disk. |
| `tariffGpuUuid` | The card whose board power is priced per job; defaults to `preferredLaunchGpuUuid`. |
| `models[]` | The catalog: key, friendly name, gguf path, launcher `switchName`, engine binary variant, `vision`+`mmprojPath`, `multiPart`. |
| `contextSelectionsPath` | Persistent file for automatic context selections and owner manual overrides (atomic writes; absent means selections are not persisted). |
| `reservedOutputTokens` / `headroomTokens` | Session budget subtraction for the DSH usable value; mirrors the compaction modelPolicies for the local route. |
| `hardwareContextCaps` | Optional per-model evidence-based context cap (model key → token count); keys must be managed models. |
| `localEndpoints[]` | Local model servers this manager watches but does not launch (e.g. the system-level Strata server on `:8080`): `{port, gpuUuid, gpuName}`. Observation only — the manager never starts, stops, or throttles these processes, and it holds no launcher record for them. The configured port→card mapping is what lets a caller that reached that loopback route prove which card serves it instead of matching on a model name; it is reported in `snapshot().observedEndpoints` only for ports that actually answered, and only alongside the model the endpoint says it has loaded. Ports must be unique and must not collide with a managed `instances` port, and each `gpuUuid` must be in `allowedGpuUuids`. |

Misconfiguration fails loudly at activation (`~standard` schema validate).

## Update-safety

Canonical assets live in
`~/.local/share/liongateos/deepseek-update/customizations/local-model-manager`
with a manifest entry; recovery is the external
`recover-customizations.mjs` (re-register through the Harness plugin manager
after a Harness update; profile rows are never hand-edited). See `HANDOFF.md` and `ACTIVATION.md` in this package for the staged activation and rollback steps.

## Tests

`node --test tests/*.test.js` from the package directory — config validation,
catalog/provider-facts bounded failure, runtime probing (running, stopped,
unhealthy, unreadable slots), GPU parse and degradation (including the
`power.draw.instant` reading, the `power.draw` fallback, and the explicit
unavailable wattage state), the full action
safety suite (allowlist, single-use tokens, expiry, fail-closed busy
detection, missing launcher permission, failed-start reporting, preferred-GPU
spawn pin), the generic manual reservation flow, the durable GPU state file,
profile context-per-slot math, snapshot merging, the client mount/render
regressions including the reservation badges, the GGUF header
parser, automatic context selection and persistence, the post-start
context verification, the tariff module (rates, winter/summer shape, weekends,
the weekend-holiday shift, DST in both directions, boundary splitting), the
energy module (trapezoidal integration, per-rate splitting, gap detection,
coverage honesty, attribution labels), the bounded sampler (ring eviction,
PID re-read every sample, timer release, the derived job window), and the
electricity block end to end from snapshot to rendered card — all with stubbed
disk, network, spawn, and GPU access;
no model responses, no GPU work, and no destructive runtime action is ever
executed by the tests. `bash tests/launcher-arg-forwarding.test.sh` (host) exercises the real
launcher's argv forwarding including the trailing context pin.