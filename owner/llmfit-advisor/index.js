/**
 * LLMFIT Advisor
 *
 * Exposes exactly one model-facing tool, `llmfit_recommend`, which asks the
 * pinned llmfit pilot for hardware-fit advisory records. llmfit is a
 * calculation source only: it never becomes an execution provider, an
 * installed-model authority, a routing input, or a GPU controller.
 *
 * Design boundaries this plugin enforces:
 *
 * - One tool. `llmfit_recommend` is the entire model-facing surface. Every
 *   other llmfit subcommand — `search`, `hf-search`, `update`, `download`,
 *   `run`, `bench`, `serve`, `cluster` — is unreachable because no code path
 *   constructs it, not merely unlisted.
 * - Fixed argv. The binary path and the subcommand tokens are constants; only
 *   an allowlisted `use_case` and an integer `limit` vary, and both are
 *   re-validated in the core before any spawn.
 * - No shell. Execution goes through `ctx.subprocess.spawn`, whose argv is
 *   never shell-interpreted, with the ambient environment scrubbed by that
 *   seam.
 * - No pooled capacity. `memory_available_gb` is removed from every result:
 *   llmfit multiplies its memory override by each GPU it detects, so that
 *   field reports theoretical pool size rather than LionGateOS-authorized
 *   capacity. Reporting it would assert an authority this plugin does not hold.
 * - Monotonic namespace guard. A guard denies every `llmfit*` tool name other
 *   than the one intended, and guards run after the `tools/pre-execute`
 *   waterfall, so no later policy can turn that denial into permission.
 *
 * Configuration (`Config`, supplied by the declaring composition):
 * - `cwd` (string): child working directory. Default: the process directory.
 * - `timeoutMs` (number): per-call deadline. Default: 20000.
 *
 * @module @local/llmfit-advisor
 */

import { access, constants } from 'node:fs/promises'

import {
  ALLOWED_USE_CASES,
  ADVISORY_BOUNDARY,
  LLMFIT_BINARY,
  MAX_LIMIT,
  MIN_LIMIT,
  queryRecommend,
  readLimit,
} from './core/advisor.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'llmfit-advisor'

/** Services required by this plugin. */
export const inject = ['tools', 'subprocess']

/** The one tool this plugin registers. */
const TOOL_NAME = 'llmfit_recommend'

/**
 * Service key for the read-only advisory function, so another Host plugin can
 * reuse this exact bounded call path instead of spawning its own llmfit child.
 * The service exposes one method and no authority; see {@link createAdvisorService}.
 */
export const SERVICE_KEY = 'llmfitAdvisor'

/** Every tool name under this prefix is denied unless it is {@link TOOL_NAME}. */
const NAMESPACE_PREFIX = 'llmfit'

/** Denial reason template; `%s` is the public tool name. */
const DENIAL_MESSAGE =
  'llmfit tool "%s" is blocked. This integration exposes exactly one llmfit tool, `llmfit_recommend`; '
  + 'search, hf-search, update, download, run, bench, serve, and cluster are not available.'

/**
 * Result schema: an open object root.
 *
 * The registry asserts this against its supported JSON Schema subset, which is
 * narrower than full JSON Schema — `minimum`/`maximum` and a `json` root are
 * both rejected at registration. An open object root accepts either the success
 * document or a typed failure, and the bounds that matter (`use_case`,
 * `limit`) are enforced in code rather than by schema keywords.
 */
const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * @typedef {object} LlmfitAdvisorConfig
 * @property {string} [cwd] Child working directory; defaults to the process directory.
 * @property {number} [timeoutMs] Per-call deadline in milliseconds.
 */

/**
 * The slice of the plugin context this plugin uses.
 * @typedef {object} LlmfitAdvisorContext
 * @property {(register: () => (() => void), label: string) => unknown} effect Registers a cleanup callback bound to this plugin's lifecycle.
 * @property {{ register: (definition: object) => () => void, guard: (g: (execution: { name: string }) => string | undefined) => (() => void) }} tools Tool registry and monotonic execution guard.
 * @property {{ spawn: (spec: object) => object }} subprocess Bounded subprocess service.
 * @property {{ info?: (message: string, meta: Record<string, unknown>) => void, warn?: (message: string, meta: Record<string, unknown>) => void }} [logger] Plugin logger.
 */

/**
 * Build the tool definition.
 *
 * The description states the advisory boundary in the text the model reads, so
 * the constraint travels with the tool rather than depending on a caller
 * having read this file.
 *
 * @param {object} deps injected dependencies.
 * @param {(options: object) => Promise<object>} deps.query the bounded query implementation.
 * @param {() => Promise<void>} deps.checkExecutable verifies the pinned binary is present and executable.
 * @param {object} deps.context plugin context supplying `subprocess`.
 * @param {string} deps.cwd child working directory.
 * @param {number} deps.timeoutMs per-call deadline.
 * @returns {object} a tool definition for `ctx.tools.register`.
 */
