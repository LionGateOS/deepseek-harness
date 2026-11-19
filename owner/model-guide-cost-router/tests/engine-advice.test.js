/**
 * Engine update advice: REVIEW / DEFER / NO ACTION, and the prompt that makes a
 * recommendation actionable.
 *
 * The rule these tests defend is that advice is only issued when the evidence
 * supports it. A version the bundle cannot compare, a check that has gone
 * stale, a driver floor that cannot be verified, and a prerelease all resolve to
 * something other than "install this" — and unknown compatibility stays unknown
 * rather than being rendered as compatible.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ADVICE_DESTINATIONS,
  ADVICE_REASONS,
  DEFAULT_ADVICE_STALE_DAYS,
  ENGINE_RECOMMENDATIONS,
  engineAdvicePromptText,
  planEngineAdvice,
  withEngineAdvice,
} from '../core/engine-advice.js'
import { isPrereleaseTag, withReleaseComparison } from '../core/engine-version.js'

const NOW = '2026-11-08T03:00:00.000Z'

/** A record that is freshly checked and genuinely behind upstream. */
const newerStable = (overrides = {}) => ({
  id: 'ollama',
  displayName: 'Ollama',
  installedVersion: '0.22.1',
  latestRelease: 'v0.40.15',
  releaseUrl: 'https://github.com/ollama/ollama/releases/tag/v0.40.15',
  releasedAt: '2026-11-03T00:00:00.000Z',
  lastCheckAt: '2026-11-08T02:00:00.000Z',
  status: 'success',
  ...overrides,
})

/** Run the comparison and the advice together, the way the service does. */
const advised = (record, options = {}) => {
  const [compared] = withReleaseComparison([record])
  return planEngineAdvice(compared, { now: NOW, ...options })
}

// ---------------------------------------------------------------------------
// The three recommendations
// ---------------------------------------------------------------------------

test('a freshly checked newer stable release recommends REVIEW', () => {
  const advice = advised(newerStable())
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.REVIEW)
  assert.equal(advice.reason, ADVICE_REASONS.NEWER_STABLE)
  assert.equal(advice.destination, ADVICE_DESTINATIONS.DSH)
  assert.equal(advice.requiresOwnerApproval, true, 'looking is review; acting still needs approval')
})

test('an up-to-date engine recommends NO ACTION', () => {
  const advice = advised(newerStable({ installedVersion: '0.40.15' }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.UP_TO_DATE)
  assert.equal(advice.requiresOwnerApproval, false)
})

test('an engine with no detection recommends NO ACTION and says why', () => {
  const advice = advised(newerStable({ installedVersion: null }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.NOT_DETECTED)
})

test('an engine that was never checked recommends NO ACTION', () => {
  const advice = advised(newerStable({ latestRelease: null, status: 'not-checked' }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.NOT_CHECKED)
})

test('a failed check recommends NO ACTION rather than a stale recommendation', () => {
  const advice = advised(newerStable({ status: 'error', errorDetail: 'offline' }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.CHECK_FAILED)
})

test('a control-space record with no engine build recommends NO ACTION', () => {
  // The release tag belongs to the application, so there is nothing an owner
  // could act on: the panel must not present the tag as a pending engine update.
  const advice = advised({
    id: 'strata',
    installedVersion: '0.1.56',
    latestRelease: 'v0.2.12',
    versionSpace: 'control',
    status: 'success',
    lastCheckAt: '2026-11-08T02:00:00.000Z',
  })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.CONTROL_SPACE)
})

// ---------------------------------------------------------------------------
// DEFER: a newer release exists, but acting now is not advisable
// ---------------------------------------------------------------------------

test('a prerelease upstream recommends DEFER, not REVIEW', () => {
  const advice = advised(newerStable({ latestRelease: 'v0.33.0rc3' }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.DEFER)
  assert.equal(advice.reason, ADVICE_REASONS.NEWER_PRERELEASE)
  assert.equal(advice.prerelease, true)
})

test('a prerelease is recognised even when the release API says it is not one', () => {
  // vLLM publishes v0.33.0rc3 with prerelease: false and a release name of
  // v0.33.0. The tag is the evidence that survives.
  const advice = advised(newerStable({ latestRelease: 'v0.33.0rc3', prerelease: false }))
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.DEFER)
  assert.equal(advice.reason, ADVICE_REASONS.NEWER_PRERELEASE)
})

test('isPrereleaseTag accepts each prerelease form and rejects a plain release', () => {
  assert.equal(isPrereleaseTag('v0.33.0rc3'), true)
  assert.equal(isPrereleaseTag('5.0.0-rc.1'), true)
  assert.equal(isPrereleaseTag('v1.0.0-alpha'), true)
  assert.equal(isPrereleaseTag('v2.0.0beta2'), true)
  assert.equal(isPrereleaseTag('v3.0.0preview'), true)
  assert.equal(isPrereleaseTag('v0.40.15'), false)
  assert.equal(isPrereleaseTag('b5100'), false)
  assert.equal(isPrereleaseTag(null), false)
})

test('a check older than the freshness window recommends DEFER', () => {
  const advice = advised(newerStable({ lastCheckAt: '2026-10-01T00:00:00.000Z' }), { maxStaleDays: 7 })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.DEFER)
  assert.equal(advice.reason, ADVICE_REASONS.CHECK_STALE)
})

test('a check inside the freshness window is not stale', () => {
  const advice = advised(newerStable({ lastCheckAt: '2026-11-07T03:00:00.000Z' }), { maxStaleDays: 7 })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.REVIEW)
})

test('the default freshness window is a week', () => {
  assert.equal(DEFAULT_ADVICE_STALE_DAYS, 7)
})

// ---------------------------------------------------------------------------
// Compatibility: a driver floor this host can check, and unknown stays unknown
// ---------------------------------------------------------------------------

test('a satisfied driver floor still recommends REVIEW', () => {
  const advice = advised(newerStable({ minimumDriver: '580.65' }), { driverVersion: '580.178.04' })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.REVIEW)
})

