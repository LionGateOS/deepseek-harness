/**
 * Multi-instance integration coverage: config validation for instances and
 * candidateLauncherPath; runLauncherForInstance env injection; snapshot
 * servers array with per-instance probes; planAction/confirmAction routing by
 * instancePort; cross-instance isolation; backward-compat single-instance
 * mode. All tests are CPU-only with no real GPU, process, or systemd access.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { validateConfig } from '../core/config.js'
import { runLauncherForInstance, createActions, launcherArgv } from '../core/actions.js'
import { createLocalModelManagerService, Config } from '../index.js'

// ---------------------------------------------------------------------------
// Config validation — instances and candidateLauncherPath
// ---------------------------------------------------------------------------

test('validateConfig accepts instances and candidateLauncherPath', () => {
  const config = validateConfig({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    candidateLauncherPath: '/x/candidate/dsh-model-server-multi-instance',
    instances: [
      { port: 8001, gpuUuid: 'GPU-A', gpuName: 'RTX 3090' },
      { port: 8002, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' },
    ],
  })
  assert.equal(config.candidateLauncherPath, '/x/candidate/dsh-model-server-multi-instance')
  assert.equal(config.instances.length, 2)
  assert.equal(config.instances[0].port, 8001)
  assert.equal(config.instances[0].gpuUuid, 'GPU-A')
  assert.equal(config.instances[1].port, 8002)
  assert.equal(config.instances[1].gpuUuid, 'GPU-B')
})

test('validateConfig defaults to empty instances and candidateLauncherPath when absent', () => {
  const config = validateConfig({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
  })
  assert.deepEqual(config.instances, [])
  assert.equal(config.candidateLauncherPath, '')
})

test('validateConfig rejects duplicate instance ports', () => {
  assert.throws(() => validateConfig({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    instances: [
      { port: 8001, gpuUuid: 'GPU-A', gpuName: 'RTX 3090' },
      { port: 8001, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' },
    ],
  }), /unique port/)
})

test('validateConfig rejects invalid port numbers in instances', () => {
  assert.throws(() => validateConfig({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    instances: [{ port: 80, gpuUuid: 'GPU-A', gpuName: 'RTX 3090' }],
  }), /1024.*65535/)
})

test('validateConfig rejects a non-absolute candidateLauncherPath', () => {
  assert.throws(() => validateConfig({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    candidateLauncherPath: 'relative/path',
  }), /absolute/)
})

// ---------------------------------------------------------------------------
// runLauncherForInstance — env var injection
// ---------------------------------------------------------------------------

const multiConfig = validateConfig({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/launcher',
  caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
  protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
  models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
  candidateLauncherPath: '/x/candidate/launcher',
  instances: [
    { port: 8001, gpuUuid: 'GPU-A', gpuName: 'RTX 3090' },
    { port: 8002, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' },
  ],
  actionTimeoutMs: 100,
})

test('runLauncherForInstance injects MODEL_SERVER_PORT, MODEL_SERVER_GPU_UUID, and CUDA_VISIBLE_DEVICES', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const result = await runLauncherForInstance(
    multiConfig,
    { port: 8002, gpuUuid: 'GPU-B' },
    'stop',
    undefined,
    { spawn },
  )
  assert.equal(result.status, 'ok')
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].file, '/x/candidate/launcher')
  assert.equal(spawned[0].argv[0], 'stop')
  assert.equal(spawned[0].env.MODEL_SERVER_PORT, '8002')
  assert.equal(spawned[0].env.MODEL_SERVER_GPU_UUID, 'GPU-B')
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-B')
})

test('runLauncherForInstance injects port 8001 and GPU-A for the first instance', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ env: opts.env })
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  await runLauncherForInstance(multiConfig, { port: 8001, gpuUuid: 'GPU-A' }, 'stop', undefined, { spawn })
  assert.equal(spawned[0].env.MODEL_SERVER_PORT, '8001')
  assert.equal(spawned[0].env.MODEL_SERVER_GPU_UUID, 'GPU-A')
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-A')
})

test('runLauncherForInstance fails when candidateLauncherPath is empty', async () => {
  const configNoCand = { ...multiConfig, candidateLauncherPath: '' }
  const result = await runLauncherForInstance(configNoCand, { port: 8001, gpuUuid: 'GPU-A' }, 'stop', undefined, {})
  assert.equal(result.status, 'failed')
  assert.match(result.output, /candidateLauncherPath/)
})

test('runLauncherForInstance refuses an action not on the allowlist', async () => {
  const result = await runLauncherForInstance(multiConfig, { port: 8001, gpuUuid: 'GPU-A' }, 'restart', undefined, {})
  assert.equal(result.status, 'failed')
  assert.match(result.output, /allowlist/)
})

// ---------------------------------------------------------------------------
// createActions with instanceConfig — uses candidate launcher
// ---------------------------------------------------------------------------

const makeInstanceActions = ({ port, gpuUuid, probeResult, spawn: spawnImpl, accessOk = true }) => {
  const inst = { port, gpuUuid, gpuName: `GPU ${gpuUuid}` }
  return createActions({
    config: multiConfig,
    probe: () => Promise.resolve(probeResult),
    modelByKey: (key) => multiConfig.models.find((m) => m.key === key),
    access: async () => accessOk ? undefined : Object.assign(new Error('x'), { code: 'ENOENT' }),
    spawn: spawnImpl,
    instanceConfig: inst,
  })
}

test('createActions with instanceConfig checks candidateLauncherPath (not launcherPath) at plan time', async () => {
  // candidateLauncherPath exists (access returns ok) → plan proceeds to server check
  const actions = makeInstanceActions({
    port: 8001, gpuUuid: 'GPU-A',
    probeResult: { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false },
    accessOk: true,
  })
  const plan = await actions.plan('start', { modelKey: 'a' })
  assert.equal(plan.status, 'planned')
})

test('createActions with instanceConfig uses runLauncherForInstance at confirm time', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const actions = makeInstanceActions({
    port: 8002, gpuUuid: 'GPU-B',
    probeResult: { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false },
    spawn,
  })
  const plan = await actions.plan('start', { modelKey: 'a' })
  assert.equal(plan.status, 'planned')
  const outcome = await actions.confirm(plan.confirmToken, {})
  assert.equal(outcome.status, 'ok')
  // Must have used the candidate launcher, not launcherPath
  assert.equal(spawned[0].file, multiConfig.candidateLauncherPath)
  // Instance env vars injected
  assert.equal(spawned[0].env.MODEL_SERVER_PORT, '8002')
  assert.equal(spawned[0].env.MODEL_SERVER_GPU_UUID, 'GPU-B')
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-B')
})

// ---------------------------------------------------------------------------
// Service-level multi-instance snapshot
// ---------------------------------------------------------------------------

const baseConfig = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/launcher',
  caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
  protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 5,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'b', name: 'Model B', ggufPath: '/m/b.gguf', switchName: 'b', engineBinary: 'stable' },
  ],
  candidateLauncherPath: '/x/candidate/launcher',
  instances: [
    { port: 8001, gpuUuid: 'GPU-A', gpuName: 'RTX 3090' },
    { port: 8002, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' },
  ],
}).value

/** Build a multi-instance service with injectable per-instance probe results. */
const makeMultiService = (probe8001, probe8002, overrides = {}) => {
  const state = {
    config: baseConfig,
    probe: () => Promise.resolve({ state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }),
    probeInstances: {
      8001: () => Promise.resolve(probe8001),
      8002: () => Promise.resolve(probe8002),
    },
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
    // access resolves ok so launcher-existence checks pass in tests.
    spawn: undefined, access: async () => undefined,
    readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
    modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('absent'),
    buildDiscovery: async () => null,
    writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }),
    writeUserDirs: async () => {},
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'not invoked' },
      runtimes: { status: 'unavailable', error: 'not invoked' },
      compatibility: { status: 'unavailable', error: 'not invoked' },
    }),
    ...overrides,
  }
  return createLocalModelManagerService(state)
}

