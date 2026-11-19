import test from 'node:test'
import assert from 'node:assert/strict'
import { guidanceText } from '../core/guidance-text.js'

const row = (extra = {}) => ({
  provider: 'ollama',
  id: 'glm-5.3-flash',
  name: 'GLM-5.3 Flash',
  localVsCloud: 'cloud',
  needsReview: false,
  context: { providerReported: 1048576 },
  modalities: { owner: ['text', 'image'] },
  toolSupport: true,
  reasoning: {
    providerEfforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
    providerDefault: 'max',
    ownerModes: ['Low', 'High', 'Max'],
    ownerNativeDefault: 'Max',
    recommendedRoutine: 'High',
    recommendedHeavy: 'Max',
  },
  pricing: { inputPerMTok: 0.15, cachedInputPerMTok: 0.03, outputPerMTok: 0.5, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-13', freshness: 'fresh' },
  strengths: ['agentic coding', 'long-context work'],
  avoid: ['not a reason to prefer over capable cheaper locals'],
  evidence: 'Ollama Cloud metadata reasoning audit 2026-10-13',
  ...extra,
})

test('copy-for-prompt output is deterministic across calls and key order', () => {
  const first = guidanceText(row(), 'Use the least expensive capable model.')
  const second = guidanceText({
    evidence: 'Ollama Cloud metadata reasoning audit 2026-10-13',
    avoid: ['not a reason to prefer over capable cheaper locals'],
    strengths: ['agentic coding', 'long-context work'],
    pricing: { freshness: 'fresh', verifiedAt: '2026-10-13', source: 'https://ollama.com/pricing', outputPerMTok: 0.5, cachedInputPerMTok: 0.03, inputPerMTok: 0.15 },
    reasoning: { recommendedHeavy: 'Max', recommendedRoutine: 'High', ownerNativeDefault: 'Max', ownerModes: ['Low', 'High', 'Max'], providerDefault: 'max', providerEfforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] },
    toolSupport: true,
    modalities: { owner: ['text', 'image'] },
    context: { providerReported: 1048576 },
    localVsCloud: 'cloud',
    name: 'GLM-5.3 Flash',
    id: 'glm-5.3-flash',
    provider: 'ollama',
  }, 'Use the least expensive capable model.')
  assert.equal(first, second)
})

test('copy-for-prompt keeps pricing and reasoning separate and names no multiplier', () => {
  const text = guidanceText(row(), 'rule')
  assert.match(text, /Recommended routine setting: High/)
  assert.match(text, /Native reasoning default: Owner-recorded Max; Provider-reported max/)
  assert.match(text, /Input: \$0\.15\/1M tokens/)
  assert.match(text, /the reasoning level itself has no fixed multiplier/)
  assert.doesNotMatch(text, /2x|multiplier of|costs \d+x/)
})

test('missing data shows Unknown instead of guesses', () => {
  const text = guidanceText(
    { provider: 'ollama', id: 'brand-new', name: 'Brand New', localVsCloud: 'unknown', needsReview: true },
    null,
  )
  assert.match(text, /Deployment: Unknown \(Needs Review\)/)
  assert.match(text, /Cloud pricing: Not stored — Needs Review/)
  assert.match(text, /Global routing rule: Not stored — Needs Review/)
  assert.match(text, /Recommended routine setting: Unknown/)
})

test('staleness is reported, not hidden', () => {
  const text = guidanceText(row({ pricing: { inputPerMTok: 1, outputPerMTok: 2, verifiedAt: '2026-01-01', freshness: 'stale' } }), 'rule')
  assert.match(text, /Price state: stale/)
  assert.match(text, /verify against the provider before cost-sensitive decisions/)
})

test('pricing note rides beside the rates without becoming a rate', () => {
  const text = guidanceText(row({ pricingNote: 'Local: no cloud/API token charge' }), 'rule')
  assert.match(text, /no cloud\/API token charge/)
})