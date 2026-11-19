/**
 * Provider-confirmed capability transfer into a pi-ai provider route.
 *
 * A route that hand-declares `models:` replaces the installed catalog, so every
 * field an entry omits falls back to a deployment default: `contextWindow`
 * becomes 262,144 and `input` becomes `["text"]`. For a provider that publishes
 * its real capabilities, those defaults are recorded as if they were facts.
 *
 * This module reads the provider's own listing and computes the smallest
 * additive change that removes the fallback. It never rewrites a value the
 * owner already declared: a recorded value is an audit result, not a cache, and
 * an owner who capped a context window or turned reasoning off made a decision
 * the provider cannot observe.
 *
 * Only two things are transferred: an absent `contextWindow`/`input`, and an
 * absent `reasoningEfforts`/`defaultReasoningEffort`. Everything else is
 * reported as a conflict for the owner to resolve.
 */

/**
 * Config-level thinking keys, in escalation order. The provider publishes the
 * wire spelling as `effort`; the dictionary key is a config key.
 */
export const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Provider wire spellings that differ from their config key. `none` is the
 * provider's spelling for "do not think", which the config names `off`; its
 * value stays `none` so the request sends what the provider understands.
 */
const WIRE_TO_KEY = { none: 'off' }

/** Every request modality a route entry may declare. */
const MODALITIES = ['text', 'image']

/**
 * Map one provider effort onto its config key.
 * @param {string} wire the provider's `effort` value.
 * @returns {string|undefined} the config key, or undefined when unsupported.
 */
const effortKey = (wire) => {
  const key = WIRE_TO_KEY[wire] ?? wire
  return THINKING_KEYS.includes(key) ? key : undefined
}

/**
 * Read the per-model capability facts out of one provider listing.
 *
 * The listing is accepted in either published shape: the conventional `data`
 * array carries only ids, so the enriched sibling `models` array is the source.
 * A field the provider omits stays absent from the facts — an absent fact is
 * left unknown rather than filled with a guess.
 *
 * The same rows also yield the inventory: which models the provider currently
 * offers through its API. Publishability is carried as evidence rather than
 * filtered away, so the caller reports what it declined to adopt instead of
 * pretending those models do not exist.
 *
 * @param {unknown} payload the parsed JSON answer of the models endpoint.
 * @returns {{models: Map<string, object>, inventory: Array<{id: string, name: string, publishable: boolean}>, source: string}} facts by model id.
 */
export const factsFromModelsListing = (payload) => {
  const models = new Map()
  const inventory = []
  const rows = typeof payload === 'object' && payload !== null && Array.isArray(payload['models'])
    ? payload['models']
    : []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const id = typeof row['slug'] === 'string' ? row['slug'].trim() : ''
    if (id.length === 0) continue
    /**
     * A model is adoptable only when the provider states that its API serves
     * the model and that it is not hidden. Both are required, so an absent
     * flag is "not publishable" rather than an assumption: adding a route row
     * is the one step that makes a model selectable and billable.
     */
    const displayName = typeof row['display_name'] === 'string' ? row['display_name'].trim() : ''
    inventory.push({
      id,
      name: displayName.length > 0 ? displayName : id,
      publishable: row['supported_in_api'] === true && row['visibility'] !== 'hide',
    })
    const facts = {}
    const context = row['context_window'] ?? row['max_context_window']
    if (typeof context === 'number' && Number.isFinite(context) && context > 0 && Number.isInteger(context)) {
      facts.contextWindow = context
    }
    if (Array.isArray(row['input_modalities'])) {
      const input = row['input_modalities'].filter((value) => MODALITIES.includes(value))
      if (input.length > 0) facts.input = [...new Set(input)]
    }
    /**
     * `supported_reasoning_levels` is a list of `{effort, description}`. The
     * description is presentation copy for the provider's own site, so only
     * the effort is evidence.
     */
    if (Array.isArray(row['supported_reasoning_levels'])) {
      const efforts = {}
      for (const level of row['supported_reasoning_levels']) {
        const wire = typeof level === 'object' && level !== null ? level['effort'] : undefined
        if (typeof wire !== 'string') continue
        const key = effortKey(wire.trim())
        if (key === undefined) continue
        efforts[key] = wire.trim()
      }
      // A dict offering nothing but "off" is refused by the resolver, and an
      // empty one declares nothing at all; neither is a usable declaration.
      if (Object.keys(efforts).some((key) => key !== 'off')) facts.reasoningEfforts = efforts
    }
    const fallbackDefault = typeof row['default_reasoning_level'] === 'string'
      ? effortKey(row['default_reasoning_level'].trim())
      : undefined
    if (fallbackDefault !== undefined) facts.defaultReasoningEffort = fallbackDefault
    models.set(id, facts)
  }
  return { models, inventory, source: 'provider listing' }
}

