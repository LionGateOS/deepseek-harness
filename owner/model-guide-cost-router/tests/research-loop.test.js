/**
 * Research loop regression: scoped research requests (newly detected / all
 * unverified / selected), token-free prompt generation, and the safe research
 * result ingestion path — exact provider-qualified keys only, every fact
 * carrying an official source and verifiedAt, owner recommendations never
 * overwritten, explicit preview-before-apply, and guide regeneration after a
 * confirmed apply.
 */

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createModelGuideService } from '../index.js'
import { overlay } from '../core/overlay.js'
import { unresolvedModels, scopeUnresolvedModels, RESEARCH_SCOPES } from '../core/research.js'
import { validateResearchResults } from '../core/research-import.js'
import { priceFreshness } from '../core/cost.js'

/** A scratch owner-metadata file inside the workspace; the writer needs fs. */
const SCRATCH = path.join(tmpdir(), 'dsh-model-guide-research-loop')
const OWNER_PATH = path.join(SCRATCH, 'owner-model-guidance.json')
const CATALOG_PATH = path.join(SCRATCH, 'model-catalog.json')
const GUIDE_PATH = path.join(SCRATCH, 'MODEL_GUIDE.generated.md')

const stubState = ({ ownerData, overrides } = {}) => ({
  config: {
    ownerMetadataPath: OWNER_PATH,
    catalogPath: CATALOG_PATH,
    guideGeneratedPath: GUIDE_PATH,
    engineCatalogPath: `${CATALOG_PATH.replace(/[^/]+$/, '')}engine-catalog.json`,
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
  // The real merge: overlay owner entries into discovered rows identically to
  // the shipped default, so guide regeneration reflects imported facts.
  mergeSnapshot: (owner, discovered, config) => overlay(discovered.providers, owner.data, {
    generatedAt: '2026-10-14T05:00:00Z',
    freshness: (rates) => priceFreshness(rates, { maxAgeDays: config.maxPriceAgeDays }),
    metadataStatus: owner.status,
  }),
  readOwnerMetadata: async () => ({ status: 'ok', data: existsOwner() ? JSON.parse(readFileSync(OWNER_PATH, 'utf8')) : ownerData }),
  readJsonFile: async () => ({ status: 'missing' }),
  readTextFile: async (filePath) => filePath === OWNER_PATH && existsOwner()
    ? { status: 'ok', text: readFileSync(OWNER_PATH, 'utf8') }
    : { status: 'missing' },
  writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
  writeTextFile: async () => 'ok',
  fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
  detectInstalledVersion: async () => null,
  applyOwnerPricing: async () => { throw new Error('research must not write pricing') },
  applyOwnerFacts: async (factsByOwnerKey) => {
    const fresh = JSON.parse(readFileSync(OWNER_PATH, 'utf8'))
    for (const [key, facts] of Object.entries(factsByOwnerKey)) {
      fresh.models[key] = { ...(fresh.models[key] ?? {}), ...facts }
    }
    writeFileSync(OWNER_PATH, JSON.stringify(fresh, null, 2) + '\n')
    return 'ok'
  },
  discover: async () => ({
    providers: [
      { id: 'qwen-local', name: 'Qwen Local', models: [{ id: '/models/q8.gguf', name: 'Qwen 27B', contextWindow: 131072, inputModalities: ['text'] }] },
      { id: 'deepseek-official', name: 'DeepSeek Official', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 }] },
      { id: 'ollama', name: 'Ollama Cloud', models: [
        { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
      ] },
    ],
  }),
  ...overrides,
})

const existsOwner = () => {
  try {
    readFileSync(OWNER_PATH, 'utf8')
    return true
  } catch {
    return false
  }
}

