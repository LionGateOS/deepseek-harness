/**
 * Deterministic "Copy Model Info" text. The output depends only on a merged
 * model row and the owner routing rule: fixed field order, explicit Unknown
 * placeholders, no timestamps, and no locale-dependent formatting, so two
 * calls with equal rows produce byte-equal text.
 *
 * Every field that can combine owner and provider data is rendered as a list
 * of the parts that actually exist, joined with '; '; a missing side renders
 * nothing — never "null", "undefined", "NaN", or "[object Object]" — and a
 * field with no side at all renders one deliberate placeholder (Unknown /
 * Needs Review / N/A for a positively local deployment).
 */

/**
 * @typedef {import('./overlay.js').ModelRow} ModelRow
 */

/** English-locale grouping is fixed here so output is deterministic across machines. */
const GROUPED_NUMBER = new Intl.NumberFormat('en-US')

/**
 * Render a finite number with thousands separators; anything else is Unknown.
 * @param {unknown} value
 * @returns {string}
 */
const numberLine = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? GROUPED_NUMBER.format(value)
  : 'Unknown')

/**
 * @param {string[]|undefined} items
 * @returns {string|undefined} one bounded line; absent when the list is missing.
 */
const listLine = (items) => (items === undefined || items.length === 0 ? undefined : items.join(', '))

/**
 * @param {unknown} value
 * @returns {string} the value, or "Unknown" when absent.
 */
const valueLine = (value) => (value === undefined || value === null ? 'Unknown' : String(value))

/**
 * Join the parts that actually exist with '; '. Every part must already be a
 * non-empty string; the guard here is the final barrier against a literal
 * "null"/"undefined"/"nan"/"[object Object]" ever reaching the copied text.
 * @param {(string|undefined|null)[]} parts
 * @returns {string} the joined parts, or "Unknown" when none exist.
 */
const joinedParts = (parts) => {
  const kept = parts.filter((part) => typeof part === 'string' && part.trim().length > 0)
  if (kept.length === 0) return 'Unknown'
  const joined = kept.join('; ')
  if (/null|undefined|NaN|\[object Object\]/i.test(joined.replace(/Provider-reported|Owner-configured|Owner-recorded|Provider/g, ''))) {
    return 'Unknown'
  }
  return joined
}

/**
 * Format the pricing rate display without inventing a reasoning multiplier.
 * @param {ModelRow['pricing']} pricing
 * @returns {string}
 */
const rateLine = (pricing) => {
  if (pricing === undefined) return 'Not stored — Needs Review'
  const cached = pricing.cachedInputPerMTok
  const parts = [
    `Input: ${pricing.inputPerMTok === undefined ? 'Unknown' : `$${pricing.inputPerMTok}/1M tokens`}`,
    `Cached input: ${cached == null ? 'not listed by provider' : `$${cached}/1M tokens`}`,
    `Output: ${pricing.outputPerMTok === undefined ? 'Unknown' : `$${pricing.outputPerMTok}/1M tokens`}`,
  ]
  const meta = [
    pricing.source === undefined ? null : `Source: ${pricing.source}`,
    pricing.verifiedAt === undefined ? null : `Verified: ${pricing.verifiedAt}`,
    pricing.freshness === undefined ? null : `Price state: ${pricing.freshness}`,
    pricing.costTier === undefined ? null : `Owner cost tier: ${pricing.costTier}`,
  ].filter((item) => item !== null)
  return `${parts.join('; ')}${meta.length === 0 ? '' : ` (${meta.join('; ')})`}`
}

/**
 * Format the owner pricing note line, if any.
 * @param {ModelRow['pricingNote']} pricingNote
 * @returns {string|null}
 */
const pricingNoteLine = (pricingNote) => (pricingNote === undefined ? null : `Pricing note: ${pricingNote}`)

/**
 * Render one model's guidance as canonical prompt text.
 * @param {ModelRow} row the merged guide row.
 * @param {string|null} routingRule the owner routing rule, or null when unset.
 * @returns {string} deterministic multi-line guidance text ending with one newline.
 */
