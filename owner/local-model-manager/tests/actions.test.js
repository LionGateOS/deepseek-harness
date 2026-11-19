/**
 * Operational action coverage: the allowlist, the two-step plan/confirm gate,
 * fail-closed busy detection, missing-permission refusal, failed action
 * reporting with plain-language explanations, and the spawn guard that pins
 * every launch to the preferred launch GPU (RTX 3090 Ti by default).
 * Tests also cover the generic manual launch reservation flow.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createActions, launcherArgv, runLauncher, checkLauncher } from '../core/actions.js'
import { validateConfig } from '../core/config.js'

const CONFIG = validateConfig({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/home/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090',
  protectedGpuUuid: 'GPU-PROTECTED', protectedGpuName: 'RTX 3090 Ti',
  probeTimeoutMs: 100, actionTimeoutMs: 100, confirmTtlMs: 1000,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'b', name: 'Model B', ggufPath: '/m/b.gguf', switchName: 'b', engineBinary: 'stable' },
  ],
})

const server = (state, overrides = {}) => {
  if (state === 'stopped') return { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
  return { state: 'running', modelPath: '/m/a.gguf', liveContext: 32768, slots: [{ id: 0, n_ctx: 32768, isProcessing: false }], busy: false, busyUnknown: false, ...overrides }
}

/** Build the state machine with injectable probe, launcher access, and spawn. */
const make = ({ probe = () => Promise.resolve(server('running')), launcherOk = true, spawn: spawnImpl, access: accessImpl, now, contextArgs } = {}) => createActions({
  config: CONFIG,
  probe,
  modelByKey: (key) => CONFIG.models.find((m) => m.key === key),
  access: accessImpl ?? (async () => launcherOk ? undefined : Object.assign(new Error('x'), { code: 'ENOENT' })),
  spawn: spawnImpl,
  ...(contextArgs === undefined ? {} : { contextArgs }),
  ...(now === undefined ? {} : { now }),
})

test('the allowlist maps actions to fixed launcher argv and nothing else', () => {
  assert.deepEqual(launcherArgv('stop'), ['stop'])
  assert.deepEqual(launcherArgv('start', { switchName: 'qwen35' }), ['start-qwen35'])
  assert.deepEqual(launcherArgv('switch', { switchName: 'flash' }), ['switch', 'flash'])
  assert.equal(launcherArgv('restart'), null)
  assert.equal(launcherArgv('status'), null)
  assert.equal(launcherArgv('start', { switchName: '../../etc/passwd' }), null)
  assert.equal(launcherArgv('start', undefined), null)
})

test('start actions append the selected-context pin; stop and switch never do', () => {
  // The launcher's switch command drops trailing args (it execs start-<target>
  // without forwarding), so a pin there would be silently lost.
  assert.deepEqual(launcherArgv('start', { switchName: 'qwen35' }, ['-c', '32768']), ['start-qwen35', '-c', '32768'])
  assert.deepEqual(launcherArgv('switch', { switchName: 'qwen35' }, ['-c', '32768']), ['switch', 'qwen35'])
  assert.deepEqual(launcherArgv('stop', undefined, ['-c', '32768']), ['stop'])
})

test('runLauncher forwards the context pin deps to start argv', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  await runLauncher(CONFIG, 'start', CONFIG.models[0], { spawn, contextArgs: ['-c', '49152'] })
  assert.deepEqual(spawned[0].argv, ['start-a', '-c', '49152'])
})

test('a confirmed start carries the selected-context pin from the contextArgs dep', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const actions = make({
    probe: () => Promise.resolve(server('stopped')),
    spawn,
    contextArgs: async (modelKey) => modelKey === 'a' ? ['-c', '49152'] : [],
  })
  const plan = await actions.plan('start', { modelKey: 'a' })
  assert.equal(plan.status, 'planned')
  const outcome = await actions.confirm(plan.confirmToken)
  assert.equal(outcome.status, 'ok')
  assert.deepEqual(spawned[0].argv, ['start-a', '-c', '49152'])
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-PROTECTED')
})

