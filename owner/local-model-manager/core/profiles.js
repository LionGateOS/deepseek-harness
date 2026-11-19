/**
 * Operating profiles and plain-language recommendations. Every availability
 * verdict cites its evidence; unverified or unsupported profiles stay
 * disabled with a reason. Context-per-slot math guards a future multi-slot
 * launcher: total context must cover slots × the profile's per-job context
 * requirement, never silently less.
 */

import { readFileSync } from 'node:fs'

/** Read a small text file; null when it is missing or unreadable. */
const readFileQuietly = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Minimum configured context a model must report for Long Research. */
export const LONG_RESEARCH_MIN_CONTEXT = 65536
/** The per-job context requirement of each profile, in tokens. */
export const PROFILE_PER_JOB_CONTEXT = {
  reliable: 32768,
  multipleJobs: 32768,
  longResearch: 65536,
}

/**
 * Read the launcher's slot switch, from evidence only.
 *
 * The launcher keeps its choice in a `parallel-mode` file beside its logs and
 * offers a `mode` subcommand that prints the same thing. This reads the file
 * directly (no process spawn, so it is safe to call while rendering a panel)
 * and reports exactly what it found:
 *
 *   { supported: true, mode: 'parallel', slots: 4, label: 'PARALLEL (4 conversations at once)' }
 *   { supported: false, reason: '...' }        when the file says one slot
 *   { supported: undefined }                   when nothing could be read
 *
 * @param {{modeFile?: string, maxSlots?: number}} [deps] where to look (tests override it).
 * @param {(path: string) => string|null} [readFile] reader, injectable for tests.
 */
export const readSlotsSupport = (deps = {}, readFile) => {
  const modeFile = deps.modeFile
  if (typeof modeFile !== 'string' || modeFile === '') return { supported: undefined }
  const raw = readFile === undefined ? readFileQuietly(modeFile) : readFile(modeFile)
  if (raw === null || raw === undefined) return { supported: undefined }
  const first = String(raw).split('\n')[0].trim()
  const n = Number.parseInt(first, 10)
  if (!Number.isFinite(n)) return { supported: undefined }
  const max = deps.maxSlots ?? 8
  const slots = Math.min(Math.max(n, 1), max)
  if (slots < 2) {
    return {
      supported: false,
      slots: 1,
      mode: 'single',
      reason: 'The installed launcher has a slot switch and it is set to one job at a time. Open the Strata Control Panel, option 6, to allow several.',
    }
  }
  return {
    supported: true,
    slots,
    mode: 'parallel',
    label: `PARALLEL (${slots} conversations at once)`,
  }
}

/**
 * Engines the plugin knows about. llama.cpp is the only verified engine; the
 * others are honestly labeled from what was actually detected on this system.
 * @param {object} config validated plugin config.
 * @param {{existsVerdict?: 'detected'|'absent'|'unknown'}} [deps] vLLM verdict override for tests.
 */
export const engineSupport = (config, deps = {}) => {
  const verdict = deps.existsVerdict ?? 'unknown'
  return [
    {
      id: 'llama.cpp',
      label: 'llama.cpp (llama-server)',
      status: 'verified',
      evidence: 'the trusted launcher runs this engine today and the endpoint answers',
      note: 'Runs GGUF models on the GPU each launch profile selects; the preferred launch target is the RTX 3090 Ti, with the RTX 3090 as the verified fallback.',
    },
    {
      id: 'vllm',
      label: 'vLLM',
      status: 'not-configured',
      evidence: verdict === 'detected' ? 'the vLLM program is installed, but nothing has verified it can serve these GGUF models' : verdict === 'absent' ? 'vLLM is not installed on this system' : 'installed state could not be verified',
      note: verdict === 'detected'
        ? 'Not configured — requires a supervised verification run before any model offers it. GGUF compatibility for these models is unverified; the multi-part Flash Next archive is not a single-file GGUF load.'
        : 'Not configured. Requires setup and owner approval before use.',
    },
  ]
}