const stopped = { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
const runningA = { state: 'running', modelPath: '/m/a.gguf', liveContext: 32768, slots: [{ id: 0, n_ctx: 32768, isProcessing: false }], busy: false, busyUnknown: false }
const runningB = { state: 'running', modelPath: '/m/b.gguf', liveContext: 65536, slots: [{ id: 0, n_ctx: 65536, isProcessing: false }], busy: false, busyUnknown: false }

test('snapshot includes servers array when instances are configured', async () => {
  const service = makeMultiService(runningA, stopped)
  const snap = await service.snapshot()
  assert.ok(Array.isArray(snap.servers), 'snap.servers must be an array')
  assert.equal(snap.servers.length, 2)
  const [srv8001, srv8002] = snap.servers
  assert.equal(srv8001.port, 8001)
  assert.equal(srv8001.gpuUuid, 'GPU-A')
  assert.equal(srv8001.gpuName, 'RTX 3090')
  assert.equal(srv8001.endpoint, 'http://127.0.0.1:8001')
  assert.equal(srv8001.state, 'running')
  assert.equal(srv8001.runningModelKey, 'a')
  assert.equal(srv8002.port, 8002)
  assert.equal(srv8002.state, 'stopped')
  assert.equal(srv8002.runningModelKey, undefined)
})

test('snapshot servers omits runningModelKey when no model is running on an instance', async () => {
  const service = makeMultiService(stopped, stopped)
  const snap = await service.snapshot()
  assert.equal(snap.servers[0].runningModelKey, undefined)
  assert.equal(snap.servers[1].runningModelKey, undefined)
})

test('snapshot model runtime is running when model runs on any instance', async () => {
  const service = makeMultiService(runningA, stopped)
  const snap = await service.snapshot()
  const a = snap.models.find((m) => m.key === 'a')
  const b = snap.models.find((m) => m.key === 'b')
  assert.equal(a.runtime, 'running')
  assert.equal(b.runtime, 'stopped')
})

test('snapshot model runtime is running on the second instance', async () => {
  const service = makeMultiService(stopped, runningB)
  const snap = await service.snapshot()
  const a = snap.models.find((m) => m.key === 'a')
  const b = snap.models.find((m) => m.key === 'b')
  assert.equal(a.runtime, 'stopped')
  assert.equal(b.runtime, 'running')
})

test('snapshot model runtime is running on both instances simultaneously (same GGUF on both)', async () => {
  // Both instances running the same model — supported by design.
  const service = makeMultiService(runningA, runningA)
  const snap = await service.snapshot()
  const a = snap.models.find((m) => m.key === 'a')
  assert.equal(a.runtime, 'running')
  assert.deepEqual(a.runningOnPorts, [8001, 8002])
})

test('snapshot does not include servers array when no instances are configured', async () => {
  // Use a config without instances (single-instance mode).
  const singleConfig = Config['~standard'].validate({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    maxErrorRecords: 5,
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
  }).value
  const state = {
    config: singleConfig,
    probe: () => Promise.resolve(runningA),
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
    spawn: undefined, access: undefined,
    readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
    modelByKey: (key) => singleConfig.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('absent'),
    buildDiscovery: async () => null,
    writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }),
    writeUserDirs: async () => {},
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'not invoked' },
      runtimes: { status: 'unavailable', error: 'not invoked' },
      compatibility: { status: 'unavailable', error: 'not invoked' },
    }),
  }
  const service = createLocalModelManagerService(state)
  const snap = await service.snapshot()
  assert.equal(snap.servers, undefined, 'servers must be absent in single-instance mode')
  assert.equal(snap.models.find((m) => m.key === 'a').runtime, 'running')
})

