/**
 * Client-half loader shared by the mount and render tests. It materializes
 * the client through the same seam the page uses (`window.__ModuleLoader__.load`)
 * and asserts the entry contract: inject deps, dictionaries, sidebar entry,
 * main panel contribution, and the four SRC-plane descriptors.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CLIENT_SOURCE = readFileSync(path.join(HERE, '../client.js'), 'utf8')
export const METHODS = ['snapshot', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'planStrataAction', 'confirmStrataAction', 'planGpuLock', 'confirmGpuLock', 'planGpuReservation', 'confirmGpuReservation', 'addDiscoveryDir', 'planAdoptInstance', 'confirmAdoptInstance']

/**
 * Materialize the client half and run its async apply against a recording
 * stub context.
 * @param {{modelManager?: object, mountRejection?: unknown}} [options].
 * @returns {Promise<object>} { panels, sidebar, injects, disposer }.
 */
export async function loadClient(options = {}) {
  // The stub service returns Typert-style { ok, value } results, matching what
  // RemoteNamespaceService.invoke delivers to svc[method]() callers in production.
  const svc = options.modelManager ?? Object.fromEntries(METHODS.map((method) => [method, async () => ({ ok: true, value: {} })]))
  let definition
  const window = { __ModuleLoader__: { load(d) { definition = d } } }
  const requireStub = (name) => {
    if (name === 'react') return options.react ?? { createElement: () => null, Component: class Component {} }
    throw new Error(`client half required an unexpected module: ${name}`)
  }
  vm.runInNewContext(CLIENT_SOURCE, { window, require: requireStub, setTimeout, clearTimeout }, { filename: 'client.js' })
  assert.ok(definition, 'client.js must register through window.__ModuleLoader__.load')
  assert.equal(definition.id, '@local/local-model-manager')
  const plugin = definition.factory(requireStub)
  assert.deepEqual([...plugin.inject], ['remote', 'slots', 'locale'])

  const slots = []
  const injects = []
  let contribution
  const effect = (fn) => fn()
  const entryRemote = {
    $mount(captured) {
      contribution = captured
      if (options.mountRejection !== undefined) return Promise.reject(options.mountRejection)
      return Promise.resolve(() => {})
    },
  }
  const localeStub = {
    register: (ns, dict) => {
      assert.equal(ns, 'localModelManager.page')
      assert.ok(dict.en && dict.zh)
      return () => {}
    },
    bind: (ns) => (key) => `${ns}#${key}`,
  }
  const inject = (deps, callback) => {
    injects.push([...deps])
    const scopeRemote = new Proxy({}, {
      get(_t, prop) {
        if (deps.includes(`remote.${String(prop)}`)) return svc
        throw new Error(`remote.${String(prop)} not declared (deps: [${deps.join(', ')}])`)
      },
    })
    callback({ locale: localeStub, slots: slotsStub, remote: scopeRemote })
    return { async dispose() {} }
  }
  const slotsStub = {
    inject(slotName, register) { slots.push({ slot: slotName, value: register() }) },
    register(row, component) { row.component = component; return row },
  }
  const ctx = {
    effect,
    remote: entryRemote,
    locale: localeStub,
    slots: slotsStub,
    inject,
  }
  const disposer = await plugin.apply(ctx)
  return { slots, injects, contribution, disposer, localeStub }
}