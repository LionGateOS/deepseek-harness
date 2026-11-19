/**
 * Client mount regression: the entry scope may only mount, the panel scope
 * must declare `remote.localModelManager`, the contribution carries exactly
 * the ten service descriptors, the sidebar registers its entry, and a mount
 * failure degrades to a readable unavailable panel instead of a blank page.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient, METHODS } from './load-client.js'

test('the panel mounts eleven descriptors and keeps the sidebar + main registration', async () => {
  const { slots, injects, contribution, disposer } = await loadClient()
  const panelSlots = slots.filter((s) => s.slot === 'main')
  assert.equal(panelSlots.length, 1)
  const sidebar = slots.filter((s) => s.slot === 'sidebar.panellist')
  assert.equal(sidebar.length, 1)
  assert.equal(sidebar[0].value.id, 'local-model-manager')
  assert.notEqual(contribution, undefined)
  const descriptors = contribution.descriptors.map((d) => d.method)
  assert.deepEqual([...descriptors].sort(), [...METHODS].sort())
  assert.deepEqual(injects[0], ['remote.localModelManager', 'slots', 'locale']) // the panel scope declares the namespace
  await disposer()
})

test('the injected panel calls resolve through the ten host methods', async () => {
  const calls = []
  const modelManager = Object.fromEntries(METHODS.map((method) => [method, async (...args) => {
    calls.push([method, ...args])
    if (method === 'snapshot') return { ok: true, value: { generatedAt: 't', endpoint: 'http://127.0.0.1:8001', server: { state: 'stopped' }, models: [], gpus: [], backends: [], launchProfiles: [], errors: [] } }
    if (method === 'planAction') return { ok: true, value: { status: 'refused', reason: `refused: ${args.join(',')}` } }
    if (method === 'confirmAction') return { ok: true, value: { status: 'ok', action: args[0] ?? 'token' } }
    if (method === 'planLaunch') return { ok: true, value: { status: 'refused', reason: `no profile: ${args[0]}` } }
    if (method === 'confirmLaunch') return { ok: true, value: { status: 'ok', profileId: args[0] } }
    if (method === 'planGpuLock') return { ok: true, value: { status: 'refused', reason: `uuid not in allowlist: ${args[0]}` } }
    if (method === 'confirmGpuLock') return { ok: true, value: { status: 'refused', reason: 'expired' } }
    if (method === 'planGpuReservation') return { ok: true, value: { status: 'planned', confirmToken: 'tok-res', impact: 'will change', disclosure: 'note', desired: args[0]?.desired } }
    if (method === 'confirmGpuReservation') return { ok: true, value: { status: 'ok', message: 'updated', persisted: true } }
    if (method === 'addDiscoveryDir') return { ok: true, value: { status: 'refused', reason: `path rejected: ${args[0]}` } }
    return { ok: true, value: { errors: [] } }
  }]))
  const { slots } = await loadClient({ modelManager })
  const panel = slots.find((s) => s.slot === 'main').value
  const injected = panel.inject()
  const snap = await injected.load()
  assert.equal(snap.endpoint, 'http://127.0.0.1:8001')
  const refusal = await injected.planAction('start', { modelKey: 'a' })
  assert.equal(refusal.status, 'refused')
  assert.equal(calls[1][1], 'start')
  const outcome = await injected.confirmAction('tok', { acknowledgeInterruption: true })
  assert.equal(outcome.status, 'ok')
  const launchPlan = await injected.planLaunch('prof-1')
  assert.equal(launchPlan.status, 'refused')
  const launchOutcome = await injected.confirmLaunch('tok-launch')
  assert.equal(launchOutcome.status, 'ok')
  const lockPlan = await injected.planGpuLock('GPU-UNKNOWN', 'locked')
  assert.equal(lockPlan.status, 'refused')
  const lockConfirm = await injected.confirmGpuLock('stale-tok')
  assert.equal(lockConfirm.status, 'refused')
  const resPlan = await injected.planGpuReservation({ uuid: 'gpu-1', desired: 'reserved' })
  assert.equal(resPlan.status, 'planned')
  const resConfirm = await injected.confirmGpuReservation('tok-res')
  assert.equal(resConfirm.status, 'ok')
  const addResult = await injected.addDiscoveryDir('/some/path')
  assert.equal(addResult.status, 'refused')
})

test('a failed mount never blanks the workspace: the unavailable panel still renders', async () => {
  const { slots, injects } = await loadClient({ mountRejection: new Error('gateway down') })
  assert.equal(slots.filter((s) => s.slot === 'main').length, 1)
  // The failing path registers the panel without any namespace scope...
  assert.equal(injects.length, 0)
  const panel = slots.find((s) => s.slot === 'main').value
  const injected = panel.inject()
  // ...and calls fold into readable refusal envelopes, not rejections.
  const refusal = await injected.planAction('stop', {})
  assert.equal(refusal.status, 'refused')
  assert.match(refusal.reason, /service-unavailable|failed to mount/)
  await assert.rejects(injected.load())
})