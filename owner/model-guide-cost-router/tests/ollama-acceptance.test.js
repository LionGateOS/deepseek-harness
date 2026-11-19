/**
 * End-to-end acceptance for the two named Ollama Cloud models.
 *
 * These drive the real host service against captured provider answers, so the
 * whole path is exercised: `/api/tags` → `/api/show` → fact extraction → the
 * owner metadata file → the research-status report → the pricing table. The
 * captured payloads are the ones `https://ollama.com` actually returned on
 * 2026-11-07; if the provider changes shape, the parsers fail loudly rather
 * than inventing values, and these fixtures need re-capturing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createModelGuideService } from '../index.js'
import { parseOllamaModelPricing, mapOllamaRates, rateRecordFromRow } from '../core/ollama-pricing.js'
import { unresolvedFieldsFor } from '../core/research.js'

// The live page captured on 2026-11-07. A separate fixture, not the older one:
// that one predates `kimi-k3.1-pro` and is pinned by the pricing-refresh tests,
// so overwriting it would change what those assert.
const PRICING_HTML = readFileSync(fileURLToPath(new URL('./fixtures/ollama-pricing-20261107.html', import.meta.url)), 'utf8')
const STAMP = '2026-11-07T20:00:00.000Z'

/** The `POST /api/show` answer for `kimi-k3.1-pro`, captured 2026-11-07. */
const SHOW_KIMI_3_1_PRO = {
  capabilities: ['vision', 'thinking', 'completion', 'tools'],
  details: { parent_model: 'kimi-k3.1-pro', family: 'kimi-k3', parameter_size: '2812000000000', quantization_level: 'MXFP4' },
  model_info: { 'general.architecture': 'kimi-k3', 'kimi-k3.context_length': 1048576, 'kimi-k3.embedding_length': 7168 },
  modified_at: '2026-11-04T08:00:00-05:00',
  thinking: { values: [false, 'low', 'medium', 'high', 'max'], default: 'max' },
}

/** The `POST /api/show` answer for `kimi-k3`, captured 2026-11-07. */
const SHOW_KIMI_3 = {
  capabilities: ['vision', 'thinking', 'completion', 'tools'],
  details: { parent_model: 'kimi-k3', family: 'kimi-k3', parameter_size: '1620000000000', quantization_level: 'MXFP4' },
  model_info: { 'general.architecture': 'kimi-k3', 'kimi-k3.context_length': 1048576 },
  modified_at: '2026-10-13T08:00:00-05:00',
  thinking: { values: [false, 'low', 'high', 'max'], default: 'max' },
}

/** A model that publishes no reasoning levels at all. */
const SHOW_NO_THINKING = {
  capabilities: ['completion', 'tools'],
  details: { family: 'qwen2' },
  model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 },
  thinking: { values: [] },
}

const TAGS = { models: [{ name: 'kimi-k3.1-pro' }, { name: 'kimi-k3' }, { name: 'qwen-plain' }] }

/**
 * A service over a captured provider and an in-memory owner file.
 * @param {object} ownerData the starting owner metadata document.
 * @param {object} [options] `shows` overrides, `tags` override, `offline`, and extra state.
 */
