/**
 * Bounded read-only llmfit advisory core.
 *
 * Builds the only argv this capability can produce, runs it through an
 * injected spawn function, and returns a typed advisory result. It owns no
 * model, GPU, routing, or installation authority: installed-model truth,
 * provider-route identity, GPU authorization, reservation, and execution stay
 * with LionGateOS and DeepSeek Harness.
 *
 * Two boundaries are load-bearing and must not be relaxed:
 *
 * 1. `memory_available_gb` is stripped. llmfit multiplies `--memory` by every
 *    GPU it detects (two RTX 3090s on this host), so that field reports pooled
 *    theoretical capacity, never LionGateOS-authorized capacity. Presenting it
 *    would assert an authority this integration does not hold.
 * 2. No argument reaches llmfit unvalidated. `use_case` is an allowlist member
 *    and `limit` is an integer in range, so no subcommand, flag, path, or shell
 *    metacharacter can be expressed through the tool surface.
 *
 * @module @local/llmfit-advisor/core/advisor
 */

/** Fixed absolute path to the pinned pilot binary. Not resolved through PATH. */
export const LLMFIT_BINARY = '/home/liongateos/.local/share/liongateos/third-party/llmfit/v1.1.20/llmfit'

/** The only llmfit use-case values this adapter may request. */
export const ALLOWED_USE_CASES = Object.freeze(['general', 'coding', 'reasoning', 'chat', 'multimodal', 'embedding'])

/** Inclusive lower bound for `limit`. */
export const MIN_LIMIT = 1

/** Inclusive upper bound for `limit`. */
export const MAX_LIMIT = 10

/** Deadline for one llmfit invocation. */
export const DEFAULT_TIMEOUT_MS = 20000

/** In-memory stdout cap; `recommend` records are small, so overflow means a problem. */
export const MAX_STDOUT_BYTES = 2 * 1024 * 1024

/** Retained stderr diagnostic tail. */
export const MAX_STDERR_BYTES = 8192

/** Grace period granted to termination before the provider escalates. */
export const GRACE_MS = 2000

/** Stated on every successful result, so a caller cannot mistake it for authority. */
export const ADVISORY_BOUNDARY =
  'llmfit output is advisory only; installed-model truth, GPU authorization, routing, reservation, and execution remain with LionGateOS/DeepSeek.'

/** Fields kept per model record; anything else is dropped rather than forwarded. */
const KEPT_MODEL_FIELDS = Object.freeze([
  'name',
  'provider',
  'parameter_count',
  'params_b',
  'quantization',
  'best_quant',
  'format',
  'memory_required_gb',
  'total_memory_gb',
  'fit_level',
  'fit_label',
  'run_mode',
  'run_mode_label',
  'estimated_tps',
  'estimate_confidence',
  'estimate_basis',
  'context_length',
  'effective_context_length',
  'usable_context',
  'runtime',
  'runtime_label',
  'score',
  'score_components',
  'use_case',
  'license',
  'capabilities',
  'is_moe',
  'supports_tp',
  'disk_size_gb',
  'notes',
])

/**
 * Build the fixed argv for one advisory query.
 *
 * Returns `null` instead of throwing so the caller can report a typed refusal
 * without a stack trace reaching the agent surface. The shape is closed: the
 * binary, `--no-dashboard`, and `recommend --json` are constants, and the two
 * variables are re-validated here even though callers validate first.
 *
 * @param {string} useCase one of {@link ALLOWED_USE_CASES}.
 * @param {number} limit integer within [{@link MIN_LIMIT}, {@link MAX_LIMIT}].
 * @returns {string[] | null} the argv, or `null` when either value is out of contract.
 */
export function buildArgv(useCase, limit) {
  if (typeof useCase !== 'string' || !ALLOWED_USE_CASES.includes(useCase)) return null
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) return null
  return [LLMFIT_BINARY, '--no-dashboard', 'recommend', '--json', '--use-case', useCase, '--limit', String(limit)]
}

/**
 * Read a `limit` argument as an integer, accepting only exact integer numbers.
 * @param {unknown} value candidate from the tool arguments.
 * @returns {number | undefined} the integer, or `undefined` when it is not one.
 */
