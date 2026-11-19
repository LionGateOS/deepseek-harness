# @local/model-guide-cost-router

Model Guide & Cost Router — an owner customization bundle for the DeepSeek
Harness Web profile. It overlays a persistent, owner-curated model guidance
file onto the Harness's live provider/model discovery and exposes three read
surfaces: a Model Guide panel in the Web UI, deterministic Copy-for-Prompt
text, and read-only agent tools.

## How it works

- **Dynamic inventory**: the Host half reads the mounted `ctx.llm` catalog
  (`listConfigurableProviders`, `listModels`, `resolveModelInfo`) — the same
  discovery the GUI uses — and merges it with the owner file. New models
  appear automatically; provider facts (context window, modalities, reasoning
  efforts/default) populate from the provider and show as "Needs review"/
  "Unknown" when absent. Provider facts are never invented.
- **Owner metadata**: `/home/liongateos/.local/share/liongateos/model-guidance/
  owner-model-guidance.json` holds owner-curated facts (local/cloud, context
  configured, modalities, reasoning modes, native default, recommended routine
  and heavy settings, strengths, avoid cases, token rates, cost tiers, and the
  GPU boundary). Rediscovery never overwrites it. Malformed entries lose their
  invalid fields, keep valid ones, and are flagged with named problems.
- **Pricing** stays token-rate-only: input, cached-input, and output USD per
  1M tokens with source and verified date. Reasoning levels have no price and
  no multiplier; actual cost is computable only from real reported token
  counts times the stored rates. Prices past `maxPriceAgeDays` are flagged
  stale for owner review.
- **Agent tools** (`get_model_guidance`, `list_model_guidance`,
  `recommend_model_for_task`, `estimate_model_cost`) are strictly read-only:
  they call only the guidance service's four read endpoints and cannot select,
  launch, stop, switch, or dispatch any model. `recommend_model_for_task`
  returns an advisory cost-aware ordering under the owner routing rule with
  unreviewed models ranked last.
- **Client UI**: a `main#model-guide` panel with a `sidebar.panellist` entry.
  The page calls the same read endpoints through a hand-authored SRC-plane
  Typert contribution. "Copy for Prompt" copies the exact Host-generated
  guidance text.

## Configuration (cordis.patch.yml)

