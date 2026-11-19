/**
 * Context selections persistence tests: schema parsing, atomic writes,
 * manual-vs-automatic merge precedence, and restart persistence (a fresh
 * reader sees the same records a previous service wrote).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'

import { readContextSelections, writeContextSelections, mergeSelection, MANUAL_SOURCE, AUTO_SOURCE } from '../core/context-selections.js'

test('readContextSelections returns an empty map for a missing file or empty path', async () => {
  assert.deepEqual(await readContextSelections('/nonexistent/lmm-context-selections.json'), { selections: {} })
  assert.deepEqual(await readContextSelections(''), { selections: {} })
})

test('readContextSelections reports malformed files instead of guessing', async () => {
  assert.deepEqual((await readContextSelections('/fake/ctx.json', { readFile: async () => 'not-json' })).readError, 'file is not valid JSON')
  assert.deepEqual((await readContextSelections('/fake/ctx.json', { readFile: async () => '{"version":9}' })).readError, 'unrecognized schema version: 9')
  const dropped = await readContextSelections('/fake/ctx.json', { readFile: async () => JSON.stringify({ version: 1, selections: {
    good: { context: 65536, source: 'auto' },
    zero: { context: 0, source: 'auto' },
    fractional: { context: 1.5, source: 'auto' },
    stringy: { context: 'big', source: 'auto' },
  } }) })
  assert.deepEqual(Object.keys(dropped.selections), ['good'])
})

test('mergeSelection records an automatic selection and leaves identical records unwritten', () => {
  const { changed, next, record } = mergeSelection({}, 'qwen35', { selected: 65536, source: AUTO_SOURCE }, '2026-10-23T12:00:00.000Z')
  assert.equal(changed, true)
  assert.equal(record.source, 'auto')
  assert.equal(next.qwen35.context, 65536)
  const again = mergeSelection(next, 'qwen35', { selected: 65536, source: AUTO_SOURCE }, '2026-10-23T12:05:00.000Z')
  assert.equal(again.changed, false)
})

test('mergeSelection never replaces a manual override with an automatic selection', () => {
  const stored = { qwen35: { context: 49152, source: MANUAL_SOURCE, decidedAt: '2026-10-01T00:00:00.000Z' } }
  const merged = mergeSelection(stored, 'qwen35', { selected: 65536, source: AUTO_SOURCE }, '2026-10-23T12:00:00.000Z')
  assert.equal(merged.changed, false)
  assert.equal(merged.next.qwen35.context, 49152)
})

test('mergeSelection removes a stale automatic record but keeps a manual one when evidence disappears', () => {
  const stored = { orphan: { context: 4096, source: AUTO_SOURCE } }
  const gone = mergeSelection(stored, 'orphan', { selected: undefined, source: 'unavailable' }, 't')
  assert.equal(gone.changed, true)
  assert.equal(gone.next.orphan, undefined)
  const manual = { kept: { context: 8192, source: MANUAL_SOURCE } }
  const stillThere = mergeSelection(manual, 'kept', { selected: undefined, source: 'unavailable' }, 't')
  assert.equal(stillThere.changed, false)
  assert.equal(stillThere.next.kept.context, 8192)
})

test('context selections persist across a simulated restart (fresh reader, same file)', async () => {
  const filePath = join(tmpdir(), `lmm-sel-persist-${process.pid}-${Date.now()}.json`)
  try {
    await writeContextSelections(filePath, {
      qwen35: { context: 65536, source: AUTO_SOURCE, decidedAt: '2026-10-23T12:00:00.000Z' },
      vision: { context: 49152, source: MANUAL_SOURCE, decidedAt: '2026-10-23T11:00:00.000Z', reasons: ['owner hardware cap'] },
    })
    // A "restarted" service constructs fresh deps and reads the same path.
    const restarted = await readContextSelections(filePath, { readFile: (p, enc_) => readFile(p, enc_) })
    assert.equal(restarted.selections.qwen35.context, 65536)
    assert.equal(restarted.selections.qwen35.source, 'auto')
    assert.equal(restarted.selections.vision.context, 49152)
    assert.equal(restarted.selections.vision.source, 'manual')
    // The automatic path must keep honoring the manual override after restart.
    const merged = mergeSelection(restarted.selections, 'vision', { selected: 65536, source: AUTO_SOURCE }, '2026-10-23T13:00:00.000Z')
    assert.equal(merged.changed, false)
  } finally {
    await rm(filePath, { force: true })
  }
})

test('writeContextSelections cleans up its tmp file when the rename target is unwritable', async () => {
  const written = []
  await assert.rejects(
    () => writeContextSelections('/lmm-unwritable/ctx.json', {}, {
      writeFile: async (path, content) => { written.push(path) },
      rename: async () => { throw new Error('no such dir') },
      unlink: async (path) => { written.push(`unlinked:${path}`) },
    }),
    /no such dir/,
  )
  assert.match(written.join('|'), /unlinked:/)
})