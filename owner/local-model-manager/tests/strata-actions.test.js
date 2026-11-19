import test from 'node:test'
import assert from 'node:assert/strict'
import { createStrataActions } from '../core/strata-actions.js'

const CONFIG = {
  caseGpuUuid: 'GPU-3090',
  caseGpuName: 'RTX 3090',
  protectedGpuUuid: 'GPU-TI',
  protectedGpuName: 'RTX 3090 Ti',
  allowedGpuUuids: ['GPU-3090', 'GPU-TI'],
  confirmTtlMs: 60000,
}

const status = (modelId = 'qwen3.8-flash-next-iq3_xxs', gpu = 'gpu0') => ({
  modelSelection: { status: 'ok', id: modelId },
  gpuSelection: { status: 'ok', key: gpu },
})

const base = (overrides = {}) => {
  let reservations = ['GPU-TI']
  const calls = []
  let current = status()
  const actions = createStrataActions({
    config: CONFIG,
    readStatus: async () => current,
    reservedGpus: () => reservations,
    probe: async () => ({ state: 'stopped', busy: false, busyUnknown: false }),
    readEngineMode: async () => 'strata',
    accessImpl: async () => {},
    writeGpuMode: async (_path, mode) => { current = { ...current, gpuSelection: { status: 'ok', key: mode } } },
    runCommand: async (file, args) => {
      calls.push([file, args])
      if (file.includes('strata-set-model')) {
        current = {
          ...current,
          modelSelection: {
            status: 'ok',
            id: args[0] === 'fast' ? 'qwen3.8-flash-next-iq3_xxs' : 'deepseek-v4.1-flash',
          },
        }
      }
      return { status: 'ok', exitCode: 0, output: '' }
    },
    ...overrides,
  })
  return {
    actions,
    calls,
    setReservations: (v) => { reservations = v },
  }
}

test('Ti reservation blocks Ti-only and both-GPU Strata targets while allowing RTX 3090', async () => {
  const { actions } = base()
  assert.equal((await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu1' })).status, 'refused')
  assert.equal((await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu01' })).status, 'refused')
  assert.equal((await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu0' })).status, 'planned')
})

test('reservation is rechecked at confirmation time', async () => {
  const { actions, setReservations } = base()
  const plan = await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu0' })
  assert.equal(plan.status, 'planned')
  setReservations(['GPU-TI', 'GPU-3090'])
  const outcome = await actions.confirm(plan.confirmToken)
  assert.equal(outcome.status, 'refused')
})

test('busy Strata refuses switching before any command runs', async () => {
  const { actions, calls } = base({
    probe: async () => ({ state: 'running', busy: true, busyUnknown: false }),
  })
  const plan = await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu0' })
  assert.equal(plan.status, 'refused')
  assert.equal(calls.length, 0)
})

test('confirmed activation delegates to the trusted Strata selector', async () => {
  const { actions, calls } = base()
  const plan = await actions.plan('activate', { modelId: 'deepseek-v4.1-flash', gpuMode: 'gpu0' })
  const outcome = await actions.confirm(plan.confirmToken)
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.chatRestartRequired, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/home/liongateos/.local/bin/strata-set-model')
  assert.deepEqual(calls[0][1], ['deep'])
})
