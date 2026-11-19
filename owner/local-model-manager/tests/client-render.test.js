/**
 * Panel render regression: every state renders visible content — loading,
 * full snapshot, load failure, mount failure, refused plan, planned action
 * with required acknowledgment, executed outcome with the real launcher
 * report, and the GPU-unavailable note — with hook order staying stable.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './load-client.js'
import { createRenderHarness } from './render-harness.js'

/** One realistic snapshot payload: Qwen3.5 running behind pending 64k change. */
const SNAP = {
  generatedAt: '2026-10-14T13:00:00Z',
  endpoint: 'http://127.0.0.1:8001',
  server: { state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, slots: [{ id: 0, context: 32768, busy: false }] },
  models: [
    {
      key: 'qwen35', name: 'Qwen3.5 27B Q5_K_M', installed: true, diskBytes: 19 * 1024 ** 3,
      engine: { id: 'llama.cpp', verified: true, note: 'started by the trusted launcher with tested settings' },
      configContext: 65536, liveContext: 32768, reasoningEfforts: ['low', 'medium', 'high'],
      vision: false, multiPart: false, gpu: { name: 'RTX 3090', uuid: 'GPU-CASE', role: 'case' },
      runtime: 'running',
      profiles: [
        { id: 'reliable', label: 'Reliable — One Job', available: true, reason: 'r1', requirement: 'req' },
        { id: 'multipleJobs', label: 'Multiple Jobs', available: false, reason: 'r2', requirement: 'req' },
        { id: 'longResearch', label: 'Long Research', available: true, pendingRestart: true, reason: 'r3', requirement: 'req' },
        { id: 'advanced', label: 'Advanced', available: true, reason: 'r4', requirement: 'req' },
      ],
      recommendations: ['Best for one demanding job', 'Runs on My Case GPU only.'],
    },
    {
      key: 'flash', name: 'Qwen3.8 Flash Next IQ4_XS', installed: false, installProblem: 'model file not found',
      engine: { id: 'llama.cpp', verified: true, note: 'Flash Next launcher variant' },
      vision: false, multiPart: true, gpu: { name: 'RTX 3090', uuid: 'GPU-CASE', role: 'case' },
      runtime: 'stopped', profiles: [], recommendations: [],
    },
  ],
  gpus: [
    { name: 'RTX 3090 Ti', uuid: 'GPU-P', role: 'preferred', status: 'ok', memUsedMiB: 23000, memTotalMiB: 24576, powerDrawW: 318.4, powerLimitW: 450, launchReserved: false, preferredLaunchTarget: true, processes: [] },
    { name: 'RTX 3090', uuid: 'GPU-CASE', role: 'secondary', status: 'ok', memUsedMiB: 18743, memTotalMiB: 24576, utilizationPct: 42, powerDrawW: 305.2, powerLimitW: 350, launchReserved: false, preferredLaunchTarget: false, processes: [{ pid: 1234, processName: 'llama-server' }] },
  ],
  gpuQueryStatus: 'ok',
  backends: [
    { id: 'llama.cpp', label: 'llama.cpp', status: 'verified', note: 'n1', evidence: 'e1' },
    { id: 'vllm', label: 'vLLM', status: 'not-configured', note: 'n2', evidence: 'e2' },
  ],
  errors: [{ at: 't1', action: 'switch', status: 'failed', detail: 'x' }],
}
const GiB = 1024 ** 3

/** Render the Page component via the mount loader with the render harness. */
const renderPage = async ({ snapshot, rejection, launchPlan, adoptPlan } = {}) => {
  const harness = createRenderHarness()
  const svcValue = async (method, ...args) => {
    if (method === 'snapshot') return { ok: true, value: snapshot ?? SNAP }
    if (method === 'planAction') return { ok: true, value: rejection ?? { status: 'planned', action: 'stop', impact: 'i', activeJobs: [{ slot: 0, task: 1 }], requiresAcknowledge: true, confirmToken: 'tok1' } }
    if (method === 'confirmAction') return { ok: true, value: { status: 'ok', action: 'stop', output: 'Port 8001 is clear.' } }
    if (method === 'planLaunch') return { ok: true, value: launchPlan ?? { status: 'refused', reason: 'no profiles configured' } }
    if (method === 'confirmLaunch') return { ok: true, value: { status: 'ok', profileId: args[0] } }
    if (method === 'planAdoptInstance') return { ok: true, value: adoptPlan ?? { status: 'refused', reason: 'no adopt plan configured' } }
    if (method === 'confirmAdoptInstance') return { ok: true, value: { status: 'ok', port: args[0], message: 'Adopted.' } }
    return { ok: true, value: { errors: [] } }
  }
  const modelManager = Object.fromEntries(['snapshot', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'addDiscoveryDir', 'planAdoptInstance', 'confirmAdoptInstance'].map((method) =>
    [method, async (...args) => await svcValue(method, ...args)]))
  const { slots } = await loadClient({ modelManager, react: harness.React })
  const panel = slots.find((s) => s.slot === 'main').value
  const injected = panel.inject()
  const t = (key) => `«${key}»`
  const Page = panel.component
  const props = { ...injected, t }
  const loader = (p) => Page(p)
  harness.renderOne(loader, props)
  await harness.flushEffects()
  return { harness, element: harness.renderOne(loader, props), rerender: () => harness.renderOne(loader, props) }
}

