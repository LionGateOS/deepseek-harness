/**
 * Pure decision logic for automatic model routing.
 *
 * Consumes an already-composed recommendation from `composeRecommendation` and
 * the current call configuration, and answers one bounded question: should the
 * current model be replaced for this task, and under whose authority.
 *
 * This module makes no model calls and grants no authority. Auto-switching is
 * gated by owner configuration; the owner-approval path is exercised by the
 * wiring in `../index.js`, which asks through the existing user-questions
 * waterfall and keeps the current model on every bounded failure.
 */

/**
 * The decision categories. `ask` asks the owner once; `switch` is taken only
 * when owner configuration already permits it. `keep` is the quiet path.
 */
export const ROUTE_DECISIONS = /** @type {const} */ ({
  keep: 'keep',
  ask: 'ask',
  switch: 'switch',
  fallback: 'fallback',
})

/** Never recommend a route that does not exist in the guidance inventory. */
const SWITCHABLE_KINDS = new Set(['installed-local', 'cloud'])

/**
 * The GGUF-model marker that names the owner's Qwen3.8 27B rows. A
 * recommendation whose model id carries this marker may only be routed onto a
 * provider from the deployment's verified non-Ti whitelist — never the
 * Qwen3.8-forbidden RTX 3090 Ti route, and never via a silent GPU fallback.
 */
export const QWEN38_MARKER = /Qwen3\.8[-_. ]?27B/i

/**
 * Enforce the owner's Qwen3.8 GPU-route requirement on one proposed route.
 *
 * The rule is routing-policy only: it reads nothing, launches nothing, and
 * changes no GPU state. When the proposal targets a Qwen3.8 model on a
 * provider outside the verified 3090-non-Ti whitelist, the proposal is
 * rewritten onto the verified route when one is configured, or dropped
 * (`undefined`) so the caller keeps the current model — the RTX 3090 Ti is
 * never selected by fallback, and the owner is not silently moved to another
 * GPU route.
 *
 * @param {object|undefined} recommendation the proposed route.
 * @param {string[]} [qwen38Providers] the deployment's verified 3090-non-Ti
 *   providers (config knob `qwen38AllowedProviders`, default
 *   `['qwen-local-3090']`). An empty/missing list blocks the switch outright.
 * @returns {object|undefined} the enforced recommendation, or undefined to keep the current model.
 */
export function enforceQwen38Route(recommendation, qwen38Providers = ['qwen-local-3090']) {
  const rec = recommendation
  if (rec === null || rec === undefined || typeof rec !== 'object') return rec
  if (typeof rec.model !== 'string' || !QWEN38_MARKER.test(rec.model)) return rec
  const allowed = Array.isArray(qwen38Providers) ? qwen38Providers.filter((p) => typeof p === 'string' && p.length > 0) : []
  if (allowed.includes(rec.provider)) return rec
  // The proposal names Qwen3.8 on a non-whitelisted provider. Rewrite onto
  // exactly one verified route when configured (same model id — both host
  // providers serve the same GGUF ids); otherwise block the switch.
  if (allowed.length === 1) return { ...rec, provider: allowed[0] }
  return undefined
}

/**
 * Decide the route for one turn from one composed recommendation.
 *
 * The materially-better test reuses the owner's existing ordering: the
 * recommendation is already the best per the routing rule, so the only
 * remaining question is whether it is usable and different from the current
 * route. A local model that is described but not installed is not usable
 * (installation is a separate owner action); a catalog-only llmfit entry never
 * appears as a recommendation at all, and `installed: null` means installed
 * truth was unavailable, so nothing may be claimed capable from that branch.
 *
 * @param {object} input
 * @param {object} input.recommendation the composed recommendation block.
 * @param {boolean|undefined} input.autoSwitch whether owner configuration permits an automatic switch.
 * @param {string} input.currentProvider the provider the request would use.
 * @param {string} input.currentModel the model the request would use.
 * @returns {{decision: 'keep'|'ask'|'switch'|'fallback', reason: string, recommendation?: object}} the bounded decision.
 */
