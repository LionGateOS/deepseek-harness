/**
 * Runtime probes against the local llama.cpp endpoint. Read-only HTTP GETs on
 * the loopback endpoint; every probe is bounded by a timeout and returns a
 * shaped result instead of throwing, so snapshot generation degrades to
 * explicit "unavailable" states rather than optimistic assumptions.
 */

/**
 * @param {string} baseURL endpoint base (loopback only, validated by config).
 * @param {string} path request path.
 * @param {number} timeoutMs per-probe timeout.
 * @param {{fetch?: typeof fetch}} [deps] injectable fetch for tests.
 * @returns {Promise<{status: 'ok', body: unknown}|{status: 'error', kind: 'timeout'|'http'|'unreachable', detail: string}>}
 */
export const probeJson = async (baseURL, path, timeoutMs, deps = {}) => {
  const doFetch = deps.fetch ?? fetch
  try {
    const response = await doFetch(`${baseURL}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { status: 'error', kind: 'http', detail: `HTTP ${response.status} from ${path}` }
    return { status: 'ok', body: await response.json() }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const kind = error?.name === 'TimeoutError' || /aborted|timeout/i.test(detail) ? 'timeout' : 'unreachable'
    return { status: 'error', kind, detail }
  }
}

/**
 * Identify which catalog model (by exact GGUF path) is loaded on the running
 * endpoint, plus the live per-slot context and per-slot busy state.
 * `/slots` is the authoritative active-job source; when it cannot be read the
 * busy state is explicitly unknown (callers must fail closed on disruptive
 * actions).
 * @param {string} baseURL endpoint base.
 * @param {number} timeoutMs per-probe timeout.
 * @param {{fetch?: typeof fetch}} [deps] injectable fetch for tests.
 * @returns {Promise<object>} { state, modelPath, slots, busy, busyUnknown, liveContext, error }
 */
export const probeServer = async (baseURL, timeoutMs, deps = {}) => {
  const [health, models, slots] = await Promise.all([
    probeJson(baseURL, '/health', timeoutMs, deps),
    probeJson(baseURL, '/v1/models', timeoutMs, deps),
    probeJson(baseURL, '/slots', timeoutMs, deps),
  ])
  if (health.status !== 'ok' && health.kind === 'unreachable') {
    return { state: 'stopped', modelPath: undefined, slots: [], busyUnknown: false, liveContext: undefined }
  }
  if (health.status !== 'ok') {
    return { state: 'unhealthy', modelPath: undefined, slots: [], busyUnknown: true, error: health.detail }
  }
  let modelPath = undefined
  let liveContext = undefined
  if (models.status === 'ok') {
    const rows = /** @type {{data?: Array<{id?: string, meta?: {n_ctx?: number}}>}} */ (models.body)
    const first = Array.isArray(rows?.data) ? rows.data[0] : undefined
    if (typeof first?.id === 'string') modelPath = first.id
    if (typeof first?.meta?.n_ctx === 'number') liveContext = first.meta.n_ctx
  }
  let slotsBody = /** @type {Array<{id?: number, n_ctx?: number, is_processing?: boolean, id_task?: number}>} */ (undefined)
  if (slots.status === 'ok' && Array.isArray(slots.body)) slotsBody = slots.body
  const slotRows = (slotsBody ?? []).map((slot) => ({
    id: typeof slot?.['id'] === 'number' ? slot['id'] : undefined,
    n_ctx: typeof slot?.['n_ctx'] === 'number' ? slot['n_ctx'] : undefined,
    isProcessing: slot?.['is_processing'] === true,
    ...(slot?.['id_task'] !== undefined && slot?.['is_processing'] === true ? { task: slot['id_task'] } : {}),
  }))
  return {
    state: 'running',
    modelPath,
    liveContext,
    slots: slotRows,
    ...(slotsBody === undefined ? { busyUnknown: true } : { busy: slotRows.some((slot) => slot.isProcessing), busyUnknown: false }),
    ...(models.status !== 'ok' || slots.status !== 'ok' ? { error: models.status !== 'ok' ? models.detail : slots.detail } : {}),
  }
}
/**
 * Observe a local endpoint this manager does not launch. Same read-only probes
 * as `probeServer`, plus the model identity the caller needs to prove that the
 * endpoint it reached is the one behind a given card.
 *
 * The card identity is NOT inferred from the model name: it comes from the
 * configured mapping between the loopback port and a GPU UUID, and it is only
 * reported together with the fact that something really answers on that port.
 * Nothing here can start, stop, or throttle anything.
 * @param {{port: number, gpuUuid: string, gpuName: string}} endpoint configured observation target.
 * @param {number} timeoutMs per-probe timeout.
 * @param {{fetch?: typeof fetch}} [deps] injectable fetch for tests.
 * @returns {Promise<{port: number, gpuUuid: string, gpuName: string, endpoint: string, state: string, modelId?: string, liveContext?: number, busy?: boolean, busyUnknown?: boolean, error?: string}>}
 */
export const observeEndpoint = async (endpoint, timeoutMs, deps = {}) => {
  const baseURL = `http://127.0.0.1:${endpoint.port}`
  const probed = await probeServer(baseURL, timeoutMs, deps)
  const row = {
    port: endpoint.port,
    gpuUuid: endpoint.gpuUuid,
    gpuName: endpoint.gpuName,
    endpoint: baseURL,
    state: probed.state,
  }
  if (typeof probed.modelPath === 'string') row.modelId = probed.modelPath
  if (typeof probed.liveContext === 'number') row.liveContext = probed.liveContext
  if (probed.busyUnknown === false) row.busy = probed.busy === true
  else row.busyUnknown = true
  if (probed.error !== undefined) row.error = probed.error
  // Identity starts as the configured port→card mapping, which is a declaration,
  // not a proof. `evidence` says which it currently is so a caller can label the
  // attribution honestly instead of upgrading a declaration to an exact claim.
  row.evidence = 'endpoint'
  return row
}
