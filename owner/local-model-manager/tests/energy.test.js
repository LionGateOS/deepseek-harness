/**
 * Energy integration coverage: trapezoidal energy over timestamped samples,
 * splitting at tariff boundaries, refusing to bridge a sampling gap, reporting
 * coverage honestly, and classifying who the measurement can be attributed to.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  intervalWh, costCents, centsPerHour, usableSamples, integrate, classifyAttribution, DEFAULT_MAX_GAP_MS,
} from '../core/energy.js'

const ms = (iso) => Date.parse(iso)

/** A steady 1 Hz series of `watts` across `[from, to]`. */
const steady = (fromMs, toMs, watts) => {
  const samples = []
  for (let t = fromMs; t <= toMs; t += 1000) samples.push({ t, watts })
  return samples
}

test('a constant draw integrates to watts x hours', () => {
  assert.equal(intervalWh(100, 0, 3600_000), 100) // 100 W for one hour
  assert.equal(intervalWh(200, 0, 1800_000), 100)
  assert.equal(intervalWh(100, 1000, 1000), 0) // no span, no energy
})

test('cost is the energy at the published rate, in cents', () => {
  assert.equal(costCents(1000, 14.6), 14.6) // 1 kWh at 14.6 c/kWh
  assert.equal(costCents(100, 9.1), 0.91)
})

test('a steady job over an hour reports its energy and cost', () => {
  const from = ms('2026-11-06T17:00:00Z') // 12:00 EST, mid-peak all hour
  const to = from + 3600_000
  const result = integrate(steady(from, to, 100), from, to)
  assert.equal(Math.round(result.wh * 100) / 100, 100)
  assert.equal(Math.round(result.cents * 1000) / 1000, 1.46)
  assert.equal(result.coverage, 1)
  assert.equal(result.gapMs, 0)
})

test('a job crossing a tariff boundary is priced at each rate for its own share', () => {
  // 06:50 to 07:10 EST crosses the on-peak start at 07:00 (=12:00Z).
  const from = ms('2026-11-06T11:50:00Z')
  const to = ms('2026-11-06T12:10:00Z')
  const result = integrate(steady(from, to, 300), from, to)
  assert.equal(Math.round(result.wh), 100)
  assert.deepEqual(result.pieces.map((piece) => piece.period), ['off-peak', 'on-peak'])
  // 50 Wh at 9.1 c/kWh plus 50 Wh at 18.9 c/kWh.
  assert.equal(Math.round(result.cents * 10000) / 10000, 1.4)
  assert.equal(Math.round(result.pieces[0].wh), 50)
  assert.equal(Math.round(result.pieces[1].wh), 50)
})

test('consecutive samples at one rate collapse into a single piece', () => {
  const from = ms('2026-11-06T17:00:00Z')
  const to = from + 600_000
  const result = integrate(steady(from, to, 250), from, to)
  assert.equal(result.pieces.length, 1, 'a ten-minute job at 1 Hz must not produce hundreds of pieces')
})

test('a hole longer than the gap threshold is a gap, never an interpolation', () => {
  const from = ms('2026-11-06T17:00:00Z')
  const to = from + 120_000
  // Sample, then the sampler is absent for 60 s, then it returns.
  const samples = [{ t: from, watts: 300 }, { t: from + 1000, watts: 300 }, { t: to, watts: 300 }]
  const result = integrate(samples, from, to)
  assert.ok(result.coverage < 0.1, `coverage should expose the hole, got ${result.coverage}`)
  assert.ok(result.gaps.length >= 1)
  assert.ok(result.gapMs > 50_000)
})

test('coverage reports the measured fraction and never invents the rest', () => {
  const from = ms('2026-11-06T17:00:00Z')
  const to = from + 60_000
  const half = steady(from, from + 30_000, 300)
  const result = integrate(half, from, to)
  assert.ok(Math.abs(result.coverage - 0.5) < 0.05, `expected ~50% coverage, got ${result.coverage}`)
  assert.ok(Math.abs(result.wh - 2.5) < 0.2, 'energy must cover only the measured half')
  assert.ok(result.gapMs > 25_000)
})

test('samples outside the span contribute nothing', () => {
  const from = ms('2026-11-06T17:00:00Z')
  const to = from + 60_000
  const samples = [
    ...steady(from - 600_000, from - 1000, 900),
    ...steady(from, to, 100),
    ...steady(to + 1000, to + 600_000, 900),
  ]
  const result = integrate(samples, from, to)
  assert.ok(Math.abs(result.wh - (100 * 60) / 3600) < 0.05, `got ${result.wh}`)
})

test('unusable samples are dropped rather than read as zero watts', () => {
  const kept = usableSamples([
    { t: 1000, watts: 300 },
    { t: 2000, watts: null },
    { t: 3000, watts: Number.NaN },
    { t: 4000, watts: -5 },
    { t: 5000, watts: 250 },
    null,
    { watts: 100 },
  ])
  assert.deepEqual(kept, [{ t: 1000, watts: 300 }, { t: 5000, watts: 250 }])
})

test('fewer than two samples reports a full gap', () => {
  const from = 1000
  const to = 11_000
  const none = integrate([], from, to)
  assert.equal(none.coverage, 0)
  assert.equal(none.wh, 0)
  assert.deepEqual(none.gaps, [{ fromMs: from, toMs: to }])
  const one = integrate([{ t: from, watts: 300 }], from, to)
  assert.equal(one.coverage, 0)
  assert.equal(one.sampleCount, 1)
})

test('the gap threshold defaults to three sampling periods', () => {
  assert.equal(DEFAULT_MAX_GAP_MS, 3000)
})

test('a shared card is labelled approximate, an exclusive one is not', () => {
  const exclusive = classifyAttribution({ coverage: 1, distinctPids: 1, overlappingRequests: 0 })
  assert.equal(exclusive.label, 'exclusive')
  assert.equal(exclusive.approximate, false)

  const shared = classifyAttribution({ coverage: 1, distinctPids: 2, overlappingRequests: 0 })
  assert.equal(shared.label, 'shared')
  assert.equal(shared.approximate, true)

  const overlapping = classifyAttribution({ coverage: 1, distinctPids: 1, overlappingRequests: 2 })
  assert.equal(overlapping.label, 'overlapping-jobs')
  assert.equal(overlapping.approximate, true)

  const partial = classifyAttribution({ coverage: 0.4, distinctPids: 1, overlappingRequests: 0 })
  assert.equal(partial.label, 'partial')
  assert.equal(partial.approximate, true)
  assert.match(partial.reasons[0], /40%/)
})

test('cents per hour is the steady-state rate at the current draw', () => {
  assert.equal(centsPerHour(340, 14.6), 4.964)
  assert.equal(centsPerHour(null, 14.6), null)
  assert.equal(centsPerHour(Number.NaN, 14.6), null)
})
