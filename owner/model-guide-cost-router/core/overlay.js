import { unresolvedModels } from './research.js'
import { validateEngineVerifications } from './engine-verification.js'
import { validateLaunchProfiles } from './launch-profile.js'

/**
 * Owner-guidance overlay: merge a dynamic provider/model inventory with the
 * persistent owner-curated metadata file. Discovery never overwrites owner
 * data; owner data never fabricates provider facts; unknowns stay visible as
 * Needs Review instead of invented values.
 */

/**
 * @typedef {object} DiscoveredModel Provider-reported facts for one model.
 * @property {string} id
 * @property {string} name
 * @property {number} [contextWindow]
 * @property {number} [maxTokens] Adapter-configured default output cap.
 * @property {string[]} [inputModalities]
 * @property {{efforts: {id: string, name: string}[], defaultEffort?: string}|null} [reasoning]
 */

/**
 * @typedef {object} DiscoveredProvider
 * @property {string} id
 * @property {string} name
 * @property {string} [error] Set when live discovery for this provider failed.
 * @property {DiscoveredModel[]} models
 */

/**
 * @typedef {object} OwnerModelEntry Owner-curated facts for one model.
 * @property {'local'|'cloud'} [localVsCloud]
 * @property {number} [contextConfigured]
 * @property {string[]} [modalities]
 * @property {boolean|null} [toolSupport] Null means "not known to the owner".
 * @property {string[]} [reasoningModes]
 * @property {string} [nativeReasoningDefault]
 * @property {string} [recommendedRoutine]
 * @property {string} [recommendedHeavy]
 * @property {string} [reasoningNote]
 * @property {string[]} [strengths]
 * @property {string[]} [avoid]
 * @property {string} [evidence]
 * @property {string} [pricingNote] Owner note about local $0 token charge or
 *   off-peak rates; displayed beside pricing, never turned into a rate.
 * @property {string[]} [ownerProblems] Problems recorded while validating the
 *   stored entry; present means the row is Needs Review.
 * @property {import('./cost.js').CloudRates} [pricing]
 * @property {string} [costTier]
 */

/**
 * @typedef {object} OwnerMetadataFile
 * @property {number} [version]
 * @property {string} [routingRule]
 * @property {{label: string, gpuName?: string, uuid?: string, role?: string}[]} [gpuBoundary]
 * @property {Record<string, OwnerModelEntry>} [models] Keys are "<provider>/<model id>".
 * @property {object[]} [engineVerifications] Owner-recorded engine/model/GPU test evidence.
 * @property {object[]} [launchProfiles] Owner-authored structured launch profiles.
 */

/**
 * @typedef {object} ModelRow A merged display row.
 * @property {string} provider
 * @property {string} id
 * @property {string} name
 * @property {'local'|'cloud'|'unknown'} localVsCloud
 * @property {boolean} needsReview
 * @property {string[]} [ownerProblems]
 * @property {{providerReported?: number, ownerConfigured?: number}} [context]
 * @property {{providerReported?: string[], owner?: string[]}} [modalities]
 * @property {boolean|null} [toolSupport]
 * @property {{providerEfforts?: {id: string, name: string}[], providerDefault?: string, ownerModes?: string[],
 *   ownerNativeDefault?: string, recommendedRoutine?: string, recommendedHeavy?: string, note?: string}} [reasoning]
 * @property {import('./cost.js').CloudRates & {freshness?: 'fresh'|'stale'|'unverified', costTier?: string}} [pricing]
 * @property {string[]} [strengths]
 * @property {string[]} [avoid]
 * @property {string} [evidence]
 * @property {string} [pricingNote]
 */

/**
 * @typedef {object} MergedSnapshot
 * @property {string} generatedAt
 * @property {{status: string, path: string, problems?: string[]}} metadata
 * @property {string|null} routingRule
 * @property {{label: string, gpuName?: string, uuid?: string, role?: string}[]|null} gpuBoundary
 * @property {{id: string, name: string, error?: string, models: ModelRow[]}[]} providers
 * @property {ModelRow[]} curatedOnly Owner-curated models with no live provider.
 */