export function createRecommendTool(deps) {
  return {
    name: TOOL_NAME,
    description: [
      'Ask the pinned llmfit model-fit engine for hardware-fit advisory records: which models fit this machine,',
      `at what quantization, with what estimated throughput. Advisory only — installed-model truth, GPU authorization,`,
      `routing, reservation, and execution remain with LionGateOS/DeepSeek, and a "perfect" fit level is never`,
      `permission to run anything. Returns no authorized-capacity figure.`,
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        use_case: {
          type: 'string',
          enum: [...ALLOWED_USE_CASES],
          description: 'Workload class to rank for. Must be one of the listed values.',
        },
        limit: {
          // Bounds are stated in the description and enforced by readLimit plus
          // the core re-check; the registry's schema subset has no minimum or
          // maximum keyword, and an unsupported keyword fails the whole load.
          type: 'integer',
          description: `How many advisory records to return, ${MIN_LIMIT}-${MAX_LIMIT} inclusive.`,
        },
      },
      required: ['use_case'],
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args) => {
      const record = /** @type {Record<string, unknown>} */ (args ?? {})
      const useCase = record['use_case']
      const limit = record['limit'] === undefined ? 5 : readLimit(record['limit'])

      if (typeof useCase !== 'string' || !ALLOWED_USE_CASES.includes(useCase)) {
        return {
          status: 'invalid_arguments',
          error: `use_case must be one of: ${ALLOWED_USE_CASES.join(', ')}; nothing was run.`,
          advisoryBoundary: ADVISORY_BOUNDARY,
        }
      }
      if (limit === undefined || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        return {
          status: 'invalid_arguments',
          error: `limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}; nothing was run.`,
          advisoryBoundary: ADVISORY_BOUNDARY,
        }
      }

      return deps.query({
        useCase,
        limit,
        spawn: (spec) => deps.context.subprocess.spawn(spec),
        cwd: deps.cwd,
        checkExecutable: deps.checkExecutable,
        timeoutMs: deps.timeoutMs,
      })
    },
  }
}

/**
 * Build the read-only advisory service other Host plugins may consume.
 *
 * The service is the same bounded call the tool makes — same fixed argv, same
 * allowlist, same stripped `memory_available_gb`, same typed failures — so a
 * consumer cannot reach a wider llmfit surface by holding the service object
 * instead of the tool. It exposes no authority of its own: no installed-model
 * truth, no route identity, no GPU state, no launch, no download.
 *
 * @param {object} deps injected dependencies.
 * @param {(options: object) => Promise<object>} deps.query the bounded query implementation.
 * @param {() => Promise<void>} deps.checkExecutable verifies the pinned binary is present and executable.
 * @param {object} deps.context plugin context supplying `subprocess`.
 * @param {string} deps.cwd child working directory.
 * @param {number} deps.timeoutMs per-call deadline.
 * @returns {{ recommend: (options: { useCase: string, limit?: number }) => Promise<object> }} the service.
 */
export function createAdvisorService(deps) {
  return {
    /**
     * Ask for advisory fit records for one workload class.
     * @param {{ useCase: string, limit?: number }} options workload class and record count.
     * @returns {Promise<object>} a typed advisory result; never throws for a bad argument.
     */
    async recommend(options) {
      const useCase = options?.useCase
      const limit = options?.limit === undefined ? 5 : readLimit(options.limit)
      if (typeof useCase !== 'string' || !ALLOWED_USE_CASES.includes(useCase)) {
        return {
          status: 'invalid_arguments',
          error: `use_case must be one of: ${ALLOWED_USE_CASES.join(', ')}; nothing was run.`,
          advisoryBoundary: ADVISORY_BOUNDARY,
        }
      }
      if (limit === undefined || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        return {
          status: 'invalid_arguments',
          error: `limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}; nothing was run.`,
          advisoryBoundary: ADVISORY_BOUNDARY,
        }
      }
      return deps.query({
        useCase,
        limit,
        spawn: (spec) => deps.context.subprocess.spawn(spec),
        cwd: deps.cwd,
        checkExecutable: deps.checkExecutable,
        timeoutMs: deps.timeoutMs,
      })
    },
  }
}

/**
 * Register the single advisory tool, the read-only advisory service, and the
 * monotonic namespace guard.
 * @param {LlmfitAdvisorContext} ctx Plugin context carrying tool and subprocess services.
 * @param {LlmfitAdvisorConfig} [config] Composition config; omission uses the documented defaults.
 */
export function apply(ctx, config) {
  const cwd = typeof config?.cwd === 'string' && config.cwd.length > 0 ? config.cwd : process.cwd()
  const timeoutMs = typeof config?.timeoutMs === 'number' && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : 20000

  // Checked per call rather than cached at activation: the pilot binary is a
  // read-only third-party artifact that an owner may move or remove, and a
  // stale positive would turn into an opaque spawn failure under the model.
  const checkExecutable = (path) => access(path, constants.X_OK)

  const deps = { query: queryRecommend, checkExecutable, context: ctx, cwd, timeoutMs }

  ctx.effect(function* tools() {
    yield ctx.tools.register(createRecommendTool(deps))
  }, 'llmfit-advisor: advisory tool')

  ctx.effect(() => ctx.reflect.provide(SERVICE_KEY, createAdvisorService(deps)), 'llmfit-advisor: advisory service')

  ctx.effect(
    () => ctx.tools.guard((execution) => {
      if (!execution.name.startsWith(NAMESPACE_PREFIX)) return undefined
      if (execution.name === TOOL_NAME) return undefined
      return DENIAL_MESSAGE.replace('%s', execution.name)
    }),
    'llmfit-advisor: namespace guard',
  )
}
