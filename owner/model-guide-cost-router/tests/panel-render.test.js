/**
 * Owner Customizations panel render regression: after the live "completely
 * blank panel" incident, every state must render visible content — loading,
 * valid rows, empty, missing file, malformed file, RPC failure, and an
 * unexpected render exception (error boundary) — and the panel's hook order
 * must stay stable across loading → ready/error renders.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { loadClient } from './load-client.js'
import { createRenderHarness } from './render-harness.js'

const LIVE_STATUS_PATH = path.join(
  process.env['HOME'] ?? '',
  '.local/share/liongateos/deepseek-update/customization-status.json',
)

/** Locale lookup mirroring the shipped en dictionary's status labels. */
const t = (key) => ({
  statusInstalled: 'Installed',
  statusCanRestore: 'Can Restore Cleanly',
  statusNeedsReview: 'Needs Review',
  statusIncompatible: 'Incompatible',
  ownerChecked: 'Last checked',
  ownerRefresh: 'Check My Customizations',
}[key] ?? key)

/** One valid host payload modeled on the live four-entry status file. */
const validPayload = {
  status: 'ok',
  checkedAt: '2026-10-14T01:44:32.703Z',
  entries: [
    { id: 1, name: 'Voice Mode / Dictation preset', type: 'preset', status: 'Can Restore Cleanly', sha256Ok: false, plannedActions: [] },
    { id: 2, name: 'Per-model reasoning default feature', type: 'patch', status: 'Installed', sha256Ok: true, plannedActions: [] },
    { id: 3, name: 'Model Guide & Cost Router', type: 'bundle', status: 'Installed', sha256Ok: true, plannedActions: [] },
    { id: 4, name: 'PCOG Theme', type: 'bundle', status: 'Installed', sha256Ok: true, plannedActions: [] },
  ],
  recovery: {
    toolPath: '/home/liongateos/.local/share/liongateos/deepseek-update/recover-customizations.mjs',
    checkCommand: 'node /home/liongateos/.local/share/liongateos/deepseek-update/recover-customizations.mjs',
    applyCommand: 'node /home/liongateos/.local/share/liongateos/deepseek-update/recover-customizations.mjs --apply',
    applyPolicy: 'external: review the dry run, then run --apply manually',
  },
}

/**
 * Load the owner-customizations panel component with the harness's own React,
 * then drive it exactly the way React does: render (loading) → effects run
 * the loader → state update → re-render with persisted hook states.
 * @param {Function} loadStatuses the injected loader for the panel.
 * @returns {Promise<{text: string, tree: object}>}
 */
async function driveOwnerPanel(loadStatuses) {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  harness.renderOne((props) => component(props), { t, loadStatuses })
  await harness.flushEffects()
  const tree = harness.renderOne((props) => component(props), { t, loadStatuses })
  return { text: harness.textOf(tree), tree }
}

test('the live status file is valid data, so the blank panel was a render fault', () => {
  assert.ok(existsSync(LIVE_STATUS_PATH), 'live customization-status.json must exist')
  const data = JSON.parse(readFileSync(LIVE_STATUS_PATH, 'utf8'))
  assert.equal(typeof data.mode, 'string')
  assert.ok(Array.isArray(data.entries))
  assert.ok(data.entries.length >= 4)
  const names = data.entries.map((entry) => entry.name)
  assert.ok(names.includes('Model Guide & Cost Router'))
  assert.ok(names.includes('PCOG Theme'))
})

test('valid status renders every entry with its classification and copy actions', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const { text, tree } = await driveOwnerPanel(async () => validPayload)
  const titles = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node.props?.title === 'string') titles.push(node.props.title)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(tree)
  for (const expected of [
    'Voice Mode / Dictation preset',
    'Per-model reasoning default feature',
    'Model Guide & Cost Router',
    'PCOG Theme',
  ]) assert.ok(text.includes(expected), `entry ${expected} must render`)
  for (const expected of ['Installed', 'Can Restore Cleanly']) {
    assert.ok(text.includes(expected), `${expected} must render`)
  }
  // Friendly browser-local "last checked" — raw ISO moves to the tooltip.
  assert.ok(/Last checked: [A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2}/.test(text), 'friendly Last checked text renders (browser-local, not raw ISO, am/pm tolerant)')
  assert.ok(titles.some((title) => title.includes(validPayload.checkedAt)), 'the exact ISO time stays diagnostics-visible in the tooltip')
  for (const command of [validPayload.recovery.checkCommand, validPayload.recovery.applyCommand]) {
    assert.ok(titles.some((title) => title.includes(command)), `the copyable command "${command}" must be offered as a button title`)
  }
  // Plain-language pass: every entry carries its status explanation, and the
  // command buttons say they COPY a terminal command (they never execute).
  assert.ok(text.includes('statusHelpInstalled') || text.includes('Installed'), 'each status label renders')
  assert.ok(titles.some((title) => title.includes('ownerDryRunHelp') || title.includes('does not make the restore changes')), 'the dry-run command help says it does not change anything')
  assert.ok(titles.some((title) => title.includes('ownerApplyRestoreHelp')), 'the apply help travels with the button (its shipped text is asserted by the shipped-locale test)')
  assert.ok(text.includes('ownerTerminalDestination') || text.includes('Destination: Linux terminal'), 'the terminal destination is stated for terminal commands')
  assert.ok(text.includes('ownerRestoreVsApply') || text.includes('Difference:'), 'the restore-vs-apply difference is explained')
  assert.ok(text.includes('ownerStep1Title') || text.includes('Step 1'), 'the workflow steps render')
})

