/**
 * Context sizer unit tests: the pure selection decision over every evidence
 * bound, manual override precedence, the DSH usable-budget reservation, and
 * the runtime context argv. All software-only.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { selectContext, dshUsableContext, contextArgv, conflictingContextFlag } from '../core/context-sizer.js'

// ---------------------------------------------------------------------------
// selectContext
// ---------------------------------------------------------------------------

test('selectContext selects the configured 65536 usable context when all bounds agree', () => {
  const result = selectContext({ advertised: 65536, configured: 65536 })
  assert.equal(result.selected, 65536)
  assert.equal(result.source, 'auto')
})

test('selectContext does not raise above the configured value when the model advertises more', () => {
  const result = selectContext({ advertised: 262144, configured: 65536 })
  assert.equal(result.selected, 65536)
  assert.equal(result.source, 'auto')
  assert.deepEqual(result.reasons, [])
})

test('selectContext lowers the configured value to the advertised bound when the model advertises less', () => {
  const result = selectContext({ advertised: 32768, configured: 65536 })
  assert.equal(result.selected, 32768)
  assert.match(result.reasons.join(' '), /advertises 32768/)
})

test('selectContext applies a hardware cap that forces a smaller practical context', () => {
  const result = selectContext({ advertised: 131072, configured: 131072, hardwareCap: 32768 })
  assert.equal(result.selected, 32768)
  assert.match(result.reasons.join(' '), /hardware cap \(32768\)/)
})

test('selectContext honors a manual override as the winning bound', () => {
  const result = selectContext({ advertised: 65536, configured: 65536, hardwareCap: 32768, override: 49152 })
  assert.equal(result.selected, 49152)
  assert.equal(result.source, 'manual')
})

test('selectContext preserves a manual override that exceeds other bounds but records the conflict', () => {
  const result = selectContext({ advertised: 32768, configured: 32768, override: 131072 })
  assert.equal(result.selected, 131072)
  assert.equal(result.source, 'manual')
  assert.match(result.reasons.join(' '), /exceeds the advertised context 32768/)
})

test('selectContext ignores an invalid manual override and falls back to the automatic path', () => {
  const result = selectContext({ configured: 65536, override: 0 })
  assert.equal(result.selected, 65536)
  assert.equal(result.source, 'auto')
  assert.match(result.reasons.join(' '), /manual override/)
})

test('selectContext reports unavailable when no evidence is readable', () => {
  const result = selectContext({})
  assert.equal(result.selected, undefined)
  assert.equal(result.source, 'unavailable')
  assert.match(result.reasons.join(' '), /no context evidence/)
})

test('selectContext ignores non-integer garbage bounds', () => {
  const result = selectContext({ configured: 'big', advertised: 4.5 })
  assert.equal(result.selected, undefined)
  assert.equal(result.source, 'unavailable')
})

// ---------------------------------------------------------------------------
// dshUsableContext
// ---------------------------------------------------------------------------

test('dshUsableContext subtracts the output reservation and headroom from the window', () => {
  const usable = dshUsableContext(65536, { reservedOutputTokens: 8192, headroomTokens: 16384 })
  assert.equal(usable.usable, 40960)
  assert.equal(usable.exhausted, false)
})

test('dshUsableContext reports exhaustion when reserves consume the whole window', () => {
  const usable = dshUsableContext(16384, { reservedOutputTokens: 8192, headroomTokens: 16384 })
  assert.equal(usable.usable, undefined)
  assert.equal(usable.exhausted, true)
})

test('dshUsableContext is undefined for an unusable window', () => {
  const usable = dshUsableContext(undefined, { reservedOutputTokens: 8192, headroomTokens: 16384 })
  assert.equal(usable.usable, undefined)
  assert.equal(usable.exhausted, undefined)
})

// ---------------------------------------------------------------------------
// contextArgv and conflictingContextFlag
// ---------------------------------------------------------------------------

test('contextArgv builds the last-wins -c pin for a positive context', () => {
  assert.deepEqual(contextArgv(65536), ['-c', '65536'])
})

test('contextArgv is empty for an unset or invalid context', () => {
  assert.deepEqual(contextArgv(undefined), [])
  assert.deepEqual(contextArgv(0), [])
  assert.deepEqual(contextArgv(-5), [])
})

test('conflictingContextFlag detects -c and --ctx-size and their = forms', () => {
  assert.equal(conflictingContextFlag(['-c', '4096']), '-c')
  assert.equal(conflictingContextFlag(['--ctx-size=8192']), '--ctx-size')
  assert.equal(conflictingContextFlag(['-c=4096']), '-c')
  assert.equal(conflictingContextFlag(['--flash-attn', 'on']), undefined)
  assert.equal(conflictingContextFlag([]), undefined)
})