/**
 * Research-result ingestion: deterministic validation of structured research
 * JSON the owner pastes back after running the research prompt against official
 * sources, plus the verified-facts merge that produces a reviewable diff for
 * the owner to confirm. Never overwrites owner curation fields, never accepts
 * a fact without an official source URL and a verification date, and only
 * accepts exact `provider/modelId` keys the current inventory knows.
 */

/** Fact field contract: research fact name → owner metadata field. */
export const FACT_FIELD_CONTRACT = {
  contextWindow: 'contextConfigured',
  deployment: 'localVsCloud',
  inputModalities: 'modalities',
  reasoningEfforts: 'reasoningModes',
  reasoningDefault: 'nativeReasoningDefault',
  toolSupport: 'toolSupport',
  toolSupportNote: 'toolSupportNote',
  // Cloud deployments only; the owner-pricing record is the canonical
  // `{ inputPerMTok, cachedInputPerMTok, outputPerMTok, offPeak?, source, verifiedAt }`
  // shape the deterministic parsers already write — no competing schema.
  pricing: 'pricing',
}

/** Fields an imported fact must carry; a fact missing any of them is rejected. */
const FACT_META_KEYS = ['source', 'verifiedAt']

/** True when `payload` is a fact object with a `value` key. */
const payloadOk = (payload) => typeof payload === 'object' && payload !== null && 'value' in payload

/** The rate keys the canonical pricing record carries, flattened for diffs. */
const PRICING_RATE_KEYS = ['inputPerMTok', 'cachedInputPerMTok', 'outputPerMTok']

/**
 * Validate one canonical rates object (used for `pricing` and for `offPeak`).
 * @param {unknown} rates the rate payload.
 * @returns {string|undefined} a rejection reason, or undefined when valid.
 */
const rejectRatesObject = (rates) => {
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) {
    return 'pricing value must be the canonical record { inputPerMTok, cachedInputPerMTok, outputPerMTok } (each a finite number >= 0 or null, optional offPeak with the same shape)'
  }
  const keys = Object.keys(rates)
  const allowed = [...PRICING_RATE_KEYS, 'offPeak']
  if (keys.some((key) => !allowed.includes(key))) {
    return `pricing accepts only ${PRICING_RATE_KEYS.join(', ')} plus optional offPeak`
  }
  let anyRate = false
  for (const key of PRICING_RATE_KEYS) {
    const rate = rates[key]
    if (rate === undefined) { rates[key] = null; continue }
    if (rate === null) continue
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
      return 'pricing rates must be finite numbers >= 0, or null when the official table shows none'
    }
    anyRate = true
  }
  const offPeak = rates['offPeak']
  if (offPeak !== undefined && offPeak !== null) {
    if (typeof offPeak !== 'object' || offPeak === null || Array.isArray(offPeak)) {
      return 'offPeak must be a rates object with the same three keys'
    }
    const offKeys = Object.keys(offPeak)
    if (offKeys.some((key) => !PRICING_RATE_KEYS.includes(key))) {
      return 'offPeak accepts only inputPerMTok, cachedInputPerMTok, outputPerMTok'
    }
    let offAny = false
    for (const key of PRICING_RATE_KEYS) {
      const rate = offPeak[key]
      if (rate === undefined) { offPeak[key] = null; continue }
      if (rate === null) continue
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
        return 'off-peak rates must be finite numbers >= 0, or null'
      }
      offAny = true
    }
    if (!offAny) return 'offPeak must carry at least one rate'
  } else if ('offPeak' in rates) {
    delete rates['offPeak'] // explicit null off-peak: absent, like the parsers write it
  }
  return anyRate ? undefined : 'pricing must carry at least one verified rate'
}

/**
 * Flatten one imported pricing value against the stored record into scalar
 * per-rate diffs (the same shape the deterministic refresh produces, so the
 * same formatter renders both).
 * @param {Record<string, unknown>} previous the stored pricing record or {}.
 * @param {Record<string, unknown>} next the composed new record without meta.
 * @returns {{field: string, from: number|null, to: number|null}[]} the diffs.
 */
