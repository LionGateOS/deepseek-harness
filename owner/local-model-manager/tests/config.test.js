/**
 * Config validation coverage: defaults, loud misconfiguration failures, and
 * the loopback-only endpoint rule that keeps the local service unexposed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { validateConfig } from '../core/config.js'

const MODEL = {
  key: 'qwen27',
  name: 'Qwen 27B',
  ggufPath: '/models/q8.gguf',
  switchName: 'qwen27',
  engineBinary: 'stable',
}

test('validateConfig fills documented defaults for absent fields', () => {
  const config = validateConfig({ caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] })
  // GPU policy 2026-10-23: the preferred launch GPU defaults to the RTX 3090
  // Ti and the durable state path defaults to absent (in-memory only).
  assert.equal(config.preferredLaunchGpuUuid, 'GPU-p')
  assert.equal(config.gpuLaunchStatePath, '')
  assert.equal(config.endpointBase, 'http://127.0.0.1:8001')
  assert.equal(config.probeTimeoutMs, 3000)
  assert.equal(config.actionTimeoutMs, 300000)
  assert.equal(config.confirmTtlMs, 300000)
  assert.equal(config.maxErrorRecords, 20)
  assert.equal(config.models.length, 1)
  assert.equal(config.models[0].vision, false)
  assert.equal(config.models[0].multiPart, false)
})

test('validateConfig fails loudly on malformed config instead of guessing', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  assert.throws(() => validateConfig('nope'))
  assert.throws(() => validateConfig({ ...good, endpointBase: 'http://0.0.0.0:8001' }), /loopback/)
  assert.throws(() => validateConfig({ ...good, endpointBase: 'http://192.168.1.10:8001' }), /loopback/)
  assert.throws(() => validateConfig({ ...good, models: [] }), /non-empty/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, key: 'bad key!' }] }), /slug/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, key: 'x' }, { ...MODEL, key: 'x', switchName: 'y' }] }), /unique/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, ggufPath: 'relative.gguf' }] }), /absolute/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, engineBinary: 'vllm' }] }), /engineBinary/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, key: 'z', switchName: undefined }] }), /switchName/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, vision: true }] }), /mmprojPath/)
  assert.throws(() => validateConfig({ ...good, models: [{ ...MODEL, key: 'z', switchName: 'z' }], probeTimeoutMs: -1 }), /positive/)
  assert.throws(() => validateConfig({ ...good, caseGpuUuid: '' }), /non-empty/)
})

test('vision model rows keep their mmproj companion file path', () => {
  const config = validateConfig({
    caseGpuUuid: 'GPU-case', caseGpuName: 'a', protectedGpuUuid: 'GPU-p', protectedGpuName: 'b',
    models: [{ ...MODEL, vision: true, mmprojPath: '/models/mmproj.gguf', multiPart: true }],
  })
  assert.equal(config.models[0].mmprojPath, '/models/mmproj.gguf')
  assert.equal(config.models[0].multiPart, true)
})

test('validateConfig rejects launch profile with duplicate GPU UUID in single-GPU mode', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  const profile = {
    profileId: 'prof-dup',
    engineId: 'llama.cpp',
    engineVersion: 'v1',
    modelKey: 'qwen27',
    gpuUuids: ['GPU-A', 'GPU-A'],
    gpuMode: 'single',
    launchArgs: [],
    label: 'Duplicate UUID test',
  }
  assert.throws(() => validateConfig({ ...good, launchProfiles: [profile] }), /duplicate UUID/)
})

test('validateConfig rejects launch profile with duplicate GPU UUID across three entries', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  const profile = {
    profileId: 'prof-dup2',
    engineId: 'llama.cpp',
    engineVersion: 'v1',
    modelKey: 'qwen27',
    gpuUuids: ['GPU-A', 'GPU-B', 'GPU-A'],
    gpuMode: 'both',
    launchArgs: [],
    label: 'Duplicate UUID multi test',
  }
  assert.throws(() => validateConfig({ ...good, launchProfiles: [profile] }), /duplicate UUID/)
})

test('validateConfig defaults discoveryDirs to empty array and discoveryResultsPath to empty string', () => {
  const config = validateConfig({ caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] })
  assert.deepEqual(config.discoveryDirs, [])
  assert.equal(config.discoveryResultsPath, '')
})

test('validateConfig accepts valid absolute discoveryDirs and discoveryResultsPath', () => {
  const config = validateConfig({
    caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti',
    models: [MODEL],
    discoveryDirs: ['/models/gguf', '/mnt/extra/gguf'],
    discoveryResultsPath: '/tmp/discovery-cache.json',
  })
  assert.deepEqual(config.discoveryDirs, ['/models/gguf', '/mnt/extra/gguf'])
  assert.equal(config.discoveryResultsPath, '/tmp/discovery-cache.json')
})

test('validateConfig rejects non-absolute path in discoveryDirs', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  assert.throws(() => validateConfig({ ...good, discoveryDirs: ['relative/path'] }), /absolute/)
  assert.throws(() => validateConfig({ ...good, discoveryDirs: 'not-a-list' }), /list/)
})

test('validateConfig rejects non-absolute discoveryResultsPath', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  assert.throws(() => validateConfig({ ...good, discoveryResultsPath: 'relative/cache.json' }), /absolute/)
})

test('validateConfig defaults userDiscoveryDirsPath to empty string when absent', () => {
  const config = validateConfig({ caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] })
  assert.equal(config.userDiscoveryDirsPath, '')
})

test('validateConfig accepts a valid absolute userDiscoveryDirsPath', () => {
  const config = validateConfig({
    caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti',
    models: [MODEL],
    userDiscoveryDirsPath: '/home/user/.local/share/user-discovery-dirs.json',
  })
  assert.equal(config.userDiscoveryDirsPath, '/home/user/.local/share/user-discovery-dirs.json')
})

test('validateConfig rejects a non-absolute userDiscoveryDirsPath', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  assert.throws(() => validateConfig({ ...good, userDiscoveryDirsPath: 'relative/user-dirs.json' }), /absolute/)
})
test('validateConfig documents the context fields by default and validates their values', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  const config = validateConfig(good)
  assert.equal(config.contextSelectionsPath, '')
  assert.equal(config.reservedOutputTokens, 8192)
  assert.equal(config.headroomTokens, 16384)
  assert.deepEqual(config.hardwareContextCaps, {})
  assert.throws(() => validateConfig({ ...good, reservedOutputTokens: 0 }), /positive/)
  assert.throws(() => validateConfig({ ...good, headroomTokens: 1.5 }), /positive/)
  assert.throws(() => validateConfig({ ...good, contextSelectionsPath: 'relative/contexts.json' }), /absolute/)
})

test('validateConfig validates context selections path and hardware context caps', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  const config = validateConfig({ ...good, contextSelectionsPath: '/home/user/.local/share/context-selections.json', hardwareContextCaps: { qwen27: 98304 } })
  assert.equal(config.contextSelectionsPath, '/home/user/.local/share/context-selections.json')
  assert.deepEqual(config.hardwareContextCaps, { qwen27: 98304 })
  assert.throws(() => validateConfig({ ...good, hardwareContextCaps: { unknown: 4096 } }), /not a managed model key/)
  assert.throws(() => validateConfig({ ...good, hardwareContextCaps: { qwen27: -1 } }), /positive integer/)
  assert.throws(() => validateConfig({ ...good, hardwareContextCaps: { qwen27: 40.5 } }), /positive integer/)
  assert.throws(() => validateConfig({ ...good, hardwareContextCaps: ['qwen27'] }), /must be an object/)
})

test('preferredLaunchGpuUuid and gpuLaunchStatePath validate loudly', () => {
  const good = { caseGpuUuid: 'GPU-case', caseGpuName: 'RTX 3090', protectedGpuUuid: 'GPU-p', protectedGpuName: 'RTX 3090 Ti', models: [MODEL] }
  // An explicit preferred launch GPU wins over the Ti default.
  const explicit = validateConfig({ ...good, preferredLaunchGpuUuid: 'GPU-case', gpuLaunchStatePath: '/state/gpu-launch-state.json' })
  assert.equal(explicit.preferredLaunchGpuUuid, 'GPU-case')
  assert.equal(explicit.gpuLaunchStatePath, '/state/gpu-launch-state.json')
  // A non-string preferred UUID or a relative state path fails loud.
  assert.throws(() => validateConfig({ ...good, preferredLaunchGpuUuid: 7 }), /non-empty string/)
  assert.throws(() => validateConfig({ ...good, gpuLaunchStatePath: 'relative.json' }), /absolute/)
  // With preferredLaunchGpuUuid set, the config still requires the historic
  // protectedGpuUuid field — the base field check fires first and loudly.
  assert.throws(() => validateConfig({ ...good, preferredLaunchGpuUuid: 'GPU-x', protectedGpuUuid: '' }), /protectedGpuUuid must be a non-empty string/)
})
