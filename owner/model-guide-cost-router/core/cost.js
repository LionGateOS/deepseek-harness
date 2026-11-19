/**
 * Deterministic actual-cost calculation for cloud model usage.
 *
 * Token price is stored as provider-published rates only (USD per 1 million
 * tokens for input, cached input, and output). A reasoning setting never has
 * its own price and no per-level multiplier exists anywhere in this module:
 * a reasoning choice changes total cost only through the real token volumes
 * the provider reported.
 */

/**
 * @typedef {object} CloudRates One provider rate set; a missing cached-input
 *   rate means "not listed".
 * @property {number} [inputPerMTok] USD per 1M uncached input tokens.
 * @property {number|null} [cachedInputPerMTok] USD per 1M cached input tokens;
 *   null or absent means the provider does not list one.
 * @property {number} [outputPerMTok] USD per 1M output tokens.
 * @property {string} [source] Provider page the rates were verified on.
 * @property {string} [verifiedAt] ISO date of the last owner verification.
 */

/**
 * @typedef {object} UsageCounts Real token counts exactly as a provider
 *   reported them.
 * @property {number} [inputTokens] Total prompt-side input tokens.
 * @property {number|null} [cachedInputTokens] Cached portion of the input;
 *   null or absent means unknown/not reported.
 * @property {number} [outputTokens] Generated tokens including thinking.
 */

/**
 * @typedef {object} CostPortion
 * @property {'uncached_input'|'cached_input'|'output'} label
 * @property {number} tokens Exact real token count behind the portion.
 * @property {number} rateUsdPerMTok USD per 1M tokens used.
 * @property {number} costUsd Portion cost in USD.
 */

/**
 * @typedef {object} CostBreakdown
 * @property {CostPortion[]} portions
 * @property {string[]} unknown
 */

/**
 * @typedef {object} CalculatedCost
 * @property {'calculated'} status
 * @property {number} totalUsd
 * @property {CostBreakdown} breakdown
 */

/**
 * @typedef {object} UnknownCost
 * @property {'unknown'} status
 * @property {string} reason
 * @property {CostBreakdown} breakdown
 */

/**
 * @typedef {object} InvalidCost
 * @property {'invalid_usage'} status
 * @property {string} reason
 * @property {{portions: CostPortion[], unknown: string[]}} breakdown
 */

/** @typedef {CalculatedCost|UnknownCost|InvalidCost} ActualCostResult */

const NONNEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isRate = (value) => isNonNegativeNumber(value) && value < 1e6

/**
 * One priced portion, rounded to 9 decimals so repeated calls stay equal.
 * @param {CostPortion['label']} label
 * @param {number} tokens
 * @param {number} rateUsdPerMTok
 * @returns {CostPortion}
 */
const portion = (label, tokens, rateUsdPerMTok) => ({
  label,
  tokens,
  rateUsdPerMTok,
  costUsd: Math.round(((tokens * rateUsdPerMTok) / 1_000_000) * 1e9) / 1e9,
})

/**
 * Compute the actual dollar cost from real token counts and stored rates only.
 * @param {CloudRates} rates the model's stored provider rates; each price must
 *   be a finite non-negative number and is interpreted as USD per 1M tokens.
 * @param {UsageCounts} usage provider-reported token counts; absent or null
 *   inputs make the result unknown rather than guessed.
 * @returns {ActualCostResult} a discriminated result: every priced portion
 *   with its exact real tokens and rate, the list of unknown contributors
 *   that block a total, or an invalid-usage marker; never a fabricated cost.
 */
