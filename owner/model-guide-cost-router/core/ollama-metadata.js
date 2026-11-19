/**
 * Official Ollama metadata ingestion: turn the provider's own machine-readable
 * model records into the verified capability facts this bundle stores, and
 * decide per field whether a fact may replace what the owner already recorded.
 *
 * Source contract (verified against https://ollama.com, 2026-11-07):
 *   GET  /api/tags  → {models: [{name, model, modified_at, size, digest,
 *                      details, capabilities: [completion|tools|thinking|vision]}]}
 *   POST /api/show  body {"model": "<name>"} → {capabilities, details,
 *                      model_info: {"<arch>.context_length": N, …},
 *                      modified_at, thinking?: {values: [false|'low'|…], default}}
 *
 * Everything here is the provider's own assertion about its own model. Nothing
 * in this module invents a capability: a field the provider does not publish
 * stays absent, and an absent field never clears a value the owner curated.
 * Subjective judgements (strengths, avoid, recommendations) are never produced.
 */

/** The reasoning level names Ollama publishes, in the display form the owner file uses. */
const LEVEL_LABELS = Object.freeze({
  false: 'Off',
  off: 'Off',
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
})

/**
 * Render one published thinking value as a display level name.
 * @param {unknown} value
 * @returns {string|undefined}
 */
const levelLabel = (value) => {
  if (value === false) return LEVEL_LABELS.false
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  if (key.length === 0) return undefined
  return LEVEL_LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1))
}

/**
 * Read the context length out of an Ollama `model_info` map. The key is
 * architecture-prefixed (`kimi-k3.context_length`), and the architecture is
 * named in `general.architecture`; a differently-prefixed key is accepted only
 * when it is the sole `*.context_length` entry, so a renamed architecture does
 * not silently yield the wrong number.
 * @param {Record<string, unknown>|undefined} modelInfo
 * @returns {number|undefined}
 */
