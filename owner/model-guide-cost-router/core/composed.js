/**
 * Composed model recommendation: one answer built from three existing sources.
 *
 * - Local Model Manager supplies installed-model truth and read-only GPU state.
 * - This plugin's owner guidance and cost ordering supply suitability and price.
 * - The llmfit advisor supplies hardware-fit arithmetic for one workload class.
 *
 * The composition is deliberately asymmetric. Only Local Model Manager may say
 * whether a model is installed; only this plugin's owner guidance may say what a
 * model is good for; llmfit may only describe fit arithmetic. An llmfit catalog
 * identifier is never translated into a DeepSeek route, because no verified
 * mapping exists, and a `perfect` fit level is never read as permission to run
 * anything.
 *
 * @module @local/model-guide-cost-router/core/composed
 */

import { statSync } from 'node:fs'

/**
 * Stated on every composed result. The sentence is fixed rather than assembled
 * per branch: one wording is what keeps the boundary reviewable.
 */
export const COMPOSED_ADVISORY_BOUNDARY =
  'Recommendations do not grant model launch, GPU, reservation, routing, approval, or execution permission.'

/**
 * Workload classes the fit engine accepts. The llmfit advisor validates every
 * call against its own list, so this is the caller-facing copy of that contract;
 * a drift test asserts the two agree.
 */
export const WORKLOAD_CLASSES = Object.freeze(['general', 'coding', 'reasoning', 'chat', 'multimodal', 'embedding'])

/** Where the combined answer came from, for a caller that must cite sources. */
export const COMPOSED_SOURCES = Object.freeze({
  installed: 'localModelManager (installed truth)',
  guidance: 'modelGuide (owner guidance, cost, routing rule)',
  fit: 'llmfitAdvisor (bounded read-only advisory)',
})

/**
 * Physical identity of one GGUF artifact: device plus inode, which is what makes
 * two path strings the same file. Returns null when the path cannot be stat'ed,
 * because an unresolvable path is not evidence of identity.
 * @param {string} path absolute path.
 * @returns {string|null} an opaque identity key.
 */
export function artifactIdentity(path) {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return null
    return `${stats.dev}:${stats.ino}`
  } catch {
    return null
  }
}

/**
 * Index installed-model truth by physical artifact, so a guidance row keyed by
 * one path can be matched to a manager record keyed by another spelling of the
 * same file. A path that cannot be stat'ed contributes no entry.
 * @param {Array<{key: string, name: string, ggufPath?: string, installed?: boolean, diskBytes?: number}>} models manager model rows.
 * @returns {Map<string, object>} artifact identity to manager row.
 */
export function indexInstalled(models) {
  /** @type {Map<string, object>} */
  const index = new Map()
  for (const model of models) {
    if (typeof model.ggufPath !== 'string') continue
    const identity = artifactIdentity(model.ggufPath)
    if (identity !== null && !index.has(identity)) index.set(identity, model)
  }
  return index
}

/**
 * Split one guidance row into the fields a composed answer quotes.
 * @param {object} row a merged guide row.
 * @returns {object} the quotable guidance facts that are present.
 */
const guidanceFacts = (row) => ({
  ...(row.strengths === undefined ? {} : { strengths: row.strengths }),
  ...(row.avoid === undefined ? {} : { avoid: row.avoid }),
  ...(row.reasoning?.recommendedRoutine === undefined ? {} : { recommendedRoutine: row.reasoning.recommendedRoutine }),
  ...(row.context?.ownerConfigured === undefined ? {} : { contextConfigured: row.context.ownerConfigured }),
  ...(row.context?.providerReported === undefined ? {} : { contextReported: row.context.providerReported }),
})

/**
 * Facts about one GPU row that a caller may quote. Free memory is reported only
 * when the driver reported it; it is never recomputed from total minus used.
 * @param {object} gpu a manager GPU row.
 * @returns {object} the quotable read-only GPU facts.
 */
export const gpuFacts = (gpu) => ({
  name: gpu.name,
  uuid: gpu.uuid,
  ...(typeof gpu.memTotalMiB === 'number' ? { memTotalMiB: gpu.memTotalMiB } : {}),
  ...(typeof gpu.memUsedMiB === 'number' ? { memUsedMiB: gpu.memUsedMiB } : {}),
  ...(typeof gpu.memFreeMiB === 'number' ? { memFreeMiB: gpu.memFreeMiB } : {}),
  ...(gpu.launchReserved === true ? { launchReserved: true } : {}),
  ...(gpu.preferredLaunchTarget === true ? { preferredLaunchTarget: true } : {}),
})

