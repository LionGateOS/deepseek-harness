/**
 * The bounded refresh scheduler.
 *
 * These tests own the clock: every timer is injected, so nothing here waits on
 * real time and nothing can leave a handle behind. What they pin is the set of
 * behaviours that make a recurring job safe to run inside a Host — one timer,
 * no overlap, no escaped rejection, and a disposal that really stops it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoRefresh } from '../core/auto-refresh.js'

/**
 * A manual clock. `fire()` runs the pending callback the way a timer would.
 * @returns {object} the injected timer pair plus inspection helpers.
 */
function clock() {
  let handle = 0
  let pending
  return {
    setTimer(fn, ms) {
      handle += 1
      pending = { fn, ms, handle }
      return pending
    },
    clearTimer(entry) {
      if (pending !== undefined && entry?.handle === pending.handle) pending = undefined
    },
    fire() {
      const due = pending
      pending = undefined
      due?.fn()
      return due
    },
    get pending() { return pending },
    get count() { return pending === undefined ? 0 : 1 },
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('auto-refresh: a disabled scheduler schedules nothing at all', () => {
  const timers = clock()
  let runs = 0
  const controller = createAutoRefresh({
    enabled: false,
    intervalMs: 1000,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  assert.equal(controller.start(), false, 'start() refuses when the owner left refresh off')
  assert.equal(timers.count, 0, 'no timer is armed when the owner left refresh off')
  assert.equal(controller.status().scheduled, false)
  controller.stop()
  assert.equal(runs, 0)
})

test('auto-refresh: an enabled scheduler arms exactly one timer at the configured interval', () => {
  const timers = clock()
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 6 * 60 * 60 * 1000,
    runOnStartup: false,
    run: () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  assert.equal(timers.count, 1)
  assert.equal(timers.pending.ms, 6 * 60 * 60 * 1000)
  controller.start()
  assert.equal(timers.count, 1, 'a second start does not arm a second timer')
  controller.stop()
})

test('auto-refresh: the startup run happens once and only when configured', async () => {
  const timers = clock()
  let runs = 0
  const withStartup = createAutoRefresh({
    enabled: true,
    intervalMs: 1000,
    runOnStartup: true,
    startupDelayMs: 5000,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  withStartup.start()
  assert.equal(timers.pending.ms, 5000, 'the startup run waits out its delay, not the interval')
  timers.fire()
  await tick()
  assert.equal(runs, 1)
  assert.equal(timers.pending.ms, 1000, 'after the startup run the periodic interval takes over')
  withStartup.stop()

  const withoutStartup = createAutoRefresh({
    enabled: true,
    intervalMs: 1000,
    runOnStartup: false,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  withoutStartup.start()
  assert.equal(timers.pending.ms, 1000, 'with no startup run the interval is the only schedule')
  withoutStartup.stop()
})

test('auto-refresh: an overlap is skipped, never queued', async () => {
  // The guard matters in two places. While a run is in flight the next tick is
  // not yet armed at all — the interval is re-armed only once the run finishes —
  // and any run requested during that window (a manual refresh, or an
  // adapter-change trigger) is dropped and counted rather than queued behind.
  const timers = clock()
  let started = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 1000,
    runOnStartup: false,
    run: async () => { started += 1; await gate },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  assert.equal(timers.count, 1)
  timers.fire()
  assert.equal(controller.status().running, true)
  assert.equal(timers.count, 0, 'no next tick is armed while a run is in flight')

  await controller.refreshNow()
  assert.equal(started, 1, 'the overlapping request does not start a second run')
  assert.equal(controller.status().skipped, 1, 'the skipped run is counted, not silently dropped')

  release()
  await tick()
  await tick()
  assert.equal(timers.count, 1, 'the interval is re-armed once the run finishes')
  controller.stop()
})

test('auto-refresh: a failing run is caught and the schedule survives', async () => {
  const timers = clock()
  const events = []
  let runs = 0
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 1000,
    run: async () => { runs += 1; throw new Error('the endpoint is offline') },
    onEvent: (event) => events.push(event),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  timers.fire()
  await tick()
  await tick()
  await tick()

  assert.equal(runs, 1)
  const failed = events.find((event) => event.kind === 'failed')
  assert.ok(failed !== undefined, 'the failure is reported as an event')
  assert.match(failed.reason, /offline/)
  assert.equal(timers.count, 1, 'the next interval is still armed after a failure')
  controller.stop()
})

test('auto-refresh: stop clears the timer and prevents rescheduling', async () => {
  const timers = clock()
  let runs = 0
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 1000,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  assert.equal(timers.count, 1)
  controller.stop()
  assert.equal(timers.count, 0, 'disposal clears the armed timer')
  assert.equal(controller.status().stopped, true)
  // A disposed plugin must not come back to life if a stale closure runs.
  controller.start()
  assert.equal(timers.count, 0, 'a stopped controller does not re-arm')
  await tick()
  assert.equal(runs, 0)
})

test('auto-refresh: refreshNow runs once, off schedule, and reports it', async () => {
  const timers = clock()
  const events = []
  let runs = 0
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 60_000,
    run: async () => { runs += 1 },
    onEvent: (event) => events.push(event),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  await controller.refreshNow()
  assert.equal(runs, 1)
  assert.equal(events.at(-1).kind, 'ok')
  assert.equal(timers.pending.ms, 60_000, 'a manual run does not disturb the interval')
  controller.stop()
})

test('auto-refresh: refreshNow is refused while a run is in flight', async () => {
  const timers = clock()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let started = 0
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 60_000,
    run: async () => { started += 1; await gate },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  const first = controller.refreshNow()
  // The second request arrives while the first is still awaiting its work.
  await controller.refreshNow()
  assert.equal(started, 1, 'the second request does not start a second run')
  release()
  await first
  controller.stop()
})

test('auto-refresh: bad configuration is refused loudly', () => {
  assert.throws(() => createAutoRefresh({ enabled: true, intervalMs: 0, run: () => {} }), /intervalMs must be a positive number/)
  assert.throws(() => createAutoRefresh({ enabled: true, intervalMs: -1, run: () => {} }), /intervalMs must be a positive number/)
  assert.throws(() => createAutoRefresh({ enabled: true, intervalMs: 1000 }), /run must be a function/)
})

test('auto-refresh: the timer handle is unreferenced so it cannot hold the Host open', () => {
  // A Node timer keeps the process alive by default. A refresh timer must never
  // be the reason a Host cannot exit, so the controller unrefs the handle it is
  // given. This asserts that with a handle that records the call, rather than
  // trusting the comment in the module.
  let unrefCalled = false
  const handle = { unref() { unrefCalled = true } }
  const controller = createAutoRefresh({
    enabled: true,
    intervalMs: 60 * 60 * 1000,
    run: () => {},
    setTimer: () => handle,
    clearTimer: () => {},
  })
  controller.start()
  assert.equal(unrefCalled, true, 'the scheduled handle is unref\'d')
  controller.stop()
})

test('auto-refresh: the activation run is independent of the recurring switch', async () => {
  // `refreshOnActivation` asks for one sweep at startup. It must not require the
  // owner to also accept an unbounded timer, and the sweep must not secretly
  // start one: recurring network traffic stays behind its own switch.
  const timers = clock()
  let runs = 0
  const controller = createAutoRefresh({
    enabled: false,
    runOnStartup: true,
    intervalMs: 6 * 60 * 60 * 1000,
    startupDelayMs: 5000,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  assert.equal(controller.start(), true, 'start() arms the activation run even with recurring refresh off')
  assert.equal(timers.count, 1, 'exactly one timer is armed')
  assert.equal(timers.pending.ms, 5000, 'it waits out the startup delay, not the interval')
  assert.equal(controller.status().enabled, false, 'recurring refresh stays off')
  assert.equal(controller.status().runOnStartup, true)

  timers.fire()
  await tick()
  assert.equal(runs, 1, 'the activation sweep ran once')
  assert.equal(timers.count, 0, 'no interval was armed behind it')
  assert.equal(controller.status().scheduled, false)
  assert.equal(controller.status().last.status, 'ok')
  controller.stop()
})

test('auto-refresh: a failing activation run still arms nothing and stays reported', async () => {
  const timers = clock()
  const controller = createAutoRefresh({
    enabled: false,
    runOnStartup: true,
    intervalMs: 1000,
    run: async () => { throw new Error('provider unreachable') },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  timers.fire()
  await tick()
  assert.equal(timers.count, 0, 'a failed activation run does not fall back to polling')
  assert.equal(controller.status().last.status, 'failed')
  assert.equal(controller.status().last.reason, 'provider unreachable')
  controller.stop()
})

test('auto-refresh: both switches off arms nothing', () => {
  const timers = clock()
  const controller = createAutoRefresh({
    enabled: false,
    runOnStartup: false,
    intervalMs: 1000,
    run: () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  assert.equal(controller.start(), false)
  assert.equal(timers.count, 0)
  controller.stop()
})

test('auto-refresh: enabled without the activation run still polls on the interval', () => {
  const timers = clock()
  const controller = createAutoRefresh({
    enabled: true,
    runOnStartup: false,
    intervalMs: 1000,
    startupDelayMs: 5000,
    run: () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  assert.equal(controller.start(), true)
  assert.equal(timers.pending.ms, 1000, 'no activation run means the interval is the only schedule')
  controller.stop()
})

test('auto-refresh: stop() during the activation delay prevents the sweep', async () => {
  const timers = clock()
  let runs = 0
  const controller = createAutoRefresh({
    enabled: false,
    runOnStartup: true,
    intervalMs: 1000,
    run: () => { runs += 1 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  controller.start()
  controller.stop()
  assert.equal(timers.count, 0, 'the pending activation timer is cleared')
  assert.equal(runs, 0, 'a disposed Host performs no activation traffic')
})

test('auto-refresh: a run that re-enters through refreshNow() leaves one timer, not two', async () => {
  // The activation sweep writes the provider profile, which emits
  // `loader/volatile-update` and calls `refreshNow()` from inside the run.
  // That re-entry schedules while a run is in flight; the `finally` schedules
  // again. Overwriting the handle instead of replacing it leaks a timer that
  // no `stop()` can reach and that fires beside the real one forever.
  const live = new Map()
  let handle = 0
  let reentered = false
  const controller = createAutoRefresh({
    enabled: true,
    runOnStartup: true,
    intervalMs: 6 * 60 * 60 * 1000,
    startupDelayMs: 5000,
    run: async () => {
      if (reentered) return
      reentered = true
      void controller.refreshNow()
    },
    setTimer: (fn, ms) => {
      handle += 1
      const entry = { fn, ms, handle }
      live.set(entry.handle, entry)
      return entry
    },
    clearTimer: (entry) => { live.delete(entry.handle) },
  })
  const fire = async () => {
    const due = [...live.values()][0]
    assert.notEqual(due, undefined, 'a timer is armed')
    live.delete(due.handle)
    due.fn()
    for (let i = 0; i < 4; i += 1) await tick()
  }

  controller.start()
  assert.equal(live.size, 1)
  await fire()
  assert.equal(live.size, 1, 'the re-entrant scheduling replaced the pending timer instead of orphaning it')
  assert.equal([...live.values()][0].ms, 6 * 60 * 60 * 1000, 'the surviving timer is the recurring interval')
  controller.stop()
  assert.equal(live.size, 0, 'stop() reaches the only timer that exists')
})

test('auto-refresh: repeated runs that all write do not accumulate timers', async () => {
  const live = new Map()
  let handle = 0
  let runs = 0
  const controller = createAutoRefresh({
    enabled: true,
    runOnStartup: false,
    intervalMs: 1000,
    run: async () => {
      runs += 1
      if (runs < 5) void controller.refreshNow()
    },
    setTimer: (fn, ms) => {
      handle += 1
      const entry = { fn, ms, handle }
      live.set(entry.handle, entry)
      return entry
    },
    clearTimer: (entry) => { live.delete(entry.handle) },
  })
  controller.start()
  for (let i = 0; i < 5; i += 1) {
    const due = [...live.values()][0]
    live.delete(due.handle)
    due.fn()
    for (let j = 0; j < 4; j += 1) await tick()
  }
  assert.equal(runs, 5)
  assert.equal(live.size, 1, 'five sweeps that each write still leave exactly one timer')
  controller.stop()
  assert.equal(live.size, 0)
})
