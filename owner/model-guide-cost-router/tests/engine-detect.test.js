/**
 * Engine detection and Strata's engine-build boundary.
 *
 * Two defects are locked against here:
 *
 * 1. The old detector answered null for every engine except Strata, so a
 *    perfectly ordinary install reported "Not detected" forever.
 * 2. Strata publishes its application release (`v0.2.12`) and its engine build
 *    (`0.1.58`) as different sequences. Comparing them, or reporting only the
 *    application tag, hides a real engine update.
 *
 * Every probe asserted below is read-only. The detection tests run against a
 * recorded document, never against the host's real binaries.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectEngineVersion,
  detectStrataEngineIdentity,
  parseLlamaCppVersion,
  parseOllamaVersion,
} from '../core/engine-detect.js'
import {
  parseStrataFeed,
  selectStrataPackage,
  meetsMinimumDriver,
  parseDriverVersion,
  STRATA_UPDATE_FEED_URL,
} from '../core/strata-feed.js'
import { planEngineBuildComparison, withReleaseComparison } from '../core/engine-version.js'

/** One execFile stand-in that records its call and answers with a fixed document. */
const execAnswering = (payload, calls = []) => (file, args, options, callback) => {
  calls.push({ file, args: [...args], options })
  callback(null, payload)
}

/** One execFile stand-in that fails with a fixed code. */
const execFailing = (code, calls = []) => (file, args, options, callback) => {
  calls.push({ file, args: [...args], options })
  callback(Object.assign(new Error(`spawn ${file} ${code}`), { code }), '')
}

// ---------------------------------------------------------------------------
// Parsing the human-facing version lines
// ---------------------------------------------------------------------------

test('parseOllamaVersion reads the number out of the ollama banner', () => {
  assert.equal(parseOllamaVersion('ollama version is 0.22.1'), '0.22.1')
  assert.equal(parseOllamaVersion('ollama version 0.6.9\n'), '0.6.9')
  assert.equal(parseOllamaVersion('0.40.15'), '0.40.15')
})

test('parseOllamaVersion refuses output that carries no version', () => {
  assert.equal(parseOllamaVersion('ollama: command not found'), null)
  assert.equal(parseOllamaVersion(''), null)
  assert.equal(parseOllamaVersion(undefined), null)
})

test('parseLlamaCppVersion keeps a build number in its own series', () => {
  // llama.cpp versions builds, not releases: `b5100` must not be reported as a
  // dotted version, or it would be compared against a release tag.
  assert.equal(parseLlamaCppVersion('version: 5100 (b5100)'), 'b5100')
  assert.equal(parseLlamaCppVersion('llama-cli build b6123'), 'b6123')
})

test('parseLlamaCppVersion falls back to a dotted version when there is no build number', () => {
  assert.equal(parseLlamaCppVersion('llama.cpp 0.9.0'), '0.9.0')
  assert.equal(parseLlamaCppVersion('no version here'), null)
})

// ---------------------------------------------------------------------------
// Detecting each engine, and answering null rather than guessing
// ---------------------------------------------------------------------------

test('detectEngineVersion reads ollama through its own banner', async () => {
  const calls = []
  const version = await detectEngineVersion('ollama', execAnswering('ollama version is 0.22.1', calls), 1000)
  assert.equal(version, '0.22.1')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['--version'])
  assert.equal(calls[0].file, 'ollama')
})

test('detectEngineVersion reads vLLM from package metadata, not its torch-importing banner', async () => {
  // `vllm --version` imports torch and takes seconds; the probe must ask Python
  // metadata instead, so the recorded call is an interpreter, not the binary.
  const calls = []
  const version = await detectEngineVersion('vllm', execAnswering('0.19.0\n', calls), 1000)
  assert.equal(version, '0.19.0')
  assert.equal(calls.length, 1)
  assert.match(calls[0].file, /^python3?$/)
  assert.equal(calls[0].args[0], '-c')
  assert.equal(calls[0].args[2], 'vllm')
  assert.doesNotMatch(calls[0].args[0], /--version/)
})