| Field | Meaning |
|---|---|
| `ownerMetadataPath` | Absolute path to the owner metadata JSON. Required. |
| `guideMarkdownPath` | Optional canonical guide markdown shown in the panel (never written by the plugin). |
| `catalogPath` | Saved canonical catalog; default `<ownerDir>/model-catalog.json`. Must stay inside the owner dir. |
| `guideGeneratedPath` | Regenerated human-readable guide; default `<ownerDir>/MODEL_GUIDE.generated.md`. Must stay inside the owner dir. |
| `customizationStatusPath` | Optional status file produced by the external recovery tool for the Owner Customizations panel. |
| `pricingCheckUrls` | Optional list of official pricing pages; used both as evidence snapshots and as the verified-rate source (default none). |
| `pricingProviderId` | Provider whose listed model ids the official pricing rows are mapped onto (default `ollama`). |
| `maxPriceAgeDays` | Days before a verified price is flagged stale (default 90). |
| `providerQueryTimeoutMs` | Per-provider `listModels` timeout (default 4000). |
| `providerCacheMs` | Inventory cache lifetime (default 60000). |
| `fetchTimeoutMs` | Pricing-snapshot fetch timeout (default 8000). |
| `maxCatalogHistory` | Bounded prior observations kept per model (default 5). |
| `localDiscoveryCachePath` | Optional absolute path to the shared LMM GGUF discovery cache (produced by Local Model Manager). When set, each snapshot includes a `localFiles` field with discovered GGUF candidates. Omit or leave empty to disable. |
| `ollamaBaseUrl` | Official Ollama service the metadata sweep reads from (default `https://ollama.com`). Must be an https URL. |
| `metadataEnrichment` | Whether the sweep may read provider metadata at all (default `true`). When `false`, `refreshModelMetadata` returns `disabled` and writes nothing. |
| `autoRefresh` | Whether **recurring** sweeps run on a timer (default **`false`**). Recurring network traffic is the owner's decision, so a fresh install starts no timer. |
| `autoRefreshHours` | Interval between recurring sweeps in hours (default `6`). Ignored while `autoRefresh` is `false`. |
| `refreshOnActivation` | Whether one sweep runs shortly after activation (default `true`). Independent of `autoRefresh`: it happens even when no recurring timer exists, and it never starts one — the single run is the whole schedule. Set it to `false` to make activation perform no network work at all. |
| `engineCheck` | Whether recurring engine-release checks run on a timer (default `true`). Separate from `autoRefresh`: engine releases are weekly-to-monthly and cost six release requests, so they are polled daily rather than every sweep. |
| `engineCheckHours` | Interval between engine-release checks in hours (default `24`). Ignored while `engineCheck` is `false`. |
| `advicePromptWorkspace` | Workspace path printed in the copy-ready investigation prompt (default the project root). |
| `advicePromptModel` | Model id printed in the investigation prompt (default the owner's default model). |
| `advicePromptReasoning` | Reasoning level printed in the investigation prompt (default `high`). |

## Inference engine registry

The registry is a frozen array in `core/engine-update.js`. Each row names an
engine, its GitHub releases endpoint, and — for projects that number their
engine build separately from their application release — a `versionSpace` of
`control`. Adding a row is the whole registration; detection, comparison and
advice then apply to it without further wiring.

| Engine | Detected by |
|---|---|
| `ollama` | `ollama --version` |
| `vllm` | `python3 -c` + `importlib.metadata.version('vllm')` — the CLI imports torch and takes seconds |
| `llama.cpp` | `llama-cli --version`, then `llama-server --version`; absent when neither binary exists |
| `sglang` | `importlib.metadata.version('sglang')`; absent when not installed |
| `tensorrt-llm` | `importlib.metadata.version('tensorrt_llm')`; absent when not installed |
| `strata` | `strata components engine --output json` (one bounded probe per check) |

Every probe is a bounded `execFile` with no shell, no write, and no model
inference. A probe that fails, times out, or reports nothing leaves the version
`null`, which the advice step reports as `not-detected` rather than guessing.

### Strata: two version sequences

Strata publishes its application release and its inference engine build as
separate sequences. The GitHub releases endpoint carries the application tag
(`v0.2.12`); the engine build (`0.1.56`, `0.1.58`) comes from the signed update
feed. The record keeps them in different fields and the comparison never mixes
them:

| Field | Source |
|---|---|
| `installedVersion` | the installed engine build from `strata components engine` |
| `latestRelease` | the application tag from the GitHub releases endpoint |
| `engineRelease` | the published engine build from `strata-feed.json` |
| `engineReleaseDetail` | platform, variant, minimum driver, host driver, and whether the host satisfies it |

`updateAvailable` stays `null` for a control-space row — the application tag is
never compared with an engine build — while `engineUpdateAvailable` carries the
engine-build verdict on its own.

The feed is read with a plain `GET` because `strata update --check` takes a
write lock in the components directory and therefore cannot run from a read-only
background check.

## Engine Update Advisor

`updateEngines` records what each engine has installed and what upstream
publishes; `engineCatalog` derives one recommendation per engine from those
facts. The recommendation rules are:

| Verdict | When |
|---|---|
| `REVIEW` | a newer **stable** release exists, the check is fresh, and any stated minimum driver is satisfied on this host |
| `DEFER` | a newer release exists but it is a prerelease, the recorded check is stale, or the minimum driver cannot be verified or is not met |
| `NO_ACTION` | up to date, not detected, never checked, incomparable, control-space without an engine build, or the last check failed |

Unknown stays unknown: a version that cannot be parsed, a missing driver floor,
or a release with no comparable tag produces `NO_ACTION` or `DEFER` with a named
reason, never a guess. Release notes are kept as a bounded excerpt and travel
with the verdict as evidence.

Prereleases are detected from the tag itself, not only from GitHub's
`prerelease` flag: vLLM publishes `v0.33.0rc3` with `prerelease: false`, so the
tag suffix is the reliable signal.

Each actionable row carries a copy-ready investigation prompt naming the
platform, mode, model, reasoning level, session, workspace and a READ-only
grant, plus the recorded versions, release evidence and the five questions worth
answering before an update. Execution belongs to WorkRunner and requires
separate owner approval; model or GPU suitability questions belong to Model
Advisor. Nothing is installed, downloaded, or upgraded by this plugin.

The engine check runs on its own timer (`engineCheck`, `engineCheckHours`),
independently of the model sweep, with a startup offset so two activation runs
never overlap. `autoRefreshStatus` reports both legs separately.

### Version comparison

The two values come from different producers, so their spellings differ: a
detector reports `0.40.15` while the GitHub tag is `v0.40.15`. `core/engine-version.js`
normalizes both before comparing and gives every record three things the panel
renders: `updateAvailable` (`true`, `false`, or `null`), `updateReason`, and
`installedVersion`/`latestRelease` unchanged.

The rules, in order:

| Situation | `updateAvailable` | Reason |
|---|---|---|
| `latestRelease` is `null` | `null` | `not-checked` |
| `installedVersion` is `null` | `null` | `not-detected` |
| `versionSpace: 'control'` | `null` | `control-space` |
| values are not comparable (different series, unparseable) | `null` | `incomparable` |
| release is strictly newer | `true` | `newer` |
| installed is the same or newer | `false` | `current` |

`null` means no verdict is justified, and the panel shows no badge for it. It is
not a failure: an undetected build, an unchecked feed, and a Strata control tag
all genuinely lack an answer, and rendering one anyway is how a permanent false
alarm gets born.

Comparisons are numeric, not textual, so `0.9.0` sorts below `0.40.15`. A
prerelease sorts below its release (`0.33.0rc3` < `0.33.0`), and a trailing
number in a prerelease identifier still orders numerically (`rc9` < `rc10`).
llama.cpp's `b5100` build numbers are their own series and are never compared
with a `0.9.0`-style version.

The comparison only ever reports. It does not install, upgrade, download, or
restart anything, and it performs no I/O of its own.

## Automatic metadata enrichment

Newly released Ollama models are enriched from the provider's own API, so a
model that appears upstream does not have to be hand-configured before it can
be costed and reasoned about.

The sweep reads `POST {ollamaBaseUrl}/api/show` per model, and the model list
from `GET {ollamaBaseUrl}/api/tags`. From that answer it records, per model:

| Fact | Owner field | Source |
|---|---|---|
| Deployment | `localVsCloud` | the configured provider is the official cloud service |
| Context window | `contextConfigured` | `model_info['<architecture>.context_length']` |
| Input modalities | `modalities` | `capabilities` (`vision` → `image`, else `text`) |
| Tool support | `toolSupport` | `capabilities` contains `tools` |
| Reasoning levels | `reasoningModes` | `thinking.values` |
| Native default | `nativeReasoningDefault` | `thinking.default`, only when also published in `values` |

Every fact carries the source URL and the verification timestamp in the report.
Nothing is inferred: a model that publishes no `thinking` block gets no
reasoning levels, and a level the provider does not list is never invented.

**Owner curation wins, field by field.** A recorded value is an audit result,
not a cache: it is never overwritten by a background refresh. When the provider
now publishes something different, the report names both values under `kept` so
the owner can decide. Only genuinely missing fields are filled, which is what
makes a new model usable without configuration while leaving an audited entry
such as `ollama/kimi-k3` exactly as it was.

The sweep is bounded: at most four concurrent lookups, one `fetchTimeoutMs` per
request, and a model that fails is named in the report instead of aborting the
batch. An unreachable provider writes nothing at all.

**When it runs.** One sweep runs shortly after activation, because
`refreshOnActivation` defaults to `true`: a newly released model becomes usable
without the owner hand-configuring it and without opting into polling. That
single run is the whole schedule unless `autoRefresh` is also on, in which case
the same work repeats every `autoRefreshHours`. `metadataEnrichment: false`
disables the work entirely, whatever the two scheduling switches say.

The one sweep runs three steps in order — route capabilities, then provider
facts, then the catalog and pricing — because each reads what the step before it
wrote. It costs one `GET /v1/models`, one `POST /api/show` per model seen or
curated, and one fetch per configured pricing page; a model that fails is named
in the report rather than retried in a loop. A refresh in progress is never
started twice: the scheduler records `skipped` and re-arms instead, and a run
that throws is recorded as `failed` without killing the timer.

**A new model reaches the selector because the route changes.** The activation
sweep persists route capabilities through the configuration editor, and a
written route is applied live — the profile section is volatile, so the change
commits without a remount and the client's model catalog is invalidated by the
`llm/adapters-updated` and `settings/document-updated` events. There is no
separate selector cache to refresh and no restart to schedule.

## Route capabilities for the model selector

The guide above describes what the *guide* believes. The reasoning control in
the model selector is a different surface: it is built from the provider route
in `cordis.patch.yml`, so a model declared as `- id: kimi-k3.1-pro` with only a
`name` offers no reasoning levels at all — not because the model lacks them, but
because nothing declared them.

`syncRouteCapabilities` closes that gap from provider-confirmed data only. It
reads `GET {ollamaBaseUrl}/v1/models`, whose enriched rows publish
`context_window`, `input_modalities`, `supported_reasoning_levels[].effort` and
`default_reasoning_level`, and fills the route entries that are missing them:

| Route field | Provider field | Mapping |
|---|---|---|
| `contextWindow` | `context_window` | as published |
| `input` | `input_modalities` | restricted to `text`/`image` |
| `reasoningEfforts` | `supported_reasoning_levels[].effort` | key `off` carries wire value `none`; every other level is key and value alike |
| `defaultReasoningEffort` | `default_reasoning_level` | only when the offered levels include it |

The default is a plan: `syncRouteCapabilities` returns `next` and writes
nothing. `{ apply: true }` persists it through the configuration editor, which
validates against the real schema before writing, so an invalid result leaves
the profile untouched. The plan is recomputed inside the editor's own change
callback, so a concurrent owner edit is never reverted.

**A model the route does not declare is adopted, not ignored.** The same listing
reports which models Ollama serves through its API (`supported_in_api` and
`visibility`). A model that is served but absent from the route is appended with
the capabilities above and reported under `adopted`; a model the provider hides
is named under `withheld` and never added, because declaring it would make it
selectable and billable. Appending leaves every existing row in place, so an
owner's ordering survives and a new model never renumbers the selector. A model
released later is picked up the same way: that is the step that lets a new model
reach the selector without hand-editing `cordis.patch.yml`.

**Nothing recorded is overwritten.** A model that already declares
`contextWindow`, `input`, `reasoningEfforts` or `defaultReasoningEffort` keeps
that value, including an explicit `reasoningEfforts: false`. Where the provider
now publishes something different the plan reports a conflict under `conflicts`
and leaves the entry as it is. A model the provider does not publish is named
under `unknown`; a default the offered levels do not include is refused rather
than declared. Applying the same plan twice writes nothing the second time.

The activation sweep calls this before `refreshModelMetadata`, because the
guide reads the adapter's resolved facts: the profile has to carry the
provider's answers before discovery runs.


## Update Models & Pricing

The panel's Update Models & Pricing button runs a staged flow that only
gathers, compares, and records — it never invents and never rewrites owner
curation:

1. Rescan all configured providers through live discovery (cache bypassed).
2. Diff the observation against the saved catalog (`model-catalog.json`):
   added models, removed models (only when the provider listed successfully —
   a failing provider keeps its previous rows marked "not re-verified"),
   and per-fact changes (name, context window, modalities, reasoning set).
3. Record reasoning surfaces verbatim from the provider (no generic ladder is
   assumed) and flag reasoning-set changes as metadata possibly stale.
   Owner native defaults that differ from provider-reported defaults are named
   as review items; owner recommendations are never corrected.
4. Fetch each configured official pricing page, keep the raw bytes + sha256
   as an evidence snapshot, and parse the official model-pricing table
   (section `id="model-pricing"`: exact Model / Input / Cached input / Output
   headers, `$` amounts, a dash meaning "not listed", and published
   ` (Off-Peak)` variant rows). Any header/field/schema change fails closed.
5. Map parsed rates onto the `pricingProviderId` provider's listed ids by
   EXACT name (or a unique library slug); any zero-match or multi-match id
   keeps its previous price. Apply the verified rates — input, cached input,
   output, off-peak when published, `source`, `verifiedAt` — to EXISTING owner
   entries only, never creating one, and record changed values under "Changes
   since last update". Owner recommendations and reasoning settings are never
   touched. On any fetch/parse/mapping/write failure all previous verified
   prices are retained unchanged and the failure is reported.
6. Record newly detected models that have no owner curation as Research
   Needed (their fields stay Unknown; nothing is auto-curated).
7. Write the catalog (with the report as `lastUpdate`) and regenerate
   `MODEL_GUIDE.generated.md`, then show the report and refresh the page.

Observed cost can only come from real reported token counts times stored rates
and is always labeled observed history; absent usage stays absent. The
owner-curated JSON and the curated markdown guide are never written by the
update flow.

Panel actions: Update Models & Pricing, Research Unverified Models,
View Changes Since Last Update, Copy Full Model Guide, Copy Recommended
Routing Guide, and per-model Copy for Prompt.

Copy-for-prompt contracts:

- Copy feedback is scoped to the exact clicked row (state keyed by the row's
  stable `provider/modelId` identity); other rows never react.
- Fields that combine owner and provider data render only the parts that
  exist, joined with "; " — `Context: Owner-configured 32,768; Provider-reported 32,768` —
  and "Unknown" when neither side exists. Literal `null`, `undefined`, `NaN`,
  and `[object Object]` can never reach the copied text (stored values that
  are literally those tokens are treated as absent).
- A positively local model renders `Cloud pricing: N/A — local model; $0
  cloud/API token charge` — no missing-price "Needs Review" implication — and
  the cost note spells out the separate local resource consumption (GPU time,
  VRAM, electricity, local compute availability).
- Owner Customizations always renders explicit states — loading, every
  registered customization with its classification (Installed / Can Restore
  Cleanly / Needs Review / Incompatible), an explicit empty state, a
  missing-file diagnostic, a malformed-file diagnostic, a classified
  service-unavailable diagnostic, and a render-error fallback with a retry
  action (a `getDerivedStateFromError` boundary wraps each registered panel).
  A blank panel is never acceptable.
- Positively local models are excluded from cloud/API pricing research: a
  recorded-local deployment has $0/N/A cloud pricing, so the research request
  covers only official model facts (context, tool/function calling, reasoning
  behavior, modalities).
- Owner data merges by exact `provider/modelId` identity only. A similarly
  named model under another provider never borrows owner pricing or
  recommendations; its unresolved fields stay Unknown / Needs Review.

## Research Unverified Models

This action is read-only at the moment it opens a preflight card, which shows:

1. every model with unresolved capability/pricing fields (`deployment`,
   `modalities`, `reasoning support`, `native/default reasoning behavior`,
   `context size`, `tool/function-calling support`, verbatim `pricing` state);
2. the proposed research executor under the canonical cost-aware routing rule
   (the least expensive capable owner-curated model — a local model first —
   with its local-vs-paid nature and the reasoning level; a paid alternative
   is shown when one exists);
3. an explicit note that research consumes model tokens only if the owner
   runs the copied prompt or approves an agent for it.

`Copy Research Prompt` emits a deterministic prompt: verify only the listed
fields, prefer official provider/vendor sources, never treat an LLM assertion
as authoritative evidence, record source/URL + verification date + verified
value, and never change owner-curated recommendations. Nothing runs a model
automatically. The only writes this feature performs are the verified rates
from Update Models & Pricing — never recommendations.

The panel presents the owner workflow in instructed order: the "What do I do
next?" helper first, then the four numbered steps ("Your workflow — four
steps"), and only then the actions — Step 1 (Update Models & Pricing +
Changes since last update), Step 2 (research scopes with the Recommended
flag + Copy Research Prompt), Step 3 (JSON result field + Review Changes) and
Step 4 (Apply Reviewed Facts), followed by a secondary section "Share / Copy
Guide Information" (Copy Full Model Guide, Copy Recommended Routing Guide)
and then catalog/global content. Per-model cards expose the copied
information as "Copy Model Info", and every copy action confirms with
"Copied — paste it into ChatGPT or DeepSeek." and names its destination.

