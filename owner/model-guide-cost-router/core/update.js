/**
 * The Update Models & Pricing workflow core: rescan → diff → verify → record.
 *
 * Staged safety design. Automatic stages gather and compare; they never invent
 * and never overwrite owner curation:
 *  1. rescan providers via live discovery (existing Harness LLM surface),
 *  2. diff against the saved catalog (added / removed / changed),
 *  3. classify reasoning surfaces verbatim and flag reasoning-set changes as
 *     metadata possibly stale — never as grounds to correct owner settings,
 *  4. optionally capture official pricing pages as evidence snapshots
 *     (raw bytes + sha256 + date); rates are NEVER parsed automatically, so a
 *     snapshot can support owner review but cannot silently change prices,
 *  5. write the catalog + the regenerated human-readable guide, and return a
 *     report. Observed token-usage history, when available later, is computed
 *     from real reported counts and labeled observed — it is deliberately not
 *     fabricated here when no reliable source exists.
 */

/**
 * One pricing-page evidence snapshot attempt.
 * @typedef {object} PricingSnapshot
 * @property {string} url
 * @property {boolean} ok
 * @property {string} fetchedAt
 * @property {number} [bytes]
 * @property {string} [sha256]
 * @property {string} [error]
 */

/**
 * The report returned by one Update run.
 * @typedef {object} UpdateReport
 * @property {string} generatedAt
 * @property {string[]} added keys `provider/modelId`.
 * @property {string[]} removed keys confirmed by a successful provider listing.
 * @property {{key: string, field: string, from: string|undefined, to: string|undefined}[]} changed
 * @property {{key: string, from?: string, to?: string, note?: string, kind: string}[]} reasoningChanges
 * @property {{key: string, ownerNativeDefault: string, providerDefault: string, note: string}[]} ownerNativeMismatches
 * @property {{url: string, ok: boolean, fetchedAt: string, bytes?: number, sha256?: string, error?: string}[]} pricingSnapshots
 * @property {{key: string, verifiedAt: string, state: string}[]} stalePrices
 * @property {{kind: string, message: string}[]} notes
 * @property {{providers: number, models: number, curatedOnly: number}} counts
 */

import { catalogEntry, diffCatalog, modelKey, validateCatalog } from './catalog.js'
import { priceFreshness } from './cost.js'

/**
 * Build a bounded evidence snapshot record from one fetch result. The core
 * never performs network I/O itself; the host supplies the fetch attempt.
 * @param {{url: string, status: 'fetched'|'failed', fetchedAt: string, bytes?: number, sha256?: string, error?: string}} attempt
 * @returns {PricingSnapshot}
 */
export const snapshotRecord = (attempt) => ({
  url: attempt.url,
  ok: attempt.status === 'fetched',
  fetchedAt: attempt.fetchedAt,
  ...(attempt.status === 'fetched' ? { bytes: attempt.bytes ?? 0, ...(attempt.sha256 === undefined ? {} : { sha256: attempt.sha256 }) } : { error: attempt.error ?? 'fetch failed' }),
})

/**
 * Run the update flow over one fresh discovery pass.
 * @param {object} input
 * @param {unknown} previousRaw previous catalog file value (may be malformed).
 * @param {{id: string, name: string, error?: string, models: Array<object>}[]} discovered fresh discovery rows.
 * @param {{routingRule?: string, models?: Record<string, object>}} ownerData owner metadata
 *   (read-only in this flow; never written back).
 * @param {(rates: object) => string} freshness rate staleness judge.
 * @param {PricingSnapshot[]} snapshots already-performed fetch attempts.
 * @param {{status: 'updated'|'retained'|'failed', source?: string, verifiedAt?: string,
 *   reason?: string, changed: {key: string, changes: {field: string, from: unknown, to: unknown}[]}[],
 *   unmapped: string[], ambiguous: {id: string, reason: string}[]}} [pricingRefresh]
 *   verified official-rate application for the Ollama provider; only per-model
 *   price fields flow through, owner recommendations are never included.
 * @param {{key: string, name: string, fields: string[]}[]} [researchNeeded] newly
 *   discovered models with no owner curation — recorded, never auto-curated.
 * @param {string} now ISO timestamp of the run.
 * @param {number} maxHistory bounded history entries kept per model.
 * @returns {{catalog: object, report: UpdateReport, catalogWasMalformed: boolean}}
 */
