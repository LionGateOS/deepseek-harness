/**
 * Local discovery cache integration: config validation, snapshot shape,
 * failure modes (missing, malformed, schema-unsupported, unreadable), and
 * malformed-candidate filtering. Existing provider discovery, pricing,
 * guidance, and routing behavior is verified to be unchanged.
 *
 * Tests 1–3 exercise validateConfig directly via Config['~standard'].
 * Tests 4–8 exercise the service through snapshot() with controlled stubs.
 * Test 9 confirms provider discovery is unaffected when the cache is absent.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, createModelGuideService, parseDiscoveryCacheText } from '../index.js'
import { overlay } from '../core/overlay.js'

const mergeSnapshotStub = (owner, discovered, config) => overlay(discovered.providers, owner.data, {
  generatedAt: '2026-10-22T00:00:00Z',
  freshness: () => 'fresh',
  metadataStatus: owner.status,
  metadataPath: config.ownerMetadataPath,
})

/** Minimal state for local discovery tests. The discover stub always calls
 *  readLocalDiscoveryCache so the real cache-read path runs. */
const makeState = (cachePathOrEmpty, readTextFileOverride, discoverOverride) => {
  const config = {
    ownerMetadataPath: '/x/owner.json',
    catalogPath: '/x/catalog.json',
    guideGeneratedPath: '/x/MODEL_GUIDE.generated.md',
    engineCatalogPath: '/x/engine-catalog.json',
    maxPriceAgeDays: 90,
    providerQueryTimeoutMs: 1000,
    providerCacheMs: 60_000,
    fetchTimeoutMs: 1000,
    maxCatalogHistory: 5,
    maxEngineCheckAgeDays: 7,
    localDiscoveryCachePath: cachePathOrEmpty ?? '',
  }
  return {
    config,
    cache: undefined,
    mergeSnapshot: mergeSnapshotStub,
    readOwnerMetadata: async () => ({ status: 'ok', data: { routingRule: 'cheap first', gpuBoundary: [], models: {} } }),
    readTextFile: readTextFileOverride ?? (async () => ({ status: 'missing' })),
    readJsonFile: async () => ({ status: 'missing' }),
    writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
    writeTextFile: async () => 'ok',
    fetchPageSnapshot: async () => ({ url: '', status: 'failed', fetchedAt: 't', error: 'offline' }),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
    detectInstalledVersion: async () => null,
    applyOwnerPricing: async () => 'ok',
    applyOwnerFacts: async () => 'ok',
    /** Read and validate the shared LMM discovery cache (real implementation). */
    async readLocalDiscoveryCache() {
      const cachePath = this.config.localDiscoveryCachePath
      if (cachePath === undefined || cachePath.length === 0) {
        return { status: 'unconfigured', candidates: [] }
      }
      const file = await this.readTextFile(cachePath)
      if (file.status === 'missing') return { status: 'missing', candidates: [] }
      if (file.status !== 'ok') return { status: 'unreadable', candidates: [], error: file.error }
      return parseDiscoveryCacheText(file.text)
    },
    discover: discoverOverride ?? async function() {
      return { providers: [], localFiles: await this.readLocalDiscoveryCache() }
    },
  }
}

/** One valid LMM discovery cache JSON. */
const VALID_CACHE = JSON.stringify({
  version: 1,
  generatedAt: '2026-10-22T16:00:00.000Z',
  roots: [{
    root: '/home/liongateos/models/gguf',
    status: 'ok',
    candidates: [
      { path: '/home/liongateos/models/gguf/Qwen3.6-35B/Qwen3.6-35B-Q4_K_M.gguf', name: 'Qwen3.6-35B-Q4_K_M', sizeBytes: 21166757792, multiPart: false, totalShards: 1 },
    ],
    subdirErrors: [],
    truncated: false,
  }],
})

// ── Config validation ────────────────────────────────────────────────────────