test('the full snapshot renders models, modes, GPUs, engines, and errors', async ({ t: tt }) => {
  const { harness, element } = await renderPage()
  await harness.flushEffects()
  const text = harness.textOf(element)
  // The running model and the missing one are both named with their states.
  assert.match(text, /Qwen3\.5 27B Q5_K_M/)
  assert.match(text, /Qwen3\.8 Flash Next IQ4_XS/)
  assert.match(text, /«runtimeRunning»/)
  assert.match(text, /«missing»/)
  // Configured vs live context are shown with their sources.
  assert.match(text, /«configContext»/)
  assert.match(text, /«liveContext»/)
  // With no owner reservation, every GPU shows the available badge and note.
  assert.match(text, /RTX 3090 Ti/)
  assert.match(text, /«gpuReleasedBadge»/)
  assert.match(text, /«generalNote»/)
  // The preferred launch target badge marks the RTX 3090 Ti.
  assert.match(text, /«preferredTargetBadge»/)
  // Live wattage is shown per card with its limit, one decimal for the draw.
  assert.match(text, /«powerDraw»/)
  assert.match(text, /318\.4 W \/ 450 W limit/)
  assert.match(text, /305\.2 W \/ 350 W limit/)
  // Engines: verified default and the unconfigured one.
  assert.match(text, /«engVerified»/)
  assert.match(text, /«engNotConfigured»/)
  // Profiles, modes, and errors render.
  assert.match(text, /«profiles»/)
  assert.match(text, /«modesTitle»/)
  assert.match(text, /«errorsTitle»/)
  // The disabled Multiple Jobs row explains itself.
  assert.match(text, /«disabled»/)
})

test('planning a disruptive action explains the impact and gates confirmation behind acknowledgment', async () => {
  const { harness, element, rerender } = await renderPage()
  await harness.flushEffects()
  // Click the running model's enabled Stop button; the plan dialog must open.
  const stop = collectButtons(element).find((b) => b.props.children === '«stopLabel»' && b.props.disabled === false)
  assert.ok(stop, 'the running model must offer an enabled Stop button')
  await stop.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  const text = harness.textOf(tree)
  // The planned dialog shows impact, the job list, and the disabled confirm
  // (acknowledgment is required first — modeled by the disabled flag).
  assert.match(text, /«planTitle»/)
  assert.match(text, /«planImpact»/)
  assert.match(text, /«busyNow»/)
  assert.match(text, /«acknowledge»/)
  const confirm = collectButtons(tree).find((b) => b.props.children === '«confirmExecute»')
  assert.ok(confirm, 'the planned dialog must offer the confirm button')
  assert.equal(confirm.props.disabled, true)
})

test('a refusal renders its plain-language reason', async () => {
  const { harness, element, rerender } = await renderPage({ rejection: { status: 'refused', reason: 'cannot safely verify whether work is running' } })
  await harness.flushEffects()
  const stop = collectButtons(element).find((b) => b.props.children === '«stopLabel»' && b.props.disabled === false)
  await stop.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  assert.match(harness.textOf(tree), /cannot safely verify whether work is running/)
  assert.match(harness.textOf(tree), /«actionRefused»/)
})

test('load failure keeps a retry path instead of a blank panel', async () => {
  const harness = createRenderHarness()
  const modelManager = Object.fromEntries(['snapshot', 'planAction', 'confirmAction', 'recentErrors'].map((method) =>
    [method, async () => { throw new Error('snapshot failed') }]))
  const { slots } = await loadClient({ modelManager, react: harness.React })
  const panel = slots.find((s) => s.slot === 'main').value
  const props = { ...panel.inject(), t: (k) => `«${k}»` }
  const loader = (p) => panel.component(p)
  harness.renderOne(loader, props)
  await harness.flushEffects()
  const element = harness.renderOne(loader, props)
  const text = harness.textOf(element)
  assert.match(text, /«loadFailed»/)
  assert.match(text, /«retry»/)
})

test('no launch profiles configured shows the empty-state message', async () => {
  const snapNoProfiles = { ...SNAP, launchProfiles: [] }
  const { harness, element } = await renderPage({ snapshot: snapNoProfiles })
  await harness.flushEffects()
  const text = harness.textOf(harness.renderOne((p) => element, {}))
  // The section heading and empty-state hint must both appear.
  assert.match(text, /«launchProfilesTitle»/)
  assert.match(text, /«launchProfilesEmpty»/)
})

test('launch profiles present render each profile card with a launch button', async () => {
  const snapWithProfile = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'lp-1', engineId: 'llama.cpp', engineVersion: 'v1', modelKey: 'qwen35', modelName: 'Qwen3.5 27B Q5_K_M', gpuUuids: ['GPU-CASE'], gpuMode: 'single', gpuName: 'RTX 3090', launchArgs: ['--ctx-size', '65536'], label: 'Q5 65K' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapWithProfile })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /Q5 65K/)
  assert.match(text, /Qwen3\.5 27B Q5_K_M/)
  // The profile card must contain a launch button.
  const launchBtn = collectButtons(element).find((b) => b.props.children === '«launchLabel»')
  assert.ok(launchBtn, 'profile card must have a launch button')
})

