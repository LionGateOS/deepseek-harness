/**
 * Profile-based launch planning and confirmation: GPU boundary enforcement,
 * engine support gate, model lookup, launcher check, server probe, plan/confirm
 * two-step gate, single-use token, token expiry, and error ring recording.
 *
 * All tests are software-only: no real GPU, launcher, or inference server is
 * ever touched. The spawn stub captures argv and resolves immediately.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createLocalModelManagerService, Config } from '../index.js'

const BASE_CONFIG = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE-UUID',
  caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-PROT-UUID',
  protectedGpuName: 'RTX 3090 Ti',
  confirmTtlMs: 10000,
  maxErrorRecords: 10,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'b', name: 'Model B', ggufPath: '/m/b.gguf', switchName: 'b', engineBinary: 'stable' },
  ],
  launchProfiles: [
    {
      profileId: 'profile-a',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'single',
      launchArgs: ['--flash-attn', 'on'],
      label: 'Model A — RTX 3090',
    },
    {
      profileId: 'profile-b',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'b',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Model B — RTX 3090',
    },
    {
      profileId: 'profile-prot',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-PROT-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Model A — Protected GPU (should be refused)',
    },
    {
      profileId: 'profile-both',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'both',
      launchArgs: [],
      label: 'Model A — Both GPUs (should be refused)',
    },
    {
      profileId: 'profile-vllm',
      engineId: 'vllm',
      engineVersion: '0.9.0',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Model A — vLLM (should be refused)',
    },
  ],
}).value

const server = (state, overrides = {}) =>
  state === 'stopped'
    ? { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
    : { state: 'running', modelPath: '/m/a.gguf', slots: [], busy: false, busyUnknown: false, ...overrides }

/** Spawn stub: always exits 0 immediately, captures argv. */
const makeSpawn = (onArgv) => (path, argv, _opts) => {
  if (onArgv) onArgv(argv)
  const child = {
    stdout: { on: (_e, _cb) => {} },
    stderr: { on: (_e, _cb) => {} },
    on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
    kill: () => {},
  }
  return child
}

const makeService = (overrides = {}) => {
  const state = {
    config: BASE_CONFIG,
    modelByKey: (key) => BASE_CONFIG.models.find((m) => m.key === key),
    probe: () => Promise.resolve(server('stopped')),
    readProviderFacts: () => Promise.resolve({ status: 'ok', source: 'provider-config', byPath: {} }),
    queryGpus: async () => ({ status: 'ok', gpus: [], processes: [] }),
    stat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }) },
    detectVllm: async () => 'absent',
    getModelAdvisorData: async () => ({
      hardware: { status: 'unavailable', error: 'test' },
      runtimes: { status: 'unavailable', error: 'test' },
      compatibility: { status: 'unavailable', error: 'test' },
    }),
    access: async () => undefined, // launcher present and executable
    spawn: makeSpawn(),
    now: Date.now,
    ...overrides,
  }
  return createLocalModelManagerService(state)
}

// ---------------------------------------------------------------------------
// planLaunch — refusal cases
// ---------------------------------------------------------------------------

test('planLaunch refuses an unconfigured profileId', async () => {
  const service = makeService()
  const plan = await service.planLaunch('no-such-profile')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not configured/)
})

test('planLaunch refuses the Ti profile when the Ti UUID is outside the allowlist boundary', async () => {
  // The legacy auto-reservation is gone; with the default allowlist
  // ([GPU-CASE-UUID]) the Ti profile is refused for the allowlist alone.
  const service = makeService()
  const plan = await service.planLaunch('profile-prot')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not in the allowed GPU list/)
  assert.match(plan.reason, /GPU-PROT-UUID/)
})

test('planLaunch refuses a profile with gpuMode "both"', async () => {
  const service = makeService()
  const plan = await service.planLaunch('profile-both')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /gpuMode "both"/)
})

test('planLaunch refuses a profile using an unsupported engine (vllm)', async () => {
  const service = makeService()
  const plan = await service.planLaunch('profile-vllm')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /vllm/)
  assert.match(plan.reason, /does not currently support/)
})

