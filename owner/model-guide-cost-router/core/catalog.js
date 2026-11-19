/**
 * Saved canonical model catalog: provider-reported facts with evidence dates,
 * plus the pure diff machinery the Update Models & Pricing flow uses.
 *
 * The catalog is the durable record of what discovery last observed. Owner
 * curation NEVER lives here — it stays in owner-model-guidance.json and is
 * overlaid at render time, so updating the catalog can never overwrite owner
 * recommendations like a routine reasoning setting.
 */

/**
 * A provider-reported reasoning surface recorded verbatim.
 * @typedef {object} CatalogReasoning
 * @property {{id: string, name: string}[]} efforts the provider's own level
 *   ids and names, in provider order — never mapped onto a generic ladder.
 * @property {string} [defaultEffort] the provider's reported native default.
 */

/**
 * One model as last observed from discovery.
 * @typedef {object} CatalogModel
 * @property {string} id exact live model id.
 * @property {string} name
 * @property {number} [contextWindow]
 * @property {string[]} [inputModalities]
 * @property {CatalogReasoning} [reasoning]
 * @property {{source: string, verifiedAt: string}} evidence where the facts
 *   came from and when they were last observed.
 * @property {{verifiedAt: string, contextWindow?: number, reasoningEfforts?: string[], reasoningDefault?: string}[]} [history]
 *   bounded trail of prior observations used to flag stale or changed metadata.
 */

/**
 * One provider as last observed from discovery.
 * @typedef {object} CatalogProvider
 * @property {string} id
 * @property {string} name
 * @property {string} [error] last listing failure, when the provider could not
 *   be listed; its models list stays from the previous successful observation
 *   and is flagged, never silently trusted.
 * @property {CatalogModel[]} models
 */

/**
 * The saved catalog file content.
 * @typedef {object} Catalog
 * @property {1} version
 * @property {string} generatedAt
 * @property {CatalogProvider[]} providers
 * @property {object} lastUpdate the most recent update report (see update.js).
 */

/**
 * Whether the model has any reasoning surface at all.
 * @param {CatalogModel} model
 * @returns {boolean}
 */
export const hasReasoning = (model) => model.reasoning !== undefined
  && Array.isArray(model.reasoning?.efforts)
  && model.reasoning.efforts.length > 0

/**
 * Describe one provider-reported reasoning set verbatim. Never maps ids onto a
 * generic ladder: the provider's own names are the description.
 * @param {CatalogModel['reasoning']} reasoning
 * @returns {string}
 */
export const describeReasoningSet = (reasoning) => {
  if (reasoning === undefined || !Array.isArray(reasoning.efforts) || reasoning.efforts.length === 0) {
    return 'no reasoning'
  }
  const ids = reasoning.efforts.map((effort) => effort.id)
  if (ids.every((id) => id === 'off' || id === 'on')) return `On/Off switch${reasoning.defaultEffort === undefined ? '' : ` (default ${reasoning.defaultEffort})`}`
  return `${ids.join('/')}${reasoning.defaultEffort === undefined ? '' : ` (default ${reasoning.defaultEffort})`}`
}

/**
 * Canonical key of one model inside the catalog and owner metadata.
 * @param {string} provider
 * @param {string} id
 * @returns {string}
 */
export const modelKey = (provider, id) => `${provider}/${id}`

/**
 * The comparable facts of one catalog model, stringified for diffing. Absent
 * fields stay absent so "Unknown" never compares equal to a real value.
 * @param {CatalogModel} model
 * @returns {Record<string, string|undefined>}
 */
const comparableFacts = (model) => ({
  name: model.name,
  ...(model.contextWindow === undefined ? {} : { contextWindow: String(model.contextWindow) }),
  ...(model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities].sort().join(',') }),
  ...(hasReasoning(model) ? { reasoningEfforts: model.reasoning.efforts.map((effort) => effort.id).join('/') } : {}),
  ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningDefault: model.reasoning.defaultEffort }),
})

/**
 * Diff the previous catalog against a fresh observation.
 * @param {Catalog|undefined|null} previous the saved catalog, when one exists.
 * @param {{id: string, name: string, error?: string, models: Array<object>}[]} providers fresh discovery rows.
 * @returns {{added: string[], removed: string[], changed: {key: string, field: string, from: string|undefined, to: string|undefined}[]}}
 *   Keys use `provider/modelId`. Removed and changed are only asserted against
 *   providers that listed successfully this run; a provider that errored is
 *   reported as unverifiable rather than "removed".
 */