export const readContextLength = (modelInfo) => {
  if (typeof modelInfo !== 'object' || modelInfo === null) return undefined
  const keys = Object.keys(modelInfo).filter((key) => key.endsWith('.context_length'))
  if (keys.length === 0) return undefined
  const architecture = modelInfo['general.architecture']
  const preferred = typeof architecture === 'string' ? `${architecture}.context_length` : undefined
  const key = preferred !== undefined && keys.includes(preferred) ? preferred : (keys.length === 1 ? keys[0] : undefined)
  if (key === undefined) return undefined
  const value = modelInfo[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Read the published reasoning levels and the native default.
 * `thinking` is absent for a model with no reasoning control at all, and its
 * `values` may contain `false` for "off". A published list is taken verbatim
 * (labelled, de-duplicated, order preserved); nothing is added.
 * @param {unknown} thinking the `thinking` member of a show record.
 * @returns {{levels: string[], default?: string}|undefined}
 */
export const readReasoningLevels = (thinking) => {
  if (typeof thinking !== 'object' || thinking === null) return undefined
  const values = /** @type {Record<string, unknown>} */ (thinking)['values']
  if (!Array.isArray(values)) return undefined
  const levels = []
  for (const value of values) {
    const label = levelLabel(value)
    if (label !== undefined && !levels.includes(label)) levels.push(label)
  }
  if (levels.length === 0) return undefined
  const rawDefault = /** @type {Record<string, unknown>} */ (thinking)['default']
  const defaultLabel = levelLabel(rawDefault)
  return {
    levels,
    ...(defaultLabel !== undefined && levels.includes(defaultLabel) ? { default: defaultLabel } : {}),
  }
}

/**
 * Read the input modalities from a capabilities list. `completion` is text;
 * `vision` adds image. Audio/video are not published by this provider today
 * and are therefore never claimed.
 * @param {unknown} capabilities
 * @returns {string[]|undefined}
 */
export const readModalities = (capabilities) => {
  if (!Array.isArray(capabilities)) return undefined
  const names = capabilities.filter((entry) => typeof entry === 'string').map((entry) => entry.toLowerCase())
  const modalities = []
  if (names.includes('completion') || names.includes('tools') || names.includes('thinking')) modalities.push('text')
  if (names.includes('vision')) modalities.push('image')
  return modalities.length === 0 ? undefined : modalities
}

/**
 * True when the provider positively advertises tool/function calling.
 * A capabilities list without `tools` is a negative answer, not a missing one:
 * the provider enumerated this model's capabilities and tools was not among
 * them.
 * @param {unknown} capabilities
 * @returns {boolean|undefined}
 */
export const readToolSupport = (capabilities) => {
  if (!Array.isArray(capabilities)) return undefined
  const names = capabilities.filter((entry) => typeof entry === 'string').map((entry) => entry.toLowerCase())
  if (names.length === 0) return undefined
  return names.includes('tools')
}

/**
 * Build the verified capability facts for one model from its show record.
 * Each fact carries its own source and verification instant, so a partial
 * record still produces individually verifiable facts.
 * @param {object} show one `POST /api/show` response body.
 * @param {{source: string, verifiedAt: string, cloud: boolean}} provenance
 * @returns {Record<string, {value: unknown, source: string, verifiedAt: string}>}
 */
export const factsFromShowRecord = (show, provenance) => {
  const record = typeof show === 'object' && show !== null ? /** @type {Record<string, unknown>} */ (show) : {}
  const stamp = { source: provenance.source, verifiedAt: provenance.verifiedAt }
  /** @type {Record<string, {value: unknown, source: string, verifiedAt: string}>} */
  const facts = {}
  facts['deployment'] = { value: provenance.cloud ? 'cloud' : 'local', ...stamp }
  const context = readContextLength(/** @type {Record<string, unknown>|undefined} */ (record['model_info']))
  if (context !== undefined) facts['contextWindow'] = { value: context, ...stamp }
  const modalities = readModalities(record['capabilities'])
  if (modalities !== undefined) facts['inputModalities'] = { value: modalities, ...stamp }
  const tools = readToolSupport(record['capabilities'])
  if (tools !== undefined) facts['toolSupport'] = { value: tools, ...stamp }
  const reasoning = readReasoningLevels(record['thinking'])
  if (reasoning !== undefined) {
    facts['reasoningEfforts'] = { value: reasoning.levels, ...stamp }
    if (reasoning.default !== undefined) facts['reasoningDefault'] = { value: reasoning.default, ...stamp }
  }
  return facts
}

/**
 * The model names a `/api/tags` answer lists.
 * @param {unknown} tags the parsed tags body.
 * @returns {string[]}
 */
export const modelNamesFromTags = (tags) => {
  if (typeof tags !== 'object' || tags === null) return []
  const models = /** @type {Record<string, unknown>} */ (tags)['models']
  if (!Array.isArray(models)) return []
  const names = []
  for (const row of models) {
    if (typeof row !== 'object' || row === null) continue
    const name = /** @type {Record<string, unknown>} */ (row)['name'] ?? /** @type {Record<string, unknown>} */ (row)['model']
    if (typeof name === 'string' && name.trim().length > 0) names.push(name.trim())
  }
  return [...new Set(names)]
}

/** The owner field each provider fact lands in. */
const OWNER_FIELD = Object.freeze({
  deployment: 'localVsCloud',
  contextWindow: 'contextConfigured',
  inputModalities: 'modalities',
  reasoningEfforts: 'reasoningModes',
  reasoningDefault: 'nativeReasoningDefault',
  toolSupport: 'toolSupport',
})

/**
 * Decide which verified facts may be written onto one owner entry.
 *
 * The rule is deliberately narrow: enrichment fills a field that is ABSENT and
 * never replaces one that is already recorded. An owner entry is an audit
 * record — "Modalities: text+image, verified 2026-10-13 from the provider's own
 * metadata" — and a background refresh silently rewriting it would destroy
 * exactly the provenance that makes the entry trustworthy. A provider fact that
 * disagrees with a recorded one is reported as a discrepancy for the owner to
 * review, not written.
 *
 * The practical consequence is the two behaviours the owner asked for: a
 * brand-new model becomes usable with no hand configuration (every field is
 * absent, so every field is filled), and an audited entry such as
 * `ollama/kimi-k3` keeps every manually verified value while still gaining any
 * field it never had.
 * @param {Record<string, unknown>|undefined} entry the current owner entry.
 * @param {Record<string, {value: unknown}>} facts verified facts for this model.
 * @returns {{
 *   accepted: Record<string, {value: unknown, fact: string}>,
 *   kept: {field: string, fact: string, recorded: unknown, published: unknown}[],
 *   agreed: string[],
 * }}
 */
export const planFactMerge = (entry, facts) => {
  const current = typeof entry === 'object' && entry !== null ? entry : {}
  /** @type {Record<string, {value: unknown, fact: string}>} */
  const accepted = {}
  /** @type {{field: string, fact: string, recorded: unknown, published: unknown}[]} */
  const kept = []
  /** @type {string[]} */
  const agreed = []
  for (const [fact, payload] of Object.entries(facts)) {
    const field = OWNER_FIELD[fact]
    if (field === undefined) continue // no owner home for this fact; never invent one
    const existing = current[field]
    const absent = existing === undefined || existing === null || (Array.isArray(existing) && existing.length === 0)
    if (absent) {
      accepted[field] = { value: payload.value, fact }
      continue
    }
    if (JSON.stringify(existing) === JSON.stringify(payload.value)) {
      agreed.push(field)
      continue
    }
    kept.push({ field, fact, recorded: existing, published: payload.value })
  }
  return { accepted, kept, agreed }
}
