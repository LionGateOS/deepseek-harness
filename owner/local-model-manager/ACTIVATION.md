# Local Model Manager — Activation & Rollback (owner runbook)

This file is written for a non-programmer. Read it top to bottom; do only
what is listed. If any step fails, stop at that step and report the exact
command and its output.

## Electricity Phase 2 (2026-11-06): prepared, canonical synced, Harness restart pending

### What changed (offline; no Harness contact)

A new **Electricity** card appears under **My Graphics Cards**. It shows:

- **Current draw** — the live board wattage of the priced card, with its limit.
- **Rate now** — the Ontario time-of-use period and the rate that applies right
  now (for example `mid-peak · 14.6 ¢/kWh`).
- **At this draw** — what one hour at the current draw would cost.
- **Last measured job** — the energy measured while the card was working, the
  cost of that energy, how long it was observed, how much of that span was
  actually measured, how many samples backed it, the GPU process IDs that used
  the card, and every rate change the job crossed.

The rates are the verified Ontario numbers effective **2026-11-01**: 9.1 ¢/kWh
off-peak, 14.6 ¢/kWh mid-peak, 18.9 ¢/kWh on-peak. These are the energy
component (including the Global Adjustment); delivery, regulatory charges, and
tax are not included, so the real bill is higher. A job that crosses a rate
change is split at that exact moment, in Toronto local time with daylight
saving handled.

**What the number means.** This is the graphics card's own board power, measured
by its driver. It does not include the CPU, drives, cooling, or the power
supply's losses, so treat it as a lower bound on what the machine used.

**When the number is not exact, the card says so.** If another process also used
the card, it says the figure is approximate and shows both process IDs. If the
sampler was not running for part of the job, it says partial and reports the
measured coverage — the missing part is never guessed at or filled in. If the
driver does not report power at all, the card says so and shows no energy.

Nothing else changes: no new tab, no new service, no second GPU poller, no
history on disk, and the Local Model Manager still has no authority over Strata's
start, stop, or GPU configuration. WorkRunner is untouched.

### Deploying it

Nothing to install and no commands to type: the change is already in the bundle
the profile links to. **It appears after one DeepSeek Harness Web restart**, and
that restart is the owner's explicit approval.

### After the restart, check

- Under **My Graphics Cards** there is an **Electricity** card with a live
  **Current draw** that changes between refreshes.
- **Rate now** shows the period and rate matching the current Toronto time.
- While Strata is busy, **Last measured job** shows a running job with energy,
  cost, and a coverage near 100 %.
- When Strata is idle, the last finished job keeps its measured energy and cost.

### Turning it off

Set `powerSamplingEnabled: false` in the bundle's `cordis.patch.yml` and restart
once. The card still shows the live draw, the rate, and the hourly cost, and
says that energy sampling is off; per-job energy and cost stop being measured
and the in-memory ring is released.

### Undoing it

Restore the changed bundle files from their backups beside them
(`.before-energy-20261106T111429-0500`), then restart the service once. The
Electricity card disappears and every Phase 1 behaviour returns unchanged. The
same files can be restored from the checkpoint
`~/.local/share/liongateos/deepseek-update/checkpoints/local-model-manager-pre-energy-20261106T111429-0500.tgz`.

## GPU Wattage Phase 1 (2026-11-06): prepared, canonical synced, Harness restart pending

### What changed (offline; no Harness contact)

The **My Graphics Cards** cards now show a **Power draw** row:
`XXX.X W / XXX W limit`. Nothing else about the panel, the models, the
launches, the reservations, or the locks changes, and nothing is sampled in the
background — the reading comes from the same `nvidia-smi` call the card already
made, so the number updates whenever the panel refreshes.

- The card shows `power.draw.instant` (the live value, one decimal). If the
  driver does not offer that field, the `power.draw` average is used instead.
- `power.limit` is shown beside it.
- If the driver reports no wattage at all, the row says **Not reported by this
  driver** — it never invents a number, and the memory, utilization, identity,
  reservation, and process rows keep working exactly as before.
- If the whole GPU query fails, the card shows its existing error row and no
  power row at all.

This phase is **visibility only**. There is no tariff, cost, energy total,
history, sampler, or new panel/tab, and the Local Model Manager still has no
authority to start, stop, or reconfigure Strata.

