import test from 'node:test'
import assert from 'node:assert/strict'
import { overlay, validateOwnerMetadata } from '../core/overlay.js'

const freshnessConstant = () => 'fresh'

const discoveredOne = (overrides = {}) => [{
  id: 'ollama',
  name: 'Ollama Cloud',
  models: [{
    id: 'newly-added-model',
    name: 'Newly Added Model',
    contextWindow: 131072,
    reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    ...overrides,
  }],
}]

const ownerData = (models, extra = {}) => ({ routingRule: 'least expensive capable model first', gpuBoundary: [{ label: 'GD GPU', uuid: 'GPU-x' }], models, ...extra })

test('a newly discovered model appears without owner metadata and without fabricated facts', () => {
  const merged = overlay(discoveredOne(), ownerData({}), {
    generatedAt: '2026-10-13T00:00:00Z',
    freshness: freshnessConstant,
    metadataStatus: 'ok',
    metadataPath: '/x/owner-model-guidance.json',
  })
  const row = merged.providers[0].models[0]
  assert.equal(row.id, 'newly-added-model')
  assert.equal(row.localVsCloud, 'unknown')
  assert.equal(row.needsReview, false)
  // Provider facts pass through; nothing owner-curated is invented.
  assert.equal(row.context.providerReported, 131072)
  assert.equal(row.reasoning.providerDefault, 'high')
  assert.equal(row.pricing, undefined)
  assert.equal(row.recommendedRoutine, undefined)
  assert.equal(row.strengths, undefined)
  // The row is flagged for review because owner curation is missing.
  assert.equal(row.reasoning.recommendedRoutine, undefined)
  assert.equal(merged.curatedOnly.length, 0)
})

test('owner metadata overlays discovered metadata', () => {
  const merged = overlay(discoveredOne(), ownerData({
    'ollama/newly-added-model': {
      localVsCloud: 'cloud',
      recommendedRoutine: 'High',
      reasoningModes: ['Low', 'Max'],
      pricing: { inputPerMTok: 0.15, outputPerMTok: 0.5 },
      strengths: ['agentic coding'],
    },
  }), { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' })
  const row = merged.providers[0].models[0]
  assert.equal(row.localVsCloud, 'cloud')
  assert.equal(row.reasoning.recommendedRoutine, 'High')
  assert.deepEqual(row.reasoning.ownerModes, ['Low', 'Max'])
  assert.equal(row.pricing.inputPerMTok, 0.15)
  assert.deepEqual(row.strengths, ['agentic coding'])
  // Provider facts remain from discovery, not from owner data.
  assert.equal(row.reasoning.providerDefault, 'high')
})

test('rediscovery does not overwrite owner metadata', () => {
  const owner = ownerData({
    'ollama/newly-added-model': {
      localVsCloud: 'cloud',
      recommendedRoutine: 'High',
      nativeReasoningDefault: 'Max',
      pricing: { inputPerMTok: 0.42, outputPerMTok: 4.4 },
    },
  })
  const options = { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' }
  const first = overlay(discoveredOne(), owner, options)
  const rediscovered = overlay(discoveredOne({ contextWindow: 999999, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } }), owner, options)
  const firstRow = first.providers[0].models[0]
  const secondRow = rediscovered.providers[0].models[0]
  assert.deepEqual(
    { localVsCloud: secondRow.localVsCloud, pricing: secondRow.pricing, recommendedRoutine: secondRow.reasoning.recommendedRoutine, ownerNativeDefault: secondRow.reasoning.ownerNativeDefault },
    { localVsCloud: firstRow.localVsCloud, pricing: firstRow.pricing, recommendedRoutine: firstRow.reasoning.recommendedRoutine, ownerNativeDefault: firstRow.reasoning.ownerNativeDefault },
  )
  assert.equal(secondRow.pricing.inputPerMTok, 0.42)
  // New provider facts appear beside the untouched owner data.
  assert.equal(secondRow.context.providerReported, 999999)
})

test('an owner-curated model without live discovery stays listed as curated-only', () => {
  const merged = overlay([{ id: 'ollama', name: 'Ollama Cloud', error: 'provider listing timed out', models: [] }],
    ownerData({ 'ollama/glm-5.3-flash': { localVsCloud: 'cloud', recommendedRoutine: 'High' } }),
    { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' })
  assert.equal(merged.providers[0].models.length, 0)
  assert.equal(merged.curatedOnly.length, 1)
  assert.equal(merged.curatedOnly[0].id, 'glm-5.3-flash')
  assert.equal(merged.curatedOnly[0].reasoning.recommendedRoutine, 'High')
})

test('malformed owner metadata fails safely: problems are named and nothing is invented', () => {
  assert.deepEqual(validateOwnerMetadata('not json {'), { status: 'malformed', problems: ['file is not valid JSON'] })
  const validated = validateOwnerMetadata(JSON.stringify({
    routingRule: 12,
    models: {
      'ollama/bad': { pricing: { inputPerMTok: 'free' }, localVsCloud: 'orbit' },
      'ollama/good': { recommendedRoutine: 'High' },
      'junk': {},
    },
  }))
  assert.equal(validated.status, 'ok')
  assert.ok(validated.problems.length >= 3)
  const merged = overlay(discoveredOne(), validated.data, { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' })
  // The malformed entry does not match any discovered model, so it surfaces as
  // a curated-only row flagged Needs Review with its problems named and its
  // pricing absent.
  const badRow = merged.curatedOnly.find((row) => row.id === 'bad')
  assert.ok(badRow)
  assert.equal(badRow.needsReview, true)
  assert.ok(badRow.ownerProblems.some((problem) => problem.includes('inputPerMTok')))
  assert.ok(badRow.ownerProblems.some((problem) => problem.includes('localVsCloud')))
  assert.equal(badRow.pricing, undefined)
  // The discovered model keeps no fabricated curation from the malformed file.
  assert.equal(merged.providers[0].models[0].needsReview, false)
})

test('protected GPU boundary metadata is preserved verbatim', () => {
  const validated = validateOwnerMetadata(JSON.stringify(ownerData({}, {})))
  assert.deepEqual(validated.data.gpuBoundary, [{ label: 'GD GPU', uuid: 'GPU-x' }])
  const merged = overlay(discoveredOne(), validated.data, { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' })
  assert.deepEqual(merged.gpuBoundary, [{ label: 'GD GPU', uuid: 'GPU-x' }])
})

test('native reasoning default and owner-recommended default stay separate', () => {
  const merged = overlay(discoveredOne(), ownerData({
    'ollama/newly-added-model': { nativeReasoningDefault: 'XHigh', recommendedRoutine: 'Medium', recommendedHeavy: 'XHigh' },
  }), { generatedAt: 't', freshness: freshnessConstant, metadataStatus: 'ok', metadataPath: 'p' })
  const reasoning = merged.providers[0].models[0].reasoning
  assert.equal(reasoning.providerDefault, 'high')
  assert.equal(reasoning.ownerNativeDefault, 'XHigh')
  assert.equal(reasoning.recommendedRoutine, 'Medium')
  assert.equal(reasoning.recommendedHeavy, 'XHigh')
  assert.notEqual(reasoning.ownerNativeDefault, reasoning.recommendedRoutine)
})