const serviceOver = (ownerData, options = {}) => {
  const writes = []
  const fetches = []
  const shows = options.shows ?? { 'kimi-k3.1-pro': SHOW_KIMI_3_1_PRO, 'kimi-k3': SHOW_KIMI_3, 'qwen-plain': SHOW_NO_THINKING }
  const state = {
    config: {
      ownerMetadataPath: '/x/owner-model-guidance.json',
      catalogPath: '/x/model-catalog.json',
      guideGeneratedPath: '/x/MODEL_GUIDE.generated.md',
      engineCatalogPath: '/x/engine-catalog.json',
      maxPriceAgeDays: 90,
      providerQueryTimeoutMs: 1000,
      providerCacheMs: 60_000,
      fetchTimeoutMs: 1000,
      maxCatalogHistory: 5,
      maxEngineCheckAgeDays: 7,
      pricingCheckUrls: ['https://ollama.com/pricing'],
      pricingProviderId: 'ollama',
      ollamaBaseUrl: 'https://ollama.com',
      metadataEnrichment: true,
      autoRefresh: false,
      autoRefreshHours: 6,
      refreshOnActivation: true,
    },
    cache: undefined,
    mergeSnapshot: (owner, discovered) => ({ ...owner, providers: discovered.providers, curatedOnly: [] }),
    readOwnerMetadata: async () => ({ status: 'ok', data: ownerData }),
    readJsonFile: async () => ({ status: 'missing' }),
    readTextFile: async () => ({ status: 'missing' }),
    writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
    writeTextFile: async () => 'ok',
    fetchPageSnapshot: async (url) => ({ url, status: 'fetched', fetchedAt: STAMP, bytes: PRICING_HTML.length, body: PRICING_HTML }),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: STAMP, error: 'offline' }),
    detectInstalledVersion: async () => null,
    fetchJson: async (url, init = {}) => {
      fetches.push({ url, init })
      if (options.offline === true) return { status: 'failed', error: 'EAI_AGAIN offline' }
      if (url.endsWith('/api/tags')) return { status: 'ok', value: options.tags ?? TAGS }
      if (url.endsWith('/api/show')) {
        const body = JSON.parse(init.body ?? '{}')
        const record = shows[body.model]
        return record === undefined
          ? { status: 'failed', error: 'HTTP 404' }
          : { status: 'ok', value: record }
      }
      return { status: 'failed', error: `unexpected url ${url}` }
    },
    // Persist into the owner document the same way the real writer does, so a
    // second sweep sees the first sweep's result instead of re-writing it.
    // The pricing writer is a separate path from the facts writer, exactly as
    // in the shipped state, so both are recorded here.
    applyOwnerPricing: async (rates) => {
      writes.push(rates)
      for (const [key, pricing] of Object.entries(rates)) {
        ownerData.models[key] = { ...(ownerData.models[key] ?? {}), pricing }
      }
      return 'ok'
    },
    applyOwnerFacts: async (facts) => {
      writes.push(facts)
      for (const [key, fields] of Object.entries(facts)) {
        ownerData.models[key] = { ...(ownerData.models[key] ?? {}), ...fields }
      }
      return 'ok'
    },
    // The pricing path maps published rows against the DISCOVERED model ids,
    // so the stub has to list the models it means to price.
    discover: async () => ({ providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [
      { id: 'kimi-k3', name: 'kimi-k3' },
      { id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' },
    ] }] }),
    ...options.state,
  }
  return { service: createModelGuideService(state), writes, fetches }
}

/** The `ollama/kimi-k3` entry exactly as the owner curates it today. */
const CURATED_KIMI_3 = {
  localVsCloud: 'cloud',
  modalities: ['text', 'image'],
  toolSupport: true,
  reasoningModes: ['Off', 'Low', 'High', 'Max'],
  nativeReasoningDefault: 'Max',
  recommendedRoutine: 'High',
  recommendedHeavy: 'Max',
  strengths: ['long-context synthesis', 'careful multi-step reasoning', 'large document review'],
  avoid: ['cheap bulk classification', 'latency-critical chat'],
  reasoningNote: 'Audited against Ollama Cloud reasoning metadata.',
  evidence: 'Ollama Cloud metadata reasoning audit 2026-10-13',
  pricing: { inputPerMTok: 3, cachedInputPerMTok: 0.3, outputPerMTok: 15, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-13' },
  costTier: 'Very Expensive',
}

// ---------------------------------------------------------------------------
// ollama/kimi-k3.1-pro — a model nobody has curated yet.
// ---------------------------------------------------------------------------

test('acceptance: ollama/kimi-k3.1-pro is recognised as a cloud model and fully enriched', async () => {
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': CURATED_KIMI_3 } })
  const report = await service.refreshModelMetadata(undefined)

  assert.equal(report.status, 'updated')
  const row = report.models.find((entry) => entry.key === 'ollama/kimi-k3.1-pro')
  assert.ok(row !== undefined, 'the new model appears in the report')
  assert.equal(row.status, 'filled')

  const written = writes.find((batch) => batch['ollama/kimi-k3.1-pro'] !== undefined)['ollama/kimi-k3.1-pro']
  // Deployment: cloud, because the configured provider is the official service.
  assert.equal(written.localVsCloud, 'cloud')
  // Context: sourced from model_info, not from prose on a library page.
  assert.equal(written.contextConfigured, 1048576)
  // Vision and tools both come from `capabilities`.
  assert.deepEqual(written.modalities, ['text', 'image'])
  assert.equal(written.toolSupport, true)
  // Reasoning levels and the native default come from `thinking`, verbatim.
  assert.deepEqual(written.reasoningModes, ['Off', 'Low', 'Medium', 'High', 'Max'])
  assert.equal(written.nativeReasoningDefault, 'Max')
  // Nothing subjective is ever invented by an enrichment pass.
  for (const field of ['strengths', 'avoid', 'recommendedRoutine', 'recommendedHeavy', 'reasoningNote', 'costTier']) {
    assert.equal(written[field], undefined, `${field} must never be written by enrichment`)
  }
})

test('acceptance: the kimi-k3.1-pro facts carry a source URL and a verification timestamp', async () => {
  const { service } = serviceOver({ models: {} })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.source, 'https://ollama.com')
  assert.match(report.verifiedAt, /^\d{4}-\d{2}-\d{2}T/)
  // The provenance is what makes the fact auditable later.
  assert.match(report.note, /provider-published/)
})

