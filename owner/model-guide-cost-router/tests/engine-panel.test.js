/**
 * Engines panel: the derived recommendation and the copy-ready prompt.
 *
 * The Host decides the recommendation; the panel only presents it. These tests
 * drive the shipped component through its own toggle so the assertions cover
 * the real render path, and they check that the panel never produces advice of
 * its own — a record without a Host verdict renders no recommendation.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadClient } from './load-client.js'
import { createRenderHarness } from './render-harness.js'

/** A catalog payload as the Host shapes it, advice included. */
const catalog = () => ({
  status: 'ok',
  catalogPath: '/x/engine-catalog.json',
  engines: [
    {
      id: 'ollama',
      displayName: 'Ollama',
      installedVersion: '0.22.1',
      latestRelease: 'v0.40.15',
      releaseUrl: 'https://github.com/ollama/ollama/releases/tag/v0.40.15',
      releasedAt: '2026-11-03T00:00:00.000Z',
      lastCheckAt: '2026-11-08T02:00:00.000Z',
      status: 'success',
      advice: { recommendation: 'REVIEW', reason: 'newer-stable', destination: 'DeepSeek Harness', requiresOwnerApproval: true, prerelease: false },
      prompt: 'PLATFORM: DeepSeek Harness\nACCESS: READ\n',
      verifications: [],
    },
    {
      id: 'strata',
      displayName: 'Strata',
      installedVersion: '0.1.56',
      latestRelease: 'v0.2.12',
      engineRelease: '0.1.58',
      engineReleaseDetail: { variant: 'cuda13', platform: 'linux-x86_64', minimumDriver: '580.65', driverVersion: '580.178.04', driverSatisfied: true },
      versionSpace: 'control',
      lastCheckAt: '2026-11-08T02:00:00.000Z',
      status: 'success',
      advice: { recommendation: 'REVIEW', reason: 'newer-stable', destination: 'DeepSeek Harness', requiresOwnerApproval: true, prerelease: false },
      prompt: 'PLATFORM: DeepSeek Harness\n',
      verifications: [],
    },
    {
      id: 'vllm',
      displayName: 'vLLM',
      installedVersion: '0.19.0',
      latestRelease: 'v0.33.0rc3',
      lastCheckAt: '2026-11-08T02:00:00.000Z',
      status: 'success',
      advice: { recommendation: 'DEFER', reason: 'newer-prerelease', destination: 'DeepSeek Harness', requiresOwnerApproval: true, prerelease: true },
      prompt: 'PLATFORM: DeepSeek Harness\n',
      verifications: [],
    },
    {
      id: 'sglang',
      displayName: 'SGLang',
      installedVersion: null,
      latestRelease: 'v0.5.23',
      lastCheckAt: '2026-11-08T02:00:00.000Z',
      status: 'success',
      advice: { recommendation: 'NO_ACTION', reason: 'not-detected', destination: 'DeepSeek Harness', requiresOwnerApproval: false, prerelease: false },
      verifications: [],
    },
  ],
})

/**
 * Render the model-guide panel, open the Engines section through its button, and
 * return the rendered text plus the clickable nodes.
 * @param {object} actions extra action overrides merged into the base set.
 * @returns {Promise<{text: string, labels: object, buttons: object[]}>}
 */