test('clicking a launch profile button opens the launch plan dialog', async () => {
  const snapWithProfile = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'lp-2', engineId: 'llama.cpp', engineVersion: 'v1', modelKey: 'flash', modelName: 'Flash', gpuUuids: ['GPU-CASE'], gpuMode: 'single', gpuName: 'RTX 3090', launchArgs: [], label: 'Flash single' },
    ],
  }
  const launchPlan = { status: 'planned', profileId: 'lp-2', engineId: 'llama.cpp', engineVersion: 'v1', modelName: 'Flash', gpuUuids: ['GPU-CASE'], gpuMode: 'single', gpuName: 'RTX 3090', launchArgs: [], label: 'Flash single', impact: 'Flash will be started on RTX 3090.', confirmToken: 'tok-lp', expiresInMs: 300000 }
  const { harness, element, rerender } = await renderPage({ snapshot: snapWithProfile, launchPlan })
  await harness.flushEffects()
  const launchBtn = collectButtons(element).find((b) => b.props.children === '«launchLabel»')
  assert.ok(launchBtn, 'must have a launch button')
  await launchBtn.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  const text = harness.textOf(tree)
  assert.match(text, /«launchPlanTitle»/)
  assert.match(text, /Flash will be started on RTX 3090\./)
  const confirmBtn = collectButtons(tree).find((b) => b.props.children === '«confirmLaunchLabel»')
  assert.ok(confirmBtn, 'launch plan dialog must offer the confirm button')
})

test('a launch refusal renders its plain-language reason', async () => {
  const snapWithProfile = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'lp-3', engineId: 'llama.cpp', engineVersion: 'v1', modelKey: 'qwen27', modelName: 'Qwen 27B', gpuUuids: ['GPU-CASE'], gpuMode: 'single', gpuName: 'RTX 3090', launchArgs: [], label: 'Q8 default' },
    ],
  }
  const { harness, element, rerender } = await renderPage({ snapshot: snapWithProfile, launchPlan: { status: 'refused', reason: 'another model is already running' } })
  await harness.flushEffects()
  const launchBtn = collectButtons(element).find((b) => b.props.children === '«launchLabel»')
  assert.ok(launchBtn, 'must have a launch button')
  await launchBtn.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  const text = harness.textOf(tree)
  assert.match(text, /another model is already running/)
  assert.match(text, /«actionRefused»/)
})

test('the Page outer element establishes a scroll container', async () => {
  const { element } = await renderPage()
  // The outer div must carry overflow: auto and height: 100% so it scrolls
  // inside centerCol (AppFrame.module.css), which is overflow: hidden.
  assert.equal(element.props.style.overflow, 'auto')
  assert.equal(element.props.style.height, '100%')
})

test('discovery section renders candidate name and badge when discovery is present', async () => {
  const snapWithDiscovery = {
    ...SNAP,
    discovery: {
      version: 1,
      generatedAt: '2026-10-22T00:00:00.000Z',
      roots: [{
        root: '/models/gguf',
        status: 'ok',
        candidates: [
          { path: '/models/gguf/New/New-Q4_K_M.gguf', name: 'New-Q4_K_M', sizeBytes: 21 * GiB, multiPart: false, totalShards: 1 },
        ],
        subdirErrors: [],
        truncated: false,
      }],
    },
  }
  const { harness, element } = await renderPage({ snapshot: snapWithDiscovery })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«discoveredTitle»/)
  assert.match(text, /New-Q4_K_M/)
  assert.match(text, /«discoveredCandidate»/)
})

test('discovery section is absent when snap.discovery is null or undefined', async () => {
  // Explicit null
  const { harness: h1, element: e1 } = await renderPage({ snapshot: { ...SNAP, discovery: null } })
  await h1.flushEffects()
  assert.doesNotMatch(h1.textOf(e1), /«discoveredTitle»/)
  // Undefined (absent from snapshot)
  const snapNoDisc = { ...SNAP }
  delete snapNoDisc.discovery
  const { harness: h2, element: e2 } = await renderPage({ snapshot: snapNoDisc })
  await h2.flushEffects()
  assert.doesNotMatch(h2.textOf(e2), /«discoveredTitle»/)
})

test('discovery section shows empty-state message when all roots have no candidates', async () => {
  const snapEmptyDiscovery = {
    ...SNAP,
    discovery: {
      version: 1,
      generatedAt: '2026-10-22T00:00:00.000Z',
      roots: [{ root: '/models/gguf', status: 'ok', candidates: [], subdirErrors: [], truncated: false }],
    },
  }
  const { harness, element } = await renderPage({ snapshot: snapEmptyDiscovery })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«discoveredNone»/)
})

test('add directory section renders when snap includes userDiscoveryDirs', async () => {
  const snapWithUserDirs = {
    ...SNAP,
    userDiscoveryDirs: { dirs: ['/user/added/dir'] },
  }
  const { harness, element } = await renderPage({ snapshot: snapWithUserDirs })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«addDirTitle»/)
  assert.match(text, /«addDirHint»/)
  assert.match(text, /\/user\/added\/dir/)
  assert.match(text, /«addDirUserLabel»/)
})

