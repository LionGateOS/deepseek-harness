/**
 * Regressions for the two things this batch changed about the front door.
 *
 * First: all five guidance tools are executed through the real tool machinery —
 * `assertSupportedJsonSchema` on the declared output schema, then
 * `validateJsonSchemaValue` on the produced value — because the defect these
 * tests exist to prevent was invisible to unit assertions: four tools declared
 * one strict empty object as their output schema while returning something else
 * entirely, and only the runtime validator rejected them.
 *
 * Second: the composed recommendation is built from three sources that must not
 * be confused with one another. The tests assert that installed truth comes from
 * Local Model Manager rather than a second scan, that an llmfit catalog name is
 * never translated into an installed model or a DeepSeek route, and that the
 * advisory sentence survives every branch.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { assertSupportedJsonSchema, validateJsonSchemaValue } from '../../../packages/core/tools/src/json-schema.ts'
import { createGuidanceTools } from '../core/tools.js'
import {
  COMPOSED_ADVISORY_BOUNDARY,
  WORKLOAD_CLASSES,
  composeRecommendation,
} from '../core/composed.js'

/**
 * Render one tool result the way the runtime does, so a value that only passes
 * after JSON serialization cannot hide a schema mismatch.
 * @param {object} tool the tool definition.
 * @param {unknown} value the execute result.
 */
const violationsOf = (tool, value) => validateJsonSchemaValue(tool.output.schema, value, 'value')

const toolNamed = (definitions, name) => {
  const found = definitions.find((definition) => definition.name === name)
  assert.ok(found, `tool ${name} should exist`)
  return found
}

/** One curated cloud row and one local row, with owner guidance attached. */
const guidanceRows = () => [
  {
    provider: 'qwen-local',
    id: '/home/liongateos/models/gguf/Qwen3.8-27B/Qwen3.8-27B-Uncensored-Q8_0.gguf',
    name: 'Qwen3.8 27B Uncensored Q8',
    localVsCloud: 'local',
    needsReview: false,
    strengths: ['code review', 'repository analysis'],
    reasoning: { recommendedRoutine: 'Medium' },
    context: { ownerConfigured: 131072 },
    pricing: { costTier: 'Very Cheap' },
    pricingNote: 'Local: no cloud/API token charge ($0 token charge); still consumes electricity, GPU time, and VRAM',
  },
  {
    provider: 'ollama',
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    localVsCloud: 'cloud',
    needsReview: false,
    strengths: ['coding'],
    pricing: { costTier: 'Cheap', freshness: 'fresh' },
    pricingNote: 'Cloud tokens are billed per million.',
  },
]

/** A source object with the exact reader surface the tools are given. */
const source = (options = {}) => ({
  snapshot: async () => ({ metadata: { status: 'ok', path: '/p' }, providers: [], curatedOnly: guidanceRows(), routingRule: 'cheapest capable first' }),
  guidanceText: async () => 'guidance text',
  actualCost: () => ({ status: 'calculated', totalUsd: 0.0004, breakdown: { portions: [], unknown: [] } }),
  recommendModels: () => ({
    rule: 'cheapest capable first',
    advisoryOnly: 'The owner keeps control of the actual model choice.',
    unreviewedCount: 0,
    shortlist: [],
  }),
  recommendForWorkload: async () => composeRecommendation({
    task: 'review a repository diff',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: row.strengths ?? [] })),
    installedModels: [],
    gpus: [],
    fit: null,
    ...options.composed,
  }),
})

test('every declared output schema is accepted by the runtime schema gate', () => {
  for (const definition of createGuidanceTools(source())) {
    assertSupportedJsonSchema(definition.output.schema)
  }
})