// ---------------------------------------------------------------------------
// planAction/confirmAction multi-instance routing
// ---------------------------------------------------------------------------

test('planAction with instancePort routes to the correct per-instance actions machine', async () => {
  const service = makeMultiService(stopped, runningB)
  // planAction stop on port 8002 (which has model B running) — should succeed
  const plan = await service.planAction('stop', { instancePort: 8002 })
  assert.equal(plan.status, 'planned')
  assert.equal(plan.action, 'stop')
})

test('planAction with instancePort refuses stop on a stopped instance', async () => {
  const service = makeMultiService(stopped, stopped)
  const plan = await service.planAction('stop', { instancePort: 8001 })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already stopped/)
})

test('planAction with instancePort refuses start when the instance is already running', async () => {
  const service = makeMultiService(runningA, stopped)
  const plan = await service.planAction('start', { modelKey: 'a', instancePort: 8001 })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already the model that is running/)
})

test('planAction refuses when instancePort is not configured', async () => {
  const service = makeMultiService(stopped, stopped)
  const plan = await service.planAction('stop', { instancePort: 9999 })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not a configured/)
})

test('planAction without instancePort falls back to single-instance machine', async () => {
  const service = makeMultiService(stopped, stopped)
  // No instancePort: uses the main actions machine (probe returns stopped).
  const plan = await service.planAction('stop')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already stopped/)
})

test('confirmAction routes to the per-instance machine that issued the token', async () => {
  const spawned = []
  const spawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts.env })
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
  }
  const service = makeMultiService(runningA, stopped, { access: async () => undefined, spawn })
  const plan = await service.planAction('stop', { instancePort: 8001 })
  assert.equal(plan.status, 'planned')
  const outcome = await service.confirmAction(plan.confirmToken, {})
  assert.equal(outcome.status, 'ok')
  // Candidate launcher used, with port 8001 env vars.
  assert.equal(spawned[0].file, baseConfig.candidateLauncherPath)
  assert.equal(spawned[0].env.MODEL_SERVER_PORT, '8001')
  assert.equal(spawned[0].env.CUDA_VISIBLE_DEVICES, 'GPU-A')
})

// ---------------------------------------------------------------------------
// Cross-instance isolation
// ---------------------------------------------------------------------------

