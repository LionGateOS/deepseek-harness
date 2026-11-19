/**
 * A bounded, timestamped ring of GPU power samples.
 *
 * The sampler exists because the measurement window must be longer than the
 * job: a job that runs for minutes cannot be costed from a sixty-second
 * history. It therefore holds a fixed-capacity ring in memory and never writes
 * a sample to disk — the ring IS the retention policy.
 *
 * Each record keeps the attribution evidence a job costing needs: when the
 * sample was taken, what each card drew, and which compute processes were on
 * each card at that moment. Process identity is re-read every sample, so a
 * worker that restarts is observed by its new pid instead of a remembered one.
 */

/** Default ring capacity: two hours at one sample per second. */
export const DEFAULT_CAPACITY = 7200

/** Default sampling period. */
export const DEFAULT_INTERVAL_MS = 1000

/**
 * Keep one wattage reading or null. A card that reports nothing contributes no
 * energy; it must never be read as zero watts, which would deflate a total.
 * @param {unknown} value the parsed reading.
 * @returns {number|null} watts, or null when unavailable.
 */
const nullableWatts = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/**
 * Build one ring record from a GPU query result. Utilization is kept because a
 * job window is inferred from the card actually working, not from the engine
 * process merely holding memory.
 * @param {number} t epoch milliseconds of the sample.
 * @param {{gpus?: Array<object>, processes?: Array<object>}} query the GPU query result.
 * @returns {{t: number, gpus: Array<{uuid: string, watts: number|null, limitW: number|null, utilPct: number|null}>, processes: Array<{uuid: string, pid: number, processName: string}>}} the record.
 */
export const buildRecord = (t, query) => {
  const util = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const gpus = (query?.gpus ?? []).map((gpu) => ({
    uuid: String(gpu.uuid),
    watts: nullableWatts(gpu.powerDrawW),
    limitW: nullableWatts(gpu.powerLimitW),
    utilPct: util(gpu.utilizationPct),
  }))
  const processes = (query?.processes ?? []).map((proc) => ({
    uuid: String(proc.uuid),
    pid: proc.pid,
    processName: String(proc.processName ?? 'unknown'),
  }))
  return { t, gpus, processes }
}

/**
 * A fixed-capacity ring of samples. `push` never grows past `capacity`: the
 * oldest record is dropped, which is what makes retention bounded by design.
 */
export class PowerRing {
  #records = []
  #capacity

  /**
   * @param {number} capacity most records retained; must be a positive integer.
   */
  constructor(capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError('power ring capacity must be a positive integer')
    }
    this.#capacity = capacity
  }

  /** @returns {number} the configured capacity. */
  get capacity() {
    return this.#capacity
  }

  /** @returns {number} how many records are held now. */
  get size() {
    return this.#records.length
  }

  /**
   * Append one record, evicting the oldest when full.
   * @param {{t: number}} record the sample to keep.
   * @returns {void}
   */
  push(record) {
    this.#records.push(record)
    if (this.#records.length > this.#capacity) this.#records.splice(0, this.#records.length - this.#capacity)
  }

  /** @returns {Array<object>} every retained record, oldest first. */
  all() {
    return this.#records.slice()
  }

  /**
   * Records at or after an instant.
   * @param {number} sinceMs earliest instant to keep.
   * @returns {Array<object>} the matching records, oldest first.
   */
  since(sinceMs) {
    if (!Number.isFinite(sinceMs)) return this.all()
    return this.#records.filter((record) => record.t >= sinceMs)
  }

  /**
   * The oldest retained instant.
   * @returns {number|null} epoch milliseconds, or null when empty.
   */
  oldestAt() {
    return this.#records.length === 0 ? null : this.#records[0].t
  }

  /**
   * Every distinct GPU UUID seen in the ring, with the wattages observed.
   * @returns {Map<string, Array<{t: number, watts: number|null}>>} per-card series.
   */
  seriesByGpu() {
    const series = new Map()
    for (const record of this.#records) {
      for (const gpu of record.gpus) {
        if (!series.has(gpu.uuid)) series.set(gpu.uuid, [])
        series.get(gpu.uuid).push({ t: record.t, watts: gpu.watts })
      }
    }
    return series
  }

  /** Drop every record. @returns {void} */
  clear() {
    this.#records = []
  }
}

