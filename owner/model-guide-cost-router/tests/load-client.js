/**
 * Shipped-client test loader shared by the mount and render test files. It
 * materializes the client half through the same seam the page uses
 * (`window.__ModuleLoader__.load`) against a recording stub context whose
 * Remote service enforces the inject contract: the entry scope exposes only
 * `$mount`, and a `remote.<namespace>` read succeeds only in a `ctx.inject`
 * scope that declares it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

import { createModelGuideService } from '../index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CLIENT_SOURCE = readFileSync(path.join(HERE, '../client.js'), 'utf8')
export const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
export const METHODS = [
  'snapshot',
  'guidanceText',
  'actualCost',
  'recommendModels',
  'updateModelsAndPricing',
  'lastUpdateReport',
  'generatedGuide',
  'routingGuide',
  'customizationStatus',
  'researchStatus',
  'researchPrompt',
  'previewResearchResults',
  'applyResearchResults',
  'engineCatalog',
  'updateEngines',
  'refreshModelMetadata',
  'autoRefreshStatus',
  'syncRouteCapabilities',
]

/**
 * Materialize the shipped client half and run its async apply.
 * @param {object} [options] { modelGuide, mountRejection, react } overrides;
 *   `react` replaces the inert `createElement: () => null` React stub when a
 *   test renders real components.
 * @returns {Promise<object>} { panels, slots, injects, contribution, disposer }.
 */
export async function loadClient({ modelGuide, mountRejection, react } = {}) {
  // The mounted path always reads the namespace in its injected scope, so a
  // contract-test run without explicit overrides still needs it available.
  modelGuide ??= Object.fromEntries(METHODS.map((method) => [method, async () => ({ ok: true, value: {} })]))
  let definition
  const window = { __ModuleLoader__: { load(d) { definition = d } } }
  const requireStub = (name) => {
    // The inert default still satisfies `PanelErrorBoundary extends
    // React.Component`; render tests pass a real mini-React instead.
    if (name === 'react') return react ?? { createElement: () => null, Component: class Component {} }
    throw new Error(`client half required an unexpected module: ${name}`)
  }
  vm.runInNewContext(CLIENT_SOURCE, { window, require: requireStub, setTimeout, clearTimeout }, { filename: 'client.js' })
  assert.ok(definition, 'client.js must register through window.__ModuleLoader__.load')
  const plugin = definition.factory(requireStub)
  assert.deepEqual([...plugin.inject], ['remote', 'slots', 'locale'],
    'the entry plugin must declare exactly its mounting dependencies')

  let contribution
  const injects = []
  const slots = []
  const effect = (fn) => fn()

  /** Entry-scope Remote: `$mount` plus a guard rejecting namespace reads. */
  const entryRemote = {
    $mount(captured) {
      contribution = captured
      if (mountRejection !== undefined) return Promise.reject(mountRejection)
      return Promise.resolve(() => {})
    },
  }

  const localeStub = {
    register: () => () => {},
    bind: () => (key) => key,
  }
  const inject = (deps, callback) => {
    injects.push([...deps])
    const scopeRemote = new Proxy({}, {
      get(_target, prop) {
        if (deps.includes(`remote.${String(prop)}`)) {
          if (modelGuide === undefined) throw new Error(`stub service remote.${String(prop)} unavailable`)
          return modelGuide
        }
        throw new Error(`cannot get property 'remote.${String(prop)}' without inject `
          + `(scope declared only [${deps.join(', ')}])`)
      },
    })
    callback({ effect, locale: localeStub, slots: slotsStub, remote: scopeRemote })
    return { async dispose() {} }
  }
  const slotsStub = {
    inject(slot, register) { slots.push({ slot, register }) },
    register(row, component) { return { row, component } },
  }

  const ctx = {
    effect,
    locale: localeStub,
    slots: slotsStub,
    remote: entryRemote,
    inject,
  }
  const disposer = await plugin.apply(ctx)
  assert.equal(typeof disposer, 'function', 'apply must return a joint disposer')
  return {
    panels: slots.filter((p) => p.slot === 'main').map((p) => ({ ...p, ...p.register() })),
    slots,
    injects,
    contribution,
    disposer,
    labels: plugin.labels,
  }
}

/** Run one captured panel registration and return its injected actions. */
export function actionsOf(panels, key) {
  const panel = panels.find((p) => p.row.key === key)
  assert.ok(panel, `panel ${key} must be registered`)
  return panel.row.inject()
}

/** Re-export for existing imports in this directory. */
export { createModelGuideService }