export const applyUpdate = (input) => {
  const { previousRaw, discovered, ownerData, freshness, snapshots, pricingRefresh, researchNeeded = [], now, maxHistory } = input
  const previousCheck = validateCatalog(previousRaw)
  const previous = previousCheck.ok ? previousCheck.catalog : undefined
  const { added, removed, changed } = diffCatalog(previous, discovered)
  const catalogWasMalformed = !previousCheck.ok && previousRaw !== undefined && previousRaw !== null
    && typeof previousRaw === 'object'
  /** @type {{key: string, from?: string, to?: string, note?: string, kind: string}[]} */
  const reasoningChanges = []

  /** @type {Map<string, {id: string, name: string, contextWindow?: number, inputModalities?: string[], reasoning?: object}>} */
  const freshByKey = new Map()
  for (const providerData of discovered) {
    for (const model of providerData.models) freshByKey.set(modelKey(providerData.id, model.id), model)
  }
  /** @type {Map<string, object>} */
  const previousByKey = new Map()
  for (const providerData of previous?.providers ?? []) {
    for (const model of providerData.models) previousByKey.set(modelKey(providerData.id, model.id), model)
  }

  const providers = discovered.map((providerData) => {
    const previousProvider = (previous?.providers ?? []).find((candidate) => candidate.id === providerData.id)
    const freshModels = providerData.models.map((model) => {
      const key = modelKey(providerData.id, model.id)
      const { entry, reasoningChange } = catalogEntry(previousByKey.get(key), model, now, providerData, maxHistory)
      if (reasoningChange.kind !== 'stable' && reasoningChange.kind !== 'first-seen') {
        reasoningChanges.push({ key, ...reasoningChange })
      }
      return entry
    })
    // A provider that failed to list keeps its last known models, marked so the
    // guide flags those facts as not re-verified rather than silently trusting
    // them or claiming the models removed.
    const models = providerData.error !== undefined && previousProvider !== undefined
      ? previousProvider.models.map((model) => ({
        ...model,
        evidence: { ...model.evidence, note: 'provider listing failed at the latest update; facts not re-verified' },
      }))
      : freshModels
    return {
      id: providerData.id,
      name: providerData.name,
      ...(providerData.error === undefined ? {} : { error: providerData.error }),
      models,
    }
  })

  // Owner curation cross-checks: flag mismatches for review, never rewrite.
  /** @type {{key: string, ownerNativeDefault: string, providerDefault: string, note: string}[]} */
  const ownerNativeMismatches = []
  for (const providerData of providers) {
    for (const model of providerData.models) {
      const owner = ownerData?.models?.[modelKey(providerData.id, model.id)]
      const ownerDefault = owner?.nativeReasoningDefault
      const providerDefault = model.reasoning?.defaultEffort
      if (ownerDefault !== undefined && providerDefault !== undefined
        && String(ownerDefault).toLowerCase() !== String(providerDefault).toLowerCase()) {
        ownerNativeMismatches.push({
          key: modelKey(providerData.id, model.id),
          ownerNativeDefault: String(ownerDefault),
          providerDefault: String(providerDefault),
          note: 'owner-recorded native default differs from the provider-reported default; owner recommendations stay authoritative — verify which is right before trusting either',
        })
      }
    }
  }

  /** @type {{key: string, verifiedAt: string, state: string}[]} */
  const stalePrices = []
  for (const [key, owner] of Object.entries(ownerData?.models ?? {})) {
    if (owner?.pricing === undefined) continue
    const state = freshness(owner.pricing)
    if (state !== 'fresh') stalePrices.push({ key, verifiedAt: String(owner.pricing.verifiedAt ?? 'unknown'), state })
  }

  const counts = {
    providers: providers.length,
    models: providers.reduce((sum, providerData) => sum + providerData.models.length, 0),
  }

  /** @type {{kind: string, message: string}[]} */
  const notes = []
  if (catalogWasMalformed) notes.push({ kind: 'catalog-malformed', message: 'the previous catalog file was unreadable or malformed; a fresh catalog was written and no history could be compared' })
  if (!previousCheck.ok && (previousRaw === undefined || previousRaw === null)) notes.push({ kind: 'first-update', message: 'no previous catalog existed; all currently listed models were recorded for the first time' })
  if (discovered.some((providerData) => providerData.error !== undefined)) {
    notes.push({ kind: 'provider-error', message: 'at least one provider failed to list; its models were not re-verified and are not claimed removed' })
  }
  if (snapshots.length > 0) {
    notes.push({ kind: 'pricing-snapshot', message: pricingRefresh?.status === 'updated'
      ? 'official pricing page(s) captured as evidence snapshots; the deterministic parser read verified rates from the same official table (see the refreshed note below)'
      : pricingRefresh?.status === 'failed'
        ? `official pricing page(s) captured as evidence snapshots; parser/source verification failed (${pricingRefresh?.reason ?? 'unknown reason'}) — previous verified prices were retained and stay flagged Needs Review`
        : 'official pricing page(s) captured as evidence snapshots; no confidently mapped rate change was parsed — stored prices keep their last verified state' })
  } else {
    notes.push({ kind: 'no-pricing-snapshot', message: 'no pricing snapshot was attempted or configured; stored prices keep their last verified state' })
  }

  const priceChangeCount = (pricingRefresh?.changed ?? []).reduce((sum, entry) => sum + entry.changes.length, 0)
  if (pricingRefresh !== undefined) {
    if (pricingRefresh.status === 'updated') {
      notes.push({ kind: 'pricing-refreshed',
        message: `official Ollama rates refreshed from ${pricingRefresh.source ?? 'the official source'}; `
          + `${priceChangeCount} price value(s) changed across ${(pricingRefresh.changed ?? []).length} model(s)`
          + ((pricingRefresh.unmatched ?? []).length + (pricingRefresh.ambiguous ?? []).length > 0
            ? `; ${(pricingRefresh.unmatched ?? []).length + (pricingRefresh.ambiguous ?? []).length} model id(s) kept previous prices (no confident exact match)`
            : '') })
    } else if (pricingRefresh.status === 'failed') {
      notes.push({ kind: 'pricing-refresh-failed',
        message: `official price refresh failed (${pricingRefresh.reason ?? 'unknown reason'}); all previously verified prices were retained unchanged` })
    } else {
      notes.push({ kind: 'pricing-retained',
        message: `no official price change could be confidently parsed (${pricingRefresh.reason ?? 'no change'}); stored prices keep their verified state` })
    }
  }
  if (researchNeeded.length > 0) {
    notes.push({ kind: 'research-needed',
      message: `${researchNeeded.length} newly detected model(s) have no owner curation and are marked Research Needed; use Research Unverified Models to prepare the prompt` })
  }
  const report = {
    generatedAt: now,
    added,
    removed,
    changed,
    reasoningChanges,
    ownerNativeMismatches,
    priceChanges: pricingRefresh?.changed ?? [],
    researchNeeded,
    ...(pricingRefresh === undefined ? {} : { pricingRefresh: {
      status: pricingRefresh.status,
      ...(pricingRefresh.source === undefined ? {} : { source: pricingRefresh.source }),
      ...(pricingRefresh.verifiedAt === undefined ? {} : { verifiedAt: pricingRefresh.verifiedAt }),
      ...(pricingRefresh.reason === undefined ? {} : { reason: pricingRefresh.reason }),
      unmapped: pricingRefresh.unmapped ?? [],
      ambiguous: pricingRefresh.ambiguous ?? [],
    } }),
    pricingSnapshots: snapshots,
    stalePrices,
    notes,
    counts: {
      providers: counts.providers,
      models: counts.models,
      curatedOnly: Object.keys(ownerData?.models ?? {}).length,
    },
  }
  const catalog = {
    version: 1,
    generatedAt: now,
    providers,
    lastUpdate: report,
  }
  return { catalog, report, catalogWasMalformed }
}