const MAX_TEXT = 400
const MAX_LIST = 24
/**
 * A model key is "<provider>/<model id>": the provider is the text before the
 * FIRST slash and the model id is everything after, because local GGUF model
 * ids are file paths and contain slashes themselves.
 * @param {string} key
 * @returns {boolean}
 */
const isModelKey = (key) => key.includes('/') && !key.startsWith('/') && !key.endsWith('/')

/**
 * Accept only a finite non-negative number; anything else is absent.
 * @param {unknown} value
 * @returns {number|undefined}
 */
const reviewNumber = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)

/**
 * Accept only a non-empty bounded string.
 * @param {unknown} value
 * @param {string} problems - mutated with a description of every rejected field.
 * @param {string} field
 * @returns {string|undefined}
 */
const reviewText = (value, problems, field) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') { problems.push(`${field} is not a string and was ignored`) ; return undefined }
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.slice(0, MAX_TEXT)
}

/**
 * Accept only a list of non-empty bounded strings.
 * @param {unknown} value
 * @param {string} problems - mutated with a description of every rejected field.
 * @param {string} field
 * @returns {string[]|undefined}
 */
const reviewList = (value, problems, field) => {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) { problems.push(`${field} is not a list and was ignored`) ; return undefined }
  const items = value
    .map(item => reviewText(item, problems, field))
    .filter((item) => item !== undefined)
    .slice(0, MAX_LIST)
  return items.length === 0 ? undefined : items
}

/**
 * Accept one owner pricing block; reject any malformed rate into problems.
 * @param {unknown} value
 * @param {string} problems - mutated with a description of every rejected field.
 * @param {string} field
 * @returns {OwnerModelEntry['pricing']|undefined}
 */
const reviewPricing = (value, problems, field) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) { problems.push(`${field} is not an object and was ignored`) ; return undefined }
  const rates = /** @type {Record<string, unknown>} */ (value)
  const pricing = /** @type {NonNullable<OwnerModelEntry['pricing']>} */ ({})
  for (const key of ['inputPerMTok', 'outputPerMTok', 'cachedInputPerMTok']) {
    const rate = rates[key]
    if (rate === undefined || rate === null) continue
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
      problems.push(`${field}.${key} is not a finite non-negative number and was ignored`)
      continue
    }
    pricing[key] = rate
  }
  const source = reviewText(rates.source, problems, `${field}.source`)
  if (source !== undefined) pricing.source = source
  const verifiedAt = reviewText(rates.verifiedAt, problems, `${field}.verifiedAt`)
  if (verifiedAt !== undefined) pricing.verifiedAt = verifiedAt
  return Object.keys(pricing).length > 0 ? pricing : undefined
}

/**
 * Validate one owner-curated model entry against the accepted schema. Every
 * malformed field is dropped with a named problem; nothing is fabricated.
 * @param {unknown} value raw entry from the owner metadata file.
 * @returns {{entry?: OwnerModelEntry, problems: string[]}}
 */
