/**
 * Engine verification registry: validation, merging, and service integration.
 *
 * Covers: validateOneVerification (required fields, optional fields, reject
 * cases), validateEngineVerifications (list handling, partial failures),
 * mergeVerificationsIntoEngines (matching, non-matching, empty), and the
 * engineCatalog() service method merging owner verifications into the stored
 * engine catalog.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateOneVerification,
  validateEngineVerifications,
  mergeVerificationsIntoEngines,
} from '../core/engine-verification.js'
import { validateOwnerMetadata } from '../core/overlay.js'
import { createModelGuideService } from '../index.js'

// ---------------------------------------------------------------------------
// validateOneVerification
// ---------------------------------------------------------------------------

const validRecord = {
  engineId: 'llama.cpp',
  engineVersion: 'b5001',
  modelKey: 'qwen-local//home/liongateos/models/gguf/Qwen3-27B.gguf',
  verifiedAt: '2026-10-21T12:00:00Z',
  result: 'passed',
}

test('validateOneVerification accepts a minimal valid record', () => {
  const result = validateOneVerification(validRecord)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.engineId, 'llama.cpp')
  assert.equal(result.record.engineVersion, 'b5001')
  assert.equal(result.record.result, 'passed')
  assert.equal('gpuUuids' in result.record, false)
  assert.equal('evidenceNote' in result.record, false)
})

test('validateOneVerification accepts result "failed"', () => {
  const result = validateOneVerification({ ...validRecord, result: 'failed' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.result, 'failed')
})

test('validateOneVerification includes optional gpuUuids', () => {
  const result = validateOneVerification({
    ...validRecord,
    gpuUuids: ['GPU-4144e557-ad9a-83b3-014a-61f67141c547'],
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.record.gpuUuids, ['GPU-4144e557-ad9a-83b3-014a-61f67141c547'])
})

test('validateOneVerification includes optional evidenceNote', () => {
  const result = validateOneVerification({
    ...validRecord,
    evidenceNote: 'Full inference run completed successfully',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.evidenceNote, 'Full inference run completed successfully')
})

test('validateOneVerification trims string fields', () => {
  const result = validateOneVerification({
    engineId: '  llama.cpp  ',
    engineVersion: '  b5001  ',
    modelKey: '  qwen-local/model.gguf  ',
    verifiedAt: '  2026-10-21  ',
    result: 'passed',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.engineId, 'llama.cpp')
  assert.equal(result.record.engineVersion, 'b5001')
  assert.equal(result.record.verifiedAt, '2026-10-21')
})

test('validateOneVerification rejects null', () => {
  const result = validateOneVerification(null)
  assert.equal(result.ok, false)
  assert.match(result.reason, /not an object/)
})

test('validateOneVerification rejects an array', () => {
  const result = validateOneVerification([])
  assert.equal(result.ok, false)
  assert.match(result.reason, /not an object/)
})

test('validateOneVerification rejects missing engineId', () => {
  const { engineId: _unused, ...rest } = validRecord
  const result = validateOneVerification(rest)
  assert.equal(result.ok, false)
  assert.match(result.reason, /engineId/)
})

test('validateOneVerification rejects empty engineId', () => {
  const result = validateOneVerification({ ...validRecord, engineId: '   ' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /engineId/)
})

test('validateOneVerification rejects missing engineVersion', () => {
  const { engineVersion: _unused, ...rest } = validRecord
  const result = validateOneVerification(rest)
  assert.equal(result.ok, false)
  assert.match(result.reason, /engineVersion/)
})

test('validateOneVerification rejects missing modelKey', () => {
  const { modelKey: _unused, ...rest } = validRecord
  const result = validateOneVerification(rest)
  assert.equal(result.ok, false)
  assert.match(result.reason, /modelKey/)
})

test('validateOneVerification rejects missing verifiedAt', () => {
  const { verifiedAt: _unused, ...rest } = validRecord
  const result = validateOneVerification(rest)
  assert.equal(result.ok, false)
  assert.match(result.reason, /verifiedAt/)
})

test('validateOneVerification rejects an invalid result value', () => {
  const result = validateOneVerification({ ...validRecord, result: 'unknown' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /result must be/)
})

test('validateOneVerification rejects result null', () => {
  const result = validateOneVerification({ ...validRecord, result: null })
  assert.equal(result.ok, false)
  assert.match(result.reason, /result must be/)
})

test('validateOneVerification skips non-string gpuUuid entries', () => {
  const result = validateOneVerification({
    ...validRecord,
    gpuUuids: ['GPU-valid', null, 42, '  ', 'GPU-also-valid'],
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.record.gpuUuids, ['GPU-valid', 'GPU-also-valid'])
})

test('validateOneVerification omits gpuUuids when all entries are invalid', () => {
  const result = validateOneVerification({ ...validRecord, gpuUuids: [null, 42] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal('gpuUuids' in result.record, false)
})

// ---------------------------------------------------------------------------
// validateEngineVerifications
// ---------------------------------------------------------------------------

test('validateEngineVerifications returns empty valid list for undefined input', () => {
  const { valid, problems } = validateEngineVerifications(undefined)
  assert.deepEqual(valid, [])
  assert.deepEqual(problems, [])
})

test('validateEngineVerifications returns empty valid list for null input', () => {
  const { valid, problems } = validateEngineVerifications(null)
  assert.deepEqual(valid, [])
  assert.deepEqual(problems, [])
})

test('validateEngineVerifications reports a problem for non-array input', () => {
  const { valid, problems } = validateEngineVerifications('not a list')
  assert.deepEqual(valid, [])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not a list/)
})

test('validateEngineVerifications returns all valid records from a clean list', () => {
  const { valid, problems } = validateEngineVerifications([validRecord, { ...validRecord, engineId: 'ollama' }])
  assert.equal(valid.length, 2)
  assert.deepEqual(problems, [])
})

test('validateEngineVerifications skips invalid records and reports problems', () => {
  const bad = { engineId: 'ollama' } // missing required fields
  const { valid, problems } = validateEngineVerifications([validRecord, bad])
  assert.equal(valid.length, 1)
  assert.equal(valid[0].engineId, 'llama.cpp')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /engineVerifications\[1\]/)
})

test('validateEngineVerifications reports the index of each bad record', () => {
  const bad1 = { result: 'passed' }
  const bad2 = { engineId: 'vllm', result: 'invalid' }
  const { valid, problems } = validateEngineVerifications([bad1, validRecord, bad2])
  assert.equal(valid.length, 1)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /\[0\]/)
  assert.match(problems[1], /\[2\]/)
})

// ---------------------------------------------------------------------------
// mergeVerificationsIntoEngines
// ---------------------------------------------------------------------------

const stubEngines = [
  { id: 'vllm', displayName: 'vLLM', status: 'not-checked' },
  { id: 'llama.cpp', displayName: 'llama.cpp', status: 'success', latestRelease: 'b5100' },
  { id: 'ollama', displayName: 'Ollama', status: 'not-checked' },
]

test('mergeVerificationsIntoEngines attaches verifications to matching engines', () => {
  const verifications = [
    { ...validRecord, engineId: 'llama.cpp' },
    { ...validRecord, engineId: 'llama.cpp', engineVersion: 'b4900' },
  ]
  const result = mergeVerificationsIntoEngines(stubEngines, verifications)
  const llamaEntry = result.find((e) => e.id === 'llama.cpp')
  assert.equal(llamaEntry.verifications.length, 2)
  assert.equal(llamaEntry.verifications[0].engineVersion, 'b5001')
  assert.equal(llamaEntry.verifications[1].engineVersion, 'b4900')
})

test('mergeVerificationsIntoEngines gives every engine an empty verifications array', () => {
  const result = mergeVerificationsIntoEngines(stubEngines, [])
  for (const engine of result) {
    assert.ok(Array.isArray(engine.verifications))
    assert.equal(engine.verifications.length, 0)
  }
})

test('mergeVerificationsIntoEngines ignores verifications with unknown engineId', () => {
  const verifications = [{ ...validRecord, engineId: 'unknown-engine' }]
  const result = mergeVerificationsIntoEngines(stubEngines, verifications)
  for (const engine of result) {
    assert.equal(engine.verifications.length, 0)
  }
})

test('mergeVerificationsIntoEngines does not mutate the input engines', () => {
  const verifications = [{ ...validRecord, engineId: 'vllm' }]
  const original = structuredClone(stubEngines)
  mergeVerificationsIntoEngines(stubEngines, verifications)
  assert.deepEqual(stubEngines, original)
})

test('mergeVerificationsIntoEngines preserves all original engine fields', () => {
  const verifications = [{ ...validRecord, engineId: 'llama.cpp' }]
  const result = mergeVerificationsIntoEngines(stubEngines, verifications)
  const llamaEntry = result.find((e) => e.id === 'llama.cpp')
  assert.equal(llamaEntry.displayName, 'llama.cpp')
  assert.equal(llamaEntry.latestRelease, 'b5100')
  assert.equal(llamaEntry.status, 'success')
})

// ---------------------------------------------------------------------------
// validateOwnerMetadata — engineVerifications field
// ---------------------------------------------------------------------------

test('validateOwnerMetadata accepts engineVerifications from owner metadata', () => {
  const raw = JSON.stringify({
    version: 1,
    routingRule: 'cheap first',
    models: {},
    engineVerifications: [validRecord],
  })
  const result = validateOwnerMetadata(raw)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal(result.data.engineVerifications?.length, 1)
  assert.equal(result.data.engineVerifications?.[0].engineId, 'llama.cpp')
})

test('validateOwnerMetadata reports problems for invalid engineVerifications entries', () => {
  const raw = JSON.stringify({
    version: 1,
    models: {},
    engineVerifications: [
      validRecord,
      { engineId: 'bad-entry' }, // missing required fields
    ],
  })
  const result = validateOwnerMetadata(raw)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  // One valid record kept, one problem reported
  assert.equal(result.data.engineVerifications?.length, 1)
  assert.ok(result.problems.some((p) => p.includes('engineVerifications[1]')))
})

test('validateOwnerMetadata omits engineVerifications when none are valid', () => {
  const raw = JSON.stringify({
    version: 1,
    models: {},
    engineVerifications: [{ engineId: 'only-id' }],
  })
  const result = validateOwnerMetadata(raw)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal('engineVerifications' in result.data, false)
})

test('validateOwnerMetadata ignores engineVerifications when absent', () => {
  const raw = JSON.stringify({ version: 1, models: {} })
  const result = validateOwnerMetadata(raw)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal('engineVerifications' in result.data, false)
})

// ---------------------------------------------------------------------------
// engineCatalog() service method — verification merging
// ---------------------------------------------------------------------------

const stubState = (overrides = {}) => ({
  config: {
    ownerMetadataPath: '/x/owner-model-guidance.json',
    catalogPath: '/x/model-catalog.json',
    guideGeneratedPath: '/x/MODEL_GUIDE.generated.md',
    engineCatalogPath: '/x/engine-catalog.json',
    maxEngineCheckAgeDays: 7,
    maxPriceAgeDays: 90,
    providerQueryTimeoutMs: 4000,
    providerCacheMs: 60000,
    fetchTimeoutMs: 8000,
    maxCatalogHistory: 5,
    pricingProviderId: 'ollama',
  },
  // engineCatalog() depends on readJsonFile, readOwnerMetadata
  readJsonFile: async () => ({ status: 'missing' }),
  readTextFile: async () => ({ status: 'missing' }),
  readOwnerMetadata: async () => ({ status: 'missing', data: {} }),
  writeTextFile: async () => 'ok',
  fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: new Date().toISOString(), error: 'stub' }),
  detectInstalledVersion: async () => null,
  discover: async () => ({ providers: [] }),
  mergeSnapshot: () => ({ generatedAt: new Date().toISOString(), metadata: { status: 'missing', path: '' }, routingRule: null, gpuBoundary: null, providers: [], curatedOnly: [], researchCounts: { newlyDetected: 0, allUnverified: 0 } }),
  ...overrides,
})

test('engineCatalog() returns not-checked engines with empty verifications when catalog file is missing and owner has no verifications', async () => {
  const service = createModelGuideService(stubState())
  const result = await service.engineCatalog()
  assert.equal(result.status, 'not-checked')
  assert.ok(Array.isArray(result.engines))
  assert.ok(result.engines.length > 0)
  for (const engine of result.engines) {
    assert.ok(Array.isArray(engine.verifications))
    assert.equal(engine.verifications.length, 0)
  }
})

test('engineCatalog() merges owner verifications into not-checked engines', async () => {
  const service = createModelGuideService(stubState({
    readOwnerMetadata: async () => ({
      status: 'ok',
      data: {
        models: {},
        engineVerifications: [{ ...validRecord, engineId: 'llama.cpp' }],
      },
    }),
  }))
  const result = await service.engineCatalog()
  assert.equal(result.status, 'not-checked')
  const llamaEntry = result.engines.find((e) => e.id === 'llama.cpp')
  assert.equal(llamaEntry.verifications.length, 1)
  assert.equal(llamaEntry.verifications[0].engineVersion, 'b5001')
  const vllmEntry = result.engines.find((e) => e.id === 'vllm')
  assert.equal(vllmEntry.verifications.length, 0)
})

test('engineCatalog() merges verifications into a stored catalog', async () => {
  const storedCatalog = {
    version: 1,
    generatedAt: '2026-10-21T00:00:00Z',
    engines: [
      { id: 'vllm', displayName: 'vLLM', status: 'success', latestRelease: 'v0.6.3' },
      { id: 'llama.cpp', displayName: 'llama.cpp', status: 'success', latestRelease: 'b5100' },
    ],
  }
  const service = createModelGuideService(stubState({
    readJsonFile: async () => ({ status: 'ok', value: storedCatalog }),
    readOwnerMetadata: async () => ({
      status: 'ok',
      data: {
        models: {},
        engineVerifications: [{ ...validRecord, engineId: 'vllm', engineVersion: 'v0.6.0' }],
      },
    }),
  }))
  const result = await service.engineCatalog()
  assert.equal(result.status, 'ok')
  const vllmEntry = result.engines.find((e) => e.id === 'vllm')
  assert.equal(vllmEntry.verifications.length, 1)
  assert.equal(vllmEntry.verifications[0].engineVersion, 'v0.6.0')
  const llamaEntry = result.engines.find((e) => e.id === 'llama.cpp')
  assert.equal(llamaEntry.verifications.length, 0)
})

test('engineCatalog() returns an error status when the catalog is unreadable', async () => {
  const service = createModelGuideService(stubState({
    readJsonFile: async () => ({ status: 'unreadable', error: 'EACCES' }),
    readOwnerMetadata: async () => ({ status: 'ok', data: { models: {} } }),
  }))
  const result = await service.engineCatalog()
  assert.equal(result.status, 'unreadable')
  assert.deepEqual(result.engines, [])
})

test('engineCatalog() does not merge verifications when owner metadata is missing', async () => {
  const storedCatalog = {
    version: 1,
    generatedAt: '2026-10-21T00:00:00Z',
    engines: [{ id: 'ollama', displayName: 'Ollama', status: 'success', latestRelease: 'v0.3.1' }],
  }
  const service = createModelGuideService(stubState({
    readJsonFile: async () => ({ status: 'ok', value: storedCatalog }),
    readOwnerMetadata: async () => ({ status: 'missing', data: {} }),
  }))
  const result = await service.engineCatalog()
  assert.equal(result.status, 'ok')
  const ollamaEntry = result.engines.find((e) => e.id === 'ollama')
  assert.ok(Array.isArray(ollamaEntry.verifications))
  assert.equal(ollamaEntry.verifications.length, 0)
})