test('runLauncher refuses anything not produced by the allowlist map and pins the preferred GPU', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const bad = await runLauncher(CONFIG, 'restart', CONFIG.models[0], { spawn })
  assert.equal(bad.status, 'failed')
  assert.match(bad.output, /allowlist/)
  const good = await runLauncher(CONFIG, 'stop', undefined, { spawn })
  assert.equal(good.status, 'ok')
  assert.equal(spawned.length, 1) // the refused action never spawned
  assert.equal(spawned[0].argv[0], 'stop')
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-PROTECTED')
})

test('runLauncher refuses to launch at all when no preferred launch GPU is configured', async () => {
  const result = await runLauncher({ ...CONFIG, preferredLaunchGpuUuid: '' }, 'stop', undefined, {})
  assert.equal(result.status, 'failed')
  assert.match(result.output, /no preferred launch GPU is configured/)
})

test('checkLauncher refuses with a plain reason when the launcher is missing or not executable', async () => {
  const denied = await checkLauncher('/x/launcher', { access: async () => Object.assign(new Error('x'), { code: 'EACCES' }) })
  assert.equal(denied.ok, false)
  assert.match(denied.problem, /permission denied/)
  const missing = await checkLauncher('/x/launcher', { access: async () => Object.assign(new Error('x'), { code: 'ENOENT' }) })
  assert.match(missing.problem, /not found/)
})

test('unknown actions and unknown models are refused with readable reasons', async () => {
  const actions = make()
  assert.match((await actions.plan('reboot')).reason, /not one this panel can perform/)
  assert.match((await actions.plan('start', { modelKey: 'nope' })).reason, /not in the managed inventory/)
  assert.match((await actions.plan('switch', {})).reason, /not in the managed inventory/)
})

test('a missing launcher blocks the plan for every action', async () => {
  const actions = make({ launcherOk: false })
  assert.match((await actions.plan('stop')).reason, /cannot operate/)
  assert.match((await actions.plan('start', { modelKey: 'a' })).reason, /cannot operate/)
})

test('stop and switch are refused when the server is already stopped', async () => {
  const actions = make({ probe: () => Promise.resolve(server('stopped')) })
  assert.match((await actions.plan('stop')).reason, /already stopped/)
  assert.match((await actions.plan('switch', { modelKey: 'b' })).reason, /already stopped/)
})

test('starting a model is refused while another one runs (one endpoint, one model)', async () => {
  const actions = make()
  assert.match((await actions.plan('start', { modelKey: 'b' })).reason, /Use Switch/)
  assert.match((await actions.plan('start', { modelKey: 'a' })).reason, /already the model that is running/)
  const planned = await make({ probe: () => Promise.resolve(server('stopped')) }).plan('start', { modelKey: 'a' })
  assert.equal(planned.status, 'planned')
})

test('unreadable slot state fails closed: stop and switch stay refused', async () => {
  const actions = make({ probe: () => Promise.resolve({ ...server('running'), busyUnknown: true }) })
  const refused = await actions.plan('stop')
  assert.equal(refused.status, 'refused')
  assert.match(refused.reason, /cannot safely verify whether work is running/)
  const refusedSwitch = await actions.plan('switch', { modelKey: 'b' })
  assert.match(refusedSwitch.reason, /cannot safely verify whether work is running/)
})

test('an active job is detected, listed, and requires explicit interruption acknowledgment', async () => {
  const actions = make({ probe: () => Promise.resolve({ ...server('running'), busy: true, slots: [{ id: 0, n_ctx: 32768, isProcessing: true, task: 42 }] }) })
  const plan = await actions.plan('stop')
  assert.equal(plan.status, 'planned')
  assert.equal(plan.requiresAcknowledge, true)
  assert.deepEqual(plan.activeJobs, [{ slot: 0, task: 42 }])
  // Confirm without acknowledgment is refused.
  const refused = await actions.confirm(plan.confirmToken, {})
  assert.equal(refused.status, 'refused')
  assert.match(refused.reason, /acknowledge/)
})

