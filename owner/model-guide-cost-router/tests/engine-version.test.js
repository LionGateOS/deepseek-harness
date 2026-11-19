/**
 * Engine version comparison: the module must decide whether an upstream
 * release is newer than the installed build, and it must refuse to decide when
 * the inputs do not support a verdict.
 *
 * The regression these tests lock in: the panel once compared raw strings, so
 * `0.40.15` and `v0.40.15` — the same version written by two different
 * producers — reported a pending update that never went away. Every test that
 * mentions a `v` prefix exists to keep that from returning.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RELEASE_COMPARISON_REASONS,
  compareVersions,
  parseVersion,
  planReleaseComparison,
  withReleaseComparison,
} from '../core/engine-version.js'
import { createModelGuideService } from '../index.js'
import { ENGINE_SOURCES } from '../core/engine-update.js'

// ---------------------------------------------------------------------------
// parseVersion — one normalization both producers agree on
// ---------------------------------------------------------------------------

test('parseVersion strips a single leading v and keeps the numeric core', () => {
  const prefixed = parseVersion('v0.40.15')
  const plain = parseVersion('0.40.15')
  assert.equal(prefixed.ok, true)
  assert.equal(plain.ok, true)
  if (!prefixed.ok || !plain.ok) return
  assert.deepEqual(prefixed.core, [0, 40, 15])
  assert.deepEqual(prefixed.prerelease, [])
  assert.equal(prefixed.normalized, '0.40.15')
  assert.equal(prefixed.normalized, plain.normalized, 'the tag prefix must not survive normalization')
})

test('parseVersion reads llama.cpp build numbers as their own series', () => {
  const result = parseVersion('b5100')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.series, 'build')
  assert.deepEqual(result.core, [5100])
  assert.equal(result.normalized, 'b5100')
})

test('parseVersion reads an unseparated prerelease suffix', () => {
  const result = parseVersion('v0.33.0rc3')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.series, 'semver')
  assert.deepEqual(result.core, [0, 33, 0])
  assert.deepEqual(result.prerelease, ['rc', '3'], 'the trailing number is split so it orders numerically')
})

test('parseVersion reads hyphen and dot separated prerelease suffixes', () => {
  const hyphen = parseVersion('0.33.0-rc.3')
  assert.equal(hyphen.ok, true)
  if (!hyphen.ok) return
  assert.deepEqual(hyphen.prerelease, ['rc', '3'])
  // Both spellings of the same prerelease must normalize identically.
  const unseparated = parseVersion('v0.33.0rc3')
  assert.equal(unseparated.ok, true)
  if (!unseparated.ok) return
  assert.equal(unseparated.normalized, hyphen.normalized)
})

test('parseVersion rejects values that are not versions', () => {
  for (const input of ['', '   ', 'v', 'latest', 'release-notes', 'x.y.z', undefined, null, 42, {}]) {
    const result = parseVersion(input)
    assert.equal(result.ok, false, `expected ${JSON.stringify(input)} to be rejected`)
  }
})

test('parseVersion rejects a suffix that is not a prerelease identifier', () => {
  const result = parseVersion('1.2.3 (build abc)')
  assert.equal(result.ok, false)
})

// ---------------------------------------------------------------------------
// compareVersions — the ordering itself
// ---------------------------------------------------------------------------

test('compareVersions treats a v-prefixed version as equal to the same bare version', () => {
  assert.equal(compareVersions('v0.40.15', '0.40.15'), 0)
  assert.equal(compareVersions('0.40.15', 'v0.40.15'), 0)
  assert.equal(compareVersions('V1.2.3', 'v1.2.3'), 0)
})

test('compareVersions orders by number, not by text', () => {
  // Textual ordering would put "0.9.0" above "0.40.15"; numeric ordering does not.
  assert.equal(compareVersions('0.9.0', '0.40.15'), -1)
  assert.equal(compareVersions('0.40.15', '0.9.0'), 1)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
})

test('compareVersions treats missing numeric segments as zero', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  assert.equal(compareVersions('1.2.0.0', '1.2'), 0)
  assert.equal(compareVersions('1.2.1', '1.2'), 1)
})

test('compareVersions orders a prerelease below its release', () => {
  assert.equal(compareVersions('0.33.0rc3', '0.33.0'), -1)
  assert.equal(compareVersions('0.33.0', '0.33.0rc3'), 1)
  assert.equal(compareVersions('0.33.0rc3', '0.33.0rc4'), -1)
  assert.equal(compareVersions('0.33.0rc10', '0.33.0rc9'), 1, 'numeric prerelease identifiers compare numerically')
})

test('compareVersions returns null for different version spaces', () => {
  assert.equal(compareVersions('b5100', '0.9.0'), null)
  assert.equal(compareVersions('0.9.0', 'b5100'), null)
})

test('compareVersions returns null when either side is unparseable', () => {
  assert.equal(compareVersions('latest', '0.9.0'), null)
  assert.equal(compareVersions('0.9.0', ''), null)
  assert.equal(compareVersions(null, '0.9.0'), null)
})

// ---------------------------------------------------------------------------
// planReleaseComparison — the verdict the panel renders
// ---------------------------------------------------------------------------

test('planReleaseComparison reports no update when the same version is spelled two ways', () => {
  const verdict = planReleaseComparison({ installedVersion: '0.40.15', latestRelease: 'v0.40.15' })
  assert.equal(verdict.updateAvailable, false, 'a v prefix alone must never mean "newer"')
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.CURRENT)
})

test('planReleaseComparison reports an update only when the release is strictly newer', () => {
  const verdict = planReleaseComparison({ installedVersion: '0.22.1', latestRelease: 'v0.40.15' })
  assert.equal(verdict.updateAvailable, true)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.NEWER)
})

test('planReleaseComparison reports no update when the installed build is newer than the feed', () => {
  const verdict = planReleaseComparison({ installedVersion: '0.41.0', latestRelease: 'v0.40.15' })
  assert.equal(verdict.updateAvailable, false)
})

test('planReleaseComparison refuses to judge an undetected build', () => {
  const verdict = planReleaseComparison({ installedVersion: null, latestRelease: 'v0.40.15' })
  assert.equal(verdict.updateAvailable, null)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.NOT_DETECTED)
})

test('planReleaseComparison refuses to judge a release that was never checked', () => {
  const verdict = planReleaseComparison({ installedVersion: '0.40.15', latestRelease: null })
  assert.equal(verdict.updateAvailable, null)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.NOT_CHECKED)
})

test('planReleaseComparison refuses to judge a control-space record', () => {
  // Strata: installed is an engine build, latestRelease is an application tag.
  const verdict = planReleaseComparison({
    versionSpace: 'control',
    installedVersion: '0.1.56',
    latestRelease: 'v0.2.12',
  })
  assert.equal(verdict.updateAvailable, null)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.CONTROL_SPACE)
})

test('planReleaseComparison refuses to judge versions that do not share a format', () => {
  const verdict = planReleaseComparison({ installedVersion: 'b5100', latestRelease: 'v0.9.0' })
  assert.equal(verdict.updateAvailable, null)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.INCOMPARABLE)
})

test('planReleaseComparison refuses to judge a malformed version string', () => {
  const verdict = planReleaseComparison({ installedVersion: 'built-from-source', latestRelease: 'v0.9.0' })
  assert.equal(verdict.updateAvailable, null)
  assert.equal(verdict.reason, RELEASE_COMPARISON_REASONS.INCOMPARABLE)
})

test('planReleaseComparison never reports an update for a record with neither value', () => {
  const verdict = planReleaseComparison({})
  assert.equal(verdict.updateAvailable, null)
})

// ---------------------------------------------------------------------------
// withReleaseComparison — attaching verdicts without disturbing records
// ---------------------------------------------------------------------------

test('withReleaseComparison attaches a verdict and preserves every other field', () => {
  const input = [{
    id: 'ollama',
    displayName: 'Ollama',
    installedVersion: '0.22.1',
    latestRelease: 'v0.40.15',
    releaseUrl: 'https://example.com',
    releasedAt: '2026-11-03T00:00:00Z',
    lastCheckAt: '2026-11-07T00:00:00Z',
    status: 'success',
    verifications: [{ engineVersion: '0.22.1' }],
  }]
  const [result] = withReleaseComparison(input)
  assert.equal(result.updateAvailable, true)
  assert.equal(result.updateReason, RELEASE_COMPARISON_REASONS.NEWER)
  assert.equal(result.id, 'ollama')
  assert.equal(result.installedVersion, '0.22.1')
  assert.equal(result.latestRelease, 'v0.40.15')
  assert.equal(result.releaseUrl, 'https://example.com')
  assert.equal(result.releasedAt, '2026-11-03T00:00:00Z')
  assert.deepEqual(result.verifications, [{ engineVersion: '0.22.1' }])
})

test('withReleaseComparison does not mutate its input', () => {
  const input = [{ id: 'ollama', installedVersion: '0.22.1', latestRelease: 'v0.40.15' }]
  const [result] = withReleaseComparison(input)
  assert.notEqual(result, input[0])
  assert.equal('updateAvailable' in input[0], false)
})

// ---------------------------------------------------------------------------
// Service integration — engineCatalog() is what the panel actually receives
// ---------------------------------------------------------------------------

const stubEngineState = (overrides = {}) => ({
  config: { engineCatalogPath: '/x/engine-catalog.json' },
  readJsonFile: async () => ({ status: 'missing' }),
  readOwnerMetadata: async () => ({ status: 'missing', data: null }),
  fetchEngineRelease: async () => ({ status: 'failed', fetchedAt: '2026-11-07T00:00:00Z', error: 'not used' }),
  detectInstalledVersion: async () => null,
  writeTextFile: async () => 'ok',
  discover: async () => ({ providers: [] }),
  ...overrides,
})

test('engineCatalog adds a verdict to every engine it returns', async () => {
  const service = createModelGuideService(stubEngineState())
  const result = await service.engineCatalog()
  assert.equal(result.engines.length, ENGINE_SOURCES.length)
  for (const engine of result.engines) {
    assert.ok('updateAvailable' in engine, `${engine.id} must carry a verdict`)
    assert.equal(engine.updateAvailable, null, 'a not-checked engine never claims an update')
  }
})

test('engineCatalog reports no update when the stored version matches the tag', async () => {
  const stored = {
    version: 1,
    engines: [{ id: 'ollama', displayName: 'Ollama', installedVersion: '0.40.15', latestRelease: 'v0.40.15', status: 'success', lastCheckAt: '2026-11-07T00:00:00Z' }],
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
  }))
  const result = await service.engineCatalog()
  const ollama = result.engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.updateAvailable, false)
})

test('engineCatalog reports an update for a genuinely older installed build', async () => {
  const stored = {
    version: 1,
    engines: [{ id: 'ollama', displayName: 'Ollama', installedVersion: '0.22.1', latestRelease: 'v0.40.15', status: 'success', lastCheckAt: '2026-11-07T00:00:00Z' }],
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
  }))
  const result = await service.engineCatalog()
  const ollama = result.engines.find((e) => e.id === 'ollama')
  assert.equal(ollama.updateAvailable, true)
})

test('engineCatalog keeps a control-space engine out of the update judgement', async () => {
  const stored = {
    version: 1,
    engines: [{ id: 'strata', displayName: 'Strata', installedVersion: '0.1.56', latestRelease: 'v0.2.12', versionSpace: 'control', status: 'success', lastCheckAt: '2026-11-07T00:00:00Z' }],
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
  }))
  const result = await service.engineCatalog()
  const strata = result.engines.find((e) => e.id === 'strata')
  assert.equal(strata.updateAvailable, null, 'the control tag is not an engine upgrade')
  assert.equal(strata.updateReason, RELEASE_COMPARISON_REASONS.CONTROL_SPACE)
  assert.equal(strata.installedVersion, '0.1.56', 'the engine build is still reported')
  assert.equal(strata.latestRelease, 'v0.2.12', 'the application tag is still reported')
})

test('engineCatalog preserves owner verifications alongside the verdict', async () => {
  const stored = {
    version: 1,
    engines: [{ id: 'vllm', displayName: 'vLLM', installedVersion: '0.19.0', latestRelease: 'v0.33.0rc3', status: 'success', lastCheckAt: '2026-11-07T00:00:00Z' }],
  }
  const service = createModelGuideService(stubEngineState({
    readJsonFile: async () => ({ status: 'ok', value: stored }),
    readOwnerMetadata: async () => ({
      status: 'ok',
      data: {
        models: {},
        engineVerifications: [{ engineId: 'vllm', engineVersion: '0.19.0', modelKey: 'ollama/x', verifiedAt: '2026-11-01T00:00:00Z', result: 'passed' }],
      },
    }),
  }))
  const result = await service.engineCatalog()
  const vllm = result.engines.find((e) => e.id === 'vllm')
  assert.equal(vllm.updateAvailable, true, 'an RC is still a newer release than 0.19.0')
  assert.equal(vllm.verifications.length, 1)
  assert.equal(vllm.verifications[0].engineVersion, '0.19.0')
})
