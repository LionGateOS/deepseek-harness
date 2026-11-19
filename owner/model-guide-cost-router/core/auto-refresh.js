/**
 * Bounded automatic refresh: one timer, one job at a time, disposed on plugin
 * teardown, and silent about being offline.
 *
 * The rules this encodes, each one a thing that goes wrong without it:
 *  - One timer. A second scheduler would double the request rate, so the
 *    controller refuses to start twice.
 *  - No overlap. A slow refresh must not stack behind the next tick; a tick
 *    that arrives while a run is in flight is skipped, not queued.
 *  - Bounded failure. An unreachable endpoint or a failed refresh records a
 *    status and schedules the next attempt; it never throws into the timer,
 *    because an unhandled rejection there would take the process down.
 *  - Real disposal. `stop()` clears the timer and marks the controller dead,
 *    so a reload cannot leave an orphan firing against a torn-down plugin.
 *  - Owner control. Recurring traffic is scheduled only when the owner turned
 *    it on. The single activation run is a separate switch: `refreshOnActivation`
 *    asks for one sweep at startup, so it must not require the owner to also
 *    accept an unbounded timer. When the recurring switch is off, the startup
 *    run happens once and no timer is re-armed afterwards.
 *
 * The controller owns no network code: the caller supplies one `run` function,
 * which is what the tests drive directly.
 */

/**
 * @typedef {object} AutoRefreshOptions
 * @property {boolean} enabled owner switch for RECURRING refresh; false arms no timer.
 * @property {number} intervalMs delay between recurring refreshes.
 * @property {boolean} [runOnStartup] run once shortly after activation, even when
 *   `enabled` is false. Without `enabled` no timer follows that single run.
 * @property {number} [startupDelayMs] how long after activation that first run happens.
 * @property {() => Promise<unknown>} run one refresh, returns its report.
 * @property {(event: object) => void} [onEvent] observer for status changes.
 * @property {(fn: () => void, ms: number) => unknown} [setTimer] injectable scheduler.
 * @property {(handle: unknown) => void} [clearTimer] injectable canceller.
 * @property {() => number} [now] injectable clock.
 */

/**
 * Create the refresh controller. It schedules nothing until `start()` is
 * called. `start()` arms the activation run when `runOnStartup` is set, the
 * recurring interval when `enabled` is set, and returns false when both are off.
 * @param {AutoRefreshOptions} options
 */
export function createAutoRefresh(options) {
  const enabled = options.enabled === true
  const runOnStartup = options.runOnStartup === true
  const intervalMs = options.intervalMs
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('auto-refresh: intervalMs must be a positive number')
  }
  if (typeof options.run !== 'function') throw new TypeError('auto-refresh: run must be a function')
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(/** @type {any} */ (handle)))
  const now = options.now ?? (() => Date.now())
  const emit = (event) => {
    try {
      options.onEvent?.(event)
    } catch {
      // An observer must never break the schedule.
    }
  }

  /** Pending timer handle, or null when nothing is scheduled. */
  let handle = null
  /** True while a run is in flight. */
  let running = false
  /** The last completed run, for status reporting. */
  let last = /** @type {{at: string, status: 'ok'|'failed', reason?: string, skipped?: number}|null} */ (null)
  /** Ticks that arrived during a run. */
  let skipped = 0
  let started = false
  let stopped = false

  const schedule = (delay, arm) => {
    if (stopped || !arm) return
    // Replace, never overwrite: a run that writes configuration re-enters
    // through `refreshNow()`, whose `schedule()` call would otherwise drop the
    // pending handle and leave a timer nothing can cancel, firing beside the
    // real one for the rest of the process lifetime.
    if (handle !== null) {
      clearTimer(handle)
      handle = null
    }
    handle = setTimer(() => {
      handle = null
      void tick()
    }, delay)
    // A Node timer keeps the process alive by default; a refresh timer must
    // never be the reason a Host cannot exit.
    if (typeof handle === 'object' && handle !== null && typeof (/** @type {any} */ (handle)).unref === 'function') {
      ;/** @type {any} */ (handle).unref()
    }
  }

  async function tick() {
    if (stopped) return
    if (running) {
      skipped += 1
      emit({ kind: 'skipped', at: new Date(now()).toISOString(), skipped })
      schedule(intervalMs, enabled)
      return
    }
    running = true
    emit({ kind: 'started', at: new Date(now()).toISOString() })
    try {
      await options.run()
      last = { at: new Date(now()).toISOString(), status: 'ok', ...(skipped > 0 ? { skipped } : {}) }
      emit({ kind: 'ok', ...last })
    } catch (error) {
      last = {
        at: new Date(now()).toISOString(),
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        ...(skipped > 0 ? { skipped } : {}),
      }
      emit({ kind: 'failed', ...last })
    } finally {
      running = false
      skipped = 0
      // Recurring only: with the owner switch off the activation run is the
      // whole schedule, so nothing is armed after it finishes.
      schedule(intervalMs, enabled)
    }
  }

  return {
    /**
     * Arm the first run: the activation sweep when the owner asked for one,
     * otherwise the recurring interval. Returns false when there is nothing to
     * arm — both switches off, already started, or already stopped.
     */
    start() {
      if (stopped || started) return false
      if (!enabled && !runOnStartup) return false
      started = true
      if (runOnStartup) {
        schedule(options.startupDelayMs ?? 0, true)
      } else {
        schedule(intervalMs, enabled)
      }
      return true
    },
    /** Clear the timer and refuse further scheduling. Idempotent. */
    stop() {
      stopped = true
      if (handle !== null) {
        clearTimer(handle)
        handle = null
      }
    },
    /** Run one refresh now, outside the schedule (used by the manual button). */
    async refreshNow() {
      await tick()
    },
    /** Observable state, for the panel and the tests. */
    status() {
      return {
        enabled,
        runOnStartup,
        started,
        stopped,
        running,
        intervalMs,
        scheduled: handle !== null,
        skipped,
        last,
      }
    },
  }
}