async function openEngines(actions = {}) {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const en = client.labels.en
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const props = {
    t: (key) => en[key] ?? key,
    load: async () => ({ generatedAt: 'g', providers: [], curatedOnly: [], routingRule: null, gpuBoundary: [] }),
    copyGuidance: async () => '',
    copyFullGuide: async () => ({ text: 'g' }),
    copyRoutingGuide: async () => ({ text: 'r' }),
    lastReport: async () => null,
    update: async () => ({ report: { priceChanges: [] } }),
    researchStatus: async () => ({ status: 'ok', counts: { newlyDetected: 0 }, models: [] }),
    researchPrompt: async () => ({ prompt: 'P' }),
    previewResearchResults: async () => ({ status: 'ok', changes: [], rejected: [] }),
    applyResearchResults: async () => ({ status: 'applied' }),
    engineCatalog: async () => catalog(),
    loadEngineCatalog: async () => catalog(),
    checkEngines: async () => ({ report: {} }),
    ...actions,
  }
  harness.renderOne((p) => component(p), props)
  await harness.flushEffects()
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  let tree = harness.renderOne((p) => component(p), props)
  let toggle = null
  walk(tree, (node) => {
    if (toggle === null && typeof node.props?.onClick === 'function' && harness.textOf(node) === en.enginesButton) toggle = node
  })
  assert.ok(toggle !== null, 'the Engines toggle renders')
  await toggle.props.onClick({})
  await harness.flushEffects()
  tree = harness.renderOne((p) => component(p), props)
  const buttons = []
  walk(tree, (node) => { if (typeof node.props?.onClick === 'function') buttons.push(node) })
  return { text: harness.textOf(tree), labels: en, buttons, harness }
}

test('the recommendation badge renders the Host verdict, not a client opinion', async () => {
  const { text, labels } = await openEngines()
  assert.ok(text.includes(labels.enginesAdviceReview), 'a REVIEW engine shows the Review badge')
  assert.ok(text.includes(labels.enginesAdviceDefer), 'a DEFER engine shows the Defer badge')
  assert.ok(text.includes(labels.enginesAdviceNoAction), 'a NO_ACTION engine shows the No action badge')
})

test('each recommendation states why, where it belongs, and that approval is needed', async () => {
  const { text, labels } = await openEngines()
  assert.ok(text.includes(labels.enginesReasonNewerStable), 'the reason travels with the verdict')
  assert.ok(text.includes(labels.enginesReasonPrerelease), 'a prerelease says so')
  assert.ok(text.includes(labels.enginesReasonNotDetected), 'an undetected engine says so')
  assert.ok(text.includes(`${labels.enginesAdviceDestination}: DeepSeek Harness`), 'the investigation destination is named')
  assert.ok(text.includes(labels.enginesAdviceApproval), 'the approval gate is stated in words')
})

test('the Strata engine build and its driver floor render beside the application tag', async () => {
  const { text, labels } = await openEngines()
  assert.ok(text.includes(labels.enginesEngineBuildLabel), 'the published engine build has its own field')
  assert.ok(text.includes('0.1.58'), 'the published engine build renders')
  assert.ok(text.includes(`${labels.enginesMinimumDriverLabel}: 580.65`), 'the driver floor renders with the package it belongs to')
  assert.ok(text.includes(labels.enginesControlVersionNote), 'the version-space note still explains why the tag is not comparable')
})

test('a copy-ready prompt button appears only where the Host supplied one', async () => {
  const { text, labels } = await openEngines()
  assert.ok(text.includes(labels.enginesCopyPrompt), 'the copy button renders for an actionable engine')
  // The NO_ACTION engine carries no prompt, so exactly three of four rows offer
  // one: the panel copies what the Host decided to offer and nothing else.
  const promptButtons = text.split(labels.enginesCopyPrompt).length - 1
  assert.equal(promptButtons, 3)
})

test('the panel renders no recommendation of its own when the Host supplied none', async () => {
  const bare = catalog()
  for (const engine of bare.engines) {
    delete engine.advice
    delete engine.prompt
  }
  const { text, labels } = await openEngines({ loadEngineCatalog: async () => bare })
  // Match the advice-specific text rather than a bare word: "Review" also
  // appears in unrelated panel copy.
  assert.ok(!text.includes(`${labels.enginesAdviceWhy}:`), 'no client-side recommendation explanation')
  assert.ok(!text.includes(labels.enginesReasonNewerStable), 'no client-side reason is invented')
  assert.ok(!text.includes(labels.enginesAdviceApproval), 'no approval note without a recommendation')
  assert.ok(!text.includes(labels.enginesCopyPrompt), 'no prompt button without a Host prompt')
  assert.ok(text.includes(labels.enginesVerifiedTitle), 'the verification section still renders')
})
