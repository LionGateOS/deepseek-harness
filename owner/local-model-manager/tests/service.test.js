/**
 * Service surface coverage: the merged snapshot (models, GPUs, server, error
 * ring), the protected GPU row and its explicit unavailability, provider/
 * launcher mismatch reporting, the bounded error ring, and the exact Typert
 * remote contract the client mounts against.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalModelManagerService, Config } from '../index.js'
import { parseComputeAppLine, queryGpus } from '../core/gpus.js'
import { readProviderFacts } from '../core/catalog.js'

const CONFIG = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'mystery', name: 'Mystery', ggufPath: '/m/missing.gguf', switchName: 'mystery', engineBinary: 'stable' },
  ],
}).value

const CONFIG_WITH_DISCOVERY = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'mystery', name: 'Mystery', ggufPath: '/m/missing.gguf', switchName: 'mystery', engineBinary: 'stable' },
  ],
  discoveryDirs: ['/fake/gguf'],
  discoveryResultsPath: '/fake/gguf-discovery-cache.json',
}).value

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Injected read-only GPU query: both cards visible, protected card busy. */
const gpuStub = async () => ({ status: 'ok', gpus: [
  { uuid: 'GPU-CASE', name: 'RTX 3090 — Case', index: 0, memUsedMiB: 18743, memTotalMiB: 24576, utilizationPct: 42, powerDrawW: 305.2, powerLimitW: 350 },
  { uuid: 'GPU-TI', name: 'RTX 3090 Ti', index: 1, memUsedMiB: 23000, memTotalMiB: 24576, utilizationPct: 97, powerDrawW: 421.09, powerLimitW: 450 },
], processes: [{ uuid: 'GPU-TI', pid: 999, processName: 'gdbible', memUsedMiB: 22000 }] })

/** stat stub: only model A's file exists on disk. */
const statStub = async (path) => {
  if (path === '/m/a.gguf') return { isFile: () => true, size: 29360128000 }
  const error = new Error('x')
  error.code = 'ENOENT'
  throw error
}

const CONFIG_WITH_USER_DIRS = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'mystery', name: 'Mystery', ggufPath: '/m/missing.gguf', switchName: 'mystery', engineBinary: 'stable' },
  ],
  discoveryDirs: ['/fake/gguf'],
  discoveryResultsPath: '/fake/gguf-discovery-cache.json',
  userDiscoveryDirsPath: '/fake/user-discovery-dirs.json',
}).value

/** A service built over stub data sources, no real disk, network, or GPU. */
const makeService = (overrides = {}) => {
  const state = {
    config: CONFIG,
    probe: () => Promise.resolve({ state: 'running', modelPath: '/m/a.gguf', liveContext: 32768, slots: [{ id: 0, n_ctx: 32768, isProcessing: false }], busy: false, busyUnknown: false }),
    readProviderFacts: () => Promise.resolve({
      status: 'ok', source: 'provider-config',
      byPath: { '/m/a.gguf': { contextWindow: 65536, reasoningEfforts: ['low', 'high'], input: ['text'] } },
    }),
    queryGpus: gpuStub,
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
    stat: statStub,
    spawn: undefined, access: undefined,
    readGgufMeta: async () => ({ status: 'unavailable', error: 'GGUF metadata not invoked in tests' }),
    modelByKey: (key) => CONFIG.models.find((m) => m.key === key),
    detectVllm: () => Promise.resolve('detected'),
    buildDiscovery: async () => null,
    writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: [] }),
    writeUserDirs: async () => {},
    // V2A: Model Advisor data stub (offline, no real CLI invocation)
    getModelAdvisorData: () => Promise.resolve({
      hardware: { status: 'unavailable', error: 'Model Advisor not invoked in tests' },
      runtimes: { status: 'unavailable', error: 'Model Advisor not invoked in tests' },
      compatibility: { status: 'unavailable', error: 'Model Advisor not invoked in tests' },
    }),
    ...overrides,
  }
  return createLocalModelManagerService(state)
}

test('the remote surface is exactly fourteen methods with SRC markers', () => {
  const service = makeService()
  assert.deepEqual(service.typertRemote, { service, serviceKey: 'localModelManager', namespace: 'localModelManager' })
  const marker = Object.getOwnPropertyDescriptor(service.constructor.prototype, REMOTE_METHOD_DESCRIPTOR).value
  assert.deepEqual([...marker.methods.map((m) => m.method)], ['snapshot', 'energyWindow', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'planStrataAction', 'confirmStrataAction', 'planGpuLock', 'confirmGpuLock', 'planGpuReservation', 'confirmGpuReservation', 'addDiscoveryDir', 'planAdoptInstance', 'confirmAdoptInstance'])
  assert.ok(marker.methods.every((m) => m.invocation.kind === 'direct'))
})

test('snapshot merges verified facts and labels unverified ones', async () => {
  const service = makeService({
    detectVllm: () => Promise.resolve('absent'),
  })
  const snap = await service.snapshot()
  assert.equal(snap.server.state, 'running')
  assert.equal(snap.server.runningModelKey, 'a')
  assert.equal(snap.server.liveContext, 32768)
  assert.equal(snap.server.busy, false)
  const a = snap.models.find((m) => m.key === 'a')
  assert.equal(a.installed, true)
  assert.equal(a.diskBytes, 29360128000)
  assert.equal(a.configContext, 65536)
  assert.equal(a.liveContext, 32768) // the running model match reports the live slot context
  assert.equal(a.runtime, 'running')
  assert.deepEqual(a.reasoningEfforts, ['low', 'high'])
  assert.equal(a.gpu.uuid, 'GPU-CASE')
  const mystery = snap.models.find((m) => m.key === 'mystery')
  assert.equal(mystery.installed, false)
  assert.match(mystery.installProblem, /not found/)
  assert.equal(mystery.configContext, undefined)
  assert.match(mystery.providerStatus, /not listed in the active provider configuration/)
  assert.equal(mystery.runtime, 'stopped')
})