test('planLaunch refuses when the profile model key is not in the catalog', async () => {
  // Override config to have a profile pointing at a non-existent model key
  const config = Config['~standard'].validate({
    ...BASE_CONFIG,
    models: BASE_CONFIG.models,
    launchProfiles: [{
      profileId: 'p-missing-model',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'does-not-exist',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Missing model test',
    }],
  }).value
  const service = makeService({ config })
  const plan = await service.planLaunch('p-missing-model')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not in the managed catalog/)
})

test('planLaunch refuses when the launcher is absent', async () => {
  const service = makeService({
    access: async () => Object.assign(new Error('x'), { code: 'ENOENT' }),
  })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /launcher/)
})

test('planLaunch refuses when the target model is already running', async () => {
  const service = makeService({
    probe: () => Promise.resolve(server('running', { modelPath: '/m/a.gguf' })),
  })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already the running model/)
})

test('planLaunch refuses when a different model is running', async () => {
  const service = makeService({
    probe: () => Promise.resolve(server('running', { modelPath: '/m/b.gguf' })),
  })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /another model is running/)
})

// ---------------------------------------------------------------------------
// planLaunch — success cases
// ---------------------------------------------------------------------------

test('planLaunch returns a complete plan envelope for a valid profile', async () => {
  const service = makeService()
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  assert.equal(plan.profileId, 'profile-a')
  assert.equal(plan.engineId, 'llama.cpp')
  assert.equal(plan.engineVersion, 'b5561')
  assert.equal(plan.modelKey, 'a')
  assert.equal(plan.modelName, 'Model A')
  assert.deepEqual(plan.gpuUuids, ['GPU-CASE-UUID'])
  assert.equal(plan.gpuMode, 'single')
  assert.equal(plan.gpuName, 'RTX 3090 — Case')
  assert.deepEqual(plan.launchArgs, ['--flash-attn', 'on'])
  assert.equal(plan.label, 'Model A — RTX 3090')
  assert.equal(typeof plan.confirmToken, 'string')
  assert.ok(plan.confirmToken.startsWith('launch-'))
  assert.equal(typeof plan.expiresInMs, 'number')
  assert.match(plan.impact, /Model A/)
})

test('planLaunch includes optional profile notes in the plan', async () => {
  const config = Config['~standard'].validate({
    ...BASE_CONFIG,
    models: BASE_CONFIG.models,
    launchProfiles: [{
      profileId: 'p-with-notes',
      engineId: 'llama.cpp',
      engineVersion: 'b5000',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Test profile',
      notes: 'Verified 2026-10-21',
    }],
  }).value
  const service = makeService({ config })
  const plan = await service.planLaunch('p-with-notes')
  assert.equal(plan.status, 'planned')
  assert.equal(plan.notes, 'Verified 2026-10-21')
})

// ---------------------------------------------------------------------------
// confirmLaunch
// ---------------------------------------------------------------------------

test('confirmLaunch refuses an unknown token', async () => {
  const service = makeService()
  const result = await service.confirmLaunch('launch-nope')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /no longer valid/)
})

test('confirmLaunch refuses an expired token', async () => {
  let tick = 0
  const service = makeService({ now: () => tick })
  tick = 1000
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  // Advance time past TTL
  tick = 1000 + BASE_CONFIG.confirmTtlMs + 1
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /expired/)
})

test('confirmLaunch is single-use: second confirm with same token is refused', async () => {
  const service = makeService()
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  const first = await service.confirmLaunch(plan.confirmToken)
  assert.equal(first.status, 'ok')
  const second = await service.confirmLaunch(plan.confirmToken)
  assert.equal(second.status, 'refused')
  assert.match(second.reason, /no longer valid/)
})

test('confirmLaunch refuses when the server started running since the plan', async () => {
  let probeState = 'stopped'
  const service = makeService({
    probe: () => Promise.resolve(server(probeState)),
  })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  probeState = 'running'
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /started running since this launch was planned/)
})

test('confirmLaunch executes the launcher and returns its result', async () => {
  const capturedArgv = []
  const service = makeService({ spawn: makeSpawn((argv) => capturedArgv.push(...argv)) })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'ok')
  assert.equal(result.profileId, 'profile-a')
  assert.equal(result.modelKey, 'a')
  // Launcher called with start-<switchName>
  assert.ok(capturedArgv.includes('start-a'), `expected start-a in argv, got: ${capturedArgv.join(' ')}`)
})

