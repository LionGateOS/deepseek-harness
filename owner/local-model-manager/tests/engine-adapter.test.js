/**
 * Unit tests for the engine-adapter module: buildProfileEnv, buildLlamaCppLaunch,
 * and validateEngineAdapter. All software-only — no I/O, no hardware.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProfileEnv, buildLlamaCppLaunch, validateEngineAdapter } from '../core/engine-adapter.js'

// ---------------------------------------------------------------------------
// buildProfileEnv
// ---------------------------------------------------------------------------

test('buildProfileEnv sets CUDA_VISIBLE_DEVICES to a single UUID', () => {
  const env = buildProfileEnv(['GPU-CASE'])
  assert.equal(env.CUDA_VISIBLE_DEVICES, 'GPU-CASE')
})

test('buildProfileEnv comma-joins multiple UUIDs', () => {
  const env = buildProfileEnv(['GPU-A', 'GPU-B'])
  assert.equal(env.CUDA_VISIBLE_DEVICES, 'GPU-A,GPU-B')
})

test('buildProfileEnv extends the base environment', () => {
  const base = { PATH: '/usr/bin', HOME: '/home/user' }
  const env = buildProfileEnv(['GPU-X'], base)
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/home/user')
  assert.equal(env.CUDA_VISIBLE_DEVICES, 'GPU-X')
})

test('buildProfileEnv does not mutate the base environment object', () => {
  const base = { PATH: '/usr/bin' }
  buildProfileEnv(['GPU-X'], base)
  assert.equal(Object.keys(base).length, 1)
  assert.equal(base['CUDA_VISIBLE_DEVICES'], undefined)
})

// ---------------------------------------------------------------------------
// buildLlamaCppLaunch
// ---------------------------------------------------------------------------

test('buildLlamaCppLaunch builds argv with start-<switchName>', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: [] }
  const model = { switchName: 'mymodel' }
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(result.ok)
  assert.deepEqual(result.argv, ['start-mymodel'])
})

test('buildLlamaCppLaunch appends launchArgs to argv', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: ['--flash-attn', 'on', '--no-webui'] }
  const model = { switchName: 'qwen' }
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(result.ok)
  assert.deepEqual(result.argv, ['start-qwen', '--flash-attn', 'on', '--no-webui'])
})

test('buildLlamaCppLaunch refuses a context flag inside launchArgs so the selected context stays authoritative', () => {
  const profile = { profileId: 'p1', gpuUuids: ['GPU-A'], launchArgs: ['-c', '131072'] }
  const result = buildLlamaCppLaunch(profile, { switchName: 'qwen' })
  assert.ok(!result.ok)
  assert.match(result.reason, /"-c"/)
})

test('buildLlamaCppLaunch refuses a --ctx-size= flag form inside launchArgs', () => {
  const profile = { profileId: 'p2', gpuUuids: ['GPU-A'], launchArgs: ['--ctx-size=8192'] }
  const result = buildLlamaCppLaunch(profile, { switchName: 'qwen' })
  assert.ok(!result.ok)
  assert.match(result.reason, /launchArgs/)
})

test('buildLlamaCppLaunch appends the selected-context argv last so llama.cpp last-wins parsing honors it', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: ['--flash-attn', 'on'] }
  const model = { switchName: 'qwen' }
  const result = buildLlamaCppLaunch(profile, model, {}, { contextArgv: ['-c', '65536'] })
  assert.ok(result.ok)
  assert.deepEqual(result.argv, ['start-qwen', '--flash-attn', 'on', '-c', '65536'])
})

test('buildLlamaCppLaunch omits the context argv when no selection was recorded', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: [] }
  const result = buildLlamaCppLaunch(profile, { switchName: 'qwen' }, {}, { contextArgv: [] })
  assert.ok(result.ok)
  assert.deepEqual(result.argv, ['start-qwen'])
})

test('buildLlamaCppLaunch sets CUDA_VISIBLE_DEVICES from profile GPU UUIDs', () => {
  const profile = { gpuUuids: ['GPU-CASE-UUID'], launchArgs: [] }
  const model = { switchName: 'qwen' }
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(result.ok)
  assert.equal(result.env.CUDA_VISIBLE_DEVICES, 'GPU-CASE-UUID')
})

test('buildLlamaCppLaunch comma-joins dual-GPU UUIDs in CUDA_VISIBLE_DEVICES', () => {
  const profile = { gpuUuids: ['GPU-A', 'GPU-B'], launchArgs: [] }
  const model = { switchName: 'bigmodel' }
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(result.ok)
  assert.equal(result.env.CUDA_VISIBLE_DEVICES, 'GPU-A,GPU-B')
})

test('buildLlamaCppLaunch refuses when switchName is not a valid lowercase slug', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: [] }
  const model = { switchName: 'Not A Valid Slug!' }
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(!result.ok)
  assert.match(result.reason, /switchName/)
})

test('buildLlamaCppLaunch refuses when model has no switchName', () => {
  const profile = { gpuUuids: ['GPU-A'], launchArgs: [] }
  const model = {}
  const result = buildLlamaCppLaunch(profile, model)
  assert.ok(!result.ok)
  assert.match(result.reason, /switchName/)
})

// ---------------------------------------------------------------------------
// validateEngineAdapter
// ---------------------------------------------------------------------------

test('validateEngineAdapter returns ok for llama.cpp', () => {
  const result = validateEngineAdapter('llama.cpp')
  assert.ok(result.ok)
})

test('validateEngineAdapter refuses vllm with a specific reason', () => {
  const result = validateEngineAdapter('vllm')
  assert.ok(!result.ok)
  assert.match(result.reason, /vllm/)
})

test('validateEngineAdapter refuses ollama with a specific reason', () => {
  const result = validateEngineAdapter('ollama')
  assert.ok(!result.ok)
  assert.match(result.reason, /ollama/)
})

test('validateEngineAdapter refuses sglang with a specific reason', () => {
  const result = validateEngineAdapter('sglang')
  assert.ok(!result.ok)
  assert.match(result.reason, /sglang/)
})

test('validateEngineAdapter refuses tensorrt-llm with a specific reason', () => {
  const result = validateEngineAdapter('tensorrt-llm')
  assert.ok(!result.ok)
  assert.match(result.reason, /tensorrt-llm/)
})

test('validateEngineAdapter refuses an unrecognized engine with a generic reason', () => {
  const result = validateEngineAdapter('unknown-engine-xyz')
  assert.ok(!result.ok)
  assert.match(result.reason, /not a recognized engine/)
})