export function decideRoute({ recommendation, autoSwitch, currentProvider, currentModel, qwen38Providers }) {
  const current = { provider: String(currentProvider ?? ''), model: String(currentModel ?? '') }
  if (recommendation === null || typeof recommendation !== 'object') {
    return { decision: ROUTE_DECISIONS.fallback, reason: 'recommendation unavailable — keeping the current model' }
  }
  const rec = enforceQwen38Route(recommendation, qwen38Providers)
  if (rec === undefined) {
    return { decision: ROUTE_DECISIONS.fallback, reason: 'the proposed Qwen3.8 route is not the verified non-Ti route and no verified route is configured — keeping the current model' }
  }
  if (typeof rec.provider !== 'string' || typeof rec.model !== 'string'
    || rec.provider.length === 0 || rec.model.length === 0) {
    return { decision: ROUTE_DECISIONS.fallback, reason: 'recommendation unavailable — keeping the current model' }
  }
  if (typeof rec.installed !== 'boolean') {
    // `null` = installed truth unavailable; `false` = guided-only. Neither can
    // be claimed capable for the task, and neither may become a route.
    return { decision: ROUTE_DECISIONS.fallback, reason: 'recommendation could not be verified as installed or cloud-routed — keeping the current model' }
  }
  if (!SWITCHABLE_KINDS.has(rec.kind)) {
    return { decision: ROUTE_DECISIONS.fallback, reason: `recommendation kind ${rec.kind} is not a runnable route — keeping the current model` }
  }
  const sameRoute = rec.provider === current.provider && rec.model === current.model
  if (sameRoute) {
    return { decision: ROUTE_DECISIONS.keep, reason: 'recommended route is the current route — no switch' }
  }
  // The composed recommendation is already the owner rule's best row; a
  // different usable route is materially better by construction. Cloud rows
  // are always usable when verified (installed === true is the verified flag
  // cloud rows carry, set in describeRecommendation).
  if (autoSwitch === true) {
    return {
      decision: ROUTE_DECISIONS.switch,
      reason: 'owner configuration permits automatic switching and a verified different model better fits the task under the routing rule',
      recommendation: rec,
    }
  }
  return {
    decision: ROUTE_DECISIONS.ask,
    reason: 'a verified different model fits the task under the routing rule; owner configuration requires approval per task',
    recommendation: rec,
  }
}

/**
 * The ask wording one approval question carries. Pinned here so the wiring and
 * the tests assert the exact same label.
 */
export const SWITCH_APPROVE_LABEL = 'Yes, switch for this task'

/**
 * Build the one owner-approval question for a proposed switch.
 * @param {object} recommendation the materially better route.
 * @param {string} task the task excerpt that triggered the ask.
 * @returns {object} a user-questions request row.
 */
export function switchQuestion(recommendation, task) {
  const excerpt = task.length > 120 ? `${task.slice(0, 119)}…` : task
  return {
    id: 'model-auto-route',
    header: 'Model switch',
    question: `For this task ("${excerpt}"), the routing rule recommends ${recommendation.name} instead of the current model. Switch for this task?`,
    options: [
      { label: SWITCH_APPROVE_LABEL, description: `Use ${recommendation.name} (${recommendation.provider}) for this task only.` },
      { label: 'No, keep current model', description: 'Continue with the model this request would already use.' },
    ],
  }
}

/** One decision per (agent, turn): later steps and repeat calls never re-decide, so no oscillation. */
const TTL_MS = 10 * 60 * 1000
const MAX_TEXT_CHARS = 2000

/**
 * Bare control replies that mean "keep going on what exists", matched as the
 * whole normalized message only — never substrings, so short but substantive
 * tasks such as "Fix login." still classify as new work. A bare control word
 * carries no task signal of its own, so it never seeds a recommendation:
 * with task context it continues that task; without any it simply keeps the
 * current route.
 */
const CONTROL_REPLIES = new Set([
  'continue',
  'keep going',
  'go ahead',
  'proceed',
  'approved',
  'approved!',
  'approve',
  'accept',
  'accepted',
  'accepted!',
  'do it',
  'retry',
  'resume',
  'next',
  'option 1',
  'option 2',
  'option 3',
])

/** The canonical continuation reply, pinned for tests and the wiring. */
export const CONTINUATION_REPLY = 'continue'

/** Normalize a bare reply for exact control matching: trim, lowercase, collapse inner whitespace, drop trailing punctuation. */
const normalizedReply = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '')

/**
 * Task-introducing verbs. A clause after a control word that opens with one of
 * these names new work, no matter how short it is: "Continue researching
 * PostgreSQL replication" is a new task, while "Continue. But please in
 * English." stays a continuation. Matched on the clause's first word.
 */