The "What do I do next?" helper derives from durable state so a refresh never
resets it to Step 1: the merged snapshot carries `researchCounts`
(newly-detected and still-unverified counts computed from the persisted owner
entries over live discovery) and the row inventory itself, so an
up-to-date catalog reads "Everything is up to date. Use Step 1 whenever you
want to check…", unknown progress reads a neutral "Checking your progress…",
and only a truly empty catalog says "Start with Step 1". Session-transient
progress (research results open, review shown, saved) still wins while it
lives; the review-before-apply token flow is untouched.

Review-before-apply is enforced by the host, not just the UI: a successful
"Review Changes" returns a single-use review token bound to the canonical
form of exactly the facts shown; "Apply Reviewed Facts" requires that token;
a direct apply without any review, a stale/bogus token, a payload that no
longer matches the reviewed facts, or a second use of an already-consumed
token all fail closed with a plain-language reason and write nothing. After a
successful apply the token is consumed, so a new save always needs a fresh
review.

The prompt carries three scopes (Research Newly Detected / All Unverified /
Selected Model — checkboxes) — the same machine-importable result contract
that the prompt, the Import placeholder, and the importer share exactly:

- Return JSON only: no Markdown fences, no prose before or after the JSON.
- A JSON array of blocks: `[ { "model": "<exact provider/modelId key>",
  "facts": { "<fact>": { "value": <verified value>,
  "source": "<official URL>", "verifiedAt": "<date>" } } } ]`.
