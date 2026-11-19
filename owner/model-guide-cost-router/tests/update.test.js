import test from 'node:test'
import assert from 'node:assert/strict'
import { applyUpdate, snapshotRecord } from '../core/update.js'

const alwaysFresh = () => 'fresh'

const owner = () => ({
  routingRule: 'rule',
  models: {
    'ollama/glm': { localVsCloud: 'cloud', nativeReasoningDefault: 'Max', recommendedRoutine: 'Medium', pricing: { inputPerMTok: 1, outputPerMTok: 2, verifiedAt: '2026-10-13' } },
    'ollama/old-price': { localVsCloud: 'cloud', pricing: { inputPerMTok: 1, outputPerMTok: 2, verifiedAt: '2026-01-01' } },
  },
})

const discovered = () => [
  { id: 'ollama', name: 'Ollama Cloud', models: [
    { id: 'glm', name: 'GLM', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
    { id: 'new', name: 'New' },
  ] },
]

test('update records added models and never mutates owner curation', () => {
  const ownerData = owner()
  const frozen = JSON.parse(JSON.stringify(ownerData))
  const { report, catalog } = applyUpdate({
    previousRaw: undefined,
    discovered: discovered(),
    ownerData,
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.deepEqual(report.added, ['ollama/glm', 'ollama/new'])
  assert.deepEqual(ownerData, frozen)
  assert.equal(catalog.providers[0].models.length, 2)
})

test('an update never overwrites an owner reasoning recommendation with discovery facts', () => {
  const ownerData = owner()
  const { catalog } = applyUpdate({
    previousRaw: undefined,
    discovered: discovered(),
    ownerData,
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  // The catalog stores provider-reported facts only.
  const glm = catalog.providers[0].models.find((model) => model.id === 'glm')
  assert.equal(glm.reasoning.defaultEffort, 'high')
  // Owner data still holds the recommendation, untouched.
  assert.equal(ownerData.models['ollama/glm'].recommendedRoutine, 'Medium')
})

test('reasoning-set changes and owner native-default mismatches are named for review', () => {
  const previous = {
    version: 1,
    providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'glm', name: 'GLM', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'on', name: 'On' }], defaultEffort: 'on' }, evidence: { source: 's', verifiedAt: 'old' } }] }],
  }
  const { report } = applyUpdate({
    previousRaw: previous,
    discovered: discovered(),
    ownerData: owner(),
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(report.reasoningChanges.length, 1)
  assert.match(report.reasoningChanges[0].note, /verify against vendor evidence/)
  assert.equal(report.ownerNativeMismatches[0].ownerNativeDefault, 'Max')
  assert.equal(report.ownerNativeMismatches[0].providerDefault, 'high')
})

test('a failed provider listing keeps its previous models marked not re-verified', () => {
  const previous = { version: 1, providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [{ id: 'glm', name: 'GLM', evidence: { source: 's', verifiedAt: 'old' } }] }] }
  const { catalog, report } = applyUpdate({
    previousRaw: previous,
    discovered: [{ id: 'ollama', name: 'Ollama Cloud', error: 'timed out', models: [] }],
    ownerData: owner(),
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(report.notes.some((note) => note.kind === 'provider-error'), true)
  const carried = catalog.providers[0].models
  assert.equal(carried.length, 1)
  assert.match(carried[0].evidence.note, /not re-verified/)
})

test('malformed or missing catalogs are named, never silently ignored', () => {
  const malformed = applyUpdate({
    previousRaw: { version: 9 },
    discovered: discovered(),
    ownerData: owner(),
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(malformed.catalogWasMalformed, true)
  assert.equal(malformed.report.notes.some((note) => note.kind === 'catalog-malformed'), true)
  const first = applyUpdate({
    previousRaw: undefined,
    discovered: discovered(),
    ownerData: owner(),
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(first.report.notes.some((note) => note.kind === 'first-update'), true)
})

test('stale and fresh prices are judged by the verified date only, and snapshots stay evidence-only', () => {
  const staleJudge = (rates) => rates.verifiedAt === '2026-01-01' ? 'stale' : 'fresh'
  const { report } = applyUpdate({
    previousRaw: undefined,
    discovered: discovered(),
    ownerData: owner(),
    freshness: staleJudge,
    snapshots: [snapshotRecord({ url: 'https://ollama.com/pricing', status: 'fetched', fetchedAt: 'now', bytes: 10, sha256: 'abc' })],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(report.pricingSnapshots.length, 1)
  // A snapshot carries no parsed rate values.
  assert.deepEqual(Object.keys(report.pricingSnapshots[0]).sort(), ['bytes', 'fetchedAt', 'ok', 'sha256', 'url'])
  assert.equal(report.stalePrices.some((item) => item.key === 'ollama/old-price' && item.state === 'stale'), true)
  assert.equal(report.notes.some((note) => note.kind === 'pricing-snapshot'), true)
})

test('no snapshot attempt is reported honestly, not treated as verification', () => {
  const { report } = applyUpdate({
    previousRaw: undefined,
    discovered: discovered(),
    ownerData: owner(),
    freshness: alwaysFresh,
    snapshots: [],
    now: 'now',
    maxHistory: 5,
  })
  assert.equal(report.notes.some((note) => note.kind === 'no-pricing-snapshot'), true)
})