test('acceptance: kimi-k3.1-pro pricing is published, mapped, and carries provenance', () => {
  const parsed = parseOllamaModelPricing(PRICING_HTML)
  assert.equal(parsed.ok, true, 'the live page parses even with per-model dashes')
  const mapped = mapOllamaRates(parsed.table, ['kimi-k3.1-pro'])
  assert.deepEqual(mapped.unmatched, [])
  assert.deepEqual(mapped.ambiguous, [])
  const rates = rateRecordFromRow(mapped.mapped['kimi-k3.1-pro'], 'https://ollama.com/pricing', STAMP)
  assert.equal(rates.inputPerMTok, 2)
  assert.equal(rates.cachedInputPerMTok, 0.2)
  assert.equal(rates.outputPerMTok, 10)
  assert.equal(rates.source, 'https://ollama.com/pricing')
  assert.equal(rates.verifiedAt, STAMP)
})

test('acceptance: enrichment and pricing together leave no research line for kimi-k3.1-pro', async () => {
  const owner = { models: {} }
  const { service, writes } = serviceOver(owner)
  await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  const enriched = writes.at(-1)['ollama/kimi-k3.1-pro']
  const parsed = parseOllamaModelPricing(PRICING_HTML)
  const rates = rateRecordFromRow(mapOllamaRates(parsed.table, ['kimi-k3.1-pro']).mapped['kimi-k3.1-pro'], 'https://ollama.com/pricing', STAMP)

  const fields = unresolvedFieldsFor(
    { id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' },
    { ...enriched, pricing: rates },
    () => 'fresh',
  )
  assert.deepEqual(fields.fields, [], 'a fully enriched and priced model is not reported unresearched')
})

// ---------------------------------------------------------------------------
// ollama/kimi-k3 — the entry the owner already audited by hand.
// ---------------------------------------------------------------------------

test('acceptance: ollama/kimi-k3 keeps every hand-written field and gains only missing facts', async () => {
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': CURATED_KIMI_3 } })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3'] })

  const row = report.models.find((entry) => entry.key === 'ollama/kimi-k3')
  assert.ok(row !== undefined)
  // The only fact this entry lacks is the context size, so that is all it gets.
  assert.equal(row.status, 'filled')
  assert.deepEqual(row.filled, ['contextConfigured'])
  const written = writes.find((batch) => batch['ollama/kimi-k3'] !== undefined)['ollama/kimi-k3']
  assert.deepEqual(Object.keys(written), ['contextConfigured'])
  assert.equal(written.contextConfigured, 1048576)

  // Every curated value is untouched: the write payload simply does not carry
  // them, and `applyOwnerFacts` merges rather than replaces.
  for (const field of Object.keys(CURATED_KIMI_3)) {
    assert.equal(written[field], undefined, `${field} is left exactly as the owner recorded it`)
  }
  // The provider publishes exactly the levels the owner audited, so the list
  // agrees and is neither rewritten nor reported as a discrepancy.
  assert.deepEqual(row.kept, [], 'a curated entry that agrees with the provider reports nothing')
  assert.equal(report.models[0].filled.includes('reasoningModes'), false)
})

test('acceptance: a second sweep of kimi-k3 writes nothing at all', async () => {
  // Idempotence is the property that makes a six-hourly refresh safe: once the
  // facts are recorded, the next run must be a no-op rather than a rewrite.
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': CURATED_KIMI_3 } })
  await service.refreshModelMetadata({ models: ['kimi-k3'] })
  const afterFirst = writes.length
  const second = await service.refreshModelMetadata({ models: ['kimi-k3'] })
  assert.equal(writes.length, afterFirst, 'the second sweep performs no write')
  assert.equal(second.status, 'unchanged')
  assert.equal(second.models[0].status, 'unchanged')
})

