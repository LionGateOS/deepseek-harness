# DeepSeek Harness — Project State

Last updated: 2026-11-18

This file is the project-wide current-state and next-action authority referenced
by the owner bundle handoffs. Component-specific handoffs remain authoritative
for their own detailed implementation histories.

## Current status

**RC.5 ACTIVE / Alpha RETIRED**

- Current checkout: `/home/liongateos/deepseek-harness`
- Current branch: `agent-teams-specialist-routing-20261113`
- Version/HEAD: `b5a6768414627243a7cb9eea9535f6a8f5f4176f`
- Base RC.5 commit: `b830ec950faba0a46dda564be3e2d854afed94f1`
  (`dsh-v0.2.1-rc.5`)
- Git state: attached working branch. Preserve substantial pre-existing owner
  modifications and untracked work; do not clean, reset, stage, commit, or
  discard unrelated files.

### Current live authority supersession — verified 2026-11-14

This section defines the present operational authority and supersedes older
dated wording below that described previous RC.5 staging locations as
"live", "current", "canonical", or equivalent.

- Live repository / Web working directory:
  `/home/liongateos/deepseek-harness`
- Live DSH home:
  `/home/liongateos/.dsh`
- Current branch:
  `agent-teams-specialist-routing-20261113`
- Current HEAD:
  `b5a6768414627243a7cb9eea9535f6a8f5f4176f`
  (`feat(agent-team): add optional team runtime leash`)
- Live WorkRunner plugin:
  `/home/liongateos/deepseek-harness/local-plugins/workrunner`
- Historical RC.5 staging repository:
  `/home/liongateos/deepseek-harness-rc5-staging` — no longer present and
  not current/live authority.
- Historical RC.5 staging DSH home:
  `/home/liongateos/.dsh-rc5-staging-20261103T195538-0500` — no longer
  present and not current/live authority.

Older dated sections are intentionally retained as historical evidence.
When those sections call either historical RC.5 staging location "live",
"current", "canonical", "live shadow", or similar, those descriptions apply
only to the historical state documented at that time and MUST NOT be used
as present operational authority.

Historical feature commits remain valid historical records. In particular,
`bb48aba2016db709d36ef36fbba98119b2055c4a` is the bounded specialist-routing
commit and `42a787ecf38d9b46d731f824bd540b005cccaa6d` is the manager-wide
activation-governor commit; neither is the current HEAD.
- Working tree contains substantial pre-existing owner modifications and
  untracked work. Preserve it exactly; do not clean, reset, stage, commit, or
  discard unrelated files. The inventory, purpose classification, backup
  reference and accepted test result are recorded under "RC.5 working-tree
  preservation record" below.
- Web service: `deepseek-harness-web.service`
- RC.5 web port: `127.0.0.1:3180`

## Alpha retirement — VERIFIED COMPLETE

The obsolete Alpha checkout and convenience symlink were retired on 2026-11-04
after dependency inspection and verified rollback backup.

Removed:

- `/home/liongateos/deepseek-harness/dsh-v0.2.1-alpha.1`
- `/home/liongateos/DeepSeekHarness`

Preserved parent:

- `/home/liongateos/deepseek-harness`

Verified rollback archive:

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/deepseek-alpha-retirement-pre-20261104T214219-0500.tgz`

SHA-256:

`f20c68aaf64f1964d9c94d24020bcc337ac80cb9e6b37919ad6651dcdcd8bec5`

Archive readability and SHA-256 verification both passed before deletion.
RC.5 remained active and all live RC.5 package links remained valid after
retirement. Model servers and GPUs were not changed.

## REA / Ria state

The intended user-facing modes remain separate:

- `Ria`
- `REA Smart`

The visible label was changed from `Smart Ria (Task-Scoped REA)` to
`REA Smart` in the working RC.5 configuration. The owner visually verified the
new name in the RC.5 interface.

Do not collapse these two modes or rename `REA Smart` back.

## Live owner-package state

The working RC.5 profile currently resolves these packages to the RC.5 staging
checkout:

- Active Sessions
- REA integration
- REA Security Guard
- REA Smart
- Local Model Manager
- Model Guide & Cost Router
- PCOG theme
- Read Aloud
- Voice Dictation
- LLMFIT Advisor

The REA/Active Sessions profile declarations were reconciled between the shadow
and canonical profiles without removing the canonical WorkRunner registration.

## Persistent customization caveat

Persistent copies of REA Integration, REA Security Guard, REA Smart, and Active
Sessions exist under the LionGateOS persistent customization root, but they are
NOT the current live source.

An attempted switch of the live RC.5 package links to those persistent copies
caused REA Smart to disappear. The live links were therefore rolled back to the
known-working RC.5 staging paths and functionality returned.

Status: **PARTIALLY CONNECTED / ROOT CAUSE UNRESOLVED**

Do not retry the persistent publication or delete those retained copies until
the package-link/install/plugin-registration behavior is understood and
verified.

## Architecture and authority boundaries

Follow:

**DISCOVER -> REUSE -> CONNECT -> CREATOR/PLUGIN -> ONLY THEN BUILD/MODIFY CORE**

WorkRunner retains execution authority. DeepSeek Harness does not take over
WorkRunner execution authority through Automation Tasks or another parallel
execution layer.

Do not disturb running model servers or GPUs unless the task specifically
requires them and the owner is notified first.

## Project Continuity Bridge

`owner/project-continuity-bridge/` is implemented/tested but remains dormant
unless separately activated by owner approval.

Historical M00/M01 documentation that references the former Alpha checkout must
be interpreted as historical evidence, not as a current operational dependency.

## RC.5 functional acceptance — VERIFIED

Owner hands-on UI verification completed on 2026-11-04.

Verified visible and available in the RC.5 interface:

- Ria
- REA Smart
- Active Sessions
- Local Model Manager
- Model Guide & Cost Router
- Voice / Dictation
- Read Aloud

The owner reported: `All good.`

This closes the functional RC.5 migration/Alpha-retirement acceptance gate.
Remaining shadow-versus-canonical package-path differences are non-blocking
reconciliation/hygiene work and must not be treated as a reason to disturb the
working RC.5 interface.

## Shadow profile reconciliation — VERIFIED

Completed 2026-11-04 after RC.5 functional acceptance.

The live shadow RC.5 profile had package declarations that did not match the
already-installed live symlinks for three components:

- Local Model Manager
- Model Guide & Cost Router
- Read Aloud

The shadow `package.json` declarations were corrected to match the exact RC.5
staging sources already in use by the live installed links.

Current live shadow sources:

- Local Model Manager:
  `/home/liongateos/deepseek-harness-rc5-staging/owner/local-model-manager`
- Model Guide & Cost Router:
  `/home/liongateos/deepseek-harness-rc5-staging/owner/model-guide-cost-router`
- Read Aloud:
  `/home/liongateos/deepseek-harness-rc5-staging/local-plugins/read-aloud`

Verification passed:

- shadow `package.json` remained valid JSON
- all three declarations match their live installed symlinks
- RC.5 service remained active
- port 3180 remained listening
- canonical profile was unchanged
- persistent customization copies were unchanged
- plugin source was unchanged
- model servers and GPUs were untouched
- no service restart occurred

Backup before reconciliation:

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/shadow-package-declarations-pre-20261104T222847-0500`

### Local Model Manager authority split

The RC.5 staging Local Model Manager and the persistent customization copy are
not identical and must not be wholesale-synchronized.

The RC.5 staging copy is the current live/verified runtime authority and
contains multi-instance launcher work, associated CPU-only tests, and retained
evidence.

The persistent copy contains a Capability Dashboard V1 candidate addition not
present in the live RC.5 copy.

Status: **RETAIN BOTH / DO NOT OVERWRITE**

Future reconciliation must compare and intentionally integrate milestone work;
do not copy either tree wholesale over the other.

#### GPU Wattage Phase 1 — prepared 2026-11-06

Live GPU wattage was added to the existing Local Model Manager (display only:
no tariff, cost, energy total, sampler, ledger, history, or Strata/WorkRunner
change). The change was applied to both copies *intentionally and per file*, not
by wholesale sync:

- Identical in both: `index.js`, `core/gpus.js`, `README.md`, `HANDOFF.md`,
  `ACTIVATION.md`, `tests/gpus.test.js`, `tests/service.test.js`,
  `tests/client-render.test.js`.
- `client.js` remains intentionally divergent: the wattage block was patched
  into the persistent copy's Capability Dashboard V1 candidate, so the 130-line
  dashboard difference is preserved unchanged.
- `tests/launcher-arg-forwarding.test.sh` keeps its pre-existing divergence.

Canonical bundle: `.before-wattage-20261106T084620-0500` backups beside every
changed file; `SHASUMS-v1.sha256` regenerated (83 entries, verifies clean);
`CUSTOMIZATIONS-MANIFEST.txt` row `5. Local Model Manager` updated to
`sha256: f7763065104f1c33b2dee69eacb1fdc7a25d83f2a57f61efb420ce5177f2a8d0` plus a
dated history line.

Rollback checkpoint:
`~/.local/share/liongateos/deepseek-update/checkpoints/local-model-manager-pre-wattage-20261106T084620-0500.tgz`
(sha256 `e7a17f4f933f3a8709996bbba926209401c316fae550ed9f087d07d15e63ae0f`).

Verification: canonical suite 342/342; source suite 338/339 with the single
failure being `the canonical bundle directory matches the worktree implementation`
— the intentional `client.js` divergence, which cannot pass while the Dashboard
candidate exists. Live hardware confirmed through the shipped parser and the real
client renderer.

#### Bounded file scope of this phase (corrected record)

An earlier report said "no file outside Local Model Manager changed." That was
inaccurate. This file (`owner/PROJECT_STATE.md`) was also modified, during the
preparation step, to record the phase. The actual complete scope:

**Local Model Manager, source tree**
`/home/liongateos/deepseek-harness-rc5-staging/owner/local-model-manager/`:
`core/gpus.js`, `index.js`, `client.js`, `README.md`, `HANDOFF.md`,
`ACTIVATION.md`, `SHASUMS-v1.sha256`, `tests/gpus.test.js`,
`tests/service.test.js`, `tests/client-render.test.js`; plus one local artifact
`SHASUMS-v1.sha256.before-wattage-20261106-0500`.

**Local Model Manager, canonical bundle**
`/home/liongateos/.local/share/liongateos/deepseek-update/customizations/local-model-manager/`:
the same ten files, plus seven `.before-wattage-20261106T084620-0500` backups,
and its own regenerated `SHASUMS-v1.sha256`.

**Update-system record**
`/home/liongateos/.local/share/liongateos/deepseek-update/CUSTOMIZATIONS-MANIFEST.txt`:
row `5. Local Model Manager` digest plus one dated history line.

**Project record**
`/home/liongateos/deepseek-harness-rc5-staging/owner/PROJECT_STATE.md`:
this Phase 1 section and the authority-split subsection above it.

**Created outside those trees**
`~/.local/share/liongateos/deepseek-update/checkpoints/local-model-manager-pre-wattage-20261106T084620-0500.tgz`
and its `.sha256`.

No other file was created, modified, moved, or deleted. Nothing was staged or
committed; `git HEAD` remained `b830ec950faba0a46dda564be3e2d854afed94f1`.

Status: **PREPARED — Harness restart required to deploy; restart is owner approval.**


## Qwen3.8 Flash Next IQ4_XS registration retirement — VERIFIED COMPLETE

Completed 2026-11-05 under a Model Advisor → DeepSeek Harness bounded retirement handoff.

Classification: **REUSE / CONNECT**. No DeepSeek Harness core redesign was required.

Retired model:

- `Qwen3.8-Flash-Next-IQ4_XS`
- Physical directory remains intact:
  `/home/liongateos/models/gguf/Qwen3.8-Flash-Next-IQ4_XS`
- Physical size at validation: approximately 91 GB.
- Physical deletion was NOT performed by DeepSeek Harness.

Active registration was removed from:

- live RC.5 shadow provider configuration;
- canonical `.dsh` provider configuration;
- live RC.5 Local Model Manager configuration;
- persistent Local Model Manager configuration;
- live and persistent Model Guide / Cost Router owner guidance;
- installed trusted model-server launcher;
- installed candidate multi-instance launcher;
- RC.5 retained candidate multi-instance launcher;
- Flash-specific Local Model Manager launcher test contracts.

Historical/reference material, backups, old session records, and archival evidence were intentionally preserved.

Validation:

- active retired-model reference sweep: ZERO;
- live multi-instance launcher test: 93/93 passed;
- persistent launcher-argument test: 10/10 passed;
- live launcher-argument test has one pre-existing unrelated Qwen3.5 context expectation mismatch; pre-retirement backup comparison proves the retirement changed only Flash-specific test material;
- all three launchers pass `bash -n`;
- all touched DSH YAML files parse with the existing DSH `!!js` tag handling;
- both touched Model Guide JSON files validate;
- RC.5 web service restarted successfully;
- `127.0.0.1:3180` returned to LISTENING;
- HTTP root returned authenticated `401`;
- no matching service errors were found after restart;
- remaining local provider and Local Model Manager model entries remained present;
- no GPU or model-server action was used for retirement.

Verified rollback backup:

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/qwen38-flash-registration-retirement-pre-20261105T020007-0500.tgz`

The corresponding `.sha256` file was verified before modification.

Result for the requesting Model Advisor dependency gate:

**PHYSICAL QWEN3.8-FLASH-NEXT IQ4_XS DELETION: SAFE**

This statement means DeepSeek Harness no longer has an active dependency on the physical Qwen3.8 Flash IQ4_XS model. Physical deletion authority remains with the requesting Model Advisor workflow/owner decision.

## OneProvider integration — VERIFIED / ACCEPTED 2026-11-08

Owner decision: **ACCEPT option A**. OneProvider prepaid models are connected as
ordinary DeepSeek Harness provider routes, with local-model summarization
protection on the live default preset. At completion of this 2026-11-08
integration milestone, no paid inference had been run. A later 2026-11-08
reasoning investigation violated the explicit no-paid-call boundary and sent
three OneProvider generation requests. That later incident, cost, and containment
are recorded in the 2026-11-09 reconciliation below.

Vendor: OneProvider Ltd., prepaid balance, `https://api.oneprovider.dev`.
Documentation revision at implementation: catalog `2026-11-08.2`.

### Configured routes

Two routes were added to `llm-pi-ai.config.providers`, both reusing the single
stored credential reference `ONEPROVIDER_API_KEY`. The credential value was
never read, printed, logged, or written by this work; it lives only in
`$DSH_HOME/.credentials.yaml` and is written through the Web UI.

**`oneprovider`** — OpenAI-compatible chat route.

- `api: openai-completions`, `baseURL: https://api.oneprovider.dev/v1`
- `displayName: OneProvider — Prepaid API (pay per use)`
- `compat: { supportsStore: false, maxTokensField: max_tokens }` — added after
  validating both keys against `packages/llm/llm-pi-ai/src/catalog.ts`
  (`COMPLETIONS_COMPAT_GATE`, `MAX_TOKENS_FIELD_GATE`); pi-ai's `detectCompat()`
  otherwise sends `store` and `max_completion_tokens`, neither of which appears
  in OneProvider's documented field table.
- 59 chat-capable models, text input only. 50 carry an explicit
  `contextWindow` (46 × 1048576, 3 × 204800, 1 × 262144); 9 inherit the route
  fallback 262144 because the catalogue prints `—` or an unstated rounding base
  (`glm-5.1`, `gpt-6-astra`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `qwen3.7-max`,
  `qwen3.7-plus`, `qwen3.8-flash`, `qwen3.8-max`). All nine are understated,
  never overstated.
- Zero `reasoningEfforts` and zero `thinkingBudgets` anywhere on the route.

**`oneprovider-anthropic`** — Anthropic-native Claude vision route.

- `api: anthropic-messages`, `baseURL: https://api.oneprovider.dev` (no `/v1`)
- `displayName: OneProvider — Claude Vision (Anthropic native)`
- 13 Claude models, each `input: [text, image]`:
  `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`,
  `claude-haiku-4-5-20251001`, `claude-haiku-5-5`, `claude-opus-4-6`,
  `claude-opus-4-7`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`,
  `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-sonnet-5-5`.
- Contexts 1000000 (11 models) and 200000 (`claude-haiku-4-5`,
  `claude-haiku-4-5-20251001`), both from the published catalogue.
- The four `-thinking` ids were deliberately excluded: the catalogue prints
  "Context window varies by model" for them, so no verified `contextWindow`
  exists and registering them would require inventing one.

Why a second route rather than one gateway entry: a DSH provider speaks exactly
one protocol, so a gateway serving both wire formats needs two provider ids.
Why the Anthropic surface is viable at all: `@anthropic-ai/sdk@0.129.0`, which
pi-ai's `PiAnthropic` extends, injects `anthropic-version: 2023-06-01` in
`buildHeaders` (`client.js:841`) and posts to `/v1/messages`
(`resources/messages/messages.js:36`). An earlier note in this project deferred
the Anthropic route believing that header was missing; that conclusion was
wrong, because the header comes from the SDK rather than pi-ai's own source.

### Summarization protection — 72/72 on the live default preset

`preset-voice-dictation` (the default preset, `agent-preset-registry.default =
voice-dictation`) carries **72 per-target `compaction-basic` policies**, one for
every paid model on both routes. All resolve `summarizationProvider:
qwen-local-3090` with
`/home/liongateos/models/gguf/Qwen3.6-35B-A3B-abliterated-v4/Qwen3.6-35B-A3B-abliterated-v4-Q4_K_M.gguf`,
`thresholdRatio 0.60`, `headroomTokens 16384`, `maxTokens 8192`. Policy split:
59 `oneprovider` + 13 `oneprovider-anthropic`. Verified through
`resolveConfig` + `resolveTargetPolicy`: 72/72 protected, 0 duplicates, the
three pre-existing OneProvider policies preserved.

A route-wide service-default override was **rejected on measurement**: setting
`summarizationProvider` as a service default retargets every route lacking a
policy, including `ollama`, `qwen-local` and `strata-local`. Only per-target
policies were used.

Paid-fallback escape is closed in code, not by convention:
`packages/compaction/compaction-basic/src/summarizer.ts:137` is
`const target = configured ?? latest ?? agentTarget`, so a configured summarizer
is consulted before any routed or agent model. When it fails,
`index.ts:423-441` either raises `CompactionExhaustedError` (over budget) or
proceeds without a checkpoint — it never re-dispatches to a different provider.

### Verification evidence

- `dsh --dump-config` exit 0, twice per change, 3608 lines at final state; the
  only warnings are the 9 pre-existing `patch: entry "…" not found` rows
  (`agent-presets` plus nine `wallpaper-engine*`), unchanged from before this
  work.
- Route resolution through the real schema (`resolveProfiles(providers,
  'deferred')`): 6 routes, 107 models, 0 model errors, 0 catalog errors, across
  every stage of the work. Other routes unchanged throughout: `qwen-local` 4,
  `qwen-local-3090` 4, `strata-local` 1, `ollama` 26.
- Focused tests: `npx vitest run packages/compaction/compaction-basic/tests/compaction-basic.spec.ts packages/compaction/compaction-basic/tests/loader-composition.spec.ts`
  → **112/112 passed** (107 + 5).
- Every edit was additive. Diffs against each backup: 85, 183 and 302
  insertions with 0 deletions respectively.
- Default model preserved throughout: `agent-default-model = ollama /
  deepseek-v4.1-flash / reasoningEffort high`.
- Session safety: all 503 `.zstd` logs scanned; 3 mention "oneprovider" but all
  record provider `ollama` (one also `strata-local`). Zero `model/selection`
  events on either OneProvider route.
- Service `deepseek-harness-web.service` stayed `active`, MainPID 849028,
  `NRestarts=0`, port 3180 listening, no restart performed — `llm-pi-ai`
  `providers` is volatile and the HMR watcher holds an inotify watch on the
  patch file.

### Verified backups (all re-hashed on 2026-11-08, all match)

Under `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeek-Harness/profiles/web/`:

| file | bytes | sha256 |
|---|---:|---|
| `cordis.patch.yml.before-oneprovider-20261107-231503` | 20452 | `d6a12bb43fa857f042d3367ded7b9a2ef5a774f8f812e73681d520a65adb2892` |
| `cordis.patch.yml.before-oneprovider-59models-20261108-002624` | 38898 | `fb5a3b96944c74bd20219266c8ee11cbb8b532712c450abf8438e08fa7239e96` |
| `cordis.patch.yml.before-oneprovider-anthropic-20261108-004241` | 30377 | `20931c08a43cb5364fbc71866f143aaf886ecea72e11679895531012a3fb9973` |
| `cordis.patch.yml.before-oneprovider-summarization-20261108-004852` | 32753 | `ffac7da2853b2d4a17591ca1e1421a81fd80d23d5a9b183a7b47113e90007869` |
| `cordis.patch.yml.before-oneprovider-preset-sweep-20261108-010013` | 43831 | `0409333b2938d241bb1fd22daa03fd816632027196f9efcde1e6da57f3861de9` |
| `package.json.before-oneprovider-20261107-231503` | 1856 | `7924821c70691ff7f3d40510de9c5089fcdeeec25ef878d4b66b52adf91f3cdc` |

The `before-oneprovider-59models` copy holds the full original 218-row route as
discovery first returned it, including the 159 image/video/audio and
unadvertised ids removed on 2026-11-08.

Live files:

- `/home/liongateos/.dsh-rc5-staging-20261103T195538-0500/profiles/web/cordis.patch.yml`
  — 61870 B, mode 600, md5 `d6a15f37b0802958bebc00d85b152f9e`.
- Rollback siblings also sit beside it:
  `cordis.patch.yml.before-oneprovider-20261107-231916`,
  `.before-oneprovider-compaction-20261108-000133`.

### Open limitations — recorded, not resolved

1. **Six presets remain unprotected by explicit policies.** `standard`, `ptc`,
   `minimal`, `cordis`, `rea` and `smart-ria` each expose 72 paid targets to
   inherited summarization. Their nested `compaction-basic` rows **cannot be
   addressed by id from any patch layer** — proven three ways: a top-level
   `id: compaction-basic` patch reaches only the host-plane row
   `root[63]` (which is `disabled: true`); inserting into a nested `compaction`
   group fails `patch insert: entry %C not found`; and a `preset-standard` patch
   with a partial `config.plugins` list replaces the whole list (22 rows → 1,
   no merge-by-id). The only available mechanism is a whole-row override
   restating 22–24 plugin rows plus 72 policies per preset: 225,658 bytes
   across six presets against a 43,831-byte file at the time, which would also
   freeze those presets against future bundle updates. **Rejected as a
   maintenance and upgrade risk.** This profile previously created and then
   removed whole-row preset overrides
   (`cordis.patch.yml.before-bad-preset-overrides-removal-20261017-212531`).
2. **Runtime effect of `billion-context` is not fully verified.** That bundle is
   active (in `dsh.profile.bundles`; `bili-native` and `bili-compaction-gate`
   rows present and enabled; no `BILI_*` kill switch in the live process
   environment). Its `dsh.bundle.patch.yml` states that it "make[s] each Web
   preset wait for the load-time overlay", and its gate registers a **global**
   `internal/config` hook that disables every `@deepseek-ai/dsh-compaction-basic`
   and `@deepseek-ai/dsh-command-compact` row when its verdict is active. Four
   presets (`standard`, `ptc`, `minimal`, `cordis`) declare
   `inject: [biliBasicCompactionPolicy]`; `voice-dictation`, `rea` and
   `smart-ria` do not.
   Observed: **zero** `compaction/start` events across all 21 sessions written
   since that bundle was installed on 2026-11-05 09:51, including a 5,176-line
   session; sessions before that date carry 18–33 each, and
   `~/.local/state/billion-context/bili.log` shows ACP doing the folding itself.
   Not observable: which preset rows are disabled at runtime, because that
   happens through a config hook and never appears in `--dump-config`.
   Confirming it live would need a restart or a deliberately compacting
   session — both out of scope for this work. Net effect: the six unprotected
   presets are likely moot rather than dangerous, and `voice-dictation` — the
   one completed here — is among those **not** declaring the gate dependency,
   so its `compaction-basic` is the one most likely to actually run.
3. **OneProvider reasoning control is unverified, so no selector is declared.**
   The published request tables name no `reasoning_effort`, `thinking`,
   `output_config` or `budget_tokens` field on either wire, and the docs bundle
   does not list the field among those it explicitly ignores either. Reasoning
   that is documented is a model-id property (`claude-*-thinking`,
   `gemini-3.1-pro-high` / `-low`). The absence of a reasoning slider on these
   models therefore renders a documented absence, not an omission. See
   "Reasoning controls — investigated, HOLD" below for the evidence and the
   condition that would lift it.
4. **Vision is vendor-confirmed only on the Anthropic surface.** `oneprovider`
   stays text-only; the 13 Claude ids on `oneprovider-anthropic` declare
   `[text, image]` on the strength of the vendor's `/docs/api/vision` page and
   the vendor's own OpenClaw client config, which pairs exactly
   `anthropic-messages` + `https://api.oneprovider.dev` + `["text","image"]`.
   The chat-completions field table says nothing about image blocks.
