/**
 * Agent-facing read-only guidance tools. Every tool calls one guidance-source
 * reader; the factory accepts no other capability, so the tools cannot launch,
 * stop, switch, or dispatch any model regardless of the arguments a caller
 * sends.
 */

import { COMPOSED_ADVISORY_BOUNDARY, WORKLOAD_CLASSES as WORKLOAD_USE_CASES } from './composed.js'

/**
 * @typedef {object} GuidanceSource The read-only surface the tools may call.
 * @property {(signal?: AbortSignal) => Promise<object>} snapshot merged guide.
 * @property {(provider: string, model: string) => Promise<string>} guidanceText canonical copy-for-prompt text.
 * @property {(request: object) => object} actualCost pure cost math over real usage.
 * @property {(task: string) => object} recommendModels advisory ordering.
 * @property {(task: string, useCase?: string) => Promise<object>} recommendForWorkload composed recommendation over installed truth, guidance, and hardware fit.
 */

const SCHEMA_OBJECT = { type: 'object', additionalProperties: false }

/** The advisory sentence every composed answer carries. */
const COMPOSED_BOUNDARY_TEXT = COMPOSED_ADVISORY_BOUNDARY

/** Workload classes accepted by the composed recommendation. */
const WORKLOAD_CLASSES = WORKLOAD_USE_CASES

/**
 * Output schema for the tools that return canonical text. The root must accept
 * a string: `get_model_guidance` returns guidance copy and `list_model_guidance`
 * returns its own stringified listing, so the strict argument-object schema
 * would reject both.
 */
const TEXT_OUTPUT = Object.freeze({ type: 'string' })

/** A nullable string, expressed in the enforced subset. */
const NULLABLE_STRING = Object.freeze({
  oneOf: [{ type: 'string' }, { type: 'null' }],
})

/**
 * One shortlist row. Declared fields are the ones `recommendModels` returns;
 * `false` still rejects undeclared keys so a new field cannot reach the model
 * without a matching schema update.
 */
const SHORTLIST_ROW = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string' },
    model: { type: 'string' },
    name: { type: 'string' },
    localVsCloud: { type: 'string' },
    unreviewed: { type: 'boolean' },
    reasoning: { type: 'array', items: { type: 'string' } },
    recommendedRoutine: { type: 'string' },
    costTier: { type: 'string' },
  },
})

/** Output schema for the advisory shortlist. */
const RECOMMEND_OUTPUT = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    rule: NULLABLE_STRING,
    advisoryOnly: { type: 'string' },
    needsReview: { type: 'array', items: { type: 'string' } },
    unreviewedCount: { type: 'integer' },
    shortlist: { type: 'array', items: SHORTLIST_ROW },
  },
  required: ['rule', 'advisoryOnly', 'unreviewedCount', 'shortlist'],
})

/** Output schema for the pure cost calculation. */
const COST_OUTPUT = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['calculated', 'unknown', 'invalid_usage'] },
    reason: { type: 'string' },
    totalUsd: { type: 'number' },
    breakdown: {
      type: 'object',
      additionalProperties: false,
      properties: {
        portions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              tokens: { type: 'integer' },
              rateUsdPerMTok: { type: 'number' },
              costUsd: { type: 'number' },
            },
          },
        },
        unknown: { type: 'array', items: { type: 'string' } },
      },
      required: ['portions', 'unknown'],
    },
  },
  required: ['status', 'breakdown'],
})

/** A nullable boolean, expressed in the enforced subset. */
const NULLABLE_BOOLEAN = Object.freeze({
  oneOf: [{ type: 'boolean' }, { type: 'null' }],
})

/** One GPU row as the composed answer quotes it; free memory is optional. */
const GPU_ROW = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    uuid: { type: 'string' },
    memTotalMiB: { type: 'number' },
    memUsedMiB: { type: 'number' },
    memFreeMiB: { type: 'number' },
    launchReserved: { type: 'boolean' },
    preferredLaunchTarget: { type: 'boolean' },
  },
  required: ['name', 'uuid'],
})

