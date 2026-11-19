/**
 * Durable manual-launch-reservation state coverage: absence means unreserved,
 * malformed files degrade loudly to unreserved, schema drift refuses, writes
 * are atomic and bounded, and round-tripping preserves the owner's entries.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readGpuLaunchState, writeGpuLaunchState, GPU_LAUNCH_STATE_VERSION } from '../core/gpu-launch-state.js'

/** In-memory fs stub recording writes so atomicity and content are visible. */
const makeFs = (files = {}) => {
  const writes = []
  const unlinks = []
  const renames = []
  let failWrites = false
  return {
    fs: {
      readFileSync: (path) => {
        if (!(path in files)) { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }
        return files[path]
      },
      unlinkSync: (path) => { unlinks.push(path) },
      writeFileSync: (path, data) => {
        if (failWrites) throw new Error('disk full')
        writes.push({ path, data })
        files[path] = data
      },
      renameSync: (from, to) => {
        if (!(from in files)) throw new Error(`missing temp file: ${from}`)
        renames.push({ from, to })
        files[to] = files[from]
        delete files[from]
      },
    },
    writes,
    unlinks,
    renames,
    setFailWrites: (v) => { failWrites = v },
    files,
  }
}

test('a missing state file means every GPU is unreserved', () => {
  const { fs } = makeFs()
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state, { reservations: [] })
})

test('a state file that cannot be read is still the unreserved state, loudly', () => {
  const fs = {
    readFileSync: () => { throw Object.assign(new Error('EACCES vibes'), { code: 'EACCES' }) },
  }
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, [])
  assert.match(state.readError, /could not read the GPU launch reservation file/)
})

test('a stored reservation round-trips through the file', () => {
  const doc = JSON.stringify({ version: GPU_LAUNCH_STATE_VERSION, reservations: ['GPU-A', 'GPU-B'], updatedAt: '2026-10-23T00:00:00.000Z' })
  const { fs } = makeFs({ '/x/gpu-launch-state.json': doc })
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, ['GPU-A', 'GPU-B'])
})

test('unparseable JSON degrades to unreserved and reports the read error', () => {
  const { fs } = makeFs({ '/x/gpu-launch-state.json': 'not json {' })
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, [])
  assert.equal(state.readError, 'file is not valid JSON')
})

test('an unrecognized schema version degrades to unreserved with a loud record', () => {
  const { fs } = makeFs({ '/x/gpu-launch-state.json': JSON.stringify({ version: 99, reservations: ['GPU-A'] }) })
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, [])
  assert.match(state.readError, /unrecognized schema version: 99/)
})

test('a non-list reservations field degrades to unreserved', () => {
  const { fs } = makeFs({ '/x/gpu-launch-state.json': JSON.stringify({ version: GPU_LAUNCH_STATE_VERSION, reservations: 'GPU-A' }) })
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, [])
  assert.equal(state.readError, 'reservations must be a list of UUIDs')
})

test('malformed entries are dropped and counted, never silently kept', () => {
  const doc = JSON.stringify({ version: GPU_LAUNCH_STATE_VERSION, reservations: [42, 'x'.repeat(129), 'GPU-A', 'GPU-A', null] })
  const { fs } = makeFs({ '/x/gpu-launch-state.json': doc })
  const state = readGpuLaunchState('/x/gpu-launch-state.json', fs)
  assert.deepEqual(state.reservations, ['GPU-A'], 'only the valid, de-duplicated entry survives')
  assert.match(state.readError, /dropped 4 malformed reservation entr/)
})

test('writes are atomic: a temp file lands first and is renamed into place', () => {
  const stub = makeFs()
  writeGpuLaunchState('/x/gpu-launch-state.json', ['GPU-A'], stub.fs)
  assert.equal(stub.writes.length, 1)
  assert.match(stub.writes[0].path, /^\/x\/gpu-launch-state\.json\.tmp-/, 'the temp file must land beside the target before the rename')
  assert.equal(stub.renames.length, 1, 'the finished temp file must be renamed into place')
  assert.equal(stub.renames[0].to, '/x/gpu-launch-state.json')
  const doc = JSON.parse(stub.files['/x/gpu-launch-state.json'])
  assert.equal(doc.version, GPU_LAUNCH_STATE_VERSION)
  assert.deepEqual(doc.reservations, ['GPU-A'])
  assert.ok(typeof doc.updatedAt === 'string')
})

test('a failed rename is rolled back by unlinking the temp file and throws', () => {
  const stub = makeFs({ '/x/gpu-launch-state.json': 'sentinel' })
  stub.files['/x/gpu-launch-state.json.tmp-will-fail'] = 'pending'
  const failingRename = (_from, _to) => { throw new Error('rename interrupted') }
  assert.throws(() => writeGpuLaunchState('/x/gpu-launch-state.json', ['GPU-A'], { ...stub.fs, renameSync: failingRename }), /rename interrupted/)
  assert.equal(stub.unlinks.length, 1, 'the temp file must be unlinked so the final file is untouched')
})

test('a reservation list that exceeds the cap is refused', () => {
  const stub = makeFs()
  const many = Array.from({ length: 9 }, (_, i) => `GPU-${i}`)
  assert.throws(() => writeGpuLaunchState('/x/gpu-launch-state.json', many, stub.fs), /at most 8/)
})

test('an empty destination uuid list writes the same unreserved shape it reads back', () => {
  const stub = makeFs()
  writeGpuLaunchState('/x/gpu-launch-state.json', [], stub.fs)
  const state = readGpuLaunchState('/x/gpu-launch-state.json', stub.fs)
  assert.deepEqual(state, { reservations: [] }, 'an explicit unlock persists as an empty list: nothing re-reserves a GPU')
})
