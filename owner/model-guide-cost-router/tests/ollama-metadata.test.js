/**
 * Ollama metadata enrichment: the provider's own machine-readable records are
 * the only source of capability facts, owner curation wins field by field, and
 * nothing subjective is ever written.
 *
 * The kimi-k3.1-pro records below are the live provider answers captured on
 * 2026-11-07 from https://ollama.com/api/show and /api/tags, kept verbatim so
 * the tests assert the real contract rather than an idealization.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  factsFromShowRecord,
  modelNamesFromTags,
  planFactMerge,
  readContextLength,
  readModalities,
  readReasoningLevels,
  readToolSupport,
} from '../core/ollama-metadata.js'
import { createModelGuideService } from '../index.js'
import { unresolvedFieldsFor } from '../core/research.js'
import { priceFreshness } from '../core/cost.js'

const SHOW_KIMI_3_1_PRO = {
  capabilities: ['vision', 'thinking', 'completion', 'tools'],
  details: { parent_model: 'kimi-k3.1-pro', family: 'kimi-k3', parameter_size: '2812000000000', quantization_level: 'MXFP4' },
  model_info: { 'general.architecture': 'kimi-k3', 'kimi-k3.context_length': 1048576, 'kimi-k3.embedding_length': 7168 },
  modified_at: '2026-11-04T08:00:00-05:00',
  thinking: { values: [false, 'low', 'medium', 'high', 'max'], default: 'max' },
}

/** A model with no reasoning control published at all. */
const SHOW_NON_REASONING = {
  capabilities: ['completion'],
  model_info: { 'general.architecture': 'llama', 'llama.context_length': 131072 },
}

const stamp = { source: 'https://ollama.com/api/show', verifiedAt: '2026-11-07T20:00:00Z', cloud: true }