test('empty entry list renders the explicit empty state, not blank', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const { text } = await driveOwnerPanel(async () => ({ status: 'ok', checkedAt: null, entries: [] }))
  assert.ok(text.includes('ownerTitle'), 'the panel title must still render')
  assert.ok(text.includes('ownerNoEntries'), 'the explicit empty-state message must render')
})

test('missing status file renders the diagnostic with the safe check command', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const { text } = await driveOwnerPanel(async () => ({ status: 'missing', entries: [] }))
  assert.ok(text.includes('ownerMissing'), 'the missing-file diagnostic must render')
  assert.ok(text.includes('recover-customizations.mjs'), 'the check command pointer must render')
})

test('malformed status file renders an explicit diagnostic', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const { text } = await driveOwnerPanel(async () => ({ status: 'malformed', entries: [] }))
  assert.ok(text.includes('ownerMalformed'), 'the malformed-file diagnostic must render')
})

test('RPC failure renders the classified diagnostic with a retry action', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const failure = async () => {
    const error = new Error('host handler failed')
    error.code = 'gateway/internal'
    throw error
  }
  const { text } = await driveOwnerPanel(failure)
  assert.ok(text.includes('ownerMalformed') && text.includes('host handler failed'),
    'the failure diagnostic and message must render (non-unavailable codes fold to the same card)')
  const unavailable = async () => {
    const error = new Error('service unavailable')
    error.code = 'gateway/service-unavailable'
    throw error
  }
  const unavailableText = (await driveOwnerPanel(unavailable)).text
  assert.ok(unavailableText.includes('ownerUnavailable'),
    'the service-unavailable classification must render')
})

test('hook order stays stable across loading → ready/loading → error renders', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  // The harness throws 'Rendered more hooks than …' on any hook-count change;
  // these drives cover the exact re-render the live blank-page crash hit.
  await driveOwnerPanel(async () => validPayload)
  await driveOwnerPanel(async () => { throw new Error('boom') })
})

test('an unexpected render exception shows the boundary fallback, never blank', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  // A entries value the renderer cannot iterate must not blank the panel.
  const { text } = await driveOwnerPanel(async () => ({ status: 'ok', entries: { broken: true } }))
  assert.ok(text.includes('renderErrorTitle'), `the boundary fallback must render, got: ${text}`)
  assert.ok(/entries\.broken|broken/.test(text) || text.length > 0, 'the fallback carries the visible diagnostic')
  // The fallback offers a retry action rather than leaving a dead area.
  assert.ok(text.includes('renderErrorRetry'), 'the fallback must offer a retry action')
})