test('a new job appearing between plan and confirm refuses without acknowledgment', async () => {
  const actions = make({
    probe: () => Promise.resolve(server('running'))
      .then(() => ({ ...server('running'), busy: true, slots: [{ id: 0, n_ctx: 32768, isProcessing: true, task: 7 }] })),
  })
  // First probe (plan sees idle) resolves, second probe (confirm) sees busy.
  let calls = 0
  const actions2 = createActions({
    config: CONFIG,
    probe: () => Promise.resolve(calls++ === 0 ? server('running') : { ...server('running'), busy: true, slots: [{ id: 0, n_ctx: 32768, isProcessing: true, task: 7 }] }),
    modelByKey: (key) => CONFIG.models.find((m) => m.key === key),
    access: async () => undefined,
  })
  const plan = await actions2.plan('stop')
  assert.equal(plan.requiresAcknowledge, false)
  const outcome = await actions2.confirm(plan.confirmToken, {})
  assert.equal(outcome.status, 'refused')
  assert.match(outcome.reason, /appeared after you reviewed/)
})

test('confirmation executes the launcher exactly once and reports the real outcome', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env.CUDA_VISIBLE_DEVICES })
    return { stdout: { on: (_e, cb) => cb(Buffer.from('Port 8001 is clear.')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const actions = make({ spawn })
  const plan = await actions.plan('stop')
  const outcome = await actions.confirm(plan.confirmToken, {})
  assert.equal(outcome.status, 'ok')
  assert.deepEqual(spawned, [{ file: CONFIG.launcherPath, argv: ['stop'], env: 'GPU-PROTECTED' }])
})

test('confirm tokens are single-use and expire', async () => {
  const spawn = () => ({
    stdout: { on: () => {} }, stderr: { on: () => {} },
    on: (evt, cb) => { if (evt === 'close') cb(0) },
  })
  const actions = make({ spawn })
  const plan = await actions.plan('stop')
  const first = await actions.confirm(plan.confirmToken, {})
  assert.equal(first.status, 'ok')
  const second = await actions.confirm(plan.confirmToken, {})
  assert.equal(second.status, 'refused')
  assert.match(second.reason, /no longer valid/)
  // Expiry: advance the clock past the TTL.
  let tick = 0
  const lateNow = () => (tick++ < 1 ? 0 : CONFIG.confirmTtlMs + 1000)
  const late = make({ now: lateNow, spawn })
  const latePlan = await late.plan('stop')
  const lateOutcome = await late.confirm(latePlan.confirmToken, {})
  assert.match(lateOutcome.reason, /expired/)
})

test('a failed start reports the launcher failure honestly with a plain explanation', async () => {
  const spawn = (file, argv, _opts) => ({
    stdout: { on: (_e, cb) => cb(Buffer.from('FAILED: did not become ready.')) },
    stderr: { on: () => {} },
    on: (evt, cb) => { if (evt === 'close') cb(4) },
  })
  const actions = make({ probe: () => Promise.resolve(server('stopped')), spawn })
  const plan = await actions.plan('start', { modelKey: 'a' })
  const outcome = await actions.confirm(plan.confirmToken, {})
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.exitCode, 4)
  assert.match(outcome.explanation, /did not become ready/)
  assert.match(outcome.output, /FAILED/)
})

test('an unexpected launcher exit is reported as failure, never as success', async () => {
  const spawn = () => ({
    stdout: { on: () => {} }, stderr: { on: () => {} },
    on: (evt, cb) => { if (evt === 'close') cb(5) },
  })
  const actions = make({ spawn })
  const plan = await actions.plan('stop')
  const outcome = await actions.confirm(plan.confirmToken, {})
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.explanation, /refused/)
})
// ---------------------------------------------------------------------------
// Generic manual launch reservation flow (2026-10-23 policy)
// ---------------------------------------------------------------------------

