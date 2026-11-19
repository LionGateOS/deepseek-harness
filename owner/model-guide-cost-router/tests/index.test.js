import test from 'node:test'
import assert from 'node:assert/strict'
import { overlay, validateOwnerMetadata } from '../core/overlay.js'
import { Config, createModelGuideService } from '../index.js'

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

const mergeSnapshotStub = (owner, discovered, config) => overlay(discovered.providers, owner.data, {
  generatedAt: '2026-10-13T00:00:00Z',
  freshness: () => 'fresh',
  metadataStatus: owner.status,
  metadataPath: config.ownerMetadataPath,
})

/** Stub state the service can run against without a Cordis context. */
const stubState = (ownerData = { routingRule: 'cheap first', gpuBoundary: [], models: {} }, overrides = {}) => {
  const config = {
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
  }
  return {
    config,
    cache: undefined,
    mergeSnapshot: mergeSnapshotStub,
    readOwnerMetadata: async () => ({ status: 'ok', data: ownerData }),
    readJsonFile: async () => ({ status: 'missing' }),
    readTextFile: async () => ({ status: 'missing' }),
    writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
    writeTextFile: async () => 'ok',
    fetchPageSnapshot: async () => ({ url: 'https://ollama.com/pricing', status: 'failed', fetchedAt: 't', error: 'offline' }),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
    detectInstalledVersion: async () => null,
    discover: async () => ({
      providers: [
        { id: 'qwen-local', name: 'Qwen Local', models: [{ id: '/models/q8.gguf', name: 'Qwen 27B', contextWindow: 131072 }] },
        { id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] },
      ],
    }),
    ...overrides,
  }
}

test('config validation fails loudly for malformed rows and accepts good ones', () => {
  assert.equal(Config['~standard'].validate({ ownerMetadataPath: '/x/settings.json' }).value.ownerMetadataPath, '/x/settings.json')
  assert.equal(Config['~standard'].validate({ ownerMetadataPath: '/x/settings.json' }).value.providerCacheMs, 60_000)
  assert.equal(Config['~standard'].validate({ ownerMetadataPath: '/x/settings.json' }).value.maxPriceAgeDays, 90)
  // Derived paths require an absolute owner metadata path so containment is computable.
  assert.ok('issues' in Config['~standard'].validate({ ownerMetadataPath: 'relative.json' }))
  assert.ok('issues' in Config['~standard'].validate({ ownerMetadataPath: '' }))
  assert.ok('issues' in Config['~standard'].validate({ ownerMetadataPath: '/x/settings.json', providerCacheMs: -1 }))
  assert.ok('issues' in Config['~standard'].validate('nope'))
})

test('the live service surface is the declared read endpoints with SRC markers', () => {
  const service = createModelGuideService(stubState())
  assert.deepEqual(service.typertRemote, { service, serviceKey: 'modelGuide', namespace: 'modelGuide' })
  const marker = Object.getOwnPropertyDescriptor(ModelGuideDescriptor(), REMOTE_METHOD_DESCRIPTOR).value
  assert.equal(marker.version, 1)
  assert.deepEqual(marker.methods.map((method) => method.method), [
    'snapshot',
    'guidanceText',
    'actualCost',
    'recommendModels',
    'updateModelsAndPricing',
    'lastUpdateReport',
    'generatedGuide',
    'routingGuide',
    'customizationStatus',
    'researchStatus',
    'researchPrompt',
    'previewResearchResults',
    'applyResearchResults',
    'engineCatalog',
    'updateEngines',
    'refreshModelMetadata',
    'autoRefreshStatus',
    'syncRouteCapabilities',
  ])
  assert.ok(marker.methods.every((method) => method.invocation.kind === 'direct'))
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
    .filter((name) => name !== 'constructor' && !name.startsWith('#') && name !== REMOTE_METHOD_DESCRIPTOR)
  assert.deepEqual([...methodNames].sort(), [
    'actualCost',
    'applyResearchResults',
    'autoRefreshStatus',
    'customizationStatus',
    'engineCatalog',
    'generatedGuide',
    'guidanceText',
    'lastUpdateReport',
    'previewResearchResults',
    'recommendForWorkload',
    'recommendModels',
    'refreshModelMetadata',
    'researchPrompt',
    'researchStatus',
    'routingGuide',
    'snapshot',
    'syncRouteCapabilities',
    'updateEngines',
    'updateModelsAndPricing',
  ])
  for (const name of methodNames) {
    // Guide *generation* is a read; lifecycle words must not appear in names.
    assert.doesNotMatch(name, /stream|launch|stop|switch|dispatch|kill|unload|restart|reconfigure/i, `${name} must not be a lifecycle operation`)
  }
})