test('scopes split unresolved models: newly detected, all unverified, selected', async () => {
  const owner = { models: { 'qwen-local//models/q8.gguf': { localVsCloud: 'local', modalities: ['text'] } } }
  const snapshot = {
    providers: [
      { id: 'deepseek-official', models: [{ id: 'deepseek-v4-pro', name: 'x' }] },
      { id: 'qwen-local', models: [{ id: '/models/q8.gguf', name: 'y' }] },
      { id: 'ollama', models: [{ id: 'glm-5.3-flash', name: 'z' }] },
    ],
  }
  const all = unresolvedModels(snapshot, owner, () => 'unverified')
  assert.ok(all.length >= 3)
  assert.equal(RESEARCH_SCOPES.join(','), 'newly-detected,all-unverified,selected')
  const newly = scopeUnresolvedModels(all, 'newly-detected', undefined, owner.models)
  assert.deepEqual(newly.map((model) => model.key), ['deepseek-official/deepseek-v4-pro', 'ollama/glm-5.3-flash'])
  assert.deepEqual(scopeUnresolvedModels(all, 'selected', ['qwen-local//models/q8.gguf'], owner.models)
    .map((model) => model.key), ['qwen-local//models/q8.gguf'])
  const service = createModelGuideService(stubState({ ownerData: owner }))
  const status = await service.researchStatus()
  assert.equal(status.scope, 'newly-detected')
  assert.equal(status.model === undefined && status.counts.allUnverified >= 3, true)
  assert.equal(status.models.some((model) => model.key === 'qwen-local//models/q8.gguf'), false,
    'the safe default scope must not curate-list a locally curated model')
  const allStatus = await service.researchStatus('all-unverified')
  assert.ok(allStatus.models.length >= 3)
})

test('prompt generation consumes no model tokens and is deterministic per scope', async () => {
  let fetched = 0
  const owner = { models: {}, routingRule: 'cheap first' }
  const service = createModelGuideService(stubState({
    ownerData: owner,
    overrides: {
      fetchPageSnapshot: async () => { fetched++; throw new Error('research must never fetch') },
    },
  }))
  const first = await service.researchPrompt('all-unverified', undefined)
  const second = await service.researchPrompt('all-unverified', undefined)
  // The run instant is intentional per call; everything else is deterministic.
  const withoutInstant = (text) => text.replace(/Model research request — .+/u, 'Model research request')
  assert.equal(withoutInstant(first.prompt), withoutInstant(second.prompt))
  assert.match(first.prompt, /Research scope: all-unverified/)
  assert.match(first.prompt, /Model research request —/)
  const selected = await service.researchPrompt('selected', ['deepseek-official/deepseek-v4-pro'])
  assert.ok(selected.prompt.includes('deepseek-official/deepseek-v4-pro'))
  assert.ok(!selected.prompt.includes('ollama/glm-5.3-flash'), 'the selected scope copies only the selected block')
  assert.equal(fetched, 0, 'prompt generation must never fetch pages or consume tokens')
})

test('import accepts only exact keys, official sources, and verifiedAt — recommendations reject themselves', () => {
  const owner = { models: { 'ollama/glm-5.3-flash': { recommendedRoutine: 'High', strengths: ['x'] } } }
  const known = ['ollama/glm-5.3-flash']
  const out = validateResearchResults({
    models: [
      { model: 'ollama/glm-5.3-flash', facts: {
        // A recommendation field is NOT in the contract — unknown, rejected.
        recommendedRoutine: { value: 'Max', source: 'https://ollama.com/library', verifiedAt: '2026-10-14' },
        contextWindow: { value: 262144, source: 'https://ollama.com/library/glm-5.3-flash', verifiedAt: '2026-10-14' },
      } },
      { model: 'ollama/alias-of-something-else', facts: { contextWindow: { value: 1, source: 'https://x', verifiedAt: '2026-10-14' } } },
      { model: 'ollama/glm-5.3-flash', facts: { toolSupport: { value: true, source: 'not-a-url', verifiedAt: '2026-10-14' } } },
      { model: 'ollama/glm-5.3-flash', facts: { reasoningDefault: { value: 'High', source: 'https://ollama.com', verifiedAt: 'nonsense' } } },
      { model: 'garbage', facts: {} },
    ],
  }, owner.models, known)
  assert.equal(out.ok, true)
  assert.deepEqual(out.factsByOwnerKey, { 'ollama/glm-5.3-flash': { contextConfigured: 262144 } })
  assert.deepEqual(out.changes.map((change) => [change.key, change.field, change.to]), [
    ['ollama/glm-5.3-flash', 'contextConfigured', 262144],
  ])
  const reasons = out.rejected.map((item) => item.reason ?? '').join('\n')
  assert.match(reasons, /unknown fact field/)
  assert.match(reasons, /unknown model key/)
  assert.match(reasons, /official http\(s\) URL/)
  assert.match(reasons, /verifiedAt must be a valid date/)
  assert.match(reasons, /malformed model key/)
  // The recommendation can never land in the merged facts.
  for (const facts of Object.values(out.factsByOwnerKey)) {
    for (const field of ['recommendedRoutine', 'recommendedHeavy', 'strengths', 'avoid', 'pricingNote', 'reasoningNote', 'pricing']) {
      assert.ok(!(field in facts), `${field} must never be importable`)
    }
  }
})

