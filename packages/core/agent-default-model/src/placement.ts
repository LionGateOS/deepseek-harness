/**
 * Endpoint-aware placement of the default model selection.
 *
 * Probes each configured llama.cpp endpoint with read-only loopback GETs and
 * resolves the default model onto the first eligible endpoint in priority
 * order. A probe is bounded by a timeout and returns a shaped result instead
 * of throwing, so placement degrades to explicit evidence rather than
 * optimistic assumptions.
 *
 * @module @deepseek-ai/dsh-agent-default-model/placement
 */
/** One configured placement target: a provider route and the endpoint that serves it. */
export interface PlacementTarget {
  /** Registered provider route that serves this endpoint. */
  readonly provider: string
  /** llama.cpp HTTP base without `/v1`, for example `http://127.0.0.1:8001`. */
  readonly endpoint: string
  /** Whether this target is eligible for automatic inter-provider fallback. */
  readonly automaticFallback?: boolean
  /**
   * Explicit model identity for the candidate. Required when
   * `automaticFallback` is true; omitting it causes fail-closed
   * behavior in the fallback path.
   */
  readonly model?: string
}

/** Observed state of one placement endpoint from a single probe pass. */
export interface EndpointState {
  /** `running` when `/health` and `/v1/models` answer; `stopped` when unreachable; `unhealthy` otherwise. */
  readonly state: 'running' | 'stopped' | 'unhealthy'
  /** Model path the endpoint reports serving, when `/v1/models` answered. */
  readonly modelPath?: string
  /** Whether at least one slot processes a request, when `/slots` answered. */
  readonly busy?: boolean
  /** True when `/slots` was unreadable, so `busy` is unknown. */
  readonly busyUnknown?: boolean
  /** Probe failure explanation, when the endpoint does not serve the model. */
  readonly error?: string
}

/** Placement decision with the per-endpoint evidence in target priority order. */
export interface PlacementDecision {
  /** Selected provider route. */
  readonly provider: string
  /** Per-endpoint probe evidence aligned to the target priority order. */
  readonly evidence: readonly EndpointState[]
}

type ProbeOutcome =
  | { readonly status: 'ok'; readonly body: unknown }
  | { readonly status: 'error'; readonly kind: 'timeout' | 'http' | 'unreachable'; readonly detail: string }

/**
 * Issue one bounded read-only GET and parse the JSON body.
 * @param endpoint - llama.cpp HTTP base without `/v1`.
 * @param path - request path.
 * @param timeoutMs - per-probe timeout in milliseconds.
 * @param doFetch - fetch implementation; defaults to the global fetch.
 * @returns the parsed body or a shaped failure with its kind.
 */
async function probeJson(
  endpoint: string,
  path: string,
  timeoutMs: number,
  doFetch: typeof fetch,
): Promise<ProbeOutcome> {
  try {
    const response = await doFetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { status: 'error', kind: 'http', detail: `HTTP ${response.status} from ${path}` }
    return { status: 'ok', body: await response.json() }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /aborted|timeout/i.test(detail))
    return { status: 'error', kind: timedOut ? 'timeout' : 'unreachable', detail }
  }
}

/**
 * Read the first model id reported by a llama.cpp `/v1/models` body.
 * @param body - parsed `/v1/models` response body.
 * @returns the first `data[].id` string, or undefined when absent.
 */
function modelIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return undefined
  const first = data[0]
  if (typeof first !== 'object' || first === null) return undefined
  const id = (first as { id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

/**
 * Read whether any slot in a llama.cpp `/slots` body is processing.
 * @param body - parsed `/slots` response body.
 * @returns the busy flag, or undefined when the body is not a slot array.
 */
function busyOf(body: unknown): boolean | undefined {
  if (!Array.isArray(body)) return undefined
  return body.some(
    (slot) => typeof slot === 'object' && slot !== null && (slot as { is_processing?: unknown }).is_processing === true,
  )
}

/**
 * Probe one placement endpoint with parallel bounded GETs on `/health`,
 * `/v1/models`, and `/slots`. `/slots` is the authoritative active-job source;
 * when it cannot be read the busy state is explicitly unknown.
 * @param target - provider route and endpoint base to probe.
 * @param timeoutMs - per-probe timeout in milliseconds.
 * @param fetchImpl - optional fetch implementation for tests.
 * @returns the observed endpoint state.
 */
export async function probeEndpoint(
  target: PlacementTarget,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<EndpointState> {
  const doFetch = fetchImpl ?? fetch
  const [health, models, slots] = await Promise.all([
    probeJson(target.endpoint, '/health', timeoutMs, doFetch),
    probeJson(target.endpoint, '/v1/models', timeoutMs, doFetch),
    probeJson(target.endpoint, '/slots', timeoutMs, doFetch),
  ])
  if (health.status !== 'ok' && health.kind === 'unreachable') {
    return { state: 'stopped', error: health.detail }
  }
  if (health.status !== 'ok') {
    return { state: 'unhealthy', busyUnknown: true, error: health.detail }
  }
  const modelPath = models.status === 'ok' ? modelIdOf(models.body) : undefined
  const busy = slots.status === 'ok' ? busyOf(slots.body) : undefined
  return {
    state: 'running',
    ...(modelPath === undefined ? {} : { modelPath }),
    ...(busy === undefined ? { busyUnknown: true } : { busy, busyUnknown: false }),
    ...(models.status !== 'ok'
      ? { error: models.detail }
      : slots.status !== 'ok'
        ? { error: slots.detail }
        : {}),
  }
}

/**
 * Rank one endpoint for placement of a model: 0 when it serves the model with
 * a known free slot, 1 when it serves the model with an unreadable slot state
 * (the server's own slot queue remains the capacity mechanism), 2 otherwise.
 * @param state - observed endpoint state.
 * @param model - provider-owned model id to place.
 * @returns the placement rank, lower first.
 */
export function placementRank(state: EndpointState, model: string): number {
  if (state.state !== 'running' || state.modelPath !== model) return 2
  if (state.busy === false) return 0
  if (state.busy === undefined) return 1
  return 2
}

/**
 * Resolve the provider route that should serve a model.
 *
 * Targets are considered in array order (priority). A known-free endpoint
 * beats an endpoint whose slot state is unreadable, and any eligible
 * endpoint beats the static fallback. When no target is eligible the static
 * default provider is returned so the request fails loudly on its normal
 * provider error instead of at session creation.
 * @param targets - placement targets in priority order.
 * @param evidence - probe evidence aligned to `targets` by index.
 * @param model - provider-owned model id to place.
 * @param fallbackProvider - static default provider route used when no target is eligible.
 * @returns the selected provider route and the full probe evidence.
 */
export function decidePlacement(
  targets: readonly PlacementTarget[],
  evidence: readonly EndpointState[],
  model: string,
  fallbackProvider: string,
): PlacementDecision {
  let bestIndex = -1
  let bestRank = 3
  for (let index = 0; index < targets.length; index += 1) {
    const state = evidence[index]
    if (state === undefined) continue
    const rank = placementRank(state, model)
    if (rank < bestRank) {
      bestRank = rank
      bestIndex = index
    }
  }
  // Rank 2 means ineligible (stopped, model mismatch, or busy); a best rank of
  // 2 or 3 means no target can serve the model, so fall back to the static
  // default provider and let the request fail loudly on its normal provider
  // error rather than at session creation.
  const provider = bestRank >= 2 ? fallbackProvider : targets[bestIndex]?.provider ?? fallbackProvider
  return { provider, evidence }
}