test('confirmLaunch sets CUDA_VISIBLE_DEVICES to the CASE GPU UUID in the spawn environment', async () => {
  let capturedEnv = null
  const customSpawn = (_path, _argv, opts) => {
    capturedEnv = opts?.env ?? null
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
    return child
  }
  const service = makeService({ spawn: customSpawn })
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  await service.confirmLaunch(plan.confirmToken)
  assert.equal(capturedEnv?.CUDA_VISIBLE_DEVICES, 'GPU-CASE-UUID')
})

// ---------------------------------------------------------------------------
// Error ring recording
// ---------------------------------------------------------------------------

test('planLaunch refused actions are recorded in the error ring', async () => {
  const service = makeService()
  await service.planLaunch('no-such-profile')
  const errors = (await service.recentErrors()).errors
  assert.ok(errors.length >= 1)
  const last = errors[errors.length - 1]
  assert.equal(last.action, 'launch')
  assert.equal(last.status, 'refused')
})

test('confirmLaunch outcomes are recorded in the error ring', async () => {
  const service = makeService()
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  await service.confirmLaunch(plan.confirmToken)
  const errors = (await service.recentErrors()).errors
  assert.ok(errors.length >= 1)
  const last = errors[errors.length - 1]
  assert.equal(last.action, 'launch')
  assert.equal(last.status, 'ok')
})

// ---------------------------------------------------------------------------
// allowedGpuUuids and dual-GPU
// ---------------------------------------------------------------------------

test('planLaunch refuses when profile GPU UUID is not in the allowed GPU list', async () => {
  // Default allowedGpuUuids = [caseGpuUuid]; a third UUID is refused.
  const config = Config['~standard'].validate({
    ...BASE_CONFIG,
    models: BASE_CONFIG.models,
    launchProfiles: [{
      profileId: 'p-unknown-gpu',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-UNKNOWN-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Unknown GPU test',
    }],
  }).value
  const service = makeService({ config })
  const plan = await service.planLaunch('p-unknown-gpu')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not in the allowed GPU list/)
  assert.match(plan.reason, /GPU-UNKNOWN-UUID/)
})

test('planLaunch allows gpuMode "both" when both UUIDs are in allowedGpuUuids', async () => {
  const config = Config['~standard'].validate({
    ...BASE_CONFIG,
    models: BASE_CONFIG.models,
    allowedGpuUuids: ['GPU-CASE-UUID', 'GPU-SECONDARY-UUID'],
    launchProfiles: [{
      profileId: 'p-dual',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID', 'GPU-SECONDARY-UUID'],
      gpuMode: 'both',
      launchArgs: [],
      label: 'Dual GPU test',
    }],
  }).value
  const service = makeService({ config })
  const plan = await service.planLaunch('p-dual')
  assert.equal(plan.status, 'planned')
  assert.deepEqual(plan.gpuUuids, ['GPU-CASE-UUID', 'GPU-SECONDARY-UUID'])
  assert.equal(plan.gpuMode, 'both')
})

test('confirmLaunch includes profile launchArgs in the launcher argv', async () => {
  const capturedArgv = []
  const service = makeService({ spawn: makeSpawn((argv) => capturedArgv.push(...argv)) })
  // profile-a has launchArgs: ['--flash-attn', 'on']
  const plan = await service.planLaunch('profile-a')
  assert.equal(plan.status, 'planned')
  await service.confirmLaunch(plan.confirmToken)
  assert.ok(capturedArgv.includes('--flash-attn'), `expected profile launch args in argv, got: ${capturedArgv.join(' ')}`)
  assert.ok(capturedArgv.includes('on'), `expected profile launch arg value in argv, got: ${capturedArgv.join(' ')}`)
})