test('the GPU rows always exist with config-defined identity and live facts', async () => {
  const snap = await makeService().snapshot()
  assert.equal(snap.gpuQueryStatus, 'ok')
  const [tiGpu, caseGpu] = snap.gpus
  assert.equal(tiGpu.preferredLaunchTarget, true)
  assert.equal(tiGpu.memUsedMiB, 23000)
  assert.equal(tiGpu.memTotalMiB, 24576)
  assert.deepEqual(tiGpu.processes, [{ pid: 999, processName: 'gdbible', memUsedMiB: 22000 }])
  assert.equal(tiGpu.launchReserved, false, 'no reservation exists without an owner lock')
  assert.equal(caseGpu.preferredLaunchTarget, false)
  assert.equal(caseGpu.status, 'ok')
  assert.equal(caseGpu.name, 'RTX 3090 — Case')
  assert.deepEqual(caseGpu.memUsedMiB, 18743)
  assert.equal(tiGpu.powerDrawW, 421.09, 'the Ti row keeps its own live reading')
  assert.equal(tiGpu.powerLimitW, 450)
  assert.equal(caseGpu.powerDrawW, 305.2)
  assert.equal(caseGpu.powerLimitW, 350)
  assert.ok(snap.models.every((m) => m.gpu.role === 'case'))
  const vllm = snap.backends.find((b) => b.id === 'vllm')
  assert.equal(vllm.status, 'not-configured')
})

test('actionsAvailable.multipleJobs reflects verified slot support from the launcher parallel-mode file', async () => {
  // Injected reader returns "4": parallel mode → multipleJobs: true
  const parallelSnap = await makeService({ readSlotsFile: () => '4' }).snapshot()
  assert.equal(parallelSnap.actionsAvailable.multipleJobs, true, 'mode 4 must enable multipleJobs')

  // Injected reader returns "1": single-slot → multipleJobs: false
  const singleSnap = await makeService({ readSlotsFile: () => '1' }).snapshot()
  assert.equal(singleSnap.actionsAvailable.multipleJobs, false, 'mode 1 must disable multipleJobs')

  // Injected reader returns null: unreadable → multipleJobs: false (fail-closed)
  const unknownSnap = await makeService({ readSlotsFile: () => null }).snapshot()
  assert.equal(unknownSnap.actionsAvailable.multipleJobs, false, 'unreadable mode file must disable multipleJobs (fail-closed)')
})

test('an unavailable GPU query still keeps both configured rows unreserved', async () => {
  const snap = await makeService({ queryGpus: async () => ({ status: 'unavailable', error: 'nvidia-smi unavailable' }) }).snapshot()
  assert.equal(snap.gpuQueryStatus, 'unavailable')
  assert.match(snap.gpuQueryError, /unavailable/)
  const tiGpu = snap.gpus.find((g) => g.uuid === 'GPU-TI')
  assert.equal(tiGpu.status, 'unavailable')
  assert.equal(tiGpu.uuid, 'GPU-TI')
  assert.equal(tiGpu.launchReserved, false, 'a dead query must not manufacture a reservation')
  assert.match(tiGpu.error, /unavailable/)
  assert.equal(tiGpu.powerDrawW, null, 'a dead query reports no wattage rather than a stale or guessed value')
  assert.equal(tiGpu.powerLimitW, null)
})

test('a visible card whose driver reports no wattage keeps null and every other fact', async () => {
  const snap = await makeService({
    queryGpus: async () => ({ status: 'ok', gpus: [
      { uuid: 'GPU-CASE', name: 'RTX 3090 — Case', index: 0, memUsedMiB: 18743, memTotalMiB: 24576, utilizationPct: 42, powerDrawW: null, powerLimitW: null },
      { uuid: 'GPU-TI', name: 'RTX 3090 Ti', index: 1, memUsedMiB: 23000, memTotalMiB: 24576, utilizationPct: 97, powerDrawW: null, powerLimitW: 450 },
    ], processes: [] }),
  }).snapshot()
  const tiGpu = snap.gpus.find((g) => g.uuid === 'GPU-TI')
  assert.equal(tiGpu.status, 'ok', 'an unsupported wattage reading must not fail the card')
  assert.equal(tiGpu.powerDrawW, null)
  assert.equal(tiGpu.powerLimitW, 450, 'a readable limit survives a missing draw')
  assert.equal(tiGpu.memUsedMiB, 23000)
  assert.equal(tiGpu.utilizationPct, 97)
  assert.equal(tiGpu.launchReserved, false)
  const caseGpu = snap.gpus.find((g) => g.uuid === 'GPU-CASE')
  assert.equal(caseGpu.powerDrawW, null)
  assert.equal(caseGpu.powerLimitW, null)
})

test('a non-finite wattage reading never reaches the snapshot', async () => {
  const snap = await makeService({
    queryGpus: async () => ({ status: 'ok', gpus: [
      { uuid: 'GPU-CASE', name: 'RTX 3090 — Case', memUsedMiB: 18743, memTotalMiB: 24576, powerDrawW: Number.NaN, powerLimitW: Number.POSITIVE_INFINITY },
      { uuid: 'GPU-TI', name: 'RTX 3090 Ti', memUsedMiB: 23000, memTotalMiB: 24576 },
    ], processes: [] }),
  }).snapshot()
  for (const gpu of snap.gpus) {
    if (gpu.powerDrawW !== null) assert.ok(Number.isFinite(gpu.powerDrawW), 'a draw is a finite number or null')
    if (gpu.powerLimitW !== null) assert.ok(Number.isFinite(gpu.powerLimitW), 'a limit is a finite number or null')
  }
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-CASE').powerDrawW, null)
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-CASE').powerLimitW, null)
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-TI').powerDrawW, null, 'an absent field becomes an explicit null')
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-TI').powerLimitW, null)
})

test('operational outcomes feed the bounded recent-error ring and recentErrors', async () => {
  const service = makeService()
  await service.planAction('reboot')
  const refused = await service.planAction('start', { modelKey: 'unheard' })
  assert.equal(refused.status, 'refused')
  await service.planAction('stop') // refused: busy unknown? probe returns idle → planned? state running & readable → planned
  const first = (await service.recentErrors()).errors
  assert.ok(first.length >= 1)
  // Ring bound: many outcomes keep only maxErrorRecords entries.
  for (let i = 0; i < 5; i++) await service.planAction('reboot')
  const bounded = (await service.recentErrors()).errors
  assert.equal(bounded.length, 2)
  const snapshot = await service.snapshot()
  assert.deepEqual(snapshot.errors.length, 2)
})

test('snapshot includes discovery field when discoveryDirs is configured', async () => {
  const discoveryStub = { version: 1, generatedAt: '2026-10-22T00:00:00.000Z', roots: [{ root: '/fake/gguf', status: 'ok', candidates: [], subdirErrors: [], truncated: false }] }
  const service = makeService({
    config: CONFIG_WITH_DISCOVERY,
    modelByKey: (key) => CONFIG_WITH_DISCOVERY.models.find((m) => m.key === key),
    buildDiscovery: async () => discoveryStub,
    writeDiscovery: async () => {},
  })
  const snap = await service.snapshot()
  assert.deepEqual(snap.discovery, discoveryStub)
})

