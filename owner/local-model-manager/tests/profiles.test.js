/**
 * Profile and recommendation coverage: context-per-slot math, the honest
 * Multiple-Jobs disablement, Long Research gating with pending-restart
 * detection, and the vLLM "not configured" labeling from real evidence only.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { contextPerSlot, validateSlots, profileAvailability, engineSupport, recommendations, readSlotsSupport } from '../core/profiles.js'

test('context-per-slot math never allows slots to shrink context below the profile need', () => {
  assert.equal(contextPerSlot(131072, 2), 65536)
  assert.equal(contextPerSlot(32769, 2), 16384)
  assert.equal(validateSlots(131072, 2, 'longResearch').ok, true)
  const reject = validateSlots(65536, 4, 'reliable')
  assert.equal(reject.ok, false)
  assert.match(reject.reason, /16384 tokens of context per job/)
  assert.match(reject.reason, /32768-token requirement/)
})

test('profiles label what is verified and explain every unavailable row', () => {
  // A model with 64k configured, live behind (pending restart).
  const pendingRow = profileAvailability({
    key: 'qwen35', name: 'Qwen3.5', provider: { contextWindow: 65536, reasoningEfforts: ['low', 'medium', 'high'] }, live: { liveContext: 32768 }, install: { installed: true },
  })
  const byId = Object.fromEntries(pendingRow.rows.map((row) => [row.id, row]))
  assert.equal(byId.reliable.available, true)
  assert.equal(byId.multipleJobs.available, false)
  assert.match(byId.multipleJobs.reason, /could not be read/)
  assert.doesNotMatch(byId.multipleJobs.reason, /approved launcher upgrade/, 'stale claim removed: launcher now has a slot switch')
  assert.equal(byId.longResearch.available, true)
  assert.equal(byId.longResearch.pendingRestart, true)
  assert.match(byId.longResearch.reason, /owner-approved restart/)
  assert.match(pendingRow.rows[0].reasoningNote, /low, medium, high/)

  // A model at 32k: Long Research is unavailable with the evidence quoted.
  const smallRow = profileAvailability({ key: 'x', name: 'X', provider: { contextWindow: 32768, reasoningEfforts: [] }, live: { liveContext: 32768 }, install: { installed: true } })
  const small = smallRow.rows.find((row) => row.id === 'longResearch')
  assert.equal(small.available, false)
  assert.match(small.reason, /32,768/)
  assert.match(smallRow.rows[0].reasoningNote, /reasoning disabled/)

  // Unknown configured context: unavailable, says "not readable" — not "below the minimum".
  const unknown = profileAvailability({ key: 'y', name: 'Y', install: { installed: true } }).rows.find((row) => row.id === 'longResearch')
  assert.equal(unknown.available, false)
  assert.match(unknown.reason, /not readable/)
  assert.doesNotMatch(unknown.reason, /below the/, 'unknown context must not be described as below the minimum')

  // Known context below minimum: explicitly says "below the minimum" with the number.
  const belowMin = profileAvailability({ key: 'z', name: 'Z', provider: { contextWindow: 32768 }, install: { installed: true } }).rows.find((row) => row.id === 'longResearch')
  assert.equal(belowMin.available, false)
  assert.match(belowMin.reason, /32,768/)
  assert.match(belowMin.reason, /below the/)
  assert.match(belowMin.reason, /65,536/)
})

test('engines stay honest: only llama.cpp is verified; vLLM is never claimed', () => {
  const detected = engineSupport({}, { existsVerdict: 'detected' }).find((b) => b.id === 'vllm')
  assert.equal(detected.status, 'not-configured')
  assert.match(detected.evidence, /installed/)
  assert.match(detected.note, /Not configured/)
  const absent = engineSupport({}, { existsVerdict: 'absent' }).find((b) => b.id === 'vllm')
  assert.match(absent.evidence, /not installed/)
})

test('recommendations cite real evidence and never invent facts', () => {
  const config = { caseGpuName: 'RTX 3090' }
  const notes = recommendations({
    key: 'qwen27', name: 'Qwen3.8 27B', provider: { contextWindow: 131072, reasoningEfforts: ['low', 'medium', 'xhigh'] },
    live: { liveContext: 131072 }, install: { installed: true, diskBytes: 300 }, vision: false, multiPart: false,
  }, config)
  assert.ok(notes.some((n) => n.includes('extra-high')))
  assert.ok(notes.some((n) => n.includes('very large context')))
  assert.ok(notes.every((n) => !n.includes('vLLM')))

  const missing = recommendations({ key: 'm', name: 'M', install: { installed: false, problem: 'model file not found' } }, config)
  assert.match(missing[0], /not installed/)

  const mismatch = recommendations({
    key: 'qwen35', name: 'Qwen3.5', provider: { contextWindow: 65536 }, live: { liveContext: 32768 }, install: { installed: true },
  }, config)
  assert.ok(mismatch.some((n) => n.includes('owner-approved restart')))
})

test('recommendations GPU text reflects allowedGpuUuids configuration and the no-default-reservation policy', () => {
  const tiUuid = 'GPU-PROT'
  // When the Ti UUID is not in allowedGpuUuids: single-GPU wording, no
  // GPU-Selection pointer, and no claim that any GPU is reserved.
  const configCaseOnly = { caseGpuName: 'RTX 3090', protectedGpuName: 'RTX 3090 Ti', protectedGpuUuid: tiUuid, allowedGpuUuids: ['GPU-CASE'] }
  const notesCaseOnly = recommendations({ key: 'q', name: 'Q', install: { installed: true } }, configCaseOnly)
  const gpuNoteCaseOnly = notesCaseOnly[notesCaseOnly.length - 1]
  assert.match(gpuNoteCaseOnly, /Runs on RTX 3090 only/)
  assert.match(gpuNoteCaseOnly, /No second GPU is configured as a launch target/)
  assert.doesNotMatch(gpuNoteCaseOnly, /GPU Selection/, 'should not mention GPU Selection when Ti not in allowedGpuUuids')

  // When the Ti UUID IS in allowedGpuUuids: preferred-target wording from the
  // 2026-10-23 policy — Ti first, RTX 3090 second, both profiles third, and
  // nothing reserved automatically.
  const configBothAllowed = { caseGpuName: 'RTX 3090', protectedGpuName: 'RTX 3090 Ti', protectedGpuUuid: tiUuid, allowedGpuUuids: ['GPU-CASE', tiUuid] }
  const notesBoth = recommendations({ key: 'q', name: 'Q', install: { installed: true } }, configBothAllowed)
  const gpuNoteBoth = notesBoth[notesBoth.length - 1]
  assert.match(gpuNoteBoth, /Preferred launch target: RTX 3090 Ti/)
  assert.match(gpuNoteBoth, /second choice/)
  assert.match(gpuNoteBoth, /Both-GPU profiles are third/)
  assert.match(gpuNoteBoth, /not reserved automatically/)
  assert.match(gpuNoteBoth, /manual lock/)
})

test('readSlotsSupport reads the launcher parallel-mode file and reports evidence-based slot support', () => {
  // No modeFile path → unknown
  assert.equal(readSlotsSupport({}).supported, undefined)

  // Injected reader returning null → unknown (missing or unreadable)
  assert.equal(readSlotsSupport({ modeFile: '/fake' }, () => null).supported, undefined)

  // Invalid content → unknown
  assert.equal(readSlotsSupport({ modeFile: '/fake' }, () => 'not-a-number').supported, undefined)

  // Mode value 1 → not supported (single-slot)
  const single = readSlotsSupport({ modeFile: '/fake' }, () => '1')
  assert.equal(single.supported, false)
  assert.equal(single.slots, 1)
  assert.equal(single.mode, 'single')
  assert.match(single.reason, /one job at a time/)
  assert.match(single.reason, /Strata Control Panel/)

  // Mode value 4 → supported, 4 slots
  const parallel = readSlotsSupport({ modeFile: '/fake' }, () => '4')
  assert.equal(parallel.supported, true)
  assert.equal(parallel.slots, 4)
  assert.equal(parallel.mode, 'parallel')
  assert.match(parallel.label, /PARALLEL \(4 conversations at once\)/)

  // Mode value with trailing newline → parses correctly
  const withNewline = readSlotsSupport({ modeFile: '/fake' }, () => '4\n')
  assert.equal(withNewline.supported, true)
  assert.equal(withNewline.slots, 4)

  // Maximum slot clamping: value above maxSlots clamps to maxSlots
  const big = readSlotsSupport({ modeFile: '/fake', maxSlots: 8 }, () => '100')
  assert.equal(big.supported, true)
  assert.equal(big.slots, 8)

  // Missing file on the real FS → unknown (no crash)
  const realMissing = readSlotsSupport({ modeFile: '/does/not/exist/parallel-mode' })
  assert.equal(realMissing.supported, undefined)
})

test('profileAvailability multipleJobs row reflects slot evidence from the launcher', () => {
  const baseModel = { key: 'q', name: 'Q', provider: { contextWindow: 65536 }, live: {}, install: { installed: true } }

  // Parallel mode (4 slots): available, names the mode, no fixed per-slot division claimed
  const parallelSlots = { supported: true, slots: 4, mode: 'parallel', label: 'PARALLEL (4 conversations at once)' }
  const parallelRow = profileAvailability({ ...baseModel, slots: parallelSlots }).rows.find((r) => r.id === 'multipleJobs')
  assert.equal(parallelRow.available, true)
  assert.match(parallelRow.reason, /PARALLEL \(4 conversations at once\)/)
  assert.equal(parallelRow.slots, 4)
  assert.equal(parallelRow.mode, 'parallel')
  assert.doesNotMatch(parallelRow.reason, /each slot.*token|per job.*token/, 'must not claim fixed per-slot context division')

  // Single-slot mode: unavailable, cites the specific launcher reason
  const singleSlots = { supported: false, slots: 1, mode: 'single', reason: 'The installed launcher has a slot switch and it is set to one job at a time. Open the Strata Control Panel, option 6, to allow several.' }
  const singleRow = profileAvailability({ ...baseModel, slots: singleSlots }).rows.find((r) => r.id === 'multipleJobs')
  assert.equal(singleRow.available, false)
  assert.match(singleRow.reason, /one job at a time/)
  assert.match(singleRow.reason, /Strata Control Panel/)

  // Unreadable evidence: fail-closed, honest reason
  const unknownRow = profileAvailability({ ...baseModel, slots: { supported: undefined } }).rows.find((r) => r.id === 'multipleJobs')
  assert.equal(unknownRow.available, false)
  assert.match(unknownRow.reason, /could not be read/)
})