test('confirmLaunch sets CUDA_VISIBLE_DEVICES to comma-joined profile GPU UUIDs for dual GPU', async () => {
  let capturedEnv = null
  const customSpawn = (_path, _argv, opts) => {
    capturedEnv = opts?.env ?? null
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
    return child
  }
  const config = Config['~standard'].validate({
    ...BASE_CONFIG,
    models: BASE_CONFIG.models,
    allowedGpuUuids: ['GPU-CASE-UUID', 'GPU-SECONDARY-UUID'],
    launchProfiles: [{
      profileId: 'p-dual-env',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID', 'GPU-SECONDARY-UUID'],
      gpuMode: 'both',
      launchArgs: [],
      label: 'Dual GPU env test',
    }],
  }).value
  const service = makeService({ config, spawn: customSpawn })
  const plan = await service.planLaunch('p-dual-env')
  assert.equal(plan.status, 'planned')
  await service.confirmLaunch(plan.confirmToken)
  assert.equal(capturedEnv?.CUDA_VISIBLE_DEVICES, 'GPU-CASE-UUID,GPU-SECONDARY-UUID')
})

// ---------------------------------------------------------------------------
// Manual GPU launch reservations: empty by default, generic reserve/release
// ---------------------------------------------------------------------------

// Config with BOTH GPU UUIDs in allowedGpuUuids for reservation-gate tests.
const BASE_CONFIG_WITH_PROT_ALLOWED = Config['~standard'].validate({
  ...BASE_CONFIG,
  models: BASE_CONFIG.models,
  allowedGpuUuids: ['GPU-CASE-UUID', 'GPU-PROT-UUID'],
  launchProfiles: [
    ...BASE_CONFIG.launchProfiles,
    {
      profileId: 'profile-prot-allowed',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-PROT-UUID'],
      gpuMode: 'single',
      launchArgs: [],
      label: 'Model A — RTX 3090 Ti',
    },
    {
      profileId: 'profile-both-allowed',
      engineId: 'llama.cpp',
      engineVersion: 'b5561',
      modelKey: 'a',
      gpuUuids: ['GPU-CASE-UUID', 'GPU-PROT-UUID'],
      gpuMode: 'both',
      launchArgs: [],
      label: 'Model A — Both GPUs',
    },
  ],
}).value

test('planLaunch plans a Ti-only profile directly — no GPU is reserved by default', async () => {
  // Policy 2026-10-23: absence of reservation state means unreserved; the RTX
  // 3090 Ti is the preferred launch target and needs no release step.
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED })
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned')
  assert.deepEqual(plan.gpuUuids, ['GPU-PROT-UUID'])
})

test('a manual lock refuses profiles targeting that GPU until the owner releases it', async () => {
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED })
  // Owner reserves the Ti through the generic two-step reservation flow.
  const reservePlan = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'reserved' })
  assert.equal(reservePlan.status, 'planned')
  const reserveResult = await service.confirmGpuReservation(reservePlan.confirmToken)
  assert.equal(reserveResult.status, 'ok')
  assert.equal((await service.snapshot()).gpus.find((g) => g.uuid === 'GPU-PROT-UUID').launchReserved, true)
  // The Ti-only profile is refused while the manual reservation holds.
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /RTX 3090 Ti/)
  assert.match(plan.reason, /reserved manually/)
  assert.match(plan.reason, /GPU-PROT-UUID/)
  // A failed launch attempt must not change the reservation on its own.
  assert.equal(service.actions.isGpuReserved('GPU-PROT-UUID'), true)
  // Owner releases it; the launch then plans without any interference.
  const releasePlan = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'unreserved' })
  assert.equal(releasePlan.status, 'planned')
  const releaseResult = await service.confirmGpuReservation(releasePlan.confirmToken)
  assert.equal(releaseResult.status, 'ok')
  const after = await service.planLaunch('profile-prot-allowed')
  assert.equal(after.status, 'planned')
  assert.deepEqual(after.gpuUuids, ['GPU-PROT-UUID'])
})

test('planLaunch refuses a both-GPU profile while the owner holds a manual reservation on either GPU', async () => {
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED })
  const reservePlan = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'reserved' })
  await service.confirmGpuReservation(reservePlan.confirmToken)
  const plan = await service.planLaunch('profile-both-allowed')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /reserved manually/)
})