- Importable facts: `contextWindow`, `deployment` (`local`/`cloud`),
  `inputModalities`, `reasoningEfforts`, `reasoningDefault`, `toolSupport`,
  `toolSupportNote`, and — for CLOUD deployments only — `pricing` as the
  canonical record the deterministic parsers already write:
  `{ inputPerMTok, cachedInputPerMTok, outputPerMTok, offPeak?, source,
  verifiedAt }` with finite rates >= 0 or null. Recorded-local models must
  not include pricing and it is rejected if they do.
- Everything else — including every owner recommendation/preference
  (`pricingNote`, `recommendedRoutine`, `recommendedHeavy`, `strengths`,
  `avoid`, `reasoningNote`, `costTier`) — is never importable and is
  rejected by name.

`Review Changes` (Import & Review) validates the pasted JSON against this contract, renders a
flattened review diff (pricing renders per-rate, e.g. `Pricing input: not
listed → $0.28/1M`), and writes nothing. `Apply Verified Facts` is the
explicit owner confirmation: it merges only the validated fact values into
exact provider-qualified owner entries, regenerates the catalog and guide,
and the imported pricing's unresolved research field clears on the next
preflight (the guide then shows the verified rate with its source and
verification date).
## Owner Customizations panel

The page states plainly that checking is safe and changes nothing, presents
Step 1 (Check My Customizations — button label is exactly that; the tooltip
says it checks current status and changes nothing) and Step 2 (Restore if
Needed). Every status carries a one-sentence explanation plus a short
"Next:" action line, and the recovery commands are named for what they REALLY
do — the default command is the dry-run check (`node recover-customizations.mjs`
reports what WOULD be restored and changes nothing), while `--apply`
performs the approved restore; the buttons are "Copy Dry-Run Check Command"
and "Copy Apply Restore Command" with those behaviors spelled out in their
tooltips and a "Destination: Linux terminal." line. The checked timestamp is
shown owner-friendly ("Last checked: Oct 13, 9:44 PM · about 5 hours ago"),
with the exact ISO time kept in the tooltip for diagnostics.

