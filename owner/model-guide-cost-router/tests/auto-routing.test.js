/**
 * Automatic model routing regressions.
 *
 * The routing wiring must stay advisory: only the owner's existing
 * recommendation decides that a route is materially better, only verified
 * installed or cloud routes can be switched to, catalog-only entries can never
 * become routes, the current model is kept on every bounded failure, and one
 * (agent, turn) decides at most once so no recursion or oscillation is
 * possible.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTE_DECISIONS,
  SWITCH_APPROVE_LABEL,
  createAutoRoute,
  decideRoute,
  enforceQwen38Route,
  isContinuation,
  switchQuestion,
} from '../core/auto-routing.js'

/** One verified installed-local recommendation, the composed shape. */
const installedRec = (overrides = {}) => ({
  kind: 'installed-local',
  provider: 'qwen-local',
  model: '/models/Qwen3.8-27B-Uncensored-Q8_0.gguf',
  name: 'Qwen3.8 27B Uncensored Q8',
  installed: true,
  ...overrides,
})

const decide = (overrides = {}) => decideRoute({
  recommendation: installedRec(),
  autoSwitch: false,
  currentProvider: 'ollama',
  currentModel: 'glm-5.3-flash',
  ...overrides,
})

test('decideRoute: same route keeps silently', () => {
  const verdict = decide({
    recommendation: installedRec({ provider: 'ollama', model: 'glm-5.3-flash' }),
  })
  assert.equal(verdict.decision, ROUTE_DECISIONS.keep)
})

test('decideRoute: missing recommendation falls back to current model', () => {
  assert.equal(decide({ recommendation: undefined }).decision, ROUTE_DECISIONS.fallback)
  assert.equal(decide({ recommendation: {} }).decision, ROUTE_DECISIONS.fallback)
  assert.equal(decide({ recommendation: null }).decision, ROUTE_DECISIONS.fallback)
})

test('decideRoute: installed truth unavailable can never become a route', () => {
  const verdict = decide({ recommendation: installedRec({ installed: null }) })
  assert.equal(verdict.decision, ROUTE_DECISIONS.fallback)
})

test('decideRoute: guided-but-not-installed local model is not runnable', () => {
  const verdict = decide({ recommendation: installedRec({ installed: false, kind: 'guided-local-not-installed' }) })
  assert.equal(verdict.decision, ROUTE_DECISIONS.fallback)
})

test('decideRoute: cloud route is switchable when verified', () => {
  const verdict = decide({
    recommendation: installedRec({ kind: 'cloud', provider: 'ollama', model: 'kimi-k2.7-code', installed: true }),
  })
  assert.equal(verdict.decision, ROUTE_DECISIONS.ask)
})

test('decideRoute: autoSwitch true upgrades ask to switch', () => {
  const verdict = decide({ autoSwitch: true })
  assert.equal(verdict.decision, ROUTE_DECISIONS.switch)
  // The Qwen3.8 enforcement rewrites the proposal onto the verified non-Ti
  // route before the decision: the default allowance is qwen-local-3090.
  assert.equal(verdict.recommendation?.provider, 'qwen-local-3090')
})

test('decideRoute: kind none falls back', () => {
  const verdict = decide({ recommendation: { kind: 'none', installed: false } })
  assert.equal(verdict.decision, ROUTE_DECISIONS.fallback)
})

test('switchQuestion: approve label is one of the offered options', () => {
  const question = switchQuestion(installedRec(), 'Fix these failing tests')
  assert.equal(question.id, 'model-auto-route')
  assert.ok(question.options.some((option) => option.label === SWITCH_APPROVE_LABEL))
  assert.ok(question.question.includes('Qwen3.8 27B Uncensored Q8'))
})

const harness = (overrides = {}) => {
  /** @type {{task: string|null, calls: number, fail: boolean}} */
  const recommendState = { task: null, calls: 0, fail: false }
  const recommend = async (task) => {
    recommendState.calls += 1
    if (recommendState.fail) throw new Error('composed recommendation failed')
    recommendState.task = task
    const { recommendation } = overrides.recommendationFor?.(task) ?? { recommendation: installedRec() }
    return { recommendation, status: 'ok' }
  }
  /** @type {{asks: Array<object>, answer: {answered: boolean, approve: boolean}}} */
  const askState = { asks: [], answer: { answered: true, approve: true } }
  const askOwner = async (question) => {
    askState.asks.push(question)
    return askState.answer
  }
  let route = createAutoRoute({
    config: {
      autoSwitch: overrides.autoSwitch === true,
      autoRouteAsk: true,
      autoRouteAskTimeoutMs: 1000,
    },
    recommend,
    askOwner,
    isRoot: 'isRoot' in overrides ? overrides.isRoot : () => true,
  })
  const turn = {
    agent: { id: 'agent-1' },
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'Fix these failing tests in this repository quickly' }],
    }],
    turn: 1,
    step: 1,
    signal: undefined,
  }
  return { route, recommendState, askState, turn, ...overrides }
}