test('detectEngineVersion tries each llama.cpp binary and answers null when none exists', async () => {
  const calls = []
  const version = await detectEngineVersion('llama.cpp', execFailing('ENOENT', calls), 1000)
  assert.equal(version, null, 'a missing binary is unknown, never a guessed version')
  assert.deepEqual(calls.map((call) => call.file), ['llama-cli', 'llama-server'])
})

test('detectEngineVersion stops at the first llama.cpp binary that answers', async () => {
  const calls = []
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args: [...args] })
    if (file === 'llama-cli') callback(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '')
    else callback(null, 'version: 5100 (b5100)')
  }
  const version = await detectEngineVersion('llama.cpp', execFile, 1000)
  assert.equal(version, 'b5100')
  assert.deepEqual(calls.map((call) => call.file), ['llama-cli', 'llama-server'])
})

test('detectEngineVersion answers null for an engine it has no probe for', async () => {
  const version = await detectEngineVersion('something-else', execAnswering('1.0.0'), 1000)
  assert.equal(version, null)
})

// ---------------------------------------------------------------------------
// Strata: identity from its own inventory, build from its own feed
// ---------------------------------------------------------------------------

const STRATA_PROBE_DOCUMENT = JSON.stringify({
  schema_version: 1,
  ok: true,
  installed: [{
    id: 'strata-engine',
    version: '0.1.56',
    platform: 'linux-x86_64',
    backend: 'cuda',
    variant: 'cuda13',
    signed: true,
  }],
  problems: [],
})

test('detectStrataEngineIdentity reports the build and the variant that selects its package', async () => {
  const identity = await detectStrataEngineIdentity(execAnswering(STRATA_PROBE_DOCUMENT), 1000)
  assert.equal(identity.ok, true)
  assert.equal(identity.version, '0.1.56')
  assert.equal(identity.platform, 'linux-x86_64')
  assert.equal(identity.variant, 'cuda13')
  assert.equal(identity.signed, true)
})

test('detectStrataEngineIdentity isolates a missing binary from the engine check', async () => {
  const identity = await detectStrataEngineIdentity(execFailing('ENOENT'), 1000)
  assert.equal(identity.ok, false)
})

const FEED = JSON.stringify({
  schema_version: 1,
  sequence: 122,
  channel: 'stable',
  generated_at: '2026-11-07T12:00:00Z',
  app: { version: '0.2.12' },
  control: { version: '0.1.58' },
  engine: {
    packages: [
      { version: '0.1.58', platform: 'linux-x86_64', variant: '', backend: 'cuda', min_driver: { nvidia: '580.65' } },
      { version: '0.1.58', platform: 'linux-x86_64', variant: 'cuda13', backend: 'cuda', min_driver: { nvidia: '580.65' } },
      { version: '0.1.58', platform: 'linux-x86_64', variant: 'cuda12', backend: 'cuda', min_driver: { nvidia: '550.54' } },
    ],
  },
})

test('parseStrataFeed separates the three version spaces it publishes', () => {
  const feed = parseStrataFeed(FEED)
  assert.equal(feed.ok, true)
  // The application, the control component, and the engine build are three
  // sequences. Reporting one as another is the defect this asserts against.
  assert.equal(feed.appVersion, '0.2.12')
  assert.equal(feed.controlVersion, '0.1.58')
  assert.deepEqual(feed.engineVersions, ['0.1.58'])
  assert.equal(feed.sequence, 122)
  assert.equal(feed.channel, 'stable')
})

test('parseStrataFeed refuses a document without an engine package', () => {
  const noEngine = JSON.stringify({ app: { version: '0.2.12' }, control: { version: '0.1.58' } })
  const feed = parseStrataFeed(noEngine)
  assert.equal(feed.ok, false)
  assert.match(feed.reason, /no engine package/)
})

test('parseStrataFeed refuses malformed input without throwing', () => {
  assert.equal(parseStrataFeed('').ok, false)
  assert.equal(parseStrataFeed('<html>').ok, false)
  assert.equal(parseStrataFeed('[]').ok, false)
})