A second read-only panel displays statuses produced by the external recovery
tool (`~/.local/share/liongateos/deepseek-update/customization-status.json`):
Installed / Can Restore Cleanly / Needs Review / Incompatible, with the check
timestamp, each entry's planned restore actions, and the tool's refusal policy
(Needs Review and Incompatible are never applied).

Panel actions: Check My Customizations (reads the external status file; no
writes), Copy Restore Command (`node .../recover-customizations.mjs` — the
tool's own dry-run), and Copy Apply Command (`node .../recover-customizations.mjs --apply`,
to run manually after reviewing the planned actions). Executing the external
recovery tool from the web UI is deliberately refused: the external layer
remains the only restore path, so recovery works even after an update removes
this UI.

## External recovery (Layer A)

`~/.local/share/liongateos/deepseek-update/recover-customizations.mjs` reads
`CUSTOMIZATIONS-MANIFEST.txt`, verifies preserved assets and checksums, and
classifies each entry by inspecting the installed Harness. Dry-run by default;
`--apply` performs only the planned safe actions (e.g. `git apply` of a patch
that verified cleanly). It never forces an incompatible patch.

## Safety

The bundle never restarts the Harness, never touches GPU workloads, never
writes sessions, and never performs model lifecycle operations. The protected
GD GPU boundary is displayed as metadata only.