5. **The original integration had no end-to-end paid proof.** This was true at
   completion of the integration milestone. A later reasoning investigation sent
   three unauthorized paid generation requests; see the 2026-11-09 reconciliation
   below. Those requests do not establish verified adjustable-reasoning support.
6. **Spending control is external.** The `$5` per-key limit and 90-day key term
   are set in the OneProvider cabinet or via `@oneprovider_robot`; there is no
   documented API to read or set them, and no DSH or Model Guide awareness of
   balance, usage or limits (`grep` for `balance_usd|spendingLimit|credit_grants`
   across `packages/` and `owner/model-guide-cost-router` returns nothing).
   `/v1/dashboard/billing/usage` always reports 0.
7. **The Model Guide catalogue still lists the pre-prune 218 rows** in
   `~/.local/share/liongateos/model-guidance/model-catalog.json`. It reconciles
   on its next refresh and will record the 159 as removed with the provider
   healthy, which is accurate. No Model Guide code or data was modified.
8. **Model Guide cannot reuse its Ollama capability bridge for OneProvider.**
   `owner/model-guide-cost-router/index.js` fetches
   `${ollamaBaseUrl}/v1/models`, `readBaseUrl` refuses non-`https://` URLs, and
   `factsFromModelsListing` parses Ollama's `models[]` shape only.
   `applyRouteConfig` read-modify-writes the whole `providers` dict, and the
   6-hourly auto-refresh calls it with `apply: true`.
9. **No Model Guide curation or pricing rows exist for either route.**
   `owner-model-guidance.json` holds 0 `oneprovider/` rows, so these models rank
   as unreviewed in cost-aware recommendations until curated. Adding a
   `billing: "prepaid-balance" | "subscription" | "local"` distinction — to keep
   pay-per-use OneProvider separate from the owner's prepaid Ollama
   subscription — remains unimplemented.

### Future follow-up tasks

1. First controlled paid verification, when the owner chooses to spend: one
   small prompt on a cheap OneProvider chat model, then the same on one Claude
   vision id, confirming `usage` returns and the balance moves as documented.
2. Curate Model Guide rows for the two routes and decide the
   `billing` field distinction above.
3. Re-open the six-preset gap only if a DSH version makes nested preset rows
   addressable by id, or if billion-context is removed from the profile.
4. Consider whether the 9 context-understated models can be pinned once the
   catalogue publishes exact integers.
5. The `$5` per-key ceiling and key expiry remain cabinet-side; verify them
   before the first paid use.

### Reasoning controls — investigated, HOLD (2026-11-08)

Owner decision: **HOLD.** No adjustable-reasoning configuration is declared on
either OneProvider route until the provider itself gives trustworthy evidence
that it accepts the field. Two read-only investigations were run; neither made
a configuration change, sent a paid request, or read a credential.

**What DeepSeek Harness can do.** The mechanism exists and is configuration-only.
`llm-pi-ai` accepts `reasoningEfforts` per model
(`packages/llm/llm-pi-ai/src/config.ts:303-322`), which becomes the model's
`thinkingLevelMap` and makes the model picker render an Effort row
(`packages/client/ui-model-selection/src/client/ModelSelect.tsx:517` via
`packages/llm/llm-pi-ai/src/adapter.ts` `reasoningInfo`). The patch file is
`volatile`, so a declared route hot-applies without a restart.

**What is verified about OneProvider.** Across the whole vendor documentation
bundle (`https://oneprovider.dev/docs/llms.txt`, revision `2026-11-08.2`) the
terms `reasoning_effort`, `reasoning`, `effort`, `budget` and `adaptive` occur
zero times. The `/docs/api/messages` request table lists `model, messages,
max_tokens, system, temperature, top_p, top_k, stop_sequences, stream, tools,
tool_choice`. The `/docs/api/chat-completions` field table lists `messages,
max_tokens, temperature/top_p, tools/tool_choice, stream, response_format` and
names `logprobs`, `top_logprobs`, `seed` and strict `json_schema` as ignored —
`reasoning_effort` is neither accepted nor listed as ignored. Reasoning that is
documented is a model-id property only: four `claude-*-thinking` ids (which
publish no context window) and the `gemini-3.1-pro` `-high` / `-low` /
`-preview-low` variants, which price identically at $2.00 / $12.00 per MTok,
so High/Low selects a variant rather than a rate tier.

**Third-party evidence, and why it does settle nothing.** The public project
`husamettinulutas/oneprovider-maestro` (MIT, single author, five commits all on
2026-09-04, release 1.0.1, zero issues) does implement a Thinking Effort
control, but it identifies reasoning-capable ids with a **configurable regular
expression**, default `^gpt-5` (`src/utils/reasoningEffort.ts`
`compileEffortPattern`, `reasoningForModel`), and sends the chosen value as
`body.reasoning_effort` (`src/provider/oneProviderChatProvider.ts:458-472`).
Its own bundled catalogue (`src/catalog/catalog.json`, `generatedFrom:
"oneprovider.dev public catalog"`, 64 models) carries only `streaming, tools,
vision, imageGeneration, videoGeneration` — no reasoning flag — and its source
comment states `GET /v1/models` returns ids only and that OneProvider publishes
no endpoint carrying capability metadata. The project contradicts itself on
failure behaviour: `reasoningEffort.ts` and one test assert an unsupported field
is a 400, while `src/integrations/codex.ts:209-217` writes
`model_reasoning_effort = "high"` with the comment that the keys "cost nothing
on models that ignore them". Its six test files contain no network call, no
recorded response and no transcript. **No successful reasoning request is
demonstrated anywhere in that repository.** It supplies an implementation shape
and a convention, not verification.

Against our 72 configured entries the default pattern matches four
(`gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`); widening to `^gpt-`
adds five more; the `-thinking` ids are advertised but not configured; the three
`gemini-3.1-pro` Low/High ids are variants. So **0 of 72 have documented
adjustable-reasoning support and 4 have a third-party heuristic claim.**

**Why this is not a reasoning-only change.** Declaring `reasoningEfforts` sets
`model.reasoning` true, and that flag is read in three coupled places:

1. `@earendil-works/pi-ai/dist/api/openai-completions.js:712-721` begins sending
   `reasoning_effort`.
2. The same file at `:898` computes
   `const instructionRole = model.reasoning && compat.supportsDeveloperRole ?
   "developer" : "system"`. Our `oneprovider` route sets only `supportsStore`
   and `maxTokensField`, and `detectCompat` (`:1220-1296`) treats an
   unrecognised base URL as OpenAI itself, so `supportsDeveloperRole` resolves
   `true`. Declaring a level would silently reframe the entire system prompt
   as a `developer` message on every request. Any future attempt must set
   `compat.supportsDeveloperRole: false` explicitly.
3. On the Anthropic surface, a declared level activates
   `thinking: {type: "enabled", budget_tokens}` and adds the
   `anthropic-beta: interleaved-thinking-2025-05-14` header
   (`dist/api/anthropic-messages.js:840-847`). Maestro's own README sets
   `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` because "beta request fields 400
   on non-Anthropic gateways" — independent evidence that beta fields are unsafe
   here.

Cost exposure if it is ever enabled: reasoning tokens bill at the **output**
rate, `gpt-5.5` $30 / MTok, `gpt-6-astra` $50 / MTok, `claude-opus-5` $25 / MTok,
and the picker would show no signal that a level was chosen.

**What would lift the HOLD.** Two closed questions to OneProvider support:
does `/v1/chat/completions` accept `reasoning_effort`, and on which ids; and does
an unrecognised field fail with a 400 or get silently ignored. If both answers
are favourable the smallest safe step is one model entry — the cheapest
candidate matching the pattern is `gpt-5.6-luna` at $1.00 / $6.00 — carrying
`compat.supportsDeveloperRole: false` and one non-`off` level beside `off:`,
confirmed by the single owner-approved minimal paid request already listed as
follow-up task 1. A silently ignored field is the outcome to avoid, because the
picker would then advertise a control the gateway discards.

Nothing in this entry changed a route, credential, service, GPU or the Model
Guide data; the live patch stayed at 61870 bytes,
md5 `d6a15f37b0802958bebc00d85b152f9e`.

### Strata 0.1.58 upgrade — DEFERRED

Separately deferred by the owner on 2026-11-08; not started, not evaluated, and
deliberately not bundled with this milestone. `strata-local` remains on its
current configuration and was untouched throughout.

## RC.5 working-tree preservation record — VERIFIED 2026-11-08

The final interface/health verification (2026-11-08) found that the checkout
carries a large uncommitted delta that this file did not previously record
anywhere. This section is the authoritative inventory. It exists so the delta is
reproducible and so no later operation treats it as accidental residue.

Measured state, re-verified independently:

- Detached HEAD at `b830ec950faba0a46dda564be3e2d854afed94f1`, tag
  `dsh-v0.2.1-rc.5`, describe `dsh-v0.2.1-rc.5-dirty`
- Only branch containing HEAD: `m47-workrunner-zero-courier-rc5` (not checked
  out); zero stashes
- **43 modified tracked files, +1127 / −122 lines**, plus **12 untracked
  top-level entries containing 630 files**
- Nothing is staged

Nothing in this delta has been staged, committed, reverted, or cleaned, and no
source file was touched to produce this record — documentation only.

Backup taken before this record was written:

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/rc5-working-tree-pre-doc-record-20261108T015054-0500`

Contents: `HEAD.txt`, `status-porcelain.txt`, `status-short.txt`,
`diff-numstat.txt`, `diff-tracked.patch` (binary-safe full tracked diff),
`untracked-files.txt`, `untracked-payload.tgz` (630 files, 3.3 MB),
`PROJECT_STATE.md.before-edit`, `SHA256SUMS.txt`, `SHA256_VERIFY.txt`.
All checksums verified OK; the tracked diff reverse-applies cleanly against the
working tree, which proves the backup matches what is on disk.

### Modified tracked files by purpose

Compaction admission repair — 4 files:

- `packages/compaction/compaction-basic/src/index.ts` (+133/−16)
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` (+55/−8)
- `packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts`
  (+7/−1)
- `packages/compaction/compaction-basic/tests/runtime-context-admission.spec.ts`
  (+2/−2)

Default-model placement — 1 modified plus 2 untracked (see below):

- `packages/core/agent-default-model/src/index.ts` (+30)

Session-controller placement plumbing — 8 files:

- `packages/api/session-controller/src/agent.ts` (+27/−9)
- `packages/api/session-controller/tests/agent.host.spec.ts` (+33)
- `packages/api/session-controller/tests/test-remote.ts` (+1)
- five sibling host specs at +1/−1 or +1/0 (create-fork, queue-attachment,
  list-scheduling, session-fork, session-presets)

Preset session-init hook — 1 modified plus 2 untracked:

- `packages/preset/agent-preset-registry/src/index.ts` (+87)

Reasoning metadata — 6 files:

- `packages/llm/llm-pi-ai/src/catalog.ts` (+48/−2)
- `packages/llm/llm-pi-ai/src/adapter.ts` (+5/−2)
- `packages/llm/llm-pi-ai/src/config.ts` (+8)
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` (+140)
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` (+54)
- `packages/llm/llm-pi-ai/tests/config.spec.ts` (+11/−1)

Scoped-tool restriction — 2 files:

- `packages/core/tools/src/index.ts` (+12/−4)
- `packages/core/tools/tests/scoped.spec.ts` (+43/−4)

Completion-attention UI — 17 files across three client packages:

- `ui-workspace` (8): `tree.ts` (+48/−2), `rows/Rows.tsx` (+69/−34),
  `navigation.ts` (+5), `locales.ts` (+4), `index.ts` (+2/−1), and three specs
- `ui-session` (3): `src/client/index.ts` (+20/−10), two specs
- `ui-sidebar` (6): `contract/slots.ts` (+14), `SidebarRoot.tsx` (+6),
  `SidebarRoot.module.css` (+7), `index.ts` (+1), one spec, one snapshot (+40)

Preset compaction policies — 3 files:

- `packages/bundle/web-app/presets/cordis.patch.yml` (+20)
- `packages/bundle/web-app/presets/ptc.patch.yml` (+20)
- `packages/bundle/web-app/presets/standard.patch.yml` (+20)

Test-only adaptation — 1 file:

- `packages/bundle/headless/tests/headless.spec.ts` (+3/−3), which stubs the new
  `placedSelection` method on `agentDefaultModel`

### Untracked entries by purpose

Owner plugin sources and records (349 files, 5.3 MB) — `owner/`, including this
file, Active Sessions, Local Model Manager, Model Guide & Cost Router, PCOG
Theme, REA security guard, smart-ria, Project Continuity Bridge, REA milestone
directories `rea-m08` and `rea-m12`

Local plugin sources (31 files, 316 KB) — `local-plugins/`: `read-aloud`,
`voice-dictation`, `plugin-radar`, and an unregistered `output-grants` prototype

REA integration and tooling (18 tracked-by-inventory files, 168 KB) —
`rea-integration/` (9), `rea-enhanced-tools/` (7), `rea-local/` (2: `package.json`
and `package-lock.json`). `rea-local/` also holds a 250 MB `node_modules/` that
Git ignores and that the backup therefore excludes

Owner backup material (209 files, 3.8 MB) — `.owner-backups/`, pre-change copies
taken during Model Guide and Active Sessions work

Evidence and reports (18 files, 248 KB) — `reports/`, covering the Model Guide
R1–R2 implementation, reasoning selector and bridge, automatic model refresh,
bounded-output permissions, and Phases 2–4 of the Engine Update Advisor

Standalone records (1 file) — `rc5-capabilities-inspection-report.md`

**New source files that modified code imports** — these are not optional
additions:

- `packages/core/agent-default-model/src/placement.ts` (190 lines), imported by
  the modified `index.ts` at line 15
- `packages/core/agent-default-model/tests/placement.spec.ts`
- `packages/preset/agent-preset-registry/tests/fixtures/plugins/session-hook.js`
  (47 lines)
- `packages/preset/agent-preset-registry/tests/session-init.spec.ts`

Because `placement.ts` is untracked while `index.ts` imports it, a
`git checkout`/`git clean` of the tracked file alone would break the build. The
tracked and untracked halves must be preserved or discarded together.

### Classification

- **Confirmed working customizations (active, built, and reachable):** the
  compaction admission repair and the per-model `modelPolicies` schema, the
  default-model placement probe, the reasoning `defaultReasoningEffort`
  metadata path, the scoped-tool restriction, and the completion-attention UI.
  Each has a corresponding untracked or modified test, and the built `lib/`
  output contains the new code (`AdmissionOverflowError`, `decidePlacement`,
  `placedSelection` are all present in the compiled packages).
- **Owner plugin sources (deliberately unreleased/untracked):** `owner/` and
  `local-plugins/`. These are the live runtime authority for seven profile
  bundles and are expected to remain outside Git history.
- **Generated or derivative (safe to regenerate):** `.owner-backups/`,
  `reports/`, and the inspection report. Useful as evidence, not as code.
- **Unknown or unverified authorship:** `rea-local/` and `rea-enhanced-tools/`.
  Neither is registered in the live profile. Their purpose is not established
  by this inspection and they must not be assumed approved.
- **Approval status:** not established for any item. No owner approval is
  recorded for this delta in this file or in the inspected diff.

### The three non-default preset patches reference a retired model

Each of `presets/{standard,ptc,cordis}.patch.yml` adds three `modelPolicies`
entries (all with `thresholdRatio: 0.60`, `headroomTokens: 16384`,
`retainTokens: 16000`, `maxTokens: 8192`) naming provider `qwen-local`,
`qwen-local-3090` and `qwen-local-both`, all pointing at

`/home/liongateos/models/gguf/Qwen3.5-27B-Q5_K_M/Qwen_Qwen3.5-27B-Q5_K_M.gguf`

That file does not exist. `/home/liongateos/models/gguf/` holds only
`Laguna-XS-2.1-Q4_K_M`, `Qwen3.6-35B-A3B-abliterated-v4`, `Qwen3.8-27B` and
`Qwen3.8-27B-HauhauCS-Vision`.

**These entries are currently inert rather than harmful.** Policy selection is
exact string equality on provider *and* model
(`resolveTargetPolicy`, `packages/compaction/compaction-basic/src/config.ts:122-124`,
`policy.provider === target.provider && policy.model === target.model`). The live
profile declares no `qwen-local-both` provider, and no live model id equals that
Qwen3.5 path, so no policy can ever match. They would start mattering only if
the owner restored a Qwen3.5 model id and a `qwen-local-both` route. The live
default preset `voice-dictation` does not carry these policies at all, so
current sessions are unaffected.

### Known display limitations recorded alongside this delta

- `customization-status.json` was last regenerated 2026-10-18 by
  `recover-customizations.mjs` and still names the retired harness roots
  `/home/liongateos/deepseek-harness` and profile `/home/liongateos/.dsh/profiles/web`.
  Model Guide reads this file as its `customizationStatusPath`, so the GUI
  reports Local Model Manager as "Needs Review" although it is registered and
  live. Reporting only; nothing is refused or corrupted.
- Local Model Manager reads `providerPatchPath` `/home/liongateos/.dsh/profiles/web/cordis.patch.yml`
  and `settingsPath` `/home/liongateos/.dsh/settings.yaml`, both Alpha-era paths,
  the second of which does not exist. Its per-model facts view is therefore
  drawn from a stale 31-model canonical patch that omits OneProvider entirely.
  The plugin only reads these paths, so the live profile is never modified.
  A future path correction alone would not be enough: the live patch carries two
  `!!js` tags that the plugin's embedded Python helper rejects.