test('snapshot omits discovery field when discoveryDirs is empty', async () => {
  const snap = await makeService().snapshot()
  assert.equal(snap.discovery, undefined, 'discovery must be absent when no dirs are configured')
})

test('writeDiscovery failure is recorded in the error ring and does not fail snapshot', async () => {
  const service = makeService({
    config: CONFIG_WITH_DISCOVERY,
    modelByKey: (key) => CONFIG_WITH_DISCOVERY.models.find((m) => m.key === key),
    buildDiscovery: async () => ({ version: 1, generatedAt: 't', roots: [] }),
    writeDiscovery: async () => { throw new Error('disk full') },
  })
  // snapshot must complete without throwing
  const snap = await service.snapshot()
  assert.equal(snap.discovery?.version, 1)
  // Allow the fire-and-forget rejection to be caught before checking the ring.
  await new Promise((resolve) => setTimeout(resolve, 20))
  const { errors } = await service.recentErrors()
  const writeError = errors.find((e) => e.action === 'discovery-write')
  assert.ok(writeError !== undefined, 'write failure must be recorded in the error ring')
  assert.match(writeError.detail, /disk full/)
})

test('snapshot includes computeMode, launchReserved, and preferredLaunchTarget fields — nothing reserved by default', async () => {
  const snap = await makeService().snapshot()
  const [tiGpu, caseGpu] = snap.gpus
  assert.equal(caseGpu.computeMode, 'unlocked')
  assert.equal(caseGpu.computeModeStatus, 'ok')
  assert.equal(caseGpu.launchReserved, false, 'no GPU is reserved without an owner lock')
  assert.equal(tiGpu.computeMode, 'unlocked')
  assert.equal(tiGpu.computeModeStatus, 'ok')
  assert.equal(tiGpu.launchReserved, false, 'the RTX 3090 Ti is also unreserved by default')
  assert.equal(tiGpu.preferredLaunchTarget, true, 'Ti is the preferred launch target')
  assert.equal(caseGpu.preferredLaunchTarget, false)
  assert.equal(snap.protectedGpuReserved, undefined, 'the legacy auto-reservation flag is gone')
  // Order: the preferred (Ti) GPU row comes first, the RTX 3090 second.
  assert.deepEqual(snap.gpus.map((g) => g.uuid), ['GPU-TI', 'GPU-CASE'])
})

test('planGpuLock refuses a UUID not in the allowlist', async () => {
  const service = makeService()
  const result = await service.planGpuLock('GPU-UNKNOWN', 'locked')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /allowlist/)
})

test('planGpuLock returns a planned token for an allowlisted UUID', async () => {
  const service = makeService({
    queryComputeMode: async () => ({ status: 'ok', mode: 'unlocked' }),
  })
  const result = await service.planGpuLock('GPU-CASE', 'locked')
  assert.equal(result.status, 'planned')
  assert.equal(result.uuid, 'GPU-CASE')
  assert.equal(result.desiredState, 'locked')
  assert.ok(typeof result.confirmToken === 'string' && result.confirmToken.length > 0)
  assert.ok(Array.isArray(result.disclosure) && result.disclosure.length > 0)
})

test('confirmGpuLock refuses a stale or unknown token', async () => {
  const service = makeService()
  const result = await service.confirmGpuLock('tok-does-not-exist')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /expired|never issued/)
})

test('confirmGpuLock applies the change and records the outcome', async () => {
  let modeStore = 'unlocked'
  const queryFn = async () => ({ status: 'ok', mode: modeStore })
  const applyFn = async (uuid, desiredState) => {
    modeStore = desiredState
    return { status: 'ok', output: 'All done.', exitCode: 0, stdout: 'All done.', stderr: '' }
  }
  const service = makeService({
    queryComputeMode: queryFn,
    applyComputeMode: applyFn,
  })
  const plan = await service.planGpuLock('GPU-CASE', 'locked')
  assert.equal(plan.status, 'planned')
  const outcome = await service.confirmGpuLock(plan.confirmToken)
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.actualMode, 'locked')
  // Token is single-use: second confirm is refused.
  const repeat = await service.confirmGpuLock(plan.confirmToken)
  assert.equal(repeat.status, 'refused')
})

test('planGpuReservation refuses a release when nothing is reserved — the no-auto-default proof', async () => {
  const service = makeService()
  const plan = await service.planGpuReservation({ uuid: 'GPU-TI', desired: 'unreserved' })
  assert.equal(plan.status, 'refused')
  assert.match(plan.reason, /not reserved/)
  assert.match(plan.reason, /no GPU is reserved automatically/)
  assert.match(plan.reason, /RTX 3090 Ti/)
})

test('manual lock plans and confirms; the snapshot shows it until the owner releases it', async () => {
  const service = makeService()
  assert.equal((await service.snapshot()).gpus.find((g) => g.uuid === 'GPU-TI').launchReserved, false)
  const plan = await service.planGpuReservation({ uuid: 'GPU-TI', desired: 'reserved' })
  assert.equal(plan.status, 'planned')
  assert.ok(typeof plan.confirmToken === 'string' && plan.confirmToken.length > 0)
  assert.ok(typeof plan.disclosure === 'string' && plan.disclosure.length > 0)
  const outcome = await service.confirmGpuReservation(plan.confirmToken)
  assert.equal(outcome.status, 'ok')
  assert.match(outcome.message, /persisted/)
  const snap = await service.snapshot()
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-TI').launchReserved, true)
  assert.equal(snap.gpus.find((g) => g.uuid === 'GPU-CASE').launchReserved, false)
  // Reserving again is refused as a no-op; releasing returns to unreserved.
  const dup = await service.planGpuReservation({ uuid: 'GPU-TI', desired: 'reserved' })
  assert.equal(dup.status, 'refused')
  const release = await service.planGpuReservation({ uuid: 'GPU-TI', desired: 'unreserved' })
  assert.equal((await service.confirmGpuReservation(release.confirmToken)).status, 'ok')
  assert.equal((await service.snapshot()).gpus.find((g) => g.uuid === 'GPU-TI').launchReserved, false, 'manual unlock removes the reservation; nothing re-adds it')
})

