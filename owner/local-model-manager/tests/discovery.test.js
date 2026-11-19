/**
 * GGUF discovery scanner coverage: candidate detection, exclusion of managed
 * paths and companion files, multi-shard grouping, root error handling, subdir
 * errors, truncation, and atomic cache write with cleanup on failure.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { scanRootDir, buildDiscoveryResult, writeDiscoveryCache } from '../core/discovery.js'

/** Minimal Dirent-like stub accepted by the scanner. */
const file = (name) => ({ name, isFile: () => true, isDirectory: () => false })
const dir = (name) => ({ name, isFile: () => false, isDirectory: () => true })

/** stat stub returning a fixed size for any path. */
const statOk = (size = 1000) => async () => ({ size })

/** stat stub that throws ENOENT for every path. */
const statMissing = () => async (path) => {
  const e = Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  throw e
}

// ─── scanRootDir ─────────────────────────────────────────────────────────────

test('scanRootDir returns empty candidates for an empty directory', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async () => [],
    stat: statOk(),
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.subdirErrors, [])
  assert.equal(result.truncated, false)
})

test('scanRootDir returns a candidate for a new single-file GGUF at root level', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async (dir) => {
      if (dir === '/root') return [file('new-model-Q4_K_M.gguf')]
      return []
    },
    stat: statOk(5000000000),
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].path, '/root/new-model-Q4_K_M.gguf')
  assert.equal(result.candidates[0].name, 'new-model-Q4_K_M')
  assert.equal(result.candidates[0].sizeBytes, 5000000000)
  assert.equal(result.candidates[0].multiPart, false)
  assert.equal(result.candidates[0].totalShards, 1)
})

test('scanRootDir excludes files whose paths are in knownPaths', async () => {
  const knownPaths = new Set(['/root/managed.gguf'])
  const result = await scanRootDir('/root', knownPaths, new Set(), {
    readdir: async () => [file('managed.gguf'), file('new.gguf')],
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].name, 'new')
})

test('scanRootDir excludes files whose paths are in mmprojPaths', async () => {
  const mmprojPaths = new Set(['/root/mmproj.gguf'])
  const result = await scanRootDir('/root', new Set(), mmprojPaths, {
    readdir: async () => [file('mmproj.gguf'), file('model.gguf')],
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].name, 'model')
})

test('scanRootDir finds candidates in immediate subdirectories', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async (p) => {
      if (p === '/root') return [dir('subA')]
      if (p === '/root/subA') return [file('deep-model.gguf')]
      return []
    },
    stat: statOk(2000),
  })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].path, '/root/subA/deep-model.gguf')
})

test('scanRootDir groups multi-shard files: known shard-1 excludes entire group', async () => {
  const known = new Set(['/root/sub/Flash-00001-of-00003.gguf'])
  const result = await scanRootDir('/root', known, new Set(), {
    readdir: async (p) => {
      if (p === '/root') return [dir('sub')]
      if (p === '/root/sub') return [
        file('Flash-00001-of-00003.gguf'),
        file('Flash-00002-of-00003.gguf'),
        file('Flash-00003-of-00003.gguf'),
      ]
      return []
    },
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 0, 'all shards excluded because shard-1 is managed')
})

test('scanRootDir groups multi-shard files: unknown shard-1 reports only shard-1 as candidate', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async (p) => {
      if (p === '/root') return [dir('sub')]
      if (p === '/root/sub') return [
        file('NewModel-00001-of-00002.gguf'),
        file('NewModel-00002-of-00002.gguf'),
      ]
      return []
    },
    stat: statOk(8000),
  })
  assert.equal(result.candidates.length, 1, 'only shard-1 reported')
  assert.equal(result.candidates[0].path, '/root/sub/NewModel-00001-of-00002.gguf')
  assert.equal(result.candidates[0].name, 'NewModel')
  assert.equal(result.candidates[0].multiPart, true)
  assert.equal(result.candidates[0].totalShards, 2)
  assert.equal(result.candidates[0].sizeBytes, 8000)
})

test('scanRootDir skips a shard group with no shard-1 (incomplete set)', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async (p) => {
      if (p === '/root') return [dir('sub')]
      if (p === '/root/sub') return [
        file('Partial-00002-of-00003.gguf'),
        file('Partial-00003-of-00003.gguf'),
      ]
      return []
    },
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 0, 'incomplete shard set produces no candidate')
})