test('a driver below the release floor recommends DEFER and says so', () => {
  const advice = advised(newerStable({ minimumDriver: '580.65' }), { driverVersion: '550.54' })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.DEFER)
  assert.equal(advice.reason, ADVICE_REASONS.DRIVER_BELOW_MINIMUM)
})

test('an unverifiable driver floor recommends DEFER rather than assuming it is satisfied', () => {
  // Unknown compatibility must remain unknown: a missing driver reading is not
  // evidence that the release will run.
  const advice = advised(newerStable({ minimumDriver: '580.65' }), { driverVersion: null })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.DEFER)
  assert.equal(advice.reason, ADVICE_REASONS.DRIVER_UNKNOWN)
})

test('a release that states no driver floor is not deferred for it', () => {
  const advice = advised(newerStable())
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.REVIEW)
})

// ---------------------------------------------------------------------------
// The Strata engine build gets advice from the engine verdict, not the tag
// ---------------------------------------------------------------------------

test('a published newer engine build recommends REVIEW while the control tag stays unjudged', () => {
  const advice = advised({
    id: 'strata',
    displayName: 'Strata',
    installedVersion: '0.1.56',
    latestRelease: 'v0.2.12',
    engineRelease: '0.1.58',
    versionSpace: 'control',
    status: 'success',
    lastCheckAt: '2026-11-08T02:00:00.000Z',
  }, { driverVersion: '580.178.04' })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.REVIEW)
  assert.equal(advice.reason, ADVICE_REASONS.NEWER_STABLE)
})

test('an installed engine build that matches the published one recommends NO ACTION', () => {
  const advice = advised({
    id: 'strata',
    installedVersion: '0.1.58',
    latestRelease: 'v0.2.12',
    engineRelease: '0.1.58',
    versionSpace: 'control',
    status: 'success',
    lastCheckAt: '2026-11-08T02:00:00.000Z',
  })
  assert.equal(advice.recommendation, ENGINE_RECOMMENDATIONS.NO_ACTION)
  assert.equal(advice.reason, ADVICE_REASONS.UP_TO_DATE)
})

// ---------------------------------------------------------------------------
// withEngineAdvice
// ---------------------------------------------------------------------------

