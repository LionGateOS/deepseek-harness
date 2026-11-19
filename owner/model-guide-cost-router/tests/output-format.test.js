/**
 * Copy-for-prompt output regressions for the exact live cases the owner hit:
 * Qwen3.5-27B-Q5_K_M (local) and DeepSeek-V4-Pro (deepseek-official). The
 * copied text must merge only the parts that exist, never emit literal
 * null/undefined/NaN/[object Object] or run-together joins, never imply a
 * missing API price for a local model, and never borrow owner data across
 * provider identities.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { guidanceText } from '../core/guidance-text.js'
import { overlay } from '../core/overlay.js'

const CLIENT_SOURCE = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

/** No copied guidance may contain any of these literal leak forms. */
const FORBIDDEN = [
  /nullnull/i,
  /nullprovider/i,
  /nullowner/i,
  /\bnull\b/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
]

const qwenRow = {
  provider: 'qwen-local',
  id: '/home/liongateos/models/gguf/Qwen3.5-27B-Q5_K_M/Qwen_Qwen3.5-27B-Q5_K_M.gguf',
  name: 'Qwen3.5-27B-Q5_K_M',
  localVsCloud: 'local',
  context: { ownerConfigured: 32_768, providerReported: 32_768 },
  modalities: { owner: ['text'], providerReported: ['text', 'image'] },
  reasoning: {
    ownerModes: ['Low', 'Medium', 'High'],
    providerEfforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
    recommendedRoutine: 'Default',
  },
  pricingNote: 'Local: no cloud/API token charge ($0 token charge); still consumes electricity, GPU time, and VRAM',
  strengths: ['local routine tasks'],
}

const deepseekRow = {
  provider: 'deepseek-official',
  id: 'deepseek-v4-pro',
  name: 'DeepSeek-V4-Pro',
  localVsCloud: 'unknown',
  context: { providerReported: 1_000_000 },
  reasoning: {
    providerEfforts: [
      { id: 'off', name: 'Off' }, { id: 'low', name: 'Low' },
      { id: 'high', name: 'High' }, { id: 'max', name: 'Max' },
    ],
    providerDefault: 'high',
  },
}

test('Qwen3.5 (local): pricing reads N/A, context merges both sides, no null leaks', () => {
  const text = guidanceText(qwenRow, 'cheap first')
  assert.match(text, /Cloud pricing: N\/A — local model; \$0 cloud\/API token charge/)
  assert.match(text, /Context: Owner-configured 32,768; Provider-reported 32,768/)
  assert.match(text, /Reasoning modes: Owner: Low, Medium, High/)
  assert.match(text, /Recommended routine setting: Default/)
  assert.match(text, /Pricing note: Local: no cloud\/API token charge/)
  assert.match(text, /Cost note: Cloud\/API token charge is \$0 for this local model/)
  assert.match(text, /GPU time, VRAM, electricity, local compute availability/)
  // A local model's staleness machinery must stay silent — no missing-price claim.
  assert.doesNotMatch(text, /Pricing staleness/)
  assert.doesNotMatch(text, /Not stored — Needs Review/)
  for (const forbidden of FORBIDDEN) assert.doesNotMatch(text, forbidden)
})

test('DeepSeek-V4-Pro: provider-only fields render cleanly, unresolved fields stay Needs Review', () => {
  const text = guidanceText(deepseekRow, 'cheap first')
  assert.match(text, /Context: Provider-reported 1,000,000/)
  assert.match(text, /Reasoning modes: Provider-reported: Off\/Low\/High\/Max/)
  assert.match(text, /Native reasoning default: Provider-reported high/)
  // Unresolved owner fields are deliberate Unknown placeholders — no borrowing.
  assert.match(text, /Deployment: Unknown \(Needs Review\)/)
  assert.match(text, /Recommended routine setting: Unknown/)
  assert.match(text, /Cloud pricing: Not stored — Needs Review/)
  // Provider default is echoed verbatim as evidence, never capitalized into an invented value.
  assert.doesNotMatch(text, /Provider-reported High\n/)
  for (const forbidden of FORBIDDEN) assert.doesNotMatch(text, forbidden)
})