const pricingDiffs = (previous, next) => {
  const read = (record, path) => {
    if (typeof record !== 'object' || record === null) return null
    if (!path.startsWith('offPeak.')) return record[path] ?? null
    const off = record['offPeak']
    return typeof off === 'object' && off !== null ? off[path.slice('offPeak.'.length)] ?? null : null
  }
  const paths = [...PRICING_RATE_KEYS, ...(typeof next === 'object' && next !== null && typeof next['offPeak'] === 'object' && next['offPeak'] !== null ? PRICING_RATE_KEYS.map((key) => `offPeak.${key}`) : [])]
  return paths
    .map((path) => ({ field: `pricing.${path}`, from: read(previous, path) ?? null, to: read(next, path) ?? null }))
    .filter((diff) => diff.from !== diff.to)
}

/**
 * Validate one fact's per-field value type.
 * @param {string} fact the contract name (import input, not the owner field).
 * @param {unknown} value the `value` payload.
 * @returns {string|undefined} a rejection reason, or undefined when valid.
 */
const rejectFactValue = (fact, value) => {
  switch (fact) {
    case 'contextWindow':
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? undefined : 'contextWindow must be a positive integer'
    case 'deployment':
      return value === 'local' || value === 'cloud' ? undefined : 'deployment must be "local" or "cloud"'
    case 'inputModalities':
    case 'reasoningEfforts':
      return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0)
        ? undefined
        : `${fact} must be a non-empty list of non-empty strings`
    case 'reasoningDefault':
    case 'toolSupportNote':
      return typeof value === 'string' && value.trim().length > 0 ? undefined : `${fact} must be a non-empty string`
    case 'toolSupport':
      return typeof value === 'boolean' ? undefined : 'toolSupport must be a boolean'
    case 'pricing':
      return rejectRatesObject(value)
    default:
      return 'unknown fact field — the importer accepts only the documented facts'
  }
}

/**
 * Validate structured research results against the owner catalog and the live
 * inventory keys, and compute the reviewable merge diff without writing
 * anything.
 * @param {unknown} results the pasted JSON value (an array of blocks or
 *   `{models: [...]}`).
 * @param {Record<string, object>|undefined} ownerModels current owner entries.
 * @param {string[]} knownKeys exact `provider/modelId` keys the snapshot or the
 *   owner catalog already contains (cross-provider aliasing is impossible by
 *   construction because every key is provider-qualified).
 * @returns {{ok: boolean, factsByOwnerKey: Record<string, object>, changes: object[], rejected: object[], reason?: string}} the
 *   validated facts plus per-fact diffs and rejection reasons.
 */