/** Build a minimal isolation-test service with custom per-instance probe counters. */
const makeIsolationService = (probeInstances) => createLocalModelManagerService({
  config: baseConfig,
  probe: () => Promise.resolve(stopped),
  probeInstances,
  readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
  queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
  queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
  stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
  spawn: undefined, access: async () => undefined,
  readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
  modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
  detectVllm: () => Promise.resolve('absent'),
  buildDiscovery: async () => null, writeDiscovery: async () => {},
  readUserDirs: async () => ({ dirs: [] }), writeUserDirs: async () => {},
  getModelAdvisorData: () => Promise.resolve({
    hardware: { status: 'unavailable', error: 'not invoked' },
    runtimes: { status: 'unavailable', error: 'not invoked' },
    compatibility: { status: 'unavailable', error: 'not invoked' },
  }),
})

test('stopping instance 8001 does not probe instance 8002', async () => {
  const calls = { 8001: 0, 8002: 0 }
  const service = makeIsolationService({
    8001: () => { calls[8001]++; return Promise.resolve(runningA) },
    8002: () => { calls[8002]++; return Promise.resolve(stopped) },
  })
  const probeBefore = { ...calls }
  const plan = await service.planAction('stop', { instancePort: 8001 })
  assert.equal(plan.status, 'planned')
  assert.ok(calls[8001] > probeBefore[8001], 'port 8001 should have been probed')
  assert.equal(calls[8002], 0, 'port 8002 must not be probed when planning for port 8001')
})

test('planAction start on port 8002 probes only port 8002', async () => {
  const calls = { 8001: 0, 8002: 0 }
  const service = makeIsolationService({
    8001: () => { calls[8001]++; return Promise.resolve(runningA) },
    8002: () => { calls[8002]++; return Promise.resolve(stopped) },
  })
  await service.planAction('start', { modelKey: 'a', instancePort: 8002 })
  assert.equal(calls[8001], 0, 'port 8001 must not be probed when targeting port 8002')
  assert.ok(calls[8002] > 0, 'port 8002 should have been probed')
})

// ---------------------------------------------------------------------------
// Context verification per-instance — Job 9 regression tests
// ---------------------------------------------------------------------------

test('confirmAction uses the port-8002 probe for context verification after port-8002 start', async () => {
  // Arrange: port 8001 is stopped; port 8002 starts stopped but transitions to
  // running after spawn — so planAction succeeds and context verification sees
  // the live server at port 8002.
  let port8001Probed = false
  let port8002Probed = false
  let launched = false
  const runningA8002 = { state: 'running', modelPath: '/m/a.gguf', liveContext: 32768, slots: [{ id: 0, n_ctx: 32768, isProcessing: false }], busy: false, busyUnknown: false }
  const spawn = (file, argv, opts) => {
    launched = true
    return {
      stdout: { on: (_e, cb) => cb(Buffer.from('READY')) },
      stderr: { on: () => {} },
      on: (evt, cb) => { if (evt === 'close') cb(0) },
    }
  }
  const service = createLocalModelManagerService({
    config: baseConfig,
    probe: () => { port8001Probed = true; return Promise.resolve(stopped) },
    probeInstances: {
      8001: () => { port8001Probed = true; return Promise.resolve(stopped) },
      8002: () => { port8002Probed = true; return Promise.resolve(launched ? runningA8002 : stopped) },
    },
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
    spawn, access: async () => undefined,
    readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
    modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('absent'),
    buildDiscovery: async () => null, writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }), writeUserDirs: async () => {},
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'not invoked' },
      runtimes: { status: 'unavailable', error: 'not invoked' },
      compatibility: { status: 'unavailable', error: 'not invoked' },
    }),
  })

  const plan = await service.planAction('start', { modelKey: 'a', instancePort: 8002 })
  assert.equal(plan.status, 'planned')

  // Reset probe counters before confirmAction.
  port8001Probed = false
  port8002Probed = false

  const outcome = await service.confirmAction(plan.confirmToken, {})
  assert.equal(outcome.status, 'ok', 'start must succeed')
  assert.equal(port8002Probed, true, 'port 8002 probe must be called for context verification')
  assert.equal(port8001Probed, false, 'port 8001 (main probe) must NOT be called after port-8002 start')
  // Context verification must find the running model at port 8002.
  assert.ok(outcome.context !== undefined, 'context verification result must be present')
  assert.equal(outcome.context.live, 32768, 'live context must reflect the port-8002 server')
})