test('partially merged fields render only the existing portions, joined with "; "', () => {
  const ownerOnly = guidanceText({
    provider: 'ollama', id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', localVsCloud: 'cloud',
    context: { ownerConfigured: 262_144 },
    reasoning: { ownerNativeDefault: 'Medium', providerEfforts: [{ id: 'high', name: 'High' }], providerDefault: 'high' },
  }, 'cheap first')
  assert.match(ownerOnly, /Context: Owner-configured 262,144/)
  assert.doesNotMatch(ownerOnly, /Context: Owner-configured 262,144; /)
  assert.match(ownerOnly, /Native reasoning default: Owner-recorded Medium; Provider-reported high/)
  const neither = guidanceText({
    provider: 'ollama', id: 'bare', name: 'Bare', localVsCloud: 'cloud',
  }, 'cheap first')
  assert.match(neither, /Context: Unknown/)
  assert.match(neither, /Native reasoning default: Unknown/)
  for (const text of [ownerOnly, neither]) for (const forbidden of FORBIDDEN) assert.doesNotMatch(text, forbidden)
})

test('no cross-provider borrowing: the official DeepSeek id gets no Ollama owner data', () => {
  const ownerMetadata = {
    version: 1,
    routingRule: 'cheap first',
    models: {
      // The Ollama Cloud catalog identity — different provider, similar name.
      'ollama/deepseek-v4-pro:0813': {
        localVsCloud: 'cloud',
        recommendedRoutine: 'XHigh',
        pricing: { inputPerMTok: 1.32, cachedInputPerMTok: 0.044, outputPerMTok: 3.96, source: 'https://ollama.com/pricing', verifiedAt: '2026-10-13' },
        strengths: ['cloud deepseek'],
      },
    },
  }
  const discovered = [
    {
      id: 'deepseek-official', name: 'DeepSeek Official',
      models: [{
        id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000,
        reasoning: {
          efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
          defaultEffort: 'high',
        },
      }],
    },
    {
      id: 'ollama', name: 'Ollama Cloud',
      models: [{ id: 'deepseek-v4-pro:0813', name: 'DeepSeek-V4-Pro', contextWindow: 262_144 }],
    },
  ]
  const merged = overlay(discovered, /** @type {any} */ (ownerMetadata), { generatedAt: 't', freshness: () => 'fresh', metadataStatus: 'ok' })
  const official = merged.providers[0].models[0]
  assert.equal(official.pricing, undefined)
  assert.equal(official.localVsCloud, 'unknown')
  assert.equal(official.reasoning?.recommendedRoutine, undefined)
  assert.equal(official.reasoning?.providerDefault, 'high')
  const ollamaRow = merged.providers[1].models[0]
  assert.equal(ollamaRow.pricing?.inputPerMTok, 1.32)
  assert.equal(ollamaRow.localVsCloud, 'cloud')
  assert.equal(ollamaRow.reasoning?.recommendedRoutine, 'XHigh')
  const officialText = guidanceText(official, merged.routingRule)
  assert.doesNotMatch(officialText, /1\.32|\$3\.96|XHigh|Owner-recorded/)
  for (const forbidden of FORBIDDEN) assert.doesNotMatch(officialText, forbidden)
})

/** Static contract guarding the per-row copy identity wiring in client.js. */
test('copy feedback is keyed to the exact clicked row, not a shared boolean', () => {
  // The state is a {key, result} pair keyed by the row's stable identity.
  assert.match(CLIENT_SOURCE, /setCopyState\(\{ key: rowKey, result: /)
  assert.doesNotMatch(CLIENT_SOURCE, /setCopyState\('done'\)/)
  // ModelCard renders feedback only when the row's key matches the clicked key.
  assert.match(CLIENT_SOURCE, /const copyState = copyKey === rowKey \? copyResult : undefined/)
  // Both card lists pass the stable per-row identity.
  assert.match(CLIENT_SOURCE, /rowKey: `\$\{row\.provider\}\/\$\{row\.id\}`/g)
  // The timeout clears only the entry that still owns its key.
  assert.match(CLIENT_SOURCE, /current\?\.key === rowKey \? undefined : current/)
})