/**
 * Regenerated guide text. Everything here is deterministic and composed from
 * the merged rows and owner metadata — the human-readable generated guide, the
 * copyable full guide, and the copyable recommended-routing guide.
 *
 * The owner-curated markdown guide is never rewritten by the plugin: the
 * generated files live beside it under the owner's model-guidance directory.
 */

import { guidanceText } from './guidance-text.js'
import { recommendForTask } from './recommend.js'

const TIER_ORDER = ['Very Cheap', 'Cheap', 'Moderate', 'Expensive', 'Very Expensive']

/**
 * The full generated human-readable guide: header, legend, one complete record
 * per model, plus the routing rule and GPU boundary.
 * @param {{generatedAt: string, routingRule: string|null, gpuBoundary: object[]|null,
 *   providers: {id: string, name: string, error?: string, models: object[]}[], curatedOnly: object[]}} snapshot
 * @returns {string}
 */
export const generatedGuideText = (snapshot) => {
  const rows = [
    ...snapshot.providers.flatMap((providerData) => providerData.models),
    ...snapshot.curatedOnly,
  ]
  /** @type {string[]} */
  const lines = []
  lines.push('# LionGateOS Model Guide (generated)')
  lines.push('')
  lines.push(`Generated: ${snapshot.generatedAt}`)
  lines.push('Source: live Harness discovery overlaid with owner-curated metadata (owner-model-guidance.json).')
  lines.push('Fields marked Needs Review/Unknown are not yet verified; nothing in this guide is guessed.')
  lines.push('')
  lines.push('## Global routing rule')
  lines.push('')
  lines.push(snapshot.routingRule ?? 'Needs Review: no routing rule is recorded.')
  lines.push('')
  const gpu = snapshot.gpuBoundary ?? []
  if (gpu.length > 0) {
    lines.push('## GPU boundary')
    lines.push('')
    for (const boundary of gpu) {
      lines.push(`- ${boundary.label ?? 'GPU'} — ${boundary.uuid ?? 'Unknown UUID'}${boundary.role === undefined ? '' : `: ${boundary.role}`}`)
    }
    lines.push('')
  }
  lines.push('## Models')
  lines.push('')
  for (const providerData of snapshot.providers) {
    const suffix = providerData.error === undefined ? '' : ` — provider listing FAILED (${providerData.error}); facts not re-verified`
    lines.push(`### Provider: ${providerData.name} (${providerData.id})${suffix}`)
    lines.push('')
    if (providerData.models.length === 0) lines.push('_No models listed._')
    for (const model of providerData.models) {
      lines.push(guidanceText(model, snapshot.routingRule).trimEnd())
      lines.push('')
    }
  }
  if (snapshot.curatedOnly.length > 0) {
    lines.push('### Curated-only models (no live discovery match)')
    lines.push('')
    for (const model of snapshot.curatedOnly) {
      lines.push(guidanceText(model, snapshot.routingRule).trimEnd())
      lines.push('')
    }
  }
  lines.push('_End of generated guide._')
  lines.push('')
  return lines.join('\n')
}

/**
 * The copyable recommended-routing guide: the exact routing rule plus a
 * deterministic cost-tiered ordering of curated models.
 * @param {object[]} rows merged rows.
 * @param {string|null} routingRule
 * @returns {string}
 */
export const routingGuideText = (rows, routingRule) => {
  /** @type {string[]} */
  const lines = []
  lines.push('# LionGateOS Recommended Routing Guide')
  lines.push('')
  lines.push('## Routing rule (verbatim)')
  lines.push('')
  lines.push(routingRule ?? 'Needs Review: no routing rule is recorded.')
  lines.push('')
  lines.push('## Recommended order')
  lines.push('')
  const result = recommendForTask(rows, '')
  const local = result.order.filter((item) => item.row.localVsCloud === 'local' && !item.unreviewed)
  if (local.length > 0) {
    lines.push('First: local models (no per-token cloud charge; check VRAM/GPU capacity):')
    for (const item of local) lines.push(`- ${item.row.provider}/${item.row.id} — routine: ${item.row.reasoning?.recommendedRoutine ?? 'Needs Review'}`)
    lines.push('')
  }
  for (const tier of TIER_ORDER) {
    const tierRows = result.order.filter((item) => item.row.localVsCloud === 'cloud' && !item.unreviewed && item.row.pricing?.costTier === tier)
    if (tierRows.length === 0) continue
    lines.push(`Then, ${tier} cloud models (cheapest capable first within the tier):`)
    for (const item of tierRows) {
      lines.push(`- ${item.row.provider}/${item.row.id} — routine: ${item.row.reasoning?.recommendedRoutine ?? 'Needs Review'}; input $${item.row.pricing.inputPerMTok}/1M, output $${item.row.pricing.outputPerMTok}/1M`)
    }
    lines.push('')
  }
  const unreviewed = result.order.filter((item) => item.unreviewed)
  if (unreviewed.length > 0) {
    lines.push('Not yet reviewed (no owner recommendation; do not route to these without review):')
    for (const item of unreviewed) lines.push(`- ${item.row.provider}/${item.row.id}`)
    lines.push('')
  }
  lines.push('_This guide is advisory. The owner always makes the actual model choice._')
  lines.push('')
  return lines.join('\n')
}