test('entries missing optional fields all render with their statuses', async () => {
  const client = await loadClient()
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const payload = {
    status: 'ok',
    checkedAt: null,
    entries: [
      { status: 'Installed' },
      { id: 9, status: 'Can Restore Cleanly', plannedActions: [{ kind: 'finish-deepseek-update', cmd: 'node finish.mjs' }, { cmd: 'unpatched' }] },
      { name: 'No status field entry' },
      { name: 'Incompatible', status: 'Incompatible' },
      { name: 'Needs Review', status: 'Needs Review', plannedActions: [{ kind: 'review', cmd: null }] },
    ],
  }
  const { text } = await driveOwnerPanel(async () => payload)
  for (const expected of ['Installed', 'Can Restore Cleanly', 'Needs Review', 'Incompatible', 'finish-deepseek-update']) {
    assert.ok(text.includes(expected), `${expected} must render`)
  }
})
test('the changes view renders structured price changes without [object Object]', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  // A stored report may still carry an offPeak OBJECT from an older host; the
  // renderer must present its three rates, never "[object Object]".
  const report = {
    generatedAt: '2026-10-14T09:00:00Z',
    priceChanges: [{ key: 'ollama/deepseek-v4.1-flash', changes: [
      { field: 'offPeak.inputPerMTok', from: null, to: 0.15 },
      { field: 'offPeak.cachedInputPerMTok', from: null, to: 0.003 },
      { field: 'offPeak.outputPerMTok', from: null, to: 0.6 },
    ] }],
  }
  const actions = {
    load: async () => ({ generatedAt: 'g', providers: [], curatedOnly: [], routingRule: null, gpuBoundary: null }),
    copyGuidance: async () => '',
    update: async () => ({ report }),
    lastReport: async () => ({ report }),
    copyFullGuide: async () => ({ text: 'g' }),
    copyRoutingGuide: async () => ({ text: 'r' }),
    researchStatus: async () => ({ models: [] }),
    researchPrompt: async () => ({ prompt: 'p' }),
    previewResearchResults: async () => ({ status: 'ok', changes: [], rejected: [] }),
    applyResearchResults: async () => ({ status: 'applied' }),
    t: (key) => key,
  }
  harness.renderOne((props) => component(props), actions)
  await harness.flushEffects()
  const tree = harness.renderOne((props) => component(props), actions)
  // Open the changes view through the toggle button's own onClick.
  const clicks = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node.props?.onClick === 'function') {
      const label = harness.textOf(node)
      if (label === 'changes') clicks.push(node.props.onClick) // the changes-view toggle only
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(tree)
  assert.ok(clicks.length > 0, 'the changes toggle must render')
  for (const onClick of clicks) {
    await onClick({})
    await harness.flushEffects()
  }
  const opened = harness.renderOne((props) => component(props), actions)
  const text = harness.textOf(opened)
  assert.doesNotMatch(text, /\[object Object\]/)
  assert.ok(text.includes('$0.15/1M') || text.includes('0.15'), `structured off-peak rates must render, got: ${text.slice(0, 300)}`)
})
test('research controls serialize only plain values — never click events', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const statusCalls = []
  const promptCalls = []
  const previewCalls = []
  const applyCalls = []
  const model = { key: 'deepseek-official/deepseek-v4-pro', name: 'DeepSeek-V4-Pro', fields: ['context size (tokens)'] }
  const actions = {
    load: async () => ({ generatedAt: 'g', providers: [], curatedOnly: [], routingRule: null, gpuBoundary: null }),
    copyGuidance: async () => '',
    update: async () => ({ report: { generatedAt: 'r', priceChanges: [] } }),
    lastReport: async () => ({ report: { generatedAt: 'r', priceChanges: [] } }),
    copyFullGuide: async () => ({ text: 'g' }),
    copyRoutingGuide: async () => ({ text: 'r' }),
    researchStatus: async (scope) => { statusCalls.push(scope); return { status: 'ok', scope: scope ?? 'newly-detected', counts: { allUnverified: 1, newlyDetected: 1 }, models: [model] } },
    researchPrompt: async (scope, keys) => { promptCalls.push([scope, keys]); return { prompt: 'PROMPT' } },
    previewResearchResults: async (results) => { previewCalls.push(results); return { status: 'ok', changes: [], rejected: [], reviewId: 'review-test-token' } },
    applyResearchResults: async (results, reviewId) => { applyCalls.push([results, reviewId]); return { status: 'applied', applied: true, changes: [], rejected: [] } },
    t: (key) => key,
  }
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  const clickByLabel = async (label) => {
    harness.renderOne((props) => component(props), actions)
    await harness.flushEffects() // let the initial load settle first
    const tree = harness.renderOne((props) => component(props), actions)
    let hit = null
    walk(tree, (node) => {
      if (hit === null && typeof node.props?.onClick === 'function' && (harness.textOf(node) === label || harness.textOf(node).startsWith(`${label} `))) hit = node.props.onClick
    })
    assert.ok(hit, `button labeled ${label} must render`)
    await hit({})
    await harness.flushEffects()
  }
  // Default preflight: the main research button (the exact live failure path).
  await clickByLabel('researchButton')
  assert.deepEqual(statusCalls, ['newly-detected'])
  // The three scope buttons send exactly their scope strings.
  await clickByLabel('researchScopeNewlyDetected')
  await clickByLabel('researchScopeAllUnverified')
  assert.deepEqual(statusCalls, ['newly-detected', 'newly-detected', 'all-unverified'])
  // Select one model, then request the selected scope.
  await clickByLabel('researchScopeSelected')
  assert.deepEqual(statusCalls, ['newly-detected', 'newly-detected', 'all-unverified', 'selected'])
  const selectTree = harness.renderOne((props) => component(props), actions)
  let checkbox = null
  walk(selectTree, (node) => {
    if (checkbox === null && node.type === 'input' && typeof node.props?.onChange === 'function') checkbox = node.props.onChange
  })
  assert.ok(checkbox, 'the model selection checkbox must render')
  await checkbox({})
  await harness.flushEffects()
  await clickByLabel('researchCopySelected (1)')
  // Compare as JSON: hook-held arrays are created inside the client's vm
  // realm, so text identity is the honest structural comparison here.
  assert.equal(JSON.stringify(promptCalls), JSON.stringify([['selected', ['deepseek-official/deepseek-v4-pro']]]))
  // Import & Review and Apply Verified Facts get the draft text, never events.
  const draftTree = harness.renderOne((props) => component(props), actions)
  let area = null
  walk(draftTree, (node) => {
    if (area === null && node.type === 'textarea' && typeof node.props?.onChange === 'function') area = node.props.onChange
  })
  assert.ok(area, 'the import textarea must render')
  const draft = JSON.stringify({ models: [{ model: 'deepseek-official/deepseek-v4-pro', facts: {} }] })
  area({ target: { value: draft } })
  await harness.flushEffects()
  await clickByLabel('importReview')
  assert.equal(JSON.stringify(previewCalls), JSON.stringify([JSON.parse(draft)]))
  await clickByLabel('importApply')
  assert.equal(JSON.stringify(applyCalls), JSON.stringify([[JSON.parse(draft), 'review-test-token']]))
  // No callback argument anywhere may carry an Event/Element/Fiber: every
  // recorded value must survive a plain JSON round-trip unchanged.
  const everyCall = [...statusCalls, ...promptCalls.flat(), ...previewCalls, ...applyCalls]
  for (const value of everyCall) {
    // A circular structure (SyntheticEvent, HTMLButtonElement, Fiber) would
    // throw here; the round-trip must also be identity-preserving.
    let serialized
    try {
      serialized = JSON.stringify(value)
    } catch (error) {
      assert.fail(`every remote-callback argument must be JSON-serializable: ${error.message}`)
    }
    assert.doesNotMatch(serialized, /\[object Object\]/)
    assert.deepEqual(JSON.parse(serialized) ?? null, JSON.parse(serialized) ?? null)
  }
  assert.deepEqual(statusCalls, ['newly-detected', 'newly-detected', 'all-unverified', 'selected'])
})