test('apply is explicit: preview writes nothing; apply merges facts and regenerates the guide', async () => {
  try {
  mkdirSync(SCRATCH, { recursive: true })
  const ownerData = { version: 1, routingRule: 'cheap first', models: {
    'deepseek-official/deepseek-v4-pro': { localVsCloud: 'cloud' },
  } }
  writeFileSync(OWNER_PATH, JSON.stringify(ownerData, null, 2) + '\n')
  const guideWrites = []
  const service = createModelGuideService(stubState({
    ownerData,
    overrides: { writeCatalogAndGuide: async (catalogPath, guidePath) => { guideWrites.push(catalogPath); return { catalog: 'ok', guide: 'ok' } } },
  }))
  const results = { models: [
    { model: 'deepseek-official/deepseek-v4-pro', facts: {
      reasoningDefault: { value: 'High', source: 'https://api-docs.deepseek.com', verifiedAt: '2026-10-14' },
      toolSupport: { value: true, source: 'https://api-docs.deepseek.com', verifiedAt: '2026-10-14' },
    } },
  ] }
  const preview = await service.previewResearchResults(results)
  assert.equal(preview.status, 'ok')
  assert.equal(typeof preview.reviewId, 'string')
  assert.equal(guideWrites.length, 0, 'the preview never writes')
  const applied = await service.applyResearchResults(results, preview.reviewId)
  assert.equal(applied.status, 'applied')
  assert.equal(applied.applied, true)
  assert.equal(guideWrites.length, 1, 'the confirmed apply regenerates the catalog and guide')
  const merged = JSON.parse(readFileSync(OWNER_PATH, 'utf8'))
  assert.equal(merged.models['deepseek-official/deepseek-v4-pro'].nativeReasoningDefault, 'High')
  assert.equal(merged.models['deepseek-official/deepseek-v4-pro'].toolSupport, true)
  assert.equal(merged.models['deepseek-official/deepseek-v4-pro'].localVsCloud, 'cloud')
  assert.equal(merged.models['deepseek-official/deepseek-v4-pro'].recommendedRoutine, undefined,
    'recommendations stay owner-owned — the import never writes one')
  // The imported facts resolve the previously unresolved fields.
  const status = await service.researchStatus('all-unverified')
  const row = status.models.find((model) => model.key === 'deepseek-official/deepseek-v4-pro')
  if (row !== undefined) {
    assert.ok(!row.fields.some((field) => /native\/default reasoning/i.test(field)),
      'imported facts clear their Needs Review entries')
  }
  } finally { rmSync(SCRATCH, { recursive: true, force: true }) }
})

