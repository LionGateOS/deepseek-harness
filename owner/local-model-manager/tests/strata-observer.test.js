import test from 'node:test'
import assert from 'node:assert/strict'

import { readStrataStatus } from '../core/strata-observer.js'

test('Strata observer reports the selected model and GPU mode without control authority', async () => {
  const read = async (path) => path.endsWith('model-mode') ? 'iq3xxs\n' : 'gpu0\n'
  const status = await readStrataStatus({ read })

  assert.equal(status.authority, 'Strata Control Panel')
  assert.equal(status.control, 'read-only')
  assert.equal(status.endpoint, 'http://127.0.0.1:8080')
  assert.equal(status.installedModels.length, 2)
  assert.equal(status.modelSelection.status, 'ok')
  assert.equal(status.modelSelection.id, 'qwen3.8-flash-next-iq3_xxs')
  assert.equal(status.gpuSelection.status, 'ok')
  assert.equal(status.gpuSelection.key, 'gpu0')
  assert.deepEqual(status.gpuSelection.gpuIndexes, [0])
})

test('Strata observer identifies DeepSeek and both-GPU selection', async () => {
  const read = async (path) => path.endsWith('model-mode') ? 'deepseek\n' : 'gpu01\n'
  const status = await readStrataStatus({ read })

  assert.equal(status.modelSelection.id, 'deepseek-v4.1-flash')
  assert.equal(status.gpuSelection.label, 'RTX 3090 + RTX 3090 Ti')
  assert.deepEqual(status.gpuSelection.gpuIndexes, [0, 1])
})

test('Strata observer reports unreadable or unknown selections instead of guessing', async () => {
  const unknown = await readStrataStatus({
    read: async (path) => path.endsWith('model-mode') ? 'mystery\n' : 'gpu0\n',
  })
  assert.equal(unknown.modelSelection.status, 'unavailable')
  assert.match(unknown.modelSelection.error, /unrecognized/)

  const missing = await readStrataStatus({
    read: async () => { throw new Error('missing') },
  })
  assert.equal(missing.modelSelection.status, 'unavailable')
  assert.equal(missing.gpuSelection.status, 'unavailable')
})