const reviewOwnerEntry = (value) => {
  const problems = /** @type {string[]} */ ([])
  if (value === undefined || value === null) return { problems: ['entry is empty'] }
  if (typeof value !== 'object' || Array.isArray(value)) return { problems: ['entry is not an object'] }
  const raw = /** @type {Record<string, unknown>} */ (value)
  const entry = /** @type {OwnerModelEntry} */ ({})
  const localVsCloud = raw['localVsCloud']
  if (localVsCloud === 'local' || localVsCloud === 'cloud') entry.localVsCloud = localVsCloud
  else if (localVsCloud !== undefined && localVsCloud !== null) problems.push('localVsCloud must be "local" or "cloud"')
  const contextConfigured = reviewNumber(raw['contextConfigured'])
  if (contextConfigured !== undefined) entry.contextConfigured = contextConfigured
  const modalities = reviewList(raw['modalities'], problems, 'modalities')
  if (modalities !== undefined) entry.modalities = modalities
  if (raw['toolSupport'] === true || raw['toolSupport'] === false) entry.toolSupport = raw['toolSupport']
  else if (raw['toolSupport'] === null) entry.toolSupport = null
  else if (raw['toolSupport'] !== undefined) problems.push('toolSupport must be true, false, or null')
  const reasoningModes = reviewList(raw['reasoningModes'], problems, 'reasoningModes')
  if (reasoningModes !== undefined) entry.reasoningModes = reasoningModes
  const nativeReasoningDefault = reviewText(raw['nativeReasoningDefault'], problems, 'nativeReasoningDefault')
  if (nativeReasoningDefault !== undefined) entry.nativeReasoningDefault = nativeReasoningDefault
  const recommendedRoutine = reviewText(raw['recommendedRoutine'], problems, 'recommendedRoutine')
  if (recommendedRoutine !== undefined) entry.recommendedRoutine = recommendedRoutine
  const recommendedHeavy = reviewText(raw['recommendedHeavy'], problems, 'recommendedHeavy')
  if (recommendedHeavy !== undefined) entry.recommendedHeavy = recommendedHeavy
  const reasoningNote = reviewText(raw['reasoningNote'], problems, 'reasoningNote')
  if (reasoningNote !== undefined) entry.reasoningNote = reasoningNote
  const strengths = reviewList(raw['strengths'], problems, 'strengths')
  if (strengths !== undefined) entry.strengths = strengths
  const avoid = reviewList(raw['avoid'], problems, 'avoid')
  if (avoid !== undefined) entry.avoid = avoid
  const evidence = reviewText(raw['evidence'], problems, 'evidence')
  if (evidence !== undefined) entry.evidence = evidence
  const pricing = reviewPricing(raw['pricing'], problems, 'pricing')
  if (pricing !== undefined) entry.pricing = pricing
  const pricingNote = reviewText(raw['pricingNote'], problems, 'pricingNote')
  if (pricingNote !== undefined) entry.pricingNote = pricingNote
  const costTier = reviewText(raw['costTier'], problems, 'costTier')
  if (costTier !== undefined) entry.costTier = costTier
  return { entry, problems }
}

/**
 * Parse and validate owner metadata read from disk.
 * @param {string} text raw file contents; may contain any JSON.
 * @returns {{status: 'ok', data: OwnerMetadataFile, problems: string[]} | {status: 'malformed', problems: string[]}}
 *   The `ok` result still carries named problems for every field that was
 *   dropped, so review state stays visible end to end.
 */