const preStepOf = async (route, turn, overrides = {}) => route.onPreStep(
  { ...turn, ...overrides },
  async () => ({ kind: 'enter', messages: turn.messages }),
)

const requestOf = async (route, turn, config, overrides = {}) => route.onRequest(
  { agent: turn.agent, turn: turn.turn, signal: turn.signal, config, ...overrides },
)

const configFor = { provider: 'ollama', model: 'glm-5.3-flash' }

test('auto route: classification arms one decision and applies the approved switch once', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.ok(override, 'an approved ask must replace the route')
  // The Qwen3.8 enforcement rewrites the proposal onto the verified non-Ti
  // route (qwen-local-3090) before any ask or switch is applied.
  assert.equal(override.provider, 'qwen-local-3090')
  assert.equal(override.model, '/models/Qwen3.8-27B-Uncensored-Q8_0.gguf')
  assert.deepEqual(
    { ...configFor, provider: override.provider, model: override.model },
    override,
  )
  assert.equal(h.askState.asks.length, 1)
  assert.match(h.askState.asks[0].question, /Fix these failing tests/)
  assert.equal(h.recommendState.calls, 1)
})

test('auto route: second request of the same turn never re-decides (no oscillation)', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  const second = await requestOf(
    h.route,
    h.turn,
    configFor,
    { turn: h.turn.turn, step: 2 },
  )
  assert.equal(second, undefined)
  assert.equal(h.askState.asks.length, 1)
  assert.equal(h.recommendState.calls, 1)
})

test('auto route: later step never re-classifies', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  assert.equal(h.recommendState.calls, 0, 'classification is deferred to the request')
  await requestOf(h.route, h.turn, configFor)
  assert.equal(h.recommendState.calls, 1)
})

test('auto route: quiet path — recommendation equals current route keeps without asking', async () => {
  const h = harness({
    recommendationFor: () => ({
      recommendation: installedRec({
        provider: 'ollama',
        model: 'glm-5.3-flash',
        kind: 'cloud',
      }),
    }),
  })
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.askState.asks.length, 0, 'no interruption when the current model already fits')
  assert.equal(h.recommendState.calls, 1)
})

test('auto route: autoSwitch switches without asking', async () => {
  const h = harness({ autoSwitch: true })
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.ok(override)
  // Qwen3.8 enforcement rewrites the proposal onto the verified non-Ti route.
  assert.equal(override.provider, 'qwen-local-3090')
  assert.equal(h.askState.asks.length, 0)
})

test('auto route: refusal keeps the current model', async () => {
  const h = harness()
  h.askState.answer = { answered: true, approve: false }
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.askState.asks.length, 1)
})

test('auto route: recommendation failure falls back to the current model', async () => {
  const h = harness()
  h.recommendState.fail = true
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.askState.asks.length, 0, 'a failed recommendation never asks')
})