/**
 * Run one sampling cycle and stop; separate from the timer so a test can step
 * the clock instead of waiting for it.
 * @param {PowerRing} ring where the sample is kept.
 * @param {() => Promise<object>} query the GPU query, returning a `queryGpus` result.
 * @param {() => number} [now] clock, defaulting to `Date.now`.
 * @returns {Promise<boolean>} whether a record was kept.
 */
export const sampleOnce = async (ring, query, now = Date.now) => {
  const result = await query()
  if (!result || result.status !== 'ok') return false
  ring.push(buildRecord(now(), result))
  return true
}

/**
 * A sampler whose timer is owned by one start/stop pair.
 *
 * `stop()` is idempotent and returns a promise that settles once any in-flight
 * cycle has finished, so a caller releasing the plugin is not left with a
 * query running against a torn-down service.
 *
 * @param {{ring: PowerRing, query: () => Promise<object>, intervalMs?: number, now?: () => number, schedule?: Function, cancel?: Function}} options the sampler's dependencies.
 * @returns {{start: () => void, stop: () => Promise<void>, sampleNow: () => Promise<boolean>, running: () => boolean}} the sampler handle.
 */
export const createSampler = (options) => {
  const { ring, query } = options
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : DEFAULT_INTERVAL_MS
  const now = options.now ?? Date.now
  // Injected so the tests drive the clock; production uses the global timer.
  const schedule = options.schedule ?? ((fn, ms) => setInterval(fn, ms))
  const cancel = options.cancel ?? ((handle) => clearInterval(handle))

  let handle = null
  let inFlight = null
  let stopped = true

  const tick = () => {
    if (stopped || inFlight !== null) return
    inFlight = sampleOnce(ring, query, now)
      .catch(() => false)
      .finally(() => { inFlight = null })
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      tick()
      handle = schedule(tick, intervalMs)
    },
    async stop() {
      stopped = true
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
      if (inFlight !== null) await inFlight
    },
    async sampleNow() {
      return sampleOnce(ring, query, now)
    },
    running() {
      return !stopped
    },
  }
}

/**
 * Derive a job window from the ring: the span during which one card was both
 * busy and carrying a compute process. This is the measurement-based window,
 * used when the engine cannot say when a request started.
 *
 * A window ends at the first sample where the card stopped working, so a window
 * that is still open is reported as open rather than invented to the present.
 *
 * @param {PowerRing} ring the retained samples.
 * @param {string} uuid the card whose activity defines the window.
 * @param {{minUtilPct?: number, tailMs?: number}} [options] activity threshold and how far back to look.
 * @returns {{startedAt: number, lastBusyAt: number, open: boolean, sampleCount: number, distinctPids: number[]}|null} the window, or null when the card never worked.
 */
export const activeWindow = (ring, uuid, options = {}) => {
  const minUtilPct = Number.isFinite(options.minUtilPct) ? options.minUtilPct : 5
  const tailMs = Number.isFinite(options.tailMs) ? options.tailMs : 24 * 60 * 60 * 1000
  const newest = ring.oldestAt() === null ? null : ring.all()[ring.size - 1].t
  const records = newest === null ? [] : ring.since(Math.max(ring.oldestAt() ?? newest, newest - tailMs))
  const busy = records.filter((record) => {
    const gpu = record.gpus.find((card) => card.uuid === uuid)
    if (!gpu) return false
    const working = typeof gpu.utilPct === 'number' && gpu.utilPct >= minUtilPct
    const hasProcess = record.processes.some((proc) => proc.uuid === uuid)
    return working || hasProcess
  })
  if (busy.length === 0) return null
  const pids = [...new Set(busy.flatMap((record) => record.processes.filter((proc) => proc.uuid === uuid).map((proc) => proc.pid)))]
  const lastBusyAt = busy[busy.length - 1].t
  const open = newest !== null && lastBusyAt >= newest - 5000
  return { startedAt: busy[0].t, lastBusyAt, open, sampleCount: busy.length, distinctPids: pids }
}
