/**
 * Official Ollama price refresh: the Update Models & Pricing flow must parse
 * the official pricing table, map rates by exact match only, apply them to
 * EXISTING owner entries, and fail closed — retaining every previous verified
 * price on any fetch, parse, mapping, or write failure. Uses the captured
 * live fixture of https://ollama.com/pricing so the parser contract is the
 * real published page, not an invented idealization.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseOllamaModelPricing, mapOllamaRates, rateRecordFromRow } from '../core/ollama-pricing.js'
import { createModelGuideService } from '../index.js'

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/ollama-pricing.html', import.meta.url)), 'utf8')

const stubState = (ownerData, overrides = {}) => ({
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
  },
  cache: undefined,
  mergeSnapshot: (owner, discovered) => ({ ...owner, providers: discovered.providers, curatedOnly: [] }),
  readOwnerMetadata: async () => ({ status: 'ok', data: ownerData }),
  readJsonFile: async () => ({ status: 'missing' }),
  readTextFile: async () => ({ status: 'missing' }),
  writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
  writeTextFile: async () => 'ok',
  fetchPageSnapshot: async (url) => ({ url, status: 'fetched', fetchedAt: 't', bytes: FIXTURE.length, body: FIXTURE }),
  fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
  detectInstalledVersion: async () => null,
  discover: async () => ({
    providers: [
      { id: 'qwen-local', name: 'Qwen Local', models: [{ id: '/models/q8.gguf', name: 'Qwen 27B', contextWindow: 131072 }] },
      { id: 'ollama', name: 'Ollama Cloud', models: [
        { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
      ] },
    ],
  }),
  ...overrides,
})

test('the official page parses into exact-name rows with cached-input and off-peak variants', () => {
  const parsed = parseOllamaModelPricing(FIXTURE)
  assert.equal(parsed.ok, true)
  // The live official page publishes these exact rows; counts change upstream,
  // but the parsed shapes must not.
  assert.ok(Object.keys(parsed.table).length > 10)
  const glm = parsed.table['glm-5.3-flash']
  assert.deepEqual({ name: glm.row.name, slug: glm.row.slug, input: glm.row.inputPerMTok, cached: glm.row.cachedInputPerMTok, output: glm.row.outputPerMTok },
    { name: 'glm-5.3-flash', slug: 'glm-5.3-flash', input: 0.15, cached: 0.03, output: 0.5 })
  const offPeak = parsed.table['deepseek-v4.1-flash'].offPeak
  assert.deepEqual({ input: offPeak.inputPerMTok, cached: offPeak.cachedInputPerMTok, output: offPeak.outputPerMTok },
    { input: 0.15, cached: 0.003, output: 0.6 })
  assert.equal(parsed.offPeakNote.includes('Off-peak'), true)
})

test('a not-listed cached-input dash parses as explicitly null, never zero', () => {
  const parsed = parseOllamaModelPricing(FIXTURE)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.table['mistral-large-3'].row.cachedInputPerMTok, null)
  assert.equal(parsed.table['mistral-large-3'].row.inputPerMTok, 0.5)
})

test('mapping is exact: an id matching several published rows is rejected as ambiguous', () => {
  const { ok, table } = parseOllamaModelPricing(FIXTURE)
  assert.equal(ok, true)
  const mapped = mapOllamaRates(table, ['glm-5.3-flash', 'gpt-oss'])
  assert.deepEqual(Object.keys(mapped.mapped).sort(), ['glm-5.3-flash'])
  assert.deepEqual(mapped.unmatched, [])
  assert.equal(mapped.ambiguous.length, 1)
  assert.equal(mapped.ambiguous[0].id, 'gpt-oss')
  assert.match(mapped.ambiguous[0].reason, /several display names/)
})

test('rate records carry source and verifiedAt and never invent reasoning multipliers', () => {
  const { ok, table } = parseOllamaModelPricing(FIXTURE)
  const mapped = mapOllamaRates(table, ['deepseek-v4.1-flash']).mapped
  const rates = rateRecordFromRow(mapped['deepseek-v4.1-flash'], 'https://ollama.com/pricing', '2026-10-13T20:00:00Z')
  assert.deepEqual(rates, {
    inputPerMTok: 0.3,
    cachedInputPerMTok: 0.006,
    outputPerMTok: 1.2,
    offPeak: { inputPerMTok: 0.15, cachedInputPerMTok: 0.003, outputPerMTok: 0.6 },
    source: 'https://ollama.com/pricing',
    verifiedAt: '2026-10-13T20:00:00Z',
  })
  assert.equal(Object.keys(rates).includes('reasoningLowPerMTok'), false)
})

test('update refreshes verified dollar rates for existing owner entries and reports the changes', async () => {
  const writes = []
  const service = createModelGuideService(stubState({
    routingRule: 'cheap first',
    models: {
      'ollama/glm-5.3-flash': {
        localVsCloud: 'cloud',
        recommendedRoutine: 'Medium',
        pricing: { inputPerMTok: 1.0, cachedInputPerMTok: null, outputPerMTok: 4.0, source: 'old', verifiedAt: '2026-01-01', verifiedBy: 'owner' },
      },
    },
  }, {
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  const result = await service.updateModelsAndPricing()
  assert.equal(result.report.pricingRefresh.status, 'updated')
  assert.equal(result.report.pricingRefresh.source, 'https://ollama.com/pricing')
  // Price-change detection, including the cached-input change:
  assert.deepEqual(result.report.priceChanges, [{
    key: 'ollama/glm-5.3-flash',
    changes: [
      { field: 'inputPerMTok', from: 1.0, to: 0.15 },
      { field: 'cachedInputPerMTok', from: null, to: 0.03 },
      { field: 'outputPerMTok', from: 4.0, to: 0.5 },
    ],
  }])
  // Exactly one applied write, keyed to the existing owner entry only.
  assert.equal(writes.length, 1)
  const writeEntry = writes[0]['ollama/glm-5.3-flash']
  assert.equal(writeEntry.inputPerMTok, 0.15)
  assert.equal(writeEntry.cachedInputPerMTok, 0.03)
  assert.equal(writeEntry.outputPerMTok, 0.5)
  assert.equal(writeEntry.verifiedAt, result.report.generatedAt)
  assert.equal(writeEntry.source, 'https://ollama.com/pricing')
  // Snapshots stay body-free evidence records.
  assert.equal(result.report.pricingSnapshots[0].ok, true)
  assert.equal(result.report.pricingSnapshots[0].body, undefined)
})

test('owner recommendations survive the pricing write — only the pricing field changes', async () => {
  const writes = []
  const ownerEntry = { localVsCloud: 'cloud', recommendedRoutine: 'Medium', strengths: ['agentic coding'], pricing: { inputPerMTok: 1.0, outputPerMTok: 4.0 } }
  const service = createModelGuideService(stubState({
    models: { 'ollama/glm-5.3-flash': ownerEntry },
  }, {
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  await service.updateModelsAndPricing()
  // The reference passed to the writer is a fresh object built inside the
  // service; the recommendation fields it carries come from the stored entry,
  // and the write itself is captured whole. Assert the shape stays flat rates.
  assert.equal(Object.keys(writes[0]['ollama/glm-5.3-flash']).sort().join(','), 'cachedInputPerMTok,inputPerMTok,outputPerMTok,source,verifiedAt')
})

test('a changed pricing schema fails closed and retains previously verified rates', async () => {
  const writes = []
  const brokenPage = '<html><section id="model-pricing"><table><thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead><tbody><tr><td><a href="/library/x">x</a></td><td>free</td><td>free</td><td>free</td></tr></tbody></table>'
  const service = createModelGuideService(stubState({
    models: { 'ollama/glm-5.3-flash': { pricing: { inputPerMTok: 0.15, cachedInputPerMTok: 0.03, outputPerMTok: 0.5, verifiedAt: '2026-10-01' } } },
  }, {
    fetchPageSnapshot: async (url) => ({ url, status: 'fetched', fetchedAt: 't', bytes: 10, body: brokenPage }),
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  const result = await service.updateModelsAndPricing()
  assert.equal(result.report.pricingRefresh.status, 'failed')
  assert.equal(writes.length, 0)
  const note = result.report.notes.find((entry) => entry.kind === 'pricing-refresh-failed')
  assert.match(note.message, /official pricing source could not be verified/)
  assert.match(note.message, /retained/)
  // The report still carries the snapshot as evidence of the failed parse.
  assert.equal(result.report.pricingSnapshots[0].ok, true)
})

test('a schema change to the official headers fails closed before any mapping', () => {
  const changed = parseOllamaModelPricing('<section id="model-pricing"><table><thead><tr><th>Name</th><th>Price</th></tr></thead></table></section>')
  assert.equal(changed.ok, false)
  assert.match(changed.reason, /headers changed/)
})

test('an unfetchable official source fails closed and retains rates', async () => {
  const writes = []
  const service = createModelGuideService(stubState({
    models: { 'ollama/glm-5.3-flash': { pricing: { inputPerMTok: 0.15, cachedInputPerMTok: 0.03, outputPerMTok: 0.5, verifiedAt: '2026-10-01' } } },
  }, {
    fetchPageSnapshot: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'HTTP 503' }),
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  const result = await service.updateModelsAndPricing()
  assert.equal(result.report.pricingRefresh.status, 'failed')
  assert.equal(writes.length, 0)
  assert.equal(result.report.priceChanges.length, 0)
  assert.equal(result.report.pricingSnapshots[0].ok, false)
})

test('rates for a parsed source that matches NO owner entry are retained, not created', async () => {
  const writes = []
  const service = createModelGuideService(stubState({
    models: { 'qwen-local//models/q8.gguf': { localVsCloud: 'local' } },
  }, {
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  const result = await service.updateModelsAndPricing()
  assert.equal(result.report.pricingRefresh.status, 'retained')
  assert.match(result.report.pricingRefresh.reason, /no owner-curated models matched/)
  assert.equal(writes.length, 0)
})

test('newly detected models with no owner curation become Research Needed, never auto-curated', async () => {
  const service = createModelGuideService(stubState(
    { routingRule: 'cheap first', models: {} },
    {
      discover: async () => ({
        providers: [
          { id: 'ollama', name: 'Ollama Cloud', models: [
            { id: 'brand-new-model', name: 'Brand New', contextWindow: 40960 },
          ] },
        ],
      }),
    },
  ))
  const result = await service.updateModelsAndPricing()
  assert.deepEqual(result.report.researchNeeded.map((entry) => entry.key), ['ollama/brand-new-model'])
  assert.ok(result.report.researchNeeded[0].fields.includes('reasoning support (efforts list)'))
  assert.ok(result.report.researchNeeded[0].fields.includes('pricing (input / cached-input / output USD per 1M tokens from the official source, with verifiedAt)'))
  const note = result.report.notes.find((entry) => entry.kind === 'research-needed')
  assert.match(note.message, /Research Needed/)
})

test('research detection and the copied prompt never touch owner metadata or prices', async () => {
  const writes = []
  const service = createModelGuideService(stubState({
    routingRule: 'least expensive capable',
    models: {
      'qwen-local//models/q8.gguf': { localVsCloud: 'local', modalities: ['text'], reasoningModes: ['Medium'], nativeReasoningDefault: 'Medium', recommendedRoutine: 'Medium', toolSupportNote: 'tests verified', pricing: { inputPerMTok: 0, cachedInputPerMTok: null, outputPerMTok: 0, verifiedAt: '2026-10-13' } },
    },
  }, {
    applyOwnerPricing: async (rates) => { writes.push(rates); return 'ok' },
  }))
  const status = await service.researchStatus()
  // The curated local model is fully resolved; the ollama row from the default
  // discovery stub has no owner entry, so exactly it is unresolved.
  assert.deepEqual(status.models.map((model) => model.key), ['ollama/glm-5.3-flash'])
  assert.ok(status.models[0].fields.includes('deployment (local vs cloud)'))
  // The researcher proposal obeys the canonical rule: local curated first.
  assert.equal(status.researcher.primary.key, 'qwen-local//models/q8.gguf')
  assert.equal(status.researcher.primary.localVsCloud, 'local')
  assert.equal(status.researcher.primary.reasoningLevel, 'Medium')
  const prompt = await service.researchPrompt()
  assert.match(prompt.prompt, /owner-curated recommendations/)
  assert.match(prompt.prompt, /An LLM assertion by itself is not authoritative/)
  assert.match(prompt.prompt, /ollama\/glm-5.3-flash/)
  assert.match(prompt.prompt, /reasoning support/)
  assert.equal(writes.length, 0)
})

test('the copied prompt carries the canonical routing rule for HOW to research only', async () => {
  const service = createModelGuideService(stubState({ routingRule: 'cheap first, escalate only on material compromise', models: {} }))
  const prompt = await service.researchPrompt()
  assert.match(prompt.prompt, /cheap first, escalate only on material compromise/)
  assert.match(prompt.prompt, /for choosing HOW to research, not what to conclude/)
})
test('a positively local model is never sent for cloud/API pricing research', async () => {
  const service = createModelGuideService(stubState({
    routingRule: 'least expensive capable',
    models: {
      // Recorded local GGUF deployment: pricing is $0/N/A by deployment, yet
      // some official model facts are still unverified.
      'qwen-local//models/q8.gguf': { localVsCloud: 'local', modalities: ['text'] },
    },
  }, {
    applyOwnerPricing: async () => { throw new Error('must not write during research') },
  }))
  const status = await service.researchStatus('all-unverified')
  assert.equal(status.scope, 'all-unverified')
  const qwen = status.models.find((model) => model.key === 'qwen-local//models/q8.gguf')
  assert.ok(qwen, 'the partially resolved local model stays listed for fact research')
  assert.equal(qwen.pricingState, 'local')
  assert.ok(qwen.fields.length > 0)
  assert.ok(!qwen.fields.some((field) => /pricing/i.test(field)),
    'no pricing research field may be requested for a positively local model')
  const prompt = (await service.researchPrompt('all-unverified', undefined)).prompt
  // The local model still gets fact research (reasoning/tool support).
  assert.match(prompt, /qwen-local\/\/models\/q8\.gguf/)
  assert.match(prompt, /reasoning support \(efforts list\)/)
  // The global rule forbids API-rate research for recorded-local models.
  assert.match(prompt, /cloud\/API pricing of \$0 and N\/A/)
  assert.match(prompt, /do NOT research or report input \/ cached-input \/ output API rates/)
  // The safe default scope (newly detected) never even lists the curated
  // local model — a local deployment cannot enter research for cloud pricing.
  const defaultScope = await service.researchStatus()
  assert.equal(defaultScope.scope, 'newly-detected')
  assert.ok(!defaultScope.models.some((model) => model.key === 'qwen-local//models/q8.gguf'),
    'the newly-detected scope must exclude curated (even partially) models')
})