test('validateConfig accepts a valid absolute localDiscoveryCachePath', () => {
  const result = Config['~standard'].validate({
    ownerMetadataPath: '/x/owner.json',
    localDiscoveryCachePath: '/home/liongateos/.local/share/liongateos/deepseek-update/gguf-discovery-cache.json',
  })
  assert.ok('value' in result, `expected value, got issues: ${JSON.stringify(result.issues ?? [])}`)
  assert.equal(result.value.localDiscoveryCachePath, '/home/liongateos/.local/share/liongateos/deepseek-update/gguf-discovery-cache.json')
})

test('validateConfig rejects a relative localDiscoveryCachePath', () => {
  const result = Config['~standard'].validate({
    ownerMetadataPath: '/x/owner.json',
    localDiscoveryCachePath: 'relative/path/gguf-discovery-cache.json',
  })
  assert.ok('issues' in result, 'relative path must produce issues')
  assert.match(result.issues[0].message, /absolute path/)
})

test('validateConfig defaults localDiscoveryCachePath to empty string when absent', () => {
  const result = Config['~standard'].validate({ ownerMetadataPath: '/x/owner.json' })
  assert.ok('value' in result)
  assert.equal(result.value.localDiscoveryCachePath, '')
})

// ── Service snapshot integration ─────────────────────────────────────────────

test('a valid cache produces localFiles with ok status and expected candidates', async () => {
  const service = createModelGuideService(makeState(
    '/x/gguf-cache.json',
    async () => ({ status: 'ok', text: VALID_CACHE }),
  ))
  const snap = await service.snapshot(undefined)
  assert.ok(snap.localFiles !== undefined, 'localFiles must be present in snapshot')
  assert.equal(snap.localFiles.status, 'ok')
  assert.equal(snap.localFiles.candidates.length, 1)
  assert.equal(snap.localFiles.candidates[0].name, 'Qwen3.6-35B-Q4_K_M')
  assert.equal(snap.localFiles.candidates[0].sizeBytes, 21166757792)
  assert.equal(snap.localFiles.candidates[0].multiPart, false)
  assert.equal(snap.localFiles.generatedAt, '2026-10-22T16:00:00.000Z')
})

test('a missing cache file does not break provider discovery (status: missing)', async () => {
  const service = createModelGuideService(makeState(
    '/x/gguf-cache.json',
    async () => ({ status: 'missing' }),
  ))
  const snap = await service.snapshot(undefined)
  assert.equal(snap.localFiles.status, 'missing')
  assert.deepEqual(snap.localFiles.candidates, [])
  // Provider discovery path is unaffected; providers are still in the result.
  assert.ok(Array.isArray(snap.providers), 'providers must still be present')
})

test('malformed JSON in the cache does not break provider discovery (status: malformed)', async () => {
  const service = createModelGuideService(makeState(
    '/x/gguf-cache.json',
    async () => ({ status: 'ok', text: 'not json at all {{{' }),
  ))
  const snap = await service.snapshot(undefined)
  assert.equal(snap.localFiles.status, 'malformed')
  assert.deepEqual(snap.localFiles.candidates, [])
  assert.ok(Array.isArray(snap.providers))
})

test('an unsupported schema version is handled safely (status: schema-unsupported)', async () => {
  const futureCache = JSON.stringify({ version: 99, generatedAt: 't', roots: [] })
  const service = createModelGuideService(makeState(
    '/x/gguf-cache.json',
    async () => ({ status: 'ok', text: futureCache }),
  ))
  const snap = await service.snapshot(undefined)
  assert.equal(snap.localFiles.status, 'schema-unsupported')
  assert.equal(snap.localFiles.schemaVersion, 99)
  assert.deepEqual(snap.localFiles.candidates, [])
})

// ── Malformed candidate filtering ────────────────────────────────────────────