export function calculateActualCost(rates, usage) {
  for (const [name, value] of /** @type {const} */ ([['inputPerMTok', rates.inputPerMTok], ['outputPerMTok', rates.outputPerMTok]])) {
    if (value !== undefined && !isRate(value)) return { status: 'invalid_usage', reason: `rate ${name} is not a finite non-negative number`, breakdown: { portions: [], unknown: [] } }
  }
  if (rates.cachedInputPerMTok != null && !isRate(rates.cachedInputPerMTok)) {
    return { status: 'invalid_usage', reason: 'rate cachedInputPerMTok is not a finite non-negative number', breakdown: { portions: [], unknown: [] } }
  }

  const unknown = /** @type {string[]} */ ([])
  const portions = /** @type {CostPortion[]} */ ([])

  const cached = usage.cachedInputTokens ?? null
  const totalInput = usage.inputTokens ?? null
  if (totalInput === null) unknown.push('actual input token count is unknown')
  if (usage.cachedInputTokens === undefined) unknown.push('actual cached-input token count is unknown')
  const output = usage.outputTokens ?? null
  if (output === null) unknown.push('actual output token count is unknown')

  const uncachedRate = rates.inputPerMTok
  if (uncachedRate === undefined) unknown.push('uncached-input rate is not stored')

  let uncachedInput = null
  if (totalInput !== null) {
    if (!NONNEGATIVE_INTEGER.test(String(totalInput))) {
      return { status: 'invalid_usage', reason: 'input token count must be a non-negative integer', breakdown: { portions: [], unknown: [] } }
    }
    if (cached !== null) {
      if (!NONNEGATIVE_INTEGER.test(String(cached))) {
        return { status: 'invalid_usage', reason: 'cached input token count must be a non-negative integer', breakdown: { portions: [], unknown: [] } }
      }
      if (cached > totalInput) {
        return { status: 'invalid_usage', reason: 'cached input tokens exceed total input tokens', breakdown: { portions: [], unknown: [] } }
      }
      uncachedInput = totalInput - cached
    }
  }

  if (output !== null && !NONNEGATIVE_INTEGER.test(String(output))) {
    return { status: 'invalid_usage', reason: 'output token count must be a non-negative integer', breakdown: { portions: [], unknown: [] } }
  }

  // Zero-token portions are omitted: with no cached input, no cached charge.
  if (uncachedInput !== null && uncachedInput > 0 && uncachedRate !== undefined) portions.push(portion('uncached_input', uncachedInput, uncachedRate))
  const cachedRate = rates.cachedInputPerMTok
  if (cached !== null && cached > 0) {
    if (cachedRate == null) unknown.push('cached-input rate is not listed by the provider')
    else portions.push(portion('cached_input', cached, cachedRate))
  }
  const outputRate = rates.outputPerMTok
  if (output !== null && outputRate === undefined) unknown.push('output rate is not stored')
  if (output !== null && output > 0 && outputRate !== undefined) portions.push(portion('output', output, outputRate))

  if (unknown.length > 0) return { status: 'unknown', reason: unknown.join('; '), breakdown: { portions, unknown } }

  const totalUsd = Math.round(portions.reduce((sum, item) => sum + item.costUsd, 0) * 1e9) / 1e9
  return { status: 'calculated', totalUsd, breakdown: { portions, unknown: [] } }
}

/**
 * Judge the review state of a stored price set against its verified date.
 * @param {CloudRates} rates the stored rates with their optional source and
 *   verified date.
 * @param {{maxAgeDays: number, now?: string}} options `maxAgeDays` bound and
 *   the `now` instant to compare with.
 * @returns {'fresh'|'stale'|'unverified'} `fresh` when verified within the
 *   bound, `stale` when a verified date exists but exceeded the bound, and
 *   `unverified` when no verified date is recorded.
 */
export function priceFreshness(rates, options) {
  const hasPrice = rates.inputPerMTok !== undefined || rates.outputPerMTok !== undefined
  if (!rates.verifiedAt || !hasPrice) return 'unverified'
  if (options.maxAgeDays <= 0) return 'stale'
  const verified = Date.parse(rates.verifiedAt)
  if (Number.isNaN(verified)) return 'unverified'
  const now = options.now === undefined ? Date.now() : Date.parse(options.now)
  if (Number.isNaN(now)) return 'unverified'
  const ageDays = (now - verified) / 86_400_000
  return ageDays > options.maxAgeDays ? 'stale' : 'fresh'
}