/**
 * Rank guidance rows for one task. Delegates to the owner's existing advisory
 * ordering: the caller passes the already-ordered rows.
 * @param {Array<{row: object, unreviewed: boolean, why: string[]}>} order the advisory order.
 * @param {Map<string, object>} installed artifact identity to manager row.
 * @returns {Array<{item: object, manager: object|undefined, installed: boolean}>} rows with installed truth attached.
 */
export function attachInstalled(order, installed) {
  return order.map((item) => {
    const provider = item.row.provider
    const id = item.row.id
    // Only a local curated row carries an absolute artifact path as its id. A
    // provider-discovered row has no artifact, so it can never be proven installed.
    const manager = provider === 'qwen-local' && typeof id === 'string' && id.startsWith('/')
      ? installed.get(artifactIdentity(id) ?? '')
      : undefined
    return { item, manager, installed: manager?.installed === true }
  })
}

/**
 * Order recommendations so installed models come first, then the owner's cost
 * ordering. Partitioning preserves relative order inside each group, so the
 * rule itself is unchanged; installability is a separate, stronger preference.
 * @param {Array<{item: object, manager: object|undefined, installed: boolean}>} ranked rows.
 * @returns {Array<{item: object, manager: object|undefined, installed: boolean}>} installed rows first.
 */
export function preferInstalled(ranked) {
  return [...ranked.filter((entry) => entry.installed), ...ranked.filter((entry) => !entry.installed)]
}

/**
 * Build the recommendation for one already-ranked row.
 * @param {object} entry one ranked entry.
 * @param {{truth: 'verified'|'unavailable'}} installedTruth whether installed truth was read.
 * @returns {object} the recommendation block.
 */
export function describeRecommendation(entry, installedTruth) {
  const { item, manager } = entry
  const row = item.row
  const localUninstalled = row.localVsCloud === 'local' && entry.installed !== true
  const limitations = []
  if (installedTruth.truth === 'unavailable') {
    limitations.push('Installed-model truth was unavailable, so installability could not be checked for this recommendation.')
  } else if (localUninstalled) {
    limitations.push('This local model is described by owner guidance but is not installed on this machine; using it would require a separate owner-approved installation.')
  }
  if (row.needsReview === true) {
    limitations.push('Owner guidance for this model is incomplete, so the suitability statement is partial.')
  }
  if (item.unreviewed) {
    limitations.push('This model has no owner-reviewed guidance; it is listed but not claimed capable for the task.')
  }
  const pricing = row.pricing ?? {}
  // A curated local row is keyed by its artifact path, so the manager's label is
  // the human name. Without it the path is the only honest identifier.
  const displayName = typeof manager?.name === 'string' && manager.name.length > 0 ? manager.name : row.name
  return {
    kind: entry.installed ? 'installed-local' : localUninstalled ? 'guided-local-not-installed' : row.localVsCloud === 'cloud' ? 'cloud' : 'guided-unknown',
    provider: row.provider,
    model: row.id,
    name: displayName,
    installed: installedTruth.truth === 'unavailable' ? null : entry.installed,
    why: item.why.length > 0
      ? item.why.map((strength) => `Owner guidance records this strength for the task: ${strength}.`)
      : ['No owner-recorded strength matches the task wording; this is the highest ranked remaining model.'],
    limitations,
    ...(manager?.key === undefined ? {} : { localModelKey: manager.key }),
    ...(typeof manager?.diskBytes === 'number' ? { diskBytes: manager.diskBytes } : {}),
    ...(pricing.costTier === undefined ? {} : { costTier: pricing.costTier }),
    ...(row.pricingNote === undefined ? {} : { pricingNote: row.pricingNote }),
    ...(pricing.freshness === undefined ? {} : { priceFreshness: pricing.freshness }),
    guidance: guidanceFacts(row),
  }
}

/**
 * Describe the best llmfit catalog suggestion that is not installed, as a
 * clearly-labelled alternative rather than a rival recommendation.
 * @param {Array<object>} models projected llmfit models.
 * @returns {object} the alternative block, or a note that nothing was suggested.
 */
export function describeAlternative(models) {
  const first = models[0]
  if (first === undefined) {
    return { present: false, note: 'The fit engine returned no catalog suggestions for this workload class.' }
  }
  return {
    present: true,
    label: 'NOT INSTALLED',
    name: String(first['name'] ?? ''),
    provider: String(first['provider'] ?? ''),
    fitLevel: String(first['fit_level'] ?? ''),
    ...(typeof first['memory_required_gb'] === 'number' ? { memoryRequiredGb: first['memory_required_gb'] } : {}),
    ...(typeof first['estimated_tps'] === 'number' ? { estimatedTps: first['estimated_tps'] } : {}),
    ...(typeof first['best_quant'] === 'string' ? { bestQuant: first['best_quant'] } : {}),
    ...(typeof first['runtime'] === 'string' ? { runtime: first['runtime'] } : {}),
    note: [
      'This identifier is an llmfit catalog name. No verified mapping to a DeepSeek route or to an installed artifact exists,',
      'so it is not a recommendation to run it and it must not be treated as a configured model.',
    ].join(' '),
  }
}

