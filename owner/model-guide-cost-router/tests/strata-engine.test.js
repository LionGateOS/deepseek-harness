/**
 * Strata engine registration and detection.
 *
 * Two version spaces: the GitHub release feed versions the control
 * application, while the installed component carries its own engine build.
 * These tests pin the separation and the read-only detection probe without
 * running Strata.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENGINE_SOURCES, applyEngineUpdate } from '../core/engine-update.js'
import { STRATA_ENGINE_ID, STRATA_ENGINE_PROBE, parseStrataEngineProbe } from '../core/strata-engine.js'

const LIVE_PROBE = JSON.stringify({
  ok: true,
  installed: [{
    id: 'strata-engine',
    version: '0.1.56',
    platform: 'linux-x86_64',
    backend: 'cuda',
    variant: 'cuda13',
    signed: true,
    usable: true,
  }],
  problems: [],
})

test('strata is a registered engine row pointing at its release feed', () => {
  const strata = ENGINE_SOURCES.find((source) => source.id === STRATA_ENGINE_ID)
  assert.ok(strata, 'strata must be registered so applyEngineUpdate does not drop it')
  assert.equal(strata.displayName, 'Strata')
  assert.match(strata.releaseApiUrl, /^https:\/\/api\.github\.com\/repos\/Niko1221\/Strata\/releases\/latest$/)
  assert.equal(strata.versionSpace, 'control', 'the feed versions the control app, not the engine build')
})

test('the detection probe is a read-only component listing', () => {
  assert.deepEqual([...STRATA_ENGINE_PROBE], ['components', 'engine', '--output', 'json'])
  // Nothing in the probe starts, stops, loads, or upgrades anything.
  for (const verb of ['start', 'stop', 'run', 'load', 'unload', 'update', 'upgrade', 'install']) {
    assert.ok(!STRATA_ENGINE_PROBE.includes(verb), `the probe must not include "${verb}"`)
  }
})

test('a live probe document yields the installed engine build', () => {
  const parsed = parseStrataEngineProbe(LIVE_PROBE)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.version, '0.1.56')
  assert.equal(parsed.backend, 'cuda')
  assert.equal(parsed.variant, 'cuda13')
  assert.equal(parsed.signed, true)
})

test('the first installed component carrying a version wins', () => {
  const parsed = parseStrataEngineProbe(JSON.stringify({
    ok: true,
    installed: [{ id: 'broken' }, { id: 'strata-engine', version: ' 0.1.58 ' }],
  }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.version, '0.1.58', 'a version is trimmed of surrounding whitespace')
})

test('every unusable probe answer is a named failure, never a version', () => {
  const cases = [
    ['', 'not JSON'],
    ['not json at all', 'not JSON'],
    ['null', 'not an object'],
    ['[]', 'not an object'],
    ['{"ok":false,"problems":[{"message":"engine component is corrupt"}]}', 'reports the provider problem'],
    ['{"ok":true,"installed":[]}', 'no component installed'],
    ['{"ok":true}', 'no component installed'],
    ['{"ok":true,"installed":[{"id":"x"}]}', 'no version'],
    ['{"ok":true,"installed":[{"id":"x","version":"   "}]}', 'no version'],
  ]
  for (const [text, why] of cases) {
    const parsed = parseStrataEngineProbe(text)
    assert.equal(parsed.ok, false, `expected a failure for: ${why}`)
    assert.equal(typeof parsed.reason, 'string')
    assert.ok(parsed.reason.length > 0)
  }
})

test('the probe problem message is surfaced when Strata reports one', () => {
  const parsed = parseStrataEngineProbe('{"ok":false,"problems":[{"message":"engine component is corrupt"}]}')
  assert.equal(parsed.reason, 'engine component is corrupt')
})

test('a control-version row carries its version space into the catalog', () => {
  const { engines } = applyEngineUpdate({ previousCatalog: undefined, fetchResults: [], now: '2026-11-07T00:00:00Z' })
  const strata = engines.find((engine) => engine.id === STRATA_ENGINE_ID)
  assert.ok(strata, 'strata survives a pass even when it was not checked')
  assert.equal(strata.versionSpace, 'control')
  assert.equal(strata.status, 'not-checked')
  assert.equal(strata.installedVersion, null)
})

test('rows whose feed versions the engine itself carry no version space', () => {
  const { engines } = applyEngineUpdate({ previousCatalog: undefined, fetchResults: [], now: '2026-11-07T00:00:00Z' })
  const ollama = engines.find((engine) => engine.id === 'ollama')
  assert.equal(ollama.versionSpace, undefined)
})

test('a detected engine build and a control release are recorded side by side', () => {
  const { engines } = applyEngineUpdate({
    previousCatalog: undefined,
    fetchResults: [{
      engineId: STRATA_ENGINE_ID,
      result: {
        status: 'fetched',
        fetchedAt: '2026-11-07T00:00:00Z',
        body: JSON.stringify({
          tag_name: 'v0.2.12',
          html_url: 'https://github.com/Niko1221/Strata/releases/tag/v0.2.12',
          published_at: '2026-11-07T08:54:40Z',
        }),
      },
      installedVersion: '0.1.56',
    }],
    now: '2026-11-07T00:00:00Z',
  })
  const strata = engines.find((engine) => engine.id === STRATA_ENGINE_ID)
  assert.equal(strata.latestRelease, 'v0.2.12', 'the control application release')
  assert.equal(strata.installedVersion, '0.1.56', 'the engine component build, never overwritten by the release tag')
  assert.equal(strata.versionSpace, 'control', 'the panel must not compare the two')
  assert.equal(strata.status, 'success')
})