const TASK_VERBS = new Set([
  'research', 'researching', 'analyze', 'analyzing', 'analyse', 'review',
  'rewrite', 'rewriting', 'refactor', 'refactoring', 'create', 'creating',
  'build', 'building', 'implement', 'implementing', 'fix', 'fixing',
  'write', 'writing', 'add', 'adding', 'remove', 'removing', 'migrate',
  'migrating', 'test', 'testing', 'debug', 'debugging', 'design', 'designing',
  'investigate', 'investigating', 'port', 'porting', 'update', 'updating',
  'install', 'installing', 'configure', 'configuring',
])

/** Bounded prepositions/connectors a modifier clause may START with (at most one) before falling back to a task statement. */
const MODIFIER_CONNECTORS = new Set([
  'but', 'and', 'please', 'in', 'at', 'from', 'as', 'without', 'using', 'same',
  'this', 'that', 'it',
])

/** Longest modifier clause accepted after a control word, in characters. */
const MAX_MODIFIER_CHARS = 60

/**
 * Whether a text is a control reply that carries at most a small, non-task
 * modifier: it starts with a control word, and everything after it is a short
 * clause with no task-introducing verb. "Continue, but use English." inherits;
 * "Continue researching PostgreSQL replication." routes. Whole-message
 * matching only — the control word is never matched inside a longer sentence.
 * @param {string} text the normalized message text.
 * @returns {boolean} true when the reply is a control continuation.
 */
