import test from 'node:test'
import assert from 'node:assert/strict'
import { recommendForTask } from '../core/recommend.js'

const row = (provider, id, extra = {}) => ({ provider, id, name: id, localVsCloud: 'unknown', needsReview: false, ...extra })

test('local models rank before cloud models of any tier', () => {
  const result = recommendForTask([
    row('ollama', 'glm-5.3-flash', { localVsCloud: 'cloud', strengths: ['code review'], pricing: { costTier: 'Very Cheap' } }),
    row('qwen-local', 'qwen27b', { localVsCloud: 'local', strengths: ['code review'] }),
  ], 'review this diff')
  assert.equal(result.order[0].row.id, 'qwen27b')
  assert.equal(result.order[0].unreviewed, false)
})

test('within clouds, the owner cost tiers order cheapest first', () => {
  const result = recommendForTask([
    row('ollama', 'kimi-k3', { localVsCloud: 'cloud', strengths: ['agentic work'], pricing: { costTier: 'Very Expensive' } }),
    row('ollama', 'nemotron-3-super', { localVsCloud: 'cloud', strengths: ['agent workflows'], pricing: { costTier: 'Very Cheap' } }),
    row('ollama', 'deepseek-v4-pro', { localVsCloud: 'cloud', strengths: ['reasoning'], pricing: { costTier: 'Expensive' } }),
  ], 'agent workflow over many steps')
  assert.deepEqual(result.order.map((item) => item.row.id), ['nemotron-3-super', 'deepseek-v4-pro', 'kimi-k3'])
})

test('unreviewed rows are flagged and never claimed capable', () => {
  const result = recommendForTask([
    row('ollama', 'curated', { localVsCloud: 'cloud', strengths: ['coding workflows'], pricing: { costTier: 'Cheap' } }),
    row('ollama', 'brand-new', {}),
  ], 'coding workflows')
  const fresh = result.order.find((item) => item.row.id === 'brand-new')
  assert.equal(fresh.unreviewed, true)
  assert.equal(fresh.why.length, 0)
  assert.equal(result.unreviewedCount, 1)
})

test('task keywords pick owner-stated strengths as reasons', () => {
  const result = recommendForTask([
    row('qwen-local', 'vision', { localVsCloud: 'local', strengths: ['screenshots and UI inspection', 'document/image reasoning'] }),
    row('qwen-local', 'coder', { localVsCloud: 'local', strengths: ['bounded coding', 'implementation'] }),
  ], 'inspect this screenshot')
  assert.equal(result.order[0].row.id, 'vision')
  assert.ok(result.order[0].why.some((reason) => reason.includes('screenshots')))
})

test('the ordering is deterministic for equal inputs', () => {
  const rows = [
    row('ollama', 'b', { localVsCloud: 'cloud', strengths: ['tools'], pricing: { costTier: 'Cheap' } }),
    row('ollama', 'a', { localVsCloud: 'cloud', strengths: ['tools'], pricing: { costTier: 'Cheap' } }),
  ]
  const first = recommendForTask(rows, 'tools please')
  const second = recommendForTask([...rows].reverse(), 'tools please')
  assert.deepEqual(first.order.map((item) => item.row.id), second.order.map((item) => item.row.id))
})