export const diffCatalog = (previous, providers) => {
  /** @type {Map<string, CatalogProvider>} */
  const previousProviders = new Map((previous?.providers ?? []).map((providerData) => [providerData.id, providerData]))
  /** @type {Map<string, CatalogModel>} */
  const previousModels = new Map()
  for (const providerData of previousProviders.values()) {
    for (const model of providerData.models) previousModels.set(modelKey(providerData.id, model.id), model)
  }
  const freshModels = new Map()
  for (const providerData of providers) {
    for (const model of providerData.models) freshModels.set(modelKey(providerData.id, model.id), model)
  }
  const added = [...freshModels.keys()].filter((key) => !previousModels.has(key)).sort()
  // A model is only "removed" if its provider listed fine this run and no
  // longer offers it; failing providers mark their models unverifiable.
  const removed = [...previousModels.keys()].filter((key) => {
    const providerId = key.slice(0, key.indexOf('/'))
    const fresh = providers.find((candidate) => candidate.id === providerId)
    return fresh !== undefined && fresh.error === undefined && !freshModels.has(key)
  }).sort()
  /** @type {{key: string, field: string, from: string|undefined, to: string|undefined}[]} */
  const changed = []
  for (const [key, fresh] of freshModels) {
    const before = previousModels.get(key)
    if (before === undefined) continue
    const beforeFacts = comparableFacts(before)
    const afterFacts = comparableFacts(fresh)
    for (const field of Object.keys(afterFacts)) {
      if (beforeFacts[field] !== afterFacts[field]) {
        changed.push({ key, field, from: beforeFacts[field], to: afterFacts[field] })
      }
    }
  }
  changed.sort((left, right) => left.key.localeCompare(right.key) || left.field.localeCompare(right.field))
  return { added, removed, changed }
}

/**
 * Classify a reasoning-set change: Harness-cached provider metadata can be
 * stale, so a changed set is an observation to verify, not a truth to apply.
 * @param {string} from describeReasoningSet() of the previous observation.
 * @param {string} to describeReasoningSet() of the fresh observation.
 * @returns {{kind: 'first-seen'|'stable'|'changed', from?: string, to?: string, note?: string}}
 */
export const classifyReasoningChange = (from, to) => {
  if (from === to) return { kind: 'stable' }
  return {
    kind: 'changed',
    from,
    to,
    note: 'provider-reported reasoning metadata changed since the last update; verify against vendor evidence before trusting either set',
  }
}

/**
 * Build one fresh catalog entry for a discovered model, preserving the bounded
 * history trail from the previous catalog.
 * @param {CatalogModel|undefined} previous previous entry for the same key.
 * @param {{id: string, name: string, contextWindow?: number, inputModalities?: string[], reasoning?: CatalogReasoning}} fresh
 * @param {string} now ISO timestamp of this observation.
 * @param {{id: string, name: string, error?: string}} provider owning provider row.
 * @param {number} maxHistory maximum history entries kept per model.
 * @returns {{entry: CatalogModel, reasoningChange: {kind: string, from?: string, to?: string, note?: string}}}
 */
export const catalogEntry = (previous, fresh, now, provider, maxHistory) => {
  const entry = {
    id: fresh.id,
    name: fresh.name,
    ...(fresh.contextWindow === undefined ? {} : { contextWindow: fresh.contextWindow }),
    ...(fresh.inputModalities === undefined ? {} : { inputModalities: [...fresh.inputModalities] }),
    ...(fresh.reasoning === undefined ? {} : { reasoning: fresh.reasoning }),
    evidence: { source: `harness:llm-discovery provider=${provider.id}`, verifiedAt: now },
  }
  if (previous !== undefined) {
    const reasoningChange = classifyReasoningChange(
      describeReasoningSet(previous.reasoning),
      describeReasoningSet(entry.reasoning),
    )
    const priorTrail = [
      {
        verifiedAt: previous.evidence?.verifiedAt ?? now,
        ...(previous.contextWindow === undefined ? {} : { contextWindow: previous.contextWindow }),
        ...(previous.reasoning === undefined ? {} : { reasoningEfforts: previous.reasoning.efforts?.map((effort) => effort.id) }),
        ...(previous.reasoning?.defaultEffort === undefined ? {} : { reasoningDefault: previous.reasoning.defaultEffort }),
      },
      ...(previous.history ?? []),
    ].slice(0, Math.max(0, maxHistory))
    if (priorTrail.length > 0) entry.history = priorTrail
    return { entry, reasoningChange }
  }
  const reasoningChange = classifyReasoningChange(describeReasoningSet(undefined), describeReasoningSet(entry.reasoning))
  return { entry, reasoningChange: reasoningChange.kind === 'stable' ? reasoningChange : { kind: 'first-seen' } }
}

/**
 * Validate the saved catalog file. Fails safe: a malformed catalog is reported
 * as unusable rather than partially trusted.
 * @param {unknown} value parsed JSON value.
 * @returns {{ok: true, catalog: Catalog} | {ok: false, reason: string}}
 */
export const validateCatalog = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'catalog is not a JSON object' }
  const catalog = /** @type {Record<string, unknown>} */ (value)
  if (catalog['version'] !== 1) return { ok: false, reason: 'catalog version must be 1' }
  if (!Array.isArray(catalog['providers'])) return { ok: false, reason: 'catalog providers must be a list' }
  for (const providerData of /** @type {unknown[]} */ (catalog['providers'])) {
    if (providerData === null || typeof providerData !== 'object') return { ok: false, reason: 'catalog provider is not an object' }
    const provider = /** @type {Record<string, unknown>} */ (providerData)
    if (typeof provider['id'] !== 'string' || typeof provider['name'] !== 'string') return { ok: false, reason: 'catalog provider id/name must be strings' }
    if (!Array.isArray(provider['models'])) return { ok: false, reason: 'catalog provider models must be a list' }
    for (const modelData of /** @type {unknown[]} */ (provider['models'])) {
      if (modelData === null || typeof modelData !== 'object') return { ok: false, reason: 'catalog model is not an object' }
    }
  }
  return { ok: true, catalog: /** @type {Catalog} */ (value) }
}