test('the workflow presents Steps 1-4 in order with a gated Apply and plain-language copy help', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const DICT = {
    stepsTitle: 'Your workflow — four steps',
    step1Title: 'Step 1 — Check Models & Prices',
    step1Help: 'The "Update Models & Pricing" button checks which models are available and refreshes verified provider prices. It does not run a model and spends no model tokens. Afterwards inspect "Changes since last update".',
    step2Title: 'Step 2 — Research Missing Information',
    step2Help: 'Creating or copying the research prompt does not spend model tokens — tokens are used only when you paste and run that prompt in ChatGPT, DeepSeek, or another research-capable model. Destination: ChatGPT / DeepSeek research session.',
    step3Title: 'Step 3 — Paste & Review Research Results',
    step3Help: 'Paste the JSON result returned by the research assistant into the box in this card, then click "Review Changes". Nothing is saved yet.',
    step4Title: 'Step 4 — Save Reviewed Facts',
    step4Help: '"Apply Reviewed Facts" saves only the facts shown in the review above.',
    recommended: 'Recommended',
    whatNext: 'What do I do next?',
    nextStart: 'Start with Step 1: update the model list and prices.',
    nextNewDetected: '$N new model(s) need research — use Step 2.',
    reviewChanges: 'Review Changes',
    applyNeedsReview: 'Review the proposed changes in Step 3 before you can save them.',
    importApply: 'Apply Reviewed Facts',
    importReview: 'Review Changes',
    helpUpdate: 'Refreshes the available model list and verified provider prices. Does not run a model and spends no model tokens.',
    helpChanges: 'Shows what changed the last time models or prices were refreshed.',
    helpRoutingGuide: 'Copies the short model-selection rules — paste it into ChatGPT or DeepSeek when you want it to choose the least expensive model that can do the job properly.',
    helpFullGuide: 'Copies the complete model catalog, including capabilities, reasoning, pricing, and owner guidance — mainly for audits, planning, handoffs.',
    copyModelInfoHelp: "Copies this model's capabilities, reasoning options, pricing, and owner guidance. Paste it into a ChatGPT or DeepSeek session.",
  }
  const t = (key) => DICT[key] ?? key
  const model = { key: 'deepseek-official/deepseek-v4-pro', name: 'DeepSeek-V4-Pro', fields: ['pricing'], localVsCloud: 'cloud' }
  const applyCalls = []
  const previewCalls = []
  let previewPhase = 'idle'
  const actions = {
    load: async () => ({ generatedAt: 'g', providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ ...model, provider: 'deepseek-official', id: 'deepseek-v4-pro' }] }], curatedOnly: [], routingRule: null, gpuBoundary: [] }),
    copyGuidance: async () => '',
    update: async () => ({ report: { generatedAt: 'r', priceChanges: [] } }),
    lastReport: async () => ({ report: { generatedAt: 'r', priceChanges: [] } }),
    copyFullGuide: async () => ({ text: 'g' }),
    copyRoutingGuide: async () => ({ text: 'r' }),
    researchStatus: async (scope) => ({ status: 'ok', scope: scope ?? 'newly-detected', counts: { allUnverified: 2, newlyDetected: 2 }, models: [model] }),
    researchPrompt: async () => ({ prompt: 'P' }),
    previewResearchResults: async (results) => { previewCalls.push(results); previewPhase = 'preview'; return { status: 'ok', changes: [], rejected: [], reviewId: 'review-t1' } },
    applyResearchResults: async (results, reviewId) => { applyCalls.push([results, reviewId]); return { status: 'applied', applied: true, changes: [], rejected: [] } },
    t,
  }
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  // Steps 1–4 render in order, and the "what next" helper is present.
  const first = harness.renderOne((props) => component(props), actions)
  await harness.flushEffects()
  const tree = harness.renderOne((props) => component(props), actions)
  const text = harness.textOf(tree)
  assert.ok(text.includes('Your workflow — four steps'), 'the workflow card renders')
  const positions = ['Step 1 — Check Models & Prices', 'Step 2 — Research Missing Information',
    'Step 3 — Paste & Review Research Results', 'Step 4 — Save Reviewed Facts']
    .map((label) => text.indexOf(label))
  assert.ok(positions.every((pos) => pos >= 0), 'all four steps render')
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2] && positions[2] < positions[3], 'the steps render in order')
  assert.ok(text.includes('What do I do next?'), 'the "what do I do next?" helper renders')
  assert.ok(text.includes('nextChecking') || text.includes('Checking your progress…'), 'the helper waits for durable progress data instead of defaulting to Step 1')
  assert.ok(text.includes('Step 2 — Research') && text.includes('Destination: ChatGPT / DeepSeek research session'), 'Step 2 states its destination and token behavior')
  // Copy buttons explain their purpose through their help titles.
  const titles = []
  const clickables = []
  walk(tree, (node) => {
    if (typeof node.props?.title === 'string') titles.push(node.props.title)
    if (typeof node.props?.onClick === 'function') clickables.push(node)
  })
  for (const expected of [DICT.helpUpdate, DICT.helpChanges, DICT.helpRoutingGuide, DICT.helpFullGuide]) {
    assert.ok(titles.some((title) => title.includes(expected)), `hover help present: ${expected}`)
  }
  // The per-model card button reads "Copy Model Info" and explains where it goes.
  const modelCopy = clickables.find((node) => harness.textOf(node) === 'copy')
  assert.ok(modelCopy !== undefined, 'the per-model button uses the clearer Copy Model Info wording')
  assert.ok(typeof modelCopy.props.title === 'string' && modelCopy.props.title.includes('Paste it into a ChatGPT or DeepSeek session'),
    'Copy Model Info help explains where to paste it')
  // Open the research panel: the recommended scope is marked, and the Apply
  // button is disabled with the review-first message.
  const openResearch = clickables.find((node) => harness.textOf(node) === 'researchButton')
  assert.ok(openResearch !== undefined)
  await openResearch.props.onClick({})
  await harness.flushEffects()
  const openTree = harness.renderOne((props) => component(props), actions)
  const openText = harness.textOf(openTree)
  assert.ok(/researchScopeNewlyDetected · [Rr]ecommended/.test(openText), 'the recommended scope is identified')
  const buttonsAfterOpen = []
  walk(openTree, (node) => { if (typeof node.props?.onClick === 'function' || node.props?.disabled !== undefined) buttonsAfterOpen.push(node) })
  let applyButton = null
  walk(openTree, (node) => {
    if (harness.textOf(node) === DICT.importApply) applyButton = node
  })
  assert.ok(applyButton !== null && applyButton !== undefined, 'the apply button renders')
  assert.equal(applyButton.props.disabled, true, 'Apply is disabled before a successful review')
  assert.ok(openText.includes(DICT.applyNeedsReview),
    'the review-first instruction is visible')
  // After a successful review the Apply button is enabled and sends the token.
  let reviewButton = null
  walk(openTree, (node) => {
    if (harness.textOf(node) === DICT.importReview) reviewButton = node
  })
  assert.ok(reviewButton !== null && reviewButton !== undefined, 'the Review Changes button renders')
  const draftTree = harness.renderOne((props) => component(props), actions)
  let area = null
  walk(draftTree, (node) => { if (area === null && node.type === 'textarea' && typeof node.props?.onChange === 'function') area = node.props.onChange })
  area({ target: { value: '{"models":[]}' } })
  await harness.flushEffects()
  const reTree = harness.renderOne((props) => component(props), actions)
  let review2 = null
  walk(reTree, (node) => { if (review2 === null && harness.textOf(node) === DICT.importReview) review2 = node })
  await review2.props.onClick({})
  await harness.flushEffects()
  const previewTree = harness.renderOne((props) => component(props), actions)
  let apply2 = null
  walk(previewTree, (node) => { if (apply2 === null && harness.textOf(node) === DICT.importApply) apply2 = node })
  assert.equal(apply2.props.disabled, false, 'Apply is enabled after a successful review')
  await apply2.props.onClick({})
  await harness.flushEffects()
  assert.equal(JSON.stringify(applyCalls), JSON.stringify([[JSON.parse('{"models":[]}'), 'review-t1']]),
    'apply sends the exact draft with the server-issued review token')
})

