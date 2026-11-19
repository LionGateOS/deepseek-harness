/**
 * Provider-confirmed capability transfer: the route profile may only gain facts
 * the provider publishes, an owner-recorded value is never overwritten, and a
 * field nobody published stays absent.
 *
 * The provider rows below are the live `/v1/models` records captured on
 * 2026-11-07, kept verbatim so the assertions describe the real payload.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { factsFromModelsListing, planRouteCapabilities } from '../core/route-capabilities.js'
import { createModelGuideService } from '../index.js'

/** One provider row, in the enriched shape `/v1/models` publishes. */
const row = (slug, extra = {}) => ({
  slug,
  display_name: slug,
  context_window: 1048576,
  max_context_window: 1048576,
  input_modalities: ['text', 'image'],
  supported_reasoning_levels: [
    { effort: 'none', description: 'Disable thinking' },
    { effort: 'low', description: 'low reasoning effort' },
    { effort: 'high', description: 'high reasoning effort' },
    { effort: 'max', description: 'max reasoning effort' },
  ],
  default_reasoning_level: 'max',
  visibility: 'list',
  supported_in_api: true,
  ...extra,
})

const LISTING = {
  data: [{ id: 'kimi-k3.1-pro' }, { id: 'beam' }, { id: 'clef:27b' }],
  models: [
    row('kimi-k3.1-pro'),
    row('beam', {
      input_modalities: ['text'],
      supported_reasoning_levels: [
        { effort: 'low', description: 'low reasoning effort' },
        { effort: 'medium', description: 'medium reasoning effort' },
        { effort: 'high', description: 'high reasoning effort' },
        { effort: 'xhigh', description: 'xhigh reasoning effort' },
        { effort: 'max', description: 'max reasoning effort' },
      ],
    }),
    // The real clef:27b row: sizes and modalities published, no levels at all.
    row('clef:27b', {
      context_window: 65536,
      max_context_window: 65536,
      supported_reasoning_levels: [],
      default_reasoning_level: null,
      visibility: 'hide',
      supported_in_api: false,
    }),
  ],
}

// ---------------------------------------------------------------------------
// Reading the provider's own listing.
// ---------------------------------------------------------------------------

test('listing: the enriched sibling array is the source, not the id-only data array', () => {
  const { models } = factsFromModelsListing(LISTING)
  assert.equal(models.size, 3)
  assert.deepEqual(models.get('kimi-k3.1-pro'), {
    contextWindow: 1048576,
    input: ['text', 'image'],
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    defaultReasoningEffort: 'max',
  })
})

test('listing: the provider spelling "none" becomes the config key "off" carrying "none"', () => {
  const efforts = factsFromModelsListing(LISTING).models.get('kimi-k3.1-pro').reasoningEfforts
  assert.equal(efforts['off'], 'none', 'the request must send what the provider understands')
  assert.equal(efforts['none'], undefined, 'a dict keyed by the wire value loses the Off rung')
})

test('listing: empty reasoning levels yield no reasoning fact while sizes still transfer', () => {
  const facts = factsFromModelsListing(LISTING).models.get('clef:27b')
  assert.equal(facts.reasoningEfforts, undefined, 'an empty levels list is not a reasoning declaration')
  assert.equal(facts.defaultReasoningEffort, undefined)
  assert.equal(facts.contextWindow, 65536)
  assert.deepEqual(facts.input, ['text', 'image'])
})

test('listing: a row that publishes nothing yields no facts at all', () => {
  const bare = { models: [{ slug: 'bare', context_window: null, input_modalities: null }] }
  assert.deepEqual(factsFromModelsListing(bare).models.get('bare'), {})
})

test('listing: a levels list without any thinking rung declares no reasoning', () => {
  const only = { models: [row('idle', { supported_reasoning_levels: [{ effort: 'none' }] })] }
  assert.equal(factsFromModelsListing(only).models.get('idle').reasoningEfforts, undefined)
})

// ---------------------------------------------------------------------------
// Planning the additive fill.
// ---------------------------------------------------------------------------

const routeOf = (models) => ({ displayName: 'Ollama Cloud', api: 'openai-completions', models })

