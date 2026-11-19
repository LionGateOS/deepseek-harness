/**
 * Unit tests for core/user-dirs.js: reading and writing the persistent
 * user-added GGUF discovery directories file. All I/O is injected via the
 * deps parameter; no real disk access.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readUserDirs, writeUserDirs, MAX_USER_DIRS } from '../core/user-dirs.js'

// --- readUserDirs ---

test('readUserDirs returns empty dirs when filePath is empty string', async () => {
  const result = await readUserDirs('')
  assert.deepEqual(result, { dirs: [] })
})

test('readUserDirs returns empty dirs when the file is missing (ENOENT)', async () => {
  const deps = {
    readFile: async () => { const e = new Error('not found'); e.code = 'ENOENT'; throw e },
  }
  const result = await readUserDirs('/nonexistent/file.json', deps)
  assert.deepEqual(result, { dirs: [] })
})

test('readUserDirs returns dirs from a valid version-1 file', async () => {
  const content = JSON.stringify({ version: 1, dirs: ['/models/a', '/models/b'] })
  const deps = { readFile: async () => content }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result, { dirs: ['/models/a', '/models/b'] })
})

test('readUserDirs returns empty dirs and readError when file is malformed JSON', async () => {
  const deps = { readFile: async () => 'not valid json{{{' }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, [])
  assert.ok(typeof result.readError === 'string' && result.readError.length > 0)
  assert.match(result.readError, /not valid JSON/)
})

test('readUserDirs returns empty dirs and readError when schema is not an object', async () => {
  const deps = { readFile: async () => JSON.stringify(['/models/a']) }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, [])
  assert.ok(typeof result.readError === 'string')
  assert.match(result.readError, /schema/)
})

test('readUserDirs returns empty dirs and readError for unrecognized schema version', async () => {
  const deps = { readFile: async () => JSON.stringify({ version: 99, dirs: ['/models/a'] }) }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, [])
  assert.ok(typeof result.readError === 'string')
  assert.match(result.readError, /version/)
})

test('readUserDirs silently drops non-absolute entries and keeps valid ones', async () => {
  const content = JSON.stringify({ version: 1, dirs: ['/valid/path', 'relative/path', 42, '/another/valid', null] })
  const deps = { readFile: async () => content }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, ['/valid/path', '/another/valid'])
  assert.equal(result.readError, undefined, 'no readError when file is otherwise valid')
})

test('readUserDirs returns empty dirs and readError when dirs field is missing', async () => {
  const deps = { readFile: async () => JSON.stringify({ version: 1 }) }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, [])
  assert.ok(typeof result.readError === 'string')
})

test('readUserDirs returns readError for unhandled read failures (not ENOENT)', async () => {
  const deps = {
    readFile: async () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e },
  }
  const result = await readUserDirs('/fake/file.json', deps)
  assert.deepEqual(result.dirs, [])
  assert.ok(typeof result.readError === 'string')
  assert.match(result.readError, /permission denied/)
})

// --- writeUserDirs ---

test('writeUserDirs writes valid JSON to a tmp file then renames it', async () => {
  const written = {}
  let renamed = false
  const deps = {
    writeFile: async (path, content) => { written.path = path; written.content = content },
    rename: async (from, to) => { renamed = true; assert.ok(from.endsWith('.tmp'), 'must write to .tmp first'); assert.ok(!to.endsWith('.tmp'), 'rename target must not be .tmp') },
    unlink: async () => {},
  }
  await writeUserDirs('/dest/file.json', ['/models/a', '/models/b'], deps)
  const parsed = JSON.parse(written.content)
  assert.equal(parsed.version, 1)
  assert.deepEqual(parsed.dirs, ['/models/a', '/models/b'])
  assert.ok(renamed, 'must rename tmp to dest')
})

test('writeUserDirs cleans up the tmp file when rename fails', async () => {
  let unlinked = false
  const deps = {
    writeFile: async () => {},
    rename: async () => { throw new Error('rename failed') },
    unlink: async () => { unlinked = true },
  }
  await assert.rejects(() => writeUserDirs('/dest/file.json', [], deps), /rename failed/)
  assert.ok(unlinked, 'tmp file must be cleaned up after rename failure')
})

// --- MAX_USER_DIRS ---

test('MAX_USER_DIRS is a positive integer', () => {
  assert.ok(typeof MAX_USER_DIRS === 'number' && Number.isInteger(MAX_USER_DIRS) && MAX_USER_DIRS > 0)
})