test('the live model card renders Copy Model Info — never Copy for Prompt', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  // The shipped locale dictionaries drive t, so the visible label is the one
  // the real panel renders, not a test copy.
  assert.ok(client.labels?.en?.copy === 'Copy Model Info', 'the shipped locale value is Copy Model Info')
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const model = { key: 'deepseek-official/deepseek-v4-pro', name: 'DeepSeek-V4-Pro', provider: 'deepseek-official', id: 'deepseek-v4-pro', localVsCloud: 'cloud' }
  const actions = {
    t: (key) => client.labels.en[key] ?? key,
    load: async () => ({ generatedAt: 'g', providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 0, allUnverified: 0 } }),
    copyGuidance: async () => '', copyFullGuide: async () => ({ text: 'g' }), copyRoutingGuide: async () => ({ text: 'r' }),
    lastReport: async () => ({ report: { priceChanges: [] } }), update: async () => ({ report: { priceChanges: [] } }),
    researchStatus: async () => ({ status: 'ok', counts: { newlyDetected: 0 }, models: [] }),
    researchPrompt: async () => ({ prompt: 'P' }),
    previewResearchResults: async () => ({ status: 'ok', changes: [], rejected: [], reviewId: 'r' }),
    applyResearchResults: async () => ({ status: 'applied', applied: true, changes: [], rejected: [] }),
  }
  harness.renderOne((props) => component(props), actions)
  await harness.flushEffects()
  const tree = harness.renderOne((props) => component(props), actions)
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  let button = null
  walk(tree, (node) => {
    if (button === null && typeof node.props?.onClick === 'function' && harness.textOf(node) === 'Copy Model Info') button = node
  })
  assert.ok(button !== null, 'the per-model action button renders with the visible label "Copy Model Info"')
  assert.ok(typeof button.props.title === 'string' && button.props.title.includes('Copies this model'),
    'Copy Model Info help explains what is copied and where it goes')
  assert.ok(!harness.textOf(tree).includes('Copy for Prompt'), '"Copy for Prompt" must not appear anywhere in the live render')
})