test('planLaunch allows a both-GPU profile when no reservation exists and pins both UUIDs to the environment', async () => {
  let capturedEnv = null
  const customSpawn = (_path, _argv, opts) => {
    capturedEnv = opts?.env ?? null
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
    return child
  }
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED, spawn: customSpawn })
  const plan = await service.planLaunch('profile-both-allowed')
  assert.equal(plan.status, 'planned')
  assert.deepEqual(plan.gpuUuids, ['GPU-CASE-UUID', 'GPU-PROT-UUID'])
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'ok')
  assert.equal(capturedEnv?.CUDA_VISIBLE_DEVICES, 'GPU-CASE-UUID,GPU-PROT-UUID')
})

test('planLaunch refuses the Ti UUID not in allowedGpuUuids even with no reservation', async () => {
  // BASE_CONFIG default allowedGpuUuids is [GPU-CASE-UUID]; no GPU is reserved
  // by default, so the refusal must come from the allowlist boundary.
  const service = makeService()
  const plan = await service.planLaunch('profile-prot')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not in the allowed GPU list/)
  assert.match(plan.reason, /GPU-PROT-UUID/)
})

test('planGpuReservation refuses unknown UUIDs, no-op directions, and invalid states', async () => {
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED })
  const unknown = await service.planGpuReservation({ uuid: 'GPU-OTHER', desired: 'reserved' })
  assert.equal(unknown.status, 'refused')
  const duplicate = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'unreserved' })
  assert.equal(duplicate.status, 'refused')
  assert.match(duplicate.reason, /not reserved.*(no GPU is reserved automatically)/)
  const invalidState = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'toggle' })
  assert.equal(invalidState.status, 'refused')
  assert.match(invalidState.reason, /only "reserved" and "unreserved"/)
})

test('confirmGpuReservation persists the manual lock durably and a fresh service instance reads it back', async () => {
  const { writeFile, readFile: fsReadFile, mkdtemp, unlink } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'lmm-gpu-state-'))
  const statePath = join(dir, 'gpu-launch-state.json')
  const config = { ...BASE_CONFIG_WITH_PROT_ALLOWED, gpuLaunchStatePath: statePath }
  const service = makeService({ config })
  const reservePlan = await service.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'reserved' })
  const reserveResult = await service.confirmGpuReservation(reservePlan.confirmToken)
  assert.equal(reserveResult.status, 'ok')
  assert.equal(reserveResult.persisted, true)
  const onDisk = JSON.parse(await fsReadFile(statePath, 'utf8'))
  assert.equal(onDisk.version, 1)
  assert.deepEqual(onDisk.reservations, ['GPU-PROT-UUID'])
  // A "restarted" service instance with the same config reads the same state:
  // the owner-set reservation is honored, and nothing else appears.
  const restarted = makeService({ config })
  assert.equal((await restarted.snapshot()).gpus.find((g) => g.uuid === 'GPU-PROT-UUID').launchReserved, true)
  assert.equal((await restarted.snapshot()).gpus.find((g) => g.uuid === 'GPU-CASE-UUID').launchReserved, false)
  // Unlock persists too and does not reappear.
  const releasePlan = await restarted.planGpuReservation({ uuid: 'GPU-PROT-UUID', desired: 'unreserved' })
  await restarted.confirmGpuReservation(releasePlan.confirmToken)
  const afterUnlock = JSON.parse(await fsReadFile(statePath, 'utf8'))
  assert.deepEqual(afterUnlock.reservations, [])
  assert.equal(service.actions.isGpuReserved('GPU-PROT-UUID'), false)
  await unlink(statePath).catch(() => {})
})

test('an absent or unreadable GPU launch state file means every GPU is unreserved', async () => {
  const { mkdtemp, unlink, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'lmm-gpu-state-missing-'))
  const config = { ...BASE_CONFIG_WITH_PROT_ALLOWED, gpuLaunchStatePath: join(dir, 'does-not-exist.json') }
  const service = makeService({ config })
  const snap = await service.snapshot()
  for (const gpu of snap.gpus) assert.equal(gpu.launchReserved, false)
  // A malformed file also degrades to unreserved (loud recording), never to a reservation.
  await writeFile(join(dir, 'does-not-exist.json'), 'not-json{')
  const service2 = makeService({ config })
  const snap2 = await service2.snapshot()
  for (const gpu of snap2.gpus) assert.equal(gpu.launchReserved, false)
  await unlink(join(dir, 'does-not-exist.json')).catch(() => {})
})

