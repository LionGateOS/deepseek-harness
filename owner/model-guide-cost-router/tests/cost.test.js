import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateActualCost, priceFreshness } from '../core/cost.js'

const RATES = { inputPerMTok: 0.15, cachedInputPerMTok: 0.03, outputPerMTok: 0.5, verifiedAt: '2026-10-13' }

test('actual cost multiplies real token counts by the configured rates only', () => {
  const result = calculateActualCost(RATES, { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 1_000_000 })
  assert.equal(result.status, 'calculated')
  // 0.8 * 0.15 + 0.2 * 0.03 + 1 * 0.5 = 0.156 + 0.5... = 0.12 + 0.006 + 0.5 = 0.626
  assert.equal(result.totalUsd, 0.626)
  assert.deepEqual(result.breakdown.portions.map((portion) => [portion.label, portion.tokens]), [
    ['uncached_input', 800_000],
    ['cached_input', 200_000],
    ['output', 1_000_000],
  ])
})

test('a reasoning level without token changes never changes cost', () => {
  const withReasoning = calculateActualCost(RATES, /** @type {any} */ ({ inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoning: 'max' }))
  const withoutReasoning = calculateActualCost(RATES, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 })
  assert.deepEqual(withReasoning.breakdown, withoutReasoning.breakdown)
  assert.equal(withReasoning.totalUsd, withoutReasoning.totalUsd)
})

test('cost tracks reasoning only through real output volume', () => {
  const light = calculateActualCost(RATES, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 })
  const heavy = calculateActualCost(RATES, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 5000 })
  assert.ok(heavy.totalUsd > light.totalUsd * 4 / 4.001)
  assert.equal(heavy.totalUsd, Math.round((1000 * 0.15 + 5000 * 0.5) / 1e6 * 1e9) / 1e9)
})

test('missing usage or rates stay unknown and are never guessed', () => {
  assert.equal(calculateActualCost(RATES, {}).status, 'unknown')
  assert.equal(calculateActualCost({}, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }).status, 'unknown')
  const unlistedCache = calculateActualCost({ inputPerMTok: 0.06, cachedInputPerMTok: null, outputPerMTok: 0.24 }, { inputTokens: 100, cachedInputTokens: 100, outputTokens: 10 })
  assert.equal(unlistedCache.status, 'unknown')
  assert.match(unlistedCache.reason, /cached-input rate is not listed/)
  assert.equal(unlistedCache.breakdown.portions.length, 1) // output only; nothing fabricated for the cached part
})

test('reported counts split exactly into cached and uncached portions', () => {
  const result = calculateActualCost(RATES, { inputTokens: 500, cachedInputTokens: 500, outputTokens: 0 })
  assert.equal(result.status, 'calculated')
  // A fully cached request has no uncached or output portions to price.
  assert.deepEqual(result.breakdown.portions.map((portion) => [portion.label, portion.tokens]), [['cached_input', 500]])
  assert.equal(result.totalUsd, 0.000015)
})

test('invalid usage fails as invalid_usage with no invented numbers', () => {
  assert.equal(calculateActualCost(RATES, { inputTokens: -1, outputTokens: 1 }).status, 'invalid_usage')
  assert.equal(calculateActualCost(RATES, { inputTokens: 1.5, cachedInputTokens: 0, outputTokens: 1 }).status, 'invalid_usage')
  assert.equal(calculateActualCost(RATES, { inputTokens: 10, cachedInputTokens: 20, outputTokens: 1 }).status, 'invalid_usage')
  assert.equal(calculateActualCost({ inputPerMTok: 'free' }, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }).status, 'invalid_usage')
})

test('price freshness labels stale and unverified prices for owner review', () => {
  assert.equal(priceFreshness(RATES, { maxAgeDays: 90, now: '2026-10-13' }), 'fresh')
  assert.equal(priceFreshness(RATES, { maxAgeDays: 90, now: '2027-05-01' }), 'stale')
  assert.equal(priceFreshness({ inputPerMTok: 1 }, { maxAgeDays: 90 }), 'unverified')
  assert.equal(priceFreshness({ verifiedAt: 'not-a-date', inputPerMTok: 1 }, { maxAgeDays: 90 }), 'unverified')
})