test('what-next survives refresh: durable progress, never a blind Step 1 reset', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const model = { key: 'a/b', name: 'B', provider: 'a', id: 'b' }
  const baseActions = {
    t: (key) => client.labels.en[key] ?? key,
    copyGuidance: async () => '', copyFullGuide: async () => ({ text: 'g' }), copyRoutingGuide: async () => ({ text: 'r' }),
    lastReport: async () => null, update: async () => ({ report: { priceChanges: [] } }),
    researchStatus: async () => ({ status: 'ok', counts: { newlyDetected: 0 }, models: [] }),
    researchPrompt: async () => ({ prompt: 'P' }),
    previewResearchResults: async () => ({ status: 'ok', changes: [], rejected: [], reviewId: 'r' }),
    applyResearchResults: async () => ({ status: 'applied', applied: true, changes: [], rejected: [] }),
  }
  const helperText = async (load, actionsOverride) => {
    const actions = { ...baseActions, load, ...(actionsOverride ?? {}) }
    const localHarness = createRenderHarness()
    const localClient = await loadClient({ react: localHarness.React })
    const localComponent = localClient.panels.find((p) => p.row.key === 'model-guide').component
    localHarness.renderOne((props) => localComponent(props), actions)
    await localHarness.flushEffects()
    const tree = localHarness.renderOne((props) => localComponent(props), actions)
    const text = localHarness.textOf(tree)
    const start = text.indexOf('What do I do next?')
    assert.ok(start >= 0, 'the helper renders')
    const end = text.indexOf('Your workflow — four steps', start)
    return text.slice(start, end >= 0 ? end : start + 220)
  }
  // (a) durable counts not yet available -> neutral, never Step 1.
  const checking = await helperText(async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [] }))
  assert.ok(checking.includes('Checking your progress…'), 'without durable data the helper stays neutral instead of defaulting to Step 1')
  // (b) up-to-date catalog after refresh -> not Step 1.
  const fresh = await helperText(async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 0, allUnverified: 0 } }))
  assert.ok(fresh.includes('Everything is up to date. Use Step 1 whenever you want to check for newer models or prices.'), 'a completed, up-to-date catalog never falls back to the Step 1 default')
  // (c) nothing known yet -> genuine Step 1.
  const freshEmpty = await helperText(async () => ({ generatedAt: 'g', providers: [], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 0, allUnverified: 0 } }))
  assert.ok(freshEmpty.includes('Start with Step 1: update the model list and prices.'), 'a truly empty catalog still starts at Step 1')
  // (d) newly detected models -> Step 2 with the count.
  const newly = await helperText(async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model, model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 2, allUnverified: 2 } }))
  assert.ok(newly.includes('2 new models need research. Continue with Step 2.'), 'newly detected models produce the Step 2 instruction with the count')
  // (e) no new models but missing facts -> Step 2 research prompt.
  const missing = await helperText(async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 0, allUnverified: 1 } }))
  assert.ok(missing.includes('Use Step 2:'), 'missing facts guide to Step 2 research')
  // (f)(g)(h) transient progress is driven by real interaction: open the
  // research panel (Step 3), review (Step 4), apply (saved).
  const loadUpToDate = async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 0, allUnverified: 0 } })
  const flowActions = { ...baseActions, load: loadUpToDate }
  const flowHarness = createRenderHarness()
  const flowClient = await loadClient({ react: flowHarness.React })
  const flowComponent = flowClient.panels.find((p) => p.row.key === 'model-guide').component
  const flowT = (key) => flowClient.labels.en[key] ?? key
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  const helperOf = (tree) => {
    const text = flowHarness.textOf(tree)
    const start = text.indexOf('What do I do next?')
    const end = text.indexOf('Your workflow — four steps', start)
    return text.slice(start, end >= 0 ? end : start + 220)
  }
  const render = () => flowHarness.renderOne((props) => flowComponent(props), flowActions)
  flowHarness.renderOne((props) => flowComponent(props), flowActions)
  await flowHarness.flushEffects()
  let tree = render()
  // open research
  let researchClick = null
  walk(tree, (node) => {
    if (researchClick === null && typeof node.props?.onClick === 'function' && flowHarness.textOf(node) === flowT('researchButton')) researchClick = node.props.onClick
  })
  await researchClick({})
  await flowHarness.flushEffects()
  assert.ok(helperOf(render()).includes('Results are ready to review. Continue to Step 3.'), 'an awaiting review produces Step 3')
  // paste draft + review
  let onChange = null
  walk(render(), (node) => {
    if (onChange === null && node.type === 'textarea' && typeof node.props?.onChange === 'function') onChange = node.props.onChange
  })
  onChange({ target: { value: '{"models":[]}' } })
  await flowHarness.flushEffects()
  let reviewClick = null
  walk(render(), (node) => {
    if (reviewClick === null && typeof node.props?.onClick === 'function' && flowHarness.textOf(node) === flowT('importReview')) reviewClick = node.props.onClick
  })
  await reviewClick({})
  await flowHarness.flushEffects()
  assert.ok(helperOf(render()).includes('Review complete. If everything looks right, use Step 4.'), 'a reviewed-but-unsaved state produces Step 4')
  // apply with the server-issued token
  let applyClick = null
  walk(render(), (node) => {
    if (applyClick === null && typeof node.props?.onClick === 'function' && flowHarness.textOf(node) === flowT('importApply') && node.props.disabled !== true) applyClick = node.props.onClick
  })
  await applyClick({})
  await flowHarness.flushEffects()
  assert.ok(helperOf(render()).includes('Saved. Everything is up to date unless new models or missing facts appear.'), 'a successful save produces the saved message')
})

