/**
 * Launch profile validation, merging, and GPU boundary checking.
 *
 * Covers: validateOneLaunchProfile (required fields, optional fields, reject
 * cases), validateLaunchProfiles (list handling, partial failures),
 * mergeLaunchProfilesIntoEngines (matching, non-matching, empty), and
 * validateProfileGpuBoundary (allowed, protected, unrecognized, mode checks).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateOneLaunchProfile,
  validateLaunchProfiles,
  mergeLaunchProfilesIntoEngines,
  validateProfileGpuBoundary,
} from '../core/launch-profile.js'

// ---------------------------------------------------------------------------
// validateOneLaunchProfile
// ---------------------------------------------------------------------------

const validProfile = {
  profileId: 'qwen27b-3090',
  engineId: 'llama.cpp',
  engineVersion: 'b5561',
  modelKey: 'a',
  gpuUuids: ['GPU-4144e557-ad9a-83b3-014a-61f67141c547'],
  gpuMode: 'single',
  launchArgs: [],
  label: 'Qwen 27B — RTX 3090 single GPU',
}

test('validateOneLaunchProfile accepts a minimal valid profile', () => {
  const result = validateOneLaunchProfile(validProfile)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.profileId, 'qwen27b-3090')
  assert.equal(result.record.engineId, 'llama.cpp')
  assert.equal(result.record.gpuMode, 'single')
  assert.deepEqual(result.record.launchArgs, [])
  assert.equal('notes' in result.record, false)
})

test('validateOneLaunchProfile accepts optional notes and non-empty launchArgs', () => {
  const result = validateOneLaunchProfile({
    ...validProfile,
    launchArgs: ['--ctx-size', '131072', '--n-gpu-layers', '99'],
    notes: 'Tested 2026-10-21',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.record.launchArgs, ['--ctx-size', '131072', '--n-gpu-layers', '99'])
  assert.equal(result.record.notes, 'Tested 2026-10-21')
})

test('validateOneLaunchProfile accepts gpuMode "both"', () => {
  const result = validateOneLaunchProfile({
    ...validProfile,
    gpuMode: 'both',
    gpuUuids: ['GPU-AAAA', 'GPU-BBBB'],
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.gpuMode, 'both')
  assert.deepEqual(result.record.gpuUuids, ['GPU-AAAA', 'GPU-BBBB'])
})

test('validateOneLaunchProfile trims string fields', () => {
  const result = validateOneLaunchProfile({
    ...validProfile,
    profileId: '  qwen27b-3090  ',
    engineId: '  llama.cpp  ',
    label: '  Qwen 27B  ',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.profileId, 'qwen27b-3090')
  assert.equal(result.record.engineId, 'llama.cpp')
  assert.equal(result.record.label, 'Qwen 27B')
})

test('validateOneLaunchProfile rejects null', () => {
  const result = validateOneLaunchProfile(null)
  assert.equal(result.ok, false)
})

test('validateOneLaunchProfile rejects an array', () => {
  const result = validateOneLaunchProfile([validProfile])
  assert.equal(result.ok, false)
})

test('validateOneLaunchProfile rejects missing profileId', () => {
  const { profileId: _, ...rest } = validProfile
  const result = validateOneLaunchProfile(rest)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /profileId/)
})

test('validateOneLaunchProfile rejects profileId with uppercase', () => {
  const result = validateOneLaunchProfile({ ...validProfile, profileId: 'Qwen27b' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /profileId must be a lowercase slug/)
})

test('validateOneLaunchProfile rejects missing engineId', () => {
  const { engineId: _, ...rest } = validProfile
  const result = validateOneLaunchProfile(rest)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /engineId/)
})

test('validateOneLaunchProfile rejects missing engineVersion', () => {
  const { engineVersion: _, ...rest } = validProfile
  const result = validateOneLaunchProfile(rest)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /engineVersion/)
})

test('validateOneLaunchProfile rejects missing modelKey', () => {
  const { modelKey: _, ...rest } = validProfile
  const result = validateOneLaunchProfile(rest)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /modelKey/)
})

test('validateOneLaunchProfile rejects empty gpuUuids array', () => {
  const result = validateOneLaunchProfile({ ...validProfile, gpuUuids: [] })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /gpuUuids/)
})

test('validateOneLaunchProfile rejects gpuUuids with a non-string element', () => {
  const result = validateOneLaunchProfile({ ...validProfile, gpuUuids: ['GPU-VALID', null] })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /gpuUuids\[1\]/)
})

test('validateOneLaunchProfile rejects invalid gpuMode', () => {
  const result = validateOneLaunchProfile({ ...validProfile, gpuMode: 'triple' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /gpuMode must be/)
})

test('validateOneLaunchProfile rejects non-array launchArgs', () => {
  const result = validateOneLaunchProfile({ ...validProfile, launchArgs: '--ctx-size 131072' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /launchArgs must be an array/)
})

test('validateOneLaunchProfile rejects launchArgs with an empty-string element', () => {
  const result = validateOneLaunchProfile({ ...validProfile, launchArgs: ['--ctx-size', ''] })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /launchArgs\[1\]/)
})

test('validateOneLaunchProfile rejects missing label', () => {
  const { label: _, ...rest } = validProfile
  const result = validateOneLaunchProfile(rest)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /label/)
})

// ---------------------------------------------------------------------------
// validateLaunchProfiles
// ---------------------------------------------------------------------------

test('validateLaunchProfiles accepts an empty array', () => {
  const { valid, problems } = validateLaunchProfiles([])
  assert.deepEqual(valid, [])
  assert.deepEqual(problems, [])
})

test('validateLaunchProfiles rejects a non-array', () => {
  const { valid, problems } = validateLaunchProfiles('not an array')
  assert.deepEqual(valid, [])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /launchProfiles must be an array/)
})

test('validateLaunchProfiles collects valid and rejected entries separately', () => {
  const raw = [
    validProfile,
    { ...validProfile, profileId: 'BadID', engineId: '' }, // invalid profileId slug + empty engineId
    { ...validProfile, profileId: 'second-profile' },
  ]
  const { valid, problems } = validateLaunchProfiles(raw)
  assert.equal(valid.length, 2)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /launchProfiles\[1\]/)
})

test('validateLaunchProfiles includes index in problem messages', () => {
  const raw = [
    { ...validProfile, profileId: '' },
    validProfile,
    { ...validProfile, profileId: 'third', gpuUuids: [] },
  ]
  const { valid, problems } = validateLaunchProfiles(raw)
  assert.equal(valid.length, 1)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /launchProfiles\[0\]/)
  assert.match(problems[1], /launchProfiles\[2\]/)
})

// ---------------------------------------------------------------------------
// mergeLaunchProfilesIntoEngines
// ---------------------------------------------------------------------------

const engines = [
  { id: 'llama.cpp', displayName: 'llama.cpp' },
  { id: 'vllm', displayName: 'vLLM' },
]

const profileA = { ...validProfile, profileId: 'profile-a', engineId: 'llama.cpp' }
const profileB = { ...validProfile, profileId: 'profile-b', engineId: 'llama.cpp' }
const profileV = { ...validProfile, profileId: 'profile-v', engineId: 'vllm', modelKey: 'v-model' }

test('mergeLaunchProfilesIntoEngines gives every engine an empty launchProfiles array when no profiles exist', () => {
  const result = mergeLaunchProfilesIntoEngines(engines, [])
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].launchProfiles, [])
  assert.deepEqual(result[1].launchProfiles, [])
})

test('mergeLaunchProfilesIntoEngines merges profiles into the matching engine', () => {
  const result = mergeLaunchProfilesIntoEngines(engines, [profileA, profileV])
  const llamaEntry = result.find((e) => e.id === 'llama.cpp')
  const vllmEntry = result.find((e) => e.id === 'vllm')
  assert.equal(llamaEntry?.launchProfiles.length, 1)
  assert.equal(llamaEntry?.launchProfiles[0].profileId, 'profile-a')
  assert.equal(vllmEntry?.launchProfiles.length, 1)
  assert.equal(vllmEntry?.launchProfiles[0].profileId, 'profile-v')
})

test('mergeLaunchProfilesIntoEngines merges multiple profiles for the same engine', () => {
  const result = mergeLaunchProfilesIntoEngines(engines, [profileA, profileB])
  const llamaEntry = result.find((e) => e.id === 'llama.cpp')
  assert.equal(llamaEntry?.launchProfiles.length, 2)
  assert.equal(llamaEntry?.launchProfiles[0].profileId, 'profile-a')
  assert.equal(llamaEntry?.launchProfiles[1].profileId, 'profile-b')
})

test('mergeLaunchProfilesIntoEngines ignores profiles for engines not in the catalog', () => {
  const unknownProfile = { ...validProfile, profileId: 'p-unknown', engineId: 'tensorrt' }
  const result = mergeLaunchProfilesIntoEngines(engines, [unknownProfile])
  assert.ok(result.every((e) => e.launchProfiles.length === 0))
})

// ---------------------------------------------------------------------------
// validateProfileGpuBoundary
// ---------------------------------------------------------------------------

const GPU_BOUNDARY = [
  { label: 'CASE GPU', uuid: 'GPU-CASE-UUID', role: 'allowed: local model work' },
  { label: 'Protected GPU', uuid: 'GPU-PROT-UUID', role: 'protected: never use for model work' },
]

const profileForBoundary = {
  ...validProfile,
  gpuUuids: ['GPU-CASE-UUID'],
  gpuMode: 'single',
}

test('validateProfileGpuBoundary accepts a profile using only the allowed GPU', () => {
  const result = validateProfileGpuBoundary(profileForBoundary, GPU_BOUNDARY)
  assert.equal(result.ok, true)
})

test('validateProfileGpuBoundary rejects a profile that includes the protected GPU', () => {
  const profile = { ...profileForBoundary, gpuUuids: ['GPU-PROT-UUID'] }
  const result = validateProfileGpuBoundary(profile, GPU_BOUNDARY)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /protected GPU/)
  assert.match(result.reason, /GPU-PROT-UUID/)
})

test('validateProfileGpuBoundary rejects a profile referencing an unrecognized GPU UUID', () => {
  const profile = { ...profileForBoundary, gpuUuids: ['GPU-UNKNOWN'] }
  const result = validateProfileGpuBoundary(profile, GPU_BOUNDARY)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /unrecognized GPU/)
})

test('validateProfileGpuBoundary rejects when gpuBoundary is empty', () => {
  const result = validateProfileGpuBoundary(profileForBoundary, [])
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /no GPU boundary/)
})

test('validateProfileGpuBoundary treats entries without uuid or role as neither allowed nor protected', () => {
  const boundary = [{ label: 'No UUID', role: undefined }]
  const result = validateProfileGpuBoundary(profileForBoundary, boundary)
  assert.equal(result.ok, false)
  if (result.ok) return
  // GPU-CASE-UUID is unrecognized because the boundary has no valid allowed entry
  assert.match(result.reason, /unrecognized GPU/)
})

test('validateProfileGpuBoundary rejects gpuMode "both" when fewer than two UUIDs are listed', () => {
  const profile = { ...profileForBoundary, gpuMode: 'both', gpuUuids: ['GPU-CASE-UUID'] }
  const result = validateProfileGpuBoundary(profile, GPU_BOUNDARY)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /fewer than two GPU UUIDs/)
})

test('validateProfileGpuBoundary accepts gpuMode "both" when two allowed UUIDs are listed', () => {
  const boundaryWithTwo = [
    { label: 'GPU A', uuid: 'GPU-A', role: 'allowed: work' },
    { label: 'GPU B', uuid: 'GPU-B', role: 'allowed: work' },
  ]
  const profile = { ...profileForBoundary, gpuMode: 'both', gpuUuids: ['GPU-A', 'GPU-B'] }
  const result = validateProfileGpuBoundary(profile, boundaryWithTwo)
  assert.equal(result.ok, true)
})
