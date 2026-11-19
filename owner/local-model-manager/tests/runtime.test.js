/**
 * Runtime probe coverage: running/stopped/unhealthy states, live context,
 * authoritative per-slot busy detection, and the explicit busyUnknown
 * contract that forces disruptive actions to fail closed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { probeServer } from '../core/runtime.js'

/** Build a fetch stub from path → response {code, body}. */
const fetchStub = (routes) => async (url) => {
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  const route = routes[path]
  if (route === undefined) {
    const error = new Error('connect ECONNREFUSED')
    error.name = 'TypeError'
    throw error
  }
  if (route.timeout === true) {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'
    throw error
  }
  if (route.code !== undefined) return { ok: false, json: async () => route.body, status: route.code }
  return { ok: true, json: async () => route.body }
}

const SLOT = { id: 0, n_ctx: 32768, is_processing: false, id_task: 1 }

test('a running server reports its model, live context, slots, and busy state', async () => {
  const server = await probeServer('http://127.0.0.1:8001', 100, {
    fetch: fetchStub({
      '/health': { body: { status: 'ok' } },
      '/v1/models': { body: { data: [{ id: '/m/a.gguf', meta: { n_ctx: 32768 } }] } },
      '/slots': { body: [SLOT] },
    }),
  })
  assert.equal(server.state, 'running')
  assert.equal(server.modelPath, '/m/a.gguf')
  assert.equal(server.liveContext, 32768)
  assert.deepEqual(server.slots, [{ id: 0, n_ctx: 32768, isProcessing: false }])
  assert.equal(server.busy, false)
  assert.equal(server.busyUnknown, false)
})

test('an actively processing slot is detected for the interruption warnings', async () => {
  const server = await probeServer('http://127.0.0.1:8001', 100, {
    fetch: fetchStub({
      '/health': { body: { status: 'ok' } },
      '/v1/models': { body: { data: [{ id: '/m/a.gguf', meta: { n_ctx: 65536 } }] } },
      '/slots': { body: [{ id: 0, n_ctx: 65536, is_processing: true, id_task: 42 }] },
    }),
  })
  assert.equal(server.busy, true)
  assert.deepEqual(server.slots[0], { id: 0, n_ctx: 65536, isProcessing: true, task: 42 })
})

test('a dead server reads as stopped, not as an error', async () => {
  const server = await probeServer('http://127.0.0.1:8001', 100, { fetch: fetchStub({}) })
  assert.equal(server.state, 'stopped')
  assert.equal(server.busyUnknown, false) // nothing runs, so there is nothing to detect
})

test('an HTTP-level failure while the port answers reads as unhealthy and fails closed', async () => {
  const server = await probeServer('http://127.0.0.1:8001', 100, {
    fetch: fetchStub({
      '/health': { code: 503, body: {} },
      '/v1/models': { body: { data: [{ id: '/m/a.gguf' }] } },
      '/slots': { body: [SLOT] },
    }),
  })
  assert.equal(server.state, 'unhealthy')
  assert.equal(server.busyUnknown, true)
  assert.match(server.error, /HTTP 503/)
})

test('an unreadable /slots endpoint keeps busy state explicitly unknown (fail-closed)', async () => {
  const server = await probeServer('http://127.0.0.1:8001', 100, {
    fetch: fetchStub({
      '/health': { body: { status: 'ok' } },
      '/v1/models': { body: { data: [{ id: '/m/a.gguf', meta: { n_ctx: 32768 } }] } },
      '/slots': { timeout: true },
    }),
  })
  assert.equal(server.state, 'running')
  assert.equal(server.busyUnknown, true)
  assert.equal(server.busy, undefined)
  assert.match(server.error, /aborted|timeout/i)
})