export function validateOwnerMetadata(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'malformed', problems: ['file is not valid JSON'] }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'malformed', problems: ['top level is not a JSON object'] }
  }
  const raw = /** @type {Record<string, unknown>} */ (parsed)
  const problems = /** @type {string[]} */ ([])
  const data = /** @type {OwnerMetadataFile} */ ({})
  if (typeof raw['version'] === 'number') data.version = raw['version']
  const routingRule = reviewText(raw['routingRule'], problems, 'routingRule')
  if (routingRule !== undefined) data.routingRule = routingRule
  if (Array.isArray(raw['gpuBoundary'])) {
    data.gpuBoundary = raw['gpuBoundary'].slice(0, MAX_LIST).map((item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        problems.push(`gpuBoundary[${index}] is not an object and was ignored`)
        return undefined
      }
      const gpu = /** @type {Record<string, unknown>} */ (item)
      const label = reviewText(gpu['label'], problems, `gpuBoundary[${index}].label`)
      if (label === undefined) {
        problems.push(`gpuBoundary[${index}] has no label and was ignored`)
        return undefined
      }
      const entry = /** @type {NonNullable<OwnerMetadataFile['gpuBoundary']>[number]} */ ({ label })
      const gpuName = reviewText(gpu['gpuName'], problems, `gpuBoundary[${index}].gpuName`)
      if (gpuName !== undefined) entry.gpuName = gpuName
      const uuid = reviewText(gpu['uuid'], problems, `gpuBoundary[${index}].uuid`)
      if (uuid !== undefined) entry.uuid = uuid
      const role = reviewText(gpu['role'], problems, `gpuBoundary[${index}].role`)
      if (role !== undefined) entry.role = role
      return entry
    }).filter((item) => item !== undefined)
    if (data.gpuBoundary.length === 0) delete data['gpuBoundary']
  } else if (raw['gpuBoundary'] !== undefined && raw['gpuBoundary'] !== null) {
    problems.push('gpuBoundary is not a list and was ignored')
  }
  const models = /** @type {Record<string, OwnerModelEntry>} */ ({})
  if (raw['models'] !== undefined && raw['models'] !== null) {
    if (typeof raw['models'] !== 'object' || Array.isArray(raw['models'])) {
      problems.push('models is not an object and was ignored')
    } else {
      const rawModels = /** @type {Record<string, unknown>} */ (raw['models'])
      for (const [key, entryValue] of Object.entries(rawModels)) {
        if (!isModelKey(key)) {
          problems.push(`models key "${key}" is not "<provider>/<model id>" and was ignored`)
          continue
        }
        const { entry, problems: entryProblems } = reviewOwnerEntry(entryValue)
        if (entryProblems.length > 0) {
          for (const problem of entryProblems) problems.push(`${key}: ${problem}`)
        }
        // A partially valid entry keeps its valid fields plus its named
        // problems; an empty-but-problematic entry stays present so the row is
        // flagged Needs Review instead of silently disappearing.
        if (Object.keys(entry).length > 0 || entryProblems.length > 0) {
          models[key] = entryProblems.length > 0 ? { ...entry, ownerProblems: entryProblems } : entry
        }
      }
    }
  }
  data.models = models
  if (raw['engineVerifications'] !== undefined && raw['engineVerifications'] !== null) {
    const { valid, problems: verProblems } = validateEngineVerifications(raw['engineVerifications'])
    for (const problem of verProblems) problems.push(problem)
    if (valid.length > 0) data.engineVerifications = valid
  }
  if (raw['launchProfiles'] !== undefined && raw['launchProfiles'] !== null) {
    const { valid, problems: lpProblems } = validateLaunchProfiles(raw['launchProfiles'])
    for (const problem of lpProblems) problems.push(problem)
    if (valid.length > 0) data.launchProfiles = valid
  }
  return { status: 'ok', data, problems }
}

/**
 * Merge one discovered model with its owner entry. Owner fields are read only
 * from `ownerEntry`, so no later rediscovery can overwrite them.
 * @param {DiscoveredModel} model
 * @param {OwnerModelEntry|undefined} ownerEntry
 * @param {string} provider
 * @param {(rates: import('./cost.js').CloudRates) => 'fresh'|'stale'|'unverified'} freshness
 * @returns {ModelRow}
 */
