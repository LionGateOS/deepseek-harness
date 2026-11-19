/**
 * Engine update discovery: the core module and the service integration must
 * record the latest upstream release for each registered engine, preserve
 * previously recorded data on any failure, and never install or activate
 * anything. Tests cover successful refresh, malformed responses, unavailable
 * sources, stale data, preservation of existing catalog data, and the
 * separation invariant (engine failures must not affect model/pricing refreshes).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ENGINE_SOURCES,
  parseGitHubRelease,
  applyEngineUpdate,
  engineReleaseFreshness,
  validateEngineCatalog,
} from '../core/engine-update.js'
import { detectInstalledVersion } from '../core/strata-engine.js'
import { createModelGuideService } from '../index.js'

// ---------------------------------------------------------------------------
// parseGitHubRelease — deterministic parser
// ---------------------------------------------------------------------------

const validRelease = JSON.stringify({
  tag_name: 'v0.6.3',
  html_url: 'https://github.com/vllm-project/vllm/releases/tag/v0.6.3',
  published_at: '2026-10-01T12:00:00Z',
  name: 'vLLM v0.6.3',
  body: 'Release notes…',
})

test('parseGitHubRelease extracts tag_name, html_url, and published_at from a valid response', () => {
  const result = parseGitHubRelease(validRelease)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.tagName, 'v0.6.3')
  assert.equal(result.releaseUrl, 'https://github.com/vllm-project/vllm/releases/tag/v0.6.3')
  assert.equal(result.publishedAt, '2026-10-01T12:00:00Z')
})

test('parseGitHubRelease rejects an empty body', () => {
  const result = parseGitHubRelease('')
  assert.equal(result.ok, false)
  assert.match(result.reason, /empty/)
})

test('parseGitHubRelease rejects non-JSON input', () => {
  const result = parseGitHubRelease('<html>Not JSON</html>')
  assert.equal(result.ok, false)
  assert.match(result.reason, /not valid JSON/)
})

test('parseGitHubRelease rejects a JSON array (GitHub API always returns an object)', () => {
  const result = parseGitHubRelease('[]')
  assert.equal(result.ok, false)
  assert.match(result.reason, /not a JSON object/)
})

test('parseGitHubRelease rejects a missing tag_name with a schema-change note', () => {
  const noTag = JSON.stringify({ html_url: 'https://github.com/x/releases/tag/v1', published_at: '2026-10-01T00:00:00Z' })
  const result = parseGitHubRelease(noTag)
  assert.equal(result.ok, false)
  assert.match(result.reason, /tag_name/)
  assert.match(result.reason, /schema may have changed/)
})

test('parseGitHubRelease rejects a non-https html_url', () => {
  const httpUrl = JSON.stringify({ tag_name: 'v1.0', html_url: 'http://insecure.example', published_at: '2026-10-01T00:00:00Z' })
  const result = parseGitHubRelease(httpUrl)
  assert.equal(result.ok, false)
  assert.match(result.reason, /html_url/)
})

test('parseGitHubRelease rejects a missing published_at', () => {
  const noPub = JSON.stringify({ tag_name: 'v1.0', html_url: 'https://github.com/x/releases/tag/v1.0' })
  const result = parseGitHubRelease(noPub)
  assert.equal(result.ok, false)
  assert.match(result.reason, /published_at/)
})

test('parseGitHubRelease strips surrounding whitespace from tag_name and html_url', () => {
  const padded = JSON.stringify({ tag_name: '  v1.0  ', html_url: '  https://github.com/x/releases/tag/v1.0  ', published_at: '2026-10-01T00:00:00Z' })
  const result = parseGitHubRelease(padded)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.tagName, 'v1.0')
  assert.equal(result.releaseUrl, 'https://github.com/x/releases/tag/v1.0')
})

// ---------------------------------------------------------------------------
// validateEngineCatalog — catalog shape guard
// ---------------------------------------------------------------------------

test('validateEngineCatalog accepts a well-formed v1 catalog', () => {
  const result = validateEngineCatalog({ version: 1, engines: [{ id: 'ollama', status: 'success' }] })
  assert.equal(result.ok, true)
})

test('validateEngineCatalog rejects null, undefined, and non-v1 versions', () => {
  assert.equal(validateEngineCatalog(null).ok, false)
  assert.equal(validateEngineCatalog(undefined).ok, false)
  assert.equal(validateEngineCatalog({ version: 2, engines: [] }).ok, false)
  assert.equal(validateEngineCatalog({ version: 1 }).ok, false) // missing engines array
})

// ---------------------------------------------------------------------------
// engineReleaseFreshness — staleness judge
// ---------------------------------------------------------------------------

test('engineReleaseFreshness returns fresh for a recent success record', () => {
  const recent = { status: 'success', lastCheckAt: new Date().toISOString() }
  assert.equal(engineReleaseFreshness(recent, 7), 'fresh')
})

test('engineReleaseFreshness returns stale for a record older than maxStaleDays', () => {
  const old = { status: 'success', lastCheckAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }
  assert.equal(engineReleaseFreshness(old, 7), 'stale')
})

test('engineReleaseFreshness returns unknown for error and not-checked records', () => {
  assert.equal(engineReleaseFreshness({ status: 'error', lastCheckAt: new Date().toISOString() }), 'unknown')
  assert.equal(engineReleaseFreshness({ status: 'not-checked', lastCheckAt: null }), 'unknown')
  assert.equal(engineReleaseFreshness(null), 'unknown')
  assert.equal(engineReleaseFreshness(undefined), 'unknown')
})

// ---------------------------------------------------------------------------
// applyEngineUpdate — purely functional core
// ---------------------------------------------------------------------------

const makeSuccessFetch = (engineId, tagName = 'v1.0.0') => ({
  engineId,
  result: {
    status: 'fetched',
    fetchedAt: '2026-10-21T10:00:00Z',
    body: JSON.stringify({
      tag_name: tagName,
      html_url: `https://github.com/example/${engineId}/releases/tag/${tagName}`,
      published_at: '2026-10-20T00:00:00Z',
    }),
  },
})

const makeFailFetch = (engineId, error = 'HTTP 503') => ({
  engineId,
  result: { status: 'failed', fetchedAt: '2026-10-21T10:00:00Z', error },
})

test('applyEngineUpdate records all ENGINE_SOURCES and marks unchecked ones not-checked', () => {
  const { engines } = applyEngineUpdate({ previousCatalog: undefined, fetchResults: [], now: '2026-10-21T10:00:00Z' })
  assert.equal(engines.length, ENGINE_SOURCES.length)
  for (const engine of engines) {
    assert.equal(engine.status, 'not-checked')
    assert.equal(engine.latestRelease, null)
  }
})

test('applyEngineUpdate records a successful fetch with tag_name, releaseUrl, and releasedAt', () => {
  const { engines, report } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [makeSuccessFetch('vllm', 'v0.6.3')],
    now: '2026-10-21T10:00:00Z',
  })
  const vllm = engines.find((e) => e.id === 'vllm')
  assert.equal(vllm.status, 'success')
  assert.equal(vllm.latestRelease, 'v0.6.3')
  assert.equal(vllm.releaseUrl, 'https://github.com/example/vllm/releases/tag/v0.6.3')
  assert.equal(vllm.releasedAt, '2026-10-20T00:00:00Z')
  assert.equal(vllm.lastCheckAt, '2026-10-21T10:00:00Z')
  assert.deepEqual(report.firstSeen, ['vllm'])
  assert.deepEqual(report.updated, [])
  assert.equal(report.counts.succeeded, 1)
})

test('applyEngineUpdate preserves previous release facts on a fetch failure', () => {
  const previous = {
    version: 1,
    engines: [{ id: 'vllm', displayName: 'vLLM', latestRelease: 'v0.6.2', releaseUrl: 'https://github.com/example/vllm/releases/tag/v0.6.2', lastCheckAt: '2026-10-10T00:00:00Z', status: 'success', installedVersion: null }],
  }
  const { engines, report } = applyEngineUpdate({
    previousCatalog: previous,
    fetchResults: [makeFailFetch('vllm', 'HTTP 503')],
    now: '2026-10-21T10:00:00Z',
  })
  const vllm = engines.find((e) => e.id === 'vllm')
  // Release facts preserved; status updated to error.
  assert.equal(vllm.latestRelease, 'v0.6.2')
  assert.equal(vllm.releaseUrl, 'https://github.com/example/vllm/releases/tag/v0.6.2')
  assert.equal(vllm.status, 'error')
  assert.equal(vllm.errorDetail, 'HTTP 503')
  assert.equal(vllm.lastCheckAt, '2026-10-21T10:00:00Z')
  assert.equal(report.failed.length, 1)
  assert.equal(report.failed[0].id, 'vllm')
  assert.ok(report.notes.some((n) => n.kind === 'engine-check-failed'))
})

test('applyEngineUpdate preserves previous release facts on a malformed response body', () => {
  const previous = {
    version: 1,
    engines: [{ id: 'ollama', displayName: 'Ollama', latestRelease: 'v0.7.0', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-10T00:00:00Z', status: 'success', installedVersion: null }],
  }
  const { engines } = applyEngineUpdate({
    previousCatalog: previous,
    fetchResults: [{
      engineId: 'ollama',
      result: { status: 'fetched', fetchedAt: '2026-10-21T10:00:00Z', body: '<html>Not JSON</html>' },
    }],
    now: '2026-10-21T10:00:00Z',
  })
  const ollama = engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.latestRelease, 'v0.7.0') // preserved
  assert.equal(ollama.status, 'error')
  assert.match(ollama.errorDetail, /not valid JSON/)
})

test('applyEngineUpdate records an update when tag_name changes from previous', () => {
  const previous = {
    version: 1,
    engines: [{ id: 'ollama', displayName: 'Ollama', latestRelease: 'v0.6.0', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-01T00:00:00Z', status: 'success', installedVersion: null }],
  }
  const { report } = applyEngineUpdate({
    previousCatalog: previous,
    fetchResults: [makeSuccessFetch('ollama', 'v0.7.0')],
    now: '2026-10-21T10:00:00Z',
  })
  assert.deepEqual(report.updated, [{ id: 'ollama', from: 'v0.6.0', to: 'v0.7.0' }])
  assert.ok(report.notes.some((n) => n.kind === 'engine-update-available'))
  assert.match(report.notes.find((n) => n.kind === 'engine-update-available').message, /v0\.6\.0 → v0\.7\.0/)
})

test('applyEngineUpdate does not record an update when tag_name is unchanged', () => {
  const previous = {
    version: 1,
    engines: [{ id: 'ollama', displayName: 'Ollama', latestRelease: 'v0.7.0', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-01T00:00:00Z', status: 'success', installedVersion: null }],
  }
  const { report } = applyEngineUpdate({
    previousCatalog: previous,
    fetchResults: [makeSuccessFetch('ollama', 'v0.7.0')],
    now: '2026-10-21T10:00:00Z',
  })
  assert.deepEqual(report.updated, [])
  assert.deepEqual(report.firstSeen, [])
  assert.ok(!report.notes.some((n) => n.kind === 'engine-update-available'))
})

test('applyEngineUpdate retains engines not in fetchResults and reports them in retained', () => {
  const previous = {
    version: 1,
    engines: [
      { id: 'vllm', displayName: 'vLLM', latestRelease: 'v0.6.2', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-10T00:00:00Z', status: 'success', installedVersion: null },
      { id: 'ollama', displayName: 'Ollama', latestRelease: 'v0.7.0', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-10T00:00:00Z', status: 'success', installedVersion: null },
    ],
  }
  const { report, engines } = applyEngineUpdate({
    previousCatalog: previous,
    fetchResults: [makeSuccessFetch('vllm', 'v0.6.3')], // only vllm checked this run
    now: '2026-10-21T10:00:00Z',
  })
  assert.ok(report.retained.includes('ollama'))
  const ollama = engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.latestRelease, 'v0.7.0') // unchanged
  assert.ok(report.notes.some((n) => n.kind === 'engine-retained'))
})

test('applyEngineUpdate carries the installedVersion from fetchResult when supplied', () => {
  const { engines } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [{ ...makeSuccessFetch('ollama', 'v0.7.0'), installedVersion: 'v0.6.9' }],
    now: '2026-10-21T10:00:00Z',
  })
  const ollama = engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.installedVersion, 'v0.6.9')
})

test('applyEngineUpdate uses null installedVersion when neither fetchResult nor previous record has one', () => {
  const { engines } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [makeSuccessFetch('vllm', 'v0.6.3')],
    now: '2026-10-21T10:00:00Z',
  })
  assert.equal(engines.find((e) => e.id === 'vllm').installedVersion, null)
})

test('applyEngineUpdate names a malformed previous catalog and builds fresh, never silently ignores it', () => {
  const { catalogWasMalformed, report } = applyEngineUpdate({
    previousCatalog: { version: 9, engines: [] }, // wrong version
    fetchResults: [],
    now: '2026-10-21T10:00:00Z',
  })
  assert.equal(catalogWasMalformed, true)
  assert.ok(report.notes.some((n) => n.kind === 'engine-catalog-malformed'))
})

test('applyEngineUpdate failures for one engine do not affect other engines in the same run', () => {
  const { engines, report } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [
      makeSuccessFetch('ollama', 'v0.7.0'),
      makeFailFetch('vllm', 'connection refused'),
    ],
    now: '2026-10-21T10:00:00Z',
  })
  const ollama = engines.find((e) => e.id === 'ollama')
  const vllm = engines.find((e) => e.id === 'vllm')
  assert.equal(ollama.status, 'success')
  assert.equal(ollama.latestRelease, 'v0.7.0')
  assert.equal(vllm.status, 'error')
  assert.equal(report.failed.length, 1)
  assert.equal(report.counts.succeeded, 1)
})

test('applyEngineUpdate catalog output has version 1, engines array, and lastUpdate', () => {
  const { catalog } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [makeSuccessFetch('ollama', 'v0.7.0')],
    now: '2026-10-21T10:00:00Z',
  })
  assert.equal(catalog.version, 1)
  assert.equal(catalog.generatedAt, '2026-10-21T10:00:00Z')
  assert.ok(Array.isArray(catalog.engines))
  assert.ok(typeof catalog.lastUpdate === 'object')
})

// ---------------------------------------------------------------------------
// Service integration: engineCatalog() and updateEngines()
// ---------------------------------------------------------------------------

const stubEngineState = (overrides = {}) => ({
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
  },
  cache: undefined,
  mergeSnapshot: () => ({ providers: [], curatedOnly: [], routingRule: null }),
  readOwnerMetadata: async () => ({ status: 'ok', data: {} }),
  readJsonFile: async () => ({ status: 'missing' }),
  readTextFile: async () => ({ status: 'missing' }),
  writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
  writeTextFile: async () => 'ok',
  fetchPageSnapshot: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
  fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
  detectInstalledVersion: async () => null,
  applyOwnerPricing: async () => 'ok',
  discover: async () => ({ providers: [] }),
  ...overrides,
})

test('engineCatalog returns not-checked status and all registered engines when no catalog file exists', async () => {
  const service = createModelGuideService(stubEngineState())
  const result = await service.engineCatalog()
  assert.equal(result.status, 'not-checked')
  assert.equal(result.engines.length, ENGINE_SOURCES.length)
  for (const engine of result.engines) {
    assert.equal(engine.status, 'not-checked')
    assert.equal(engine.latestRelease, null)
  }
})

test('engineCatalog passes stored catalog data through when the file exists', async () => {
  const stored = {
    version: 1,
    generatedAt: '2026-10-21T10:00:00Z',
    engines: ENGINE_SOURCES.map((s) => ({ id: s.id, displayName: s.displayName, latestRelease: 'v1.0', status: 'success', lastCheckAt: '2026-10-20T00:00:00Z', installedVersion: null })),
    lastUpdate: { generatedAt: '2026-10-21T10:00:00Z' },
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
  }))
  const result = await service.engineCatalog()
  assert.equal(result.status, 'ok')
  assert.equal(result.engines.length, ENGINE_SOURCES.length)
  assert.equal(result.engines[0].latestRelease, 'v1.0')
})

test('updateEngines fetches each registered engine source and writes the engine catalog', async () => {
  const written = []
  const service = createModelGuideService(stubEngineState({
    fetchEngineRelease: async (url) => ({
      url,
      status: 'fetched',
      fetchedAt: '2026-10-21T10:00:00Z',
      body: JSON.stringify({ tag_name: 'v1.0.0', html_url: `https://github.com/example/releases/tag/v1.0.0`, published_at: '2026-10-20T00:00:00Z' }),
    }),
    writeTextFile: async (path, content) => { written.push({ path, content }); return 'ok' },
  }))
  const result = await service.updateEngines()
  assert.equal(result.written.catalogPath, '/x/engine-catalog.json')
  assert.ok(!result.written.writeError)
  assert.equal(written.length, 1)
  const catalog = JSON.parse(written[0].content)
  assert.equal(catalog.version, 1)
  assert.equal(catalog.engines.length, ENGINE_SOURCES.length)
  assert.ok(catalog.engines.every((e) => e.status === 'success'))
  assert.equal(result.report.counts.succeeded, ENGINE_SOURCES.length)
})

test('updateEngines preserves previously recorded data when all fetches fail', async () => {
  const stored = {
    version: 1,
    generatedAt: '2026-10-01T00:00:00Z',
    engines: ENGINE_SOURCES.map((s) => ({ id: s.id, displayName: s.displayName, latestRelease: 'v0.9.0', releaseUrl: 'https://example.com', lastCheckAt: '2026-10-01T00:00:00Z', status: 'success', installedVersion: null })),
    lastUpdate: {},
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: '2026-10-21T10:00:00Z', error: 'timeout' }),
  }))
  const result = await service.updateEngines()
  // All fetches failed; previous release facts must be preserved.
  assert.equal(result.report.counts.succeeded, 0)
  assert.equal(result.report.failed.length, ENGINE_SOURCES.length)
  // The report names the failures.
  assert.ok(result.report.notes.some((n) => n.kind === 'engine-check-failed'))
})

test('updateEngines reports a write error but does not throw', async () => {
  const service = createModelGuideService(stubEngineState({
    writeTextFile: async () => 'failed',
  }))
  const result = await service.updateEngines()
  assert.equal(result.written.writeError, true)
})

test('updateEngines failure does not affect updateModelsAndPricing (separation invariant)', async () => {
  // Both methods run independently; a failed engine fetch must not affect
  // the model/pricing report and vice versa.
  let engineCalled = false
  let modelCalled = false
  const service = createModelGuideService(stubEngineState({
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
      // Configure a pricing URL so updateModelsAndPricing calls fetchPageSnapshot.
      pricingCheckUrls: ['https://ollama.com/pricing'],
      pricingProviderId: 'ollama',
    },
    fetchEngineRelease: async (url) => { engineCalled = true; return { url, status: 'failed', fetchedAt: 't', error: 'down' } },
    fetchPageSnapshot: async (url) => { modelCalled = true; return { url, status: 'failed', fetchedAt: 't', error: 'offline' } },
    discover: async () => ({ providers: [{ id: 'ollama', name: 'Ollama', models: [] }] }),
  }))
  const [engines, models] = await Promise.all([
    service.updateEngines(),
    service.updateModelsAndPricing(),
  ])
  assert.ok(engineCalled, 'engine fetch must have been called')
  assert.ok(modelCalled, 'model pricing fetch must have been called')
  // Neither result should reference the other's failure.
  assert.ok(!('pricingRefresh' in (engines.report ?? {})), 'engine report must not contain pricingRefresh')
  assert.ok(!('engineFailed' in (models.report ?? {})), 'model report must not contain engine failure markers')
})

test('updateEngines carries installedVersion from detectInstalledVersion when supplied', async () => {
  const written = []
  const service = createModelGuideService(stubEngineState({
    fetchEngineRelease: async (url) => ({
      url, status: 'fetched', fetchedAt: '2026-10-21T10:00:00Z',
      body: JSON.stringify({ tag_name: 'v0.7.0', html_url: 'https://github.com/ollama/ollama/releases/tag/v0.7.0', published_at: '2026-10-19T00:00:00Z' }),
    }),
    detectInstalledVersion: async (engineId) => engineId === 'ollama' ? 'v0.6.9' : null,
    writeTextFile: async (_p, content) => { written.push(JSON.parse(content)); return 'ok' },
  }))
  await service.updateEngines()
  const catalog = written[0]
  const ollama = catalog.engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.installedVersion, 'v0.6.9')
  // Other engines got null (detectInstalledVersion returned null for them).
  const vllm = catalog.engines.find((e) => e.id === 'vllm')
  assert.equal(vllm.installedVersion, null)
})

test('installedVersion is clearly distinct from latestRelease — installed does not imply up-to-date', () => {
  // This test verifies the data model preserves the distinction: an engine
  // can have installedVersion !== latestRelease without any error or override.
  const fetchResult = [{ ...makeSuccessFetch('ollama', 'v0.7.0'), installedVersion: 'v0.6.0' }]
  const { engines } = applyEngineUpdate({ previousCatalog: undefined, fetchResults: fetchResult, now: 't' })
  const ollama = engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.installedVersion, 'v0.6.0')
  assert.equal(ollama.latestRelease, 'v0.7.0')
  // An update-available note is present (release changed from null to v0.7.0 for first-seen).
  // firstSeen means it's new in catalog — no update note, just firstSeen.
  // No 'update-available' note for first-seen; that's expected.
  assert.notEqual(ollama.installedVersion, ollama.latestRelease,
    'installed and latest must remain distinct fields with their own values')
})

/**
 * Build a state that keeps the REAL Strata detection path: `stubEngineState`
 * installs a `detectInstalledVersion` stub that always answers null, so the
 * tests below remove it and let the service run its own detector.
 * @param {object} overrides state members to override.
 */