test('all five tools return values their own output schema accepts', async () => {
  const definitions = createGuidanceTools(source())
  const signal = new AbortController().signal
  const cases = [
    ['get_model_guidance', { provider: 'ollama', model: 'glm-5.3-flash' }],
    ['list_model_guidance', {}],
    ['recommend_model_for_task', { task: 'review a repository diff' }],
    ['recommend_model_for_task', {}],
    ['estimate_model_cost', { provider: 'ollama', model: 'glm-5.3-flash', inputTokens: 1000, outputTokens: 100 }],
    ['estimate_model_cost', {}],
    ['recommend_model_for_workload', { task: 'review a repository diff', use_case: 'coding' }],
    ['recommend_model_for_workload', {}],
    ['recommend_model_for_workload', { task: 'x', use_case: 'not-a-class' }],
  ]
  for (const [name, args] of cases) {
    const definition = toolNamed(definitions, name)
    const value = await definition.execute(args, { signal })
    assert.deepEqual(violationsOf(definition, value), [], `${name} ${JSON.stringify(args)} must satisfy its output schema`)
  }
})

test('a tool that returns text is not held to an object schema', async () => {
  const definitions = createGuidanceTools(source())
  for (const name of ['get_model_guidance', 'list_model_guidance']) {
    const definition = toolNamed(definitions, name)
    assert.equal(definition.output.schema.type, 'string', `${name} returns prose, so its schema is a string`)
  }
})

test('the workload classes the composed tool accepts are the fit engine classes', async () => {
  const { ALLOWED_USE_CASES } = await import('../../llmfit-advisor/core/advisor.js')
  assert.deepEqual([...WORKLOAD_CLASSES], [...ALLOWED_USE_CASES], 'the two lists must not drift')
})

test('an uninstalled local model is never presented as usable', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: row.strengths })),
    installedModels: [],
    gpus: [],
    fit: null,
  })
  assert.equal(result.recommendation.installed, false)
  assert.equal(result.recommendation.kind, 'guided-local-not-installed')
  assert.ok(
    result.recommendation.limitations.some((line) => /not installed/.test(line)),
    'the limitation must say the model is not installed',
  )
  assert.equal(result.advisoryOnly, COMPOSED_ADVISORY_BOUNDARY)
})

test('installed truth comes from the manager and prefers the installed model over cheaper cloud', () => {
  const order = [
    { row: guidanceRows()[1], unreviewed: false, why: ['coding'] },
    { row: guidanceRows()[0], unreviewed: false, why: ['code review'] },
  ]
  const result = composeRecommendation({
    task: 'review a repository diff',
    order,
    installedModels: [{ key: 'qwen27', name: 'Qwen3.8 27B Uncensored Q8', ggufPath: '/home/liongateos/models/gguf/Qwen3.8-27B/Qwen3.8-27B-Uncensored-Q8_0.gguf', installed: true }],
    gpus: [],
    fit: null,
  })
  assert.equal(result.recommendation.installed, true, 'the installed local model wins even though cloud was cheaper')
  assert.equal(result.recommendation.localModelKey, 'qwen27')
  assert.equal(result.installedTruth.status, 'verified')
  assert.deepEqual(result.installedTruth.installedLocalModels, [{ key: 'qwen27', name: 'Qwen3.8 27B Uncensored Q8' }])
})

test('a missing manager degrades to an explicit unavailable status, not a silent success', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: [] })),
    installedModels: null,
    gpus: [],
    fit: null,
    installedUnavailableReason: 'the Local Model Manager service is not present in this deployment',
  })
  assert.equal(result.installedTruth.status, 'unavailable')
  assert.equal(result.recommendation.installed, null, 'installability is unknown, never asserted false')
  assert.match(result.installedTruth.reason, /not present/)
})