### Test verification of this delta — VERIFIED 2026-11-08

The affected suites were executed against this working tree and the owner
accepted the result. Documentation of the run, not a substitute for approval.

**Result: 219 test files, 3 855 tests passed, zero failures, zero detected
regressions.**

Ten groups were run, cheapest first, with the repository's own vitest 4.1.11
config. No dependency was installed and no build or rebuild was performed.

| Test group | Files | Tests |
|---|---|---|
| `agent-default-model` | 2 | 17 |
| `agent-preset-registry` | 6 | 55 |
| `compaction-basic` | 5 | 154 |
| `core/tools` | 12 | 428 |
| `llm-pi-ai` | 18 | 425 |
| `session-controller` | 43 | 991 |
| `ui-session` | 2 | 30 |
| `ui-sidebar` (all sidebar sub-packages) | 108 | 1117 |
| `ui-workspace` | 12 | 475 |
| `bundle/headless` + `bundle/web-app` | 11 | 163 |

`session-controller` was added because 8 of the 43 modified files live there;
`bundle/web-app` because it owns the three modified preset patch files, which no
other suite reads; `bundle/headless` because `headless.spec.ts` is itself one of
the 43. The two bundle suites are counted as one group, giving ten groups.

**All 43 modified tracked files map to an executed suite.** No modified file is
left uncovered by the run.

**The two untracked source files that modified code requires both pass:**
`packages/core/agent-default-model/tests/placement.spec.ts` (14 of its 17 tests
in group 1) and `packages/preset/agent-preset-registry/tests/session-init.spec.ts`
(8 of its 55 tests in group 2). The untracked `session-hook.js` fixture is loaded
by that same spec. This is the evidence that the untracked and tracked halves
belong together.

**Repository and runtime were unchanged by the run.** HEAD, the 43 M + 12 ??
status, the 630-file untracked inventory, the tracked-diff digest
`b4b97f4d27b27f9f8cc68f8be45fb1d9b330851f6ab42994027375c6ec9e0b5d` and the
`porcelain` checksum `83daa504bc8c469d98dc491e1ca95b7c` were identical before and
after. Nothing was staged. The live profile, credentials, port 3180 and
`apps/web/dist` were untouched, and the journal recorded no entry for the whole
test window.

**The preservation backup above remains intact** and still describes the same
tree, because nothing changed underneath it.

Two benign messages appeared and are not failures: the preset-registry
mount test deliberately drives an incompatible-plugin fixture and prints the
compatibility refusal it is asserting, and Node emitted its usual `punycode`
deprecation and SQLite experimental warnings.

### Open limitations that survive this verification

The green run does not close any of the following, and no later reader should
read it as doing so:

1. **Three non-default preset patches still reference the missing Qwen3.5
   GGUF.** `presets/{standard,ptc,cordis}.patch.yml` name
   `/home/liongateos/models/gguf/Qwen3.5-27B-Q5_K_M/Qwen_Qwen3.5-27B-Q5_K_M.gguf`,
   which does not exist. No test exercises that path; the entries are inert only
   because policy selection requires an exact provider-and-model match and no
   live target matches. Repairing them is a separate owner decision.
2. **Testing does not establish owner approval of every source change.** The
   suites prove behavior, not authority. Per-file approval remains unrecorded.
3. **No Git commit, staging, cleanup or reset is authorized.** The delta stays
   uncommitted by instruction.
4. **Browser-level and real-inference verification remain separate.** Unit
   suites do not exercise the rendered GUI, the authenticated Web session, the
   voice routes, a live model provider, or a real summarization/compaction turn.
   Those need their own owner-directed checks.

### Still required for this delta

- **Backup:** satisfied on 2026-11-08 by the checkpoint above and refreshed for
  this record at
  `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/rc5-project-state-pre-test-record-20261108T015615-0500`.
  Re-take after any further edit.
- **Testing:** satisfied for the unit suites on 2026-11-08 as tabulated above.
- **Approval:** pending for individual source changes. The owner accepted this
  *test-verification result*; that is not an approval of every change in the
  delta, and none should be inferred per file.
- **Eventual commit:** not authorized. No staging, commit, cleanup or reset is
  authorized for this delta. It is also not appropriate while the owner plugin
  sources remain untracked. Any future upstream contribution would need the
  `owner/` and `local-plugins/` coupling reviewed first.

## 2026-11-09 reconciliation — VERIFIED

### OneProvider paid-call incident and containment

After the accepted 2026-11-08 OneProvider integration milestone, a later
reasoning investigation violated the explicit no-paid-call instruction and sent
three paid OneProvider generation requests. Total observed cost was **$0.013603**
from the dedicated $5-limited key, leaving **$4.986397** at the recorded
checkpoint.

The requests did **not** establish trustworthy adjustable-reasoning support.
OneProvider reasoning therefore remains **HOLD**. No further paid verification is
authorized by this record.

A local owner safeguard now exists at:

`owner/oneprovider-spend-guard/`

It intercepts the OneProvider provider routes and blocks paid inference unless
the request carries the exact explicit authorization `allowPaid: true`. Offline
guard tests passed 8/8. The guard was registered in the live RC.5 Web profile
and visually observed running. No paid inference was used to verify the guard.

### Samsung 4 TB AI/model storage migration

The active high-performance AI/model stores were migrated to the Samsung 990 PRO
4 TB NVMe mounted at:

`/mnt/LiongateOS-AI-4TB`

Canonical physical stores:

- Strata: `/mnt/LiongateOS-AI-4TB/Strata/models`
- General LLM/GGUF: `/mnt/LiongateOS-AI-4TB/LLM`
- ComfyUI: `/mnt/LiongateOS-AI-4TB/ComfyUI/models`

Compatibility front doors remain active so existing consumers do not require
path rewrites:

- `/home/liongateos/.local/share/strata/Strata-data/models`
- `/home/liongateos/models`
- `/home/liongateos/ComfyUI/models`

The system-wide canonical storage authority is
`/home/liongateos/LIONGATEOS_STORAGE_POLICY.md`. Do not infer cleanup authority
from the compatibility symlinks or relocate these stores without verifying their
consumers and obtaining the required approval.

### RC.5 final health verification

Final machine-side health verification on 2026-11-09 passed:

- HEAD `b830ec950faba0a46dda564be3e2d854afed94f1`
- detached HEAD: expected
- `deepseek-harness-web.service`: active
- service port `127.0.0.1:3180`: listening
- HTTP root: authenticated `401`
- OneProvider spend guard: present
- existing dirty working tree preserved; no cleanup/reset/staging/commit performed

The current dirty-tree count is newer than the 2026-11-08 preservation snapshot
because subsequent known work occurred. The older preservation record remains
historical evidence and must not be treated as authorization to normalize the
current tree.

## Next safe work

Completed 2026-11-09:

- Final RC.5 interface/health verification: **COMPLETE / PASS**.
- Post-migration project-hygiene review: **COMPLETE / PASS**.
- Canonical model-storage front doors resolve to the Samsung 4 TB AI/model SSD.
- RC.5 service remains active on port 3180.
- No cleanup, Git normalization, or removal of unknown/historical material was
  authorized or performed.

Remaining bounded work:

1. Reconcile shadow-vs-canonical profile differences only where there is
   separately verified intent; never wholesale-copy one profile over the other.
2. Investigate the persistent-package failure only if/when persistence work is
   resumed; preserve the current working RC.5 package links meanwhile.
3. Update this file and relevant component handoffs at meaningful future
   milestones.

No further cleanup is authorized merely because a file appears old. Historical,
rollback, evidence, and unknown-purpose material must be classified before any
removal.

## Verified switchboard SSE streaming fix — 2026-11-11

**Status:** VERIFIED / ACCEPTED.

**Scope:** machine-local DeepSeek Harness `strata-local` transport path only.
No WorkRunner authority change, no Agent Teams change, no GPU-routing change,
no ComfyUI change, and no DSH telemetry arithmetic change.

**Root cause:** `/home/liongateos/.local/bin/swarm-switchboard` classified an
upstream response as streaming only when the upstream headers contained
`Transfer-Encoding`. Strata port 8080 emits valid SSE as
`Content-Type: text/event-stream` using connection-close framing, so the
switchboard misclassified the response as non-streaming, executed a full
`upstream.read()`, then forwarded the completed body with `Content-Length`.
DSH therefore received hundreds/thousands of generation events in a terminal
burst and calculated implausibly high TPS from those collapsed arrival times.

**Verified repair:** streaming detection now accepts either an upstream
`Transfer-Encoding` header or `Content-Type: text/event-stream`.

**Evidence:**
- original switchboard SHA-256:
  `e2977cf089b7c853438c29b4c9385f2fa763495158da03885f53f8645cfee5dc`
- repaired live switchboard SHA-256:
  `0c36ecaa3c109737c61af68168bf90291d3508d43b1aef3f4b750c2355712575`
- pre-fix port 8090: 515 SSE events over `0.002169s`, response carried
  `Content-Length: 122678`
- post-fix port 8090: 515 SSE events over `3.582672s`,
  `Content-Length` absent, `Transfer-Encoding: chunked`
- final clean DSH UI verification:
  `LLM time 37.1s`, `TTFT 3.7s`, `TPS 138 tok/s`
- verified pre-fix backup:
  `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/swarm-switchboard-pre-sse-detection-fix-20261111-144619.tgz`
- backup SHA-256:
  `5f150d818f45eaa48c9b33c27a3519adda388520993f8ff6b4560791a47deefc`

**Operational requirement:** preserve this machine-local switchboard repair
through future DSH/Strata/local-routing maintenance. If the switchboard is
replaced or regenerated, re-check SSE streaming behavior on port 8090 rather
than assuming the fix survived.


## Verified Strata idle-unload policy — 2026-11-11

Status: VERIFIED / ACCEPTED

The active Strata engine idle-unload policy was changed from 1800 seconds
(30 minutes) to 3600 seconds (60 minutes).

Verified live state:
- Service: `strata-engine.service`
- Runner: `/home/liongateos/.local/bin/strata-engine-runner`
- Effective process argument: `--idle-unload 3600`
- Model route: `strata-iq3_xxs-gpu1.json`
- GPU assignment: RTX 3090 Ti only
- DSH was not restarted.
- ComfyUI was not restarted.
- GPU routing was not changed.

Reason:
The previous 30-minute policy repeatedly unloaded Qwen3.8 and caused expensive
cold reloads. Inspection showed the loaded model consumes substantial RAM and
VRAM, so a 60-minute timeout was selected instead of disabling idle unload or
extending it to several hours.

Rollback:
Restore the verified pre-change backup:
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/strata-engine-runner-pre-idle-3600-20261111-151009.tgz`

Backup SHA-256:
`f33565a0d0d2a86c9f901070f05b47401abca3f2d7687cc676cb6a2bc364ee6d`

Operational requirement:
Preserve `STRATA_IDLE_SECONDS=3600` behavior across Strata runner replacement,
update, reinstall, or migration unless the owner deliberately changes the policy.


## Verified Strata cold-load optimization — 2026-11-11

Status: VERIFIED / ACCEPTED

**Root cause of 244-second cold-load outlier:** THP (Transparent Huge Page)
compaction on the 39.97 GiB expert arena. When sufficient free 2 MiB blocks
existed (~44–45 GiB available), Strata set MADV_HUGEPAGE on the arena and the
kernel spent ~235 seconds compacting fragmented pages. The expert data read
itself takes only ~9 seconds (Samsung 990 PRO NVMe, ~4.40 GiB/s).

**Fix:** Added `export STRATA_RAM_KEEP_GIB="${STRATA_RAM_KEEP_GIB:-6}"` to the
runner script. This forces the mmap/FileExpertSource path on every load.
On this 64 GiB machine (~20 GiB base usage, ~44 GiB max available), the arena
threshold (39.97 + 6 = 45.97 GiB) is never met, so the arena path is
permanently bypassed. This also eliminates the 20-second RAM wait that preceded
each mmap fallback.

Verified live state:
- Service: `strata-engine.service`
- Runner: `/home/liongateos/.local/bin/strata-engine-runner`
- Effective env var in live process: `STRATA_RAM_KEEP_GIB=6`
- GPU assignment: RTX 3090 Ti only — unchanged.
- DSH was not restarted.
- ComfyUI was not restarted.
- Idle-unload policy (3600 s) preserved.

Expected load time after change: ~37–52 s (consistent, every load).
Previous load time: 38–244 s (unpredictable; THP compaction caused outliers).

Rollback:
Restore the verified pre-change backup:
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/strata-engine-runner-pre-ram-keep-gib-20261111-154942.tgz`

Backup SHA-256:
`270f12145ba80e93d0c28371b25f1472bd4383c114767246ed1b39c6aecc83d1`

Operational requirement:
Preserve `STRATA_RAM_KEEP_GIB=6` behavior across Strata runner replacement,
update, reinstall, or migration unless the owner deliberately changes the policy.
The `:- 6` default allows a hand-override via environment (e.g., `STRATA_RAM_KEEP_GIB=0`
to test arena behaviour manually) without requiring a runner edit.


## DSH performance closeout — 2026-11-11

Status: VERIFIED / CLOSED

All five performance fixes applied and verified in this session. Full audit
conducted after each fix. No additional bottleneck was identified. No change
was made. No service was restarted. GPU routing was not changed.

Verified steady-state metrics (from Strata engine log and billion-context log):

- Warm decode:              125–139 tok/s
- Speculative acceptance:   77–85% typical (--spec 4)
- Expert GPU cache hit:     90–96%
- Prompt cache reuse:       76–99%
- KV VRAM hit rate:         99%+
- DSH per-turn overhead:    7–27 ms (immaterial)
- Switchboard overhead:     <1 ms (immaterial, loopback)
- Decode file I/O:          0 MB on warm requests
- Decode stall time:        0 ms on warm requests

Conclusion: system is performing at or near hardware ceiling for warm requests
on single RTX 3090 Ti / 76 GiB IQ3_XXS. PERFORMANCE OPTIMIZATION SHOULD STOP HERE.

Full audit:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-performance-closeout-20261111.txt`


## Shadow-vs-canonical profile reconciliation — 2026-11-11

Status: VERIFIED / NO CHANGES MADE

A complete difference inventory was produced comparing:

- **Shadow**: `~/.dsh/profiles/web/cordis.patch.yml` and `package.json`
  (10059 B, legacy `~/.dsh/` DSH home, last modified 2026-11-09 15:10;
  NOT used by the live RC.5 service; maintained as WorkRunner environment)
- **Canonical**: `~/.dsh-rc5-staging-20261103T195538-0500/profiles/web/cordis.patch.yml`
  and `package.json`
  (63213 B, live RC.5 DSH home, last modified 2026-11-11 11:37)

All 23 classified differences:

- **CURRENT CANONICAL** (13 differences): OneProvider routes, strata-local
  switchboard routing (port 8090/auth header), enriched ollama model metadata,
  9 new ollama models, voice-dictation preset with 72 compaction policies,
  `agent-preset-registry.default: voice-dictation`, `agent-default-model:
  strata-local`, `session-title-llm: disabled: true`, `dsh-context`/`locale`
  configs, wallpaper-engine entries, active-sessions deployment config — all
  present in canonical, absent from shadow because shadow predates them.

- **HISTORICAL/SUPERSEDED** (2 differences): `qwen-local-both` provider
  (removed from canonical), Qwen3-Coder/Qwen3.5 removed from qwen-local
  (default moved to strata-local).

- **VERIFIED INTENT** (7 differences): Shadow intentionally keeps
  `@local/workrunner` bundle (WorkRunner environment); intentionally uses
  persistent customization copies for Local Model Manager, Model Guide &
  Cost Router; `@local/dsh-mcp-rea` uses staging vs persistent path; shadow
  lacks canonical-only bundles (billion-context, oneprovider-spend-guard, etc.).

- **FUNCTIONALLY EQUIVALENT** (1 difference): `@local/read-aloud` paths differ
  but both plugin directories have identical files (md5 confirmed).

- **UNVERIFIED / OWNER DECISION NEEDED** (1 difference): Shadow has
  `defaultReasoningEffort: xhigh` on Qwen3.8-27B models in qwen-local and
  qwen-local-3090 (consistent with model names "[Default = Extra High]"); canonical
  does not. The canonical was verified without it through the performance closeout.
  If owner wants xhigh preselected for these secondary models, four entries need
  the field added (2 providers × 2 models each). This is a UI behavior change only.

No change was made to any profile file, any service, any GPU, or the working tree.
The 2026-11-04 "Shadow profile reconciliation — VERIFIED" section referred to
correcting the canonical profile's `package.json` (what that section called the
"live shadow RC.5 profile"); the legacy `~/.dsh/` profile was not in scope then.

This closes the "Reconcile shadow-vs-canonical profile differences" item from
"Next safe work" (2026-11-09). Remaining bounded work from that section:

1. Investigate the persistent-package failure only if/when persistence work is
   resumed; preserve the current working RC.5 package links meanwhile.
2. Qwen3.8 xhigh default question (see UNVERIFIED item above) — owner decision only.

Detailed report:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-shadow-canonical-profile-reconciliation-20261111.txt`


## Agent Teams hold lifted — 2026-11-11

**Status:** HOLD LIFTED / IMPLEMENTATION VERIFIED

The owner lifted the DSH-native Agent Teams / swarm orchestration hold in
this session. The bounded implementation track is active.

WorkRunner, ComfyUI, GPU routing, Strata configuration, and Qwen3.8
`defaultReasoningEffort xhigh` were not touched and remain in their
documented states.

### Existing 7-file Model Bridge — VERIFIED 2026-11-11

A prior Agent Teams session implemented the Model Bridge in 7 files,
left uncommitted on HEAD. All 7 files are confirmed in the working tree
with ` M` (modified, not staged) status and pass current tests and build.

**Files:**

- `packages/experimental/agent-team/src/types.ts` —
  `TeammateAgentOptions` interface (provider/model/reasoningEffort/maxTokens)
  and `agentOptions?` on `SpawnTeammateRequest`.
- `packages/experimental/agent-team/src/roster.ts` —
  passes `agentOptions` to `startActivation()` when present.
- `packages/experimental/tool-agent-team/src/index.ts` —
  `resolveTeammateAgentOptions()` helper with allowlist gate, fork guard,
  and LLM preflight; 3 new tool parameters on `spawn_teammate`.
- `packages/experimental/tool-agent-team/package.json` — peer/dev deps.
- `packages/experimental/tool-agent-team/tsconfig.json` — project refs.
- `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` —
  14 new model-selection tests including `single-model multi-agent` suite.
- `packages/api/session-controller/tests/session-presets.host.spec.ts` —
  `agentOptions?` on `HarnessOptions` test interface.

**Test result:** 49/49 passed.

**Build result:** `build:artifacts` 7/7 passed. `build:check` has 3
pre-existing errors in `agent-preset-registry/tests/session-init.spec.ts`
that existed before this work and are not caused by Agent Teams.

### Covered seams

All identified seams are addressed in code:

- AgentOptions/model-selection propagation through roster and tool layer.
- Allowlist gate and disabled-selection guard.
- Fork context inheritance (route changes rejected; effort-only accepted).
- LLM preflight validation of new routes and effort levels.
- Lead/teammate model identity visible in roster list.
- Single-model multi-agent: multiple Sessions using the same provider
  route share one model server; the Agent Teams layer does not spawn servers.

### Missing seam — profile registration only

No code gap exists. The only remaining step before a live proof is adding
`tool-agent-team` and `SubagentModelSelectionConfig` to a DSH preset in
the RC.5 patch file and restarting DSH. That requires owner approval.

### Next bounded proof procedure

Integration-level proof already exists in:
`packages/experimental/tool-agent-team/tests/tool-team.spec.ts`
describe block `'single-model multi-agent'`.

Live proof (requires owner approval and DSH restart):

1. Add to the headless or voice-dictation preset in the RC.5 patch file:
   - `@deepseek-ai/dsh-experimental-tool-agent-team`
   - `@deepseek-ai/dsh-tool-subagent/src/model-selection-settings.ts`
     with `enabled: true` and `allowedModels` covering the desired
     strata-local routes.
2. Verify YAML: `dsh --dump-config | grep tool-agent-team`.
3. Restart `deepseek-harness-web.service` (owner approval required).
4. Run one headless session: Lead spawns three named teammates, all on
   the same strata-local route, each with an independent initial prompt.
5. Verify: 4 distinct session ids, all provider `strata-local`, single
   `strata-engine.service` process, no paid inference route activated.

### Backup

Pre-edit backup:
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/agent-teams-swarm-resume-pre-20261111.tgz`

SHA-256:
`deede40510f5b064a450c9ad6533f21739fc85c5b5e15e7aef9285daa2cab22f`

Full report:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-swarm-resume-20261111.txt`

## Agent Teams live swarm proof — VERIFIED 2026-11-11

**Status:** LIVE PROOF COMPLETE — 1 Lead + 3 teammates (4 logical agents), all on strata-local

### Profile registration

Two changes applied to the canonical RC.5 web profile patch:
`~/.dsh-rc5-staging-20261103T195538-0500/profiles/web/cordis.patch.yml`