### Deploying it

Nothing to install and no commands to type: the change is already in the bundle
the profile links to. **It appears after one DeepSeek Harness Web restart**, and
that restart is the owner's explicit approval (the same gate as every earlier
job). No model, GPU, service, reservation, or data state is touched by the
restart.

### After the restart, check

- Each card under **My Graphics Cards** shows a **Power draw** row.
- A card that is idle or busy shows a live value that changes between refreshes.
- A card whose driver does not expose wattage shows **Not reported by this
  driver** while its memory and utilization rows still show numbers.

### Undoing it

Restore the six bundle files from their backups beside them
(`.before-wattage-20261106T084620-0500`), then restart the service once. The
power row disappears; nothing else changes. The same files can be restored from
the checkpoint
`~/.local/share/liongateos/deepseek-update/checkpoints/local-model-manager-pre-wattage-20261106T084620-0500.tgz`.

## Multi-instance Job 9 (2026-10-25): per-instance routing, Stop buttons, candidateLauncherPath — canonical synced, Harness restart pending

### What was fixed (offline; no Harness contact)

1. **Per-instance context verification** — `confirmAction` now routes the
   post-start probe to the exact instance port that handled the token, not
   always port 8001 (endpointBase). A start on port 8002 probes port 8002.
2. **Per-instance Stop buttons** — the ModelCard in multi-instance mode now
   renders one "Stop on [GPU name]" button per port in `m.runningOnPorts`,
   each passing `instancePort` to `planAction`. The single generic Stop
   button is gone from the multi-instance branch.
3. **Stable `candidateLauncherPath`** — `cordis.patch.yml` now points to
   the stable installed path
   `~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate`
   instead of a worktree-absolute path that breaks if the worktree moves.

### Installing the candidate launcher (required before multi-instance Start/Stop works)

The candidate launcher file (`dsh-model-server-candidate`) must exist at the
stable installed path before the per-instance Start/Stop controls become
functional. Until it exists, any per-instance `planAction` will be refused
with "launcher file was not found" — this is the correct fail-safe.

**Backup step (before copying):**

```
cp ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate \
   ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate.before-install-$(date +%Y%m%d-%H%M%S) \
   2>/dev/null || echo "(no existing candidate to back up — first install)"
```

**Copy step:**

```
cp /home/liongateos/deepseek-harness/dsh-v0.2.1-alpha.1/owner/local-model-manager/candidate/dsh-model-server-multi-instance \
   ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate
chmod +x ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate
```

**Verification:**

```
ls -lh ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate
head -3 ~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server-candidate
```

Expected: file exists, size around 25–30 KB, first line is `#!/usr/bin/env bash`.

**Rollback (if needed):** Copy the backup back over the candidate path, or
delete it — `planAction` will refuse with "launcher file was not found",
leaving single-instance behavior via the main launcher unchanged.

### Owner-approval gate before first multi-instance start

The per-instance controls are gated: `planAction` refuses if either the
candidate launcher is absent or the ownership record for the instance is
missing/stale after a stop. A supervised first launch of each per-instance
profile is recommended before relying on it in production:

1. Restart the Harness after the canonical sync is in place.
2. Open Local Model Manager → the "Start on RTX 3090" / "Start on RTX 3090 Ti"
   buttons appear for each stopped instance.
3. Click the preferred Start button, review the plan card, confirm.
4. Watch for errors; confirm the model appears at the correct endpoint.
5. Stop cleanly; confirm the Stop-on button disappears.

---

## Phase 2D (2026-10-23): automatic RTX 3090 Ti reservation removed — canonical synced, Harness restart pending

Owner policy change shipped this phase: the automatic RTX 3090 Ti reservation
is permanently removed and the manual Reserve/Release flow is now generic.
Canonical statements (also in HANDOFF.md Phase 2D):

- OLD/HISTORICAL: RTX 3090 Ti automatically reserved for GD Bible.
- RETIRED: automatic GD/Ti reservation policy.
- ACTIVE: no GPU is automatically reserved by default.
- ACTIVE: RTX 3090 Ti is preferred, RTX 3090 second, Both third.
- ACTIVE: owner can manually Lock/Reserve and Unlock/Release GPUs through LMM.

