import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogEntry, classifyReasoningChange, describeReasoningSet, diffCatalog, modelKey, validateCatalog } from '../core/catalog.js'

const model = (id, extra = {}) => ({ id, name: id, ...extra })

test('reasoning sets are described verbatim, never mapped onto a generic ladder', () => {
  assert.equal(describeReasoningSet(undefined), 'no reasoning')
  assert.equal(describeReasoningSet({ efforts: [] }), 'no reasoning')
  assert.equal(describeReasoningSet({ efforts: [{ id: 'off', name: 'Off' }, { id: 'on', name: 'On' }], defaultEffort: 'on' }), 'On/Off switch (default on)')
  assert.equal(describeReasoningSet({ efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'xhigh', name: 'XHigh' }], defaultEffort: 'xhigh' }), 'low/medium/xhigh (default xhigh)')
})

test('catalog diff isolates added, removed, and changed facts with exact keys', () => {
  const previous = {
    version: 1,
    providers: [
      { id: 'ollama', name: 'Ollama Cloud', models: [model('a', { contextWindow: 1000 }), model('b')] },
      { id: 'qwen-local', name: 'Qwen Local', models: [model('l1')] },
    ],
  }
  const fresh = [
    { id: 'ollama', name: 'Ollama Cloud', models: [model('a', { contextWindow: 2000 }), model('b'), model('c')] },
    { id: 'qwen-local', name: 'Qwen Local', models: [model('l2'), model('l1')] },
  ]
  const diff = diffCatalog(previous, fresh)
  assert.deepEqual(diff.added, ['ollama/c', 'qwen-local/l2'])
  assert.deepEqual(diff.removed, [])
  const contextChange = diff.changed.find((item) => item.key === 'ollama/a')
  assert.deepEqual(contextChange, { key: 'ollama/a', field: 'contextWindow', from: '1000', to: '2000' })
})

test('removed is only claimed when the provider listed successfully this run', () => {
  const previous = { version: 1, providers: [{ id: 'ollama', name: 'Ollama Cloud', models: [model('a')] }] }
  const diff = diffCatalog(previous, [{ id: 'ollama', name: 'Ollama Cloud', error: 'timed out', models: [] }])
  assert.deepEqual(diff.removed, [])
  assert.deepEqual(diff.added, [])
})

test('a reasoning-set change is flagged as metadata possibly stale, never as truth to apply', () => {
  const change = classifyReasoningChange('low/high (default high)', 'off/on (default off)')
  assert.equal(change.kind, 'changed')
  assert.match(change.note, /verify against vendor evidence/)
  assert.equal(classifyReasoningChange('low/low', 'low/low').kind, 'stable')
})

test('catalog entries keep a bounded history trail and preserve the observation date', () => {
  const previous = {
    id: 'a',
    name: 'a',
    contextWindow: 1000,
    reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    evidence: { source: 's', verifiedAt: '2026-01-01' },
    history: Array.from({ length: 7 }, (_, index) => ({ verifiedAt: String(index) })),
  }
  const fresh = model('a', { contextWindow: 2000, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } })
  const { entry, reasoningChange } = catalogEntry(previous, fresh, '2026-06-01', { id: 'p', name: 'p' }, 5)
  assert.equal(entry.evidence.verifiedAt, '2026-06-01')
  assert.equal(entry.history.length, 5)
  assert.equal(entry.history[0].verifiedAt, '2026-01-01')
  assert.equal(reasoningChange.kind, 'changed')
})

test('catalog validation fails closed on malformed files', () => {
  assert.equal(validateCatalog('nope').ok, false)
  assert.equal(validateCatalog({ version: 2 }).ok, false)
  assert.equal(validateCatalog({ version: 1, providers: 'nope' }).ok, false)
  assert.equal(validateCatalog({ version: 1, providers: [{ id: 1, name: 'x', models: [] }] }).ok, false)
  assert.equal(validateCatalog({ version: 1, providers: [{ id: 'p', name: 'p', models: [model('a')] }] }).ok, true)
})

test('model keys join provider and id without guessing separators', () => {
  assert.equal(modelKey('ollama', 'glm-5.3-flash'), 'ollama/glm-5.3-flash')
  assert.equal(modelKey('qwen-local', '/models/q8.gguf'), 'qwen-local//models/q8.gguf')
})