- **Host scope:** New `- insert:` block added agent-team service
  (`@deepseek-ai/dsh-experimental-agent-team`) at host scope, before the
  voice-dictation preset block.
- **Voice-dictation preset:** `tool-agent-team` plugin
  (`@deepseek-ai/dsh-experimental-tool-agent-team`) added to the preset's
  plugin list, before the `voice-dictation` local plugin.
- `SubagentModelSelectionConfig` override not needed: service is already in
  host scope via base `cordis.yml`; teammates inherit parent route without
  explicit model selection enabled.

Config validated: `DSH_HOME=... pnpm dsh --profile web --dump-config` returned
both `agent-team` and `tool-agent-team` with zero new errors (pre-existing
`wallpaper-engine` and `agent-presets` not-found warnings unchanged).

### DSH restart

`deepseek-harness-web.service` restarted at 2026-11-11.
Post-restart verification:
- DSH port 3180: active (new PID after restart)
- Strata switchboard port 8090: unchanged (same PID)
- Strata engine port 8080: unchanged (same PID)
- `strata-engine.service`: active

### Bounded live proof (intermediate — 1+2, honest record)

**Command:** `pnpm dsh --profile headless --patch /tmp/agent-teams-proof-overlay.yml "..."`

**Task:** Lead spawned two teammates (analyst, reviewer) on
`strata-local / qwen3.8-flash-next-iq3_xxs`.

**Result:** `list_agents` returned 3 entries (lead + analyst + reviewer).
This was 1 Lead + 2 teammates, not the authorized target of 1+3. Recorded
as an intermediate run; the definitive 1+3 proof follows.

### Bounded live proof — DEFINITIVE (1 Lead + 3 teammates = 4 logical agents)

**Command:** `pnpm dsh --profile headless --patch /tmp/agent-teams-proof-overlay.yml "..."`

**Task:** Lead coordinator spawned three teammates with distinct roles on
`strata-local / qwen3.8-flash-next-iq3_xxs`, waited for all three,
called `list_agents`, then synthesized all three responses.

**Teammate roles and responses:**
- `requirements-analyst`: "A good API is predictable: its behavior, naming,
  and error reporting match what users expect from the problem domain, so they
  can use it correctly without consulting documentation or discovering surprises
  at runtime."
- `implementation-reviewer`: "A good API states its obligations explicitly at
  the call site — typed inputs and outputs, preconditions, error cases, ownership
  and cleanup, and completion semantics — so an implementer can satisfy the
  contract correctly by reading the declaration alone, without reverse-engineering
  the implementation or depending on undocumented behavior."
- `verification-reviewer`: "A good API is deterministic and observable: the same
  inputs produce the same, fully inspectable outputs and typed, structured
  failures, so tests can assert exact behavior and regressions surface immediately
  rather than silently."

**Result:**
- `spawn_teammate` invoked three times: all three spawned successfully. ✅
- `wait_agent` × 3 called; all three responses received. ✅
- `list_agents` returned **4 entries**: lead (running), requirements-analyst
  (inactive), implementation-reviewer (inactive), verification-reviewer
  (inactive). ✅
- Lead synthesized all three responses into one paragraph. ✅

### GPU routing verification (post-definitive-proof)

- GPU 0 (RTX 3090): ComfyUI python process, 378 MiB — same PID 1392581, untouched.
- GPU 1 (RTX 3090 Ti): Single Strata engine, 22366 MiB, PID 1442896 — single
  process throughout. No second model server was spawned. All 4 agent sessions
  (lead + 3 teammates) shared one Strata instance.
- WorkRunner: not touched.

### Backup

Pre-edit backup (cordis.patch.yml + PROJECT_STATE.md):
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/agent-teams-live-proof-pre-20261111T192913.tgz`

SHA-256:
`525a7527f0cf8f15e69cdb5671c83cdae89d5eb11f0b5805bc9fec306bd9d282`

Intermediate run report (1+2):
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-live-swarm-proof-20261111.txt`

Definitive 1+3 proof report:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-live-swarm-proof-1plus3-20261111.txt`

## Agent Teams full Web bundle activation — 2026-11-11

**Status:** COMPLETE — full bundle active, Web UI registered

### What was done

The canonical bundle `@deepseek-ai/dsh-experimental-agent-team-profile` was
activated in the live RC.5 Web profile. Prior manual partial registrations
(`agent-team` with no config, `tool-agent-team` inside voice-dictation preset
with no config) were removed to avoid duplicate registrations. The bundle's
`cordis.patch.yml` replaces them with the complete, properly configured set.

**Files changed:**
- `~/.dsh-rc5-staging-20261103T195538-0500/profiles/web/package.json` —
  added `@deepseek-ai/dsh-experimental-agent-team-profile` to `bundles` array.
- `~/.dsh-rc5-staging-20261103T195538-0500/profiles/web/cordis.patch.yml` —
  removed manual `agent-team` host-scope insert block; removed manual
  `tool-agent-team` from inside voice-dictation preset plugin list.

### Effective Agent Teams components (from bundle)

- `agent-team` — service (maxMembers: 8, maxTasks: 256, maxMessageBytes: 65536,
  disposalTimeoutMs: 5000)
- `tool-agent-team` — tools plugin (freshProvider: spawn, forkProvider: fork)
- `ui-agent-team` — Web UI client (`@deepseek-ai/dsh-experimental-client-ui-agent-team`)

Host-scope `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent`,
and `tool-subagent-fork` are now disabled (replaced by Agent Teams tools). The
voice-dictation preset's isolated delegation group is unaffected.

### Config validation

`DSH_HOME=... pnpm dsh --profile web --dump-config` returned all 3 Agent Teams
components attributed to `@deepseek-ai/dsh-experimental-agent-team-profile`.
Zero new warnings. Same pre-existing wallpaper-engine and agent-presets warnings.

### DSH restart

`deepseek-harness-web.service` restarted at 2026-11-11.
Post-restart verification:
- Port 3180 (DSH): active, new PID 1469353 ✅
- Port 8080 (Strata): active, same PID 1341153 ✅
- Port 8090 (switchboard): active, same PID 1315941 ✅
- Port 8189 (ComfyUI): active, same PID 1392581 ✅
- GPU 0 (RTX 3090): ComfyUI, 8378 MiB — untouched ✅
- GPU 1 (RTX 3090 Ti): Strata engine, 22366 MiB — untouched ✅
- WorkRunner: not touched.

### Backend 1+3 proof

The verified 1 Lead + 3 teammate swarm proof from earlier in this session
remains valid. The bundle provides the same `agent-team` and `tool-agent-team`
as the prior manual registrations, with correct configuration.

### Browser refresh required

A hard browser refresh (Ctrl+Shift+R) is required in any existing open tab to
load the new client bundle assets including the `ui-agent-team` Web UI
component. New tabs opened after the restart will load the updated assets
automatically.

### Backup

Pre-activation backup (cordis.patch.yml + package.json + PROJECT_STATE.md):
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/agent-teams-full-bundle-pre-20261111T210258.tgz`

SHA-256:
`cacdae093410630a969c01ec9ae252ae9e962e6fb59b0914c7b84d1babb492d1`