test('an llmfit catalog name stays catalog-only and is never promoted to a route', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    useCase: 'coding',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: [] })),
    installedModels: [],
    gpus: [],
    fit: {
      status: 'ok',
      models: [{
        name: 'shuftie/Swift-1.5-Qwen3.8-27B-OpenCode-W4A16-AutoRound',
        provider: 'shuftie',
        fit_level: 'Perfect',
        memory_required_gb: 13.18,
        estimated_tps: 42.3,
        best_quant: 'AutoRound-4bit',
        runtime: 'vLLM',
      }],
    },
  })
  assert.equal(result.betterUninstalledOption.label, 'NOT INSTALLED')
  assert.equal(result.betterUninstalledOption.fitLevel, 'Perfect')
  assert.equal(result.betterUninstalledOption.memoryRequiredGb, 13.18)
  assert.match(result.betterUninstalledOption.note, /No verified mapping/)
  assert.equal(result.hardware.catalogOnly[0].label, 'NOT INSTALLED')
  assert.notEqual(result.recommendation.model, result.betterUninstalledOption.name, 'a catalog name must not become the recommendation')
  assert.ok(
    result.recommendation.provider !== 'shuftie',
    'a catalog provider must not be adopted as a recommendation provider',
  )
})

test('free VRAM is quoted per GPU and is never invented when the driver withheld it', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    order: [],
    installedModels: [],
    gpus: [
      { name: 'GeForce RTX 3090', uuid: 'GPU-4144e557-ad9a-83b3-014a-61f67141c547', memTotalMiB: 24576, memUsedMiB: 18743, memFreeMiB: 4021 },
      { name: 'GeForce RTX 3090 Ti', uuid: 'GPU-009aea9f-1bb8-d43b-b56a-abe166f629b0', memTotalMiB: 24576, memUsedMiB: 1200 },
    ],
    fit: null,
  })
  assert.equal(result.hardware.gpus[0].memFreeMiB, 4021)
  assert.equal(Object.hasOwn(result.hardware.gpus[1], 'memFreeMiB'), false, 'a withheld reading is absent, not derived')
  assert.equal(result.hardware.gpus[1].memTotalMiB, 24576)
})

test('the composed answer carries no launch, grant, or capacity field', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    useCase: 'coding',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: [] })),
    installedModels: [{ key: 'a', name: 'A', ggufPath: null, installed: true }],
    gpus: [],
    fit: { status: 'ok', models: [{ name: 'cat/x', provider: 'cat', fit_level: 'Perfect', memory_available_gb: 48 }] },
  })
  const text = JSON.stringify(result)
  // Field names only. The word "reservation" legitimately appears inside the
  // advisory sentence, which is a disclaimer rather than a capability.
  for (const forbidden of ['memory_available_gb', 'memoryAvailableGb', 'canLaunch', 'authorizedCapacity', 'grantedGpu', 'reservedGpu']) {
    assert.equal(text.includes(forbidden), false, `${forbidden} must not appear in a composed answer`)
  }
  assert.match(text, /Recommendations do not grant model launch, GPU, reservation, routing, approval, or execution permission\./)
})

test('an unreviewed row is listed but never becomes the recommendation', () => {
  const unreviewed = { provider: 'ollama', id: 'brand-new', name: 'Brand New', localVsCloud: 'cloud', needsReview: true }
  const result = composeRecommendation({
    task: 'review a repository diff',
    order: [
      { row: unreviewed, unreviewed: true, why: [] },
      { row: guidanceRows()[1], unreviewed: false, why: ['coding'] },
    ],
    installedModels: [],
    gpus: [],
    fit: null,
  })
  assert.equal(result.recommendation.model, 'glm-5.3-flash')
})

test('a fit failure is reported rather than silently omitted', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    useCase: 'coding',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: [] })),
    installedModels: [],
    gpus: [],
    fit: { status: 'unavailable', error: 'the llmfit advisor service is not present in this deployment' },
  })
  assert.equal(result.hardware.fitStatus, 'unavailable')
  assert.match(result.hardware.error, /not present/)
  assert.equal(result.betterUninstalledOption.present, false)
})

test('no workload class means no fit advisory is requested at all', () => {
  const result = composeRecommendation({
    task: 'review a repository diff',
    order: guidanceRows().map((row) => ({ row, unreviewed: false, why: [] })),
    installedModels: [],
    gpus: [],
    fit: null,
  })
  assert.equal(result.hardware.fitStatus, 'not-requested')
  assert.deepEqual(result.hardware.catalogOnly, [])
  assert.match(result.betterUninstalledOption.note, /No workload class/)
})