/**
 * Assemble the composed document from the three already-gathered inputs.
 *
 * Pure: every source is passed in, so the composition can be tested without a
 * process, a GPU, or a live provider.
 *
 * @param {object} input the gathered sources.
 * @param {string} input.task the task description.
 * @param {string} [input.useCase] workload class requested from the fit engine.
 * @param {Array<{row: object, unreviewed: boolean, why: string[]}>} input.order advisory order.
 * @param {Array<{key: string, name: string, ggufPath?: string, installed?: boolean, diskBytes?: number}>|null} input.installedModels manager rows, or null when the service is absent.
 * @param {Array<object>} [input.gpus] manager GPU rows.
 * @param {object|null} input.fit the llmfit advisory result, or null when not requested.
 * @param {string} [input.installedUnavailableReason] why installed truth is missing.
 * @returns {object} the composed result document.
 */
export function composeRecommendation(input) {
  const installedTruth = { truth: input.installedModels === null ? 'unavailable' : 'verified' }
  const installed = input.installedModels === null ? new Map() : indexInstalled(input.installedModels)
  // Installed rows first, then the owner's cost ordering unchanged. When nothing
  // is installed the order is exactly what the advisory ranking produced, so a
  // machine with no local models still gets the guidance answer.
  const ranked = preferInstalled(attachInstalled(input.order, installed))
  // An unreviewed row is never presented as the recommendation while a reviewed
  // one exists: "listed" and "recommended" are different claims.
  const chosen = ranked.find((entry) => entry.item.unreviewed !== true) ?? undefined

  const recommendation = chosen === undefined
    ? {
        kind: 'none',
        provider: '',
        model: '',
        name: '',
        installed: installedTruth.truth === 'unavailable' ? null : false,
        why: ['No model is present in the merged guidance inventory, so nothing was recommended.'],
        limitations: ['The guidance inventory was empty; this is not a statement that no model exists on the machine.'],
        guidance: {},
      }
    : describeRecommendation(chosen, installedTruth)

  const models = input.fit !== null && input.fit?.status === 'ok' && Array.isArray(input.fit.models) ? input.fit.models : []
  const alternative = input.fit === null
    ? { present: false, note: 'No workload class was supplied, so no hardware-fit advisory was requested.' }
    : describeAlternative(models)

  return {
    status: 'ok',
    task: input.task,
    ...(input.useCase === undefined ? {} : { useCase: input.useCase }),
    advisoryOnly: COMPOSED_ADVISORY_BOUNDARY,
    recommendation,
    installedTruth: {
      status: installedTruth.truth,
      source: COMPOSED_SOURCES.installed,
      ...(input.installedUnavailableReason === undefined ? {} : { reason: input.installedUnavailableReason }),
      installedLocalModels: input.installedModels === null
        ? []
        : input.installedModels
          .filter((model) => model.installed === true)
          .map((model) => ({ key: model.key, name: model.name })),
    },
    hardware: {
      source: COMPOSED_SOURCES.fit,
      fitStatus: input.fit === null ? 'not-requested' : String(input.fit.status ?? 'unknown'),
      ...(input.fit !== null && input.fit.status !== 'ok' && typeof input.fit.error === 'string' ? { error: input.fit.error } : {}),
      gpus: (input.gpus ?? []).map(gpuFacts),
      catalogOnly: models.slice(0, 3).map((model) => ({
        name: String(model['name'] ?? ''),
        provider: String(model['provider'] ?? ''),
        label: 'NOT INSTALLED',
        ...(typeof model['fit_level'] === 'string' ? { fitLevel: model['fit_level'] } : {}),
        ...(typeof model['memory_required_gb'] === 'number' ? { memoryRequiredGb: model['memory_required_gb'] } : {}),
        ...(typeof model['estimated_tps'] === 'number' ? { estimatedTps: model['estimated_tps'] } : {}),
        ...(typeof model['best_quant'] === 'string' ? { bestQuant: model['best_quant'] } : {}),
        ...(typeof model['runtime'] === 'string' ? { runtime: model['runtime'] } : {}),
      })),
    },
    betterUninstalledOption: alternative,
  }
}