export function validateResearchResults(results, ownerModels, knownKeys) {
  const blocks = Array.isArray(results) ? results
    : typeof results === 'object' && results !== null && Array.isArray(results['models']) ? results['models']
      : null
  if (blocks === null) {
    return { ok: false, factsByOwnerKey: {}, changes: [], rejected: [{ reason: 'the research result must be an array of model blocks or {"models": [...]}' }] }
  }
  const known = new Set(knownKeys)
  const curated = ownerModels ?? {}
  /** @type {Record<string, object>} */
  const factsByOwnerKey = {}
  /** @type {object[]} */
  const changes = []
  /** @type {object[]} */
  const rejected = []
  for (const block of blocks) {
    const key = typeof block === 'object' && block !== null ? block['model'] : undefined
    if (typeof key !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(key)) {
      rejected.push({ model: key, reason: 'malformed model key — the exact "provider/modelId" form is required' })
      continue
    }
    if (!known.has(key)) {
      rejected.push({ model: key, reason: 'unknown model key — the importer only accepts exact provider-qualified keys from the current inventory; cross-provider aliases are never accepted' })
      continue
    }
    const facts = typeof block === 'object' && block !== null && typeof block['facts'] === 'object' && block['facts'] !== null
      ? block['facts'] : null
    if (facts === null) {
      rejected.push({ model: key, reason: 'each block must carry a "facts" object' })
      continue
    }
    const applied = {}
    // Pricing guard: cloud deployments only. The deployment comes from the
    // already-recorded entry or from the deployment fact in the same block —
    // never from a positively local model.
    const deployment = curated[key]?.localVsCloud
      ?? (payloadOk(facts['deployment'])
        && (facts['deployment']['value'] === 'local' || facts['deployment']['value'] === 'cloud')
        ? facts['deployment']['value'] : undefined)
    for (const [fact, payload] of Object.entries(facts)) {
      const value = typeof payload === 'object' && payload !== null && 'value' in payload ? payload['value'] : undefined
      let reason = fact === 'pricing' && deployment !== 'cloud'
        ? deployment === 'local'
          ? 'pricing is only importable for cloud deployments — a recorded-local deployment has no cloud/API rates and stays $0/NA'
          : 'pricing import requires a cloud deployment — include deployment: "cloud" or import for a model already recorded cloud'
        : undefined
      if (reason === undefined) reason = rejectFactValue(fact, value)
      for (const meta of FACT_META_KEYS) {
        if (reason === undefined && !(typeof payload === 'object' && payload !== null && typeof payload[meta] === 'string' && payload[meta].trim().length > 0)) {
          reason = `${meta} is required — a bare assertion is never accepted without the official source you used and the verification date`
        }
      }
      if (reason === undefined && !/^https?:\/\//i.test(payload['source'].trim())) {
        reason = 'source must be the official http(s) URL you verified the fact against'
      }
      if (reason === undefined && Number.isNaN(Date.parse(payload['verifiedAt']))) {
        reason = 'verifiedAt must be a valid date string'
      }
      if (reason !== undefined) {
        rejected.push({ model: key, fact, reason })
        continue
      }
      const field = FACT_FIELD_CONTRACT[fact]
      if (fact === 'pricing') {
        // The canonical owner-pricing record keeps source and verifiedAt
        // inside the record, exactly like the deterministic parsers write it.
        const rates = { ...payload['value'] }
        applied[field] = { value: { ...rates, source: payload['source'].trim(), verifiedAt: payload['verifiedAt'].trim() }, source: payload['source'].trim(), verifiedAt: payload['verifiedAt'].trim() }
      } else {
        applied[field] = { value: payload['value'], source: payload['source'].trim(), verifiedAt: payload['verifiedAt'].trim() }
      }
    }
    if (Object.keys(applied).length === 0) continue
    const entry = curated[key] ?? {}
    for (const [field, fact] of Object.entries(applied)) {
      if (field === 'pricing') {
        const rateDiffs = pricingDiffs(entry['pricing'] ?? null, fact.value)
        if (rateDiffs.length > 0) {
          for (const diff of rateDiffs) changes.push({ key, ...diff, source: fact.source, verifiedAt: fact.verifiedAt })
        } else if (entry['pricing']?.source !== fact.source || entry['pricing']?.verifiedAt !== fact.verifiedAt) {
          changes.push({ key, field: 'pricing.verifiedAt', from: entry['pricing']?.verifiedAt ?? null, to: fact.verifiedAt, source: fact.source, verifiedAt: fact.verifiedAt })
        } else {
          continue // identical verified rates: nothing to review
        }
        continue
      }
      const previous = entry[field] ?? null
      if (JSON.stringify(previous) === JSON.stringify(fact.value)) continue
      changes.push({ key, field, from: previous, to: fact.value, source: fact.source, verifiedAt: fact.verifiedAt })
    }
    factsByOwnerKey[key] = Object.fromEntries(Object.entries(applied).map(([field, fact]) => [field, fact.value]))
  }
  return {
    ok: Object.keys(factsByOwnerKey).length > 0,
    factsByOwnerKey,
    changes,
    rejected,
  }
}