/** One llmfit catalog suggestion, always labelled NOT INSTALLED. */
const CATALOG_SUGGESTION = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    provider: { type: 'string' },
    label: { type: 'string' },
    fitLevel: { type: 'string' },
    memoryRequiredGb: { type: 'number' },
    estimatedTps: { type: 'number' },
    bestQuant: { type: 'string' },
    runtime: { type: 'string' },
  },
  required: ['name', 'provider', 'label'],
})

/** Output schema for the composed recommendation. */
const COMPOSED_OUTPUT = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok', 'invalid_arguments'] },
    task: { type: 'string' },
    useCase: { type: 'string' },
    advisoryOnly: { type: 'string' },
    error: { type: 'string' },
    recommendation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        name: { type: 'string' },
        installed: NULLABLE_BOOLEAN,
        why: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'array', items: { type: 'string' } },
        localModelKey: { type: 'string' },
        diskBytes: { type: 'number' },
        costTier: { type: 'string' },
        pricingNote: { type: 'string' },
        priceFreshness: { type: 'string' },
        guidance: {
          type: 'object',
          additionalProperties: false,
          properties: {
            strengths: { type: 'array', items: { type: 'string' } },
            avoid: { type: 'array', items: { type: 'string' } },
            recommendedRoutine: { type: 'string' },
            contextConfigured: { type: 'number' },
            contextReported: { type: 'number' },
          },
        },
      },
      required: ['kind', 'provider', 'model', 'name', 'installed', 'why', 'limitations'],
    },
    installedTruth: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        source: { type: 'string' },
        reason: { type: 'string' },
        installedLocalModels: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { key: { type: 'string' }, name: { type: 'string' } },
            required: ['key', 'name'],
          },
        },
      },
      required: ['status', 'source', 'installedLocalModels'],
    },
    hardware: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string' },
        fitStatus: { type: 'string' },
        error: { type: 'string' },
        gpus: { type: 'array', items: GPU_ROW },
        catalogOnly: { type: 'array', items: CATALOG_SUGGESTION },
      },
      required: ['source', 'fitStatus', 'gpus', 'catalogOnly'],
    },
    betterUninstalledOption: {
      type: 'object',
      additionalProperties: false,
      properties: {
        present: { type: 'boolean' },
        label: { type: 'string' },
        note: { type: 'string' },
        name: { type: 'string' },
        provider: { type: 'string' },
        fitLevel: { type: 'string' },
        memoryRequiredGb: { type: 'number' },
        estimatedTps: { type: 'number' },
        bestQuant: { type: 'string' },
        runtime: { type: 'string' },
      },
      required: ['present'],
    },
  },
  required: ['status', 'task', 'advisoryOnly', 'recommendation', 'installedTruth', 'hardware', 'betterUninstalledOption'],
})

/**
 * @param {unknown} value
 * @returns {string|undefined} the trimmed non-empty string, or undefined.
 */
const readText = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined)/**
 * @param {unknown} value
 * @returns {number|undefined} a finite non-negative number, or undefined.
 */
const readCount = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)

/**
 * @param {unknown} args
 * @returns {string} canonical model text from the source only.
 */
const guidanceFor = async (source, args) => {
  const record = /** @type {Record<string, unknown>} */ (args ?? {})
  const provider = readText(record['provider'])
  const model = readText(record['model'])
  if (provider === undefined || model === undefined) {
    return 'Unknown: a provider and a model id are both required; no guidance was read.'
  }
  return source.guidanceText(provider, model)
}

/**
 * Build the read-only tool definitions.
 * @param {GuidanceSource} source the guidance service; only its four readers
 *   are reachable from here.
 * @returns {Array<object>} tool definitions named get_model_guidance,
 *   list_model_guidance, recommend_model_for_task, and estimate_model_cost.
 */