**Pre-change backups (verified):**

- Canonical bundle: `~/.local/share/liongateos/deepseek-update/customizations/local-model-manager-backup-20261023-122254-launch-reservation-policy/`
- Trusted launcher: `~/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server.before-launch-reservation-policy-20261023-122254`

**What changed on disk this phase (canonical):** the full LMM bundle files
listed in its `SHASUMS-v1.sha256` (now including `core/gpu-launch-state.js`
and `tests/gpu-launch-state.test.js`), the trusted launcher fallback GPU, and
the update manifest entry. Nothing else. The next Harness restart deploys the
new code (the running Harness still executes the pre-change bundle); context
settings and launcher `-c` fallbacks are unchanged by this phase.

## Current state (ACTIVATED — Phase B live as of 2026-10-22 18:42 EDT)

The Local Model Manager is fully implemented, tested (185 passing offline
tests), and preserved in the canonical update-safe directory
`~/.local/share/liongateos/deepseek-update/customizations/local-model-manager`.

**The panel is live.** The Harness was restarted at 18:42:01 EDT 2026-10-22
(PID 3116881). Phase B (Persistent Add Directory) is deployed. UI browser
confirmation of the Add Directory section and all existing features is pending.

The activation steps below have already been completed. They are preserved
here as a re-activation reference after a future Harness update.

## Activation (shows the panel in DeepSeek)

The deepseek-harness-web service is the running app. A **restart of that
service** is required once, after the bundle is registered, for the new panel
to appear. Until you explicitly approve and run that restart, DeepSeek keeps
working exactly as it does now.

1. Register the bundle in the Web profile (the same three registrations the
   other owner bundles have; file-level, no service contact):
   - dependency link: add
     `"@local/local-model-manager": "link:/home/liongateos/.local/share/liongateos/deepseek-update/customizations/local-model-manager"`
     to `dependencies` in `/home/liongateos/.dsh/profiles/web/package.json`.
   - bundle list: add `"@local/local-model-manager"` to
     `dsh.profile.bundles` in the same file.
   - profile row: insert at the end of `/home/liongateos/.dsh/profiles/web/cordis.yml`:
     ```
     - id: local-model-manager
       name: '@local/local-model-manager'
     ```
     (The bundle's own `cordis.patch.yml` carries the config rows; the plugin
     manager merges them on install.)
2. Install/link and build the client bundle exactly the way the plugin
   manager does it (the preferred, safest path):
   open DeepSeek → the plugin manager UI → install/register
   `@local/local-model-manager` — this runs the same pnpm install + client
   build it ran for the Model Guide panel. If you prefer the terminal, the
   equivalent is a `pnpm install` + the harness build step inside
   `/home/liongateos/.dsh/profiles/web`, but the plugin manager route avoids
   hand-editing and is recommended.
3. Restart the DeepSeek Harness Web service once (your explicit approval is
   the trigger for this). After it comes back, **Local Model Manager**
   appears in the left sidebar (its own icon).

## Verification after activation

- The panel loads with the endpoint `http://127.0.0.1:8001` shown.
- "Qwen3.5 27B Q5_K_M" shows **Running now**, `Local endpoint … Running`,
  and a Long Research row that says the larger window applies after an
  owner-approved restart (the pending 64K change).
- "My Graphics Cards" shows RTX 3090 as usable and **RTX 3090 Ti —
  Protected / Reserved**.
- Clicking **Stop** on the running model shows the plan card listing any
  active job and requires the explicit acknowledgment checkbox before
  Confirm becomes available. Nothing runs on its own.

## Rollback (undo activation without losing anything)

- Set the plugin row `disabled: true` (or remove the three registrations and
  run the plugin-manager uninstall) and restart the service once.
- The panel disappears; no model, GPU, service, or data state changes. The
  bundle stays preserved in the canonical directory and can be re-activated
  by repeating the runbook.
- To restore the exact preserved files after a Harness update, run the
  recovery tool in dry-run and then `--apply`
  (`node ~/.local/share/liongateos/deepseek-update/recover-customizations.mjs`
  → `… --apply` after reviewing the plan); it re-registers the bundle the
  same way through the plugin manager.