test('confirmLaunch pins CUDA_VISIBLE_DEVICES to the Ti UUID for a Ti-only profile', async () => {
  let capturedEnv = null
  const customSpawn = (_path, _argv, opts) => {
    capturedEnv = opts?.env ?? null
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
    return child
  }
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED, spawn: customSpawn })
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned')
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'ok')
  assert.equal(capturedEnv?.CUDA_VISIBLE_DEVICES, 'GPU-PROT-UUID',
    'Ti-only profile must pin CUDA_VISIBLE_DEVICES to the Ti UUID')
})

test('plain confirmAction pins CUDA_VISIBLE_DEVICES to the preferred launch GPU (Ti by default)', async () => {
  let capturedEnv = null
  const customSpawn = (_path, _argv, opts) => {
    capturedEnv = opts?.env ?? null
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
    return child
  }
  const service = makeService({ config: BASE_CONFIG_WITH_PROT_ALLOWED, spawn: customSpawn })
  const plan = await service.planAction('start', { modelKey: 'a' })
  assert.equal(plan.status, 'planned')
  const result = await service.confirmAction(plan.confirmToken)
  assert.equal(result.status, 'ok')
  // preferredLaunchGpuUuid defaults to the Ti UUID; every start/switch pins it.
  assert.equal(capturedEnv?.CUDA_VISIBLE_DEVICES, 'GPU-PROT-UUID')
})

// ---------------------------------------------------------------------------
// planLaunch/confirmLaunch — multi-instance per-slot probe routing (Job 16)
// ---------------------------------------------------------------------------

// Config with instances: GPU-CASE-UUID → port 8001, GPU-PROT-UUID → port 8002.
const MULTI_INSTANCE_CONFIG = Config['~standard'].validate({
  ...BASE_CONFIG_WITH_PROT_ALLOWED,
  candidateLauncherPath: '/x/candidate/dsh-model-server',
  instances: [
    { port: 8001, gpuUuid: 'GPU-CASE-UUID', gpuName: 'RTX 3090 — Case' },
    { port: 8002, gpuUuid: 'GPU-PROT-UUID', gpuName: 'RTX 3090 Ti' },
  ],
}).value

const multiServer = (state, ggufPath = '/m/a.gguf') =>
  state === 'stopped'
    ? { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
    : { state: 'running', modelPath: ggufPath, slots: [], busy: false, busyUnknown: false }

test('planLaunch probes only the target instance slot when the profile maps to a configured instance', async () => {
  const calls = { 8001: 0, 8002: 0, global: 0 }
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => { calls.global++; return Promise.resolve(multiServer('running')) },
    probeInstances: {
      8001: () => { calls[8001]++; return Promise.resolve(multiServer('running')) },
      8002: () => { calls[8002]++; return Promise.resolve(multiServer('stopped')) },
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
  })
  // profile-prot-allowed targets GPU-PROT-UUID → instance port 8002 (stopped)
  // Even though port 8001 (global) is running, the plan should succeed.
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned', 'should plan: port 8002 is stopped even though port 8001 is running')
  assert.equal(calls[8002], 1, 'should probe port 8002 (the target slot)')
  assert.equal(calls[8001], 0, 'must not probe port 8001 (the other slot)')
  assert.equal(calls.global, 0, 'must not probe the global endpoint')
})

test('planLaunch allows launching the same model on a second slot when that slot is stopped', async () => {
  // Port 8001 running model A; port 8002 stopped. Launch model A on port 8002 must succeed.
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => Promise.resolve(multiServer('running', '/m/a.gguf')),
    probeInstances: {
      8001: () => Promise.resolve(multiServer('running', '/m/a.gguf')),
      8002: () => Promise.resolve(multiServer('stopped')),
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
  })
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned')
})

test('planLaunch refuses when the target slot is already running the requested model', async () => {
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => Promise.resolve(multiServer('stopped')),
    probeInstances: {
      8001: () => Promise.resolve(multiServer('stopped')),
      8002: () => Promise.resolve(multiServer('running', '/m/a.gguf')),
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
  })
  // profile-prot-allowed: model a, targets port 8002 (already running model a)
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /already the running model/)
})