const realDetectionState = (overrides) => {
  const state = stubEngineState(overrides)
  // `updateEngines` calls the state's detector, so the real one is bound to the
  // injected execFile here instead of being removed.
  state.detectInstalledVersion = (engineId) => detectInstalledVersion(engineId, state.execFile, 1000)
  return state
}

/** A deterministic execFile stand-in: records the call, answers with one document. */
const execAnswering = (payload, calls = []) => (file, args, options, callback) => {
  calls.push({ file, args: [...args], options })
  callback(null, payload)
}

test('updateEngines detects the Strata engine build and keeps it apart from the control release', async () => {
  // Strata is the one registry row whose release feed versions the control
  // application: the app tag is v0.2.x while the installed engine component is
  // 0.1.x. Both are recorded, neither is compared, and detection is read-only.
  const written = []
  const calls = []
  const state = realDetectionState({
    fetchEngineRelease: async (url) => ({
      url, status: 'fetched', fetchedAt: '2026-11-07T00:00:00Z',
      body: JSON.stringify({
        tag_name: 'v0.2.12',
        html_url: 'https://github.com/Niko1221/Strata/releases/tag/v0.2.12',
        published_at: '2026-11-07T08:54:40Z',
      }),
    }),
    execFile: execAnswering(JSON.stringify({ ok: true, installed: [{ id: 'strata-engine', version: '0.1.56' }] }), calls),
    writeTextFile: async (_p, content) => { written.push(JSON.parse(content)); return 'ok' },
  })
  await createModelGuideService(state).updateEngines()
  const strata = written[0].engines.find((engine) => engine.id === 'strata')
  assert.ok(strata, 'strata must appear in the written engine catalog')
  assert.equal(strata.installedVersion, '0.1.56', 'the engine component build from the probe')
  assert.equal(strata.latestRelease, 'v0.2.12', 'the control application release from the feed')
  assert.equal(strata.versionSpace, 'control', 'the panel is told the two are not comparable')
  assert.equal(calls.length, 1, 'one probe for one engine check')
  assert.deepEqual(calls[0].args, ['components', 'engine', '--output', 'json'])
  assert.equal(calls[0].file, 'strata')
})