// Regression: GPU monitoring — field name fix
test('parseComputeAppLine parses the gpu_uuid column value as the first CSV column', () => {
  const line = 'GPU-4144e557-ad9a-83b3-014a-61f67141c547, 12345, llama-server, 15824'
  const row = parseComputeAppLine(line)
  assert.equal(row.uuid, 'GPU-4144e557-ad9a-83b3-014a-61f67141c547')
  assert.equal(row.pid, 12345)
  assert.equal(row.processName, 'llama-server')
  assert.equal(row.memUsedMiB, 15824)
})

test('queryGpus uses gpu_uuid and not uuid in the compute-apps query args', async () => {
  const calls = []
  const execFileSpy = async (_bin, args) => {
    calls.push(args[0])
    if (args[0]?.startsWith('--query-gpu')) return { stdout: '0, RTX 3090, GPU-CASE, 100, 24576, 10\n' }
    if (args[0]?.startsWith('--query-compute-apps')) return { stdout: '' }
    throw new Error(`unexpected nvidia-smi arg: ${args[0]}`)
  }
  await queryGpus(5000, { execFile: execFileSpy })
  const appsArg = calls.find((a) => a?.startsWith('--query-compute-apps'))
  assert.ok(appsArg !== undefined, 'compute-apps query was not called')
  assert.match(appsArg, /=gpu_uuid,/, 'compute-apps query must use gpu_uuid field')
  assert.doesNotMatch(appsArg, /^--query-compute-apps=uuid,/, 'invalid uuid field must not be present')
})

// Regression: provider facts — mixed-type YAML key fix
test('readProviderFacts handles reasoningEfforts dicts with mixed bool/str YAML keys', async () => {
  // Mirrors cloud models in the live provider config that use "false: none" in YAML,
  // which yaml.safe_load parses as {False: 'none', 'low': 'low', ...} (mixed key types).
  const yaml = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      cloud:',
    '        models:',
    '          - id: cloud-model-1',
    '            contextWindow: 100000',
    '            reasoningEfforts:',
    '              false: none',
    '              low: low',
    '              high: high',
    '          - id: /local/model.gguf',
    '            contextWindow: 65536',
    '            reasoningEfforts:',
    '              low: low',
    '              high: high',
  ].join('\n')
  const tmpFile = join(tmpdir(), `lmm-test-catalog-${Date.now()}.yaml`)
  await writeFile(tmpFile, yaml, 'utf8')
  try {
    const config = { providerPatchPath: tmpFile, settingsPath: '', probeTimeoutMs: 10000 }
    const result = await readProviderFacts(config)
    assert.equal(result.status, 'ok', `expected ok but got: ${result.error}`)
    // Bool key must be filtered; only string effort names returned.
    assert.deepEqual(result.byPath['cloud-model-1'].reasoningEfforts, ['high', 'low'])
    // Local model unaffected.
    assert.deepEqual(result.byPath['/local/model.gguf'].reasoningEfforts, ['high', 'low'])
    assert.equal(result.byPath['/local/model.gguf'].contextWindow, 65536)
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
})

test('readProviderFacts returns local GGUF model facts correctly when cloud models have mixed-key reasoningEfforts', async () => {
  // Mirrors the actual live provider patch: local gguf models and cloud models coexist;
  // cloud models use {false: none, low: low, ...} pattern; local models must not be affected.
  const yaml = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      qwen-local:',
    '        models:',
    '          - id: /models/gguf/Qwen3.5/Qwen_Qwen3.5-27B-Q5_K_M.gguf',
    '            contextWindow: 65536',
    '            reasoningEfforts:',
    '              low: low',
    '              medium: medium',
    '              high: high',
    '            defaultReasoningEffort: low',
    '      cloud-provider:',
    '        models:',
    '          - id: deepseek-v4-flash',
    '            contextWindow: 131072',
    '            reasoningEfforts:',
    '              false: none',
    '              low: low',
    '              high: high',
    '              max: max',
  ].join('\n')
  const tmpFile = join(tmpdir(), `lmm-test-catalog2-${Date.now()}.yaml`)
  await writeFile(tmpFile, yaml, 'utf8')
  try {
    const config = { providerPatchPath: tmpFile, settingsPath: '', probeTimeoutMs: 10000 }
    const result = await readProviderFacts(config)
    assert.equal(result.status, 'ok', `expected ok but got: ${result.error}`)
    const local = result.byPath['/models/gguf/Qwen3.5/Qwen_Qwen3.5-27B-Q5_K_M.gguf']
    assert.equal(local.contextWindow, 65536)
    assert.deepEqual(local.reasoningEfforts, ['high', 'low', 'medium'])
    const cloud = result.byPath['deepseek-v4-flash']
    assert.deepEqual(cloud.reasoningEfforts, ['high', 'low', 'max'])
    assert.equal(cloud.contextWindow, 131072)
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
})

// addDiscoveryDir and userDiscoveryDirs tests
test('snapshot includes userDiscoveryDirs when userDiscoveryDirsPath is configured', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    buildDiscovery: async () => ({ version: 1, generatedAt: 't', roots: [] }),
    writeDiscovery: async () => {},
    readUserDirs: async () => ({ dirs: ['/extra/models'] }),
  })
  const snap = await service.snapshot()
  assert.deepEqual(snap.userDiscoveryDirs, { dirs: ['/extra/models'] })
})

test('snapshot omits userDiscoveryDirs when userDiscoveryDirsPath is not configured', async () => {
  const snap = await makeService().snapshot()
  assert.equal(snap.userDiscoveryDirs, undefined, 'userDiscoveryDirs must be absent when not configured')
})

test('snapshot merges default and user-added discoveryDirs without scanning duplicates', async () => {
  const scannedDirs = []
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    buildDiscovery: async (dirs) => { scannedDirs.push(...dirs); return { version: 1, generatedAt: 't', roots: [] } },
    writeDiscovery: async () => {},
    // user dirs include a duplicate of the static dir plus a new one
    readUserDirs: async () => ({ dirs: ['/fake/gguf', '/user/models'] }),
  })
  await service.snapshot()
  // /fake/gguf appears in both static and user dirs but must only be scanned once
  assert.equal(scannedDirs.filter((d) => d === '/fake/gguf').length, 1, 'duplicate dir must be deduplicated')
  assert.ok(scannedDirs.includes('/user/models'), 'user-added dir must be included')
})

test('addDiscoveryDir refuses when userDiscoveryDirsPath is not configured', async () => {
  const result = await makeService().addDiscoveryDir('/some/path')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /userDiscoveryDirsPath/)
})