/**
 * Compare two modality lists as sets, so declaration order never reads as a
 * conflict.
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
const sameModalities = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  return [...left].sort().join(',') === [...right].sort().join(',')
}

/**
 * Compute the additive capability fill for one provider route.
 *
 * The returned `next` route replaces the configured one only where a field was
 * absent; every other member of every model entry is carried through by
 * reference, so a caller can compare the result to the input to detect a
 * no-op. Nothing is written here — this is a pure plan.
 *
 * When `inventory` is supplied, the plan also adopts models the provider
 * publishes but the route does not declare. Adoption appends, so existing rows
 * keep their position and the selector's ordering stays stable; a model the
 * provider does not serve through its API is reported as `withheld` and never
 * added, because declaring it would make it selectable and billable.
 *
 * @param {object|undefined} route the provider's configured `models:` section.
 * @param {Map<string, object>} factsByModel provider facts keyed by model id.
 * @param {Array<{id: string, name?: string, publishable?: boolean}>} [inventory] the provider's published models.
 * @returns {{next: object|undefined, changed: Array<object>, adopted: Array<object>, withheld: string[], conflicts: Array<object>, unknown: string[], refused: Array<object>}} the plan.
 */
export const planRouteCapabilities = (route, factsByModel, inventory) => {
  const changed = []
  const adopted = []
  const withheld = []
  const conflicts = []
  const unknown = []
  const refused = []
  if (typeof route !== 'object' || route === null || !Array.isArray(route['models'])) {
    return { next: undefined, changed, adopted, withheld, conflicts, unknown, refused }
  }
  const declared = new Set(route['models']
    .filter((entry) => typeof entry === 'object' && entry !== null && typeof entry['id'] === 'string')
    .map((entry) => entry['id']))
  const models = route['models'].map((entry) => {
    if (typeof entry !== 'object' || entry === null || typeof entry['id'] !== 'string') return entry
    const id = entry['id']
    const facts = factsByModel.get(id)
    if (facts === undefined) {
      unknown.push(id)
      return entry
    }
    const additions = {}
    if (entry['contextWindow'] === undefined) {
      if (facts.contextWindow !== undefined) additions['contextWindow'] = facts.contextWindow
    } else if (typeof entry['contextWindow'] === 'number' && facts.contextWindow !== undefined
      && entry['contextWindow'] !== facts.contextWindow) {
      // The owner may have capped the window on purpose; either way the
      // decision is theirs, so the disagreement is reported, never applied.
      conflicts.push({ id, field: 'contextWindow', recorded: entry['contextWindow'], published: facts.contextWindow })
    }
    if (entry['input'] === undefined) {
      if (facts.input !== undefined) additions['input'] = [...facts.input]
    } else if (facts.input !== undefined && !sameModalities(entry['input'], facts.input)) {
      conflicts.push({ id, field: 'input', recorded: entry['input'], published: facts.input })
    }
    const declaredEfforts = entry['reasoningEfforts']
    if (declaredEfforts === undefined) {
      if (facts.reasoningEfforts !== undefined) additions['reasoningEfforts'] = { ...facts.reasoningEfforts }
    } else if (declaredEfforts === false && facts.reasoningEfforts !== undefined) {
      // `false` is an explicit owner judgement: the model stays non-reasoning
      // even though the provider publishes levels.
      conflicts.push({ id, field: 'reasoningEfforts', recorded: false, published: Object.keys(facts.reasoningEfforts) })
    }
    const declaredDefault = entry['defaultReasoningEffort']
    const effectiveEfforts = additions['reasoningEfforts']
      ?? (typeof declaredEfforts === 'object' && declaredEfforts !== null ? declaredEfforts : undefined)
    if (declaredDefault === undefined && facts.defaultReasoningEffort !== undefined) {
      // A default is only declarable when the offered levels support it.
      if (effectiveEfforts !== undefined && Object.hasOwn(effectiveEfforts, facts.defaultReasoningEffort)) {
        additions['defaultReasoningEffort'] = facts.defaultReasoningEffort
      } else {
        refused.push({
          id,
          field: 'defaultReasoningEffort',
          published: facts.defaultReasoningEffort,
          reason: 'the offered levels do not include the provider default, so it cannot be declared',
        })
      }
    }
    if (Object.keys(additions).length === 0) return entry
    changed.push({ id, fields: Object.keys(additions) })
    return { ...entry, ...additions }
  })
  /**
   * Adoption is appended, never inserted: an owner's ordering is a reading
   * order, and a new row in the middle would renumber every entry below it.
   * A row is built from the same facts the fill uses, so a model the provider
   * describes fully is selectable and costed the moment it appears.
   */
  for (const row of Array.isArray(inventory) ? inventory : []) {
    if (typeof row !== 'object' || row === null || typeof row['id'] !== 'string') continue
    const id = row['id']
    if (declared.has(id)) continue
    if (row['publishable'] !== true) {
      withheld.push(id)
      continue
    }
    const facts = factsByModel.get(id) ?? {}
    const entry = { id, name: typeof row['name'] === 'string' && row['name'].length > 0 ? row['name'] : id }
    if (facts.contextWindow !== undefined) entry['contextWindow'] = facts.contextWindow
    if (facts.input !== undefined) entry['input'] = [...facts.input]
    if (facts.reasoningEfforts !== undefined) {
      entry['reasoningEfforts'] = { ...facts.reasoningEfforts }
      if (facts.defaultReasoningEffort !== undefined
        && Object.hasOwn(facts.reasoningEfforts, facts.defaultReasoningEffort)) {
        entry['defaultReasoningEffort'] = facts.defaultReasoningEffort
      }
    }
    models.push(entry)
    declared.add(id)
    adopted.push({ id, name: entry['name'], fields: Object.keys(entry).filter((field) => field !== 'id' && field !== 'name') })
  }
  return {
    next: { ...route, models },
    changed,
    adopted,
    withheld,
    conflicts,
    unknown,
    refused,
  }
}