export function guidanceText(row, routingRule) {
  const reasoning = row.reasoning === undefined ? undefined : row.reasoning
  const context = row.context === undefined ? undefined : row.context
  const modalities = row.modalities === undefined ? undefined : row.modalities
  const isLocal = row.localVsCloud === 'local'
  const deployment = row.localVsCloud === 'unknown' ? 'Unknown (Needs Review)' : valueLine(row.localVsCloud)
  const lines = [
    'Model guidance',
    `Model: ${valueLine(row.name)} (${row.provider}/${row.id})`,
    `Provider: ${valueLine(row.provider)}`,
    `Deployment: ${deployment}`,
    `Context: ${context === undefined
      ? 'Unknown'
      : joinedParts([
        context.ownerConfigured === undefined ? undefined : `Owner-configured ${numberLine(context.ownerConfigured)}`,
        context.providerReported === undefined ? undefined : `Provider-reported ${numberLine(context.providerReported)}`,
      ])}`,
    `Modalities: ${modalities === undefined
      ? 'Unknown'
      : joinedParts([
        modalities.owner === undefined ? undefined : `Owner: ${listLine(modalities.owner) ?? 'Unknown'}`,
        modalities.providerReported === undefined ? undefined : `Provider-reported: ${listLine(modalities.providerReported) ?? 'Unknown'}`,
      ])}`,
    `Tool support: ${row.toolSupport === undefined ? 'Unknown' : row.toolSupport === null ? 'Not known to owner' : row.toolSupport ? 'Yes' : 'No'}`,
    `Reasoning modes: ${reasoning === undefined
      ? 'Unknown'
      : joinedParts([
        reasoning.ownerModes === undefined ? undefined : `Owner: ${listLine(reasoning.ownerModes) ?? 'Unknown'}`,
        reasoning.providerEfforts === undefined || reasoning.providerEfforts.length === 0
          ? undefined
          : `Provider-reported: ${reasoning.providerEfforts.map((effort) => effort.name).join('/')}`,
      ])}`,
    `Native reasoning default: ${reasoning === undefined
      ? 'Unknown'
      : joinedParts([
        reasoning.ownerNativeDefault === undefined ? undefined : `Owner-recorded ${reasoning.ownerNativeDefault}`,
        reasoning.providerDefault === undefined ? undefined : `Provider-reported ${reasoning.providerDefault}`,
      ])}`,
    `Recommended routine setting: ${valueLine(reasoning?.recommendedRoutine)}`,
    `Recommended difficult-task setting: ${valueLine(reasoning?.recommendedHeavy)}`,
    ...(reasoning?.note === undefined ? [] : [`Reasoning note: ${reasoning.note}`]),
    // A positively local model does not have a "missing" cloud price: the
    // charge is $0 by deployment, not an unverified gap.
    `Cloud pricing: ${isLocal ? 'N/A — local model; $0 cloud/API token charge' : rateLine(row.pricing)}`,
    pricingNoteLine(row.pricingNote) === null ? null : pricingNoteLine(row.pricingNote),
    ...(isLocal || row.pricing === undefined || row.pricing.freshness === undefined ? [] : [
      row.pricing.freshness === 'stale'
        ? 'Pricing staleness: stored price exceeded the owner review window — verify against the provider before cost-sensitive decisions.'
        : row.pricing.freshness === 'unverified'
          ? 'Pricing staleness: stored price has no verified date — Needs Review.'
          : 'Pricing staleness: within the owner review window.',
    ]),
    `Strengths: ${listLine(row.strengths) ?? 'Unknown'}`,
    `Avoid for: ${listLine(row.avoid) ?? 'Unknown'}`,
    ...(row.evidence === undefined ? [] : [`Evidence: ${row.evidence}`]),
    `Cost note: ${isLocal
      ? 'Cloud/API token charge is $0 for this local model; local resource consumption (GPU time, VRAM, electricity, local compute availability) is separate from provider token pricing. The reasoning level changes only how much local compute and thinking time is used — no per-level price multiplier exists.'
      : row.localVsCloud === 'cloud'
        ? 'Actual dollar cost is calculated from real token counts and the verified provider rates above; the reasoning level itself has no fixed multiplier — reasoning changes total spend only through real token usage.'
        : 'Reasoning settings change cost only by changing real token usage; no per-level price multiplier exists. Actual cost depends on the deployment (unresolved) and any stored rates above.'}`,
    `Global routing rule: ${routingRule === null ? 'Not stored — Needs Review' : routingRule}`,
  ]
  return `${lines.filter((line) => line !== null).join('\n')}\n`
}