# Model Guide & Cost Router — durable handoff / status

Last updated: 2026-10-22. If this chat session is gone, this file (plus the
README) contains everything needed to continue the project.

**Project-wide current state and next-action authority:** `../PROJECT_STATE.md`

## Status: activated; Phase A-MG LIVE VERIFIED (2026-10-22); LocalFiles display VERIFIED (2026-10-26); canonical bundle synced

### Core bundle — ACTIVATED

Full implementation in `owner/model-guide-cost-router/` — the standard owner
bundle shape used by the Harness:
`index.js` (Host service, Typert remote `modelGuideCostRouter`, endpoints for
snapshot, recommend, apply, tools), `client.js` (Web panel + sidebar entry),
`core/*` (overlay, catalog, guides, guidance-text, output-format, update,
pricing-refresh, research-loop, engine-update, engine-verification,
launch-profile), bilingual dictionaries, `cordis.patch.yml`, icon, README.

The bundle is **activated**: profile row registered, bundle linked, Harness
restarts load it. No further activation is pending.

### Phase A-MG: Shared Local Discovery Cache — LIVE VERIFIED (2026-10-22)

Read-only integration of the LMM GGUF discovery cache into the snapshot flow:

- `index.js` — `validateConfig` accepts an optional `localDiscoveryCachePath`
  (must be absolute, validated with `readOptionalAbsPath` — intentionally does
  NOT use `readOwnerPath`'s directory-containment check, because the cache
  lives outside the owner metadata directory by design).
- `index.js` — exported `parseDiscoveryCacheText(text)` validates the shared
  cache schema (version 1, `roots[].candidates[]` with all required typed
  fields). Returns one of: `ok`, `malformed`, `schema-unsupported`. Malformed
  candidates are silently excluded per-field; valid ones are kept.
- `index.js` — `readLocalDiscoveryCache()` state method: wraps `readTextFile`
  + `parseDiscoveryCacheText`; returns one of: `unconfigured`, `missing`,
  `unreadable`, `ok`, `malformed`, `schema-unsupported`. Never throws.
- `index.js` — `discover()` updated: calls `readLocalDiscoveryCache()` on
  every cache miss; includes `localFiles` in the provider cache entry and in
  the return value. Cache hit path also returns `localFiles`.
- `index.js` — `snapshot()` updated: spreads `localFiles` conditionally
  (`...(discovered.localFiles !== undefined ? { localFiles: discovered.localFiles } : {})`)
  — backward-compatible with existing test stubs that return `discover()`
  without `localFiles`.
- `cordis.patch.yml` — `localDiscoveryCachePath` set to the LMM-written cache:
  `/home/liongateos/.local/share/liongateos/deepseek-update/gguf-discovery-cache.json`

Shared cache contract (produced by `owner/local-model-manager/core/discovery.js`):

```json
{
  "version": 1,
  "generatedAt": "<ISO-8601>",
  "roots": [{
    "root": "<absolute-path>",
    "status": "ok",
    "candidates": [
      { "path": "<abs>", "name": "<str>", "sizeBytes": <n>, "multiPart": <bool>, "totalShards": <n> }
    ],
    "subdirErrors": [],
    "truncated": false
  }]
}
```

**Snapshot field `localFiles` shape:**

```js
// ok
{ status: 'ok', candidates: [...], generatedAt: '<ISO>' }
// failure modes — all safe to render; provider discovery is never affected
{ status: 'unconfigured', candidates: [] }
{ status: 'missing',      candidates: [] }
{ status: 'unreadable',   candidates: [], error: '<msg>' }
{ status: 'malformed',    candidates: [] }
{ status: 'schema-unsupported', candidates: [], schemaVersion: <n> }
```

**LIVE VERIFIED (2026-10-22):** LMM activated and ran its first snapshot at
14:13 UTC. Cache exists at the configured path with version 1, root
`/home/liongateos/models/gguf`, 1 candidate:
`Qwen3.6-35B-A3B-abliterated-v4-Q4_K_M` (21.2 GB). Model Guide reads this
cache on every subsequent snapshot automatically.

**Tests:** `tests/local-discovery.test.js` — 9 tests covering config
validation, all 4 service failure modes, malformed-candidate filtering, and
backward-compat with stubs that omit `localFiles`.

### LocalFiles Display Section — VERIFIED (2026-10-26)

Display-only `localFiles` section in the Model Guide web panel:

- `client.js` — English locale strings (lines 209-227): `localFilesTitle`,
  `localFilesSubtitle`, `localFilesUnconfigured`, `localFilesMissing`,
  `localFilesUnreadable`, `localFilesMalformed`, `localFilesSchemaUnsupported`,
  `localFilesOk`, `localFilesGeneratedAt`, `localFilesCandidates`,
  `localFilesNoCandidates`, `localFilesMultiPart`, `localFilesSinglePart`,
  `localFilesShards`, `localFilesSize`, `localFilesPath`, `localFilesCachePath`.
- `client.js` — Chinese locale strings (lines 425-443): same keys, translated.
- `client.js` — `LocalFilesSection` component (lines 1229-1288): renders
  status banner with appropriate tone (success/warn/error), formats sizes in
  KB/MB/GB, displays candidate cards with name, multi-part badge, shard count,
  size, and path.
- `client.js` — Render tree integration (line 1016):
  `state.status === 'ready' ? h(LocalFilesSection, { localFiles: state.data?.localFiles, t }) : null`

**Display behavior:**
- Shows section only when `state.status === 'ready'` (data loaded).
- Handles all 6 status values: `ok`, `unconfigured`, `missing`, `unreadable`,
  `malformed`, `schema-unsupported` — all render safely without breaking the panel.
- Displays cache generation timestamp when available.
- Empty state shown when no candidates exist.
- Candidate cards show: name (bold), multi-part/single-part badge, shard count
  (if multi-part), size in human-readable format, and full path.

**Tests:** All 9 local discovery tests pass, verifying the backend `localFiles`
snapshot field. Panel rendering tests exercise the `LocalFilesSection` component
through the existing `render-harness.js` infrastructure (integrated with the
baseline 228 tests).

**Pre-existing bug fixed:** `tests/manifest-recovery.test.js` — trailing `/`
added to `dirname` in the `new URL('..', ...)` call. Without the slash,
Node URL resolves one level too high (to `owner/` instead of
`model-guide-cost-router/`), accidentally scanning LMM source files.

## Tests

`cd owner/model-guide-cost-router && node --test tests/*.test.js`

Current result (2026-10-26): **227/228 passing, 1 pre-existing failure.**