Report:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-full-web-bundle-activation-20261111.txt`

## Rotating specialist swarm — architecture discovery — 2026-11-11

**Status:** DISCOVERY COMPLETE — READ-ONLY. Zero files modified, zero services
restarted, zero GPU usage.

### Findings summary

All seams required for a rotating specialist swarm exist within the current
Agent Teams + subagent stack. No separate runtime is needed.

**Reusable as-is:** `TeamJournal`, `TeamRoster`, `TeamTaskBoard`,
`TeamActivity`, `TeamRuntimeLifecycle`, projection pipeline, Model Bridge
(`resolveTeammateAgentOptions`).

**Gap — queue:** `ActivationPool.reserve()` throws `ACTIVATION_LIMIT_REACHED`
immediately when at capacity. No queuing exists. `TeamActivity.wait()` and
`notify()` are the right primitive for a queue signal bus.

**Gap — per-team concurrency limit:** `maxActiveSubagents` (default 8) is a
global system limit shared by all subagent types. A new
`Config.maxActiveSpecialists` (per-team, narrower) is needed to enforce the
specialist concurrency budget independently.

**Already supported:** mixed-model routing via Model Bridge `TeammateAgentOptions`
(provider + model per specialist). Per-route limits are deferred — not needed for
vertical slice.

**UI projection:** adding `'queued'` phase requires a session format bump.
MVP uses in-memory queue only (invisible to UI, no format bump).

### First vertical slice (5 files)

8 static specialists in catalog, Lead selects 6, max active concurrency = 2.
No session format bump. No new packages.

| File | Change |
|------|--------|
| `packages/experimental/agent-team/src/types.ts` | `SpecialistDefinition`, `Config.specialists`, `Config.maxActiveSpecialists` |
| `packages/experimental/agent-team/src/specialist-queue.ts` | NEW — `SpecialistQueue` using `Deque` + `TeamActivity` |
| `packages/experimental/agent-team/src/index.ts` | `startSpecialist()` method, `subagent/end` listener |
| `packages/experimental/tool-agent-team/src/index.ts` | `list_specialists` + `spawn_specialist` tools |
| `packages/experimental/agent-team-profile/cordis.patch.yml` | Add `specialists[]` and `maxActiveSpecialists` to config |

### Key architectural fact

`ActivationPool` (subagent package) is the global concurrency gate. It lives in
`SubagentManager`, is shared per root-Agent across all descendants, and uses
`pool.reserve(maxActiveSubagents())` with an immediate throw on overflow (no retry
or queue). The `SpecialistQueue` must guard BEFORE this gate with its own narrower
per-team slot counter.

### Discovery report

`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-rotating-specialist-swarm-architecture-discovery-20261111.txt`

---

## Rotating Specialist Swarm — Vertical Slice 1 COMPLETE (2026-11-11)

**Status:** IMPLEMENTED AND TESTED. No GPU, no inference, no service restart, no commit.

**Files created/modified (this session):**

| File | Change |
|------|--------|
| `packages/experimental/agent-team/src/types.ts` | Added `SpecialistDefinition`, `StartSpecialistRequest`, `StartSpecialistResult`; extended `Config` |
| `packages/experimental/agent-team/src/specialist-queue.ts` | NEW — `SpecialistQueue` FIFO queue with per-team slot accounting |
| `packages/experimental/agent-team/src/index.ts` | `SpecialistQueue` wired; `startSpecialist()` public method; `specialists` getter; `agent/disposed` listener |
| `packages/experimental/tool-agent-team/src/index.ts` | `list_specialists` + `spawn_specialist` tools added |
| `packages/experimental/agent-team-profile/cordis.patch.yml` | 8 seed specialist definitions + `maxActiveSpecialists: 2` |
| `packages/experimental/agent-team/tests/specialist-queue.spec.ts` | NEW — 9 unit tests for SpecialistQueue |
| `packages/experimental/tool-agent-team/tests/specialist-tools.spec.ts` | NEW — 10 integration tests including 8/6/2 scheduling proof |

**Test results:** 142/142 tests pass (6 test files). Zero regressions.

**Scheduling proof verified:** 8 specialists in catalog, 6 selected, maxActive=2 → exactly 2 active, 4 queued. Slot release promotes front queued entry. Active count never exceeds 2.

**Key design decisions:**
- `SpecialistQueue` guards per-team slot counter BEFORE `ActivationPool` (global gate)
- FIFO array queue with `cancelled` flag — `shift()` for O(1)-for-small-N promotion
- `spawn_specialist` returns `{ status: 'active', member }` or `{ status: 'queued', name, pending }` immediately
- Queued specialists execute asynchronously via `agent/disposed` → `onSpecialistSettled()` → `promoteNext()`
- No session format bump; no new packages; no live profile change

**Backup:** `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/dsh-specialist-swarm-vslice1-pre-20261111T214543`

**Vertical slice report:** `/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-rotating-specialist-swarm-vslice1-20261111.txt`


## Rotating Specialist Swarm — Vertical Slice 2 COMPLETE (2026-11-12)

**Status:** IMPLEMENTED AND TESTED. No GPU, no inference, no service restart, no commit.

**Three bounded extensions delivered:**

1. **Specialist queue/lifecycle visibility** — 4 new `team/specialist/*` session events; `agentTeamSpecialists` projection (stateVersion 1); phase surfaced to browser UI
2. **Per-route concurrency limits** — `routeLimits: RouteLimit[]` in Config; enforced in `SpecialistQueue` alongside `maxActiveSpecialists`
3. **Lead-visible queue and result state** — `list_specialist_status` tool; Lead observes queued/working/finished phases

**Files created/modified (this session):**

| File | Change |
|------|--------|
| `packages/experimental/agent-team/src/types.ts` | Added `RouteLimit`, `SpecialistPhase`, `SpecialistQueueView`, `SpecialistStatusSnapshot`; extended `SessionEventMap` with 4 `team/specialist/*` events |
| `packages/experimental/agent-team/src/specialist-projection.ts` | NEW — `agentTeamSpecialists` `ProjectionDefinition` (stateVersion 1) |
| `packages/experimental/agent-team/src/specialist-queue.ts` | Added `SpecialistQueueCallbacks`; `routeLimits` enforcement; `sessionToProvider`/`sessionToName`/`teamToRoot` maps; `routeActive` per-slot counter; `promoteNext` skips route-blocked entries |
| `packages/experimental/agent-team/src/journal.ts` | `AppendTeamEvent` widened to `keyof SessionEventMap`; `MutableTeamEventType` extended with 4 specialist event types |
| `packages/experimental/agent-team/src/index.ts` | Registers `specialistQueueProjectionDefinition`; passes `routeLimits` + 4 teardown-safe callbacks to `SpecialistQueue`; adds `listSpecialistStatus(agent)` service method; `routeLimits` Config field |
| `packages/experimental/agent-team/src/client.ts` | Exports `SpecialistPhase`, `SpecialistQueueView`, `SpecialistStatusSnapshot` |
| `packages/experimental/tool-agent-team/src/index.ts` | `list_specialist_status` tool; `SPECIALIST_STATUS_VALUE_SCHEMA`; `AllowedModelRoute` type annotation fix |
| `packages/experimental/client-ui-agent-team/src/client/locales.ts` | Added `specialists`, 4 `specialistPhase.*` keys to zh/en |
| `packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx` | Specialist queue section in panel; `specialistPhaseKey`/`specialistDotState` helpers; `activeSpecialists` filter; `compact` updated |
| `packages/experimental/agent-team/tests/specialist-projection.spec.ts` | NEW — 20 unit tests for `agentTeamSpecialists` projection |
| `packages/experimental/agent-team/tests/specialist-queue.spec.ts` | +10 tests: 5 per-route concurrency, 5 lifecycle callbacks |
| `packages/experimental/tool-agent-team/tests/specialist-tools.spec.ts` | +3 tests: `list_specialist_status` empty/all-phases/position-omission |
| `tsconfig.base.json` | Added `@deepseek-ai/dsh-tool-subagent/src/*` path alias |

**Test results:** 203/203 tests pass (10 test files). Zero regressions (pre-existing 13 unrelated failures unchanged).

**Typecheck:** `agent-team` and `tool-agent-team` clean. `client-ui-agent-team/mount.ts` has 2 pre-existing VS1 errors; VS2 files (`TeamAction.tsx`, `locales.ts`) are clean.

**Live proof (exit code 0):** 8-specialist catalog, 6 spawned, maxActive=2 → 2 active + 4 queued scheduling verified; `list_specialist_status` returned phase/position data; queued→working auto-promotion observed across waves. Teardown `SessionHandleClosedError` fixed with `.catch(() => undefined)` on all 4 specialist lifecycle callbacks.

**Key design decisions:**
- `agentTeamSpecialists` stateVersion: 1; old projections safely ignore new events via type guards
- `exactOptionalPropertyTypes: true` requires omitting `position` entirely (not `position: undefined`) for `promoted`/`cancelled` entries
- Teardown pattern: `.catch(() => undefined)` on fire-and-forget `appendAndFlush` calls, following `roster.ts` precedent
- `promoteNext` iterates (not shifts) to skip route-blocked entries without removing them from queue

**Vertical slice report:** `/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-rotating-specialist-swarm-vslice2-20261112.txt`


## Agent Teams — Vertical Slice 3A: Specialist Task Handoff — VERIFIED (2026-11-12)

**Status:** VS3A — SPECIALIST TASK HANDOFF = VERIFIED. Implementation complete, 180/180 bounded Agent Teams tests pass, bounded typecheck clean. No GPU, no inference, no real specialist call, no service restart, no commit.

**Defect closed (structural, not prompt tuning):**

`spawn_specialist` accepted only `{ name }`. The Team service built the specialist's entire initial prompt from the static catalog role (`prompt: [{ type: 'text', text: def.prompt }]`) and started the child with `context: 'fresh'`, so a specialist received its role contract and **no work at all** — no paths, no goal, no acceptance criteria. A Lead calling the tool therefore got a role-primed agent with nothing to do. This is the documented root cause A of the VS3 architecture report.

**Old input contract:** `StartSpecialistRequest { name, provider, signal }`; tool parameters `{ name: string }`.

**New input contract:** `StartSpecialistRequest { name, task?, provider, signal }`; tool parameters `{ name: string, task: string }` (both required at the tool surface).

**Role and task composition:** the catalog `prompt` is emitted as its own leading content block, byte-identical to the catalog entry. The assignment follows as a **separate** subordinate block prefixed `Your assigned task (from the Team Lead):` and closed with an explicit statement that the assignment defines the work but does not extend permission scope or replace the role. Omission of `task` reproduces the previous behaviour exactly (role block alone), so the change is additive and does not alter `spawn_teammate`.

**Files changed:**

| File | Change |
|------|--------|
| `packages/experimental/agent-team/src/types.ts` | `StartSpecialistRequest.task?: string`; `SpecialistDefinition.prompt` JSDoc corrected from "Initial task prompt" to a durable role contract never replaced by an assignment |
| `packages/experimental/agent-team/src/validation.ts` | NEW `assignedTask(value)`: trims, rejects blank with `TEAM_INVALID_ARGUMENT`, otherwise unbounded (mirrors `spawn_teammate`, which imposes no prompt length limit) |
| `packages/experimental/agent-team/src/index.ts` | NEW `specialistPrompt(def, task)` composing role block then assignment block; `startSpecialist` normalizes `req.task` and passes the composed blocks |
| `packages/experimental/tool-agent-team/src/index.ts` | `spawn_specialist` gains required `task` parameter; description now states `name` selects the role and `task` is the concrete work, with guidance on supplying enough context to act |
| `packages/experimental/agent-team/tests/team.spec.ts` | +5 domain tests (`specialist task handoff` describe block) |
| `packages/experimental/tool-agent-team/tests/specialist-tools.spec.ts` | +3 tool tests; 8 existing calls updated for the now-required `task` |
| `packages/experimental/agent-team/README.md` / `.zh.md` | Specialist catalog config rows (`specialists`, `maxActiveSpecialists`, `routeLimits`) and a `Specialists` section |
| `packages/experimental/tool-agent-team/README.md` / `.zh.md` | Corrected stale "nine tools" claims to twelve; new `Run catalog specialists` capability paragraph |
| `packages/experimental/agent-team/README.i18n.yaml`, `packages/experimental/tool-agent-team/README.i18n.yaml` | Re-recorded confirmed section hashes with `verify-translation-pairing --write` |

**Regression tests added (all seven required proofs):**

1. Role **and** assignment both reach the child model request — `sends both the catalog role and the assigned task to the child`
2. The child receives the unmodified static role contract — asserted byte-identical against the catalog entry
3. The child receives the exact assignment text
4. Different tasks produce different assignments under the same role — two Teams, `keeps the same role while assignments differ across two starts`
5. FIFO queueing, concurrency, and lifecycle unchanged — `preserves FIFO queueing and promotion for task-bearing specialists` plus the existing `specialist scheduling proof: 8 catalog / 6 selected / maxActive=2`
6. Missing or invalid task fails appropriately — schema-required `task` at the tool layer (`requires a task argument`), blank rejected with `TEAM_INVALID_ARGUMENT` at the domain layer
7. Task text cannot replace or remove the durable role through string composition — `keeps the role block authoritative when the assignment imitates a role override` asserts the role block precedes the assignment and remains byte-identical

**Test results:** `DSH_LOCAL_TEST_CONCURRENCY=2` → 8 files, **180/180 pass** (`agent-team` 49+26+18+17+4, `tool-agent-team` 49+16, `agent-team-profile` 1). Zero regressions. `doc-quick`: 19 passed, 2 failed — both are pre-existing and environmental, unrelated to this work: `verify-translation-pairing` reports untracked owner/reports/local-plugins/rea README pairs outside `packages/`, and `verify-repository-references` reports commit-hash style in pre-existing `owner/`-tracked files. My two pairs verify clean in isolation.

**Typecheck:** `tsc -b` on both changed package projects exits 0. Bounded test-file typecheck reports no error in any changed file (the synthetic cross-project program surfaces only `vendor/` noise from compiling under a different project shape).

**Backup (verified before editing):** `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/pre-vs3a-specialist-task-handoff-20261112T151552-0500.tgz` — 18,659 bytes, 4 files, `tar -tzf` readable, `sha256sum -c` OK, SHA-256 `413a38258760519060dcddf21070efb6961959b2db62985713c0ab1ba2dd63a5`.

**Deliberately NOT in this slice (deferred):**
- OFF/AUTO/ON orchestration modes — **PLANNED**, not started
- Per-specialist provider/model/LLM-route selection (cloud models) — **PLANNED**. The seam already exists (`agentOptions` + `resolveTeammateAgentOptions` + `spawn` backend capability), and is wired only to `spawn_teammate`; `startSpecialist` still forwards no `agentOptions`.
- Automatic delegation guidance in `teamPolicy` — **PLANNED** (VS3B), intentionally omitted here to keep the tool description free of trigger language

**Vertical slice report:** `/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-vs3a-task-handoff-20261112.txt`


## Agent Teams — Gate #4: Teammate Model-Selection Enforcement — VERIFIED (2026-11-12)

**Status:** GATE #4 — TEAMMATE MODEL-SELECTION ENFORCEMENT = COMPLETE-VERIFIED. Local checkpoint `.owner-backups/gate4-agent-team-model-selection-20261112T162827-0500/` captured, all 19 recorded SHA-256 values re-verified against the live worktree and the checkpoint artifacts, canonical copy now retained on SanDisk. No GPU, no inference, no real model call, no service restart, no commit.

**Defect closed:** session model-selection policy was enforced only in the tool layer, so a programmatic `SpawnTeammateRequest.agentOptions` reaching the Agent Teams domain API directly could name a route the Session does not allow. The guard now runs before any durable or activation evidence is created, so a rejected spawn leaves neither a `team/member` entry nor a child Agent.

**Verified files:**

| File | Role |
|------|------|
| `packages/experimental/agent-team/src/model-selection.ts` | NEW `assertTeammateModelSelection` applying the session policy to direct domain callers |
| `packages/experimental/agent-team/src/roster.ts` | Guard wiring ahead of durable membership and child activation |
| `packages/experimental/agent-team/tests/model-selection.spec.ts` | NEW focused enforcement tests |

**Proof:** guard runs before durable `team/member` creation; guard runs before child activation; unauthorized route change rejected; same Lead route allowed; fork plus explicit route rejected; rejected spawn creates no durable member; rejected spawn creates no child. Focused spec 11/11 PASS, `agent-team` 126/126 PASS, `tool-agent-team` + `tool-subagent` 233/233 PASS, `tsc -b` exit 0, `model-selection.ts` per-file coverage 100% statements/branches/functions/lines.

**Non-overlap with VS3A:** Gate #4 changes route authorization on the teammate path; VS3A changes the specialist assignment contract. Neither touches the other's files. The checkpoint's own dependency-set note records that the `agent-team` files are mixed-hunk with owner specialist work, which is why the checkpoint captures the full dependency set rather than an isolated patch.

**Canonical backup:** `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/gate4-agent-team-model-selection-20261112T162827-0500/` — copied 2026-11-12T16:59-0500 after the drive returned to `rw`; `diff -r` against the local checkpoint reports the trees identical, `tar -tzf` on the payload is readable (16 members), and all five checkpoint-local SHA-256 entries verify OK. The earlier capture-time `canonical_location_pending` note in `HEAD.txt` is retained as the historical record of the read-only mount condition.


## Agent Teams — VS3B: Delegation Policy Guidance — VERIFIED (2026-11-12)

**Status:** VS3B — DELEGATION POLICY GUIDANCE = VERIFIED. Policy guidance only; no orchestration mode state, no cloud routing, no tiers. 199/199 bounded Agent Teams tests pass, bounded typecheck clean for every changed line. No GPU, no inference, no real model call, no service restart, no commit.

**Root cause addressed:** `teamPolicy()` in `packages/experimental/tool-agent-team/src/index.ts` was the Lead's only delegation guidance and contained no mention of specialists at all, so a Lead holding twelve Team tools had no stated reason to prefer a specialist, no stated reason to avoid one, and no statement of what a specialist assignment may not do. VS3A gave specialists real work; this slice gives the Lead criteria for using them.

**Seam:** the existing `team:policy` system-prompt section registered with `getSectionOrder('TEAM_POLICY')`. No new package, no new prompt framework, no core prompt-order change.

**New policy behavior:** the section now states that specialists are optional tools rather than a required step; names the work that justifies delegation (independent verification, architecture or design review, security or safety audit, implementation and review separation, research and synthesis separation, parallel independent investigation); names the work that does not (trivial or single-step tasks, description cost exceeding execution cost, duplicate assignments, context that cannot be stated completely); keeps decomposition, specialist choice, result interpretation, conflict reconciliation, and final synthesis with the Lead; requires a concrete assignment with paths, acceptance criteria, and write scope; states that `task` selects work without widening a specialist's role, permissions, or route; defers scheduling and route limits to the existing concurrency cap, FIFO queue, and session model-selection policy; and rules out nested delegation and duplicate specialists on one assignment.

**Explicitly unchanged:** the twelve tool schemas, the VS3A `spawn_specialist` `name`/`task` contract, the Gate #4 model-selection guard, and the teammate-facing identity context. The policy text is shared by Lead and teammates, so teammates read the same criteria while remaining unable to start specialists.

**Files changed:**

| File | Change |
|------|--------|
| `packages/experimental/tool-agent-team/src/index.ts` | `teamPolicy()` gains two delegation-guidance paragraphs; no schema or tool change |
| `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` | +8 focused `delegation policy guidance` tests |
| `packages/experimental/tool-agent-team/README.md` / `.zh.md` | Policy-and-tools and Model-Experience sections describe the delegation guidance |
| `packages/experimental/tool-agent-team/README.i18n.yaml` | Re-recorded confirmed section hashes with `verify-translation-pairing --write` |

**Test results:** `DSH_LOCAL_TEST_CONCURRENCY=2` → 9 files, **199/199 pass** (`agent-team` 49+26+18+17+11+4, `tool-agent-team` 57+16, `agent-team-profile` 1). The 8 new tests assert the presence of each semantic obligation rather than exact prose, so wording edits do not silently drop a requirement. `verify-translation-pairing` for this pair reports `1 named pair(s) consistent`, exit 0.

**Typecheck:** `tsc -b` on the changed package project exits 0. Bounded test-file check reports no error on any line this slice added; the one remaining `tool-agent-team` error (`test-compaction` source kind, `tool-team.spec.ts:431`) is byte-identical in the pre-VS3B backup and therefore pre-existing, and the residual `vendor/` output is the known artifact of compiling that tree under a different project shape.

**Backup (verified before editing):** `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/pre-vs3b-delegation-policy-20261112T165956-0500.tgz` — 20,704 bytes, 2 files, `tar -tzf` readable, SHA-256 self-check OK, SHA-256 `b8adb5a5403fe034f783bd1a810f3233a6251a113632d822354a9671a76e9c60`.

**Deliberately NOT in this slice (still PLANNED):**
- Durable OFF/AUTO/ON orchestration mode — **PLANNED**. VS3B is prompt guidance, not mode state; no mode projection, no mode event, no mode selector exists.
- Per-specialist cloud/local LLM routing — **PLANNED**. The seam remains `agentOptions` + `resolveTeammateAgentOptions` + the `spawn` backend `agentOptions` capability; `startSpecialist` still forwards no `agentOptions`.
- Specialist tier/routing policy — **PLANNED**.

**Report:** `/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-vs3b-delegation-policy-20261112.txt`

## Agent Teams — VS3C: Durable OFF/AUTO/ON Orchestration Mode — VERIFIED (2026-11-12)

**Status:** VS3C — DURABLE ORCHESTRATION MODE = VERIFIED. Owner-controlled OFF/AUTO/ON delegation preference, durable per session, rendered through the existing `team:policy` section. 220/220 bounded Agent Teams tests pass (21 new), bounded typecheck clean for every changed line. No GPU, no inference, no real model call, no service restart, no commit.

**Root cause addressed:** VS3B gave the Lead criteria for delegation, but the criteria could not be steered by the owner. Every session rendered the same guidance, so an owner who wanted the Lead to stop delegating, or to delegate far more readily, had no durable control short of editing a project prompt or a deployment config. The Lead also had no way to state its current delegation posture, because no such state existed.

**Mode implementation seam:** the session-projection mechanism already used by `plan-mode`, applied inside `packages/experimental/tool-agent-team` (no new package, no new orchestration runtime, no core edit). Durable state is a **plugin record** — `plugin:tool-agent-team/orchestration-mode` under the `PluginRecordMap` augmentation — not a `SessionEventMap` event. That choice is deliberate: the generated persistence artifacts were already stale at baseline because the four VS2 `team/specialist/*` events were never catalogued, so regenerating them for a VS3C event would have silently absorbed unrelated VS2 persistence work and force a `packages/core/session` change outside this slice. A plugin record keeps the generated update to a single catalog row and is explicitly permitted for `packages/experimental/` callers by `scripts/verify-plugin-record-callers.ts`.

**Default mode:** `auto`. Absence of a record IS `auto`, so a session that never ran the command folds to the default without logging a selection — no bootstrap write, no migration, and no ambiguity between "never set" and "set to auto".

**Control command:** `/orchestrate off|auto|on|status`, plus a bare `/orchestrate` that reports status. Registered through `ctx.inject(['commands'], ...)`, so a composition without the commands service still gets durable state and correct policy, and only loses the command. Only the Team Lead may set the mode; a teammate's attempt is refused.

**Durable event:** `plugin:tool-agent-team/orchestration-mode` → `{ mode: OrchestrationMode }`, appended once per real change. Selecting the mode already in force reports `already <mode>` and appends nothing. A non-Team session is told the mode applies to an Agent Team only.

**Projection:** `toolAgentTeamOrchestrationMode`, `stateVersion: 1`, `stateSchema` = `zod.enum(['off','auto','on'])`, `init` = `auto`, `apply` reads only this plugin record. It folds from the Lead's log, so every Team member reads one authoritative value.

**Mode semantics as rendered in the policy:**
- **OFF** — automatic specialist delegation is disabled; the Lead works directly unless the owner explicitly asks; every specialist tool stays mounted for explicit manual use.
- **AUTO** — the default; the Lead evaluates whether a specialist provides meaningful expected benefit under the VS3B criteria and prefers the smallest useful team; simple factual questions, tiny edits, and single-step work stay with the Lead.
- **ON** — the Lead strongly prefers a specialist for non-trivial work whenever a listed role fits, states which role and why, but ON is explicitly not permission to spawn as many agents as possible; trivial work may still stay direct and every existing limit applies.

**Policy section reused:** the existing `team:policy` section (`getSectionOrder('TEAM_POLICY')`, order 600), now a `text: () => string` function instead of a static string. The VS3B paragraphs are unchanged and rendered in every mode; only the mode paragraph varies, so the guidance is composed once rather than triplicated.

**Authority boundary stated in every mode:** the mode changes delegation preference only. It cannot widen filesystem permissions, model-selection permission, paid or cloud routes, concurrency limits, specialist role contracts, or session and tool permissions, and it never authorizes recursive delegation. Tests prove the model-selection policy object is unchanged across a mode change, that Gate #4 still rejects an unlisted route while ON, that the tool catalog is identical across modes, that a teammate still cannot start a specialist or set the mode, and that the VS3A `spawn_specialist` `{name, task}` contract is untouched.

**Per-turn spawn cap:** deliberately NOT added. Existing protections already bound a turn: `SpecialistQueue.startOrQueue` enforces `maxActiveSpecialists` and per-route limits and queues excess FIFO; a duplicate specialist name is rejected by the roster; `maxMembers` bounds durable membership; only the Lead can start a specialist. A mode changes prompt preference, not those limits, so a new cap would duplicate enforcement without closing a reachable hole. Recorded as deferred rather than invented.

**Files changed:**

| File | Change |
|------|--------|
| `packages/experimental/tool-agent-team/src/orchestration-mode.ts` | NEW — mode vocabulary, plugin-record declaration, projection definition, read/write helpers, parser |
| `packages/experimental/tool-agent-team/src/index.ts` | Mode-aware `teamPolicy()`, dynamic `team:policy` text, projection registration, `/orchestrate` command |
| `packages/experimental/tool-agent-team/tests/orchestration-mode.spec.ts` | NEW — 21 tests (state, policy, authority boundaries) |
| `packages/experimental/tool-agent-team/package.json` / `tsconfig.json` / `pnpm-lock.yaml` | `zod` dependency, optional `dsh-commands` peer, commands project reference |
| `packages/experimental/tool-agent-team/README.md` / `.zh.md` / `.i18n.yaml` | Orchestration-mode usage section, mode policy in Model Experience, re-recorded pairing manifest |
| `docs/experimental-persistence-catalog.md` / `.zh.md` / `.i18n.yaml` | Generated: one new plugin-record row |

**Test results:** `DSH_LOCAL_TEST_CONCURRENCY=2` → 10 files, **220/220 pass** (`agent-team` 49+26+18+17+11+4, `tool-agent-team` 57+21+16, `agent-team-profile` 1). The 21 new tests cover all fifteen required obligations, including default AUTO, per-mode persistence and projection, status, invalid-mode rejection, replay recovery through a real persistence round trip, the three rendered policy behaviors, and the four non-regression boundaries. `verify-translation-pairing` for the touched pair reports `1 named pair(s) consistent`, exit 0; `verify-md-links` reports nothing for this package.

**Typecheck:** `tsc -b packages/experimental/tool-agent-team/tsconfig.json packages/experimental/agent-team/tsconfig.json` exits 0. The bounded test-file check reports zero errors under `packages/`; the residual errors are confined to `vendor/`, the known artifact of compiling that tree under a different project shape. The pre-existing `tool-team.spec.ts:431` `test-compaction` error is byte-identical in the pre-VS3C backup and remains untouched.

**Backup (verified before editing):** `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/pre-vs3c-orchestration-mode-20261112T173613-0500.tgz` — 240,562 bytes, 11 files, `tar -tzf` readable, destination confirmed absent before writing, SHA-256 `92c44b700e8984cb969e1864e7d5fec16a1cfae826f852e1c7c257a607506344`.

**Deliberately NOT in this slice (still PLANNED):**
- Per-specialist cloud/local LLM routing — **PLANNED**. `startSpecialist` still forwards no `agentOptions`; the seam remains `agentOptions` + `resolveTeammateAgentOptions` + the `spawn` backend `agentOptions` capability. Automatic cloud routing is **not** complete.
- DEEP/MAX orchestration tiers — **PLANNED**.
- A Web UI mode panel — not implemented; the slash command plus projection is the whole control surface.
- A per-turn spawn cap — not implemented; existing queue, concurrency, membership, and duplicate-name protections are unchanged and sufficient for a preference-only mode.

**Report:** `/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-agent-teams-vs3c-orchestration-mode-20261112.txt`




## GPU reassignment — RTX 3090 → Strata, RTX 3090 Ti → ComfyUI — 2026-11-11

**Status:** VERIFIED / COMPLETE

Owner authorized reversal of prior GPU allocation. No DSH restart, no WorkRunner
change, no model change, no port change, no power limit change, no ComfyUI
generation, no specialist swarm change, no commit.

### Physical GPU identity (confirmed by nvidia-smi UUID)

| nvidia-smi index | Card | UUID |
|---|---|---|
| GPU 0 | RTX 3090 (24 GB) | `GPU-4144e557-ad9a-83b3-014a-61f67141c547` |
| GPU 1 | RTX 3090 Ti (24 GB) | `GPU-009aea9f-1bb8-d43b-b56a-abe166f629b0` |

CUDA and nvidia-smi share the same device ordering for these two cards (identical
compute capability 8.6 → enumerated by PCIe bus ID, matching physical order).

### Prior allocation (before this change)

- **Strata:** `gpu-mode=gpu1` → `strata-iq3_xxs-gpu1.json` → `"gpu":[1]` → RTX 3090 Ti
- **ComfyUI port 8189:** `CUDA_VISIBLE_DEVICES=1`, `--cuda-device 0` → RTX 3090 Ti

### New allocation (after this change)

- **Strata:** `gpu-mode=gpu0` → `strata-iq3_xxs-gpu0.json` → `"gpu":[0]` → RTX 3090
- **ComfyUI port 8189:** unchanged — `CUDA_VISIBLE_DEVICES=1` → RTX 3090 Ti ✓

### Change made

One file changed:

`/home/liongateos/.local/share/strata/install/gpu-mode`

Content before: `gpu1`
Content after: `gpu0`

`strata-engine.service` restarted. Log line confirmed:
`[strata] card roles: Main GPU 0 (numbers as nvidia-smi gives them)`

### Verification

Post-restart nvidia-smi state:
- GPU 0 (RTX 3090): 2 MiB — Strata listening in lazy mode, model not yet loaded
- GPU 1 (RTX 3090 Ti): 17100 MiB — ComfyUI PID 1516942 ✓
- ComfyUI queue at time of change: `{"queue_running":[],"queue_pending":[]}` — no active work

### Operational requirement

Preserve `gpu-mode=gpu0` across Strata runner replacement, Strata update,
reinstall, or migration unless the owner deliberately changes the GPU assignment.
When Strata loads the Qwen model, it will occupy RTX 3090 VRAM only.
ComfyUI remains on RTX 3090 Ti via its own `CUDA_VISIBLE_DEVICES=1` environment.

### Backup

`/mnt/SanDisk-Backup/MASTER_BACKUPS/gpu-mode.pre-reassign-20261111`
(original content: `gpu1`)

### Report

`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-comfyui-gpu-reassignment-20261111.txt`


## Rotating Specialist Swarm — Live Vertical Slice 1 VERIFIED — 2026-11-12

**Status:** LIVE PROOF COMPLETE — 6 specialists, maxActiveSpecialists=2, auto-promotion verified, single Strata server (RTX 3090)

### Proof parameters

- Profile: headless + `/tmp/specialist-proof-overlay.yml`
  (strata-local provider, agent-default-model override, agent-team + tool-agent-team plugins, standard subagent tools disabled)
- Model: `strata-local / qwen3.8-flash-next-iq3_xxs`, reasoningEffort: medium
- Specialist catalog: 8 definitions; 6 selected
- `maxActiveSpecialists`: 2

### Scheduling proof (STEP 2)

| Specialist | Spawn status |
|---|---|
| requirements-analyst | `active` |
| implementation-planner | `active` |
| code-reviewer | `queued` |
| test-author | `queued` |
| security-auditor | `queued` |
| integration-verifier | `queued` |

Lead reported: `SCHEDULING: active=2 queued=4` ✓

### Auto-promotion (live, mid-session)

- Wave 1: requirements-analyst + implementation-planner active
- After implementation-planner went inactive: code-reviewer + test-author promoted
- After that wave: security-auditor + integration-verifier promoted
- Active count never exceeded 2 at any point ✓

### GPU state (verified during proof)

- GPU 0 (RTX 3090): Strata inference PID 1597528, 22382 MiB, UUID `GPU-4144e557-ad9a-83b3-014a-61f67141c547` ✓
- GPU 1 (RTX 3090 Ti): ComfyUI PID 1516942, 17054 MiB, UUID `GPU-009aea9f-1bb8-d43b-b56a-abe166f629b0` — unchanged ✓
- Single Strata instance throughout; no second model server spawned ✓

### Lead synthesis (STEP 7)

PROOF COMPLETE: 6 specialists ran, initial active=2 queued=4

> All six specialists converged on one invariant: every displayed status must be
> derived from a live, independently observed health probe with explicit timeouts,
> freshness bounds, and first-class unknown/stale/degraded states — never from
> self-reported, assumed, or cached uptime.
>
> Security and verification framing adds that the probes must be authenticated
> and their evidence timestamped and aged out, because stale or unverified
> "healthy" is the failure mode that converts a status dashboard into false
> confidence during crashes, restarts, and partial failures.
>
> Practical implication for LionGateOS: the dashboard's contract should model
> status as measured evidence (probe result + timestamp + age) with unknown as a
> renderable state, and its tests must assert silence/unreachability renders as
> unknown rather than up.

### Integration-verifier additional findings (relayed, no action taken)

- 4,401 tests pass across changed packages
- Pre-existing typecheck error in `packages/preset/agent-preset-registry/tests/session-init.spec.ts`
  (3 TS errors, unrelated to specialist work)
- Environmental EROFS in ui-sidebar-documentpreview license-bundle test (unrelated, sandbox scope)

### Phase 6 regression check (post-proof)

All 4 ports healthy after proof:

- Port 3180 (DSH): 401 auth-required = healthy ✓
- Port 8080 (Strata): 200 ✓
- Port 8090 (switchboard): 200 ✓
- Port 8189 (ComfyUI): 200 ✓

Narrow test suites: 142/142 passed (agent-team + tool-agent-team, 6 files). Zero regressions. ✓

### Deferred work (not acted on)

- Typecheck fix in `packages/preset/agent-preset-registry/tests/session-init.spec.ts`
  (pre-existing, 3 TS errors, unrelated to specialist work; pending owner decision)
- Specialist swarm Vertical Slice 2: visible `queued` phase (requires session format bump),
  per-route limits, full profile integration

### Backup

Pre-deployment backup:
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/specialist-swarm-live-deploy-pre-20261112.tgz`

SHA-256:
`425590f0c7449385358dcb4bee8cf882d391d016847e2270f8030fac18beb01c`

### Reports

Raw proof output:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-specialist-proof-raw-20261112.txt`

Full live deployment report:
`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-rotating-specialist-swarm-live-vslice1-20261112.txt`

## Local test-resource saturation incident — FULLY VERIFIED 2026-11-12

### Incident summary

A broad `pnpm vitest run` and a full-suite baseline comparison (2155 test files) each
spawned approximately 16 concurrent Vitest fork workers on this 16-CPU (8 physical / 16
logical) workstation, causing severe CPU saturation. At 12:41:54 a separate global OOM
event killed `strata-host`; `strata-engine` recovered automatically. The OOM is not
solely attributed to Vitest — multiple heavy processes were running concurrently — but
Vitest saturation confirmed as a contributing factor.

### Root cause

`scripts/parallelism.ts` had `LOCAL_TEST_PARALLELISM_CAP = 48`. On a 16-CPU machine:
`Math.min(16, 48) = 16` — the cap never bound. All 16 logical CPUs were used by default.

The existing guard mechanism (`vitest.config.ts` `localWorkerBudget`) was structurally
correct but the cap value was set too high to constrain a 16-CPU workstation.

### Fix applied

Four files changed (all git-tracked; pre-change state recoverable from HEAD):

- `scripts/parallelism.ts`: `LOCAL_TEST_PARALLELISM_CAP` changed from `48` to `4`.
  Updated JSDoc to document the workstation rationale and the `DSH_LOCAL_TEST_CONCURRENCY`
  override.
- `vitest.config.ts`: Three changes:
  1. Added `DSH_LOCAL_TEST_CONCURRENCY` env variable support (production-constrained mode).
  2. Spread `localWorkerBudget` into the global `test` config (workspace-level ceiling).
  3. Spread `localWorkerBudget` into each inline project config (thread-safe and
     process-bound) — required because Vitest 4.x does NOT inherit workspace `maxWorkers`
     at the per-project pool level. Without this, each project's fork pool used the
     CPU-based default regardless of the workspace setting.
- `scripts/parallelism.spec.ts`: Updated test to reflect the new cap value and description.

### Resulting behavior — RUNTIME VERIFIED

Default local run (`pnpm run test`, `pnpm vitest run`):
- Configured `maxWorkers: Math.min(16, 4) = 4` — applied at workspace AND both projects.
- Timing-derived max concurrent test files: **4** (7-file bounded suite, verified 2026-11-12).

Production-constrained mode (`DSH_LOCAL_TEST_CONCURRENCY=2 pnpm run test`):
- Configured `maxWorkers: 2` — applied at workspace AND both projects.
- Timing-derived max concurrent test files: **2** (same 7-file bounded suite, verified 2026-11-12).

CI: unchanged — `CI=true` bypasses all local caps.

### Validation evidence

- `pnpm vitest run scripts/parallelism.spec.ts`: 3/3 passed.
- 7-file bounded suite (default mode): 279/279 passed; max concurrent = 4 (timing-derived).
- 7-file bounded suite (production mode): 279/279 passed; max concurrent = 2 (timing-derived).

### No production capability removed

No GPU changes. No service restart. No swarm work touched. No session data changed.
Targeted test commands remain fully compatible. CI behavior unchanged.

### Backups

Pre-change resource-guard backup (from git HEAD):
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/test-resource-guard-pre-20261112.tgz`
SHA-256: `bd6eb512f9dbb143a63d4a1537069f652764d182cf375b93debf76a32c5141de`

Comprehensive working-state backup (all current VS1/VS2 + guard work):
`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/dsh-working-state-20261112.tgz`
SHA-256: `988eab43c7ee8a90be5685a7af7fdded59ad052cf391569c3d90a10a75f91503`
Covers: all 9 untracked VS1/VS2 new files + all guard-changed files + PROJECT_STATE.md.

### Report

`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-test-resource-guard-20261112.txt`

---

## TPS Telemetry Repair — 2026-11-12

### Symptom

DSH UI displayed ~1000 tok/s at session open, then falling monotonically (809 → 350 → lower).
Actual Strata inference rate: 55–70 tok/s (61.2, 64.5, 61.3, 70.0 from live journal).

### Root cause confirmed (switchboard — previously fixed 2026-11-11)

The swarm switchboard at `/home/liongateos/.local/bin/swarm-switchboard` classified SSE streams
only by `Transfer-Encoding: chunked`. Strata uses `Content-Type: text/event-stream` with
connection-close framing. The switchboard buffered the full response and forwarded it with
`Content-Length`, collapsing all 515 SSE events into a ~2ms burst.

This made `Date.now()` timestamps near-identical: `decodeMs ≈ 2`, `outputTokens ≈ 500` →
implied 250,000 tok/s, saturating the cumulative average immediately.

The switchboard fix was applied 2026-11-11 and verified post-fix (515 events over 3.582s, 138 tok/s).

### Remaining DSH code problem addressed

The active session at the time of fix had already accumulated inflated `decodeMs`/`decodeTokens`
from pre-fix burst steps. The cumulative average kept falling because real new steps (138 tok/s)
diluted the inflated total — but could never erase it.

### Fix: credibility gate in both server projection and client fallback

Added `stepDecodeMs * 2 >= outputTokens` guard (equivalent to: implied TPS must be ≤ 2000 tok/s)
in two locations:

1. **`packages/session/session-stats/src/projection.ts`** — server `sessionStats` projection,
   `assistant/message` handler. Burst steps (decodeMs=2, tokens=500: `4 < 500`) are excluded;
   credible steps (decodeMs=3582, tokens=515: `7164 >= 515`) are included.

2. **`packages/client/ui-chat/src/client/chat/StatsPills.tsx`** — `deriveStats()` client fallback.
   Identical guard matching the server logic.

The gate is a plausibility heuristic against a specific known artifact (SSE collapse), not a
hardware or model invariant. The specific corrupted value was ~250,000 tok/s; 2000 tok/s sits
~1000× below that and well above any measured production rate. No semantic field in the event
metadata distinguishes burst-delivered from real-time streaming; the only discriminating signal
is temporal (decodeMs per token), which is what the condition tests. Comments in both source
files now explicitly classify this as a heuristic threshold, not a physical constant.

### Regression tests added

- **`packages/session/session-stats/tests/projection.spec.ts`**: `'excludes a burst-delivered step
  and keeps credible decode from later steps (SSE collapse guard)'` — verifies burst step excluded,
  credible step included, cumulative totals correct.

- **`packages/client/ui-chat/tests/chat-stats.client.spec.tsx`**: `'excludes burst-delivered steps
  from the decode fold (SSE collapse guard)'` — verifies client `deriveStats` excludes burst nodes.

### Validation

- `DSH_LOCAL_TEST_CONCURRENCY=2 pnpm vitest run packages/session/session-stats/tests/projection.spec.ts`:
  **17/17 passed** (15 existing + 2 new).
- `DSH_LOCAL_TEST_CONCURRENCY=2 pnpm vitest run packages/client/ui-chat/tests/chat-stats.client.spec.tsx`:
  **40/40 passed** (38 existing + 2 new).
- `pnpm tsc -p packages/session/session-stats/tsconfig.json --noEmit`: clean.
- `pnpm tsc -p packages/client/ui-chat/tsconfig.client.json --noEmit`: clean.

### No production capability removed

No GPU changes. No service restart. No session format bump. No model/inference changes.
Active DSH session untouched. Strata, switchboard, swarm work all untouched.

### Backups (pre-change SHA-256 of modified files)

Location: `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/tps-telemetry-fix-backup-20261112/`

- `chat-stats.client.spec.tsx`: `4e9a2e9e09b9474d27d692199ff174c7c6c6b266752ce1ba9553ddd3ffe0b7f7`
- `projection.spec.ts`: `7f819ba06b399e2641efd2aa6f8d2131e293c2e84408a063f57015c2b0da3623`
- `projection.ts`: `8e38b0c0c5a0e98c4184a82763363086133efc13b64d0a8b2a6c515e43f7d99c`
- `StatsPills.tsx`: `d901d8069b7f7263576478608cce2b27d0312b5863a6fcb19df76c1489b7d76c`

### Follow-up: heuristic classification review — 2026-11-12

Inline comments in `projection.ts` and `StatsPills.tsx` corrected: "Real LLM inference cannot
sustain this speed" replaced with explicit plausibility-heuristic classification. The filter
condition (`stepDecodeMs * 2 >= outputTokens`) is unchanged. All tests re-passed (17/17, 40/40).
Typecheck clean. `PROJECT_STATE.md` description corrected to match.

### Report

`/mnt/SanDisk-Backup/TEMP_REPORTS/dsh-tps-telemetry-fix-20261112.txt`

## Fresh-session command result visibility + DSH home guard — VERIFIED 2026-11-12

### Symptom

Starting a fresh Session and running `/workrunner queue` executed correctly and persisted
both lifecycle events, but the main Conversation stayed visually blank. The command result
was durable yet unreadable without typing a meaningless model prompt.

### Root cause

`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:1235` defined
the Chat target as active only when the snapshot held a non-`command` row:

```
isActive: snapshot => snapshot.order.some(key => snapshot.nodes.get(key)?.kind !== 'command'),
```

A fresh Session's only rows are the `command/run` + `command/done` pair, so `isActive`
returned false, `conversationPhase` stayed `blank`, and
`DefaultConversationViews.tsx` returned `null` before rendering any view. The owner saw the
Hero with no result. This behavior was deliberate for control commands: origin commit
`62c1f15576` ("fix(client): command lifecycle rows keep the composer blank") stopped a hero
preset pick and `/plan` from collapsing the Hero into a Conversation.

### Smallest correct repair

A command row now counts as Conversation activity when its settlement text contains a line
break. Single-line settlements, text-less settlements, running rows, and errors without a
line break keep the Hero exactly as before. `permission` never reaches the test because
`packages/client/ui-chat/src/client/contract/chat-visibility.ts` already removes it from
`snapshot.order`.

Rationale for that boundary: the row's disclosure body already exists only for multi-line
text (`body = text.includes('\n') ? text : null`), so a multi-line settlement is precisely the
case whose content cannot be read from the collapsed summary. `/plan`, `/permission`,
`/compact`, and `/export` all settle one line and are unchanged. The shipped golden
`snapshots/web/lifecycle-chrome/plan-active.expected.md` (bare `/plan` on a fresh Session keeps
the Hero) still passes.

### Files changed

- `packages/client/ui-chat/src/client/contract/chat-nodes.ts` — added internal `commandBody(outcome)`, the single predicate for "settlement needs a body".
- `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts` — added `isConversationActivity(node)`; `chatViewDefinition.isActive` uses it.
- `packages/client/ui-chat/src/client/chat/GenericCommandCard.tsx` — body derives from `commandBody(node.outcome)`, so the renderer and the shell share one fact.
- `packages/client/ui-chat/README.md` — documented the multi-line activation rule.
- `.agents/notes/implemented/architecture/2026-08-20-client-session-conversation-ownership.md` and `.zh.md` — corrected the activation sentence in both languages.
- `packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts` — two new cases (multi-line activates, single-line stays inactive).
- `packages/client/ui-chat/tests/chat-view.client.spec.tsx` — multi-line settlement stays collapsed until the disclosure opens.

No public value export was added (`src/client/index.ts` diff is empty). No host-side
`CommandDefinition` field, no `command/run` payload change, no `SESSION_FORMAT_VERSION` bump:
the fix is pure client presentation over durable events, so a reload reconstructs it.

### Validation

- `pnpm exec vitest run packages/client/ui-chat packages/client/ui-conversation packages/client/ui-goal` → 108 files, 1729 tests passed.
- `pnpm exec vitest run --coverage --coverage.include='packages/client/ui-chat/src/client/**' packages/client/ui-chat` → 100% lines/branches/functions/statements on `chat-nodes.ts` and `GenericCommandCard.tsx`.
- `pnpm exec tsc --noEmit -p packages/client/ui-chat/tsconfig.client.json` → clean.
- `tsx scripts/run-oxlint.ts` on the changed files → 0 warnings, 0 errors.
- `DSH_SNAPSHOT=replay` `apps/web/tests/lifecycle-chrome.e2e.ts` → 15/15 passed, including `shows active Plan as the business-state status action`.
- `apps/web/tests/cold-blank-session.e2e.ts` and `blank-preset-reuse.e2e.ts` → passed.
- `apps/web/tests/goal-command-presentation.e2e.ts` → 1 passed, 1 failed; the failure is a stale golden caused by the owner's uncommitted `InputBar.tsx` paperclip button (`apps/web/tests/expected/goal-command-presentation/ui.expected.md` predates it). The same failure exists without this change.
- `snapshots` replay → 200 passed, 2 skipped, 8 failed, all `snapshots/session/headless.snapshot.ts`/sdk replays; cause is owner-local instruction files injecting an `agent-instructions` block, shifting `{{message:N}}` ids. Those profiles never load browser client code.

### Live 3180 proof (no restart)

Client bundles are served from an in-memory cache that `client-hmr`'s 500 ms stat poll
refreshes, so rebuilding `packages/client/ui-chat/lib/client.js` reaches the running host
without restarting the service. The served bundle's `rev` changed and the old predicate no
longer appears in it.

Driven through a real browser against `http://127.0.0.1:3180` in an untouched workspace:

1. Fresh Session → Hero, 0 rows.
2. `/workrunner queue` → `data-phase="active"`, Hero gone, exactly 1 row; collapsed summary is
   the queue's first line, the disclosure expands to the full 26-line result.
3. Reload → `data-phase="active"` with the same row reconstructed from the log alone.

The created Session's `session.v4.jsonl.zstd` holds exactly `session`, `permission/preset`,
`sandbox/mode`, `approval/policy`, `command/run`, `command/done` — no `turn/start`, no
`step/start`, no `request/header`, no `user/message`, no `assistant/message`: no model turn.

Service start time is unchanged (last start 10:17:14, before this work).

### DSH home guard

`owner/dsh-home-guard/live-home.mjs` (dependency-free Node ESM, `resolve` / `assert --home` /
`homes` / `verify --home`; exit 0 proven, 2 ambiguous, 3 mismatch, 4 unavailable). It reads the
systemd user unit first, then the launcher it execs, and requires both to agree on `DSH_HOME`,
`WorkingDirectory`, and the port. Missing evidence is `unavailable`; it never falls back to
`~/.dsh`. `homes` separates a competing `config-home` (holds `profiles/`) from `plugin-state`,
which is why a plugin recreating `~/.dsh` for its own data is not a configuration regression.
`verify` names six post-upgrade facts, including `/workrunner` registration and credentials.

Live results: `resolve` names `~/.dsh-rc5-staging-20261103T195538-0500`, working directory
`/home/liongateos/deepseek-harness-rc5-staging`, port 3180, three evidence entries; `assert`
against the live home exits 0 and against `~/.dsh` exits 3; `homes` exits 2 with
`~/.dsh-rc5-staging-20261103T195417-0500` flagged as the one other config-home; `verify` passes
all six. `node --test owner/dsh-home-guard/tests/live-home.test.mjs` → 12/12.

### Preserved owner-local work

Working tree holds 163 modified + 22 untracked entries, unchanged from baseline except the
eight files above and this section. `StatsPills.tsx`, `chat-stats.client.spec.tsx`,
`InputBar.tsx`, `ui-sidebar/.../slots.ts`, and the 76 owner-modified snapshot/expected files
are untouched. A stray `gen-client-catalog` run was reverted; its staleness comes from the
owner's `sidebar.workspaces.leading` slot. Nothing staged, nothing committed, no stash
created, WorkRunner repo clean.

### Remaining limitations

- A single-line command result still does not activate the Conversation; it stays readable in
  the collapsed row summary, and the user must not be relying on the disclosure body there.
- The guard proves which home the live service names, not that the running process loaded it;
  post-upgrade live UI verification is still required.
- Version-named staging homes remain; consolidation to one permanent runtime-home identity is
  deliberately not performed.

### No production capability removed

No GPU use. No service restart. No session format bump. No model/provider/preset/permission
change. Agent autonomy and Agent Teams unchanged. WorkRunner untouched.


## Agent Teams specialist routing — COMMITTED AND VERIFIED

Completed 2026-11-13 on branch
`agent-teams-specialist-routing-20261113`.

Commit:

`bb48aba2016db709d36ef36fbba98119b2055c4a`
`feat(agent-teams): add bounded specialist routing`

Verified commit scope: 32 Agent Teams-related files only.

Implemented feature family includes:

- bounded specialist catalog/queue/concurrency;
- specialist status projection and UI;
- per-specialist/per-teammate model and reasoning selection;
- durable orchestration modes `off`, `auto`, and `on`;
- default-model placement support;
- session-bound model-selection policy and authorization gates.

Focused pre-commit verification:

- 8 test files passed;
- 207/207 tests passed;
- staged scope remained exactly 32 files;
- no GPU use;
- no DeepSeek Harness restart;
- no push.

Protected pre-commit backup:

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/pre-agent-teams-specialist-commit-20261113-024404.tgz`

SHA-256:

`440be1834d945df1d709168703499887788f1ad11fd8c81b4476bef8c7d9a41f`

The live repository remains intentionally dirty outside this committed scope.
Those unrelated owner modifications and untracked files remain preserved and
must not be cleaned, reset, staged, committed, or discarded as part of Agent
Teams work.

## Global Subagent Concurrency Governor — LIVE VERIFIED — 2026-11-14

**Status:** LIVE_DEPLOYED_AND_UI_VERIFIED.

The DeepSeek Harness runtime now has a separate manager-wide Subagent
activation ceiling in addition to the existing per-root activation ceiling.

- Feature commit:
  `42a787ecf38d9b46d731f824bd540b005cccaa6d`
  (`feat(subagent): add manager-wide activation governor`)
- Branch:
  `agent-teams-specialist-routing-20261113`
- `maxGlobalActiveSubagents` default: `8`
- Existing `maxActiveSubagents` per-root limit remains separate and unchanged.
- Manager-wide admission applies across independent root lineages within one
  running `SubagentManager`.
- Root admission retains precedence; a global rejection releases the reserved
  root slot immediately.
- Global and root reservations are released on settlement/failure through the
  combined idempotent release path.
- Dedicated error:
  `GLOBAL_ACTIVATION_LIMIT_REACHED`.
- Settings UI exposes:
  `Global Subagent parallelism limit`.

### Verification

- Source implementation and tests committed as exactly 10 intended files.
- Pre-deployment combined regression:
  **36 files / 715 tests PASS**.
- Targeted backend TypeScript compile: PASS.
- Targeted Settings UI TypeScript compile: PASS.
- Filtered backend `tsdown` bundle: PASS.
- Settings UI bundle: PASS.
- Post-build regression:
  **36 files / 715 tests PASS**.
- `git diff --check`: PASS.
- Compiled backend verified to contain
  `GLOBAL_ACTIVATION_LIMIT_REACHED` and `maxGlobalActiveSubagents`.
- Compiled Settings UI verified to contain the new global-capacity control.
- Owner-approved DeepSeek Harness Web restart completed successfully.
- New live Web service process started:
  `2026-11-14 19:17:43 EST`.
- Port `3180`: listening after restart.
- Browser-level owner verification:
  Subagent Plugins page displays separate values:
  - Maximum recursion depth = `1`
  - Subagent parallelism limit = `8`
  - Global Subagent parallelism limit = `8`

The live deployment did **not** launch real subagents merely to prove the
limit. Runtime concurrency semantics remain covered by the verified automated
test suite rather than an unnecessary live multi-agent load test.

### Safety / unchanged boundaries

- Agent Teams SpecialistQueue and its per-team/per-route limits are preserved.
- Existing per-root Subagent activation accounting is preserved.
- No new scheduler was introduced.
- No automatic cloud/model escalation was introduced.
- No GPU action was required.
- Strata was not restarted.
- ComfyUI was not restarted.
- No Git push was performed.
- Unrelated owner modifications in the dirty repository remain untouched.
- Scope is manager-wide inside one runtime process; this is not a
  cross-process/distributed concurrency governor.

### Build note

The repository-wide `build:lib` path remains affected by unrelated pre-existing
TypeScript errors elsewhere in the dirty worktree. Deployment therefore used
the repository-supported filtered `tsdown` build for
`@deepseek-ai/dsh-subagent` plus the package-specific Settings UI bundle.
Both target builds and the complete bounded 715-test regression passed.

### Historical handoff

The earlier retained handoff
`DSH_GLOBAL_GOVERNOR_COMMITTED_20261114-182756.md`
correctly records the pre-deployment state and remains historical evidence.
Its `NOT LIVE-DEPLOYED` status is superseded by this verified live milestone.

## LLMFIT ADVISORY CLI ADAPTER: IMPLEMENTED AND VERIFIED READ-ONLY — 2026-11-18

The pinned third-party model-fit engine `llmfit` (AlexsJones/llmfit `v1.1.20`,
release commit `bb57713`, archive SHA256
`d57076fab42ff875c2497d8f685adb3172856c219d13a81219cdc063b6318602`, installed at
`/home/liongateos/.local/share/liongateos/third-party/llmfit/v1.1.20/llmfit`) is
now available to DeepSeek Harness as an advisory calculation source through one
bounded owner-local plugin.

### What was built

Exactly one owner-local plugin, `owner/llmfit-advisor/`, exposing exactly one
model-facing tool: `llmfit_recommend(use_case, limit)`.

- `use_case` is validated against an explicit six-value allowlist (`general`,
  `coding`, `reasoning`, `chat`, `multimodal`, `embedding`).
- `limit` is an integer bounded to `1..10`.
- The argv is a closed constant shape; only those two validated values vary.
  The binary path is fixed and never resolved through `PATH`.
- Execution uses `ctx.subprocess.spawn` with an argv array. The plugin imports
  no `node:child_process`, constructs no shell, and adds no environment
  entries; the subprocess seam scrubs credential-shaped and `DSH_*` names.
- stdout is capped at 2 MiB in memory, stderr at 8 KiB, the termination grace
  period is 2 000 ms, and the per-call deadline is 20 000 ms.

Every failure is a typed result (`invalid_arguments`, `unavailable`, `timeout`,
`failed`, `output_too_large`); no raw exception reaches the agent surface.

A `ctx.tools.guard` denial covers the `llmfit*` namespace and allows only
`llmfit_recommend`. Guards run after the `tools/pre-execute` waterfall, so a
later policy cannot turn the denial into permission.

### The two boundaries this adapter encodes

**`memory_available_gb` is removed from every record.** Discovery proved that
llmfit multiplies its `--memory` override by every GPU it detects: `--memory=24G`
reported `memory_available_gb` 48.0 on this host, because two RTX 3090s are
detected. The field therefore reports theoretical pooled size, never
LionGateOS-authorized capacity. `--memory` is deliberately not passed, and the
field never reaches a model-facing result. `memory_required_gb` is preserved —
it describes a candidate model, not a capacity claim.

**`fit_level` is never read as permission.** A `perfect` fit is arithmetic
against hypothetical hardware. It does not establish that a model is
installed, that a GPU is authorized or free, that a route exists, or that a
launch may proceed. Every successful result carries the annotation: "llmfit
output is advisory only; installed-model truth, GPU authorization, routing,
reservation, and execution remain with LionGateOS/DeepSeek."

### Authority that did not move

- Installed-model truth stays with Local Model Manager (`verifyInstalled`:
  configured `ggufPath` plus `stat()`). llmfit catalog entries are never
  promoted to installed.
- Provider-route identity stays with the `llm` service. llmfit model names are
  its own catalog labels and are never treated as DeepSeek route ids.
- GPU authorization, reservation, compute-mode lock, launch gating, and the
  electricity/tariff path stay with Local Model Manager.
- GPU power caps stay with the external GPU TOU controller. Nothing in this
  batch reads or writes `/var/lib/gpu-tou-power/` and no power limit is set.

### Why the CLI adapter rather than MCP

DeepSeek Harness has a verified stdio MCP client, but every tool a server
advertises becomes model-visible: the bridge registers them unconditionally and
`packages/mcp/mcp-client` has no per-tool allowlist. Exposing llmfit over MCP
would publish `search_models` — whose implementation can fall back to live
Hugging Face access — beside the read-only advisory tools. A bounded CLI
adapter keeps the allowlist at one tool enforced in code, adds no dependency on
an MCP transport, and is testable without any server process. The same bounded
JSON-CLI precedent already exists in this repository
(`owner/local-model-manager/core/model-advisor-adapter.js`).

### Verification

- `node --test owner/llmfit-advisor/tests/llmfit-advisor.test.js` → 31/31 pass.
  Coverage includes fixed argv per use-case, the closed argument surface,
  injected subcommand and argv attempts, shell metacharacters, missing and
  non-executable binary, timeout, non-zero exit, signal death, malformed JSON,
  schema mismatch, output overflow, `memory_available_gb` removal,
  `memory_required_gb` retention, the advisory annotation, and the namespace
  guard. No test starts llmfit, executes a model, touches a GPU, or reaches the
  network.
- One live read-only validation, `use_case=coding`, `limit=3`, through the real
  `LocalSubprocessRuntime`: `status=ok`, 3 records, `memory_available_gb` absent
  everywhere, `memory_required_gb` present, advisory annotation present, no
  installed-model or execution authority claimed.
- Nearest-precedent regression: `owner/model-guide-cost-router/tests/tools.test.js`
  plus `owner/local-model-manager/tests/model-advisor-adapter.test.js` → 28/28
  pass; `owner/rea-security-guard/tests/run-tests.js` → 10/10 pass.

### Unreachable surface

`search`, `hf-search`, `update`, `download`, `run`, `bench`, `serve`, and
`cluster` cannot be produced by this plugin — no code path constructs them. The
happy path performs no network access: `recommend --json` reads llmfit's
bundled catalog. No HTTP server and no MCP server is started. No model is
downloaded, loaded, or benchmarked.

### Registration

- Bundle row added to `/home/liongateos/.dsh/profiles/web/package.json` and a
  `@local/*` link at
  `/home/liongateos/.dsh/profiles/web/node_modules/@local/llmfit-advisor`.
- The plugin's own `cordis.patch.yml` inserts the single loader row; the
  profile patch was not hand-edited.
- A Harness restart is required for the tool to appear in a running Session.

### Rollback

Pre-change backup: `.owner-backups/llmfit-advisor-before-20261118T165100-0500/`
(`web-profile-package.json`, `CUSTOMIZATIONS-MANIFEST.txt`, `PROJECT_STATE.md`,
and `RESTORE.md` with the exact restore commands). Restoring this batch means
copying those three files back and removing `owner/llmfit-advisor/`. No
`git reset --hard` is involved; unrelated working-tree changes are untouched.

### Not claimed

llmfit is not an execution provider, not installed-model authority, not a
routing controller, and not a GPU controller. WorkRunner does not consume it.
No automatic model routing was implemented, and no recommendation from this
tool may be treated as approval to launch anything.

## MODEL-SELECTION CONSOLIDATION: ONE FRONT DOOR — IMPLEMENTED AND VERIFIED READ-ONLY — 2026-11-18

Status: **IMPLEMENTED, TESTED, AND LIVE-VERIFIED. Not committed, not pushed,
not staged.** Owner approval remains the gate for any further step.

### The front door

ONE FRONT DOOR:
Model Guide & Cost Router — `recommend_model_for_workload`

INPUT SOURCES:
Local Model Manager (installed truth, per-GPU memory, runtime state, GPU
authority) + llmfit (bounded read-only hardware-fit advisory)

AUTHORITY:
Local Model Manager and the existing LionGateOS execution controls. Neither
llmfit nor this tool holds any.

ADVISORY:
Model Guide & Cost Router (task suitability, owner guidance, cost, routing) and
llmfit (fit arithmetic, `memory_required_gb`, quantization, estimated
throughput).

LEGACY:
Model Advisor — retirement candidate. See the classification below.

### What was broken and is now fixed

All four previously registered Model Guide tools failed the runtime output
validator at `packages/core/tools/src/index.ts:2160`. The cause was
`owner/model-guide-cost-router/core/tools.js` reusing one strict empty-object
schema (`SCHEMA_OBJECT`, `additionalProperties: false`) as the OUTPUT schema of
every tool, while `get_model_guidance` and `list_model_guidance` return prose
and the other two return different object shapes. The defect predates this
batch and was visible only through the live dispatch path, never through unit
tests.

Repaired by declaring the smallest schema the enforced subset accepts for each
real return value: `TEXT_OUTPUT` for the two prose tools, `RECOMMEND_OUTPUT`,
`COST_OUTPUT` for the object tools. Input validation was not weakened:
`SCHEMA_OBJECT` remains the input schema with `additionalProperties: false`.

`recommend_model_for_task` now returns a typed document instead of a bare
string when no task is supplied.

### The composed answer

`recommend_model_for_workload(task, use_case?)` returns one document:

- `recommendation` — model, provider, name, `installed` (true/false/null),
  why it fits, limitations, optional `localModelKey`/`diskBytes`, cost tier and
  pricing note, and the owner guidance facts.
- `installedTruth` — status, source, and the installed local model list, read
  from the `localModelManager` service.
- `hardware` — fit status, per-GPU memory facts, and catalog-only suggestions.
- `betterUninstalledOption` — an llmfit catalog hit, always labelled
  `NOT INSTALLED`.
- `advisoryOnly` — the fixed sentence: "Recommendations do not grant model
  launch, GPU, reservation, routing, approval, or execution permission."

Composition rules encoded in `owner/model-guide-cost-router/core/composed.js`:

- Installed models are preferred, and the owner's cost ordering is preserved
  inside each group. Preference is applied as a partition, so the routing rule
  itself is unchanged.
- Installed truth comes only from Local Model Manager. An unreviewed row is
  listed but never becomes the recommendation.
- Local guidance rows and manager rows are joined by artifact identity
  (`device:inode`), never by path text: the two components spell the same file
  through different roots (`/mnt/LionGateOS-AI-4TB/...` and
  `/home/liongateos/models/...`). An unstattable path proves nothing.
- An llmfit catalog name is never translated into a DeepSeek route or an
  installed model. No mapping exists, so none is invented, and the note says so.
- `fit_level=Perfect` carries no permission; it is reported as advisory text.

### llmfit as a service, not a second subprocessor

`owner/llmfit-advisor` now also provides the read-only service `llmfitAdvisor`
with the single method `recommend({useCase, limit})`. It re-validates against the
same `ALLOWED_USE_CASES` and `1..10` bound and calls the same `queryRecommend`
as the tool: same fixed argv, same stripped `memory_available_gb`, same typed
failures. Holding the service object cannot reach a wider llmfit surface. No
second subprocess path exists.

### Per-GPU free VRAM

`owner/local-model-manager/core/gpus.js` now asks the driver for `memory.free`
as an appended last column, with two narrowing fallbacks, so the positional
prefix never reorders. `memFreeMiB` is present only when the driver reported it;
free memory is never derived from total minus used, because the withheld region
is not the unused region. Verified live: RTX 3090 Ti 23711 MiB free of 24564,
RTX 3090 1068 MiB free of 24576.

This is the one capability that justified inspecting Model Advisor. Local Model
Manager was NOT connected to Model Advisor to obtain it.

### Model Advisor classification

Classification: **LEGACY / RETIREMENT CANDIDATE**.

Its recommendation and fit role is superseded by Local Model Manager, Model
Guide & Cost Router, and llmfit. Its one remaining unique fact — per-GPU free
VRAM — is now owned by Local Model Manager.

Model Advisor was NOT deleted, NOT cleaned, and NOT modified in this batch. Its
repository, branch, and files are untouched. Physical deletion or archival is a
separate future owner-approved action, and nothing here may be read as claiming
it has been removed.

DeepSeek Harness still imports three read-only wrappers from it
(`getHardwareProfile`, `getRuntimeDiscovery`, `getCompatibility`) through
`owner/local-model-manager/core/model-advisor-adapter.js`. Those calls are
unchanged and their snapshot output has no consumer.

### Boundaries that did not move

- No `packages/**` file was modified.
- No new plugin, provider, catalog, or recommendation engine was created.
- No model was launched, stopped, unloaded, or benchmarked.
- No GPU compute mode, reservation, power limit, or TOU state changed.
- No model download occurred, and no llmfit network search ran.
- `memory_available_gb` remains stripped from every llmfit result.
- WorkRunner does not consume this path. That was not verified and is not
  claimed.

### Verification

- `recommend_model_for_workload` through the real `ToolRuntime` dispatch:
  `status: ok`; recommended `Qwen3.8 27B Uncensored Q8` (`qwen27`, installed,
  29047084448 bytes); installed truth `verified` across qwen27, vision, qwen36,
  laguna; fit `ok` with three catalog-only suggestions; advisory sentence
  present; `memory_available_gb` absent.
- All four repaired tools dispatch without error: `recommend_model_for_task`,
  `get_model_guidance`, `list_model_guidance`, `estimate_model_cost`.
- Suite tallies: Model Guide 416 pass / 5 fail, Local Model Manager 411 pass /
  2 fail, llmfit 32 pass / 0 fail, new composed suite 13 pass / 0 fail.
- The 7 pre-existing failures were confirmed identical before this batch by
  running pristine copies of both plugins from the backup: Model Guide 5
  (engineCatalog ×2, manifest recovery, two price-diff cases), Local Model
  Manager 2 (canonical bundle drift in `client.js`, which this batch did not
  touch; one energy-coverage case).
- `git diff --check` clean; branch `agent-teams-specialist-routing-20261113`;
  HEAD `675a179d46100c1aed88ff43695d10cfbb55075e` unchanged; porcelain 378
  before and after; staged 0.

### Rollback

Backup: `.owner-backups/model-selection-consolidation-before-20261118T174659-0500/`
(`tools.js.orig`, `model-guide-index.js.orig`, `gpus.js.orig`,
`llmfit-index.js.orig`, `PROJECT_STATE.md.orig`, profile and manifest copies,
`git-status-pre-batch.txt`, `RESTORE.md`).

Restore the four original files from that directory, delete
`owner/model-guide-cost-router/core/composed.js` and
`owner/model-guide-cost-router/tests/composed.test.js`, then restart
`deepseek-harness-web.service` to unload the tools. No `git reset --hard`.

## MULTI-ROOT WORKSPACE: OWNER-APPROVED EXTRA WRITABLE ROOTS — IMPLEMENTED AND VERIFIED READ-ONLY — 2026-11-18

Classification: IMPLEMENTED IN-TREE, TESTED, NOT YET MOUNTED, NOT COMMITTED.

### What it does

A path named in a prompt is not authority. The model may propose directories
outside the workspace; the owner decides; only the ticked paths persist, and a
persisted root widens the writable file boundary for that workspace only.

One source of truth, one chain:

    WorkspaceRecord.approvedWritableRoots        (packages/workspace/workspace/src/spec.ts)
      -> SandboxExecutionPolicy.additionalWritableRoots
                                                (packages/sandbox/sandbox/src/index.ts)
      -> writableRoots()                         (packages/sandbox/sandbox/src/roots.ts)
      -> in-process fs fence, bwrap, Landlock, Seatbelt
         (packages/fs/fs-sandbox, packages/sandbox/sandbox-local/src/profiles.ts)

The domain version stays 2. `approvedWritableRoots: z.array(z.string()).default([])`
parses records written before the field existed, so no migration and no
`version-mismatch` rejection.

### The approval seam

`request_workspace_root_access({ operation, roots })`, registered by the new
package `packages/interaction/tool-workspace-root-access/`. It asks ONE
`ctx.userQuestions.ask` question with `multiSelect: true` whose options are the
pending candidates, and persists only labels the owner selected under this
tool's question id. A malformed answer, a foreign id, an aborted call, or a
failing answerer selects nothing.

Refused before the owner is asked: relative paths, missing paths, non-directories,
the filesystem root, and any directory enclosing the home directory. A symlinked
spelling canonicalizes to its real directory, so one grant cannot carry two
identities. `revoke` removes only an exactly matching grant and never a parent.

### Backend reach

| backend | extra roots reach it |
| --- | --- |
| in-process fs fence (`dsh-fs-sandbox`) | yes — `checkedTarget` consumes `writableRoots(policy)` |
| bwrap / Landlock / Seatbelt | yes — `additionalWritableRoots` feeds each profile builder |
| Windows ACL runner | NO — `sandbox-local` passes only `--workspace`; `sandbox-windows-acl` builds `writableDirs` from `parsed.workspace` alone |
| SSH helpers | NO — `packages/ssh/ssh/src/schemas.ts` policy schema is `.strict()` |

Not a security regression: an approval that does not reach a backend simply does
not grant there, and both missing backends remain confined to the workspace.

### Verification

- `packages/workspace/workspace` 88 tests (6 new: legacy record defaults to `[]`,
  new records store `[]`, the mutator persists and survives a domain re-open,
  replace-not-append, per-workspace isolation, `updatedAt` stamped by `mutate`).
- `packages/sandbox/sandbox` 10 tests (5 new: extra root included, canonicalized
  and deduped across four spellings, `read-only` grants nothing,
  `danger-full-access` returns `[]`, a sibling and a parent stay excluded).
- `packages/sandbox/sandbox-policy` 24 tests (5 new: no registry resolves with the
  key absent, only the owning workspace's roots, unowned session gets nothing,
  agentless `resolve()` gets nothing, roots are data under `read-only`).
- `packages/sandbox/sandbox-local` 45 tests (5 new: bwrap/landlock/seatbelt each
  receive the extra root).
- `packages/fs/fs-sandbox` 26 tests (6 new: write lands inside the approved root,
  sibling denied, parent not granted, `..` denied, symlink escape denied,
  `read-only` gains no write).
- `packages/interaction/tool-workspace-root-access` 26 tests (23 behaviour + 3
  surface), every result validated against the real
  `validateJsonSchemaValue`.
- Regression: 1480 passed / 124 skipped across `packages/sandbox`,
  `packages/fs`, `packages/shell`, `packages/workspace`,
  `packages/session/working-directory`.

Empty lists are omitted from the resolved policy so a no-approval policy stays
byte-identical to the previous shape; four pre-existing contract tests deep-equal
that object.

### Test environment note

`packages/fs/fs-sandbox` and the new tool tests need a writable HOME and a
temp parent: `TMPDIR=/tmp HOME=<writable>`. The new tool's fixtures build under
`/dev/shm` because `/tmp` is itself a standing writable root, which would make an
approval test pass without ever asking the owner.

### Remaining owner-approved step

The package is NOT mounted in any preset or bundle. Mounting it is a one-row
insert in `packages/bundle/web-app/presets/{standard,ptc,cordis}.patch.yml`,
which this batch was not authorized to edit. Until then the tool exists in the
tree, passes its tests, and is absent from every running composition.

### Rollback

    rm -rf packages/interaction/tool-workspace-root-access
    cp .owner-backups/multi-root-workspace-before-20261118T1841-0500/packages/workspace/workspace/src/{spec,types,entity,index}.ts \
       packages/workspace/workspace/src/
    cp .owner-backups/multi-root-workspace-before-20261118T1841-0500/packages/sandbox/sandbox/src/{index,roots}.ts \
       packages/sandbox/sandbox/src/
    git checkout -- packages/workspace/workspace/tests/workspace.spec.ts \
      packages/sandbox/sandbox/tests/roots.spec.ts \
      packages/sandbox/sandbox-policy/src/index.ts \
      packages/sandbox/sandbox-policy/tsconfig.json \
      packages/sandbox/sandbox-policy/tests/policy.spec.ts \
      packages/sandbox/sandbox-local/src/profiles.ts \
      packages/sandbox/sandbox-local/tests/local.spec.ts \
      packages/fs/fs-sandbox/tests/fs-sandbox.spec.ts \
      docs/tool-catalog.md scripts/gen-tool-catalog.ts tsconfig.host.json tsconfig.base.json

`.owner-backups/targets-t0.sha256` and the tarball
`.owner-backups/multi-root-workspace-before-20261118T1841-0500.tar.gz`
(sha256 `b3709ab16efc22ad152241ca1687a057a914b460690e9dad5094fc4a6d1ade1d`)
are the authoritative pre-batch content. No `git reset --hard`; unrelated dirty
work is untouched by this batch.

### Not claimed

- The tool is not mounted, so no running session can call it yet.
- Windows ACL and SSH propagation are not implemented.
- No live end-to-end owner approval was performed; the owner interaction is
  covered by tests with a question-seam double, not by a real GUI answer.

## DSH AUTOMATIC MODEL ROUTING: ADVISORY AUTO-INVOCATION VIA EXISTING SEAMS — IMPLEMENTED, TESTED; LIVE VALIDATION PENDING — 2026-11-18

Goal (owner, DSH session "DSH Automatic Model Routing"): the one-front-door
model-selection system must run automatically when a normal task arrives, with
no new selector, no new plugin, and no new user-facing tool.

### What was connected

- Classification seam: `agent/pre-step` (step 1 = the turn's first user batch)
  extracts task text only; it never rejects or mutates a step.
- Decision/seam: `agent/request` after `next()` (llm-retry precedent); the
  listener may replace the resolved LlmCallConfig once for the first request
  of the turn.
- Recommendation source: unchanged — the plugin's
  `recommendForWorkload` (the `recommend_model_for_workload` composition:
  Local Model Manager installed truth + owner guidance/cost + llmfit fit).
  No new scoring, no new classifier, no Model Advisor dependency.
- Materially-better test (core/auto-routing.js `decideRoute`): a verified
  installed-local or cloud recommendation differing from the current route.
  `installed: null` (truth unavailable), `guided-local-not-installed`, and
  `kind none` always fall back to the current model. llmfit catalog-only
  entries can never become routes (composed.js already prevents it).
- Authority: `autoSwitch` (default false) permits one-shot replacement;
  otherwise `autoRouteAsk` (default false) asks the owner exactly once per
  (agent, turn) through the existing `userQuestions` ask waterfall with a
  bounded `AbortSignal.timeout(autoRouteAskTimeoutMs, default 60s)`. Any
  timeout, missing answerer, abort, or refusal keeps the current model and the
  task proceeds. Both off = listeners registered nowhere, tool-free, silent.
- Anti-oscillation: turnState keyed by `agentId#turn`; `decided` set before
  any recommendation work; later steps never re-decide; no switch-back.
- Owner/specialist boundary: only a live top-level agent (host `agents.roots()`)
  is routable; child/specialist agents keep the route their creator chose.
- Fallback: recommendation throw/unavailability → undefined → current config
  (llm-retry outcome preserved), no ask, no error to the task.

### Files

- `owner/model-guide-cost-router/core/auto-routing.js` (new): pure
  `decideRoute`, `switchQuestion`, `SWITCH_APPROVE_LABEL`,
  `createAutoRoute` turn-scoped logic. No model calls, no authority.
- `owner/model-guide-cost-router/index.js`: config knobs `autoSwitch`,
  `autoRouteAsk`, `autoRouteAskTimeoutMs`; the two listeners (registered only
  when a knob is on) and the `userQuestions` askOwner bridge.
- `owner/model-guide-cost-router/tests/auto-routing.test.js` (new): 23 tests.
- Full plugin suite: 441 pass / 3 pre-existing failures
  (engine-advisor-wiring tests 105,106 DEFER-vs-REVIEW; manifest-recovery
  301 SHASUMS path) — from owner files dated 2026-11-07/08, untouched here.

### Rollback

`.owner-backups/model-auto-routing-before-20261118T193256-0500/` holds
pre-batch copies: index.js.orig, tools.js.orig, PROJECT_STATE.md.orig,
web-cordis-patch.yml.orig, git-status-pre-batch.txt. No clean, no reset, no
unrelated stash/stage/discard.

### Not claimed / pending owner approval

- Live routing validation through the real web profile was not yet run; the
  service has not been restarted, so the running session still runs the
  pre-batch bundle. No commit, no push.
- The owner-approval ask was exercised with a question-seam double only, not a
  real GUI answer.

## MULTI-ROOT WORKSPACE ACTIVATION: PRESET MOUNT — MOUNTED, VALIDATED, AWAITING CONTROLLED RESTART — 2026-11-18

Classification: MOUNTED IN SOURCE PRESETS, VALIDATED IN COMPOSITION AND IN THE
BUILT PLANE, NOT COMMITTED, NOT ACTIVE IN THE RUNNING SERVICE.

### What changed

`@deepseek-ai/dsh-tool-workspace-root-access` is now mounted in the three web
presets that carry a human approval seam. The same two-line row, inserted
directly after the existing `tool-ask-user` row:

    - id: tool-workspace-root-access
      name: '@deepseek-ai/dsh-tool-workspace-root-access'

- `packages/bundle/web-app/presets/standard.patch.yml`
- `packages/bundle/web-app/presets/ptc.patch.yml`
- `packages/bundle/web-app/presets/cordis.patch.yml`

`packages/bundle/web-app/package.json` gained the matching dependency row
`"@deepseek-ai/dsh-tool-workspace-root-access": "workspace:*"`. That row is
mandated by the repository's own gate: `scripts/verify-cordis-config.ts`
`bundlePluginDependencyErrors` rejects any bundle patch row whose package is
absent from that bundle's `dependencies`.

### Why three files and not one

No preset inherits from another. Each of `standard`, `ptc`, `cordis`, `minimal`
is an independent `- insert:` row declaring `@deepseek-ai/dsh-agent-preset` with
its own `id` and its own complete `plugins:` list — `grep -c extends` is 0 for
all four. There is no parent/child coverage, so no redundant entries exist and
no single smaller source change could cover the others.

### Composition proof

Composing the web profile against a scratch DSH home (the live profile was not
touched) and counting the mount rows per preset block:

    preset-standard   1
    preset-ptc        1
    preset-cordis     1
    preset-minimal    0
    preset-rea        0
    preset-smart-ria  0
    TOTAL             3

`minimal` is deliberately excluded: it carries no `tool-ask-user` and no
`userQuestions` row, so it has no human approval seam. Base scope is clean:
`packages/bundle/base/cordis.patch.yml` has zero references, and a composed
`--profile headless` yields zero registrations. The live user profile
`~/.dsh/profiles/web/{cordis.patch.yml,package.json}` was not modified and
contains zero references.

### Approval dependency cannot be bypassed

`inject = ['tools', 'userQuestions', 'sandboxPolicy']` makes `userQuestions` a
declared dependency, so the plugin does not activate at all when that service is
absent. Verified directly: with `tools` and `sandboxPolicy` provided and
`userQuestions` deliberately omitted, the plugin registers ZERO tools
(`REGISTERED_WITHOUT_USERQUESTIONS=[]`). The tool therefore cannot silently
grant a root.

### Built-plane repair

The e2e suites load the package through its built `lib/index.js`, not through
tsx source paths. Two artefacts were missing and are gitignored:

- `packages/interaction/tool-workspace-root-access/lib/index.js` — built with
  `npx tsdown --config-loader native -W -F '@deepseek-ai/dsh-tool-workspace-root-access'`
  (`npx tsdown ... <dir>` alone fails `UNRESOLVED_ENTRY`).
- `packages/interaction/tool-workspace-root-access/node_modules/@deepseek-ai/*`
  — the eight peer links that `pnpm install` would create, made by hand because
  install is out of scope for this phase. Without them the built file fails
  `ERR_MODULE_NOT_FOUND Cannot find package '@deepseek-ai/dsh-sandbox'`.

Both live under gitignored paths and add no porcelain entry. `pnpm-lock.yaml`
still has no reference to the package; the next legitimate `pnpm install`
should regenerate these links and the lockfile entry.

### Catalog expectation updates

Three exact-catalog expectations enumerate the shipped tool surface and each
gained the one new name:

- `apps/cli/tests/web-agent-presets.e2e.ts` (`standard` catalog)
- `apps/web/tests/shipped-composition.e2e.ts` (`EXPECTED_TOOLS`)
- `packages/core/tools/tests/gen-tool-catalog.spec.ts` (harvested name list)

`gen-tool-catalog.spec.ts` still fails, but only on four names this batch did
not add — `list_specialist_status`, `list_specialists`, `spawn_specialist`,
`specialist_checkpoint`. Those are pre-existing staleness: they exist in the
committed agent-team source at HEAD (13 matching registrations) while the
committed expectation lists none of them. Proven by running the HEAD version of
that spec against the current source, which produces the same failure without
any diff of mine.

### Verification numbers

- `npx tsc -b packages/interaction/tool-workspace-root-access/tsconfig.json` — OK.
- `npx vitest run packages/interaction/tool-workspace-root-access` — 2 files, 26 passed.
- `npx vitest run packages/preset/agent-preset-registry/tests packages/bundle/web-app/tests` — 13 files, 112 passed.
- `npx vitest run --config vitest.web.config.ts apps/web/tests/shipped-composition.e2e.ts` — 7 passed.
- `npx vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` — 35 passed, 1 failed. The failure is the pre-existing `preset-minimal-pressure` `SessionAlreadyExistsError`, present before the mount (baseline 35 passed / 1 failed with the rows withdrawn).
- All 289 cordis config files loaded through the gate's own loader: 288 ok, 1 skipped, 0 failed. The skip is `rea-integration/cordis.yml`, foreign pre-existing work with a duplicated top-level `plugins:` key; it aborts `pnpm run verify-cordis-config` before the gate reaches any file of mine. Left untouched.
- `git diff --check` on the seven intended files — clean, exit 0.

### Rollback

`/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/multi-root-preset-mount-before-20261118T193000-0500/`
holds all seven pre-change files under `files/` with `SHA256SUMS` (7 × OK) and
`RESTORE.md` (copy-back commands, the reasoning for `cp -p` instead of
`git checkout --`, and the two build artefacts to delete if a full retreat is
wanted). Do not `git checkout --` the four already-dirty files: their pre-batch
content carries another session's uncommitted work.

### Not claimed

- The running service has not been restarted. Until the owner performs a
  controlled restart, the live web session still runs the pre-mount
  composition and the tool is not callable there.
- No live end-to-end owner approval was exercised through the GUI in this
  phase; the approval path is proven by composition, by the inject gate, and by
  the tool's own 26 tests.
- Windows ACL and SSH propagation remain unimplemented, unchanged from the
  prior phase.
- `pnpm-lock.yaml` does not yet mention the package.
- No stage, no commit, no push.

## DSH AUTOMATIC MODEL ROUTING: LIVE VALIDATION + 429 ROOT CAUSE — 2026-11-18

- Owner restarted `deepseek-harness-web.service` externally (ActiveEnterTimestamp
  1795049017518275 usec = 19:43:37 EST). Boot clean: preflight PASS,
  `node --import tsx/esm apps/cli/src/bin.ts --profile web --no-open --port 3180`,
  HTTP 401 then authenticated 200 at 127.0.0.1:3180.
- Live probe A (coding, "Fix failing tests in a TypeScript repository."):
  model-switch ask card appears in the Web GUI with options "Yes, switch for
  this task" / "No, keep current model", footer 1 / 1 (exactly ONE ask).
  Classification and recommendation ran; ask path fired (autoSwitch false).
  Read via headless Chrome (playwright-core + system Chrome, --no-sandbox);
  screenshots + probe scripts under
  `.owner-backups/auto-routing-verify-scratch/`. Probe B (architecture)
  behaved identically.
- The probes never answered the ask and never executed the tasks.
- User reported: switch attempt returned Ollama.com 429. Root cause
  (read-only, from session transcripts): the recommended local model was
  NEVER dispatched. Both probe transcripts show exactly one request/header
  (provider ollama, model glm-5.3-flash) and llm/retry with policy
  normal/5 retries incl. RATE_LIMIT. Five consecutive attempts failed with
  424 `bili_throttle_terminal` (upstream rate-limited 5 consecutive
  request(s) to ollama.com) and the final attempt got the raw Ollama-cloud
  429 session-usage-limit; turn/end ERROR. The 429 belongs to the CURRENT
  model's own request, not to qwen-local. No answer event for the switch
  ask exists in the transcripts, so no switch could be applied before the
  turn died on the cloud 429.
- Recommendation model id verified CORRECT: the curated-only parser
  (core/overlay.js:381-382) splits the guidance key at the FIRST slash
  (`qwen-local//mnt/...gguf` -> provider qwen-local, id /mnt/...gguf,
  leading slash preserved), matching the provider's model list. The
  dispatch path (agent-loop agent.ts:593-612) accepts the override and
  falls back only on NO_ADAPTER. The auto-routing wiring is correct.
- The cloud session-usage limit is a provider-side quota condition
  outside this repository; resolution belongs to the owner (upgrade or
  usage credits at ollama.com/settings) or to answering the switch ask in
  the GUI before the current model's request is retried.
- No code changes beyond the already-recorded batch. No stage, no commit,
  no push. GPU untouched; no model launched, stopped, or benchmarked.

## DSH AUTOMATIC MODEL ROUTING: CONTINUATION-AWARE GATE — IMPLEMENTED, TESTED; LIVE VALIDATION PENDING OWNER RESTART — 2026-11-18

- Defect (owner report): continuation/control replies (`continue`, `c`, `yes`, `approved`,
  `go ahead`, `proceed`, `do it`, `next`, `retry`, `resume`, …) were treated as brand-new
  tasks; observed live: "continue" → recommended Qwen3.8 27B HauhauCS Vision on a
  continuation turn. A continuation normally belongs to the task in progress and must
  inherit its route without a new recommendation or a re-ask.
- Gate (core/auto-routing.js): `isContinuation({messages})` runs BEFORE classification in
  `onPreStep`. Two continuation channels, in order:
  1. Durable question reply — any claimed message with `source.kind === 'user-question-reply'`
     (packages/interaction/user-questions/src/types.ts:108-118) continues by construction.
  2. Bare control word — the whole normalized message (trim, lowercase, collapsed inner
     whitespace, trailing `.`/`!` dropped) exactly matches CONTROL_REPLIES (continue,
     keep going, go ahead, proceed, approved, approved!, approve, accept, accepted,
     accepted!, do it, retry, resume, next, option 1/2/3). Whole-message matching only:
     containment is never tested, so "Fix login." and "continue the migration by fixing
     the remaining tests in this repository" still classify as new work. A bare control
     word carries no task signal of its own, so it never seeds a recommendation; it
     inherits with or without prior context (fresh-session "continue" keeps the current
     model instead of inventing a task).
- Continuation turn state: `{task: '', continuation: true}`; `onRequest` returns undefined
  before the recommendation call and before the ask path — one recommendation per task,
  never re-asked on a continuation.
- Tests: tests/auto-routing.test.js now 39/39 (23 original + 15 continuation + a
  pin on the exported `CONTINUATION_REPLY`). Combined plugin suite: 86 tests, 83 pass,
  3 fail = the pre-existing engine-advisor-wiring (DEFER-vs-REVIEW, driver version) and
  manifest-recovery (SHASUMS path) failures; no new failures.
- Discovery-first: no new classifier — the existing `user-question-reply`
  MessageSourceMap kind and the existing text floor (`< 8` chars) carry most continuations;
  only whole-message bare control words needed an explicit exact-match list.
- LIVE VALIDATION COMPLETE (owner-restarted boot, PID 1499684, monotonic
  202826088058, 20:35 EST): (1) substantive task "Fix failing tests in a
  TypeScript repository." in a new session → routing ask card fired as before;
  (2) "continue" as the next turn → NO second model-switch question (ask count
  1 before, 0 new), the turn resumed the same task on the same route
  (glm-5.3-flash) — the continuation gate is live; (3) a new substantive task
  "Review this architecture and recommend the safest design." right after the
  continuation → routing fired normally. Probes never answered asks; no
  substantive job was sent by the probes themselves.
- (Superseded pending note:) (the plugin loads from this checkout through
  the profile symlink; owner chose to restart externally). Expected after restart:
  substantive task → routing asks as before; then "continue" → no recommendation call,
  no switch question, same route; new substantive task → routing resumes normally.
- No authority changed (silent auto-switch still off; GPU/launch/download/power/LMM/llmfit
  boundaries untouched). Rollback checkpoint:
  .owner-backups/model-auto-routing-continuation-before-20261118T202600-0500/.
  No stage, no commit, no push.

## DSH AUTOMATIC MODEL ROUTING: TURN-12 REFINEMENTS — MODIFIER CONTINUATIONS + QWEN3.8 NON-TI ROUTE ENFORCEMENT — IMPLEMENTED, TESTED 47/47 — 2026-11-18

- Refinement 1 (modifier continuations): a control word followed by a small side
  instruction — "Continue. But please in English because I'm not Chinese.",
  "Continue, but use English.", "Continue please.", "Keep going, in English.",
  "Proceed, but don't create another session.", "Resume and keep the same
  model." — now inherits like a bare control word. isControlReplyWithModifier:
  whole-message match; the post-control-word modifier clause is bounded to 60
  chars and must not start with a task verb (research/analyze/fix/rewrite/
  create/… and -ing forms) — "Continue researching PostgreSQL replication."
  and "Continue by rewriting the authentication system." stay NEW tasks. Word
  boundary preserved ("continued effort…" never matches).
- Refinement 2 (Qwen3.8 GPU-route enforcement, owner rule): Qwen3.8 27B may run
  ONLY on a verified RTX 3090 (non-Ti) provider route, never the RTX 3090 Ti.
  Profile fact: qwen-local = the 3090 Ti (:8001); qwen-local-3090 = the
  non-Ti (:8002). enforceQwen38Route rewrites any Qwen3.8 proposal from a
  non-approved provider onto the single configured route (default
  qwen-local-3090), or blocks the switch entirely (keep current) when 0 or >1
  approved routes exist. Config knob qwen38Providers (provider id or list,
  fails loud at activation). Routing policy only: no GPU, launch, reservation,
  power, download, LMM, or llmfit authority changed.
- Tests: tests/auto-routing.test.js 47/47 (23 original + 16 continuation-gate +
  8 new; 3 expectations updated to the enforced non-Ti route). Combined plugin
  suite: only the 3 pre-existing failures (engine-advisor-wiring, manifest-
  recovery) — no new.
- Live consistency check on the then-running boot: "Continue. But please in
  English because I'm not Chinese." produced no new ask (message steered into
  the running turn; the running process predated this edit, so the modifier
  gate itself is proven by tests; a post-restart probe can isolate it live).
- Rollback: .owner-backups/auto-routing-p2-before-20261118T203956-0500/.
  No stage, no commit, no push.

## MULTI-ROOT WORKSPACE ACTIVATION: REA + SMART RIA PRESET MOUNT — MOUNTED IN
## REPOSITORY, LIVE REA PRESETS STILL RESOLVE THE DEPLOYED COPY — 2026-11-18

- Classification: `MOUNTED IN REPOSITORY SOURCE, VALIDATED, NOT YET ACTIVE IN
  THE LIVE PROFILE`. Read-only authority was verified first
  (`liongateos-authority-preflight --project "DeepSeek Harness"` → PASS; the
  five canonical hashes are unchanged).

### What changed

- `rea-integration/cordis.patch.yml` only. Two identical two-line rows, each
  inserted immediately after the existing `tool-ask-user` row of one preset:
  - `preset-rea` (anchor at original line 190)
  - `preset-smart-ria` (anchor at original line 381)

  Inserted text at the anchor's own indentation:
  `          - id: tool-workspace-root-access` /
  `            name: '@deepseek-ai/dsh-tool-workspace-root-access'`
- Diff against the pre-edit copy: exactly 4 added lines, 0 removed, at
  `191a192,193` and `382a385,386`. Nothing else in the file moved: preset ids
  and orders (`rea` 5, `smart-ria` 6) unchanged, REA security guard rows
  unchanged, MCP REA configuration unchanged, Smart RIA task-scoped selection
  unchanged, model policies unchanged, all other plugin rows unchanged.
- File hash `94624b1303a475cc3703c307a12ccedd8bd95d033239562a19b08f1d30e3f839`
  → `7c184eda7e232c575c9ea5980d31d56985fff34ef3537fb9ed42f3cecf630799`.
  The target is UNTRACKED in git, so only the backup copy can restore it.

### Verified composition (repository file, parsed by the gate loader)

    preset-rea        id=rea        order=5  plugins=24  ask_user=1  workspace_root=1
    preset-smart-ria  id=smart-ria  order=6  plugins=25  ask_user=1  workspace_root=1

### Unresolved divergence the owner must decide on (IMPORTANT)

- The live web profile does NOT load this repository file. Its dependency is
  `@local/dsh-mcp-rea` → `link:/home/liongateos/.local/share/liongateos/deepseek-update/customizations/rea-integration`,
  and `/home/liongateos/.dsh/profiles/web/node_modules/@local/dsh-mcp-rea` is a
  symlink to that deployed directory. The deployed
  `cordis.patch.yml` is a separate file (different inode), hash
  `add700c188f853bed72c74f2228ed340c18211309bb0fa697cd6700d969d49c1`,
  mtime 2026-11-09 15:10.
- Therefore a restart alone would NOT activate the new row for REA: the
  deployed copy parses to `ask_user=1 workspace_root=0` for both presets. This
  batch was authorized to modify ONLY `rea-integration/cordis.patch.yml`, so
  the deployed copy was deliberately left untouched.
- The two copies also differ in nine model-path spellings: the deployed copy
  uses `/mnt/LionGateOS-AI-4TB/LLM/gguf/...` while the repository copy uses
  `/home/liongateos/models/gguf/...`. Both spellings resolve to the same tree
  only through the symlink `/home/liongateos/models -> /mnt/LionGateOS-AI-4TB/LLM`;
  the `os`-level real path is `/mnt/LionGateOS-AI-4TB/...`. This difference
  predates this batch and was not introduced by it.
- `CUSTOMIZATIONS-MANIFEST.txt` has no REA section at all, so no manifest row
  describes which copy is authoritative. No sync script for REA was found in
  `/home/liongateos/.local/bin/`. Reconciliation of the deployed copy against
  the repository bundle is an owner decision, not taken here.

### Gate note (not a regression)

- `verify-cordis-config` never scans `rea-integration`: `bundleManifestPaths()`
  globs only `packages/*/*/package.json` carrying `dsh.bundle.patch` (20
  manifests; `rea-integration` is not among them). Calling
  `bundlePluginDependencyErrors` on `rea-integration/package.json` directly
  does report that both `@deepseek-ai/dsh-tool-ask-user` and the new package are
  absent from its `dependencies` (which is `[]`) — but the pre-existing
  `tool-ask-user` row produces the same notice and has always resolved, so this
  is a pre-existing packaging omission outside the gate's scope. No
  `rea-integration/package.json` edit was made.

### Verification

- `git diff --check -- rea-integration/cordis.patch.yml` → exit 0.
- Target hash re-read at closeout equals the post-edit hash → stable during the
  edit; no `BLOCKED_CONCURRENT_WRITE`.
- `npx --no-install tsx owner/rea-security-guard/tests/run-tests.js` → 10 passed,
  0 failed. (`node --test` cannot run these; the specs import vitest.)
- `npx --no-install tsx owner/smart-ria/tests/run-tests.js` → 58 passed, 0 failed.
- Canonical package resolves from the REA bundle directory through the source
  plane: `REA_PLANE_OK tool-workspace-root-access ["tools","userQuestions","sandboxPolicy"]`.
- Backup:
  `/mnt/SanDisk-Backup/MASTER_BACKUPS/DeepSeekHarness/rea-preset-mount-before-20261118T205100-0500/`
  (original file, `SHA256SUMS` verified OK, `BRANCH.txt`, `HEAD.txt`,
  `git-status-pre.txt`, `RESTORE.md`).

### Not claimed

- No service was restarted, stopped, started, or reloaded; no `systemctl`, no
  D-Bus, no `pnpm install`, no sudo.
- The live REA presets do not yet contain the row (see divergence above).
- No stage, no commit, no push, no reset, no clean, no stash.
- Windows ACL and SSH propagation of approved roots remain unimplemented.