test('scanRootDir returns status not-found for a missing root', async () => {
  const result = await scanRootDir('/nonexistent', new Set(), new Set(), {
    readdir: async () => { const e = Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); throw e },
    stat: statOk(),
  })
  assert.equal(result.status, 'not-found')
  assert.deepEqual(result.candidates, [])
})

test('scanRootDir returns status access-denied for EACCES', async () => {
  const result = await scanRootDir('/locked', new Set(), new Set(), {
    readdir: async () => { const e = Object.assign(new Error('EACCES'), { code: 'EACCES' }); throw e },
    stat: statOk(),
  })
  assert.equal(result.status, 'access-denied')
})

test('scanRootDir collects subdir read errors without failing the root scan', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async (p) => {
      if (p === '/root') return [dir('bad'), dir('good')]
      if (p === '/root/bad') { const e = Object.assign(new Error('EACCES'), { code: 'EACCES' }); throw e }
      if (p === '/root/good') return [file('ok.gguf')]
      return []
    },
    stat: statOk(),
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.subdirErrors.length, 1)
  assert.match(result.subdirErrors[0].path, /bad/)
})

test('scanRootDir records a subdirError when stat fails for a candidate file', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async () => [file('broken.gguf')],
    stat: statMissing(),
  })
  assert.equal(result.candidates.length, 0)
  assert.equal(result.subdirErrors.length, 1)
  assert.match(result.subdirErrors[0].path, /broken/)
})

test('scanRootDir sets truncated true and stops at MAX_CANDIDATES_PER_ROOT', async () => {
  const manyFiles = Array.from({ length: 250 }, (_, i) => file(`model${i}.gguf`))
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async () => manyFiles,
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 200)
  assert.equal(result.truncated, true)
})

test('scanRootDir ignores non-gguf files', async () => {
  const result = await scanRootDir('/root', new Set(), new Set(), {
    readdir: async () => [file('config.yaml'), file('README.md'), file('model.gguf'), file('model.GGUF')],
    stat: statOk(),
  })
  assert.equal(result.candidates.length, 2, 'both .gguf and .GGUF extensions accepted')
})

// ─── buildDiscoveryResult ────────────────────────────────────────────────────

test('buildDiscoveryResult returns version 1 result with correct structure', async () => {
  const result = await buildDiscoveryResult([], new Set(), new Set(), {
    now: () => '2026-10-22T00:00:00.000Z',
  })
  assert.equal(result.version, 1)
  assert.equal(result.generatedAt, '2026-10-22T00:00:00.000Z')
  assert.deepEqual(result.roots, [])
})

test('buildDiscoveryResult scans multiple roots independently', async () => {
  const readdir = async (p) => {
    if (p === '/a') return [file('a.gguf')]
    if (p === '/b') return [file('b.gguf')]
    return []
  }
  const result = await buildDiscoveryResult(['/a', '/b'], new Set(), new Set(), {
    readdir, stat: statOk(), now: () => 't',
  })
  assert.equal(result.roots.length, 2)
  assert.equal(result.roots[0].root, '/a')
  assert.equal(result.roots[0].candidates.length, 1)
  assert.equal(result.roots[1].root, '/b')
  assert.equal(result.roots[1].candidates.length, 1)
})

// ─── writeDiscoveryCache ─────────────────────────────────────────────────────

test('writeDiscoveryCache writes valid JSON and renames atomically', async () => {
  const written = {}
  const renamed = {}
  const result = { version: 1, generatedAt: 't', roots: [] }
  await writeDiscoveryCache('/dest/cache.json', result, {
    writeFile: async (path, data) => { written.path = path; written.data = data },
    rename: async (src, dst) => { renamed.from = src; renamed.to = dst },
    unlink: async () => {},
  })
  assert.equal(written.path, '/dest/cache.json.tmp')
  assert.equal(renamed.from, '/dest/cache.json.tmp')
  assert.equal(renamed.to, '/dest/cache.json')
  const parsed = JSON.parse(written.data)
  assert.equal(parsed.version, 1)
})

test('writeDiscoveryCache unlinks the tmp file when rename fails and rethrows', async () => {
  let unlinked = false
  await assert.rejects(
    writeDiscoveryCache('/dest/cache.json', { version: 1 }, {
      writeFile: async () => {},
      rename: async () => { throw new Error('rename failed') },
      unlink: async () => { unlinked = true },
    }),
    /rename failed/,
  )
  assert.equal(unlinked, true, 'tmp file must be cleaned up after rename failure')
})