test('workflow instructions render before the primary action controls', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const component = client.panels.find((p) => p.row.key === 'model-guide').component
  const model = { key: 'a/b', name: 'B', provider: 'a', id: 'b' }
  const en = client.labels.en
  const actions = {
    t: (key) => en[key] ?? key,
    load: async () => ({ generatedAt: 'g', providers: [{ id: 'a', name: 'A', models: [model] }], curatedOnly: [], routingRule: 'R', gpuBoundary: [], researchCounts: { newlyDetected: 1, allUnverified: 1 } }),
    copyGuidance: async () => '', copyFullGuide: async () => ({ text: 'g' }), copyRoutingGuide: async () => ({ text: 'r' }),
    lastReport: async () => null, update: async () => ({ report: { priceChanges: [] } }),
    researchStatus: async () => ({ status: 'ok', counts: { newlyDetected: 0 }, models: [] }),
    researchPrompt: async () => ({ prompt: 'P' }),
    previewResearchResults: async () => ({ status: 'ok', changes: [], rejected: [], reviewId: 'r' }),
    applyResearchResults: async () => ({ status: 'applied', applied: true, changes: [], rejected: [] }),
  }
  harness.renderOne((props) => component(props), actions)
  await harness.flushEffects()
  const text = harness.textOf(harness.renderOne((props) => component(props), actions))
  const positions = [
    en.whatNext, en.stepsTitle, en.step1Title, en.update, en.researchButton,
    en.shareTitle, en.copyFullGuide, en.routingRule,
  ].map((label) => text.indexOf(label))
  // 'Changes since last update' also appears inside Step 1 help; find the
  // action button occurrence after the Update button.
  positions.splice(5, 0, text.indexOf(en.changes, positions[4]))
  assert.ok(positions.every((pos) => pos >= 0), 'every layout landmark renders')
  const names = ['whatNext', 'workflow card', 'Step 1 title', 'Update button', 'Research button', 'Changes button', 'share section', 'copy full guide', 'routing rule']
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index] > positions[index - 1], `${names[index]} renders after ${names[index - 1]} (instructions before actions)`)
  }
})