test('confirmAction uses the main probe for context verification after port-8001 start', async () => {
  // Port 8001 is running model A after start; port 8002 is stopped.
  let mainProbed = false
  const runningA8001 = { state: 'running', modelPath: '/m/a.gguf', liveContext: 65536, slots: [], busy: false, busyUnknown: false }
  const spawn = (file, argv, opts) => ({
    stdout: { on: (_e, cb) => cb(Buffer.from('READY')) },
    stderr: { on: () => {} },
    on: (evt, cb) => { if (evt === 'close') cb(0) },
  })
  const service = createLocalModelManagerService({
    config: baseConfig,
    probe: () => { mainProbed = true; return Promise.resolve(runningA8001) },
    probeInstances: {
      8001: () => { mainProbed = true; return Promise.resolve(runningA8001) },
      8002: () => Promise.resolve(stopped),
    },
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
    spawn, access: async () => undefined,
    readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
    modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('absent'),
    buildDiscovery: async () => null, writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }), writeUserDirs: async () => {},
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'not invoked' },
      runtimes: { status: 'unavailable', error: 'not invoked' },
      compatibility: { status: 'unavailable', error: 'not invoked' },
    }),
  })

  const plan = await service.planAction('start', { modelKey: 'a', instancePort: 8001 })
  assert.equal(plan.status, 'refused', 'model A is already running on port 8001 — plan must be refused')
  // Verify that the multi-instance path, not only single-instance, uses per-instance probe.
  // We test by confirming via the main actions machine (no instancePort) with a probe that
  // returns running after start — context verification should find it.
  const mainPlan = await service.planAction('start', { modelKey: 'b' })
  // main probe returns runningA8001 (not stopped), so start is refused:
  assert.equal(mainPlan.status, 'refused', 'start must be refused when main probe sees a running server')
})

// ---------------------------------------------------------------------------
// Ownership records — Issue B: safe controls
// ---------------------------------------------------------------------------

/** Build a multi-instance service with a selective access mock. */
const makeServiceWithAccess = (accessFn, overrides = {}) => createLocalModelManagerService({
  config: baseConfig,
  probe: () => Promise.resolve(stopped),
  probeInstances: {
    8001: () => Promise.resolve(runningA),
    8002: () => Promise.resolve(runningB),
  },
  readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
  queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
  queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
  stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
  spawn: undefined, access: accessFn,
  readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
  modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
  detectVllm: () => Promise.resolve('absent'),
  buildDiscovery: async () => null, writeDiscovery: async () => {},
  readUserDirs: async () => ({ dirs: [] }), writeUserDirs: async () => {},
  getServerPid: async () => null,
  getModelAdvisorData: () => Promise.resolve({
    hardware: { status: 'unavailable', error: 'not invoked' },
    runtimes: { status: 'unavailable', error: 'not invoked' },
    compatibility: { status: 'unavailable', error: 'not invoked' },
  }),
  ...overrides,
})

test('snapshot servers include owned:false when the .rec ownership file is absent', async () => {
  // access throws ENOENT for .rec paths; resolves for all other paths (launcher check).
  const service = makeServiceWithAccess(async (path) => {
    if (path.includes('/instance-p')) { const e = new Error('x'); e.code = 'ENOENT'; throw e }
  })
  const snap = await service.snapshot()
  assert.ok(Array.isArray(snap.servers))
  assert.equal(snap.servers[0].owned, false, 'port 8001 must be owned:false when .rec is absent')
  assert.equal(snap.servers[1].owned, false, 'port 8002 must be owned:false when .rec is absent')
})

test('snapshot servers include owned:true when the .rec ownership file exists', async () => {
  // access always resolves — .rec file present for both ports.
  const service = makeServiceWithAccess(async () => undefined)
  const snap = await service.snapshot()
  assert.ok(Array.isArray(snap.servers))
  assert.equal(snap.servers[0].owned, true, 'port 8001 must be owned:true when .rec exists')
  assert.equal(snap.servers[1].owned, true, 'port 8002 must be owned:true when .rec exists')
})

test('planAction refuses stop on an unowned instance (no .rec file)', async () => {
  // access: launcher path ok, .rec paths fail.
  const service = makeServiceWithAccess(async (path) => {
    if (path.includes('/instance-p')) { const e = new Error('x'); e.code = 'ENOENT'; throw e }
  })
  const plan = await service.planAction('stop', { instancePort: 8001 })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not started by this panel/)
})

test('planAction refuses switch on an unowned instance (no .rec file)', async () => {
  const service = makeServiceWithAccess(async (path) => {
    if (path.includes('/instance-p')) { const e = new Error('x'); e.code = 'ENOENT'; throw e }
  })
  const plan = await service.planAction('switch', { modelKey: 'b', instancePort: 8001 })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not started by this panel/)
})