test('addDiscoveryDir refuses a non-absolute path', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
  })
  const result = await service.addDiscoveryDir('relative/path')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /absolute/)
})

test('addDiscoveryDir refuses a path that does not exist', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e },
  })
  const result = await service.addDiscoveryDir('/nonexistent/dir')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /does not exist|cannot be read/)
})

test('addDiscoveryDir refuses a path that is not a directory', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 100 }),
  })
  const result = await service.addDiscoveryDir('/some/file.gguf')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /not a directory/)
})

test('addDiscoveryDir refuses a directory already in the static discoveryDirs', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => ({ isDirectory: () => true, isFile: () => false }),
    readUserDirs: async () => ({ dirs: [] }),
  })
  const result = await service.addDiscoveryDir('/fake/gguf')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /already a configured/)
})

test('addDiscoveryDir refuses a directory already in user-added dirs', async () => {
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => ({ isDirectory: () => true, isFile: () => false }),
    readUserDirs: async () => ({ dirs: ['/user/already/here'] }),
  })
  const result = await service.addDiscoveryDir('/user/already/here')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, /already a configured/)
})

test('addDiscoveryDir persists the directory and returns the new list', async () => {
  const written = []
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => ({ isDirectory: () => true, isFile: () => false }),
    readUserDirs: async () => ({ dirs: ['/existing/user/dir'] }),
    writeUserDirs: async (dirs) => { written.push(dirs) },
  })
  const result = await service.addDiscoveryDir('/new/model/dir')
  assert.equal(result.status, 'added')
  assert.equal(result.dir, '/new/model/dir')
  assert.deepEqual(result.dirs, ['/existing/user/dir', '/new/model/dir'])
  assert.deepEqual(written[0], ['/existing/user/dir', '/new/model/dir'])
})

test('addDiscoveryDir enforces the MAX_USER_DIRS capacity limit', async () => {
  const { MAX_USER_DIRS } = await import('../core/user-dirs.js')
  const fullDirs = Array.from({ length: MAX_USER_DIRS }, (_, i) => `/dir/${i}`)
  const service = makeService({
    config: CONFIG_WITH_USER_DIRS,
    modelByKey: (key) => CONFIG_WITH_USER_DIRS.models.find((m) => m.key === key),
    stat: async () => ({ isDirectory: () => true, isFile: () => false }),
    readUserDirs: async () => ({ dirs: fullDirs }),
  })
  const result = await service.addDiscoveryDir('/one/more/dir')
  assert.equal(result.status, 'refused')
  assert.match(result.reason, new RegExp(String(MAX_USER_DIRS)))
})
// ---------------------------------------------------------------------------
// Automatic context selection
// ---------------------------------------------------------------------------

const CONFIG_WITH_CONTEXT = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'mystery', name: 'Mystery', ggufPath: '/m/missing.gguf', switchName: 'mystery', engineBinary: 'stable' },
  ],
  contextSelectionsPath: '/fake/context-selections.json',
  reservedOutputTokens: 8192,
  headroomTokens: 16384,
}).value

const CONFIG_WITH_CAPS = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  models: [
    { key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' },
    { key: 'mystery', name: 'Mystery', ggufPath: '/m/missing.gguf', switchName: 'mystery', engineBinary: 'stable' },
  ],
  hardwareContextCaps: { a: 32768 },
}).value

const serviceModelByKey = (config) => (key) => config.models.find((m) => m.key === key)

test('the snapshot resolves the context selection from every readable bound and exposes the DSH usable budget', async () => {
  const service = makeService({
    config: CONFIG_WITH_CONTEXT,
    modelByKey: serviceModelByKey(CONFIG_WITH_CONTEXT),
    readGgufMeta: async (path) => path === '/m/a.gguf'
      ? { status: 'ok', facts: { architecture: 'qwen35', contextLength: 262144 } }
      : { status: 'unavailable', error: 'missing file' },
  })
  const snap = await service.snapshot()
  const a = snap.models.find((m) => m.key === 'a')
  assert.equal(a.context.selected, 65536) // configured 65536 < advertised 262144; never raised automatically
  assert.equal(a.context.source, 'auto')
  assert.equal(a.context.advertised, 262144)
  assert.equal(a.context.configured, 65536)
  assert.equal(a.context.live, 32768) // the running server's real n_ctx stays visible
  assert.equal(a.context.dshUsable, 40960) // 65536 − 8192 output − 16384 headroom
  assert.deepEqual(a.context.reasons, [])
  const mystery = snap.models.find((m) => m.key === 'mystery')
  assert.equal(mystery.context.selected, undefined)
  assert.equal(mystery.context.source, 'unavailable')
  assert.match(mystery.context.reasons.join(' '), /no context evidence/)
})

test('a hardware cap forces a smaller practical context and the panel explains why', async () => {
  const service = makeService({
    config: CONFIG_WITH_CAPS,
    modelByKey: serviceModelByKey(CONFIG_WITH_CAPS),
  })
  const snap = await service.snapshot()
  const a = snap.models.find((m) => m.key === 'a')
  assert.equal(a.context.selected, 32768)
  assert.equal(a.context.hardwareCap, 32768)
  assert.ok(a.context.reasons.some((reason) => /hardware cap/.test(reason)))
  assert.ok(a.recommendations.some((note) => /hardware cap/.test(note)))
})

test('the first snapshot persists automatic selections and a restarted service keeps them', async () => {
  const { writeFile, readFile: fsReadFile, unlink } = await import('node:fs/promises')
  const selectionsPath = join(tmpdir(), `lmm-svc-selections-${process.pid}-${Date.now()}.json`)
  const config = { ...CONFIG_WITH_CONTEXT, contextSelectionsPath: selectionsPath }
  try {
    const first = makeService({
      config,
      modelByKey: serviceModelByKey(config),
      readGgufMeta: async (path) => ({ status: 'ok', facts: { contextLength: 65536 } }),
      stat: async (path) => path === '/m/a.gguf' ? { isFile: () => true, size: 1, mtimeMs: 123 } : Object.assign(new Error('x'), { code: 'ENOENT' }),
    })
    // snapshot writes through the real atomic writer
    const snap = await first.snapshot()
    const onDisk = JSON.parse(await fsReadFile(selectionsPath, 'utf8'))
    assert.equal(onDisk.version, 1)
    assert.equal(onDisk.selections.a.context, 65536)
    assert.equal(onDisk.selections.a.source, 'auto')
    assert.equal(snap.contextSelectionsReadError, undefined)
    // A "restarted" service reads the same file and does not rewrite identical records.
    const restarted = makeService({
      config,
      modelByKey: serviceModelByKey(config),
      readGgufMeta: async () => ({ status: 'unavailable', error: 'skipped' }),
      stat: async (path) => path === '/m/a.gguf' ? { isFile: () => true, size: 1, mtimeMs: 123 } : Object.assign(new Error('x'), { code: 'ENOENT' }),
    })
    const snap2 = await restarted.snapshot()
    assert.equal(snap2.models.find((m) => m.key === 'a').context.selected, 65536)
    const afterRestart = JSON.parse(await fsReadFile(selectionsPath, 'utf8'))
    assert.deepEqual(afterRestart.selections.a, onDisk.selections.a)
  } finally {
    await unlink(selectionsPath).catch(() => {})
  }
})