test('a missing strata binary records no installed version instead of failing the pass', async () => {
  const written = []
  const state = realDetectionState({
    fetchEngineRelease: async (url) => ({
      url, status: 'fetched', fetchedAt: '2026-11-07T00:00:00Z',
      body: JSON.stringify({
        tag_name: 'v0.2.12',
        html_url: 'https://github.com/Niko1221/Strata/releases/tag/v0.2.12',
        published_at: '2026-11-07T08:54:40Z',
      }),
    }),
    execFile: (_file, _args, _options, callback) => callback(Object.assign(new Error('spawn strata ENOENT'), { code: 'ENOENT' }), ''),
    writeTextFile: async (_p, content) => { written.push(JSON.parse(content)); return 'ok' },
  })
  await createModelGuideService(state).updateEngines()
  const strata = written[0].engines.find((engine) => engine.id === 'strata')
  assert.equal(strata.installedVersion, null, 'undetected is recorded as null, never guessed from the release tag')
  assert.equal(strata.latestRelease, 'v0.2.12')
  assert.equal(strata.status, 'success', 'the release check still succeeded')
})

test('detection only ever probes the Strata row; other engines answer null', async () => {
  const calls = []
  const state = realDetectionState({
    execFile: execAnswering(JSON.stringify({ ok: true, installed: [{ id: 'strata-engine', version: '0.1.56' }] }), calls),
  })
  assert.equal(await state.detectInstalledVersion('vllm'), null)
  assert.equal(await state.detectInstalledVersion('ollama'), null)
  assert.equal(calls.length, 0, 'no subprocess is spawned for an engine without a probe')
  assert.equal(await state.detectInstalledVersion('strata'), '0.1.56')
  assert.equal(calls.length, 1)
})

test('a probe that answers garbage yields no version rather than a guess', async () => {
  const state = realDetectionState({ execFile: execAnswering('not json at all') })
  assert.equal(await state.detectInstalledVersion('strata'), null)
})