The failing test (`tests/manifest-recovery.test.js`: "manifest registration
preserves the historical entries and adds the two bundles") is a pre-existing
issue unrelated to the LocalFiles display work. It checks a file path pattern
in the CUSTOMIZATIONS-MANIFEST.txt that was never updated after the canonical
bundle sync. All 9 local discovery tests pass, and all Model Guide functionality
tests pass.

All disk/network/spawn/GPU access is stubbed; no inference, no GPU work, and
no destructive runtime action is ever executed by the tests.

## Preservation

- Worktree: `owner/model-guide-cost-router/` on branch `voice-dictation-test`.
  Changes are untracked/unstaged (not committed — push is out of scope without
  owner authorization). Last commit on branch: `538e93c`.
- Canonical copy synced (2026-10-22): all 44 source files copied to
  `~/.local/share/liongateos/deepseek-update/customizations/model-guide-cost-router/`.
  `SHASUMS-v1.sha256` generated (44 entries). CUSTOMIZATIONS-MANIFEST.txt
  entry 3 updated with `sha256: b515547264f2e4f8b9ab98206f63055047ba113adc50372da727be476a614aed`.

## Known next work items (each needs owner approval where marked)

1. **Canonical bundle sync** — sync `owner/model-guide-cost-router/` to
   `~/.local/share/liongateos/deepseek-update/customizations/model-guide-cost-router/`
   and register in CUSTOMIZATIONS-MANIFEST.txt (separate from Phase A-MG; no
   functional change; needs owner approval for the sync step).
2. ~~**Local files panel section** — surface `localFiles` from the snapshot in
   the Web UI (not in scope for Phase A-MG; needs owner approval).~~
    **COMPLETED (2026-10-26)**: `LocalFilesSection` component displays all
    `localFiles` snapshot data with status banners, size formatting, and
    candidate cards. All 6 status values render safely.
3. **LMM activation** — when LMM activates and runs its first snapshot, the
   discovery cache will be created and this bundle will start seeing GGUF
   candidates automatically, no further change needed here.

## Deferred (not in scope without further approval)

- Broader automatic discovery: cloud-model discovery, Ollama.com enumeration.
  OneProvider (2026-11-08) is a concrete instance of this gap rather than a
  hypothetical one: two routes are live (`oneprovider`, 59 text models;
  `oneprovider-anthropic`, 13 Claude vision models) with no curation rows, and
  the existing Ollama capability bridge cannot serve them — it fetches
  `${ollamaBaseUrl}/v1/models`, `readBaseUrl` refuses non-`https://` hosts, and
  `factsFromModelsListing` parses Ollama's `models[]` shape. The 6-hourly
  auto-refresh calls `applyRouteConfig` with `apply: true`, which
  read-modify-writes the entire `llm-pi-ai.providers` dict. Treat OneProvider
  pricing/reasoning work as new design, not as reuse. Project-wide record:
  `../PROJECT_STATE.md` § OneProvider integration — VERIFIED / ACCEPTED.
- Adjustable-reasoning metadata for OneProvider: the vendor publishes no
  per-request reasoning field (`reasoning_effort`, `thinking`, `budget_tokens`
  occur zero times in its docs bundle) and no capability flag in `GET
  /v1/models`. `core/route-capabilities.js` reads `supported_reasoning_levels`
  from an OpenRouter-style listing and `index.js:669` fetches only
  `${ollamaBaseUrl}/v1/models`, so nothing here can carry it either. Owner
  decision 2026-11-08: **HOLD** until the provider answers whether the field is
  accepted and which ids take it. Detail lives in `../PROJECT_STATE.md` §
  Reasoning controls — investigated, HOLD; do not re-investigate from this
  bundle.
- Any change that requires modifying LMM (separate bundle boundary).
- Any write to the discovery cache (this bundle is strictly read-only relative
  to the cache file).

## Ollama metadata repair (2026-11-07)

Three defects were repaired, plus the bounded refresh that was previously
deferred work.

**B — one bad price row killed every rate.** `parseOllamaModelPricing` failed
the entire page on a single unparseable cell. The live page publishes `clef` as
`$0.24 / - / -` and `mistral-large-3` as `$0.50 / - / $1.50`, so the whole
table — including valid rows — was rejected and no owner entry was ever
updated. The parser now treats a dash in ANY of the three price cells as an
explicit `null` (a published absence, never zero) and keeps failing closed on
anything else: a non-price, non-dash cell still aborts with
`is neither a dollar price nor a dash`. Verified against the live page: 25 rows
parse, `clef` → `{input:0.24, cached:null, output:null}`.

**C — researched models reported unresearched forever.** `unresolvedFieldsFor`
tested `owner.tools`, but the owner record field is `toolSupport`; it also
tested a flat `model.contextWindow`, while the merge exposes
`context.providerReported` / `context.ownerConfigured` and the owner file stores
`contextConfigured`. Both checks now read the real fields, so an audited entry
stops claiming it needs research. `ollama/kimi-k3` now reports only
`['context size']` (it genuinely lacks a recorded context), and is fully
resolved once enrichment fills it.

**A — capability enrichment (new).** `core/ollama-metadata.js` reads the
provider's own `POST /api/show` answer: context from
`model_info['<architecture>.context_length']`, modalities and tools from
`capabilities`, reasoning levels and native default from `thinking.values` /
`thinking.default`. `planFactMerge` is FILL-ONLY: a recorded value is an audit
result, never a cache, so it is reported as a discrepancy and not overwritten.
New models are filled completely, which is what removes the manual step.

**D — bounded automatic refresh (new).** `core/auto-refresh.js` is one timer,
one run at a time, rejections caught, handle `unref`'d, and `stop()` marking the
controller dead so a reload cannot orphan it. `apply()` disposes it through
`ctx.effect`. **`autoRefresh` defaults to `false`**: nothing is scheduled until
the owner turns it on. When enabled it also refreshes on
`loader/volatile-update`, the model-adapter-changed signal.

**E — the reasoning control is a profile seam, not core.** The DSH effort list
comes only from `llm-pi-ai.providers.<id>.models[].reasoningEfforts` in the
profile patch (`packages/llm/llm-pi-ai/src/catalog.ts` `resolveModelReasoning` →
`packages/llm/llm-pi-ai/src/adapter.ts` `reasoningInfo`). Owner metadata cannot
reach it. So `kimi-k3.1-pro`, which has only `id`+`name` in the profile, shows
no reasoning control even after enrichment. The smallest separate repair is a
one-block addition to that profile:

```yaml
- id: kimi-k3.1-pro
  name: kimi-k3.1-pro
  reasoningEfforts:
    off: null
    low: low
    medium: medium
    high: high
    max: max
```

That is the same shape its 17 configured siblings already use, and it needs no
DSH change. The values are exactly `thinking.values` from `/api/show`, so the
enrichment report can supply them verbatim; nothing here is guessed.

Tests: 266, with the one pre-existing `manifest-recovery` failure unchanged.
New: `tests/ollama-metadata.test.js` (17), `tests/auto-refresh.test.js` (10),
`tests/ollama-acceptance.test.js` (11).