test('planLaunch refuses when the target slot is running a different model', async () => {
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => Promise.resolve(multiServer('stopped')),
    probeInstances: {
      8001: () => Promise.resolve(multiServer('stopped')),
      8002: () => Promise.resolve(multiServer('running', '/m/b.gguf')),
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
  })
  // profile-prot-allowed: model a, target port 8002 running model b
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /another model is running/)
  assert.match(plan.reason, /port 8002/)
})

test('planLaunch uses the global probe for a both-GPU profile (no targetInstance)', async () => {
  const calls = { 8001: 0, 8002: 0, global: 0 }
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => { calls.global++; return Promise.resolve(multiServer('stopped')) },
    probeInstances: {
      8001: () => { calls[8001]++; return Promise.resolve(multiServer('stopped')) },
      8002: () => { calls[8002]++; return Promise.resolve(multiServer('stopped')) },
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
  })
  // profile-both-allowed has gpuMode 'both' — targetInstance is null
  const plan = await service.planLaunch('profile-both-allowed')
  assert.equal(plan.status, 'planned')
  assert.ok(calls.global > 0, 'both-GPU profile must use the global probe')
  assert.equal(calls[8001], 0, 'must not probe specific instances for both-GPU profile')
  assert.equal(calls[8002], 0, 'must not probe specific instances for both-GPU profile')
})

test('confirmLaunch uses candidateLauncherPath and injects instance env vars for a per-instance profile', async () => {
  const spawned = []
  const customSpawn = (file, argv, opts) => {
    spawned.push({ file, argv, env: opts?.env })
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
      kill: () => {},
    }
  }
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => Promise.resolve(multiServer('running', '/m/a.gguf')),
    probeInstances: {
      8001: () => Promise.resolve(multiServer('running', '/m/a.gguf')),
      8002: () => Promise.resolve(multiServer('stopped')),
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
    spawn: customSpawn,
  })
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned')
  const result = await service.confirmLaunch(plan.confirmToken)
  assert.equal(result.status, 'ok')
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].file, MULTI_INSTANCE_CONFIG.candidateLauncherPath,
    'must use candidateLauncherPath for per-instance launch')
  assert.equal(spawned[0].env?.MODEL_SERVER_PORT, '8002',
    'must inject MODEL_SERVER_PORT for the target slot')
  assert.equal(spawned[0].env?.MODEL_SERVER_GPU_UUID, 'GPU-PROT-UUID',
    'must inject MODEL_SERVER_GPU_UUID for the target slot')
  assert.equal(spawned[0].env?.CUDA_VISIBLE_DEVICES, 'GPU-PROT-UUID',
    'must pin CUDA_VISIBLE_DEVICES to the target GPU UUID')
})

test('confirmLaunch probes only the target slot before executing, not the global endpoint', async () => {
  const calls = { 8001: 0, 8002: 0, global: 0 }
  const customSpawn = (_file, _argv, _opts) => ({
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (_event, cb) => { if (_event === 'close') Promise.resolve().then(() => cb(0)) },
    kill: () => {},
  })
  const service = makeService({
    config: MULTI_INSTANCE_CONFIG,
    probe: () => { calls.global++; return Promise.resolve(multiServer('stopped')) },
    probeInstances: {
      8001: () => { calls[8001]++; return Promise.resolve(multiServer('running', '/m/a.gguf')) },
      8002: () => { calls[8002]++; return Promise.resolve(multiServer('stopped')) },
    },
    modelByKey: (key) => MULTI_INSTANCE_CONFIG.models.find((m) => m.key === key),
    spawn: customSpawn,
  })
  const plan = await service.planLaunch('profile-prot-allowed')
  assert.equal(plan.status, 'planned')
  // Reset counters before confirmLaunch to isolate its probe calls.
  calls[8001] = 0; calls[8002] = 0; calls.global = 0
  await service.confirmLaunch(plan.confirmToken)
  assert.ok(calls[8002] >= 1, 'must probe target slot 8002 at least once (re-check before execute)')
  assert.equal(calls[8001], 0, 'must not probe port 8001 during confirm')
  assert.equal(calls.global, 0, 'must not probe global endpoint during confirm')
})