/** ModelGuideDescriptor — prototype carrying the markers. */
function ModelGuideDescriptor() {
  return Object.getPrototypeOf(createModelGuideService(stubState()))
}

test('guidance text merges owner data over discovery deterministically', async () => {
  const state = stubState({
    routingRule: 'cheap first',
    models: {
      'ollama/glm-5.3-flash': { localVsCloud: 'cloud', recommendedRoutine: 'High', pricing: { inputPerMTok: 0.15, outputPerMTok: 0.5, verifiedAt: '2026-10-13' } },
      'qwen-local//models/q8.gguf': { localVsCloud: 'local', nativeReasoningDefault: 'XHigh', recommendedRoutine: 'Medium' },
    },
  })
  const service = createModelGuideService(state)
  const first = await service.guidanceText('ollama', 'glm-5.3-flash')
  const second = await service.guidanceText('ollama', 'glm-5.3-flash')
  assert.equal(first, second)
  assert.match(first, /Model: GLM-5.3 Flash \(ollama\/glm-5.3-flash\)/)
  assert.match(first, /Deployment: cloud/)
  assert.match(first, /Recommended routine setting: High/)
  const localText = await service.guidanceText('qwen-local', '/models/q8.gguf')
  assert.match(localText, /Deployment: local/)
  assert.match(localText, /Native reasoning default: Owner-recorded XHigh/)
  assert.match(localText, /Cloud pricing: N\/A — local model; \$0 cloud\/API token charge/)
})

test('an unknown model answer stays Unknown instead of guessed', async () => {
  const service = createModelGuideService(stubState())
  const text = await service.guidanceText('nope', 'nothing')
  assert.match(text, /Unknown model/)
  const cost = await service.actualCost({ provider: 'nope', model: 'nothing', usage: { inputTokens: 1, outputTokens: 1 } })
  assert.equal(cost.status, 'invalid_usage')
})

test('actual cost uses the stored rates and the given real counts only', async () => {
  const state = stubState({
    models: { 'ollama/glm-5.3-flash': { pricing: { inputPerMTok: 0.15, cachedInputPerMTok: 0.03, outputPerMTok: 0.5 } } },
  })
  const service = createModelGuideService(state)
  const result = await service.actualCost({ provider: 'ollama', model: 'glm-5.3-flash', usage: { inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 } })
  assert.equal(result.status, 'calculated')
  assert.equal(result.totalUsd, 0.68) // 1.0 * 0.15 + 1.0 * 0.03 + 1.0 * 0.5
  const unknown = await service.actualCost({ provider: 'ollama', model: 'glm-5.3-flash', usage: { inputTokens: 100 } })
  assert.equal(unknown.status, 'unknown')
})