test('price diffs flatten structured off-peak rates and never emit [object Object]', async () => {
  // The exact live case: deepseek-v4.1-flash peak rates already verified,
  // off-peak rates newly published on the official page.
  const ownerData = { version: 1, routingRule: 'cheap first', models: {
    'ollama/deepseek-v4.1-flash': { localVsCloud: 'cloud', pricing: {
      inputPerMTok: 0.3, cachedInputPerMTok: 0.006, outputPerMTok: 1.2,
      source: 'https://ollama.com/pricing', verifiedAt: '2026-10-13' } } } }
  const service = createModelGuideService(stubState({
    ownerData,
    overrides: {
      fetchPageSnapshot: async () => ({ url: 'https://ollama.com/pricing', status: 'fetched', fetchedAt: '2026-10-14T08:00:00Z', bytes: 49546, sha256: 'x', body: readFileSync(path.join(process.cwd(), 'tests/fixtures/ollama-pricing.html'), 'utf8') }),
      applyOwnerPricing: async () => 'ok',
      discover: async () => ({ providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1 Flash' }] }] }),
    },
  }))
  const result = await service.updateModelsAndPricing()
  const changed = (result.report.priceChanges ?? []).find((entry) => entry.key === 'ollama/deepseek-v4.1-flash')
  assert.ok(changed, 'the off-peak addition must be reported for the live model key')
  assert.deepEqual(changed.changes.map((change) => [change.field, change.from, change.to]), [
    ['offPeak.inputPerMTok', null, 0.15],
    ['offPeak.cachedInputPerMTok', null, 0.003],
    ['offPeak.outputPerMTok', null, 0.6],
  ])
  // Every diff endpoint is a scalar; no object/null leak can reach the UI.
  for (const change of changed.changes) {
    assert.ok(change.from === null || typeof change.from === 'number' || typeof change.from === 'string')
    assert.ok(change.to === null || typeof change.to === 'number' || typeof change.to === 'string')
  }
  const rendered = JSON.stringify(result.report)
  assert.doesNotMatch(rendered, /\[object Object\]/)
  // The snapshot note must say the parser reads verified rates — never the
  // contradictory "rates are never parsed automatically".
  assert.doesNotMatch(rendered, /never parsed automatically|never auto-parsed/)
  assert.match(rendered, /deterministic parser read verified rates/)
})
test('unchanged rates produce no price-change entries and keep the report coherent', async () => {
  const ownerData = { version: 1, routingRule: 'cheap first', models: {
    'ollama/deepseek-v4.1-flash': { localVsCloud: 'cloud', pricing: {
      inputPerMTok: 0.3, cachedInputPerMTok: 0.006, outputPerMTok: 1.2,
      offPeak: { inputPerMTok: 0.15, cachedInputPerMTok: 0.003, outputPerMTok: 0.6 },
      source: 'https://ollama.com/pricing', verifiedAt: '2026-10-13' } } } }
  const service = createModelGuideService(stubState({
    ownerData,
    overrides: {
      fetchPageSnapshot: async () => ({ url: 'https://ollama.com/pricing', status: 'fetched', fetchedAt: '2026-10-14T08:00:00Z', bytes: 49546, sha256: 'x', body: readFileSync(path.join(process.cwd(), 'tests/fixtures/ollama-pricing.html'), 'utf8') }),
      applyOwnerPricing: async () => 'ok',
      discover: async () => ({ providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1 Flash' }, { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' }] }] }),
    },
  }))
  const result = await service.updateModelsAndPricing()
  assert.equal(result.report.pricingRefresh.status, 'updated')
  assert.deepEqual(result.report.priceChanges, [])
  assert.match(JSON.stringify(result.report.notes), /0 price value\(s\) changed/)
})