const isControlReplyWithModifier = (text) => {
  const message = normalizedReply(text)
  for (const control of CONTROL_REPLIES) {
    if (message === control) return true
    if (message.length > control.length && message.startsWith(control)) {
      const rest = message.slice(control.length)
      // The boundary must be a separator or punctuation, so "continued" never
      // reads as "continue" + modifier.
      if (!/^[\s,.!';:~-]/.test(rest)) continue
      const clause = rest.replace(/^[\s,.!';:~-]+/, '')
      if (clause.length > MAX_MODIFIER_CHARS) return false
      const firstWord = clause.split(/\s+/)[0] ?? ''
      // An empty clause is the bare control word; a task verb names new work;
      // one leading connector keeps it a modifier ("Continue, but use English",
      // "Continue on the same model"); anything else with content is a task
      // statement ("Continue the migration...") — treat as new task.
      if (firstWord === '') return true
      if (TASK_VERBS.has(firstWord)) return false
      if (MODIFIER_CONNECTORS.has(firstWord)) {
        // One connector hop is allowed; a second word must not be a task noun.
        const secondWord = clause.split(/\s+/)[1] ?? ''
        return secondWord === '' || !TASK_VERBS.has(secondWord)
      }
      return false
    }
  }
  return false
}

/**
 * Whether every claimed message is a control reply to existing work: a
 * durable `user-question-reply` (an answer to an open owner question) is
 * continuation by construction; a bare control word such as "continue" names
 * no task, so it never becomes a new classification either.
 * @param {Array<object>} messages the claimed messages of the step.
 * @returns {boolean} true when the turn must inherit the current route.
 */
export function isContinuation({ messages }) {
  if (!Array.isArray(messages) || messages.length === 0) return false
  if (messages.some((message) => message?.source?.kind === 'user-question-reply')) return true
  const text = messages
    .flatMap((message) => message.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
  return isControlReplyWithModifier(text)
}

/**
 * The turn-scoped routing state and the two waterfall entry points.
 *
 * @param {object} deps
 * @param {object} deps.config the validated plugin config (autoSwitch, autoRouteAsk, autoRouteAskTimeoutMs).
 * @param {(task: string, useCase?: string) => Promise<object>} deps.recommend the composed advisory recommendation.
 * @param {(question: object, agent?: object) => Promise<{answered: boolean, approve?: boolean, reason?: string}>} deps.askOwner
 *   asks through the host's user-questions service; bounded, never throws.
 * @param {(agent: object) => boolean|undefined} [deps.isRoot] whether the agent
 *   is a live top-level agent (the host's agents registry decides). Children
 *   and specialists keep the route their creator chose: undefined (no
 *   registry) is also treated as not-routable, so classification still runs
 *   but no route is ever replaced for an agent the host cannot vouch for.
 * @returns {{onPreStep: Function, onRequest: Function, dispose: () => void}} the listeners.
 */
export function createAutoRoute({ config, recommend, askOwner, isRoot }) {
  /** @type {Map<string, {decided: boolean, at: number, task: string, continuation?: boolean}>} */
  const turns = new Map()

  return {
    /**
     * Classify once at the start of a turn: the agent's first step with user
     * messages is the task. Later steps and continuations never re-classify.
     * A continuation/control reply (a question reply, or a bare control word
     * with task context) stores a continuation marker instead of a task, so
     * the request stage inherits the current route without a recommendation
     * or an ask. This calls next() unconditionally — classification never
     * rejects a step.
     */
    async onPreStep({ agent, messages, turn, step, signal }, next) {
      const decision = await next()
      if (step !== 1 || !Array.isArray(messages) || messages.length === 0 || signal?.aborted) return decision
      const key = `${agent?.id ?? '?'}#${turn}`
      if (isContinuation({ messages })) {
        turns.set(key, { decided: false, at: Date.now(), task: '', continuation: true })
        return decision
      }
      const text = messages
        .flatMap((message) => message.content ?? [])
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join(' ')
        .slice(0, MAX_TEXT_CHARS)
      if (text.length < 8) return decision
      const taskText = text
      turns.set(key, {
        decided: false,
        at: Date.now(),
        task: taskText,
      })
      // The recommendation is computed at the first request of the turn, where
      // the current route is known; failures surface there too.
      for (const [existing] of turns) {
        const at = turns.get(existing)?.at ?? 0
        if (Date.now() - at > TTL_MS) turns.delete(existing)
      }
      return decision
    },

    /**
     * One-shot route decision and application for the turn's first request.
     *
     * The host wiring already called `next()` at `agent/request`, so `config`
     * here is the route the request would use, with scoped model-selection
     * listeners' outcome preserved (llm-retry precedent). Classification ran
     * at pre-step. Runs once per (agent, turn): later steps and repeat calls
     * are no-ops, so decisions never cascade and no oscillation is possible.
     *
     * @param {object} input the agent and turn owning the request.
     * @param {object} input.config the resolved LlmCallConfig.
     * @returns {Promise<object|undefined>} the replacement config, or
     *   undefined to keep the current route.
     */
    async onRequest({ agent, turn, signal, config: callConfig }) {
      const key = `${agent?.id ?? '?'}#${turn}`
      const turnState = turns.get(key)
      if (turnState === undefined || turnState.decided || signal?.aborted) return undefined
      turnState.decided = true
      // A continuation/control reply inherits the current route: no
      // recommendation call, no ask, no second switch question mid-task.
      if (turnState.continuation === true) return undefined
      // Children and specialists keep the route their creator chose; only a
      // live top-level agent the host registry vouches for is routable.
      if (isRoot?.(agent) !== true) return undefined
      let recommendation
      try {
        recommendation = await recommend(turnState.task)
      } catch {
        return undefined // recommendation unavailable → fallback path: current model
      }
      const verdict = decideRoute({
        recommendation: recommendation?.recommendation,
        autoSwitch: config.autoSwitch === true,
        currentProvider: typeof callConfig?.provider === 'string' ? callConfig.provider : '',
        currentModel: typeof callConfig?.model === 'string' ? callConfig.model : '',
        qwen38Providers: config.qwen38Providers,
      })
      if (verdict.decision === ROUTE_DECISIONS.keep || verdict.decision === ROUTE_DECISIONS.fallback) return undefined
      const proposed = verdict.recommendation
      if (proposed === undefined) return undefined
      if (verdict.decision === ROUTE_DECISIONS.switch) {
        return { ...callConfig, provider: proposed.provider, model: proposed.model }
      }
      // Decision 'ask': one bounded ask per turn. A timeout, an unavailable
      // answerer, or a refusal keeps the current model — the task proceeds.
      if (config.autoRouteAsk !== true) return undefined
      const askOutcome = await askOwner(switchQuestion(proposed, turnState.task), agent)
      if (askOutcome.answered === true && askOutcome.approve === true) {
        return { ...callConfig, provider: proposed.provider, model: proposed.model }
      }
      return undefined
    },

    /** Drop all turn state. */
    dispose() {
      turns.clear()
    },
  }
}