/** A service over a stub state with the given owner file and provider answers. */
const serviceOver = (ownerModels, overrides = {}) => {
  const writes = []
  const state = {
    config: {
      ownerMetadataPath: '/x/owner-model-guidance.json',
      catalogPath: '/x/c.json',
      guideGeneratedPath: '/x/g.md',
      engineCatalogPath: '/x/e.json',
      maxPriceAgeDays: 90,
      providerQueryTimeoutMs: 1000,
      providerCacheMs: 60_000,
      fetchTimeoutMs: 1000,
      maxCatalogHistory: 5,
      maxEngineCheckAgeDays: 7,
      pricingProviderId: 'ollama',
      ollamaBaseUrl: 'https://ollama.com',
      metadataEnrichment: true,
      autoRefresh: false,
      autoRefreshHours: 6,
      refreshOnActivation: true,
    },
    cache: undefined,
    mergeSnapshot: () => ({ providers: [], curatedOnly: [] }),
    readOwnerMetadata: async () => ({ status: 'ok', data: { models: ownerModels } }),
    readJsonFile: async () => ({ status: 'missing' }),
    readTextFile: async () => ({ status: 'missing' }),
    writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
    writeTextFile: async () => 'ok',
    fetchPageSnapshot: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
    fetchJson: async (url, init) => {
      if (url.endsWith('/api/tags')) return { status: 'ok', value: { models: [{ name: 'kimi-k3.1-pro' }, { name: 'kimi-k3' }] } }
      const body = JSON.parse(init.body)
      if (body.model === 'kimi-k3.1-pro') return { status: 'ok', value: SHOW_KIMI_3_1_PRO }
      if (body.model === 'kimi-k3') return { status: 'ok', value: SHOW_KIMI_3_1_PRO }
      return { status: 'failed', error: 'HTTP 404' }
    },
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
    detectInstalledVersion: async () => null,
    discover: async () => ({ providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' }] }] }),
    applyOwnerFacts: async (facts) => { writes.push(facts); return 'ok' },
    ...overrides,
  }
  return { service: createModelGuideService(state), writes }
}

// ---------------------------------------------------------------------------
// The provider record is read exactly as published.
// ---------------------------------------------------------------------------

test('metadata: the live /api/show record yields every published capability fact', () => {
  const facts = factsFromShowRecord(SHOW_KIMI_3_1_PRO, stamp)
  assert.equal(facts['deployment'].value, 'cloud')
  assert.equal(facts['contextWindow'].value, 1048576, 'the architecture-prefixed context length is read')
  assert.deepEqual(facts['inputModalities'].value, ['text', 'image'])
  assert.equal(facts['toolSupport'].value, true)
  assert.deepEqual(facts['reasoningEfforts'].value, ['Off', 'Low', 'Medium', 'High', 'Max'])
  assert.equal(facts['reasoningDefault'].value, 'Max')
  // Provenance travels with every fact, so a later reader can audit it.
  for (const fact of Object.values(facts)) {
    assert.equal(fact.source, 'https://ollama.com/api/show')
    assert.equal(fact.verifiedAt, '2026-11-07T20:00:00Z')
  }
})

test('metadata: a model with no published reasoning control gets no reasoning fact', () => {
  const facts = factsFromShowRecord(SHOW_NON_REASONING, stamp)
  assert.equal(facts['reasoningEfforts'], undefined, 'no levels are ever invented')
  assert.equal(facts['reasoningDefault'], undefined)
  assert.deepEqual(facts['inputModalities'].value, ['text'], 'text only: no vision capability was advertised')
  assert.equal(facts['toolSupport'].value, false, 'an enumerated capability list without tools is a negative answer')
})

test('metadata: the context length is read from the architecture the record names', () => {
  assert.equal(readContextLength({ 'general.architecture': 'kimi-k3', 'kimi-k3.context_length': 1048576 }), 1048576)
  // A single context key whose prefix no longer matches the architecture is
  // still that model's context: there is nothing else it could be.
  assert.equal(readContextLength({ 'general.architecture': 'llama', 'other.context_length': 4096 }), 4096)
  // Two candidate keys and no architecture to disambiguate: refuse rather than guess.
  assert.equal(readContextLength({ 'a.context_length': 1, 'b.context_length': 2 }), undefined)
  assert.equal(readContextLength({}), undefined)
  assert.equal(readContextLength({ 'k.context_length': -5 }), undefined)
})

test('metadata: modalities, tools and levels come from the provider lists verbatim', () => {
  assert.deepEqual(readModalities(['completion', 'tools', 'vision']), ['text', 'image'])
  assert.deepEqual(readModalities(['completion']), ['text'])
  assert.equal(readModalities([]), undefined)
  assert.equal(readToolSupport(['tools']), true)
  assert.equal(readToolSupport(['completion']), false)
  assert.equal(readToolSupport([]), undefined)
  assert.deepEqual(readReasoningLevels({ values: [false, 'low', 'max'], default: 'max' }), { levels: ['Off', 'Low', 'Max'], default: 'Max' })
  // A default the provider does not also publish as a level is dropped, not added.
  assert.deepEqual(readReasoningLevels({ values: ['low'], default: 'high' }), { levels: ['Low'] })
  assert.equal(readReasoningLevels({}), undefined)
})

test('metadata: the tags answer names the models the provider lists', () => {
  assert.deepEqual(modelNamesFromTags({ models: [{ name: 'a' }, { model: 'b' }, { name: 'a' }] }), ['a', 'b'])
  assert.deepEqual(modelNamesFromTags({}), [])
  assert.deepEqual(modelNamesFromTags(null), [])
})

// ---------------------------------------------------------------------------
// Owner curation wins.
// ---------------------------------------------------------------------------

test('metadata: a new model is filled from provider facts alone', () => {
  const facts = factsFromShowRecord(SHOW_KIMI_3_1_PRO, stamp)
  const plan = planFactMerge(undefined, facts)
  // Keyed by the OWNER field each fact lands in, never by the fact name: the
  // write goes straight into the owner file, where these are the real keys.
  assert.deepEqual(Object.keys(plan.accepted).sort(), ['contextConfigured', 'localVsCloud', 'modalities', 'nativeReasoningDefault', 'reasoningModes', 'toolSupport'])
  assert.deepEqual(plan.kept, [])
})

test('metadata: a curated entry keeps its owner-authored default and gains only what is missing', () => {
  // The shape of the real ollama/kimi-k3 entry: fully audited, with a
  // hand-recorded native default and recommendations that must survive.
  const entry = {
    localVsCloud: 'cloud',
    modalities: ['text', 'image'],
    toolSupport: true,
    reasoningModes: ['Off', 'Low', 'High', 'Max'],
    nativeReasoningDefault: 'Max',
    recommendedRoutine: 'High',
    recommendedHeavy: 'Max',
    strengths: ['long-context synthesis'],
    avoid: ['cheap bulk classification'],
    evidence: 'Ollama Cloud metadata reasoning audit 2026-10-13',
    pricing: { inputPerMTok: 3, cachedInputPerMTok: 0.3, outputPerMTok: 15, verifiedAt: '2026-10-13' },
  }
  const facts = factsFromShowRecord(SHOW_KIMI_3_1_PRO, stamp)
  const plan = planFactMerge(entry, facts)
  // Context was never recorded, so it is the one field filled.
  assert.deepEqual(Object.keys(plan.accepted), ['contextConfigured'])
  // The recorded default already agrees with the provider, so it is neither
  // filled nor reported; the recorded mode list disagrees and is reported for
  // review rather than overwritten.
  const keptFields = plan.kept.map((row) => row.field).sort()
  assert.deepEqual(keptFields, ['reasoningModes'])
  // The provider publishes Medium, the audited entry lists Off/Low/High/Max.
  const modes = plan.kept.find((row) => row.field === 'reasoningModes')
  assert.deepEqual(modes.recorded, ['Off', 'Low', 'High', 'Max'])
  assert.deepEqual(modes.published, ['Off', 'Low', 'Medium', 'High', 'Max'])
  // The values that already agree are neither filled nor reported.
  assert.deepEqual(plan.agreed.sort(), ['localVsCloud', 'modalities', 'nativeReasoningDefault', 'toolSupport'])
  // Nothing subjective is ever produced by this plan.
  for (const field of ['strengths', 'avoid', 'recommendedRoutine', 'recommendedHeavy', 'evidence', 'pricing']) {
    assert.equal(plan.accepted[field], undefined)
  }
})

test('metadata: an identical fact produces no write at all', () => {
  const facts = factsFromShowRecord(SHOW_NON_REASONING, stamp)
  const entry = { localVsCloud: 'cloud', contextConfigured: 131072, modalities: ['text'], toolSupport: false }
  const plan = planFactMerge(entry, facts)
  assert.deepEqual(plan.accepted, {})
})

// ---------------------------------------------------------------------------
// The service sweep.
// ---------------------------------------------------------------------------

test('metadata sweep: a brand-new model is enriched and the write is reported', async () => {
  const { service, writes } = serviceOver({})
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'updated')
  assert.equal(report.filled, 1)
  assert.equal(writes.length, 1)
  const written = writes[0]['ollama/kimi-k3.1-pro']
  assert.equal(written.contextConfigured, 1048576)
  assert.deepEqual(written.modalities, ['text', 'image'])
  assert.equal(written.toolSupport, true)
  assert.deepEqual(written.reasoningModes, ['Off', 'Low', 'Medium', 'High', 'Max'])
  assert.equal(written.nativeReasoningDefault, 'Max')
  assert.equal(written.localVsCloud, 'cloud')
  // The report names no subjective field.
  assert.match(report.note, /Strengths, avoid notes, and recommendations stay owner-authored/)
})

test('metadata sweep: a fully curated model is reported unchanged and nothing is written', async () => {
  const curated = {
    localVsCloud: 'cloud',
    contextConfigured: 1048576,
    modalities: ['text', 'image'],
    toolSupport: true,
    reasoningModes: ['Off', 'Low', 'Medium', 'High', 'Max'],
    nativeReasoningDefault: 'Max',
  }
  const { service, writes } = serviceOver({ 'ollama/kimi-k3': curated })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3'] })
  assert.equal(report.status, 'unchanged')
  assert.equal(report.filled, 0)
  assert.equal(writes.length, 0)
  assert.match(report.models[0].reason, /already recorded/)
})

test('metadata sweep: one unreachable model does not abort the batch', async () => {
  const { service, writes } = serviceOver({ 'ollama/kimi-k3': { localVsCloud: 'cloud', contextConfigured: 1, modalities: ['text'], toolSupport: true, reasoningModes: ['Low'], nativeReasoningDefault: 'Low' } })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro', 'unknown-model'] })
  assert.equal(report.status, 'updated')
  assert.equal(report.failedCount, 1)
  const failed = report.models.find((row) => row.model === 'unknown-model')
  assert.equal(failed.status, 'failed')
  assert.match(failed.reason, /HTTP 404|provider/)
  // The good model still landed.
  assert.equal(writes.length, 1)
  assert.match(report.reason, /1 of 2 models could not be read/)
})

test('metadata sweep: an entirely offline provider fails closed with a named reason', async () => {
  const { service, writes } = serviceOver({}, {
    fetchJson: async () => ({ status: 'failed', error: 'getaddrinfo EAI_AGAIN ollama.com' }),
  })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'failed')
  assert.equal(writes.length, 0)
  assert.match(report.models[0].reason, /EAI_AGAIN/)
})