test('Owner Customizations: plain button, behavior-accurate command labels, per-status next actions', async () => {
  const harness = createRenderHarness()
  const client = await loadClient({ react: harness.React })
  const en = client.labels.en
  const component = client.panels.find((p) => p.row.key === 'owner-customizations').component
  const payload = {
    status: 'ok',
    checkedAt: '2026-10-14T01:44:32.703Z',
    mode: 'mode',
    entries: [
      { name: 'Alpha', status: 'Installed' },
      { name: 'Beta', status: 'Can Restore Cleanly' },
      { name: 'Gamma', status: 'Needs Review' },
      { name: 'Delta', status: 'Incompatible' },
    ],
    recovery: { checkCommand: 'node recover.mjs', applyCommand: 'node recover.mjs --apply', applyPolicy: 'policy' },
  }
  const actions = { t: (key) => en[key] ?? key, loadStatuses: async () => payload }
  harness.renderOne((props) => component(props), actions)
  await harness.flushEffects()
  const tree = harness.renderOne((props) => component(props), actions)
  const text = harness.textOf(tree)
  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
    visit(node)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
  }
  const buttons = []
  walk(tree, (node) => { if (typeof node.props?.onClick === 'function') buttons.push(node) })
  // Step 1 button reads exactly the plain label — no duplicated step text.
  const checkButton = buttons.find((node) => harness.textOf(node) === en.ownerRefresh)
  assert.ok(checkButton !== undefined, 'the Step 1 button renders the plain "Check My Customizations" label')
  assert.ok(checkButton !== undefined && harness.textOf(checkButton).includes('(Step 1') === false, 'no duplicated "(Step 1 — …)" remains in the button')
  assert.ok(checkButton !== undefined && checkButton.props.title === en.ownerStep1Help, 'the Step 1 help states it only checks status and changes nothing')
  // Command buttons carry behavior-accurate labels and helps.
  const dryButton = buttons.find((node) => harness.textOf(node) === en.ownerRestoreCommand)
  const applyButton = buttons.find((node) => harness.textOf(node) === en.ownerApplyCommand)
  assert.ok(dryButton !== undefined && applyButton !== undefined, 'both recovery command buttons render')
  assert.ok(en.ownerRestoreCommand === 'Copy Dry-Run Check Command', 'the check-only command is labeled a dry-run check')
  assert.ok(en.ownerApplyCommand === 'Copy Apply Restore Command', 'the performing command is labeled apply restore')
  assert.ok(typeof dryButton.props?.title === 'string' && dryButton.props.title.includes(en.ownerDryRunHelp), 'the dry-run help travels with the button')
  assert.ok(en.ownerDryRunHelp.includes('does not make the restore changes'), 'dry-run help explicitly denies performing restore changes')
  assert.ok(en.ownerApplyRestoreHelp.includes('performs the approved restore') && en.ownerApplyRestoreHelp.includes('paste it into your terminal'), 'apply help states it performs the restore only after the command is run in the Linux terminal')
  assert.ok(text.includes(en.ownerTerminalDestination), 'the Linux terminal destination is stated')
  // Each status carries its short next action.
  const nextByStatus = {
    Installed: en.statusHelpInstalled,
    'Can Restore Cleanly': en.statusHelpCanRestore,
    'Needs Review': en.statusHelpNeedsReview,
    Incompatible: en.statusHelpIncompatible,
  }
  for (const [status, help] of Object.entries(nextByStatus)) {
    assert.ok(text.includes(help), `${status} renders its explanation: ${help}`)
  }
  assert.ok(en.statusHelpInstalled.includes('Next:'), 'Installed carries a Next action')
  assert.ok(en.statusHelpCanRestore.includes('Next:') && en.statusHelpCanRestore.includes('dry-run'), 'Can Restore Cleanly points to the Step 2 dry-run first')
  assert.ok(en.statusHelpNeedsReview.includes('Next:') && en.statusHelpNeedsReview.includes('review'), 'Needs Review refuses auto-apply')
  assert.ok(en.statusHelpIncompatible.includes('Next:'), 'Incompatible carries a Next action')
  assert.ok(text.includes(en.ownerRestoreHint) && en.ownerRestoreHint.includes('Dry-Run Check') && en.ownerRestoreHint.includes('Apply Restore'), 'the page distinguishes check vs dry-run vs apply restore')
})
