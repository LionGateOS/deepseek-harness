/**
 * Advisory routing under the owner's global rule: least expensive capable
 * model first. The result is an ordered reading aid composed only from
 * owner-curated statements; it launches, stops, or switches nothing.
 */

/**
 * @typedef {import('./overlay.js').ModelRow} ModelRow
 */

/** The owner's cost tiers, ordered from least to most expensive. */
const COST_TIER_ORDER = ['Very Cheap', 'Cheap', 'Moderate', 'Expensive', 'Very Expensive']

/**
 * Rank one owner cost tier label; unknown labels rank as unreviewed.
 * @param {string|undefined} tier
 * @returns {number}
 */
const costRank = (tier) => {
  const index = tier === undefined ? -1 : COST_TIER_ORDER.indexOf(tier)
  return index === -1 ? COST_TIER_ORDER.length : index
}

/**
 * Collect the owner strengths of one row that the task keywords mention.
 * Matching is case-insensitive whole-phrase containment, so unmatched rows
 * stay silent instead of guessing a capability.
 * @param {ModelRow} row
 * @param {string[]} keywords
 * @returns {string[]}
 */
const matchingStrengths = (row, keywords) => {
  if (row.strengths === undefined || keywords.length === 0) return []
  return keywords
    .map((keyword) => row.strengths.find((strength) => strength.toLowerCase().includes(keyword)))
    .filter((strength) => strength !== undefined)
}

/**
 * Build the advisory ordered shortlist for one task. Rows without owner
 * metadata rank last: they are never claimed capable regardless of deployment.
 * @param {ModelRow[]} rows all merged guide rows (both live and curated-only).
 * @param {string} task the task description to read against owner strengths.
 * @returns {{order: {row: ModelRow, why: string[], unreviewed: boolean}[], unreviewedCount: number}} the
 *   advisory order with per-model owner-stated reasons; models without owner
 *   metadata are listed as unreviewed and never claimed capable.
 */
export function recommendForTask(rows, task) {
  const keywords = task
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .filter((keyword) => keyword.length >= 3)
  const ranked = rows
    .map((row) => ({
      row,
      unreviewed: row.localVsCloud === 'unknown' || row.strengths === undefined,
      matches: matchingStrengths(row, keywords),
    }))
    .sort((left, right) => {
      if (left.unreviewed !== right.unreviewed) return left.unreviewed ? 1 : -1
      const local = Number(left.row.localVsCloud === 'local') - Number(right.row.localVsCloud === 'local')
      if (local !== 0) return -local
      const tier = costRank(left.row.pricing?.costTier) - costRank(right.row.pricing?.costTier)
      if (tier !== 0) return tier
      if (left.matches.length !== right.matches.length) return right.matches.length - left.matches.length
      return left.row.provider === right.row.provider ? (left.row.id < right.row.id ? -1 : 1) : left.row.provider < right.row.provider ? -1 : 1
    })
  return {
    order: ranked.map((item) => ({
      row: item.row,
      unreviewed: item.unreviewed,
      why: item.matches,
    })),
    unreviewedCount: ranked.filter((item) => item.unreviewed).length,
  }
}