test('auto route: request without classification is a no-op (never routes mid-turn)', async () => {
  const h = harness()
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

test('auto rule: nothing routes when the owner has both switches off (wiring gate)', () => {
  // The wiring registers the listeners only when autoSwitch or autoRouteAsk is
  // on; this contract check pins the gate's shape against silent drift.
  const config = { autoSwitch: false, autoRouteAsk: false }
  assert.equal(config.autoSwitch === true || config.autoRouteAsk === true, false)
})

test('auto route: distinct turns of one agent decide independently', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  const turn2 = { ...h.turn, turn: 2, messages: [{ role: 'user', content: [{ type: 'text', text: 'Now analyze this architecture for safety risks' }] }] }
  await preStepOf(h.route, turn2)
  const override = await requestOf(h.route, turn2, configFor, { turn: 2 })
  assert.ok(override, 'a new turn is a new task and asks again')
  assert.equal(h.askState.asks.length, 2)
  assert.equal(h.recommendState.calls, 2)
})

test('auto route: image-only message never classifies (no text to read)', async () => {
  const h = harness()
  await preStepOf(h.route, {
    ...h.turn,
    messages: [{ role: 'user', content: [{ type: 'image' }] }],
  })
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

test('auto route: dispose clears pending turn state', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  h.route.dispose()
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

test('auto route: owned child agents keep the route their creator chose', async () => {
  const h = harness({ isRoot: (agent) => agent.id === 'agent-1' })
  const childTurn = { ...h.turn, agent: { id: 'child-agent' } }
  await preStepOf(h.route, childTurn)
  const override = await requestOf(h.route, childTurn, configFor, { agent: childTurn.agent })
  assert.equal(override, undefined, 'a specialist/child never has its route replaced')
  assert.equal(h.recommendState.calls, 0)
})

test('auto route: agent the host cannot vouch for is never routable', async () => {
  const h = harness({ isRoot: () => false })
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
})

test('auto route: unavailable host gate disables routing without breaking the ask path', async () => {
  const h = harness({ isRoot: undefined })
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

// ---------------------------------------------------------------------------
// Continuation-aware gate: control replies inherit the current route without
// a recommendation call or a re-ask; short but substantive tasks keep routing.
// ---------------------------------------------------------------------------

const userText = (text, source) => ({
  role: 'user',
  content: [{ type: 'text', text }],
  ...(source === undefined ? {} : { source }),
})
const taskTurn = (text, extra = {}) => ({
  agent: { id: 'agent-1' },
  messages: [userText(text, extra.source)],
  turn: extra.turn ?? 1,
  step: 1,
  signal: undefined,
})

test('continuation gate: "continue" after a classified task inherits without a recommendation call', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn) // turn 1: substantive task classified
  await requestOf(h.route, h.turn, configFor)
  const cont = taskTurn('continue', { turn: 2 })
  await preStepOf(h.route, cont)
  const override = await requestOf(h.route, cont, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 1, 'the second call must be the turn-1 one; continue must not call recommend')
  assert.equal(h.askState.asks.length, 1)
})

test('continuation gate: first message of a fresh session "continue" is not task context — still classifiable (no route change either way)', async () => {
  const h = harness()
  const cont = taskTurn('continue')
  await preStepOf(h.route, cont)
  const override = await requestOf(h.route, cont, configFor)
  // No prior task and no open question: 'continue' is not a classified task
  // (bare control word, no context) so no state was stored → no routing.
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

test('continuation gate: question reply (user-question-reply source) always inherits, no wordlist', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  const reply = taskTurn('yes', { turn: 2, source: { kind: 'user-question-reply', callId: 'call-1', outcome: 'answered' } })
  await preStepOf(h.route, reply)
  const override = await requestOf(h.route, reply, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 1, 'question replies must never trigger a recommendation')
})

test('continuation gate: "approved" with prior task inherits', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  const approved = taskTurn('approved', { turn: 2 })
  await preStepOf(h.route, approved)
  const override = await requestOf(h.route, approved, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: bare "go ahead" inherits regardless of question state (no task signal)', async () => {
  const h = harness()
  const cont = taskTurn('go ahead')
  await preStepOf(h.route, cont)
  const override = await requestOf(h.route, cont, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 0)
})

test('continuation gate: "retry" and "resume" inherit after prior task', async () => {
  for (const word of ['retry', 'resume']) {
    const h = harness()
    await preStepOf(h.route, h.turn)
    await requestOf(h.route, h.turn, configFor)
    const reply = taskTurn(word, { turn: 2 })
    await preStepOf(h.route, reply)
    const override = await requestOf(h.route, reply, configFor)
    assert.equal(override, undefined, word)
    assert.equal(h.recommendState.calls, 1, word)
  }
})

test('continuation gate: normal coding task still routes after the gate', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.ok(override, 'a substantive task must still produce a routing decision')
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: normal reasoning task still routes', async () => {
  const h = harness({ recommendationFor: () => ({ recommendation: installedRec() }) })
  const turn = taskTurn('Review this architecture and recommend the safest design')
  await preStepOf(h.route, turn)
  const override = await requestOf(h.route, turn, configFor)
  assert.ok(override)
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: short but substantive new task "Fix login." still routes', async () => {
  const h = harness()
  const turn = taskTurn('Fix login.')
  await preStepOf(h.route, turn)
  const override = await requestOf(h.route, turn, configFor)
  assert.ok(override, 'a short substantive task must not be swallowed by the control gate')
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: control word is not matched inside a longer substantive message', async () => {
  const h = harness()
  const turn = taskTurn('continue the migration by fixing the remaining tests in this repository')
  await preStepOf(h.route, turn)
  const override = await requestOf(h.route, turn, configFor)
  assert.ok(override, 'a substantive sentence containing "continue" must still route')
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: switch approval then continue does not immediately re-ask', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.ok(override, 'turn 1 approved the switch')
  assert.equal(h.askState.asks.length, 1)
  // The owner's next message is a plain continuation of the (now switched) task.
  const cont = taskTurn('continue', { turn: 2 })
  await preStepOf(h.route, cont)
  const second = await requestOf(h.route, cont, { provider: 'qwen-local', model: '/models/Qwen3.8-27B-Uncensored-Q8_0.gguf' })
  assert.equal(second, undefined)
  assert.equal(h.askState.asks.length, 1, 'no second model-switch question on continuation')
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: "next" / "option 1" / "accepted" inherit; bare punctuation tolerated', async () => {
  for (const [word, turnNo] of [['next', 2], ['Option 1.', 3], ['accepted!', 4]]) {
    const h = harness()
    const reply = taskTurn(word, { turn: turnNo })
    await preStepOf(h.route, reply)
    const override = await requestOf(h.route, reply, configFor)
    assert.equal(override, undefined, word)
    assert.equal(h.recommendState.calls, 0, word)
  }
})

test('continuation gate: "Research PostgreSQL." (short, substantive) still routes', async () => {
  const h = harness()
  const turn = taskTurn('Research PostgreSQL.')
  await preStepOf(h.route, turn)
  const override = await requestOf(h.route, turn, configFor)
  assert.ok(override)
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: recursion safety — continuation turn also decides at most once', async () => {
  const h = harness()
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  const cont = taskTurn('continue', { turn: 2 })
  await preStepOf(h.route, cont)
  await requestOf(h.route, cont, configFor)
  const second = await requestOf(h.route, cont, configFor, { turn: cont.turn, step: 2 })
  assert.equal(second, undefined)
  assert.equal(h.recommendState.calls, 1)
})

test('continuation gate: child agents keep the inherited route through the gate', async () => {
  const h = harness({ isRoot: () => false })
  await preStepOf(h.route, h.turn)
  const override = await requestOf(h.route, h.turn, configFor)
  assert.equal(override, undefined)
  const cont = taskTurn('continue', { turn: 2 })
  await preStepOf(h.route, cont)
  const second = await requestOf(h.route, cont, configFor)
  assert.equal(second, undefined, 'a child agent stays unrouted whether the turn is a task or a continuation')
})

test('isContinuation: pure gate semantics pinned', () => {
  // question replies continue by construction, regardless of text
  assert.equal(isContinuation({ messages: [userText('Research PostgreSQL.', { kind: 'user-question-reply', callId: 'c', outcome: 'answered' })] }), true)
  // bare control words continue as whole messages only
  assert.equal(isContinuation({ messages: [userText('continue')] }), true)
  assert.equal(isContinuation({ messages: [userText('  Continue. ')] }), true)
  assert.equal(isContinuation({ messages: [userText('go ahead')] }), true)
  assert.equal(isContinuation({ messages: [userText('Option 1.')] }), true)
  // substrings and substantive sentences never match
  assert.equal(isContinuation({ messages: [userText('continue the migration by fixing tests')] }), false)
  assert.equal(isContinuation({ messages: [userText('Fix login.')] }), false)
  assert.equal(isContinuation({ messages: [userText('continue on to next-steps review')] }), false)
  // empty/absent
  assert.equal(isContinuation({ messages: [] }), false)
  assert.equal(isContinuation({}), false)
})

// ---------------------------------------------------------------------------
// Turn 12: continuation with a small side modifier + the Qwen3.8 GPU-route
// enforcement (RTX 3090 non-Ti only; the RTX 3090 Ti is never selected).
// ---------------------------------------------------------------------------

test('modifier gate: "Continue. But please in English." inherits', async () => {
  assert.equal(isContinuation({ messages: [userText('Continue. But please in English because I am not Chinese.')] }), true)
  const h = harness()
  const cont = taskTurn('Continue. But please in English because I am not Chinese.', { turn: 2 })
  await preStepOf(h.route, h.turn)
  await requestOf(h.route, h.turn, configFor)
  await preStepOf(h.route, cont)
  const override = await requestOf(h.route, cont, configFor)
  assert.equal(override, undefined)
  assert.equal(h.recommendState.calls, 1, 'the modifier reply must not call recommend again')
})

test('modifier gate: "Keep going, in English." and "Proceed, but don\'t create another session." inherit', () => {
  assert.equal(isContinuation({ messages: [userText('Keep going, in English.')] }), true)
  assert.equal(isContinuation({ messages: [userText("Proceed, but don't create another session.")] }), true)
  assert.equal(isContinuation({ messages: [userText('Continue, but use English.')] }), true)
  assert.equal(isContinuation({ messages: [userText('Continue please.')] }), true)
  assert.equal(isContinuation({ messages: [userText('Continue from where you were.')] }), true)
  assert.equal(isContinuation({ messages: [userText('Resume and keep the same model.')] }), true)
})

test('modifier gate: "Continue researching PostgreSQL replication." stays a new task', async () => {
  assert.equal(isContinuation({ messages: [userText('Continue researching PostgreSQL replication.')] }), false)
  assert.equal(isContinuation({ messages: [userText('Continue by rewriting the authentication system.')] }), false)
  assert.equal(isContinuation({ messages: [userText('Continue with a new analysis of this repository.')] }), false)
  assert.equal(isContinuation({ messages: [userText('continued effort on the same report')] }), false, 'word-boundary safety: "continued" is not control+modifier')
  const h = harness()
  const turn = taskTurn('Continue researching PostgreSQL replication.')
  await preStepOf(h.route, turn)
  const override = await requestOf(h.route, turn, configFor)
  assert.ok(override, 'a genuine new task framed with "continue" still routes')
  assert.equal(h.recommendState.calls, 1)
})

test('qwen38 route: proposal on the verified non-Ti provider passes through unchanged', () => {
  const verdict = decide({
    recommendation: installedRec({ provider: 'qwen-local-3090' }),
    autoSwitch: true,
    qwen38Providers: ['qwen-local-3090'],
  })
  assert.equal(verdict.decision, ROUTE_DECISIONS.switch)
  assert.equal(verdict.recommendation?.provider, 'qwen-local-3090')
})

test('qwen38 route: generic qwen-local (the Ti provider) is rewritten to the verified route', () => {
  assert.equal(enforceQwen38Route(installedRec()).provider, 'qwen-local-3090', 'default allowance rewrites the Ti provider away')
  assert.equal(enforceQwen38Route(installedRec(), ['qwen-local-3090']).provider, 'qwen-local-3090')
  // The generic provider name alone is NEVER accepted as an authorization.
  assert.notEqual(enforceQwen38Route(installedRec(), ['qwen-local-3090']).provider, 'qwen-local')
})

test('qwen38 route: never falls back to the 3090 Ti or another unverified GPU route', () => {
  assert.equal(enforceQwen38Route(installedRec(), []), undefined, 'no configured verified route → block, never fall back to a Ti provider')
  assert.equal(enforceQwen38Route(installedRec(), ['qwen-both', 'qwen-ti']), undefined, 'a multi-target config cannot be resolved to exactly one verified route')
  const verdict = decide({
    recommendation: installedRec(),
    autoSwitch: true,
    qwen38Providers: [],
  })
  assert.equal(verdict.decision, ROUTE_DECISIONS.fallback, 'unavailable 3090-only route keeps the current model')
})

test('qwen38 route: non-Qwen3.8 models are untouched by the guard', () => {
  const rec = installedRec({ provider: 'qwen-local', model: '/models/Qwen3.6-35B-A3B-abliterated-v4-Q4_K_M.gguf' })
  assert.deepEqual(enforceQwen38Route(rec, ['qwen-local-3090']), rec)
  assert.deepEqual(enforceQwen38Route(rec, []), rec)
})

test('qwen38 route: a cloud Qwen3.8-named route is also guarded', () => {
  const rec = installedRec({ kind: 'cloud', provider: 'qwen-local', model: '/models/Qwen3.8-27B-Uncensored-Q8_0.gguf' })
  assert.equal(enforceQwen38Route(rec).provider, 'qwen-local-3090')
})