test('a manual override in the selections file wins and is labeled manual', async () => {
  const { writeFile, unlink } = await import('node:fs/promises')
  const selectionsPath = join(tmpdir(), `lmm-svc-override-${process.pid}-${Date.now()}.json`)
  try {
    await writeFile(selectionsPath, JSON.stringify({ version: 1, selections: {
      a: { context: 49152, source: 'manual', decidedAt: '2026-10-23T12:00:00.000Z' },
    } }))
    const config = { ...CONFIG_WITH_CONTEXT, contextSelectionsPath: selectionsPath }
    const service = makeService({ config, modelByKey: serviceModelByKey(config) })
    const snap = await service.snapshot()
    const a = snap.models.find((m) => m.key === 'a')
    assert.equal(a.context.selected, 49152)
    assert.equal(a.context.source, 'manual')
    assert.equal(a.context.override, 49152)
  } finally {
    await unlink(selectionsPath).catch(() => {})
  }
})

test('launch planning refuses a profile that pins the context through launchArgs', async () => {
  const config = Config['~standard'].validate({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/dsh-model-server',
    caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
    protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
    maxErrorRecords: 2,
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    allowedGpuUuids: ['GPU-CASE'],
    launchProfiles: [{
      profileId: 'a-case', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'a',
      gpuUuids: ['GPU-CASE'], gpuMode: 'single', launchArgs: ['-c', '16384'], label: 'Conflicting',
    }],
  }).value
  const service = makeService({ config, modelByKey: serviceModelByKey(config) })
  const planned = await service.planLaunch('a-case')
  assert.equal(planned.status, 'refused')
  assert.match(planned.reason, /"-c"/)
})

