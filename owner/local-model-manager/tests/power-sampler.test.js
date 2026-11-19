/**
 * Sampler coverage: the bounded ring, per-sample attribution evidence, the
 * timer that a lifecycle owner starts and stops, and the job window inferred
 * from observed card activity. The clock and timer are injected so every test
 * is deterministic and no test waits on wall time.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PowerRing, buildRecord, sampleOnce, createSampler, activeWindow, DEFAULT_CAPACITY, DEFAULT_INTERVAL_MS,
} from '../core/power-sampler.js'

/** A GPU query result with one card and one compute process. */
const queryResult = (watts, { pid = 555, uuid = 'GPU-TI', util = 90 } = {}) => ({
  status: 'ok',
  gpus: [{ uuid, powerDrawW: watts, powerLimitW: 340, utilizationPct: util }],
  processes: [{ uuid, pid, processName: 'strata-dsv41' }],
})

test('the ring keeps the newest records and drops the oldest', () => {
  const ring = new PowerRing(3)
  for (let i = 1; i <= 5; i += 1) ring.push({ t: i })
  assert.equal(ring.size, 3)
  assert.equal(ring.capacity, 3)
  assert.deepEqual(ring.all().map((record) => record.t), [3, 4, 5])
  assert.equal(ring.oldestAt(), 3)
})

test('the ring rejects an unbounded configuration', () => {
  assert.throws(() => new PowerRing(0), /positive integer/)
  assert.throws(() => new PowerRing(-1), /positive integer/)
  assert.throws(() => new PowerRing(1.5), /positive integer/)
})

test('the default capacity is two hours at one sample per second', () => {
  assert.equal(DEFAULT_CAPACITY, 7200)
  assert.equal(DEFAULT_INTERVAL_MS, 1000)
  assert.equal(DEFAULT_CAPACITY * DEFAULT_INTERVAL_MS, 7_200_000)
})

test('a record keeps the attribution evidence a job costing needs', () => {
  const record = buildRecord(1234, queryResult(212.5, { pid: 4242 }))
  assert.deepEqual(record, {
    t: 1234,
    gpus: [{ uuid: 'GPU-TI', watts: 212.5, limitW: 340, utilPct: 90 }],
    processes: [{ uuid: 'GPU-TI', pid: 4242, processName: 'strata-dsv41' }],
  })
})

test('an unreadable wattage is null, never zero', () => {
  const record = buildRecord(1, {
    status: 'ok',
    gpus: [{ uuid: 'GPU-TI', powerDrawW: null, powerLimitW: 340, utilizationPct: null }],
    processes: [],
  })
  assert.equal(record.gpus[0].watts, null)
  assert.equal(record.gpus[0].utilPct, null)
})

test('process identity is re-read every sample, so a restart is observed', async () => {
  const ring = new PowerRing(10)
  let pid = 100
  const query = async () => queryResult(200, { pid: pid++ })
  await sampleOnce(ring, query, () => 1000)
  await sampleOnce(ring, query, () => 2000)
  assert.deepEqual(ring.all().map((record) => record.processes[0].pid), [100, 101])
})

test('a failed query keeps no record at all', async () => {
  const ring = new PowerRing(10)
  const kept = await sampleOnce(ring, async () => ({ status: 'unavailable', error: 'no driver' }), () => 1)
  assert.equal(kept, false)
  assert.equal(ring.size, 0)
})

test('the sampler stops its timer through the handle it owns', async () => {
  let armed = null
  let cancelled = 0
  const sampler = createSampler({
    ring: new PowerRing(10),
    query: async () => queryResult(200),
    schedule: (fn) => { armed = fn; return 7 },
    cancel: (handle) => { assert.equal(handle, 7); cancelled += 1 },
    now: () => 1000,
  })
  sampler.start()
  assert.equal(sampler.running(), true)
  assert.equal(typeof armed, 'function')
  await sampler.stop()
  assert.equal(sampler.running(), false)
  assert.equal(cancelled, 1)
  await sampler.stop()
  assert.equal(cancelled, 1, 'stop must be idempotent')
})

test('stop waits for an in-flight sample instead of abandoning it', async () => {
  let release = null
  const sampler = createSampler({
    ring: new PowerRing(10),
    query: () => new Promise((resolve) => { release = () => resolve(queryResult(200)) }),
    schedule: () => 1,
    cancel: () => {},
    now: () => 1000,
  })
  sampler.start()
  const stopped = sampler.stop()
  release()
  await stopped
  assert.equal(sampler.running(), false)
})

test('a job window starts when the card begins working and ends when it stops', () => {
  const ring = new PowerRing(100)
  const t0 = 1_000_000
  for (let i = 0; i < 10; i += 1) {
    ring.push({ t: t0 + i * 1000, gpus: [{ uuid: 'GPU-TI', watts: 60, limitW: 340, utilPct: 0 }], processes: [] })
  }
  for (let i = 10; i < 20; i += 1) {
    ring.push({ t: t0 + i * 1000, gpus: [{ uuid: 'GPU-TI', watts: 300, limitW: 340, utilPct: 95 }], processes: [{ uuid: 'GPU-TI', pid: 555, processName: 'strata-dsv41' }] })
  }
  const window = activeWindow(ring, 'GPU-TI')
  assert.equal(window.startedAt, t0 + 10_000)
  assert.equal(window.lastBusyAt, t0 + 19_000)
  assert.deepEqual(window.distinctPids, [555])
  assert.equal(window.sampleCount, 10)
})

test('a card that never worked has no window', () => {
  const ring = new PowerRing(10)
  ring.push({ t: 1, gpus: [{ uuid: 'GPU-3090', watts: 30, limitW: 260, utilPct: 0 }], processes: [] })
  assert.equal(activeWindow(ring, 'GPU-3090'), null)
})

test('the window reports the pids it actually observed, including a change', () => {
  const ring = new PowerRing(10)
  for (let i = 0; i < 5; i += 1) {
    ring.push({ t: 1000 + i * 1000, gpus: [{ uuid: 'X', watts: 300, limitW: 340, utilPct: 99 }], processes: [{ uuid: 'X', pid: i < 3 ? 100 : 200, processName: 'engine' }] })
  }
  const window = activeWindow(ring, 'X')
  assert.deepEqual(window.distinctPids.sort(), [100, 200])
})