test('acceptance: kimi-k3 pricing is refreshed from the published table with provenance', async () => {
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': CURATED_KIMI_3 } })
  const report = await service.updateModelsAndPricing()
  assert.ok(report !== undefined)
  // `applyOwnerPricing` takes a rate record per key and attaches it to the
  // entry itself, so the payload is the rates, not a `pricing` wrapper.
  const update = writes.find((batch) => batch['ollama/kimi-k3']?.inputPerMTok !== undefined)
  assert.ok(update !== undefined, 'the published rates reach the curated entry')
  const rates = update['ollama/kimi-k3']
  assert.equal(rates.inputPerMTok, 3)
  assert.equal(rates.cachedInputPerMTok, 0.3)
  assert.equal(rates.outputPerMTok, 15)
  assert.equal(rates.source, 'https://ollama.com/pricing')
})

// ---------------------------------------------------------------------------
// Degradation.
// ---------------------------------------------------------------------------

test('acceptance: a model with no published reasoning levels gets no reasoning fields', async () => {
  const { service, writes } = serviceOver({ models: {} })
  await service.refreshModelMetadata({ models: ['qwen-plain'] })
  const written = writes.at(-1)['ollama/qwen-plain']
  assert.equal(written.reasoningModes, undefined, 'no level is invented for a model that publishes none')
  assert.equal(written.nativeReasoningDefault, undefined)
  // Its other facts are still recorded.
  assert.equal(written.contextConfigured, 32768)
  assert.equal(written.toolSupport, true)
})

test('acceptance: an offline provider fails cleanly and writes nothing', async () => {
  // A curated entry gives the sweep something to read, so the offline path is
  // the provider being unreachable rather than there being nothing to do.
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': CURATED_KIMI_3 } }, { offline: true })
  const report = await service.refreshModelMetadata(undefined)
  assert.equal(report.status, 'failed')
  assert.equal(writes.length, 0, 'an unreachable provider never produces a partial write')
  assert.match(report.reason ?? '', /could not be read|could not be reached|EAI_AGAIN/)
})

test('acceptance: a missing price cell for one model cannot hide another model rate', () => {
  // `clef` publishes only an input rate; before the repair that single row
  // aborted the whole page and kimi-k3.1-pro lost its valid rate with it.
  const parsed = parseOllamaModelPricing(PRICING_HTML)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.table.clef.row.inputPerMTok, 0.24)
  assert.equal(parsed.table.clef.row.cachedInputPerMTok, null)
  assert.equal(parsed.table.clef.row.outputPerMTok, null)
  assert.equal(parsed.table['kimi-k3.1-pro'].row.outputPerMTok, 10)
})

test('acceptance: owner curation outranks the provider on every field it records', async () => {
  // An owner who deliberately recorded a different context and a different
  // default keeps both; the provider answer is reported, not applied.
  const entry = {
    ...CURATED_KIMI_3,
    contextConfigured: 524288,
    reasoningModes: ['Off', 'Max'],
    nativeReasoningDefault: 'Max',
  }
  const { service, writes } = serviceOver({ models: { 'ollama/kimi-k3': entry } })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3'] })
  assert.equal(report.models[0].status, 'unchanged')
  assert.equal(writes.length, 0, 'a fully curated entry is never rewritten')
  const kept = Object.fromEntries(report.models[0].kept.map((row) => [row.field, row]))
  assert.equal(kept.contextConfigured.recorded, 524288)
  assert.equal(kept.contextConfigured.published, 1048576)
  assert.deepEqual(kept.reasoningModes.recorded, ['Off', 'Max'])
})

// ---------------------------------------------------------------------------
// Activation refresh: the switch the owner actually sets.
// ---------------------------------------------------------------------------

test('acceptance: refreshOnActivation enriches kimi-k3.1-pro without recurring traffic', async () => {
  // The owner's coded defaults are autoRefresh:false, refreshOnActivation:true.
  // A startup sweep must therefore reach the enrichment path on its own; the
  // scheduler only decides WHEN to call this, never whether facts are written.
  const owner = { models: {} }
  const { service, writes } = serviceOver(owner)
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'updated')
  assert.equal(writes.length, 1, 'one sweep writes one batch')
  assert.equal(writes[0]['ollama/kimi-k3.1-pro'].contextConfigured, 1048576)

  // A second sweep over the same provider answer is idempotent.
  const second = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(second.models[0].status, 'unchanged')
  assert.equal(writes.length, 1, 'nothing is rewritten when the recorded facts already agree')
})

test('acceptance: an enrichment sweep is refused when the owner turned enrichment off', async () => {
  const { service, writes } = serviceOver({ models: {} })
  // Flip the owner switch on the captured state, the way a config change would.
  service.state.config.metadataEnrichment = false
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'disabled')
  assert.equal(writes.length, 0, 'a disabled enrichment pass writes nothing')
})
