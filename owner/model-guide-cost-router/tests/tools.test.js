import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuidanceTools } from '../core/tools.js'

/**
 * A source that records every reader call and additionally carries a probe
 * that would stand in for any launch/switch capability.
 */
function recordingSource() {
  const calls = []
  /** A method that must never be reachable or called through a tool. */
  const forbiddenLaunch = (target) => {
    calls.push(['forbiddenLaunch', target])
    return 'must not happen'
  }
  return {
    calls,
    snapshot: async () => {
      calls.push(['snapshot'])
      return { metadata: { status: 'ok', path: 'p' }, providers: [], curatedOnly: [{ provider: 'ollama', id: 'm1', name: 'M1', needsReview: false }] }
    },
    guidanceText: async (provider, model) => {
      calls.push(['guidanceText', provider, model])
      return `guidance for ${provider}/${model}`
    },
    actualCost: (request) => {
      calls.push(['actualCost', request])
      return { status: 'calculated', totalUsd: 0.01, breakdown: { portions: [], unknown: [] } }
    },
    recommendModels: (task) => {
      calls.push(['recommendModels', task])
      return { shortlist: [], unreviewedCount: 0 }
    },
    forbiddenLaunch,
  }
}

const tool = (definitions, name) => {
  const found = definitions.find((definition) => definition.name === name)
  assert.ok(found, `tool ${name} should exist`)
  return found
}

test('the guidance toolset is exactly the declared read-only tools', () => {
  const definitions = createGuidanceTools(recordingSource())
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'get_model_guidance',
    'list_model_guidance',
    'recommend_model_for_task',
    'estimate_model_cost',
    'recommend_model_for_workload',
  ])
})

test('get_model_guidance reads only the guidance source and ignores junk arguments', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  const value = await tool(definitions, 'get_model_guidance').execute(
    { provider: 'ollama', model: 'glm-5.3-flash', launch: true, stop: 'everything', reconfigure: 'gpu' },
    /** @type {any} */ ({ signal: new AbortController().signal }),
  )
  assert.equal(value, 'guidance for ollama/glm-5.3-flash')
  assert.deepEqual(source.calls, [['guidanceText', 'ollama', 'glm-5.3-flash']])
})

test('missing required arguments answer Unknown without touching the source', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  const text = await tool(definitions, 'get_model_guidance').execute({}, /** @type {any} */ ({}))
  assert.match(text, /Unknown/)
  assert.deepEqual(source.calls, [])
})

test('list_model_guidance reports Needs Review for uncurated models and never fabricates', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  const text = await tool(definitions, 'list_model_guidance').execute({}, /** @type {any} */ ({ signal: new AbortController().signal }))
  const parsed = JSON.parse(text)
  assert.equal(parsed.count, 1)
  assert.equal(parsed.models[0].needsReview, true)
  assert.equal(parsed.models[0].provider, 'ollama')
})

test('recommend_model_for_task stays advisory and read-only', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  const value = await tool(definitions, 'recommend_model_for_task').execute({ task: 'agent workflow' }, /** @type {any} */ ({}))
  assert.deepEqual(source.calls, [['recommendModels', 'agent workflow']])
  assert.notEqual(value, 'must not happen')
})

test('estimate_model_cost passes only real counts to the calculator', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  const value = await tool(definitions, 'estimate_model_cost').execute(
    { provider: 'ollama', model: 'm1', inputTokens: 1000, cachedInputTokens: 100, outputTokens: 500 },
    /** @type {any} */ ({}),
  )
  assert.deepEqual(source.calls, [['actualCost', { provider: 'ollama', model: 'm1', usage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 500 } }]])
  assert.equal(value.totalUsd, 0.01)
  assert.equal(tool(definitions, 'recommend_model_for_task'), tool(definitions, 'recommend_model_for_task'))
})

test('no tool exposes a launch, stop, switch, or dispatch capability', async () => {
  const source = recordingSource()
  const definitions = createGuidanceTools(source)
  assert.ok(source.forbiddenLaunch, 'the probe exists on the source object')
  for (const definition of definitions) {
    const schema = JSON.stringify(definition.parameters)
    assert.doesNotMatch(schema, /launch|stop|switch|dispatch|unload|kill|restart/i)
    assert.equal(definition.parameters.additionalProperties, false)
    // Every execute path is exercised above; none may reach the probe.
    assert.ok(typeof definition.execute === 'function')
  }
  assert.deepEqual(source.calls.filter((call) => call[0] === 'forbiddenLaunch'), [])
})