export function readLimit(value) {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/**
 * Keep only the advisory fields worth returning, and drop `memory_available_gb`.
 * @param {unknown} model one llmfit model record.
 * @returns {Record<string, unknown>} the retained fields that were present.
 */
function projectModel(model) {
  const source = /** @type {Record<string, unknown>} */ (model)
  /** @type {Record<string, unknown>} */
  const kept = {}
  for (const field of KEPT_MODEL_FIELDS) {
    if (source[field] !== undefined) kept[field] = source[field]
  }
  // Defensive: an llmfit release that reports capacity under another name must
  // not smuggle pooled VRAM through this adapter.
  Reflect.deleteProperty(kept, 'memory_available_gb')
  return kept
}

/**
 * Validate one parsed llmfit `recommend --json` document.
 *
 * @param {unknown} document the parsed stdout.
 * @returns {{ ok: true, models: Array<Record<string, unknown>> } | { ok: false, error: string }}
 *   the projected models, or a reason the document does not match the expected schema.
 */
export function projectDocument(document) {
  if (document === null || typeof document !== 'object') {
    return { ok: false, error: 'llmfit output was not a JSON object' }
  }
  const record = /** @type {Record<string, unknown>} */ (document)
  const models = record['models']
  if (!Array.isArray(models)) {
    return { ok: false, error: 'llmfit output has no "models" array' }
  }
  return { ok: true, models: models.map(projectModel) }
}

/**
 * Run one bounded read-only advisory query.
 *
 * Every failure is a typed result, never a thrown exception: the agent surface
 * must not receive a raw spawn error, and a caller must not be able to read a
 * failure as permission to retry with a broader command.
 *
 * @param {object} options
 * @param {string} options.useCase validated use-case value.
 * @param {number} options.limit validated limit.
 * @param {(spec: object) => object} options.spawn injected spawn, matching `ctx.subprocess.spawn`.
 * @param {string} options.cwd working directory for the child.
 * @param {(path: string) => Promise<void>} [options.checkExecutable] resolves when the binary is executable.
 * @param {number} [options.timeoutMs] deadline override.
 * @returns {Promise<object>} a typed result with `status`, and either advisory `models` or an `error`.
 */
export async function queryRecommend(options) {
  const { useCase, limit, spawn, cwd, checkExecutable } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const argv = buildArgv(useCase, limit)
  if (argv === null) {
    return { status: 'invalid_arguments', error: 'use_case or limit is outside the allowlist; nothing was run.' }
  }

  if (checkExecutable !== undefined) {
    try {
      await checkExecutable(LLMFIT_BINARY)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { status: 'unavailable', error: `llmfit is not available at its pinned path: ${detail}` }
    }
  }

  let handle
  try {
    handle = spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: GRACE_MS,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'failed', error: `llmfit could not be started: ${detail}` }
  }

  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), timeoutMs)

  let outcome
  try {
    outcome = await Promise.race([
      handle.done,
      new Promise((_, reject) => {
        deadline.signal.addEventListener('abort', () => {
          try {
            handle.terminate()
          } catch {
            // A provider that already lost the range has nothing left to stop.
          }
          reject(new Error('timeout'))
        }, { once: true })
      }),
    ])
  } catch (error) {
    clearTimeout(timer)
    const detail = error instanceof Error ? error.message : String(error)
    if (detail === 'timeout') {
      return { status: 'timeout', error: `llmfit did not finish within ${timeoutMs}ms and was terminated.` }
    }
    return { status: 'failed', error: `llmfit failed before reporting an outcome: ${detail}` }
  }
  clearTimeout(timer)

  const stdout = handle.collected?.stdout?.readFrom(0)
  const stderr = handle.collected?.stderr?.readFrom(0)

  if (stdout === undefined || stderr === undefined) {
    return { status: 'failed', error: 'llmfit produced no collected output streams.' }
  }
  if (stdout.lossy === true) {
    return { status: 'output_too_large', error: `llmfit output exceeded ${MAX_STDOUT_BYTES} bytes and was truncated; no partial advisory is returned.` }
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    return { status: 'failed', error: `llmfit was killed by signal ${outcome.signal ?? '(unknown)'}.` }
  }
  if (outcome.exitCode !== 0) {
    const detail = stderr.text.trim()
    return { status: 'failed', error: `llmfit exited ${outcome.exitCode}${detail === '' ? '' : `: ${detail}`}` }
  }

  let parsed
  try {
    parsed = JSON.parse(stdout.text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'failed', error: `llmfit output was not valid JSON: ${detail}` }
  }

  const projected = projectDocument(parsed)
  if (projected.ok !== true) {
    return { status: 'failed', error: `llmfit output did not match the expected schema: ${projected.error}` }
  }

  return {
    status: 'ok',
    advisoryBoundary: ADVISORY_BOUNDARY,
    useCase,
    limit,
    count: projected.models.length,
    models: projected.models,
  }
}
