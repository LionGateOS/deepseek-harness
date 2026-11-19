import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelGuideService } from '../index.js'
import { METHODS, REMOTE_METHOD_DESCRIPTOR, actionsOf, loadClient } from './load-client.js'

test('client descriptors carry strict pass-through codecs the gateway mount accepts', async () => {
  const { contribution } = await loadClient()
  assert.equal(contribution.package, '@local/model-guide-cost-router')
  assert.deepEqual([...contribution.descriptors].map((d) => d.method), [...METHODS])
  for (const descriptor of contribution.descriptors) {
    const strict = (codec, field) => {
      assert.equal(codec.mode, 'strict', `${descriptor.method} ${field} codec must be strict`)
      assert.equal(typeof codec.typeSymbol, 'string', `${descriptor.method} ${field} typeSymbol must be a string`)
      const parsed = codec.create().parse({ probe: 1 })
      assert.deepEqual(parsed, { probe: 1 }, `${descriptor.method} ${field} parse must pass plain JSON through`)
    }
    strict(descriptor.result, 'result')
    for (const parameter of descriptor.parameters) {
      assert.equal(typeof parameter.wire, 'string' && parameter.wire.length > 0 ? 'string' : 'undefined',
        `${descriptor.method} parameter ${parameter.name} needs a wire name`)
      strict(parameter.codec, `parameter ${parameter.name}`)
    }
  }
})

test('client descriptors agree with the host service contract end to end', async () => {
  const servicePrototype = Object.getPrototypeOf(createModelGuideService({ config: {}, mergeSnapshot: () => ({}) }))
  const marker = Object.getOwnPropertyDescriptor(servicePrototype, REMOTE_METHOD_DESCRIPTOR).value
  const { contribution } = await loadClient()
  assert.deepEqual([...contribution.descriptors].map((d) => d.method), [...marker.methods].map((m) => m.method),
    'the client contribution and the host prototype must export the same methods')
  for (const descriptor of contribution.descriptors) {
    const implementation = servicePrototype[descriptor.method]
    const source = implementation.toString().match(/\(([^)]*)\)/)[1]
    const businessNames = source.split(',').map((n) => n.trim()).filter((n) => n.length > 0 && n !== 'signal')
    assert.deepEqual([...descriptor.parameters].map((p) => p.name), businessNames,
      `${descriptor.method} client parameters must match the host method signature`)
    assert.equal(descriptor.namespace, 'modelGuide')
    assert.equal(descriptor.service, 'modelGuide')
  }
})

test('the namespace is read only inside a scope that declares remote.modelGuide', async () => {
  const load = await loadClient({
    modelGuide: { async snapshot() { return { ok: true, value: {} } } },
  })
  assert.deepEqual(load.injects[0], ['remote.modelGuide', 'slots', 'locale'],
    'panels must register inside an injected scope declaring the namespace')
  // The executable stub guards throw if any entry-scope code touches
  // ctx.remote.modelGuide — passing this test at all proves the live
  // "without inject" failure cannot recur on the mounted path.
  const guide = actionsOf(load.panels, 'model-guide')
  const owners = actionsOf(load.panels, 'owner-customizations')
  assert.equal(typeof guide.load, 'function')
  assert.equal(typeof owners.loadStatuses, 'function')
})

test('a mounted namespace resolves both panels through the live service path', async () => {
  const snapshotValue = { generatedAt: '2026-10-13T00:00:00Z', providers: [] }
  const load = await loadClient({
    modelGuide: {
      async snapshot() { return { ok: true, value: snapshotValue } },
      async customizationStatus() { return { ok: true, value: { status: 'ok', entries: [] } } },
    },
  })
  const guide = actionsOf(load.panels, 'model-guide')
  await assert.deepEqual(await guide.load(), snapshotValue)
  const owners = actionsOf(load.panels, 'owner-customizations')
  await assert.deepEqual(await owners.loadStatuses(), { status: 'ok', entries: [] })
})

test('a rejected mount keeps both panels visible with a classified failure', async () => {
  const load = await loadClient({
    mountRejection: new Error('client api: generated Remote modelGuide/snapshot has no strict codec'),
  })
  assert.ok(load.panels.find((p) => p.row.key === 'model-guide'))
  assert.ok(load.panels.find((p) => p.row.key === 'owner-customizations'))
  assert.ok(load.injects.every((deps) => !deps.includes('remote.modelGuide')),
    'the failure path must not require the namespace service')
  const guide = actionsOf(load.panels, 'model-guide')
  await assert.rejects(guide.load(), (error) => {
    assert.equal(error.code, 'gateway/service-unavailable')
    assert.match(error.message, /failed to mount/)
    assert.match(error.message, /no strict codec/)
    return true
  })
})

test('namespace call failures classify as gateway/internal, not file-malformed', async () => {
  const load = await loadClient({
    modelGuide: { async customizationStatus() { throw new Error('host handler failed') } },
  })
  const owners = actionsOf(load.panels, 'owner-customizations')
  await assert.rejects(owners.loadStatuses(), (error) => {
    assert.equal(error.code, 'gateway/internal')
    assert.match(error.message, /host handler failed/)
    return true
  })
})

test('sidebar rows register before the namespace and never touch it', async () => {
  const load = await loadClient({
    modelGuide: { async snapshot() { return { ok: true, value: {} } } },
  })
  const sidebar = load.slots.filter((p) => p.slot === 'sidebar.panellist')
  assert.deepEqual(sidebar.map((p) => p.register().row.id).sort(), ['model-guide', 'owner-customizations'])
})

test('research actions are read-only at mount and run only on explicit owner interaction', async () => {
  const invoked = []
  const client = await loadClient({
    modelGuide: Object.fromEntries(METHODS.map((method) => [method, async () => {
      invoked.push(method)
      return method === 'researchStatus'
        ? { ok: true, value: { status: 'ok', models: [], researcher: {} } }
        : method === 'researchPrompt'
          ? { ok: true, value: { status: 'ok', prompt: 'PROMPT' } }
          : { ok: true, value: {} }
    }])),
  })
  // Nothing runs a model or reads unresolved data during mount: research is
  // strictly a two-step explicit flow (open preflight, then copy the prompt).
  assert.deepEqual(invoked, [], 'no research or update call may fire during apply')
  const actions = actionsOf(client.panels, 'model-guide')
  for (const method of ['researchStatus', 'researchPrompt']) {
    assert.equal(typeof actions[method], 'function', `${method} must be an available owner action`)
  }
  await actions['researchStatus']()
  await actions['researchPrompt']()
  assert.deepEqual(invoked, ['researchStatus', 'researchPrompt'],
    'the preflight read and the prompt copy are the only research calls, both owner-triggered')
})