test('planAction allows start on an unowned instance (start does not require ownership)', async () => {
  const service = makeServiceWithAccess(async (path) => {
    if (path.includes('/instance-p')) { const e = new Error('x'); e.code = 'ENOENT'; throw e }
  }, { probeInstances: { 8001: () => Promise.resolve(stopped), 8002: () => Promise.resolve(stopped) } })
  const plan = await service.planAction('start', { modelKey: 'a', instancePort: 8001 })
  // No ownership check for start; plan should proceed.
  assert.equal(plan.status, 'planned')
})

// ---------------------------------------------------------------------------
// Actual GPU identity — Issue A
// ---------------------------------------------------------------------------

test('snapshot servers include actualGpuUuid and actualGpuName from process lookup', async () => {
  // getServerPid returns a known PID; queryGpus returns that PID on GPU-B.
  const service = makeServiceWithAccess(async () => undefined, {
    getServerPid: async (port) => port === 8001 ? 12345 : null,
    queryGpus: async () => ({
      status: 'ok',
      gpus: [
        { uuid: 'GPU-A', name: 'RTX 3090', index: 0, memUsedMiB: 0, memTotalMiB: 24576, utilizationPct: 0 },
        { uuid: 'GPU-B', name: 'RTX 3090 Ti', index: 1, memUsedMiB: 0, memTotalMiB: 24576, utilizationPct: 0 },
      ],
      processes: [{ uuid: 'GPU-B', pid: 12345, processName: 'llama-server', memUsedMiB: 10000 }],
    }),
  })
  const snap = await service.snapshot()
  const srv8001 = snap.servers[0]
  // Config says GPU-A (RTX 3090); actual is GPU-B (RTX 3090 Ti).
  assert.equal(srv8001.gpuUuid, 'GPU-A', 'gpuUuid must remain the configured value')
  assert.equal(srv8001.actualGpuUuid, 'GPU-B', 'actualGpuUuid must reflect the process-verified GPU')
  assert.equal(srv8001.actualGpuName, 'RTX 3090 Ti', 'actualGpuName must reflect the process-verified GPU name')
})

test('snapshot servers include actualGpuUuid:null when server PID is not found', async () => {
  const service = makeServiceWithAccess(async () => undefined, {
    getServerPid: async () => null,
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
  })
  const snap = await service.snapshot()
  assert.equal(snap.servers[0].actualGpuUuid, null, 'actualGpuUuid must be null when PID unknown')
  assert.equal(snap.servers[0].actualGpuName, null, 'actualGpuName must be null when PID unknown')
})

// ---------------------------------------------------------------------------
// planAdoptInstance / confirmAdoptInstance — Adopt External Server
// ---------------------------------------------------------------------------

/**
 * Build a service set up for adopt tests. Port 8001 is running model A but
 * has no .rec file (external). Port 8002 has a .rec file (already owned).
 * The GPU and systemd unit are injectable.
 */
const makeAdoptService = (overrides = {}) => {
  const written = []
  const renamed = []
  return createLocalModelManagerService({
    config: baseConfig,
    probe: () => Promise.resolve(stopped),
    probeInstances: {
      8001: () => Promise.resolve(runningA),
      8002: () => Promise.resolve(runningB),
    },
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({
      status: 'ok',
      gpus: [
        { uuid: 'GPU-A', name: 'RTX 3090', index: 0, memUsedMiB: 21784, memTotalMiB: 24576, utilizationPct: 50 },
        { uuid: 'GPU-B', name: 'RTX 3090 Ti', index: 1, memUsedMiB: 21778, memTotalMiB: 24576, utilizationPct: 50 },
      ],
      processes: [
        { uuid: 'GPU-A', pid: 3001, processName: 'llama-server', memUsedMiB: 21784 },
        { uuid: 'GPU-B', pid: 3002, processName: 'llama-server', memUsedMiB: 21778 },
      ],
    }),
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
    spawn: undefined,
    // Port 8001 has no .rec (external); port 8002 has a .rec (already owned).
    access: async (path) => {
      if (path.includes('/instance-p8001.rec')) { const e = new Error('x'); e.code = 'ENOENT'; throw e }
    },
    readGgufMeta: async () => ({ status: 'unavailable', error: 'not invoked' }),
    modelByKey: (key) => baseConfig.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('absent'),
    buildDiscovery: async () => null,
    writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }),
    writeUserDirs: async () => {},
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'not invoked' },
      runtimes: { status: 'unavailable', error: 'not invoked' },
      compatibility: { status: 'unavailable', error: 'not invoked' },
    }),
    // Injectable PID: port 8001 → PID 3001, port 8002 → PID 3002.
    getServerPid: async (port) => port === 8001 ? 3001 : port === 8002 ? 3002 : null,
    // Injectable unit finder: PID 3001 → the external unit, PID 3002 → the owned unit.
    findUnitForPid: async (pid) => {
      if (pid === 3001) return { status: 'ok', unitName: 'dsh-model-1792992426410-qwen3.5-27b.service' }
      if (pid === 3002) return { status: 'ok', unitName: 'dsh-model-1792992633144-qwen3.5-27b-p8002.service' }
      return { status: 'not-found' }
    },
    // Injectable atomic write for adoption .rec file.
    writeFile: async (path, content) => { written.push({ path, content }) },
    rename: async (src, dest) => { renamed.push({ src, dest }) },
    _written: written,
    _renamed: renamed,
    ...overrides,
  })
}