test('recommendations carry the routing rule and flag unreviewed models', async () => {
  const service = createModelGuideService(stubState({
    routingRule: 'cheap first',
    models: { 'ollama/glm-5.3-flash': { localVsCloud: 'cloud', pricing: { costTier: 'Very Cheap' }, strengths: ['agentic coding'] } },
  }))
  const advice = await service.recommendModels('agentic coding task')
  assert.equal(advice.rule, 'cheap first')
  assert.match(advice.advisoryOnly, /selects, launches, stops, or switches/)
  assert.equal(advice.shortlist[0].model, 'glm-5.3-flash')
  assert.equal(advice.shortlist[0].unreviewed, false)
  const unreviewed = advice.shortlist.find((item) => item.model !== 'glm-5.3-flash')
  assert.ok(unreviewed)
  assert.equal(unreviewed.unreviewed, true)
})
test('update flow rescans fresh, diffs, and writes the catalog and guide without touching owner curation', async () => {
  const owner = {
    routingRule: 'cheap first',
    gpuBoundary: [],
    models: {
      'ollama/glm-5.3-flash': { localVsCloud: 'cloud', nativeReasoningDefault: 'Max', recommendedRoutine: 'Medium', pricing: { inputPerMTok: 0.15, outputPerMTok: 0.5, verifiedAt: '2026-10-13' } },
    },
  }
  const frozenOwner = JSON.parse(JSON.stringify(owner))
  const written = []
  const previousCatalog = {
    version: 1,
    generatedAt: 'old',
    providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 1048576, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' }, evidence: { source: 's', verifiedAt: 'old' } }] }],
    lastUpdate: null,
  }
  const state = stubState(owner, {
    readJsonFile: async (path) => path.endsWith('catalog.json') ? { status: 'ok', value: previousCatalog } : { status: 'missing' },
    writeCatalogAndGuide: async (catalogPath, guidePath, catalogText, guideText) => {
      written.push(JSON.parse(catalogText), guideText)
      return { catalog: 'ok', guide: 'ok' }
    },
    discover: async () => ({
      providers: [
        { id: 'ollama', name: 'Ollama Cloud', models: [
          { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 524288, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
          { id: 'brand-new-cloud', name: 'Brand New Cloud' },
        ] },
        { id: 'qwen-local', name: 'Qwen Local', error: 'provider listing timed out', models: [] },
      ],
    }),
  })
  const service = createModelGuideService(state)
  const result = await service.updateModelsAndPricing()
  assert.deepEqual(result.report.added, ['ollama/brand-new-cloud'])
  assert.deepEqual(result.report.removed, [])
  // Changed context window is recorded; the owner recommendation is untouched.
  const changedRow = result.report.changed.find((item) => item.key === 'ollama/glm-5.3-flash' && item.field === 'contextWindow')
  assert.equal(changedRow.to, '524288')
  assert.deepEqual(owner, frozenOwner)
  const mismatch = result.report.ownerNativeMismatches.find((item) => item.key === 'ollama/glm-5.3-flash')
  assert.equal(mismatch.ownerNativeDefault, 'Max')
  const [catalog, guideText] = written
  assert.equal(catalog.version, 1)
  assert.deepEqual(catalog.lastUpdate.added, ['ollama/brand-new-cloud'])
  assert.match(guideText, /LionGateOS Model Guide \(generated\)/)
  assert.match(guideText, /GLM-5.3 Flash/)
  assert.match(guideText, /Brand New Cloud/)
  assert.match(guideText, /Recommended routine setting: Medium/)
})

test('lastUpdateReport reads the saved catalog; absent or broken catalogs stay absent', async () => {
  const report = { generatedAt: 't', added: [] }
  const okService = createModelGuideService(stubState({}, { readJsonFile: async () => ({ status: 'ok', value: { version: 1, lastUpdate: report } }) }))
  assert.deepEqual(await okService.lastUpdateReport(), { status: 'ok', report })
  const missingService = createModelGuideService(stubState({}, { readJsonFile: async () => ({ status: 'missing' }) }))
  assert.deepEqual(await missingService.lastUpdateReport(), { status: 'missing', report: null })
})

test('the generated guide falls back to live composition when no file exists', async () => {
  const service = createModelGuideService(stubState())
  const guide = await service.generatedGuide()
  assert.equal(guide.source, 'live')
  assert.match(guide.text, /Global routing rule/)
})

test('customizationStatus is unconfigured, missing, or passes external data through untouched', async () => {
  const unconfigured = createModelGuideService(stubState())
  assert.equal((await unconfigured.customizationStatus()).status, 'unconfigured')
  const configured = createModelGuideService(stubState({}, {
    config: { ...stubState().config, customizationStatusPath: '/x/customization-status.json' },
    readJsonFile: async () => ({ status: 'ok', value: { checkedAt: 'now', entries: [{ name: 'Voice Mode / Dictation', status: 'Installed' }] } }),
  }))
  const status = await configured.customizationStatus()
  assert.equal(status.status, 'ok')
  assert.equal(status.entries[0].status, 'Installed')
})

test('config containment: derived owner paths must stay inside the owner directory', () => {
  assert.ok('issues' in Config['~standard'].validate({ ownerMetadataPath: '/home/me/model-guidance/owner.json', catalogPath: '/elsewhere/catalog.json' }))
  assert.ok('issues' in Config['~standard'].validate({ ownerMetadataPath: '/home/me/model-guidance/owner.json', pricingCheckUrls: ['http://insecure.example'] }))
  const good = Config['~standard'].validate({ ownerMetadataPath: '/home/me/model-guidance/owner.json' })
  assert.equal(good.value.catalogPath, '/home/me/model-guidance/model-catalog.json')
  assert.equal(good.value.guideGeneratedPath, '/home/me/model-guidance/MODEL_GUIDE.generated.md')
})