/**
 * Context per slot for a hypothetical multi-slot start.
 * @param {number} totalContext configured total context.
 * @param {number} slots requested parallel slots.
 * @returns {number} context each slot would receive.
 */
export const contextPerSlot = (totalContext, slots) => slots > 0 ? Math.floor(totalContext / slots) : 0

/**
 * Validate a multi-slot plan against the per-job context requirement. The
 * rule: never increase slots so that usable per-job context drops below the
 * profile requirement.
 * @param {number} totalContext configured total context.
 * @param {number} slots requested parallel slots.
 * @param {keyof typeof PROFILE_PER_JOB_CONTEXT} profile profile id.
 * @returns {{ok: boolean, contextPerSlot: number, reason?: string}}
 */
export const validateSlots = (totalContext, slots, profile) => {
  const needed = PROFILE_PER_JOB_CONTEXT[profile] ?? PROFILE_PER_JOB_CONTEXT.reliable
  const per = contextPerSlot(totalContext, slots)
  if (per >= needed) return { ok: true, contextPerSlot: per }
  return { ok: false, contextPerSlot: per, reason: `opening ${slots} simultaneous jobs on ${totalContext} total context leaves only ${per} tokens of context per job — below this profile's ${needed}-token requirement` }
}

/**
 * One capability row per model per operating profile. Availability requires
 * evidence:
 * - reliable: the launcher has a tested start command for the model.
 * - multipleJobs: the launcher now carries a slot switch persisted in a
 *   `parallel-mode` file. When `model.slots` describes that switch, the row
 *   reports it available and names the mode in force; when the slot state is
 *   not supported or unreadable the row stays disabled and explains why.
 * - longResearch: the configured context window is at least the Long
 *   Research minimum AND (for any model whose running context is known) the
 *   active change has taken effect.
 * @param {{key: string, name: string, provider?: object, live?: object, slots?: object}} model merged model row.
 */
export const profileAvailability = (model) => {
  const configured = model.provider?.contextWindow
  const live = model.live?.liveContext
  const slots = model.slots
  const reasoning = model.provider?.reasoningEfforts
  const effortsNote = reasoning === undefined
    ? 'reasoning options were not readable from the provider configuration'
    : Array.isArray(reasoning) && reasoning.length === 0
      ? 'this model line has reasoning disabled in the provider configuration'
      : `supported reasoning levels: ${reasoning.join(', ')} (as configured)`
  const rows = [
    {
      id: 'reliable',
      label: 'Reliable — One Job',
      available: true,
      reason: 'Uses the tested launcher settings: one job, the configured context window, and the verified llama.cpp engine on the CASE GPU.',
      requirement: `needs a context window of at least ${PROFILE_PER_JOB_CONTEXT.reliable.toLocaleString('en')} tokens per job`,
    },
    {
      id: 'multipleJobs',
      label: 'Multiple Jobs',
      available: slots?.supported === true,
      reason: slots?.supported === true
        ? `The installed launcher has a slot switch and it reads ${slots.label}. Up to ${slots.slots} parallel jobs are available; all slots share the full context window using the unified KV cache.`
        : slots?.supported === false
          ? (slots.reason ?? 'The launcher slot switch is set to one job at a time.')
          : 'The launcher\'s parallel-mode setting could not be read; Multiple Jobs is unavailable until slot support can be verified.',
      requirement: 'needs the engine to support several jobs and enough GPU memory for all of them',
      ...(slots?.supported === true ? { slots: slots.slots ?? 1, mode: slots.mode } : {}),
    },
    {
      id: 'longResearch',
      label: 'Long Research',
      available: typeof configured === 'number' && configured >= LONG_RESEARCH_MIN_CONTEXT,
      reason: typeof configured === 'number' && configured >= LONG_RESEARCH_MIN_CONTEXT
        ? (typeof live === 'number' && live < configured
          ? `Configured context is ${configured.toLocaleString('en')} tokens but the running server still uses ${live.toLocaleString('en')}. The larger window becomes available after the pending configuration change is activated with an owner-approved restart.`
          : `${configured.toLocaleString('en')} tokens of context are configured for long sessions.`)
        : typeof configured === 'number'
          ? `The configured context window (${configured.toLocaleString('en')}) is below the ${LONG_RESEARCH_MIN_CONTEXT.toLocaleString('en')}-token Long Research minimum.`
          : `The configured context window is not readable from the provider configuration; Long Research requires at least ${LONG_RESEARCH_MIN_CONTEXT.toLocaleString('en')} tokens.`,
      requirement: `needs a configured context window of at least ${LONG_RESEARCH_MIN_CONTEXT.toLocaleString('en')} tokens`,
      ...(typeof configured === 'number' && configured >= LONG_RESEARCH_MIN_CONTEXT && typeof live === 'number' && live < configured ? { pendingRestart: true } : {}),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      available: true,
      reason: 'Shows the real launcher settings for this model (engine binary, slots, context, attention and cache options) with explanations. Settings are shown read-only in this version.',
      requirement: 'shows verified launcher facts; nothing is guessed',
    },
  ]
  return {
    rows: rows.map((row) => ({ ...row, reasoningNote: effortsNote })),
  }
}