test('a confirmed profile launch carries the context pin and verifies the live runtime context', async () => {
  const configBase = Config['~standard'].validate({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/dsh-model-server',
    caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
    protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
    maxErrorRecords: 2,
    confirmTtlMs: 60000,
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
    allowedGpuUuids: ['GPU-CASE'],
    launchProfiles: [{
      profileId: 'a-case', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'a',
      gpuUuids: ['GPU-CASE'], gpuMode: 'single', launchArgs: ['--flash-attn', 'on'], label: 'Pinned',
    }],
  }).value
  const spawned = []
  const { writeFile, unlink } = await import('node:fs/promises')
  const selectionsPath = join(tmpdir(), `lmm-svc-launch-${process.pid}-${Date.now()}.json`)
  const config = { ...configBase, contextSelectionsPath: selectionsPath }
  try {
    await writeFile(selectionsPath, JSON.stringify({ version: 1, selections: { a: { context: 65536, source: 'auto' } } }))
    let running = false
    const service = makeService({
      config,
      modelByKey: serviceModelByKey(config),
      access: async () => undefined,
      probe: () => Promise.resolve(!running
        ? { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
        : { state: 'running', modelPath: '/m/a.gguf', liveContext: 65536, slots: [{ id: 0, n_ctx: 65536, isProcessing: false }], busy: false, busyUnknown: false }),
      spawn: (file, argv, opts) => {
        spawned.push({ file, argv, env: opts.env })
        running = true
        return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
      },
      stat: async (path) => path === '/m/a.gguf' ? { isFile: () => true, size: 1, mtimeMs: 1 } : Object.assign(new Error('x'), { code: 'ENOENT' }),
    })
    const planned = await service.planLaunch('a-case')
    assert.equal(planned.status, 'planned')
    const outcome = await service.confirmLaunch(planned.confirmToken)
    assert.equal(outcome.status, 'ok')
    assert.deepEqual(spawned[0].argv.slice(-2), ['-c', '65536']) // the selected pin rides last
    assert.equal(outcome.context.expected, 65536)
    assert.equal(outcome.context.live, 65536)
    assert.equal(outcome.context.verified, true)
  } finally {
    await unlink(selectionsPath).catch(() => {})
  }
})

test('a post-start context mismatch between the pin and the live n_ctx is recorded loudly, never hidden', async () => {
  const configBase = Config['~standard'].validate({
    endpointBase: 'http://127.0.0.1:8001',
    launcherPath: '/x/dsh-model-server',
    caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
    protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
    maxErrorRecords: 5,
    confirmTtlMs: 60000,
    models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
  }).value
  const { writeFile, unlink } = await import('node:fs/promises')
  const selectionsPath = join(tmpdir(), `lmm-svc-mismatch-${process.pid}-${Date.now()}.json`)
  const config = { ...configBase, contextSelectionsPath: selectionsPath }
  try {
    await writeFile(selectionsPath, JSON.stringify({ version: 1, selections: { a: { context: 65536, source: 'auto' } } }))
    let running = false
    const service = makeService({
      config,
      modelByKey: serviceModelByKey(config),
      access: async () => undefined,
      probe: () => Promise.resolve(!running
        ? { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false }
        : { state: 'running', modelPath: '/m/a.gguf', liveContext: 32768, slots: [{ id: 0, n_ctx: 32768, isProcessing: false }], busy: false, busyUnknown: false }),
      spawn: () => {
        running = true
        return { stdout: { on: (_e, cb) => cb(Buffer.from('READY')) }, stderr: { on: () => {} }, on: (evt, cb) => { if (evt === 'close') cb(0) } }
      },
    })
    const plan = await service.planAction('start', { modelKey: 'a' })
    assert.equal(plan.status, 'planned')
    const outcome = await service.confirmAction(plan.confirmToken)
    assert.equal(outcome.status, 'ok')
    assert.equal(outcome.context.verified, false)
    assert.equal(outcome.context.expected, 65536)
    assert.equal(outcome.context.live, 32768)
    const errors = await service.recentErrors()
    assert.ok(errors.errors.some((entry) => entry.action === 'context-verify' && entry.status === 'failed'))
  } finally {
    await unlink(selectionsPath).catch(() => {})
  }
})

// ---------------------------------------------------------------------------
// Electricity: measured GPU board energy, priced at the Ontario TOU rate that
// applied when each interval ran. Every figure states its measurement class and
// its coverage; a card shared with another consumer is labelled approximate.
// ---------------------------------------------------------------------------

/** A config with the bounded sampler enabled, for the electricity tests. */
const SAMPLING_CONFIG = Config['~standard'].validate({
  endpointBase: 'http://127.0.0.1:8001',
  launcherPath: '/x/dsh-model-server',
  caseGpuUuid: 'GPU-CASE', caseGpuName: 'RTX 3090 — Case',
  protectedGpuUuid: 'GPU-TI', protectedGpuName: 'RTX 3090 Ti',
  maxErrorRecords: 2,
  powerSamplingEnabled: true,
  models: [{ key: 'a', name: 'Model A', ggufPath: '/m/a.gguf', switchName: 'a', engineBinary: 'stable' }],
}).value

/** A ring populated with `count` samples ending at `endMs`, one second apart. */
const filledRing = async (count, { endMs = Date.now(), watts = 300, pid = 999, utilPct = 95 } = {}) => {
  const { PowerRing } = await import('../core/power-sampler.js')
  const ring = new PowerRing(count + 10)
  for (let i = count - 1; i >= 0; i -= 1) {
    ring.push({
      t: endMs - i * 1000,
      gpus: [{ uuid: 'GPU-TI', watts, limitW: 340, utilPct }],
      processes: pid === null ? [] : [{ uuid: 'GPU-TI', pid, processName: 'strata-dsv41' }],
    })
  }
  return ring
}

test('with sampling disabled the block still reports the live rate and draw, and no job', async () => {
  const snap = await makeService().snapshot()
  const e = snap.electricity
  assert.equal(e.measurement, 'gpu-board-energy')
  assert.match(e.measurementNote, /excludes CPU/)
  assert.equal(e.gpuUuid, 'GPU-TI')
  assert.equal(e.powerDrawW, 421.09)
  assert.equal(e.powerLimitW, 450)
  assert.deepEqual(e.sampling, { enabled: false })
  assert.equal(e.job, null)
  assert.equal(e.tariff.zone, 'America/Toronto')
  assert.equal(e.tariff.effectiveFrom, '2026-11-01')
  assert.ok([9.1, 14.6, 18.9].includes(e.tariff.centsPerKwh))
  assert.equal(e.centsPerHour, (421.09 / 1000) * e.tariff.centsPerKwh)
})

test('a card that could not be read reports no draw and no hourly cost', async () => {
  const snap = await makeService({ queryGpus: async () => ({ status: 'unavailable', error: 'nvidia-smi unavailable' }) }).snapshot()
  assert.equal(snap.electricity.powerDrawW, null)
  assert.equal(snap.electricity.centsPerHour, null)
})

test('an observed job reports measured energy, cost, and full coverage', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const ring = await filledRing(61)
  const release = service.startSampling({ ring, query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const snap = await service.snapshot()
    const job = snap.electricity.job
    assert.equal(job.open, true)
    assert.equal(job.coverage, 1)
    assert.equal(job.sampleCount, 61)
    assert.equal(job.attribution, 'exclusive')
    assert.equal(job.approximate, false)
    // 60 intervals of one second at a steady 300 W.
    assert.equal(Math.round(job.energyWh * 100) / 100, 5)
    assert.equal(job.costCents, (5 / 1000) * snap.electricity.tariff.centsPerKwh)
    assert.equal(job.distinctPids.length, 1)
    assert.equal(job.distinctPids[0], 999)
    assert.equal(snap.electricity.sampling.enabled, true)
    assert.equal(snap.electricity.sampling.capacity, ring.capacity)
    assert.equal(snap.electricity.sampling.retained, ring.size)
    assert.equal(snap.electricity.sampling.windowMs, ring.capacity * 1000)
  } finally {
    await release()
  }
})

test('a card shared by two workers is labelled approximate, not exclusive', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const { PowerRing } = await import('../core/power-sampler.js')
  const ring = new PowerRing(64)
  const endMs = Date.now()
  for (let i = 30; i >= 0; i -= 1) {
    ring.push({
      t: endMs - i * 1000,
      gpus: [{ uuid: 'GPU-TI', watts: 300, limitW: 340, utilPct: 95 }],
      processes: [{ uuid: 'GPU-TI', pid: i < 15 ? 1000 : 999, processName: 'engine' }],
    })
  }
  const release = service.startSampling({ ring, query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const job = (await service.snapshot()).electricity.job
    assert.equal(job.attribution, 'shared')
    assert.equal(job.approximate, true)
    assert.deepEqual([...job.distinctPids].sort((a, b) => a - b), [999, 1000])
  } finally {
    await release()
  }
})

test('a window the sampler missed is reported as partial, never scaled up', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const { PowerRing } = await import('../core/power-sampler.js')
  const ring = new PowerRing(64)
  const endMs = Date.now()
  // Ten measured seconds, then a minute of no samples at all, then two more.
  for (const offset of [72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 2, 1]) {
    ring.push({ t: endMs - offset * 1000, gpus: [{ uuid: 'GPU-TI', watts: 300, limitW: 340, utilPct: 95 }], processes: [{ uuid: 'GPU-TI', pid: 999, processName: 'engine' }] })
  }
  const release = service.startSampling({ ring, query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const job = (await service.snapshot()).electricity.job
    assert.ok(job.coverage < 0.5, `coverage must expose the hole, got ${job.coverage}`)
    assert.ok(job.gapCount >= 1)
    assert.equal(job.attribution, 'partial')
    assert.equal(job.approximate, true)
    // Only the measured span is priced: ~11 s at 300 W, not the full 72 s.
    assert.ok(job.energyWh < 1.2, `energy must cover only measured time, got ${job.energyWh}`)
    assert.ok(job.energyWh > 0)
  } finally {
    await release()
  }
})

test('the sampler is stopped and its timer released when the plugin is unloaded', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  let cancelled = 0
  const release = service.startSampling({
    ring: await filledRing(5),
    query: async () => ({ status: 'ok', gpus: [], processes: [] }),
    schedule: () => 1,
    cancel: () => { cancelled += 1 },
    now: Date.now,
  })
  await release()
  assert.equal(cancelled, 1, 'the timer handle must be released exactly once')
  assert.equal((await service.snapshot()).electricity.sampling.enabled, false)
})