One subprocess is permitted, and it only reads a component listing: the Strata
detection probe (`strata components engine --output json`) runs as a single
bounded `execFile` with a fixed command and argument vector, no shell, no
interpolation, and a timeout. It reports the installed engine build; it cannot
start, stop, load, unload, update, or reconfigure Strata or any model server.
A test pins both the permission and its limits.

## Tests

`node --test tests/*.test.js` from the package directory covers the overlay,
cost math, guidance text, recommendations, tool read-onlyness, official-price
parsing/refresh fail-closed behavior, research gating, manifest registration,
external-recovery classification, local discovery cache integration (config
validation, all failure modes, malformed-candidate filtering, backward
compatibility), plus the Host service surface, catalog diffing, the update
flow, and guide generation (408 tests).

Five suites cover this release specifically: `tests/ollama-metadata.test.js`
(fact extraction, owner-field mapping, fill-only merging, the sweep's
degradation paths), `tests/auto-refresh.test.js` (one timer, no overlap, a
failure that cannot escape, a disposal that really stops, and an activation run
that neither requires nor starts a recurring timer), `tests/strata-engine.test.js`
(the Strata registry row, both version spaces, and every probe failure mode), the
Strata detection cases in `tests/engine-update.test.js`, and the end-to-end
acceptance cases for `ollama/kimi-k3.1-pro` and `ollama/kimi-k3` in
`tests/ollama-acceptance.test.js`. The Engine Update Advisor adds
`tests/engine-version.test.js` (normalization, prerelease ordering, the verdict
table), `tests/engine-detect.test.js` (every detector, the Strata identity
probe, and the signed update feed including the driver floor),
`tests/engine-advice.test.js` (REVIEW/DEFER/NO_ACTION rules and the prompt
text), `tests/engine-advisor-wiring.test.js` (the catalog records the engine
build and the advice lands on the panel payload), and
`tests/engine-panel.test.js` (the panel renders the Host verdict, the driver
floor and the copy button, and invents nothing when the Host supplies none).
They run against captured provider payloads
(`tests/fixtures/ollama-pricing-20261107.html` is the live pricing page as of
that date) and a stubbed `execFile`, so re-capture the fixtures if the provider
or Strata changes shape.

Tests that write temporary files need a writable `TMPDIR`; with a read-only
`/tmp`, run them as `TMPDIR=/dev/shm/<dir> node --test tests/*.test.js`.