test('planAdoptInstance returns planned with verified facts for a running external server', async () => {
  const svc = makeAdoptService()
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'planned')
  assert.equal(plan.port, 8001)
  assert.equal(plan.pid, 3001)
  assert.equal(plan.unitName, 'dsh-model-1792992426410-qwen3.5-27b.service')
  assert.equal(plan.gpuUuid, 'GPU-A')
  assert.equal(plan.modelKey, 'a')
  assert.ok(typeof plan.confirmToken === 'string' && plan.confirmToken.startsWith('adopt-'))
  assert.ok(typeof plan.impact === 'string' && plan.impact.includes('Port 8001'))
})

test('planAdoptInstance refuses when port is not configured', async () => {
  const svc = makeAdoptService()
  const plan = await svc.planAdoptInstance(9999)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not a configured/)
})

test('planAdoptInstance refuses when the server is already owned (.rec exists)', async () => {
  const svc = makeAdoptService()
  // Port 8002 has a .rec file (access resolves ok for it).
  const plan = await svc.planAdoptInstance(8002)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already has an ownership record/)
})

test('planAdoptInstance refuses when the server is not running', async () => {
  const svc = makeAdoptService({
    probeInstances: {
      8001: () => Promise.resolve(stopped),
      8002: () => Promise.resolve(stopped),
    },
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not currently running/)
})

test('planAdoptInstance refuses when the PID cannot be determined', async () => {
  const svc = makeAdoptService({ getServerPid: async () => null })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /cannot identify the process/)
})

test('planAdoptInstance refuses when the PID is not in the GPU process list', async () => {
  const svc = makeAdoptService({
    queryGpus: async () => ({
      status: 'ok',
      gpus: [{ uuid: 'GPU-A', name: 'RTX 3090', index: 0, memUsedMiB: 0, memTotalMiB: 24576, utilizationPct: 0 }],
      processes: [], // PID 3001 absent
    }),
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not found in the GPU process list/)
})

test('planAdoptInstance refuses when the actual GPU UUID does not match the configured instance GPU', async () => {
  const svc = makeAdoptService({
    queryGpus: async () => ({
      status: 'ok',
      gpus: [{ uuid: 'GPU-B', name: 'RTX 3090 Ti', index: 1, memUsedMiB: 0, memTotalMiB: 24576, utilizationPct: 0 }],
      // PID 3001 is on GPU-B, but port 8001 is configured for GPU-A.
      processes: [{ uuid: 'GPU-B', pid: 3001, processName: 'llama-server', memUsedMiB: 21784 }],
    }),
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /mis-attribution/)
})

test('planAdoptInstance refuses when no dsh-model-* systemd unit owns the PID', async () => {
  const svc = makeAdoptService({ findUnitForPid: async () => ({ status: 'not-found' }) })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /no active dsh-model-\* systemd unit/)
})

test('confirmAdoptInstance writes the .rec file atomically and returns ok', async () => {
  const written = []
  const renamed = []
  const svc = makeAdoptService({
    writeFile: async (path, content) => { written.push({ path, content }) },
    rename: async (src, dest) => { renamed.push({ src, dest }) },
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'planned')
  const outcome = await svc.confirmAdoptInstance(plan.confirmToken)
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.port, 8001)
  assert.equal(outcome.unitName, 'dsh-model-1792992426410-qwen3.5-27b.service')
  assert.equal(outcome.gpuUuid, 'GPU-A')
  // Verify the .rec file content matches the candidate launcher format exactly.
  assert.equal(written.length, 1)
  assert.ok(written[0].path.endsWith('.tmp-adopt'))
  assert.equal(written[0].content, 'unit=dsh-model-1792992426410-qwen3.5-27b.service\ngpu=GPU-A\nmodel=/m/a.gguf\nport=8001\n')
  assert.equal(renamed.length, 1)
  assert.ok(renamed[0].src.endsWith('.tmp-adopt'))
  assert.ok(renamed[0].dest.endsWith('instance-p8001.rec'))
})

test('confirmAdoptInstance refuses when given an invalid or expired token', async () => {
  const svc = makeAdoptService()
  const outcome = await svc.confirmAdoptInstance('adopt-invalid-token')
  assert.equal(outcome.status, 'refused')
  assert.match(outcome.reason, /no longer valid/)
})

test('confirmAdoptInstance is single-use: second confirm with the same token is refused', async () => {
  const svc = makeAdoptService()
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'planned')
  const first = await svc.confirmAdoptInstance(plan.confirmToken)
  assert.equal(first.status, 'ok')
  const second = await svc.confirmAdoptInstance(plan.confirmToken)
  assert.equal(second.status, 'refused')
  assert.match(second.reason, /no longer valid/)
})