const mergeModel = (model, ownerEntry, provider, freshness) => {
  // Entries from validateOwnerMetadata carry pre-validated problems; direct
  // owner entries are re-reviewed so problems still surface as Needs Review.
  const ownerProblems = ownerEntry?.ownerProblems ?? (ownerEntry === undefined ? [] : reviewOwnerEntry(ownerEntry).problems)
  const owner = ownerEntry === undefined ? undefined : reviewOwnerEntry(ownerEntry).entry
  const pricing = owner?.pricing === undefined
    ? undefined
    : { ...owner.pricing, freshness: freshness(owner.pricing), ...(owner.costTier === undefined ? {} : { costTier: owner.costTier }) }
  return {
    provider,
    id: model.id,
    name: model.name,
    localVsCloud: owner?.localVsCloud ?? 'unknown',
    needsReview: ownerProblems.length > 0,
    ...(ownerProblems.length > 0 ? { ownerProblems } : {}),
    ...(model.contextWindow === undefined && owner?.contextConfigured === undefined ? {} : {
      context: {
        ...(model.contextWindow === undefined ? {} : { providerReported: model.contextWindow }),
        ...(owner?.contextConfigured === undefined ? {} : { ownerConfigured: owner.contextConfigured }),
      },
    }),
    ...((model.inputModalities === undefined || model.inputModalities === null) && owner?.modalities === undefined ? {} : {
      modalities: {
        ...(model.inputModalities === undefined || model.inputModalities === null ? {} : { providerReported: model.inputModalities }),
        ...(owner?.modalities === undefined ? {} : { owner: owner.modalities }),
      },
    }),
    ...(owner?.toolSupport === undefined ? {} : { toolSupport: owner.toolSupport }),
    ...(model.reasoning === undefined && owner === undefined ? {} : {
      reasoning: {
        ...(model.reasoning == null ? {} : {
          providerEfforts: model.reasoning.efforts,
          ...(model.reasoning.defaultEffort === undefined ? {} : { providerDefault: model.reasoning.defaultEffort }),
        }),
        ...(owner?.reasoningModes === undefined ? {} : { ownerModes: owner.reasoningModes }),
        ...(owner?.nativeReasoningDefault === undefined ? {} : { ownerNativeDefault: owner.nativeReasoningDefault }),
        ...(owner?.recommendedRoutine === undefined ? {} : { recommendedRoutine: owner.recommendedRoutine }),
        ...(owner?.recommendedHeavy === undefined ? {} : { recommendedHeavy: owner.recommendedHeavy }),
        ...(owner?.reasoningNote === undefined ? {} : { note: owner.reasoningNote }),
      },
    }),
    ...(pricing === undefined ? {} : { pricing }),
    ...(owner?.pricingNote === undefined ? {} : { pricingNote: owner.pricingNote }),
    ...(owner?.strengths === undefined ? {} : { strengths: owner.strengths }),
    ...(owner?.avoid === undefined ? {} : { avoid: owner.avoid }),
    ...(owner?.evidence === undefined ? {} : { evidence: owner.evidence }),
  }
}

/**
 * Overlay the discovered inventory with owner-curated metadata.
 * @param {DiscoveredProvider[]} discovered live provider/model catalog.
 * @param {OwnerMetadataFile} ownerData validated owner metadata.
 * @param {{generatedAt: string, freshness: (rates: import('./cost.js').CloudRates) => 'fresh'|'stale'|'unverified', metadataStatus: string, metadataPath?: string, metadataProblems?: string[]}} options
 * @returns {MergedSnapshot}
 */
export function overlay(discovered, ownerData, options) {
  const ownerModels = ownerData.models ?? {}
  const providers = discovered.map((provider) => ({
    id: provider.id,
    name: provider.name,
    ...(provider.error === undefined ? {} : { error: provider.error }),
    models: provider.models.map((model) => mergeModel(model, ownerModels[`${provider.id}/${model.id}`], provider.id, options.freshness)),
  }))
  const seen = new Set(providers.flatMap((provider) => provider.models.map((model) => `${model.provider}/${model.id}`)))
  const curatedOnly = Object.entries(ownerModels)
    .filter(([key]) => !seen.has(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => {
      const provider = key.slice(0, key.indexOf('/'))
      const id = key.slice(key.indexOf('/') + 1)
      return mergeModel({ id, name: id }, entry, provider, options.freshness)
    })
  // Durable research signal: derived from the same persisted owner entries and
  // live discovery rows the owner sees after any refresh — no extra state.
  const researchCounts = {
    newlyDetected: providers.reduce((total, provider) => total
      + provider.models.filter((model) => ownerModels[`${provider.id}/${model.id}`] === undefined).length, 0),
    allUnverified: typeof options.freshness === 'function'
      ? unresolvedModels({ providers, curatedOnly }, ownerData, options.freshness).length
      : providers.reduce((total, provider) => total
        + provider.models.filter((model) => (model.fields ?? []).length > 0).length, 0)
        + curatedOnly.filter((model) => (model.fields ?? []).length > 0).length,
  }
  return {
    generatedAt: options.generatedAt,
    metadata: { status: options.metadataStatus, path: options.metadataPath ?? '', ...(options.metadataProblems === undefined ? {} : { problems: options.metadataProblems }) },
    routingRule: ownerData.routingRule ?? null,
    gpuBoundary: ownerData.gpuBoundary ?? null,
    providers,
    curatedOnly,
    researchCounts,
  }
}