/**
 * Engine advisor wiring: the service-level paths that connect detection, the
 * Strata feed, advice and the separate daily schedule.
 *
 * The contracts asserted here are the ones the panel and the owner depend on:
 * a Strata engine build reaches the catalog from the signed feed, a deployment
 * without detection or without a feed reader still completes the check, advice
 * is attached to what the panel reads, and the engine schedule is reported
 * separately from the model refresh.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENGINE_SOURCES } from '../core/engine-update.js'
import { readStrataEngineRelease, STRATA_UPDATE_FEED_URL } from '../core/strata-feed.js'
import { createModelGuideService } from '../index.js'

const STRATA_FEED = JSON.stringify({
  schema_version: 1,
  sequence: 122,
  channel: 'stable',
  generated_at: '2026-11-07T12:00:00Z',
  app: { version: '0.2.12' },
  control: { version: '0.1.58' },
  engine: {
    packages: [
      { version: '0.1.58', platform: 'linux-x86_64', variant: '', backend: 'cuda' },
      { version: '0.1.58', platform: 'linux-x86_64', variant: 'cuda13', backend: 'cuda', min_driver: { nvidia: '580.65' } },
    ],
  },
})

/** The release body every engine answers with, so only Strata is interesting. */
const releaseBody = (tag) => JSON.stringify({
  tag_name: tag,
  html_url: 'https://github.com/example/releases/tag/' + tag,
  published_at: '2026-11-03T00:00:00.000Z',
})

const baseState = (overrides = {}) => ({
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
    engineCheck: true,
    engineCheckHours: 24,
  },
  cache: undefined,
  mergeSnapshot: () => ({ providers: [], curatedOnly: [], routingRule: null }),
  readOwnerMetadata: async () => ({ status: 'ok', data: {} }),
  readJsonFile: async () => ({ status: 'missing' }),
  readTextFile: async () => ({ status: 'missing' }),
  writeCatalogAndGuide: async () => ({ catalog: 'ok', guide: 'ok' }),
  writeTextFile: async () => 'ok',
  fetchPageSnapshot: async (url) => ({ url, status: 'failed', fetchedAt: 't', error: 'offline' }),
  fetchEngineRelease: async (url) => ({ url, status: 'fetched', fetchedAt: '2026-11-08T02:00:00.000Z', body: releaseBody('v1.0.0') }),
  detectInstalledVersion: async () => null,
  applyOwnerPricing: async () => 'ok',
  discover: async () => ({ providers: [] }),
  ...overrides,
})

/** Capture what `updateEngines` writes so its catalog can be inspected. */
const captureWrite = (written) => async (path, content) => {
  written.push({ path, content })
  return 'ok'
}

test('updateEngines records the published Strata engine build from the signed feed', async () => {
  const written = []
  const service = createModelGuideService(baseState({
    writeTextFile: captureWrite(written),
    fetchEngineRelease: async (url) => ({
      url,
      status: 'fetched',
      fetchedAt: '2026-11-08T02:00:00.000Z',
      body: url.includes('strata-feed') ? STRATA_FEED : releaseBody('v0.2.12'),
    }),
    detectInstalledVersion: async (engineId) => (engineId === 'strata' ? '0.1.56' : null),
    fetchEngineFeed: async (url) => readStrataEngineRelease({
      url,
      fetchDocument: async (target) => ({ status: 'fetched', fetchedAt: '2026-11-08T02:00:00.000Z', body: target.includes('strata-feed') ? STRATA_FEED : releaseBody('v0.2.12') }),
      identity: async () => ({ platform: 'linux-x86_64', variant: 'cuda13' }),
      driverVersion: async () => '580.178.04',
    }),
  }))
  const result = await service.updateEngines()
  assert.equal(result.written.catalogPath, '/x/engine-catalog.json')

  const catalog = JSON.parse(written.at(-1).content)
  const strata = catalog.engines.find((engine) => engine.id === 'strata')
  assert.equal(strata.installedVersion, '0.1.56', 'the installed engine build is recorded')
  assert.equal(strata.latestRelease, 'v0.2.12', 'the application tag stays in its own field')
  assert.equal(strata.engineRelease, '0.1.58', 'the published engine build is recorded separately')
  assert.equal(strata.engineReleaseDetail.variant, 'cuda13')
  assert.equal(strata.engineReleaseDetail.minimumDriver, '580.65')
  assert.equal(strata.engineReleaseDetail.driverSatisfied, true)
})

test('updateEngines still completes when the deployment supplies no feed reader', async () => {
  // A Host without a feed capability must not lose the release check entirely:
  // Strata simply reports its application tag and no engine build.
  const written = []
  const service = createModelGuideService(baseState({
    writeTextFile: captureWrite(written),
    fetchEngineRelease: async (url) => ({ url, status: 'fetched', fetchedAt: '2026-11-08T02:00:00.000Z', body: releaseBody('v0.2.12') }),
    detectInstalledVersion: async () => null,
  }))
  const result = await service.updateEngines()
  assert.equal(result.report.counts.succeeded, ENGINE_SOURCES.length)
  const catalog = JSON.parse(written.at(-1).content)
  const strata = catalog.engines.find((engine) => engine.id === 'strata')
  assert.equal(strata.latestRelease, 'v0.2.12')
  assert.equal(strata.engineRelease ?? null, null)
})

