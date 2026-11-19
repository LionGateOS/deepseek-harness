/**
 * Unverified-model research: deterministic detection of models whose
 * capability or pricing facts are unresolved, plus the fixed research-prompt
 * text the owner can copy elsewhere.
 *
 * Detection is pure analysis of the merged snapshot and owner metadata; it
 * never proposes values, never curates, and never fabricates facts. The
 * research prompt is equally deterministic text: it names official sources as
 * the evidence standard, forbids treating an LLM assertion as authoritative
 * on its own, and repeats that owner-curated recommendations stay untouched.
 */

/** Curation fields an owner model entry must carry to be considered resolved. */
const CURATION_FIELDS = [
  { key: 'localVsCloud', label: 'deployment (local vs cloud)' },
  { key: 'modalities', label: 'modalities (input types)' },
  { key: 'reasoningModes', label: 'reasoning support (efforts list)' },
  { key: 'nativeReasoningDefault', label: 'native/default reasoning behavior' },
]

/** @typedef {{key: string, provider: string, id: string, name: string, fields: string[], pricingState?: string}} UnresolvedModel */

/**
 * Detect every unresolved or suspicious capability/pricing field of one
 * discovered model row against its (possibly absent) owner entry.
 * @param {object} model discovered model row.
 * @param {object|undefined} owner owner-curated entry for `provider/modelId`.
 * @param {(rates: object) => string} freshness rate staleness judge.
 * @returns {{provider: string, id: string, name: string, fields: string[], pricingState: string}}
 */
export function unresolvedFieldsFor(model, owner, freshness) {
  const fields = []
  if (owner === undefined) {
    return {
      provider: '',
      id: model.id,
      name: model.name,
      fields: [
        ...CURATION_FIELDS.map((field) => field.label),
        'context size',
        'tool/function-calling support',
        'pricing (input / cached-input / output USD per 1M tokens from the official source, with verifiedAt)',
      ],
      pricingState: 'unverified',
    }
  }
  for (const field of CURATION_FIELDS) {
    const value = owner[field.key]
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      fields.push(field.label)
    }
  }
  // Read the fields the owner record and the merged snapshot actually carry.
  // `owner.contextConfigured` is the recorded context size and the merge
  // exposes it as `context.ownerConfigured`; the provider-reported value
  // arrives as `context.providerReported`. Asking only for a flat
  // `model.contextWindow` made a fully configured model report unresearched.
  const contextKnown = owner.contextConfigured !== undefined
    || model.contextWindow !== undefined
    || model.context?.providerReported !== undefined
    || model.context?.ownerConfigured !== undefined
  if (!contextKnown) fields.push('context size')
  // The owner field is `toolSupport` (true/false/null), and the merge exposes
  // it as `model.toolSupport`. Checking a non-existent `owner.tools` made every
  // researched model report tool support as unknown forever; `toolSupportNote`
  // is kept as the free-text escape hatch it always was.
  const hasToolRecord = owner.toolSupport === true
    || owner.toolSupport === false
    || model.toolSupport === true
    || model.toolSupport === false
    || typeof owner.toolSupportNote === 'string'
  if (!hasToolRecord) fields.push('tool/function-calling support')
  // A positively local deployment has no cloud/API rate to verify: pricing is
  // $0 and N/A by deployment, never a research request for API rates.
  if (owner.localVsCloud === 'local') {
    return { provider: '', id: model.id, name: model.name, fields, pricingState: 'local' }
  }
  const pricing = owner.pricing ?? {}
  const pricingState = freshness(pricing)
  if (pricingState !== 'fresh') {
    fields.push(`pricing (state: ${pricingState}) — refresh official input / cached-input / output rates with source and verifiedAt`)
  }
  return {
    provider: '',
    id: model.id,
    name: model.name,
    fields,
    pricingState,
  }
}

/** Owner-visible research scopes. `newly-detected` (no owner entry) is the safe default. */
export const RESEARCH_SCOPES = ['newly-detected', 'all-unverified', 'selected']

/**
 * Filter unresolved models by owner-visible scope. Only exact keys the
 * snapshot itself produced can enter a `selected` scope, so no foreign or
 * malformed key can inject a research block.
 * @param {UnresolvedModel[]} models unresolved models from the merged snapshot.
 * @param {string} scope one of RESEARCH_SCOPES.
 * @param {string[]|undefined} keys selected model keys (selected scope only).
 * @param {Record<string, object>|undefined} ownerModels owner-curated entries.
 * @returns {UnresolvedModel[]}
 */
export function scopeUnresolvedModels(models, scope, keys, ownerModels) {
  if (scope === 'selected') {
    const wanted = new Set(Array.isArray(keys) ? keys : [])
    return models.filter((model) => wanted.has(model.key))
  }
  if (scope === 'newly-detected') {
    return models.filter((model) => ownerModels?.[model.key] === undefined)
  }
  return models
}

/**
 * Collect every model in the merged snapshot whose facts are unresolved.
 * @param {object} snapshot merged snapshot with `providers` and `curatedOnly` rows.
 * @param {{routingRule?: string, models?: Record<string, object>}} ownerData owner metadata.
 * @param {(rates: object) => string} freshness rate staleness judge.
 * @returns {UnresolvedModel[]} one row per model with at least one unresolved field.
 */
export function unresolvedModels(snapshot, ownerData, freshness) {
  /** @type {UnresolvedModel[]} */
  const result = []
  const curated = ownerData?.models ?? {}
  const consider = (provider) => {
    for (const model of provider.models) {
      const key = `${provider.id}/${model.id}`
      const owner = curated[key]
      const analysis = unresolvedFieldsFor(model, owner, freshness)
      if (analysis.fields.length === 0) continue
      result.push({
        key,
        provider: provider.id,
        id: model.id,
        name: model.name,
        fields: analysis.fields,
        pricingState: analysis.pricingState,
      })
    }
  }
  for (const provider of snapshot.providers ?? []) consider(provider)
  return result
}