test('selectStrataPackage prefers the installed variant over the generic build', () => {
  const feed = parseStrataFeed(FEED)
  assert.equal(feed.ok, true)
  const chosen = selectStrataPackage(feed.packages, { platform: 'linux-x86_64', variant: 'cuda13' })
  assert.equal(chosen.variant, 'cuda13', 'a cuda13 host is shown the cuda13 package and its driver floor')
  assert.equal(chosen.minDriver, '580.65')
})

test('selectStrataPackage falls back to the generic package when the variant is unknown', () => {
  const feed = parseStrataFeed(FEED)
  assert.equal(feed.ok, true)
  const chosen = selectStrataPackage(feed.packages, { platform: 'linux-x86_64', variant: null })
  assert.equal(chosen.variant, null)
})

test('selectStrataPackage answers nothing when the feed has no package for this platform', () => {
  const feed = parseStrataFeed(FEED)
  assert.equal(feed.ok, true)
  assert.equal(selectStrataPackage(feed.packages, { platform: 'darwin-arm64', variant: null }), null)
})

test('meetsMinimumDriver compares dotted driver versions numerically', () => {
  assert.equal(meetsMinimumDriver('580.178.04', '580.65'), true)
  assert.equal(meetsMinimumDriver('580.65', '580.65'), true)
  assert.equal(meetsMinimumDriver('550.54', '580.65'), false)
  assert.equal(meetsMinimumDriver('580.64', '580.65'), false)
})

test('meetsMinimumDriver stays unknown when either side is missing', () => {
  assert.equal(meetsMinimumDriver(null, '580.65'), null)
  assert.equal(meetsMinimumDriver('580.178.04', null), null)
  assert.equal(meetsMinimumDriver('not-a-version', '580.65'), null)
})

test('parseDriverVersion reads the sysfs text', () => {
  assert.equal(parseDriverVersion('580.178.04\n'), '580.178.04')
  assert.equal(parseDriverVersion('   '), null)
  assert.equal(parseDriverVersion(undefined), null)
})

test('the Strata feed URL is the signed release asset', () => {
  assert.equal(STRATA_UPDATE_FEED_URL, 'https://github.com/Niko1221/Strata/releases/latest/download/strata-feed.json')
})

// ---------------------------------------------------------------------------
// The boundary itself: an engine build comparison that the control tag cannot fake
// ---------------------------------------------------------------------------

test('planEngineBuildComparison reports the real Strata engine update', () => {
  const verdict = planEngineBuildComparison({ installedVersion: '0.1.56', engineRelease: '0.1.58' })
  assert.equal(verdict.updateAvailable, true, '0.1.58 is a genuine engine update over 0.1.56')
})

test('planEngineBuildComparison reports current when the installed build is the published one', () => {
  const verdict = planEngineBuildComparison({ installedVersion: '0.1.58', engineRelease: '0.1.58' })
  assert.equal(verdict.updateAvailable, false)
})

test('planEngineBuildComparison stays unknown without both values', () => {
  assert.equal(planEngineBuildComparison({ installedVersion: '0.1.56' }).updateAvailable, null)
  assert.equal(planEngineBuildComparison({ engineRelease: '0.1.58' }).updateAvailable, null)
})

test('withReleaseComparison keeps the control tag out of the verdict and adds the engine verdict', () => {
  const [record] = withReleaseComparison([{
    id: 'strata',
    installedVersion: '0.1.56',
    latestRelease: 'v0.2.12',
    engineRelease: '0.1.58',
    versionSpace: 'control',
  }])
  assert.equal(record.updateAvailable, null, 'the application tag is never compared with an engine build')
  assert.equal(record.engineUpdateAvailable, true, 'the published engine build is compared, and is newer')
})

test('withReleaseComparison adds no engine verdict to an engine that publishes only a release tag', () => {
  const [record] = withReleaseComparison([{
    id: 'ollama',
    installedVersion: '0.22.1',
    latestRelease: 'v0.40.15',
  }])
  assert.equal(record.updateAvailable, true)
  assert.equal(Object.hasOwn(record, 'engineUpdateAvailable'), false)
})