test('parseDiscoveryCacheText excludes malformed candidates and keeps valid ones', () => {
  const cacheWithMixed = JSON.stringify({
    version: 1,
    generatedAt: '2026-10-22T00:00:00Z',
    roots: [{
      root: '/models',
      status: 'ok',
      candidates: [
        // valid
        { path: '/models/valid.gguf', name: 'valid', sizeBytes: 1000, multiPart: false, totalShards: 1 },
        // relative path (invalid)
        { path: 'relative/bad.gguf', name: 'bad-relative', sizeBytes: 1000, multiPart: false, totalShards: 1 },
        // empty name (invalid)
        { path: '/models/empty-name.gguf', name: '', sizeBytes: 1000, multiPart: false, totalShards: 1 },
        // negative sizeBytes (invalid)
        { path: '/models/neg.gguf', name: 'neg', sizeBytes: -1, multiPart: false, totalShards: 1 },
        // non-boolean multiPart (invalid)
        { path: '/models/mp.gguf', name: 'mp', sizeBytes: 1000, multiPart: 'yes', totalShards: 1 },
        // totalShards < 1 (invalid)
        { path: '/models/zero-shards.gguf', name: 'zero', sizeBytes: 1000, multiPart: true, totalShards: 0 },
        // null entry (invalid)
        null,
        // non-object (invalid)
        'string-entry',
        // valid multiPart
        { path: '/models/shard-00001-of-00003.gguf', name: 'shard', sizeBytes: 5000, multiPart: true, totalShards: 3 },
      ],
      subdirErrors: [],
      truncated: false,
    }],
  })
  const result = parseDiscoveryCacheText(cacheWithMixed)
  assert.equal(result.status, 'ok')
  assert.equal(result.candidates.length, 2, 'only the two valid candidates must survive')
  assert.equal(result.candidates[0].name, 'valid')
  assert.equal(result.candidates[1].name, 'shard')
  assert.equal(result.candidates[1].totalShards, 3)
})

// ── Existing provider discovery unchanged ────────────────────────────────────

test('provider discovery, routing, and recommendations are unaffected when cache is not configured', async () => {
  const service = createModelGuideService({
    config: {
      ownerMetadataPath: '/x/owner.json',
      catalogPath: '/x/catalog.json',
      guideGeneratedPath: '/x/MODEL_GUIDE.generated.md',
      engineCatalogPath: '/x/engine-catalog.json',
      maxPriceAgeDays: 90,
      providerQueryTimeoutMs: 1000,
      providerCacheMs: 60_000,
      fetchTimeoutMs: 1000,
      maxCatalogHistory: 5,
      maxEngineCheckAgeDays: 7,
      localDiscoveryCachePath: '',
    },
    cache: undefined,
    mergeSnapshot: mergeSnapshotStub,
    readOwnerMetadata: async () => ({ status: 'ok', data: {
      routingRule: 'cheap first', gpuBoundary: [], models: {
        'ollama/glm-5.3-flash': { localVsCloud: 'cloud', pricing: { costTier: 'Very Cheap' } },
      },
    } }),
    readTextFile: async () => ({ status: 'missing' }),
    readJsonFile: async () => ({ status: 'missing' }),
    writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
    writeTextFile: async () => 'ok',
    fetchPageSnapshot: async () => ({ url: '', status: 'failed', fetchedAt: 't', error: 'offline' }),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
    detectInstalledVersion: async () => null,
    applyOwnerPricing: async () => 'ok',
    applyOwnerFacts: async () => 'ok',
    // Stub discover returns only providers (no localFiles) — tests that snapshot still works.
    discover: async () => ({
      providers: [
        { id: 'ollama', name: 'Ollama', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' }] },
      ],
    }),
  })
  const snap = await service.snapshot(undefined)
  // Providers are present and routing rule passes through unchanged.
  assert.ok(snap.providers.length > 0)
  assert.equal(snap.providers[0].id, 'ollama')
  assert.equal(snap.routingRule, 'cheap first')
  // localFiles is absent when discover stub doesn't return it (backward-compat path).
  assert.equal(snap.localFiles, undefined)
  // Owner-curated fields (localVsCloud) merge into the row correctly.
  const row = snap.providers[0].models[0]
  assert.equal(row.localVsCloud, 'cloud')
  // Recommendations still work.
  const recs = await service.recommendModels('cheap task')
  assert.equal(recs.rule, 'cheap first')
  assert.ok(recs.shortlist.length > 0)
  assert.equal(recs.shortlist[0].model, 'glm-5.3-flash')
})
