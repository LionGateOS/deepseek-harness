/**
 * Catalog coverage: installed-state verification, the provider-facts helper
 * (read-only python3 YAML extraction), and bounded failure for unreadable
 * provider files, unknown models, and malformed helper output.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readProviderFacts, verifyInstalled } from '../core/catalog.js'

/** Minimal spawn stub that emits given stdout and exits with `code`. */
const spawnStub = (stdout, code = 0, error = undefined) => (bin, args, _opts) => ({
  stdout: { on: (_evt, cb) => { if (stdout !== '') cb(Buffer.from(stdout)) } },
  on: (evt, cb) => {
    if (evt === 'error' && error !== undefined) cb(error)
    if (evt === 'close') cb(code)
  },
})

const CONFIG = {
  providerPatchPath: '/x/cordis.patch.yml',
  settingsPath: '/x/settings.yaml',
  probeTimeoutMs: 5000,
}

test('verifyInstalled reports installed size, missing files, and unreadable paths separately', async () => {
  const models = [{ key: 'a', ggufPath: '/a.gguf' }, { key: 'b', ggufPath: '/b.gguf' }, { key: 'c', ggufPath: '/c.gguf' }]
  const stat = async (path) => {
    if (path === '/a.gguf') return { isFile: () => true, size: 29360128000 }
    if (path === '/b.gguf') { const e = new Error('x'); e.code = 'ENOENT'; throw e }
    const e = new Error('x'); e.code = 'EACCES'; throw e
  }
  const result = await verifyInstalled(models, { stat })
  assert.equal(result.a.installed, true)
  assert.equal(result.a.diskBytes, 29360128000)
  assert.equal(result.b.installed, false)
  assert.match(result.b.problem, /not found/)
  assert.equal(result.c.installed, false)
  assert.match(result.c.problem, /EACCES/)
})

test('readProviderFacts maps helper JSON to per-path facts and names failures', async () => {
  const payload = {
    source: 'provider-config',
    models: {
      '/a.gguf': { contextWindow: 131072, reasoningEfforts: ['low', 'xhigh'], input: ['text'] },
      '/b.gguf': { reasoningEfforts: [] },
    },
  }
  const ok = await readProviderFacts(CONFIG, { spawn: spawnStub(JSON.stringify(payload)) })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.byPath['/a.gguf'].contextWindow, 131072)
  assert.deepEqual(ok.byPath['/a.gguf'].reasoningEfforts, ['low', 'xhigh'])
  assert.deepEqual(ok.byPath['/b.gguf'].reasoningEfforts, [])

  const empty = await readProviderFacts(CONFIG, { spawn: spawnStub(JSON.stringify({ source: null, models: {} })) })
  assert.equal(empty.status, 'ok')
  assert.deepEqual(empty.byPath, {})

  const badJson = await readProviderFacts(CONFIG, { spawn: spawnStub('not json') })
  assert.equal(badJson.status, 'unavailable')
  assert.match(badJson.error, /JSON/)

  const failed = await readProviderFacts(CONFIG, { spawn: spawnStub('', 3) })
  assert.equal(failed.status, 'unavailable')
  assert.match(failed.error, /exited 3/)

  const crashed = await readProviderFacts(CONFIG, { spawn: spawnStub('', 0, new Error('python missing')) })
  assert.equal(crashed.status, 'unavailable')
  assert.match(crashed.error, /python missing/)
})

/** A spawn stub whose child never closes: the helper must time out. */
const hangingSpawn = (bin, args, opts) => ({ stdout: { on: () => {} }, on: () => {} })

test('readProviderFacts fails bounded when the helper hangs', async () => {
  // Shorten the wait by intercepting the timeout through a tiny probe config.
  const result = await readProviderFacts({ ...CONFIG, probeTimeoutMs: 1 }, { spawn: hangingSpawn })
  assert.equal(result.status, 'unavailable')
  assert.match(result.error, /timed out/)
})