/**
 * Plain-language recommendation blocks for one model.
 * @param {{key: string, name: string, provider?: object, live?: object, install?: object, vision?: boolean, multiPart?: boolean}} model merged row.
 * @param {object} config validated plugin config.
 */
export const recommendations = (model, config) => {
  const notes = []
  const installed = model.install?.installed === true
  if (!installed) notes.push(`This model's file is not installed (${model.install?.problem ?? 'not found'}), so it cannot be started.`)
  else if (model.provider?.reasoningEfforts !== undefined && Array.isArray(model.provider.reasoningEfforts) && model.provider.reasoningEfforts.length === 0) notes.push('Best for straightforward jobs: this model runs without extra reasoning levels by configuration.')
  else if (Array.isArray(model.provider?.reasoningEfforts) && model.provider.reasoningEfforts.includes('xhigh')) notes.push('Best for one demanding job that needs deep reasoning — it supports an extra-high reasoning level.')
  if (typeof model.provider?.contextWindow === 'number' && model.provider.contextWindow >= 131072) notes.push('Strong choice for very long documents or coding sessions: a very large context window is configured.')
  if (typeof model.provider?.contextWindow === 'number' && model.provider.contextWindow < 65536) notes.push('Not suitable for very long documents: its configured context window is small.')
  if (model.vision === true) notes.push('Can read images in addition to text.')
  if (model.live?.liveContext !== undefined && model.provider?.contextWindow !== undefined && model.live.liveContext !== model.provider.contextWindow) {
    notes.push(`The running server currently uses ${model.live.liveContext.toLocaleString('en')} tokens of context; the configuration now asks for ${model.provider.contextWindow.toLocaleString('en')}. The change takes effect after an owner-approved restart.`)
  }
  if (model.multiPart === true) notes.push('Stored as a multi-part archive; the current verified engine loads it with the Flash Next launcher variant.')
  const preferredName = config.protectedGpuName ?? 'the preferred launch GPU'
  const secondaryName = config.caseGpuName ?? 'the secondary GPU'
  if (Array.isArray(config.allowedGpuUuids) && config.protectedGpuUuid !== undefined && config.allowedGpuUuids.includes(config.protectedGpuUuid)) {
    notes.push(`Preferred launch target: ${preferredName} (RTX 3090 Ti). ${secondaryName} is the second choice, and Both-GPU profiles are third. GPUs are not reserved automatically; a manual lock in My Graphics Cards keeps a GPU reserved until you release it.`)
  } else {
    notes.push(`Runs on ${config.caseGpuName} only. No second GPU is configured as a launch target.`)
  }
  return notes
}