test('metadata sweep: enrichment turned off writes nothing and says so', async () => {
  const { service, writes } = serviceOver({}, { config: { ownerMetadataPath: '/x/a.json', metadataEnrichment: false } })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'disabled')
  assert.equal(writes.length, 0)
})

test('metadata sweep: a failed owner write is named and claims nothing was verified', async () => {
  const { service } = serviceOver({}, { applyOwnerFacts: async () => 'failed' })
  const report = await service.refreshModelMetadata({ models: ['kimi-k3.1-pro'] })
  assert.equal(report.status, 'failed')
  assert.match(report.models[0].reason, /could not be written/)
})

// ---------------------------------------------------------------------------
// The research status now recognises what the enrichment writes.
// ---------------------------------------------------------------------------

test('research status: an enriched model is no longer reported unresearched', () => {
  const fresh = (rates) => priceFreshness(rates, { maxAgeDays: 90 })
  const entry = {
    localVsCloud: 'cloud',
    contextConfigured: 1048576,
    modalities: ['text', 'image'],
    toolSupport: true,
    reasoningModes: ['Off', 'Low', 'Medium', 'High', 'Max'],
    nativeReasoningDefault: 'Max',
    pricing: { inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 10, verifiedAt: new Date().toISOString().slice(0, 10) },
  }
  const row = unresolvedFieldsFor({ id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' }, entry, fresh)
  assert.deepEqual(row.fields, [], 'a fully recorded model has nothing left to research')
})

test('research status: tool support is read from toolSupport, not a field that does not exist', () => {
  const fresh = () => 'fresh'
  const base = { localVsCloud: 'cloud', contextConfigured: 1, modalities: ['text'], reasoningModes: ['Low'], nativeReasoningDefault: 'Low', pricing: { inputPerMTok: 1, outputPerMTok: 2, verifiedAt: '2026-11-07' } }
  // false is a real answer, not a missing one.
  const withFalse = unresolvedFieldsFor({ id: 'm', name: 'm' }, { ...base, toolSupport: false }, fresh)
  assert.ok(!withFalse.fields.includes('tool/function-calling support'))
  // A note is the documented escape hatch for "unknown but recorded".
  const withNote = unresolvedFieldsFor({ id: 'm', name: 'm' }, { ...base, toolSupportNote: 'provider does not say' }, fresh)
  assert.ok(!withNote.fields.includes('tool/function-calling support'))
  // Absent really is unresolved.
  const absent = unresolvedFieldsFor({ id: 'm', name: 'm' }, base, fresh)
  assert.ok(absent.fields.includes('tool/function-calling support'))
})

test('research status: the merged row shape also satisfies the context and tool checks', () => {
  const fresh = () => 'fresh'
  const entry = { localVsCloud: 'cloud', modalities: ['text'], reasoningModes: ['Low'], nativeReasoningDefault: 'Low', pricing: { inputPerMTok: 1, outputPerMTok: 2, verifiedAt: '2026-11-07' } }
  // The snapshot's own merged model row carries context.providerReported and
  // toolSupport; the research scan must accept that shape too.
  const merged = { id: 'm', name: 'm', context: { providerReported: 8192 }, toolSupport: true }
  const row = unresolvedFieldsFor(merged, entry, fresh)
  assert.deepEqual(row.fields, [])
})