/** Reservation deps wired to a local store so apply/verify behavior is visible. */
const makeReservationActions = () => {
  let store = []
  return {
    store: () => store,
    actions: make({ now: () => 1750000000000 }) && createActions({
      config: CONFIG,
      probe: () => Promise.resolve(server('running')),
      modelByKey: (key) => CONFIG.models.find((m) => m.key === key),
      access: async () => undefined,
      now: () => 1750000000000,
      reservedGpus: () => store,
      setReservedGpus: (uuids) => { store = [...uuids] },
    }),
  }
}

test('planGpuReservation plans a reserve with a durable-state disclosure and confirm token', () => {
  const { actions } = makeReservationActions()
  const plan = actions.planGpuReservation('GPU-PROTECTED', 'reserved')
  assert.equal(plan.status, 'planned')
  assert.equal(plan.desired, 'reserved')
  assert.equal(plan.gpuName, 'RTX 3090 Ti')
  assert.ok(typeof plan.confirmToken === 'string')
  assert.match(plan.disclosure, /Nothing re-applies or removes it automatically/)
  assert.match(plan.impact, /Nothing currently running on the GPU is affected/)
})

test('confirmGpuReservation applies the reserve and the release, each step failing loud if not applied', () => {
  const { actions, store } = makeReservationActions()
  const reserve = actions.planGpuReservation('GPU-PROTECTED', 'reserved')
  const okReserve = actions.confirmGpuReservation(reserve.confirmToken)
  assert.equal(okReserve.status, 'ok')
  assert.deepEqual(store(), ['GPU-PROTECTED'])
  // Reserving again is refused: already reserved.
  const dup = actions.planGpuReservation('GPU-PROTECTED', 'reserved')
  assert.equal(dup.status, 'refused')
  assert.match(dup.reason, /already a manual launch reservation/)
  // Release restores the empty list.
  const release = actions.planGpuReservation('GPU-PROTECTED', 'unreserved')
  const okRelease = actions.confirmGpuReservation(release.confirmToken)
  assert.equal(okRelease.status, 'ok')
  assert.equal(okRelease.persisted, true)
  assert.deepEqual(store(), [])
  // Releasing when nothing is reserved is refused — proof of no auto default.
  const noop = actions.planGpuReservation('GPU-PROTECTED', 'unreserved')
  assert.equal(noop.status, 'refused')
  assert.match(noop.reason, /no GPU is reserved automatically/)
})

test('reservation planning refuses unknown UUIDs and invalid desired states', () => {
  const { actions } = makeReservationActions()
  assert.match(actions.planGpuReservation('GPU-UNKNOWN', 'reserved').reason, /not in the configured allowlist/)
  assert.match(actions.planGpuReservation('GPU-CASE', 'stomp').reason, /only "reserved" and "unreserved" are valid/)
  // Tokens are single-use.
  const { actions: a2 } = makeReservationActions()
  const plan = a2.planGpuReservation('GPU-CASE', 'reserved')
  assert.equal(a2.confirmGpuReservation(plan.confirmToken).status, 'ok')
  assert.match(a2.confirmGpuReservation(plan.confirmToken).reason, /expired, already used, or never issued/)
})

test('a failed apply reports the update as failed instead of pretending success', () => {
  // A setReservedGpus dep that drops every write must surface as `failed`.
  const actions = createActions({
    config: CONFIG,
    probe: () => Promise.resolve(server('running')),
    modelByKey: (key) => CONFIG.models.find((m) => m.key === key),
    access: async () => undefined,
    now: () => 1750000000000,
    reservedGpus: () => [],
    setReservedGpus: () => {},
  })
  const plan = actions.planGpuReservation('GPU-CASE', 'reserved')
  const outcome = actions.confirmGpuReservation(plan.confirmToken)
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.error, /the persisted state was not changed/)
})