/**
 * Propose the research executor under the canonical cost-aware routing rule:
 * the least expensive capable owner-curated model — a local model first, a
 * freshly priced cloud model otherwise — without sacrificing quality claims.
 * @param {object} snapshot merged snapshot.
 * @param {{routingRule?: string, models?: Record<string, object>}} ownerData owner metadata.
 * @param {(rates: object) => string} freshness rate staleness judge.
 * @returns {{routingRule: string, primary?: {key: string, id: string, name: string, localVsCloud: string, reasoningLevel: string, note: string}, paidAlternative?}} proposal or an empty one when nothing is safely curatable.
 */
export function proposeResearcher(snapshot, ownerData, freshness) {
  const curated = ownerData?.models ?? {}
  const rows = (snapshot.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ key: `${provider.id}/${model.id}`, provider: provider.id, model })))
  const capable = rows.filter(({ key, model }) => {
    const owner = curated[key]
    if (owner === undefined) return false
    if (owner.localVsCloud === undefined) return false
    if (model.contextWindow === undefined) return false
    const analysis = unresolvedFieldsFor(model, owner, freshness)
    return analysis.fields.length === 0
  })
  const wrap = (candidate, kind) => ({
    key: candidate.key,
    id: candidate.model.id,
    name: candidate.model.name,
    localVsCloud: kind,
    reasoningLevel: curated[candidate.key]['recommendedRoutine'] ?? 'Medium',
    note: kind === 'local'
      ? 'local run: no cloud token charge; still consumes local GPU time'
      : 'paid cloud run: token-billed at the stored verified provider rates',
  })
  const localFirst = capable.filter(({ key }) => curated[key]['localVsCloud'] === 'local')
  const primary = localFirst.length > 0 ? wrap(localFirst[0], 'local') : capable.length > 0 ? wrap(capable[0], 'cloud') : undefined
  const cloud = capable.filter(({ key }) => curated[key]['localVsCloud'] === 'cloud')
  const paidAlternative = cloud.length > 0 ? wrap(cloud[0], 'cloud') : undefined
  return {
    routingRule: ownerData?.routingRule ?? '',
    ...(primary === undefined ? {} : { primary }),
    ...(!paidAlternative || primary?.key === paidAlternative.key ? {} : { paidAlternative }),
  }
}

/** @typedef {{key: string, provider: string, id: string, name: string, fields: string[]}} ResearchModel */

/**
 * Compose the deterministic research prompt for the unresolved models. The
 * prompt carries the exact fields needed per model, the evidence standard,
 * and the boundaries the researching agent must respect.
 * @param {ResearchModel[]} models the unresolved models (already scoped).
 * @param {{routingRule?: string, generatedAt: string, scope?: string}} options routing rule, run instant, and the owner-visible scope.
 * @returns {string} the prompt text to copy.
 */
export function researchPromptText(models, { routingRule, generatedAt, scope }) {
  const blocks = models.map((model) => {
    return `### ${model.key} (${model.name})
Research and verify exactly these fields:
${model.fields.map((field) => `- ${field}`).join('\n')}
Record for each verified fact: the official source URL, the verification date, and the verified value.
Do not guess: any field you cannot verify from an official provider or vendor source stays unverified.
`
  })
  return `Model research request — ${generatedAt}
${scope === undefined ? '' : `Research scope: ${scope} — ${models.length} model(s) selected; copy these blocks only.\n`}
${routingRule.length > 0 ? `Routing rule of this deployment (for choosing HOW to research, not what to conclude): ${routingRule}\n` : ''}
For each model below, verify the listed capability and pricing facts from official provider or vendor sources only.
Rules:
- Models recorded as local in this deployment (qwen-local GGUF models and similar) have cloud/API pricing of $0 and N/A: do NOT research or report input / cached-input / output API rates for them; verify only official model facts (context window, tool/function-calling, reasoning behavior, modalities).
- An LLM assertion by itself is not authoritative evidence; cite the official page, release note, or API document you used.
- Never change owner-curated recommendations (recommendedRoutine, recommendedHeavy, strengths, reasoningNote): research fills FACTS, not preferences.
- Never invent reasoning-price multipliers; a reasoning setting changes cost only through real token volumes.
- Leave a field out entirely when no official source confirms it.

Importable facts (anything else is rejected by the owner's importer): contextWindow, deployment ("local" or "cloud"), inputModalities (list), reasoningEfforts (list), reasoningDefault, toolSupport (boolean), toolSupportNote, pricing (cloud deployments only: { inputPerMTok, cachedInputPerMTok, outputPerMTok } with finite numbers >= 0 or null, optional offPeak with the same shape; a recorded-local deployment must NOT include pricing). Each fact value is { value: ..., source: "<official URL>", verifiedAt: "<date>" }.

Output contract (the owner's importer reads exactly this):
- Return JSON only: no Markdown fences, no explanatory prose before or after the JSON.
- Exactly this schema:
[
  {
    "model": "<exact provider/modelId key from the blocks above>",
    "facts": {
      "<fact name from the importable list>": {
        "value": <verified value>,
        "source": "<official URL>",
        "verifiedAt": "<date>"
      }
    }
  }
]
- Use the exact provider/model key supplied above; a different or shortened key is rejected.
- Every included fact carries value + source + verifiedAt; omit unverified facts completely.
- Include only facts confirmed by official provider or vendor sources.

${blocks.join('\n')}`
}