test('plan: an id-and-name-only entry gains context, input, levels and the default', () => {
  const plan = planRouteCapabilities(routeOf([{ id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' }]), factsFromModelsListing(LISTING).models)
  assert.deepEqual(plan.changed, [{ id: 'kimi-k3.1-pro', fields: ['contextWindow', 'input', 'reasoningEfforts', 'defaultReasoningEffort'] }])
  assert.deepEqual(plan.next.models[0], {
    id: 'kimi-k3.1-pro',
    name: 'kimi-k3.1-pro',
    contextWindow: 1048576,
    input: ['text', 'image'],
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    defaultReasoningEffort: 'max',
  })
  assert.equal(plan.conflicts.length, 0)
})

test('plan: a recorded value is reported as a conflict and never replaced', () => {
  const configured = {
    id: 'kimi-k3.1-pro',
    contextWindow: 262144,
    input: ['text'],
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultReasoningEffort: 'high',
  }
  const plan = planRouteCapabilities(routeOf([configured]), factsFromModelsListing(LISTING).models)
  assert.equal(plan.changed.length, 0, 'nothing absent, so nothing is written')
  assert.deepEqual(plan.conflicts.map((row) => row.field), ['contextWindow', 'input'])
  assert.deepEqual(plan.next.models[0], configured, 'the owner entry is carried through unchanged')
})

test('plan: an explicit reasoningEfforts: false stays false and is reported', () => {
  const configured = { id: 'kimi-k3.1-pro', reasoningEfforts: false }
  const plan = planRouteCapabilities(routeOf([configured]), factsFromModelsListing(LISTING).models)
  assert.equal(plan.next.models[0].reasoningEfforts, false)
  assert.equal(plan.next.models[0].defaultReasoningEffort, undefined, 'a non-reasoning entry gets no default')
  assert.deepEqual(plan.conflicts.map((row) => row.field), ['reasoningEfforts'])
  assert.equal(plan.changed.length, 1, 'context and input were still absent')
})

test('plan: a model the provider does not publish is reported, not invented', () => {
  const plan = planRouteCapabilities(routeOf([{ id: 'unknown-model' }]), factsFromModelsListing(LISTING).models)
  assert.deepEqual(plan.unknown, ['unknown-model'])
  assert.equal(plan.next.models[0].contextWindow, undefined)
  assert.equal(plan.changed.length, 0)
})

test('plan: a default the offered levels do not include is refused, not declared', () => {
  const facts = new Map([['odd', { reasoningEfforts: { low: 'low' }, defaultReasoningEffort: 'max' }]])
  const plan = planRouteCapabilities(routeOf([{ id: 'odd' }]), facts)
  assert.equal(plan.next.models[0].defaultReasoningEffort, undefined)
  assert.deepEqual(plan.refused.map((entry) => entry.field), ['defaultReasoningEffort'])
  // The levels themselves are still a usable declaration.
  assert.deepEqual(plan.next.models[0].reasoningEfforts, { low: 'low' })
})

test('plan: applying the plan to its own result is a no-op', () => {
  const models = factsFromModelsListing(LISTING).models
  const first = planRouteCapabilities(routeOf([
    { id: 'kimi-k3.1-pro' },
    { id: 'beam' },
    { id: 'clef:27b' },
  ]), models)
  const second = planRouteCapabilities(first.next, models)
  assert.equal(second.changed.length, 0)
  assert.deepEqual(second.next, first.next)
  assert.equal(second.conflicts.length, 0)
})

test('listing: the same rows also report which models the API serves', () => {
  const { inventory } = factsFromModelsListing(LISTING)
  assert.deepEqual(inventory.map((row) => [row.id, row.publishable]), [
    ['kimi-k3.1-pro', true],
    ['beam', true],
    ['clef:27b', false],
  ])
})

test('listing: a missing display name falls back to the id, never an empty label', () => {
  const { inventory } = factsFromModelsListing({ models: [{ slug: 'plain', display_name: '  ' }] })
  assert.equal(inventory[0].name, 'plain')
})

// ---------------------------------------------------------------------------
// Adopting a model the provider publishes but the route does not declare.
// ---------------------------------------------------------------------------

test('adopt: a newly published model is appended with its own capabilities', () => {
  const facts = factsFromModelsListing(LISTING)
  const plan = planRouteCapabilities(routeOf([{ id: 'kimi-k3.1-pro' }]), facts.models, facts.inventory)
  assert.deepEqual(plan.adopted, [{
    id: 'beam',
    name: 'beam',
    fields: ['contextWindow', 'input', 'reasoningEfforts', 'defaultReasoningEffort'],
  }])
  assert.equal(plan.next.models.length, 2)
  assert.equal(plan.next.models[0].id, 'kimi-k3.1-pro', 'an existing row keeps its position')
  assert.equal(plan.next.models[1].id, 'beam', 'the new row is appended, never inserted')
  assert.equal(plan.next.models[1].contextWindow, 1048576)
  assert.deepEqual(plan.next.models[1].input, ['text'])
})

test('adopt: a model the provider does not serve through its API is withheld, not added', () => {
  const facts = factsFromModelsListing(LISTING)
  const plan = planRouteCapabilities(routeOf([{ id: 'kimi-k3.1-pro' }, { id: 'beam' }]), facts.models, facts.inventory)
  assert.equal(plan.adopted.length, 0)
  assert.deepEqual(plan.withheld, ['clef:27b'], 'hidden models are named, not silently dropped')
  assert.equal(plan.next.models.some((entry) => entry.id === 'clef:27b'), false)
})

test('adopt: an already-declared model is never duplicated', () => {
  const facts = factsFromModelsListing(LISTING)
  const plan = planRouteCapabilities(routeOf(LISTING.models.map((entry) => ({ id: entry.slug }))), facts.models, facts.inventory)
  assert.equal(plan.adopted.length, 0)
  assert.equal(plan.next.models.length, LISTING.models.length)
})

test('adopt: the second sweep adopts nothing and writes nothing', () => {
  const facts = factsFromModelsListing(LISTING)
  const first = planRouteCapabilities(routeOf([{ id: 'kimi-k3.1-pro' }]), facts.models, facts.inventory)
  const second = planRouteCapabilities(first.next, facts.models, facts.inventory)
  assert.deepEqual(second.adopted, [])
  assert.equal(second.changed.length, 0)
  assert.deepEqual(second.next, first.next)
})

test('adopt: without an inventory the plan only fills declared rows', () => {
  const facts = factsFromModelsListing(LISTING)
  const plan = planRouteCapabilities(routeOf([{ id: 'kimi-k3.1-pro' }]), facts.models)
  assert.deepEqual(plan.adopted, [])
  assert.equal(plan.next.models.length, 1)
})

// ---------------------------------------------------------------------------
// The service surface.
// ---------------------------------------------------------------------------

const config = {
  ownerMetadataPath: '/x/owner-model-guidance.json',
  catalogPath: '/x/c.json',
  guideGeneratedPath: '/x/g.md',
  engineCatalogPath: '/x/e.json',
  maxPriceAgeDays: 90,
  providerQueryTimeoutMs: 1000,
  providerCacheMs: 60_000,
  fetchTimeoutMs: 1000,
  maxCatalogHistory: 5,
  maxEngineCheckAgeDays: 7,
  pricingProviderId: 'ollama',
  ollamaBaseUrl: 'https://ollama.com',
  metadataEnrichment: true,
  autoRefresh: false,
  autoRefreshHours: 6,
  refreshOnActivation: true,
}

/**
 * A service over one provider route, with the editor replaced by a recorder so
 * the test asserts the write it would have performed.
 * @param {object} route the configured provider route.
 * @param {object} [options]
 */
const serviceOver = (route, options = {}) => {
  const written = []
  const entry = { id: 'include/llm-pi-ai', options: { id: 'llm-pi-ai', config: { providers: { ollama: route } } } }
  const editor = {
    entries: () => (options.noEntry === true ? [] : [entry]),
    edit: async (target, change) => { written.push({ target, next: change({ providers: { ollama: route } }) }) },
  }
  const state = {
    config,
    planRouteCapabilities,
    readOwnerMetadata: async () => ({ status: 'ok', data: {} }),
    fetchJson: async (url) => {
      if (url.endsWith('/v1/models')) return { status: 'ok', value: LISTING }
      return { status: 'failed', error: 'unexpected url' }
    },
    editor: () => (options.noEditor === true ? undefined : editor),
    entry(providerId) {
      const found = this.editor()?.entries().find((candidate) => candidate.options?.id === 'llm-pi-ai'
        && Object.hasOwn(candidate.options?.config?.providers ?? {}, providerId))
      return found
    },
    entryRoute(target, providerId) {
      return target?.options?.config?.providers?.[providerId]
    },
    async applyRouteConfig(target, providerId, facts, inventory) {
      await editor.edit(target, (current) => {
        const planned = planRouteCapabilities(current.providers[providerId], facts, inventory)
        return { ...current, providers: { ...current.providers, [providerId]: planned.next } }
      })
      return 'ok'
    },
  }
  return { service: createModelGuideService(state), written }
}

test('service: without apply the plan is returned and nothing is written', async () => {
  const { service, written } = serviceOver({ models: [{ id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' }] })
  const report = await service.syncRouteCapabilities(undefined)
  assert.equal(report.status, 'planned')
  assert.deepEqual(report.changed, [{ id: 'kimi-k3.1-pro', fields: ['contextWindow', 'input', 'reasoningEfforts', 'defaultReasoningEffort'] }])
  assert.equal(written.length, 0)
})

test('service: apply writes the additive route through the editor', async () => {
  const { service, written } = serviceOver({ displayName: 'Ollama Cloud', models: [{ id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' }] })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'updated')
  assert.equal(written.length, 1)
  const writtenRoute = written[0].next.providers['ollama']
  assert.equal(writtenRoute.displayName, 'Ollama Cloud', 'every other member of the route survives')
  assert.equal(writtenRoute.models[0].contextWindow, 1048576)
})

test('service: a second sweep writes nothing', async () => {
  const route = { models: [{ id: 'kimi-k3.1-pro' }] }
  const first = serviceOver(route)
  await first.service.syncRouteCapabilities({ apply: true })
  const filled = first.written[0].next.providers['ollama']
  const second = serviceOver(filled)
  const report = await second.service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'unchanged')
  assert.equal(second.written.length, 0)
})

test('service: a newly published model is adopted and written through the editor', async () => {
  const { service, written } = serviceOver({ displayName: 'Ollama Cloud', models: [{ id: 'kimi-k3.1-pro' }] })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'updated')
  assert.deepEqual(report.adopted.map((row) => row.id), ['beam'])
  assert.deepEqual(report.withheld, ['clef:27b'])
  assert.equal(written.length, 1)
  const ids = written[0].next.providers['ollama'].models.map((row) => row.id)
  assert.deepEqual(ids, ['kimi-k3.1-pro', 'beam'], 'the existing row leads, the new one follows')
})

test('service: a hidden model is never written into the route', async () => {
  const { service, written } = serviceOver({ models: [{ id: 'kimi-k3.1-pro' }, { id: 'beam' }] })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.deepEqual(report.adopted, [])
  assert.deepEqual(report.withheld, ['clef:27b'])
  assert.equal(written.length, 1, 'the declared rows still receive their own capabilities')
  const ids = written[0].next.providers['ollama'].models.map((row) => row.id)
  assert.equal(ids.includes('clef:27b'), false, 'a hidden model never becomes selectable')
})

test('service: adoption is idempotent across a second sweep', async () => {
  const first = serviceOver({ models: [{ id: 'kimi-k3.1-pro' }] })
  await first.service.syncRouteCapabilities({ apply: true })
  const adopted = first.written[0].next.providers['ollama']
  const second = serviceOver(adopted)
  const report = await second.service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'unchanged')
  assert.deepEqual(report.adopted, [])
  assert.equal(second.written.length, 0, 'the second sweep performs no write at all')
})

test('service: an unreachable listing adopts nothing', async () => {
  const { service, written } = serviceOver({ models: [] })
  service.state.fetchJson = async () => ({ status: 'failed', error: 'ENOTFOUND' })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'failed')
  assert.deepEqual(report.adopted ?? [], [])
  assert.equal(written.length, 0)
})

test('service: a deployment without a configuration editor reports why', async () => {
  const { service } = serviceOver({ models: [] }, { noEditor: true })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'unavailable')
  assert.match(report.reason, /no configuration editor/)
})

test('service: an unconfigured provider route is named, not guessed', async () => {
  const { service } = serviceOver({ models: [] }, { noEntry: true })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'unavailable')
  assert.match(report.reason, /no provider route named "ollama"/)
})

test('service: an unreachable listing fails closed and writes nothing', async () => {
  const { service, written } = serviceOver({ models: [{ id: 'kimi-k3.1-pro' }] })
  service.state.fetchJson = async () => ({ status: 'failed', error: 'EAI_AGAIN offline' })
  const report = await service.syncRouteCapabilities({ apply: true })
  assert.equal(report.status, 'failed')
  assert.match(report.reason, /EAI_AGAIN offline/)
  assert.equal(written.length, 0)
})