test('a failed engine feed leaves the previous engine build in place', async () => {
  const written = []
  const previous = {
    version: 1,
    generatedAt: '2026-11-07T00:00:00.000Z',
    engines: ENGINE_SOURCES.map((source) => ({
      id: source.id,
      displayName: source.displayName,
      latestRelease: 'v0.2.12',
      status: 'success',
      lastCheckAt: '2026-11-07T00:00:00.000Z',
      installedVersion: source.id === 'strata' ? '0.1.56' : null,
      ...(source.id === 'strata' ? { engineRelease: '0.1.58' } : {}),
    })),
    lastUpdate: {},
  }
  const service = createModelGuideService(baseState({
    readJsonFile: async () => ({ status: 'ok', value: previous }),
    writeTextFile: captureWrite(written),
    fetchEngineRelease: async (url) => ({ url, status: 'failed', fetchedAt: '2026-11-08T02:00:00.000Z', error: 'offline' }),
    detectInstalledVersion: async () => null,
  }))
  await service.updateEngines()
  const catalog = JSON.parse(written.at(-1).content)
  const strata = catalog.engines.find((engine) => engine.id === 'strata')
  assert.equal(strata.engineRelease, '0.1.58', 'a failed check never erases the known published build')
  assert.equal(strata.status, 'error')
})

test('engineCatalog attaches a recommendation and a prompt to an actionable engine', async () => {
  const stored = {
    version: 1,
    generatedAt: '2026-11-08T02:00:00.000Z',
    engines: ENGINE_SOURCES.map((source) => ({
      id: source.id,
      displayName: source.displayName,
      latestRelease: source.id === 'ollama' ? 'v0.40.15' : 'v1.0.0',
      status: 'success',
      lastCheckAt: '2026-11-08T02:00:00.000Z',
      installedVersion: source.id === 'ollama' ? '0.22.1' : null,
    })),
    lastUpdate: {},
  }
  const service = createModelGuideService(baseState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
    readDriverVersion: async () => '580.178.04',
  }))
  const result = await service.engineCatalog()
  const ollama = result.engines.find((engine) => engine.id === 'ollama')
  assert.equal(ollama.advice.recommendation, 'REVIEW')
  assert.equal(ollama.advice.reason, 'newer-stable')
  assert.match(ollama.prompt, /^PLATFORM: DeepSeek Harness$/m)

  const vllm = result.engines.find((engine) => engine.id === 'vllm')
  assert.equal(vllm.advice.recommendation, 'NO_ACTION', 'an undetected engine is never advised to update')
  assert.equal(vllm.prompt, undefined, 'nothing to copy when there is nothing to review')
})

test('engineCatalog stays readable when the deployment cannot read a driver version', async () => {
  const stored = {
    version: 1,
    generatedAt: '2026-11-08T02:00:00.000Z',
    engines: [{ id: 'strata', displayName: 'Strata', latestRelease: 'v0.2.12', engineRelease: '0.1.58', versionSpace: 'control', installedVersion: '0.1.56', status: 'success', lastCheckAt: '2026-11-08T02:00:00.000Z' }],
    lastUpdate: {},
  }
  const service = createModelGuideService(baseState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
  }))
  const result = await service.engineCatalog()
  const strata = result.engines[0]
  assert.equal(strata.advice.recommendation, 'REVIEW')
  assert.equal(strata.advice.reason, 'newer-stable')
})

test('autoRefreshStatus reports the engine check as its own schedule', async () => {
  const service = createModelGuideService(baseState({
    autoRefresh: {
      status: () => ({ enabled: true, runOnStartup: true, started: true, stopped: false, running: false, intervalMs: 21_600_000, scheduled: true, skipped: 0, last: null }),
    },
    engineRefresh: {
      status: () => ({ enabled: true, runOnStartup: true, started: true, stopped: false, running: false, intervalMs: 86_400_000, scheduled: true, skipped: 0, last: null }),
    },
  }))
  const result = await service.autoRefreshStatus()
  assert.equal(result.intervalMs, 21_600_000, 'the model refresh keeps its six-hour interval')
  assert.equal(result.engineCheck.intervalMs, 86_400_000, 'the engine check keeps its own daily interval')
  assert.equal(result.engineCheck.intervalHours, 24)
  assert.equal(result.engineCheck.enabled, true)
})

test('autoRefreshStatus says plainly when the engine schedule was never created', async () => {
  const service = createModelGuideService(baseState({
    autoRefresh: {
      status: () => ({ enabled: true, runOnStartup: true, started: true, stopped: false, running: false, intervalMs: 21_600_000, scheduled: true, skipped: 0, last: null }),
    },
  }))
  const result = await service.autoRefreshStatus()
  assert.equal(result.engineCheck.scheduled, false)
  assert.equal(result.engineCheck.enabled, true)
  assert.equal(result.engineCheck.intervalHours, 24)
  assert.match(result.engineCheck.reason, /off for this deployment/)
})
