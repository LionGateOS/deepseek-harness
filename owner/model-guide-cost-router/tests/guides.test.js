import test from 'node:test'
import assert from 'node:assert/strict'
import { generatedGuideText, routingGuideText } from '../core/guides.js'

const row = (provider, id, extra = {}) => ({ provider, id, name: id, localVsCloud: 'unknown', needsReview: false, ...extra })

const snapshot = (providerRows, curatedOnly = []) => ({
  generatedAt: '2026-10-13T00:00:00Z',
  routingRule: 'least expensive capable first',
  gpuBoundary: [{ label: 'GD GPU', uuid: 'GPU-x', role: 'protected' }],
  providers: providerRows,
  curatedOnly,
})

test('the generated guide is deterministic and lists every model with full records', () => {
  const data = snapshot([
    { id: 'ollama', name: 'Ollama Cloud', models: [row('ollama', 'glm', { localVsCloud: 'cloud' })] },
    { id: 'qwen-local', name: 'Qwen Local', models: [row('qwen-local', 'q8', { localVsCloud: 'local', reasoning: { recommendedRoutine: 'Medium' } })] },
  ], [row('ollama', 'ghost', { localVsCloud: 'cloud' })])
  const first = generatedGuideText(data)
  const second = generatedGuideText(JSON.parse(JSON.stringify(data, Object.keys(data).concat(['a']).reduce((acc, key) => { acc[key] = data[key]; return acc }, {}))))
  assert.equal(first, second)
  assert.match(first, /# LionGateOS Model Guide \(generated\)/)
  assert.match(first, /least expensive capable first/)
  assert.match(first, /GD GPU — GPU-x: protected/)
  assert.match(first, /### Provider: Ollama Cloud \(ollama\)/)
  assert.match(first, /Curated-only models/)
  assert.match(first, /Recommended routine setting: Medium/)
})

test('a failing provider is flagged in the guide instead of losing its rows silently', () => {
  const text = generatedGuideText(snapshot([{ id: 'p', name: 'Provider', error: 'timed out', models: [row('p', 'kept', { localVsCloud: 'local' })] }]))
  assert.match(text, /provider listing FAILED \(timed out\)/)
  assert.match(text, /kept/)
})

test('the routing guide orders local first, then cheapest tiers, and quarantines unreviewed rows', () => {
  const text = routingGuideText([
    row('ollama', 'kimi', { localVsCloud: 'cloud', pricing: { costTier: 'Very Expensive', inputPerMTok: 3, outputPerMTok: 15 }, reasoning: { recommendedRoutine: 'High' } }),
    row('ollama', 'glm', { localVsCloud: 'cloud', pricing: { costTier: 'Very Cheap', inputPerMTok: 0.15, outputPerMTok: 0.5 }, reasoning: { recommendedRoutine: 'High' } }),
    row('qwen-local', 'q8', { localVsCloud: 'local', reasoning: { recommendedRoutine: 'Medium' } }),
    row('ollama', 'mystery', {}),
  ], 'least expensive capable first')
  const localIndex = text.indexOf('- qwen-local/q8')
  const cheapIndex = text.indexOf('- ollama/glm')
  const expensiveIndex = text.indexOf('- ollama/kimi')
  const mysteryIndex = text.indexOf('- ollama/mystery')
  assert.ok(localIndex !== -1 && cheapIndex !== -1 && expensiveIndex !== -1 && mysteryIndex !== -1)
  assert.ok(localIndex < cheapIndex && cheapIndex < expensiveIndex)
  assert.match(text, /Not yet reviewed/)
  assert.match(text, /least expensive capable first/)
  // Mystery's tier is not claimed: it never appears inside a tier list.
  assert.ok(!text.slice(0, mysteryIndex).includes('Very Expensive cloud models'))
})