test('withEngineAdvice attaches advice to every record without mutating the input', () => {
  const records = withReleaseComparison([newerStable(), newerStable({ id: 'vllm', installedVersion: '0.19.0', latestRelease: 'v0.33.0rc3' })])
  const result = withEngineAdvice(records, { now: NOW })
  assert.equal(result.length, 2)
  assert.ok(result.every((engine) => engine.advice !== undefined))
  assert.equal(result[0].installedVersion, '0.22.1', 'the input fields survive')
  assert.equal(records[0].advice, undefined, 'the input array is not mutated')
})

// ---------------------------------------------------------------------------
// The copy-ready prompt
// ---------------------------------------------------------------------------

test('the prompt states every field the owner needs to run it', () => {
  const [compared] = withReleaseComparison([newerStable()])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {
    workspace: '/home/liongateos/deepseek-harness-rc5-staging',
    model: 'ollama/deepseek-v4.1-flash',
    reasoning: 'high',
  })
  assert.match(prompt, /^PLATFORM: DeepSeek Harness$/m)
  assert.match(prompt, /^MODE: standard$/m)
  assert.match(prompt, /^MODEL: ollama\/deepseek-v4\.1-flash$/m)
  assert.match(prompt, /^REASONING: high$/m)
  assert.match(prompt, /^SESSION: NEW$/m)
  assert.match(prompt, /^WORKSPACE: \/home\/liongateos\/deepseek-harness-rc5-staging$/m)
  assert.match(prompt, /^ACCESS: READ$/m)
})

test('the prompt records the versions it is about', () => {
  const [compared] = withReleaseComparison([newerStable()])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {})
  assert.match(prompt, /Installed version: 0\.22\.1/)
  assert.match(prompt, /Latest upstream application release: v0\.40\.15/)
  assert.match(prompt, /Release page: https:\/\/github\.com\/ollama\/ollama/)
})

test('the prompt names WorkRunner for execution and Model Advisor for suitability', () => {
  const [compared] = withReleaseComparison([newerStable()])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {})
  // The read grant must not read as permission to install, and the two
  // destinations have to be named so the reader knows where each belongs.
  assert.match(prompt, /Read-only\./)
  assert.match(prompt, /Execution belongs to WorkRunner and requires separate owner approval/)
  assert.match(prompt, /Model or GPU suitability questions belong to Model Advisor/)
})

test('the prompt explains the Strata version boundary when it applies', () => {
  const [compared] = withReleaseComparison([{
    id: 'strata',
    displayName: 'Strata',
    installedVersion: '0.1.56',
    latestRelease: 'v0.2.12',
    engineRelease: '0.1.58',
    versionSpace: 'control',
    status: 'success',
    lastCheckAt: '2026-11-08T02:00:00.000Z',
  }])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {})
  assert.match(prompt, /different sequences and must not be compared/)
  assert.match(prompt, /Latest published engine build: 0\.1\.58/)
})

test('the prompt carries release-note evidence when the release published any', () => {
  const [compared] = withReleaseComparison([newerStable({ releaseNotes: 'Fixed a quantisation regression.' })])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {})
  assert.match(prompt, /Release notes \(excerpt supplied by the release API\)/)
  assert.match(prompt, /Fixed a quantisation regression\./)
})

test('the prompt carries owner-recorded verification evidence for the engine', () => {
  const [compared] = withReleaseComparison([newerStable()])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {
    verifications: [{ modelKey: 'ollama/glm-5.3', engineVersion: '0.22.1', result: 'passed', evidenceNote: 'served 40 requests' }],
  })
  assert.match(prompt, /Owner-recorded verification evidence/)
  assert.match(prompt, /ollama\/glm-5\.3 on 0\.22\.1: passed — served 40 requests/)
})

test('the prompt forbids installing and states the unknown rule', () => {
  const [compared] = withReleaseComparison([newerStable()])
  const engine = { ...compared, advice: planEngineAdvice(compared, { now: NOW }) }
  const prompt = engineAdvicePromptText(engine, {})
  assert.match(prompt, /Do not install, upgrade, download, restart, or reconfigure any engine, model server, or GPU\./)
  assert.match(prompt, /Do not interrupt running local model servers, active sessions, or the Strata instance\./)
  assert.match(prompt, /report it as unknown rather than inferring it/)
  assert.match(prompt, /Do not modify any file\./)
})