test('the research prompt contract is exactly the importer contract — cloud pricing importable', async () => {
  const owner = { version: 1, routingRule: 'cheap first', models: {} }
  const service = createModelGuideService(stubState({ ownerData: owner }))
  const status = await service.researchStatus('all-unverified')
  const row = status.models.find((model) => model.key === 'deepseek-official/deepseek-v4-pro')
  assert.ok(row.fields.some((field) => /pricing/.test(field)),
    'cloud pricing stays a requested research field — it is now importable, not dropped')
  const prompt = (await service.researchPrompt('all-unverified', undefined)).prompt
  // (B) machine-importable output contract: JSON only, no fences, no prose.
  assert.match(prompt, /Return JSON only/)
  assert.match(prompt, /no Markdown fences/)
  assert.match(prompt, /no explanatory prose before or after the JSON/)
  assert.match(prompt, /Include only facts confirmed by official provider or vendor sources/)
  assert.match(prompt, /omit unverified facts completely/)
  assert.match(prompt, /exact provider\/model key supplied/)
  assert.doesNotMatch(prompt, /keyed by the model key/, 'the vague per-object format is replaced by the exact array schema')
  // (A/M) the prompt documents exactly the importer's array schema, and a
  // result built in that schema validates.
  assert.match(prompt, /\[\n  \{\n    "model": "<exact provider\/modelId key from the blocks above>"/)
  assert.match(prompt, /"facts": \{\n      "<fact name from the importable list>"/)
  assert.match(prompt, /pricing \(cloud deployments only: \{ inputPerMTok, cachedInputPerMTok, outputPerMTok \}/)
  const sample = [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
    deployment: { value: 'cloud', source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' },
    pricing: { value: { inputPerMTok: 0.28, cachedInputPerMTok: 0.028, outputPerMTok: 1.12, offPeak: { inputPerMTok: 0.14, cachedInputPerMTok: null, outputPerMTok: 0.56 } }, source: 'https://api-docs.deepseek.com/pricing', verifiedAt: '2026-10-14' } } }]
  const check = validateResearchResults(sample, {}, ['deepseek-official/deepseek-v4-pro'])
  assert.equal(check.ok, true)
  // (C) verified cloud pricing accepted with official source + verifiedAt; the
  // review diff is flattened to scalar per-rate entries and the composed owner
  // record keeps the canonical shape incl. nested source/verifiedAt.
  assert.deepEqual(check.changes.filter((change) => change.field.startsWith('pricing.')).map((change) => [change.field, change.from, change.to]), [
    ['pricing.inputPerMTok', null, 0.28],
    ['pricing.cachedInputPerMTok', null, 0.028],
    ['pricing.outputPerMTok', null, 1.12],
    ['pricing.offPeak.inputPerMTok', null, 0.14],
    ['pricing.offPeak.outputPerMTok', null, 0.56],
  ])
  const record = check.factsByOwnerKey['deepseek-official/deepseek-v4-pro'].pricing
  assert.deepEqual(Object.keys(record), ['inputPerMTok', 'cachedInputPerMTok', 'outputPerMTok', 'offPeak', 'source', 'verifiedAt'])
  assert.equal(record.source, 'https://api-docs.deepseek.com/pricing')
})

test('pricing import guards: local deployments, bad rates, and aliases are all rejected', () => {
  const known = ['ollama/glm-5.3-flash']
  // (D) a recorded-local model must never accept cloud/API pricing research.
  const localEntry = validateResearchResults([{ model: 'ollama/glm-5.3-flash', facts: { pricing: { value: { inputPerMTok: 1 }, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-14' } } }], { 'ollama/glm-5.3-flash': { localVsCloud: 'local' } }, known)
  assert.match(localEntry.rejected[0].reason, /only importable for cloud deployments/)
  const localDeclared = validateResearchResults([{ model: 'ollama/glm-5.3-flash', facts: { deployment: { value: 'local', source: 'https://ollama.com/', verifiedAt: '2026-10-14' }, pricing: { value: { inputPerMTok: 1 }, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-14' } } }], {}, known)
  assert.ok(localDeclared.rejected.some((item) => item.fact === 'pricing' && /only importable for cloud/.test(item.reason)))
  // An unknown deployment with a pricing fact is also rejected (fail closed).
  const unknownDeployment = validateResearchResults([{ model: 'ollama/glm-5.3-flash', facts: { pricing: { value: { inputPerMTok: 1 }, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-14' } } }], {}, known)
  assert.match(unknownDeployment.rejected[0].reason, /requires a cloud deployment/)
  // (E) malformed rates rejected: negative, non-numeric, all-null, unknown key.
  for (const bad of [
    { value: { inputPerMTok: -1, cachedInputPerMTok: null, outputPerMTok: 1 } },
    { value: { inputPerMTok: '0.3', cachedInputPerMTok: null, outputPerMTok: 1 } },
    { value: { inputPerMTok: Number.POSITIVE_INFINITY, cachedInputPerMTok: null, outputPerMTok: 1 } },
    { value: { cachedInputPerMTok: null, outputPerMTok: null } },
    { value: { inputPerMTok: 1, reasoningMultiplier: 2 } },
  ]) {
    const out = validateResearchResults([{ model: 'ollama/glm-5.3-flash', facts: { deployment: { value: 'cloud', source: 'https://x/', verifiedAt: '2026-10-14' }, pricing: { ...bad, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-14' } } }], {}, known)
    assert.ok(out.rejected.some((item) => item.fact === 'pricing'), `bad rates must be rejected: ${JSON.stringify(bad)}`)
    const entry = out.factsByOwnerKey['ollama/glm-5.3-flash'] ?? {}
    assert.ok(!('pricing' in Object.fromEntries(Object.entries(entry).filter(([field]) => field.startsWith('pricing')))),
      'a rejected pricing fact must never reach the merged facts')
  }
  // (F) cross-provider pricing import: the key is not in the inventory.
  const alias = validateResearchResults([{ model: 'deepseek-official/glm-5.3-flash', facts: { pricing: { value: { inputPerMTok: 1 }, source: 'https://x/', verifiedAt: '2026-10-14' } } }], {}, known)
  assert.match(alias.rejected[0].reason, /unknown model key/)
  // (G) recommendation fields stay unimportable even next to a valid fact.
  const mixed = validateResearchResults([{ model: 'ollama/glm-5.3-flash', facts: {
    deployment: { value: 'cloud', source: 'https://x/', verifiedAt: '2026-10-14' },
    pricing: { value: { inputPerMTok: 0.3, cachedInputPerMTok: null, outputPerMTok: 1.2 }, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-14' },
    recommendedRoutine: { value: 'Max', source: 'https://ollama.com/', verifiedAt: '2026-10-14' } } }], {}, known)
  assert.equal(mixed.ok, true)
  assert.equal(mixed.rejected.length, 1)
  assert.equal(mixed.rejected[0].fact, 'recommendedRoutine')
  assert.ok(!('recommendedRoutine' in (Object.values(mixed.factsByOwnerKey)[0])))
})

test('verified pricing import end-to-end: review, apply, guide, unresolved pricing clears', async () => {
  try {
  mkdirSync(SCRATCH, { recursive: true })
  const ownerData = { version: 1, routingRule: 'cheap first', models: {} }
  writeFileSync(OWNER_PATH, JSON.stringify(ownerData, null, 2) + '\n')
  const guideWrites = []
  const service = createModelGuideService(stubState({
    ownerData,
    overrides: { writeCatalogAndGuide: async () => { guideWrites.push(Date.now()); return { catalog: 'ok', guide: 'ok' } } },
  }))
  const results = { models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
    deployment: { value: 'cloud', source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' },
    pricing: { value: { inputPerMTok: 0.28, cachedInputPerMTok: 0.028, outputPerMTok: 1.12 }, source: 'https://api-docs.deepseek.com/pricing', verifiedAt: '2026-10-14' } } }] }
  // (H) the preview writes nothing.
  const preview = await service.previewResearchResults(results)
  assert.equal(preview.status, 'ok')
  assert.equal(typeof preview.reviewId, 'string')
  assert.equal(guideWrites.length, 0)
  // (I) the confirmed apply stores the canonical verified record.
  const applied = await service.applyResearchResults(results, preview.reviewId)
  assert.equal(applied.status, 'applied')
  assert.equal(guideWrites.length, 1, 'the apply regenerates the guide')
  const merged = JSON.parse(readFileSync(OWNER_PATH, 'utf8')).models['deepseek-official/deepseek-v4-pro']
  assert.deepEqual(merged.pricing, { inputPerMTok: 0.28, cachedInputPerMTok: 0.028, outputPerMTok: 1.12, source: 'https://api-docs.deepseek.com/pricing', verifiedAt: '2026-10-14' })
  assert.equal(merged.recommendedRoutine, undefined)
  assert.equal(merged.pricingNote, undefined)
  // (J) the freshly verified pricing no longer counts as unresolved research.
  const status = await service.researchStatus('all-unverified')
  const row = status.models.find((model) => model.key === 'deepseek-official/deepseek-v4-pro')
  if (row !== undefined) {
    assert.ok(!row.fields.some((field) => /pricing/.test(field)),
      'an imported verified pricing clears its unresolved research field')
    assert.ok(row.pricingState !== 'unverified')
  }
  // (K) the regenerated guide shows the imported verified rate.
  const guide = await service.generatedGuide()
  assert.match(guide.text, /\$0\.28\/1M/)
  } finally { rmSync(SCRATCH, { recursive: true, force: true }) }
})

test('direct apply without a prior review is rejected and writes nothing', async () => {
  try {
    mkdirSync(SCRATCH, { recursive: true })
    const ownerData = { version: 1, routingRule: 'cheap first', models: {} }
    writeFileSync(OWNER_PATH, JSON.stringify(ownerData, null, 2) + '\n')
    let writes = 0
    const service = createModelGuideService(stubState({
      ownerData,
      overrides: { writeCatalogAndGuide: async () => { writes++; return { catalog: 'ok', guide: 'ok' } } },
    }))
    const results = { models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
      deployment: { value: 'cloud', source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' } } }] }
    // The exact accidental workflow: apply clicked with no review ever run.
    const direct = await service.applyResearchResults(results)
    assert.equal(direct.status, 'rejected')
    assert.equal(direct.applied, false)
    assert.match(direct.reason, /review first/i)
    assert.equal(writes, 0, 'nothing may be written without a review token')
    assert.deepEqual(JSON.parse(readFileSync(OWNER_PATH, 'utf8')).models ?? {}, {},
      'the owner file is untouched')
    // Even a well-formed but unreviewed call with a bogus token fails closed.
    const bogus = await service.applyResearchResults(results, 'review-forged-token')
    assert.equal(bogus.status, 'rejected')
    assert.match(bogus.reason, /no longer valid|review first/i)
    assert.equal(writes, 0)
  } finally { rmSync(SCRATCH, { recursive: true, force: true }) }
})

test('a changed payload cannot use a review token minted for different facts', async () => {
  try {
    mkdirSync(SCRATCH, { recursive: true })
    const ownerData = { version: 1, routingRule: 'cheap first', models: {} }
    writeFileSync(OWNER_PATH, JSON.stringify(ownerData, null, 2) + '\n')
    let writes = 0
    const service = createModelGuideService(stubState({
      ownerData,
      overrides: { writeCatalogAndGuide: async () => { writes++; return { catalog: 'ok', guide: 'ok' } } },
    }))
    const reviewed = { models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
      deployment: { value: 'cloud', source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' } } }] }
    const preview = await service.previewResearchResults(reviewed)
    assert.equal(preview.status, 'ok')
    // The owner edits the payload after reviewing: the token must not apply it.
    const changed = { models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
      deployment: { value: 'cloud', source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' },
      contextWindow: { value: 999999999, source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' } } }] }
    const rejected = await service.applyResearchResults(changed, preview.reviewId)
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reason, /no longer matches the reviewed facts/)
    assert.equal(writes, 0)
    // The original reviewed payload still applies with its own token.
    const applied = await service.applyResearchResults(reviewed, preview.reviewId)
    assert.equal(applied.status, 'applied')
    assert.equal(writes, 1)
  } finally { rmSync(SCRATCH, { recursive: true, force: true }) }
})

test('the review token is single-use: the second apply needs a fresh review', async () => {
  try {
    mkdirSync(SCRATCH, { recursive: true })
    const ownerData = { version: 1, routingRule: 'cheap first', models: {} }
    writeFileSync(OWNER_PATH, JSON.stringify(ownerData, null, 2) + '\n')
    let writes = 0
    const service = createModelGuideService(stubState({
      ownerData,
      overrides: { writeCatalogAndGuide: async () => { writes++; return { catalog: 'ok', guide: 'ok' } } },
    }))
    const results = { models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {
      toolSupport: { value: true, source: 'https://api-docs.deepseek.com/', verifiedAt: '2026-10-14' } } }] }
    const preview = await service.previewResearchResults(results)
    const first = await service.applyResearchResults(results, preview.reviewId)
    assert.equal(first.status, 'applied')
    assert.equal(writes, 1)
    // The token was consumed by the first apply.
    const second = await service.applyResearchResults(results, preview.reviewId)
    assert.equal(second.status, 'rejected')
    assert.match(second.reason, /no longer valid/)
    assert.equal(writes, 1, 'the second apply must not write again on the same token')
    // A fresh review re-authorizes exactly once more.
    const fresh = await service.previewResearchResults(results)
    const again = await service.applyResearchResults(results, fresh.reviewId)
    assert.equal(again.status, 'applied')
    assert.equal(writes, 2)
  } finally { rmSync(SCRATCH, { recursive: true, force: true }) }
})