test('add directory section shows empty-state when userDiscoveryDirs.dirs is empty', async () => {
  const snapNoDirs = {
    ...SNAP,
    userDiscoveryDirs: { dirs: [] },
  }
  const { harness, element } = await renderPage({ snapshot: snapNoDirs })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«addDirTitle»/)
  assert.match(text, /«addDirNone»/)
})

test('add directory section is absent when snap.userDiscoveryDirs is undefined', async () => {
  const snapNoUserDirs = { ...SNAP }
  delete snapNoUserDirs.userDiscoveryDirs
  const { harness, element } = await renderPage({ snapshot: snapNoUserDirs })
  await harness.flushEffects()
  assert.doesNotMatch(harness.textOf(element), /«addDirTitle»/)
})

test('GPU selection section is absent when no profiles match a model key', async () => {
  // SNAP has no launchProfiles; GPU selection sections must not appear.
  const { harness, element } = await renderPage()
  await harness.flushEffects()
  assert.doesNotMatch(harness.textOf(element), /«gpuSelectionTitle»/)
})

test('a card without a reported wattage says so instead of inventing a number', async () => {
  const snapNoPower = {
    ...SNAP,
    gpus: SNAP.gpus.map((g) => ({ ...g, powerDrawW: null, powerLimitW: null })),
  }
  const { harness, element } = await renderPage({ snapshot: snapNoPower })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«powerDraw»/)
  assert.match(text, /«powerNotReported»/)
  // No watt value may be fabricated for either card.
  assert.doesNotMatch(text, /\d+(?:\.\d+)? W/, 'an unreadable card must not render a watt value')
})

test('a card with a limit but no draw shows the limit and the missing reading', async () => {
  const snapLimitOnly = {
    ...SNAP,
    gpus: SNAP.gpus.map((g) => ({ ...g, powerDrawW: null, powerLimitW: 350 })),
  }
  const { harness, element } = await renderPage({ snapshot: snapLimitOnly })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«powerNotReported» \/ 350 W limit/)
  assert.doesNotMatch(text, /\d+\.\d W \//, 'no invented draw value may appear before the limit')
})

test('a card whose query failed does not render a power row', async () => {
  const snapUnavailable = {
    ...SNAP,
    gpus: [
      { name: 'RTX 3090 Ti', uuid: 'GPU-P', role: 'preferred', status: 'unavailable', error: 'nvidia-smi unavailable', launchReserved: false, preferredLaunchTarget: true, processes: [] },
    ],
    gpuQueryStatus: 'unavailable',
    gpuQueryError: 'nvidia-smi unavailable',
  }
  const { harness, element } = await renderPage({ snapshot: snapUnavailable })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«gpuUnavailable»/)
  assert.doesNotMatch(text, /«powerDraw»/, 'a failed query renders the error row, not a power row')
})