export function createGuidanceTools(source) {
  return [
    {
      name: 'get_model_guidance',
      description: [
        'Read the owner-approved guidance for one exact model: provider, local/cloud, context, modalities, tool support,',
        'supported reasoning modes, native default, recommended routine and difficult-task settings, stored cloud token',
        'rates with verification state, strengths, avoid cases, and the global routing rule. Read-only: it never selects,',
        'launches, stops, or switches any model. Use list_model_guidance first when the exact id is unknown.',
      ].join(' '),
      parameters: {
        ...SCHEMA_OBJECT,
        properties: {
          provider: { type: 'string', description: 'Provider route id, e.g. an Ollama Cloud route or a local provider id.' },
          model: { type: 'string', description: 'Exact model id on that provider route.' },
        },
        required: ['provider', 'model'],
      },
      output: {
        schema: TEXT_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => await guidanceFor(source, args),
    },
    {
      name: 'list_model_guidance',
      description: [
        'List every detected local and cloud model with its owner-reviewed guide status, so you can pick an exact',
        'provider/model pair before calling get_model_guidance. Fields shown per model: provider, local/cloud, context,',
        'recommended routine setting when curated, stored price tier when curated, and Needs Review when owner metadata',
        'is missing. Read-only.',
      ].join(' '),
      parameters: {
        ...SCHEMA_OBJECT,
        properties: {
          search: { type: 'string', description: 'Optional case-insensitive filter over provider, model id, and name.' },
        },
        required: [],
      },
      output: {
        schema: TEXT_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      execute: async (args, exec) => {
        const snapshot = await source.snapshot(exec.signal)
        const record = /** @type {Record<string, unknown>} */ (args ?? {})
        const search = readText(record['search'])?.toLowerCase()
        const flatten = /** @type {(providerData: any) => any} */ ((providerData) => providerData.models.map((/** @type {any} */ row) => ({
          provider: row.provider,
          model: row.id,
          name: row.name,
          localVsCloud: row.localVsCloud,
          ...(row.context === undefined ? {} : { context: row.context }),
          ...(row.reasoning?.recommendedRoutine === undefined ? {} : { recommendedRoutine: row.reasoning.recommendedRoutine }),
          ...(row.pricing?.costTier === undefined ? {} : { costTier: row.pricing.costTier }),
          needsReview: row.needsReview === true || row.localVsCloud == null || row.localVsCloud === 'unknown',
        })))
        const rows = [
          ...snapshot.providers.flatMap((/** @type {any} */ providerData) => flatten(providerData)),
          ...flatten({ models: snapshot.curatedOnly }),
        ]
        const filtered = search === undefined ? rows : rows.filter((/** @type {any} */ row) => `${row.provider}/${row.model} ${row.name}`.toLowerCase().includes(search))
        return JSON.stringify({ count: filtered.length, metadata: snapshot.metadata, models: filtered }, null, 2)
      },
    },
    {
      name: 'recommend_model_for_task',
      description: [
        'Advisory cost-aware shortlist for one task under the owner routing rule: least expensive capable model first,',
        'local before cloud, escalation only when a cheaper option would materially compromise the result. Reasons are',
        'owner-stated strengths only; unreviewed models are flagged and never claimed capable. Advisory only: the owner',
        'remains in control of the actual choice and no model is selected, launched, or switched here.',
      ].join(' '),
      parameters: {
        ...SCHEMA_OBJECT,
        properties: {
          task: { type: 'string', description: 'Short task description, e.g. "review a repository diff" or "screenshot UI inspection".' },
        },
        required: ['task'],
      },
      output: {
        schema: RECOMMEND_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const record = /** @type {Record<string, unknown>} */ (args ?? {})
        const task = readText(record['task'])
        if (task === undefined) {
          return {
            rule: null,
            advisoryOnly: 'Nothing was recommended; a task description is required.',
            unreviewedCount: 0,
            shortlist: [],
          }
        }
        return source.recommendModels(task)
      },
    },
    {
      name: 'estimate_model_cost',
      description: [
        'Compute the actual dollar cost of one usage report from real token counts and the stored provider rates only.',
        'Pass the exact counts the provider reported (input, cached input, output). Without real counts the answer stays',
        'unknown; reasoning settings change cost only through these token volumes, and no per-level multiplier exists.',
      ].join(' '),
      parameters: {
        ...SCHEMA_OBJECT,
        properties: {
          provider: { type: 'string', description: 'Provider route id the usage was reported on.' },
          model: { type: 'string', description: 'Exact model id the usage belongs to.' },
          inputTokens: { type: 'number', description: 'Total input tokens actually reported.' },
          cachedInputTokens: { type: 'number', description: 'Cached portion actually reported; omit only when the provider reports nothing.' },
          outputTokens: { type: 'number', description: 'Generated tokens actually reported, including thinking where reported.' },
        },
        required: ['provider', 'model', 'inputTokens', 'outputTokens'],
      },
      output: {
        schema: COST_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const record = /** @type {Record<string, unknown>} */ (args ?? {})
        const provider = readText(record['provider'])
        const model = readText(record['model'])
        if (provider === undefined || model === undefined) {
          return { status: 'invalid_usage', reason: 'a provider and a model id are both required', breakdown: { portions: [], unknown: [] } }
        }
        const usage = {
          inputTokens: readCount(record['inputTokens']),
          cachedInputTokens: record['cachedInputTokens'] === undefined ? undefined : readCount(record['cachedInputTokens']),
          outputTokens: readCount(record['outputTokens']),
        }
        return source.actualCost({ provider, model, usage })
      },
    },
    {
      name: 'recommend_model_for_workload',
      description: [
        'Answer "which model should I use for this task?" in one result, combining everything the harness already knows:',
        'which local models are actually installed, owner guidance and cost routing, and read-only hardware-fit advisory.',
        'Installed models are preferred and their installed state is stated; an uninstalled model is never presented as usable.',
        'Returns what fits the task, why, the cost/provider facts, per-GPU memory facts, and what would be needed otherwise.',
        'Advisory only: it launches nothing, reserves no GPU, and grants no execution permission.',
      ].join(' '),
      parameters: {
        ...SCHEMA_OBJECT,
        properties: {
          task: { type: 'string', description: 'What you are about to do, in your own words, e.g. "review a repository diff".' },
          use_case: {
            type: 'string',
            enum: [...WORKLOAD_CLASSES],
            description: 'Optional hardware-fit workload class. Omit to skip the fit advisory entirely.',
          },
        },
        required: ['task'],
      },
      output: {
        schema: COMPOSED_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const record = /** @type {Record<string, unknown>} */ (args ?? {})
        const task = readText(record['task'])
        const useCase = record['use_case'] === undefined ? undefined : readText(record['use_case'])
        if (task === undefined) {
          return {
            status: 'invalid_arguments',
            task: '',
            advisoryOnly: COMPOSED_BOUNDARY_TEXT,
            error: 'a task description is required; nothing was recommended.',
            recommendation: {
              kind: 'none',
              provider: '',
              model: '',
              name: '',
              installed: null,
              why: ['Nothing was recommended; a task description is required.'],
              limitations: [],
            },
            installedTruth: { status: 'not-read', source: 'localModelManager (installed truth)', installedLocalModels: [] },
            hardware: { source: 'llmfitAdvisor (bounded read-only advisory)', fitStatus: 'not-requested', gpus: [], catalogOnly: [] },
            betterUninstalledOption: { present: false, note: 'Nothing was requested.' },
          }
        }
        if (useCase !== undefined && !WORKLOAD_CLASSES.includes(useCase)) {
          return {
            status: 'invalid_arguments',
            task,
            advisoryOnly: COMPOSED_BOUNDARY_TEXT,
            error: `use_case must be one of: ${WORKLOAD_CLASSES.join(', ')}; nothing was run.`,
            recommendation: {
              kind: 'none',
              provider: '',
              model: '',
              name: '',
              installed: null,
              why: ['The workload class was outside the accepted set, so nothing was recommended.'],
              limitations: [],
            },
            installedTruth: { status: 'not-read', source: 'localModelManager (installed truth)', installedLocalModels: [] },
            hardware: { source: 'llmfitAdvisor (bounded read-only advisory)', fitStatus: 'not-requested', gpus: [], catalogOnly: [] },
            betterUninstalledOption: { present: false, note: 'Nothing was run.' },
          }
        }
        return source.recommendForWorkload(task, useCase)
      },
    },
  ]
}