test('a disabled sampler never starts a timer even when asked', async () => {
  const service = makeService()
  let scheduled = 0
  const release = service.startSampling({ query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => { scheduled += 1 }, cancel: () => {}, now: Date.now })
  await release()
  assert.equal(scheduled, 0)
  assert.equal((await service.snapshot()).electricity.sampling.enabled, false)
})

// ---------------------------------------------------------------------------
// energyWindow: a caller that owns its own notion of "the job" (a Session)
// prices its own span through the same ring, the same tariff, and the same
// attribution classifier. Nothing here samples a card a second time.
// ---------------------------------------------------------------------------

test('energyWindow prices a caller-supplied closed span without sampling', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const ring = await filledRing(61, { endMs: 1_000_000 })
  const release = service.startSampling({ ring, query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const measured = service.energyWindow({ fromMs: 940_000, toMs: 1_000_000 })
    assert.equal(measured.status, 'measured')
    assert.equal(measured.measurement, 'gpu-board-energy')
    assert.match(measured.measurementNote, /excludes CPU/)
    assert.equal(measured.gpuUuid, 'GPU-TI')
    assert.equal(measured.window.fromMs, 940_000)
    assert.equal(measured.window.toMs, 1_000_000)
    assert.equal(measured.window.open, false)
    // Sixty one-second intervals at a steady 300 W.
    assert.equal(Math.round(measured.span.wh * 100) / 100, 5)
    assert.equal(measured.span.coverage, 1)
    assert.equal(measured.attribution.label, 'exclusive')
    assert.equal(measured.attribution.approximate, false)
    assert.equal(measured.powerDrawW, 300, 'the current draw is the newest retained sample')
    assert.ok(measured.tariff.centsPerKwh > 0)
    assert.equal(measured.centsPerHour, (300 / 1000) * measured.tariff.centsPerKwh)
    assert.equal(measured.distinctPids, 1)
    assert.deepEqual(service.powerRecords().length, ring.size, 'the ring is read, never appended to')
  } finally {
    await release()
  }
})

test('energyWindow with an open window integrates to the newest retained sample', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const endMs = 2_000_000
  const release = service.startSampling({ ring: await filledRing(61, { endMs }), query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const measured = service.energyWindow({ fromMs: endMs - 60_000, toMs: null })
    assert.equal(measured.status, 'measured')
    assert.equal(measured.window.open, true)
    assert.equal(measured.window.toMs, endMs, 'an open window stops at the newest sample, not at the wall clock')
  } finally {
    await release()
  }
})

test('energyWindow prices several caller spans and sums them', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const ring = await filledRing(121, { endMs: 1_000_000 })
  const release = service.startSampling({ ring, query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    // Two 30 s turns with a 60 s pause between them: only the turns are priced.
    const measured = service.energyWindow({
      windows: [
        { fromMs: 900_000, toMs: 930_000 },
        { fromMs: 960_000, toMs: 990_000 },
      ],
    })
    assert.equal(measured.status, 'measured')
    assert.equal(measured.span.windowCount, 2)
    assert.equal(measured.window.spans.length, 2)
    assert.equal(measured.window.fromMs, 900_000)
    assert.equal(measured.window.toMs, 990_000)
    // Two 30-second intervals at 300 W: 5 Wh, versus 7.5 Wh for the 90 s span
    // that would wrongly charge the idle pause to the Session.
    assert.equal(Math.round(measured.span.wh * 100) / 100, 5)
    assert.equal(measured.span.coverage, 1, 'the pause is not a gap inside a priced span')
  } finally {
    await release()
  }
})

test('energyWindow keeps an open trailing span and reports partial coverage', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const endMs = 2_000_000
  const release = service.startSampling({ ring: await filledRing(61, { endMs }), query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const measured = service.energyWindow({
      windows: [
        // A turn that ran before this ring existed: one million ms the sampler
        // never saw. It must land in `gapMs`, not be scaled up from the rest.
        { fromMs: endMs - 3_000_000, toMs: endMs - 2_000_000 },
        { fromMs: endMs - 60_000, toMs: null },
      ],
    })
    assert.equal(measured.status, 'measured')
    assert.equal(measured.window.open, true, 'the trailing span is still running')
    assert.ok(measured.span.coverage < 0.1, 'a span older than the ring is reported as uncovered, never extrapolated')
    assert.ok(measured.span.gapMs >= 1_000_000, 'the unobserved slice is carried as a gap')
    assert.match(measured.attribution.reasons.join(' '), /% of the span was measured/)
  } finally {
    await release()
  }
})

test('energyWindow prices nothing when every supplied span is outside the ring', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const release = service.startSampling({ ring: await filledRing(5), query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const measured = service.energyWindow({ windows: [{ fromMs: 1_000, toMs: 1_000 }, { fromMs: 5_000, toMs: 4_000 }] })
    assert.equal(measured.status, 'no-window')
    assert.match(measured.reason, /inside this window/)
  } finally {
    await release()
  }
})

test('energyWindow refuses an absent window instead of inventing one', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const release = service.startSampling({ ring: await filledRing(5), query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const noStart = service.energyWindow({ fromMs: null, toMs: 1_000 })
    assert.equal(noStart.status, 'no-window')
    assert.match(noStart.reason, /window start/)
  } finally {
    await release()
  }
})

test('energyWindow reports unsampled when power sampling is disabled', () => {
  const measured = makeService().energyWindow({ fromMs: 1_000, toMs: 2_000 })
  assert.equal(measured.status, 'unsampled')
  assert.match(measured.reason, /power sampling is disabled/)
  assert.equal(measured.gpuUuid, 'GPU-TI')
})

test('energyWindow reports no-window before the first retained sample', async () => {
  const service = makeService({ config: SAMPLING_CONFIG })
  const { PowerRing } = await import('../core/power-sampler.js')
  const release = service.startSampling({ ring: new PowerRing(16), query: async () => ({ status: 'ok', gpus: [], processes: [] }), schedule: () => 1, cancel: () => {}, now: Date.now })
  try {
    const measured = service.energyWindow({ fromMs: 1_000, toMs: 2_000 })
    assert.equal(measured.status, 'no-window')
    assert.match(measured.reason, /first sample|not retained/)
  } finally {
    await release()
  }
})