test('GPU selection section renders per-model when profiles are present', async () => {
  // A Ti profile for qwen35; GPU-P in SNAP; the owner manually reserved it.
  const snapWithTiProfile = {
    ...SNAP,
    gpus: SNAP.gpus.map((g) => g.uuid === 'GPU-P' ? { ...g, launchReserved: true } : g),
    launchProfiles: [
      { profileId: 'q35-ti', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', modelName: 'Qwen3.5 27B Q5_K_M', gpuUuids: ['GPU-P'], gpuMode: 'single', gpuName: 'RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — RTX 3090 Ti' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapWithTiProfile })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /«gpuSelectionTitle»/)
  assert.match(text, /«gpuSelectionHint»/)
  // The button label is the profile's gpuName.
  const tiBtn = collectButtons(element).find((b) => b.props.children === 'RTX 3090 Ti')
  assert.ok(tiBtn, 'must render a GPU selection button for RTX 3090 Ti')
  // With launchReserved: true on the Ti row, the button must be disabled.
  assert.equal(tiBtn.props.disabled, true, 'Ti button must be disabled while a manual reservation holds')
  // Reservation note must appear.
  assert.match(text, /«gpuSelectionReserved»/)
})

test('GPU selection Ti button is enabled when the protected GPU reservation is released', async () => {
  const snapTiReleased = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'q35-ti', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', modelName: 'Qwen3.5 27B Q5_K_M', gpuUuids: ['GPU-P'], gpuMode: 'single', gpuName: 'RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — RTX 3090 Ti' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapTiReleased })
  await harness.flushEffects()
  const tiBtn = collectButtons(element).find((b) => b.props.children === 'RTX 3090 Ti')
  assert.ok(tiBtn, 'must render a GPU selection button for RTX 3090 Ti')
  assert.equal(tiBtn.props.disabled, false, 'Ti button must be enabled when reservation is released')
  // Reservation note must not appear.
  assert.doesNotMatch(harness.textOf(element), /«gpuSelectionReserved»/)
})

test('GPU selection button click triggers planLaunch for that profile', async () => {
  const snapWithTiProfile = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'q35-ti', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', modelName: 'Qwen3.5 27B Q5_K_M', gpuUuids: ['GPU-P'], gpuMode: 'single', gpuName: 'RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — RTX 3090 Ti' },
    ],
  }
  const launchPlan = { status: 'planned', profileId: 'q35-ti', engineId: 'llama.cpp', engineVersion: 'stable', modelName: 'Qwen3.5 27B Q5_K_M', gpuUuids: ['GPU-P'], gpuMode: 'single', gpuName: 'RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — RTX 3090 Ti', impact: 'Qwen3.5 will be started on RTX 3090 Ti.', confirmToken: 'tok-ti', expiresInMs: 300000 }
  const { harness, element, rerender } = await renderPage({ snapshot: snapWithTiProfile, launchPlan })
  await harness.flushEffects()
  const tiBtn = collectButtons(element).find((b) => b.props.children === 'RTX 3090 Ti')
  assert.ok(tiBtn, 'must have an enabled Ti GPU selection button')
  await tiBtn.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  const text = harness.textOf(tree)
  // The launch plan dialog must open.
  assert.match(text, /«launchPlanTitle»/)
  assert.match(text, /Qwen3.5 will be started on RTX 3090 Ti\./)
})

// ---------------------------------------------------------------------------
// Qualification labels in GPU selection (Phase 2A correction)
// ---------------------------------------------------------------------------

test('RTX 3090 profile notes display Verified in the GPU selection section', async () => {
  const snapCase = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'q35-case', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', gpuUuids: ['GPU-CASE'], gpuMode: 'single', gpuName: 'RTX 3090', launchArgs: [], label: 'Qwen3.5 — RTX 3090', notes: 'Verified — uses the production RTX 3090 launch path.' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapCase })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /Verified/, 'RTX 3090 profile must display "Verified" in the GPU selection section')
  assert.doesNotMatch(text, /Unverified/, 'RTX 3090 profile must not display "Unverified"')
})

test('RTX 3090 Ti profile notes display Unverified in the GPU selection section', async () => {
  const snapTi = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'q35-ti', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', gpuUuids: ['GPU-P'], gpuMode: 'single', gpuName: 'RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — RTX 3090 Ti', notes: 'Unverified — supervised launch required. Reservation must be released in My Graphics Cards first.' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapTi })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /Unverified/, 'RTX 3090 Ti profile must display "Unverified" in the GPU selection section')
  assert.match(text, /supervised launch required/, 'must include supervised-launch note')
  assert.doesNotMatch(text, /Verified — uses the production/, 'must not display the RTX 3090 verified note')
})

test('Both-GPU profile notes display Unverified in the GPU selection section', async () => {
  const snapBoth = {
    ...SNAP,
    launchProfiles: [
      { profileId: 'q35-both', engineId: 'llama.cpp', engineVersion: 'stable', modelKey: 'qwen35', gpuUuids: ['GPU-CASE', 'GPU-P'], gpuMode: 'both', gpuName: 'RTX 3090, RTX 3090 Ti', launchArgs: [], label: 'Qwen3.5 — Both GPUs', notes: 'Unverified — supervised launch required. Uses RTX 3090 + RTX 3090 Ti. Reservation must be released first.' },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapBoth })
  await harness.flushEffects()
  const text = harness.textOf(element)
  assert.match(text, /Unverified/, 'Both-GPU profile must display "Unverified" in the GPU selection section')
  assert.match(text, /supervised launch required/, 'must include supervised-launch note')
})

// ---------------------------------------------------------------------------
// Multi-instance ModelCard Stop buttons — Job 9 regression tests
// ---------------------------------------------------------------------------

/** Snapshot with two instances: port 8001 stopped, port 8002 running qwen35. */
const SNAP_MULTI = {
  ...SNAP,
  server: undefined,
  servers: [
    { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped' },
    { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false },
  ],
  models: [
    {
      ...SNAP.models[0],
      runtime: 'running',
      runningOnPorts: [8002],
    },
    SNAP.models[1],
  ],
}

test('multi-instance ModelCard renders per-instance Stop buttons and Start buttons', async () => {
  const { harness, element } = await renderPage({ snapshot: SNAP_MULTI })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  const isDanger = (b) => b.props?.style?.color === 'var(--dsw-static-red-500, red)'
  // The stopped instance must offer "«startOnGpu» RTX 3090".
  const startBtn = buttons.find((b) => typeof b.props.children === 'string' && b.props.children.includes('RTX 3090') && !b.props.children.includes('Ti') && !isDanger(b))
  assert.ok(startBtn, 'must render a Start on RTX 3090 button for the stopped instance')
  // The running instance must offer "«stopOnGpu» RTX 3090 Ti".
  const stopBtn = buttons.find((b) => typeof b.props.children === 'string' && b.props.children.includes('RTX 3090 Ti') && isDanger(b))
  assert.ok(stopBtn, 'must render a Stop on RTX 3090 Ti button for the running instance')
})

test('multi-instance MultiServerSection Stop button is disabled for an unowned running server', async () => {
  const snapUnowned = {
    ...SNAP_MULTI,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped', owned: false, actualGpuUuid: null, actualGpuName: null },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, owned: false, actualGpuUuid: null, actualGpuName: null },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapUnowned })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  const isDanger = (b) => b.props?.style?.color === 'var(--dsw-static-red-500, red)'
  // MultiServerSection renders one Stop button per server; both should be disabled:
  // port 8001 (stopped state) and port 8002 (running but unowned).
  const stopBtns = buttons.filter((b) => b.props?.children === '«stopLabel»' && isDanger(b))
  assert.ok(stopBtns.length > 0, 'must render Stop buttons in MultiServerSection')
  assert.ok(stopBtns.every((b) => b.props.disabled === true), 'all Stop buttons must be disabled for unowned servers')
})

test('multi-instance MultiServerSection Stop button is enabled for an owned running server', async () => {
  const snapOwned = {
    ...SNAP_MULTI,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped', owned: true, actualGpuUuid: null, actualGpuName: null },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, owned: true, actualGpuUuid: null, actualGpuName: null },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapOwned })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  const isDanger = (b) => b.props?.style?.color === 'var(--dsw-static-red-500, red)'
  // The running owned server (port 8002) must have an enabled Stop button.
  const enabledStopBtn = buttons.find((b) => b.props?.children === '«stopLabel»' && isDanger(b) && b.props.disabled === false)
  assert.ok(enabledStopBtn, 'must have an enabled Stop button for the owned running server')
})

test('multi-instance ModelCard Stop button passes instancePort to planAction', async () => {
  let planArgs = null
  const harness = createRenderHarness()
  const modelManager = Object.fromEntries(['snapshot', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'addDiscoveryDir'].map((method) =>
    [method, async (...args) => {
      if (method === 'snapshot') return { ok: true, value: SNAP_MULTI }
      if (method === 'planAction') { planArgs = args; return { ok: true, value: { status: 'refused', reason: 'test intercept' } } }
      return { ok: true, value: { errors: [] } }
    }]))
  const { slots } = await loadClient({ modelManager, react: harness.React })
  const panel = slots.find((s) => s.slot === 'main').value
  const props = { ...panel.inject(), t: (k) => `«${k}»` }
  const loader = (p) => panel.component(p)
  harness.renderOne(loader, props)
  await harness.flushEffects()
  const element = harness.renderOne(loader, props)
  const buttons = collectButtons(element)
  const stopBtn = buttons.find((b) => typeof b.props.children === 'string' && b.props.children.includes('RTX 3090 Ti') && b.props?.style?.color === 'var(--dsw-static-red-500, red)')
  assert.ok(stopBtn, 'must have a Stop on RTX 3090 Ti button')
  await stopBtn.props.onClick()
  assert.ok(planArgs !== null, 'planAction must have been called')
  // planAction('stop', { modelKey: 'qwen35', instancePort: 8002 })
  assert.equal(planArgs[0], 'stop', 'must call planAction with action=stop')
  assert.equal(planArgs[1]?.instancePort, 8002, 'must pass instancePort: 8002 to planAction')
})

test('multi-instance MultiServerSection shows switch buttons for owned running server', async () => {
  const snapOwned = {
    ...SNAP_MULTI,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped', owned: true, actualGpuUuid: null, actualGpuName: null },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, owned: true, actualGpuUuid: null, actualGpuName: null },
    ],
    models: [
      { ...SNAP.models[0], runtime: 'running', runningOnPorts: [8002] },
      { ...SNAP.models[1], installed: true },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapOwned })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  // The running owned server (port 8002, running qwen35) must offer a switch button
  // for the other installed model (flash). The switch button is NOT a danger button.
  const isDanger = (b) => b.props?.style?.color === 'var(--dsw-static-red-500, red)'
  const switchBtn = buttons.find((b) => b.props?.children === 'Qwen3.8 Flash Next IQ4_XS' && !isDanger(b))
  assert.ok(switchBtn, 'must render a switch button for the other installed model on the owned running server')
  assert.equal(switchBtn.props.disabled, false, 'switch button must be enabled when server is idle')
})

test('multi-instance MultiServerSection does not show switch buttons for unowned running server', async () => {
  const snapUnowned = {
    ...SNAP_MULTI,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped', owned: false, actualGpuUuid: null, actualGpuName: null },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, owned: false, actualGpuUuid: null, actualGpuName: null },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapUnowned })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  // No button should have the flash model name as its label (switch is blocked).
  const switchBtn = buttons.find((b) => b.props?.children === 'Qwen3.8 Flash Next IQ4_XS')
  assert.equal(switchBtn, undefined, 'must not render a switch button for an unowned server')
})

test('multi-instance MultiServerSection switch button calls planAction with switch + instancePort', async () => {
  let planArgs = null
  const snapOwned = {
    ...SNAP_MULTI,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', state: 'stopped', owned: true, actualGpuUuid: null, actualGpuName: null },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', state: 'running', runningModelKey: 'qwen35', liveContext: 32768, busy: false, owned: true, actualGpuUuid: null, actualGpuName: null },
    ],
    models: [
      { ...SNAP.models[0], runtime: 'running', runningOnPorts: [8002] },
      { ...SNAP.models[1], installed: true },
    ],
  }
  const harness = createRenderHarness()
  const modelManager = Object.fromEntries(['snapshot', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'addDiscoveryDir'].map((method) =>
    [method, async (...args) => {
      if (method === 'snapshot') return { ok: true, value: snapOwned }
      if (method === 'planAction') { planArgs = args; return { ok: true, value: { status: 'refused', reason: 'test intercept' } } }
      return { ok: true, value: { errors: [] } }
    }]))
  const { slots } = await loadClient({ modelManager, react: harness.React })
  const panel = slots.find((s) => s.slot === 'main').value
  const props = { ...panel.inject(), t: (k) => `«${k}»` }
  const loader = (p) => panel.component(p)
  harness.renderOne(loader, props)
  await harness.flushEffects()
  const element = harness.renderOne(loader, props)
  const buttons = collectButtons(element)
  const switchBtn = buttons.find((b) => b.props?.children === 'Qwen3.8 Flash Next IQ4_XS')
  assert.ok(switchBtn, 'must have a switch button for the flash model')
  await switchBtn.props.onClick()
  assert.ok(planArgs !== null, 'planAction must have been called')
  assert.equal(planArgs[0], 'switch', 'must call planAction with action=switch')
  assert.equal(planArgs[1]?.instancePort, 8002, 'must pass instancePort: 8002')
  assert.equal(planArgs[1]?.modelKey, 'flash', 'must pass modelKey: flash')
})

/** Collect {props} of every button element in a rendered tree. */
const collectButtons = (node, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, found)
    return found
  }
  if (node.type === 'button') found.push(node)
  for (const child of (Array.isArray(node.children) ? node.children : [node.children])) collectButtons(child, found)
  return found
}