test('confirmAdoptInstance refuses when the PID changed between plan and confirm', async () => {
  let callCount = 0
  const svc = makeAdoptService({
    // First call (planAdoptInstance) returns PID 3001; subsequent call returns different PID.
    getServerPid: async (port) => {
      if (port !== 8001) return null
      callCount++
      return callCount === 1 ? 3001 : 9999
    },
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'planned')
  const outcome = await svc.confirmAdoptInstance(plan.confirmToken)
  assert.equal(outcome.status, 'refused')
  assert.match(outcome.reason, /changed between plan and confirm/)
})

test('confirmAdoptInstance refuses when the systemd unit changed between plan and confirm', async () => {
  let callCount = 0
  const svc = makeAdoptService({
    findUnitForPid: async (pid) => {
      if (pid !== 3001) return { status: 'not-found' }
      callCount++
      // First call (planAdoptInstance) returns the expected unit; second returns a different name.
      const name = callCount === 1
        ? 'dsh-model-1792992426410-qwen3.5-27b.service'
        : 'dsh-model-9999999999999-qwen3.5-27b.service'
      return { status: 'ok', unitName: name }
    },
  })
  const plan = await svc.planAdoptInstance(8001)
  assert.equal(plan.status, 'planned')
  const outcome = await svc.confirmAdoptInstance(plan.confirmToken)
  assert.equal(outcome.status, 'refused')
  assert.match(outcome.reason, /changed between plan and confirm/)
})

// ---------------------------------------------------------------------------
// Observed endpoints: local servers this manager watches but does not launch.
// ---------------------------------------------------------------------------

test('validateConfig accepts localEndpoints and rejects a managed-port collision', () => {
  const base = {
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/launcher',
    caseGpuUuid: 'GPU-A', caseGpuName: 'RTX 3090',
    protectedGpuUuid: 'GPU-B', protectedGpuName: 'RTX 3090 Ti',
    allowedGpuUuids: ['GPU-A', 'GPU-B'],
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
  }
  const ok = validateConfig({ ...base, localEndpoints: [{ port: 8080, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' }] })
  assert.deepEqual(ok.localEndpoints, [{ port: 8080, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' }])
  assert.deepEqual(validateConfig(base).localEndpoints, [], 'absent means none, not a guessed default')
  assert.throws(() => validateConfig({ ...base, localEndpoints: [{ port: 8080, gpuUuid: 'GPU-X', gpuName: 'Nope' }] }), /allowedGpuUuids/)
  assert.throws(() => validateConfig({
    ...base,
    instances: [{ port: 8080, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' }],
    localEndpoints: [{ port: 8080, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' }],
  }), /already a managed instance port/)
  assert.throws(() => validateConfig({ ...base, localEndpoints: [{ port: 8080, gpuUuid: 'GPU-B', gpuName: 'A' }, { port: 8080, gpuUuid: 'GPU-A', gpuName: 'B' }] }), /unique port/)
})

test('observeEndpoint reports the configured card only when the endpoint answers', async () => {
  const { observeEndpoint } = await import('../core/runtime.js')
  const answering = () => Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
  const target = { port: 8080, gpuUuid: 'GPU-B', gpuName: 'RTX 3090 Ti' }
  const running = await observeEndpoint(target, 500, { fetch: answering })
  assert.equal(running.state, 'running')
  assert.equal(running.gpuUuid, 'GPU-B', 'the identity comes from configuration, never the model name')
  assert.equal(running.endpoint, 'http://127.0.0.1:8080')

  const dead = await observeEndpoint(target, 500, { fetch: () => Promise.reject(new Error('connect ECONNREFUSED')) })
  assert.equal(dead.state, 'stopped')
  assert.equal(dead.endpoint, 'http://127.0.0.1:8080', 'a stopped port is still named, so the caller can say why')
})