// ---------------------------------------------------------------------------
// Adopt External Server — client-side button and dialog rendering
// ---------------------------------------------------------------------------

/** Snapshot with two instances: port 8001 running unowned, port 8002 running owned. */
const SNAP_ADOPT = {
  ...SNAP,
  server: undefined,
  servers: [
    { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', actualGpuUuid: 'GPU-CASE', actualGpuName: 'RTX 3090', state: 'running', owned: false, runningModelKey: 'qwen35', liveContext: 32768, busy: false },
    { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', actualGpuUuid: 'GPU-P', actualGpuName: 'RTX 3090 Ti', state: 'running', owned: true, runningModelKey: 'qwen35', liveContext: 32768, busy: false },
  ],
  models: [
    { ...SNAP.models[0], runtime: 'running', runningOnPorts: [8001, 8002] },
    SNAP.models[1],
  ],
}

test('Adopt button is shown for a running unowned server and absent for an owned server', async () => {
  const { harness, element } = await renderPage({ snapshot: SNAP_ADOPT })
  await harness.flushEffects()
  const buttons = collectButtons(element)
  const adoptBtns = buttons.filter((b) => b.props?.children === '«adoptLabel»')
  // Port 8001 is unowned+running → must have an Adopt button.
  assert.equal(adoptBtns.length, 1, 'must render exactly one Adopt button (for the unowned running server)')
})

test('Adopt button is absent for a stopped server', async () => {
  const snapStopped = {
    ...SNAP_ADOPT,
    servers: [
      { port: 8001, gpuUuid: 'GPU-CASE', gpuName: 'RTX 3090', actualGpuUuid: null, actualGpuName: null, state: 'stopped', owned: false },
      { port: 8002, gpuUuid: 'GPU-P', gpuName: 'RTX 3090 Ti', actualGpuUuid: null, actualGpuName: null, state: 'stopped', owned: false },
    ],
  }
  const { harness, element } = await renderPage({ snapshot: snapStopped })
  await harness.flushEffects()
  const adoptBtns = collectButtons(element).filter((b) => b.props?.children === '«adoptLabel»')
  assert.equal(adoptBtns.length, 0, 'must not render Adopt buttons for stopped servers')
})

test('clicking the Adopt button opens the adopt plan dialog', async () => {
  const adoptPlan = {
    status: 'planned',
    port: 8001,
    pid: 3001,
    unitName: 'dsh-model-1792992426410-qwen3.5-27b.service',
    gpuUuid: 'GPU-CASE',
    gpuName: 'RTX 3090',
    modelKey: 'qwen35',
    modelName: 'Qwen3.5 27B Q5_K_M',
    impact: 'Port 8001 (Qwen3.5 27B Q5_K_M on RTX 3090) will be adopted.',
    confirmToken: 'adopt-tok-1',
    expiresInMs: 300000,
  }
  const { harness, element, rerender } = await renderPage({ snapshot: SNAP_ADOPT, adoptPlan })
  await harness.flushEffects()
  const adoptBtn = collectButtons(element).find((b) => b.props?.children === '«adoptLabel»')
  assert.ok(adoptBtn, 'must have an Adopt button for the unowned running server')
  await adoptBtn.props.onClick()
  await harness.flushEffects()
  const tree = rerender()
  const text = harness.textOf(tree)
  assert.match(text, /«adoptPlanTitle»/)
  assert.match(text, /Port 8001.*will be adopted/)
  assert.match(text, /dsh-model-1792992426410-qwen3.5-27b\.service/)
  const confirmBtn = collectButtons(tree).find((b) => b.props?.children === '«adoptConfirmButton»')
  assert.ok(confirmBtn, 'adopt plan dialog must offer the confirm button')
})
/** One measured job: exclusive attribution, full coverage, a boundary split. */
const ELECTRICITY_JOB = {
  measurement: 'gpu-board-energy',
  measurementNote: 'Measured GPU board power from nvidia-smi; excludes CPU, drives, PSU losses, and other system draw. Not wall power.',
  gpuUuid: 'GPU-P',
  gpuName: 'RTX 3090 Ti',
  tariff: { zone: 'America/Toronto', period: 'mid-peak', centsPerKwh: 14.6, season: 'winter', effectiveFrom: '2026-11-01', source: 'OEB' },
  powerDrawW: 318.4,
  powerLimitW: 450,
  centsPerHour: 4.6486,
  sampling: { enabled: true, capacity: 7200, retained: 61, intervalMs: 1000, windowMs: 7200000 },
  job: {
    startedAt: '2026-11-06T17:00:00.000Z',
    endedAt: null,
    open: true,
    runtimeS: 60,
    energyWh: 5,
    costCents: 0.073,
    coverage: 1,
    sampleCount: 61,
    gapCount: 0,
    distinctPids: [4242],
    attribution: 'exclusive',
    approximate: false,
    attributionReasons: [],
    tariffPieces: [
      { period: 'off-peak', centsPerKwh: 9.1, fromMs: 0, toMs: 1000, wh: 2.5, cents: 0.0228 },
      { period: 'mid-peak', centsPerKwh: 14.6, fromMs: 1000, toMs: 2000, wh: 2.5, cents: 0.0365 },
    ],
  },
}

const snapWithElectricity = (electricity) => ({ ...SNAP, electricity })

test('the electricity card reports the live rate, the draw, and the measured job', async () => {
  const { harness, element } = await renderPage({ snapshot: snapWithElectricity(ELECTRICITY_JOB) })
  const text = harness.textOf(element)
  assert.match(text, /«electricityTitle»/)
  assert.match(text, /318\.4 W \/ 450 W limit/, 'the live draw keeps its one-decimal reading')
  assert.match(text, /mid-peak · 14\.6 ¢\/kWh/, 'the applicable period and rate are shown together')
  assert.match(text, /¢0\.07/, 'the job cost is shown in cents')
  assert.match(text, /5\.0 Wh/, 'the measured energy is shown')
  assert.match(text, /60\.0 s/, 'the observed runtime is shown')
  assert.match(text, /100 %/, 'full coverage is stated')
  assert.match(text, /4242/, 'the GPU process id is shown')
  assert.match(text, /mid-peak 2\.5 Wh @ 14\.6 ¢\/kWh/, 'a rate change inside the job is itemized')
  assert.match(text, /«electricityJobRunning»/, 'an open job says it is still running')
  assert.match(text, /«electricityNote»/, 'the measurement class is always stated')
})

test('a shared card is labelled approximate instead of presenting an exact cost', async () => {
  const shared = { ...ELECTRICITY_JOB, job: { ...ELECTRICITY_JOB.job, attribution: 'shared', approximate: true, distinctPids: [4242, 4343] } }
  const { harness, element } = await renderPage({ snapshot: snapWithElectricity(shared) })
  const text = harness.textOf(element)
  assert.match(text, /«electricityAttributionShared»/, 'the approximation is stated in the card')
  assert.match(text, /4242, 4343/, 'both observed process ids are shown')
})

test('a partial measurement says the real total is higher', async () => {
  const partial = { ...ELECTRICITY_JOB, job: { ...ELECTRICITY_JOB.job, attribution: 'partial', approximate: true, coverage: 0.4 } }
  const { harness, element } = await renderPage({ snapshot: snapWithElectricity(partial) })
  const text = harness.textOf(element)
  assert.match(text, /«electricityAttributionPartial»/)
  assert.match(text, /40 %/)
})

test('sampling disabled explains how to enable it and shows no invented job', async () => {
  const off = { ...ELECTRICITY_JOB, sampling: { enabled: false }, job: null }
  const { harness, element } = await renderPage({ snapshot: snapWithElectricity(off) })
  const text = harness.textOf(element)
  assert.match(text, /«electricityDisabled»/)
  assert.doesNotMatch(text, /«electricityJobEnergy»/, 'no energy figure is rendered without measurement')
})

test('a card the driver refused to report shows unavailable, not zero watts', async () => {
  const unreadable = { ...ELECTRICITY_JOB, powerDrawW: null, powerLimitW: null, centsPerHour: null, sampling: { enabled: false }, job: null }
  const { harness, element } = await renderPage({ snapshot: snapWithElectricity(unreadable) })
  const text = harness.textOf(element)
  assert.match(text, /«powerNotReported»/)
  assert.doesNotMatch(text, /0\.0 W/, 'an unreadable draw must never render as zero')
})

test('a snapshot without an electricity block renders no electricity card', async () => {
  const { harness, element } = await renderPage({ snapshot: SNAP })
  assert.doesNotMatch(harness.textOf(element), /«electricityTitle»/)
})
