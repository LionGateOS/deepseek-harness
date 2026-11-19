/**
 * Host half of the Local Model Manager bundle.
 *
 * The service merges four verified fact sources — the validated model
 * catalog on disk, the active provider configuration, live probes of the
 * loopback llama.cpp endpoint, and read-only `nvidia-smi` queries — into one
 * plain-language snapshot, and exposes ten endpoints through the Typert wire:
 * three operational actions (start, stop, switch) through the trusted launcher
 * with a plan/confirm two-step owner gate; four GPU compute-mode lock endpoints
 * (planGpuLock, confirmGpuLock, planReleaseProtectedGpu, confirmReleaseProtectedGpu);
 * two profile-based launch endpoints (planLaunch, confirmLaunch); and
 * recentErrors. Active-job detection from `/slots` is required before any
 * disruptive action and the busy state is re-checked immediately before
 * execution; unreadable slot state fails closed. Nothing here touches the
 * protected GPU workload, the DeepSeek Harness service, or any process except
 * the pinned launcher spawn, whose environment carries `CUDA_VISIBLE_DEVICES`
 * set from the profile's GPU UUIDs.
 */

import { access, stat, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { validateConfig } from './core/config.js'
import { readProviderFacts, verifyInstalled } from './core/catalog.js'
import { probeServer, observeEndpoint } from './core/runtime.js'
import { queryGpus, getServerPid } from './core/gpus.js'
import { PowerRing, createSampler, activeWindow, DEFAULT_CAPACITY } from './core/power-sampler.js'
import { integrate, classifyAttribution, centsPerHour } from './core/energy.js'
import { periodAt, TOU_SOURCE, TOU_EFFECTIVE_FROM } from './core/tariff.js'
import { createActions, checkLauncher, runLauncherRaw, runLauncherForInstance } from './core/actions.js'
import { readGpuLaunchState, writeGpuLaunchState } from './core/gpu-launch-state.js'
import { buildLlamaCppLaunch, validateEngineAdapter } from './core/engine-adapter.js'
import { engineSupport, profileAvailability, recommendations, readSlotsSupport } from './core/profiles.js'
import { getHardwareProfile, getRuntimeDiscovery, getCompatibility } from './core/model-advisor-adapter.js'
import { buildDiscoveryResult, writeDiscoveryCache } from './core/discovery.js'
import { queryComputeMode, applyComputeMode, createGpuLockActions } from './core/gpu-lock.js'
import { readUserDirs, writeUserDirs, MAX_USER_DIRS } from './core/user-dirs.js'
import { readGgufMeta } from './core/gguf-meta.js'
import { selectContext, dshUsableContext, contextArgv, conflictingContextFlag } from './core/context-sizer.js'
import { readContextSelections, writeContextSelections, mergeSelection } from './core/context-selections.js'
import { readStrataStatus } from './core/strata-observer.js'
import { createStrataActions } from './core/strata-actions.js'

/**
 * Find the systemd user unit whose MainPID matches `pid` by scanning active
 * `dsh-model-*` services. Two-step: list active units, then probe each for
 * its MainPID. Every step is injectable for tests.
 * @param {number} pid PID to look up.
 * @param {{execFile?: Function}} [deps] injectable exec.
 * @returns {Promise<{status:'ok',unitName:string}|{status:'not-found'}|{status:'error',error:string}>}
 */
async function findUnitForPid(pid, deps) {
  const doExecFile = promisify(deps?.execFile ?? execFile)
  let listOutput
  try {
    const r = await doExecFile('systemctl', ['--user', 'list-units', '--type=service', '--state=active', '--no-legend', '--no-pager', '--plain'], { timeout: 8000 })
    listOutput = typeof r === 'string' ? r : (r?.stdout ?? '')
  } catch {
    return { status: 'error', error: 'systemctl list-units failed' }
  }
  const unitNames = listOutput.split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => typeof name === 'string' && name.startsWith('dsh-model-') && name.endsWith('.service'))
  if (unitNames.length === 0) return { status: 'not-found' }
  for (const unitName of unitNames) {
    try {
      const r2 = await doExecFile('systemctl', ['--user', 'show', unitName, '--property=Id,MainPID'], { timeout: 4000 })
      const out = typeof r2 === 'string' ? r2 : (r2?.stdout ?? '')
      const props = Object.fromEntries(
        out.trim().split('\n')
          .flatMap((line) => { const eq = line.indexOf('='); return eq !== -1 ? [[line.slice(0, eq), line.slice(eq + 1)]] : [] })
      )
      if (Number(props['MainPID']) === pid) return { status: 'ok', unitName }
    } catch {
      // skip this unit and continue searching
    }
  }
  return { status: 'not-found' }
}

/** The service key the Host registers; the Typert wire namespace defaults to it. */
const SERVICE_KEY = 'localModelManager'

/** Remote methods the service exports; the wire namespace defaults to the service key. */
const REMOTE_METHODS = ['snapshot', 'energyWindow', 'planAction', 'confirmAction', 'recentErrors', 'planLaunch', 'confirmLaunch', 'planStrataAction', 'confirmStrataAction', 'planGpuLock', 'confirmGpuLock', 'planGpuReservation', 'confirmGpuReservation', 'addDiscoveryDir', 'planAdoptInstance', 'confirmAdoptInstance']

/** The protocol constant Typert stores Remote markers under (plain-JS form of the `@Remote` decorator). */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Keep one wattage reading or report it as explicitly unavailable. The snapshot
 * carries `null` — never `undefined` or a non-finite number — so a client can
 * tell "this card did not report it" apart from "no such field".
 * @param {unknown} value the parsed wattage, if any.
 * @returns {number|null} the reading in watts, or null when unavailable.
 */
const toWatts = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'local.local-model-manager',
    /** Synchronous standard-schema validation; the Loader rejects issues loudly. */
    validate(value) {
      try {
        return { value: validateConfig(/** @type {Record<string, unknown>} */ (value)) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}

/**
 * Build one service instance over the given state; separate from `apply` so
 * tests construct the exact live surface without a Cordis context.
 * @param {object} state the captured dependencies object `apply` passes.
 * @returns {LocalModelManagerService}
 */
export function createLocalModelManagerService(state) {
  return new LocalModelManagerService(state)
}

class LocalModelManagerService {
  #errors = []
  /** Single-use launch-plan tokens: tokenId → { profile, model, targetInstance, createdAt }. */
  #launchTokens = new Map()
  /** GGUF metadata cache: ggufPath → { mtimeMs, size, result } within this service instance. */
  #ggufCache = new Map()
  /** Lazily loaded durable manual launch reservations; null until first read. */
  #manualLaunchReservations = null
  /** Single-use adopt-plan tokens: tokenId → { port, pid, unitName, gpuUuid, modelPath, createdAt }. */
  #adoptTokens = new Map()
  /**
   * Bounded in-memory power ring, shared with the lifecycle-owned sampler. Null
   * when sampling is disabled in config, which keeps Phase 1 behaviour exactly.
   */
  #powerRing = null
  /** The sampler handle, so `stopSampling` can release the timer it owns. */
  #powerSampler = null
  /**
   * @param {object} state dependencies and config captured from the apply closure.
   */
  constructor(state) {
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE_KEY, namespace: SERVICE_KEY })
    this.state = state
    this.actions = createActions({
      config: state.config,
      probe: () => state.probe(),
      modelByKey: state.modelByKey,
      spawn: state.spawn,
      access: state.access,
      contextArgs: (modelKey) => this.#selectedContextArgs(modelKey),
      reservedGpus: () => this.#reservedGpus(),
      setReservedGpus: (uuids) => { this.#manualLaunchReservations = [...uuids] },
    })
    // Multi-instance: one action machine per configured instance. Each machine
    // probes only its own port and targets the candidate launcher via instanceConfig.
    this.instanceActions = state.config.instances.map((inst) => {
      const probeForInstance = state.probeInstances?.[inst.port] ?? (() => state.probe())
      return {
        instanceConfig: inst,
        actions: createActions({
          config: state.config,
          probe: () => probeForInstance(),
          modelByKey: state.modelByKey,
          spawn: state.spawn,
          access: state.access,
          contextArgs: (modelKey) => this.#selectedContextArgs(modelKey),
          reservedGpus: () => this.#reservedGpus(),
          setReservedGpus: (uuids) => { this.#manualLaunchReservations = [...uuids] },
          instanceConfig: inst,
        }),
      }
    })
    this.gpuLock = createGpuLockActions({
      config: state.config,
      queryFn: state.queryComputeMode ?? queryComputeMode,
      applyFn: state.applyComputeMode ?? applyComputeMode,
    })
  }

  /**
   * Selected-context argv for one model key, resolved from the persisted
   * selections file (automatic or manual). Empty when nothing is recorded or
   * persistence is disabled — the trusted launcher's config-derived context
   * then applies unchanged.
   * @param {string|undefined} modelKey managed model key.
   * @returns {Promise<string[]>} argv fragment (`['-c', '<tokens>']` or empty).
   */
  async #selectedContextArgs(modelKey) {
    const { config } = this.state
    if (typeof modelKey !== 'string' || config.contextSelectionsPath === '') return []
    const { selections } = await readContextSelections(config.contextSelectionsPath)
    const entry = selections[modelKey]
    return entry === undefined ? [] : contextArgv(entry.context)
  }

  /**
   * GGUF metadata for one catalog model, cached per (path, mtime, size) for
   * the service lifetime. Read failures stay unavailable, never guessed.
   * @param {object} model validated catalog row.
   * @returns {Promise<{status:'ok'|'unavailable', facts?: object, error?: string}>}
   */
  async #ggufFacts(model) {
    const doStat = this.state.stat ?? stat
    let mtime
    let size
    try {
      const info = await doStat(model.ggufPath)
      mtime = info.mtimeMs
      size = info.size
    } catch {
      return { status: 'unavailable', error: 'model file could not be inspected' }
    }
    const cached = this.#ggufCache.get(model.ggufPath)
    if (cached !== undefined && cached.mtimeMs === mtime && cached.size === size) return cached.result
    const result = await (this.state.readGgufMeta ?? readGgufMeta)(model.ggufPath)
    this.#ggufCache.set(model.ggufPath, { mtimeMs: mtime, size, result })
    return result
  }

  /**
   * Resolve the context selection for one model. Manual overrides win and are
   * honored as-is; the automatic path takes the minimum of the configured,
   * advertised (GGUF metadata), and owner-recorded hardware bounds.
   * @param {object} model validated catalog row.
   * @param {object|undefined} provider provider facts (contextWindow).
   * @param {Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>} stored persisted selections.
   * @returns {Promise<{computed: object, manualOverride: {context: number, decidedAt?: string}|undefined, advertisedFacts: {status: string, facts?: object, error?: string}}>}
   */
  async #resolveContext(model, provider, stored) {
    const { config } = this.state
    const advertisedFacts = await this.#ggufFacts(model)
    const advertised = advertisedFacts.status === 'ok' ? advertisedFacts.facts?.contextLength : undefined
    const existing = stored[model.key]
    const manualOverride = existing !== undefined && existing.source === 'manual'
      ? { context: existing.context, decidedAt: existing.decidedAt }
      : undefined
    const computed = selectContext({
      ...(advertised !== undefined ? { advertised } : {}),
      ...(provider?.contextWindow !== undefined ? { configured: provider.contextWindow } : {}),
      ...(config.hardwareContextCaps[model.key] !== undefined ? { hardwareCap: config.hardwareContextCaps[model.key] } : {}),
      ...(manualOverride !== undefined ? { override: manualOverride.context } : {}),
    })
    return { computed, manualOverride, advertisedFacts }
  }

  /** Record one operational outcome in the bounded error ring (latest last). */
  #record(entry) {
    this.#errors.push({ at: new Date().toISOString(), ...entry })
    if (this.#errors.length > this.state.config.maxErrorRecords) this.#errors.splice(0, this.#errors.length - this.state.config.maxErrorRecords)
  }

  /**
   * The full plain-language snapshot: models, GPUs, server, engines, and the
   * recent-error list. Every unverified fact is labeled, never guessed.
   * V2A: includes Model Advisor hardware, runtime, and compatibility data.
   */
  async snapshot() {
    const { config } = this.state
    const qcm = this.state.queryComputeMode ?? queryComputeMode
    const execDeps = { execFile: this.state.execFile }
    // Probe all configured instances in parallel with the main data sources.
    const instanceProbes = config.instances.map((inst) => {
      const probeForInstance = this.state.probeInstances?.[inst.port] ?? (() => this.state.probe())
      return probeForInstance()
    })
    const [server, gpus, install, providerFacts, modelAdvisorData, strataStatus, caseModeResult, protectedModeResult, ...instanceStates] = await Promise.all([
      this.state.probe(),
      (this.state.queryGpus ?? queryGpus)(config.probeTimeoutMs, execDeps),
      verifyInstalled(config.models, { stat: this.state.stat }),
      this.state.readProviderFacts(),
      this.state.getModelAdvisorData(),
      (this.state.readStrataStatus ?? readStrataStatus)(),
      qcm(config.caseGpuUuid, config.probeTimeoutMs, execDeps),
      qcm(config.protectedGpuUuid, config.probeTimeoutMs, execDeps),
      ...instanceProbes,
      this.state.observeEndpoints === undefined ? [] : this.state.observeEndpoints(),
    ])
    // The observed endpoints were probed last, so they are the tail of the same
    // result list; keeping them in `instanceStates` would misalign the instance
    // indexes above.
    const observedEndpoints = Array.isArray(instanceStates.at(-1)) ? instanceStates.pop() : []

    // Observed endpoints: upgrade the configured port→card mapping to real proof
    // when the host can see it. The listener's PID comes from `ss`, and the
    // driver's own compute-app list says which card that PID is running on. This
    // is read-only and already how a managed instance is identified, so it adds
    // no new control path. When either lookup is unavailable (a sandboxed
    // caller, a driver that hides the process) the endpoint keeps `evidence:
    // 'endpoint'` — a declaration, which the caller must not present as exact.
    const observedRows = observedEndpoints.length === 0 ? [] : await Promise.all(observedEndpoints.map(async (entry) => {
      if (entry.state !== 'running') return entry
      let pid = null
      try {
        pid = await (this.state.getServerPid ?? getServerPid)(entry.port, execDeps)
      } catch {
        pid = null
      }
      if (typeof pid !== 'number') return { ...entry, evidence: 'endpoint' }
      const proven = Array.isArray(gpus.processes) ? gpus.processes.find((proc) => proc.pid === pid) : undefined
      if (proven === undefined) return { ...entry, pid, evidence: 'endpoint' }
      if (proven.uuid !== entry.gpuUuid) {
        // The driver contradicts the configuration. Report what the driver says
        // and let the caller surface the disagreement instead of hiding it.
        return { ...entry, pid, gpuUuid: proven.uuid, actualGpuUuid: proven.uuid, configuredGpuUuid: entry.gpuUuid, evidence: 'pid', mismatch: true }
      }
      return { ...entry, pid, actualGpuUuid: proven.uuid, evidence: 'pid' }
    }))

    // Per-instance: look up the PID listening on each port (for actual GPU identity)
    // and check ownership records (for safe control visibility).
    const instancePids = config.instances.length > 0
      ? await Promise.all(config.instances.map((inst) => (this.state.getServerPid ?? getServerPid)(inst.port, execDeps)))
      : []
    const instanceOwned = config.instances.length > 0
      ? await Promise.all(config.instances.map(async (inst) => {
          const lockDir = (process.env['XDG_RUNTIME_DIR'] ?? '/run/user/1000') + '/dsh-launcher'
          try { await (this.state.access ?? access)(`${lockDir}/instance-p${inst.port}.rec`); return true }
          catch { return false }
        }))
      : []
    const vllmVerdict = await this.state.detectVllm()

    // User-added discovery dirs: read from the persistent settings file when configured.
    const userDirsResult = config.userDiscoveryDirsPath !== ''
      ? await this.state.readUserDirs()
      : { dirs: [] }

    // GGUF discovery: merge static + user dirs, deduplicate, then scan; never throws.
    const allDirs = [...new Set([...config.discoveryDirs, ...(userDirsResult.dirs ?? [])])]
    let discovery = null
    if (allDirs.length > 0) {
      const knownPaths = new Set(config.models.map((m) => m.ggufPath))
      const mmprojPaths = new Set(config.models.flatMap((m) => m.mmprojPath !== undefined ? [m.mmprojPath] : []))
      discovery = await this.state.buildDiscovery(allDirs, knownPaths, mmprojPaths)
      if (config.discoveryResultsPath !== '' && discovery !== null) {
        void this.state.writeDiscovery(config.discoveryResultsPath, discovery).catch((error) => {
          this.#record({ action: 'discovery-write', status: 'failed', detail: error instanceof Error ? error.message : String(error) })
        })
      }
    }

    const backends = engineSupport(config, { existsVerdict: vllmVerdict })
    // The launcher keeps its slot choice in `parallel-mode` beside the launcher
    // script. Read it once per snapshot and hand the same evidence to every
    // model row and to actionsAvailable. Injectable via state.readSlotsFile
    // for tests; undefined means the real filesystem is used.
    const launcherDir = dirname(config.launcherPath)
    const slotsSupport = readSlotsSupport(
      { modeFile: join(launcherDir, 'parallel-mode') },
      this.state.readSlotsFile,
    )
    const runningKey = server.modelPath === undefined ? undefined
      : config.models.find((model) => model.ggufPath === server.modelPath)?.key ?? null

    // Multi-instance: build a map from model key to the port it is running on.
    // A model can run on multiple instances simultaneously (same GGUF on both).
    const runningInstancesByModelKey = /** @type {Record<string, number[]>} */ ({})
    for (let i = 0; i < instanceStates.length; i++) {
      const iServer = instanceStates[i]
      if (iServer.state === 'running' && iServer.modelPath !== undefined) {
        const m = config.models.find((model) => model.ggufPath === iServer.modelPath)
        if (m !== undefined) {
          if (runningInstancesByModelKey[m.key] === undefined) runningInstancesByModelKey[m.key] = []
          runningInstancesByModelKey[m.key].push(config.instances[i].port)
        }
      }
    }

    // Context selections: read persisted records, resolve each model's
    // selection, then persist any change (manual overrides always win).
    let storedSelections = {}
    let contextSelectionsReadError
    if (config.contextSelectionsPath !== '') {
      const stored = await readContextSelections(config.contextSelectionsPath)
      storedSelections = stored.selections
      contextSelectionsReadError = stored.readError
    }
    const contextByModel = {}
    let selectionsChanged = false
    let nextSelections = storedSelections
    for (const model of config.models) {
      const provider = providerFacts.status === 'ok' ? providerFacts.byPath?.[model.ggufPath] : undefined
      const resolved = await this.#resolveContext(model, provider, storedSelections)
      const merged = mergeSelection(nextSelections, model.key, resolved.computed, new Date().toISOString())
      if (merged.changed) selectionsChanged = true
      nextSelections = merged.next
      const reservation = { reservedOutputTokens: config.reservedOutputTokens, headroomTokens: config.headroomTokens }
      const live = server.liveContext !== undefined && runningKey === model.key ? server.liveContext : undefined
      const usable = dshUsableContext(resolved.computed.selected, reservation)
      contextByModel[model.key] = {
        ...(resolved.computed.selected === undefined ? {} : { selected: resolved.computed.selected }),
        source: resolved.computed.source,
        ...(resolved.advertisedFacts.status === 'ok' && resolved.advertisedFacts.facts?.contextLength !== undefined
          ? { advertised: resolved.advertisedFacts.facts.contextLength } : {}),
        ...(provider?.contextWindow !== undefined ? { configured: provider.contextWindow } : {}),
        ...(config.hardwareContextCaps[model.key] !== undefined ? { hardwareCap: config.hardwareContextCaps[model.key] } : {}),
        ...(resolved.manualOverride !== undefined ? { override: resolved.manualOverride.context } : {}),
        ...(live !== undefined ? { live } : {}),
        ...(usable.usable === undefined ? {} : { dshUsable: usable.usable, ...(usable.exhausted === true ? { dshUsableExhausted: true } : {}) }),
        reasons: resolved.computed.reasons,
        ...(resolved.advertisedFacts.status === 'unavailable' ? { advertisedProblem: resolved.advertisedFacts.error } : {}),
        ...(resolved.advertisedFacts.status === 'ok' && resolved.advertisedFacts.facts?.truncated === true ? { advertisedTruncated: true } : {}),
      }
    }
    if (selectionsChanged && config.contextSelectionsPath !== '') {
      try {
        await writeContextSelections(config.contextSelectionsPath, nextSelections)
      } catch (error) {
        this.#record({ action: 'context-selections-write', status: 'failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }

    const models = config.models.map((model) => {
      const provider = providerFacts.status === 'ok' ? providerFacts.byPath?.[model.ggufPath] : undefined
      const context = contextByModel[model.key]
      const contextNotes = (context?.reasons ?? []).filter((reason) => reason.length > 0)
        .map((reason) => `Context sizing: ${reason}`)
      const row = {
        key: model.key,
        name: model.name,
        // The configured artifact path, so a consumer can prove which physical
        // file an installed model is. Two spellings of one path (a symlinked
        // root) are the same file, so identity is device+inode, never the text.
        ggufPath: model.ggufPath,
        installed: install[model.key]?.installed === true,
        ...(install[model.key]?.problem === undefined ? {} : { installProblem: install[model.key].problem }),
        ...(install[model.key]?.diskBytes === undefined ? {} : { diskBytes: install[model.key].diskBytes }),
        engine: { id: 'llama.cpp', verified: true, note: model.engineBinary === 'flash-next' ? 'started through the Flash Next launcher variant' : 'started by the trusted launcher with tested settings' },
        ...(provider?.contextWindow === undefined ? {} : { configContext: provider.contextWindow }),
        ...(provider?.contextWindow === undefined ? { providerStatus: providerFacts.status === 'ok' ? 'not listed in the active provider configuration' : `provider configuration could not be read (${providerFacts.error})` } : {}),
        ...(server.liveContext === undefined || runningKey !== model.key ? {} : { liveContext: server.liveContext }),
        ...(context !== undefined ? { context } : {}),
        ...(provider?.reasoningEfforts === undefined ? { reasoningEfforts: undefined } : { reasoningEfforts: provider.reasoningEfforts }),
        ...(provider?.input === undefined ? {} : { input: provider.input }),
        vision: model.vision === true,
        multiPart: model.multiPart === true,
        gpu: { name: config.caseGpuName, uuid: config.caseGpuUuid, role: 'case' },
        runtime: (() => {
          // Multi-instance: running on any instance counts as running.
          if (config.instances.length > 0) {
            if (runningInstancesByModelKey[model.key] !== undefined) return 'running'
            if (instanceStates.some((s) => s.state === 'unhealthy' && s.modelPath === model.ggufPath)) return 'error'
            return 'stopped'
          }
          return runningKey === model.key ? 'running' : server.state === 'unhealthy' ? 'error' : 'stopped'
        })(),
        // Multi-instance: expose which ports the model is currently running on.
        ...(config.instances.length > 0 && runningInstancesByModelKey[model.key] !== undefined
          ? { runningOnPorts: runningInstancesByModelKey[model.key] }
          : {}),
      }
      const availability = profileAvailability({ ...row, provider: provider ?? {}, live: { liveContext: row.liveContext }, install: install[model.key], slots: slotsSupport })
      return {
        ...row,
        profiles: availability.rows,
        recommendations: [...recommendations({ ...row, provider: provider ?? {}, live: { liveContext: row.liveContext }, install: install[model.key], vision: row.vision, multiPart: row.multiPart }, config), ...contextNotes],
      }
    })

    const gpuLabelByUuid = { [config.caseGpuUuid]: config.caseGpuName, [config.protectedGpuUuid]: config.protectedGpuName }
    const launchProfileRows = (config.launchProfiles ?? []).map((p) => ({
      profileId: p.profileId,
      engineId: p.engineId,
      engineVersion: p.engineVersion,
      modelKey: p.modelKey,
      modelName: config.models.find((m) => m.key === p.modelKey)?.name ?? p.modelKey,
      gpuUuids: p.gpuUuids,
      gpuMode: p.gpuMode,
      gpuName: p.gpuUuids.map((uuid) => gpuLabelByUuid[uuid] ?? uuid).join(', '),
      launchArgs: p.launchArgs,
      label: p.label,
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
    }))

    // Presentation order follows the launch preference: preferred (Ti) row
    // first, RTX 3090 second. Both rows are ordinary launch targets; the only
    // behavioral difference is the owner's manual reservation state.
    const protectedRow = gpus.gpus?.find((gpu) => gpu.uuid === config.protectedGpuUuid)
    const caseRow = gpus.gpus?.find((gpu) => gpu.uuid === config.caseGpuUuid)
    const rawGpuRows = [
      {
        name: config.protectedGpuName, uuid: config.protectedGpuUuid, role: 'preferred',
        status: protectedRow === undefined ? 'unavailable' : 'ok',
        ...(protectedRow ?? { error: gpus.error ?? 'this GPU was not visible to the system query' }),
        computeMode: protectedModeResult.status === 'ok' ? protectedModeResult.mode : null,
        computeModeStatus: protectedModeResult.status,
        ...(protectedModeResult.status === 'unavailable' ? { computeModeError: protectedModeResult.error } : {}),
      },
      {
        name: config.caseGpuName, uuid: config.caseGpuUuid, role: 'secondary',
        status: caseRow === undefined ? 'unavailable' : 'ok',
        ...(caseRow ?? { error: gpus.error ?? 'this GPU was not visible to the system query' }),
        computeMode: caseModeResult.status === 'ok' ? caseModeResult.mode : null,
        computeModeStatus: caseModeResult.status,
        ...(caseModeResult.status === 'unavailable' ? { computeModeError: caseModeResult.error } : {}),
      },
    ]
    // Manual launch reservations: exactly the UUIDs the owner reserved through
    // the panel; the durable file and this set are the only authority. No GPU
    // is reserved by default, and nothing adds entries automatically.
    const reservedNow = new Set(this.actions.getReservedGpus())
    const gpuRows = rawGpuRows.map((row) => ({
      ...row,
      // Live wattage is advisory: the driver may not expose it, and a card that
      // reported nothing says so with null rather than a fabricated reading.
      powerDrawW: toWatts(row.powerDrawW),
      powerLimitW: toWatts(row.powerLimitW),
      launchReserved: reservedNow.has(row.uuid),
      preferredLaunchTarget: row.uuid === config.preferredLaunchGpuUuid,
      processes: (gpus.processes ?? []).filter((proc) => proc.uuid === row.uuid).map((proc) => ({ pid: proc.pid, processName: proc.processName, memUsedMiB: proc.memUsedMiB })),
    }))

    const allowedGpuSet = new Set(config.allowedGpuUuids)
    const strataGpuTargets = [
      { mode: 'gpu0', label: config.caseGpuName, uuids: [config.caseGpuUuid] },
      { mode: 'gpu1', label: config.protectedGpuName, uuids: [config.protectedGpuUuid] },
      { mode: 'gpu01', label: `${config.caseGpuName} + ${config.protectedGpuName}`, uuids: [config.caseGpuUuid, config.protectedGpuUuid] },
    ].map((target) => {
      const reservedNames = target.uuids
        .filter((uuid) => reservedNow.has(uuid))
        .map((uuid) => uuid === config.protectedGpuUuid ? config.protectedGpuName : config.caseGpuName)
      const outside = target.uuids.filter((uuid) => !allowedGpuSet.has(uuid))
      return {
        ...target,
        available: reservedNames.length === 0 && outside.length === 0,
        ...(reservedNames.length > 0 ? { blockedReason: `${reservedNames.join(', ')} is manually reserved` } : {}),
        ...(outside.length > 0 ? { blockedReason: 'one or more GPUs are outside the Local Model Manager allowlist' } : {}),
      }
    })
    const strataView = { ...strataStatus, gpuTargets: strataGpuTargets }

    // Multi-instance servers array: one entry per configured instance.
    const serversArray = config.instances.length > 0
      ? config.instances.map((inst, i) => {
          const iServer = instanceStates[i]
          const iRunningKey = iServer.modelPath === undefined ? undefined
            : config.models.find((m) => m.ggufPath === iServer.modelPath)?.key ?? null
          // Actual GPU identity: cross-reference the listening PID with nvidia-smi process data.
          const pid = instancePids[i]
          const gpuProcess = typeof pid === 'number' && Array.isArray(gpus.processes)
            ? gpus.processes.find((p) => p.pid === pid)
            : undefined
          const actualGpuUuid = gpuProcess?.uuid ?? null
          const actualGpuRow = actualGpuUuid !== null && Array.isArray(gpus.gpus)
            ? gpus.gpus.find((g) => g.uuid === actualGpuUuid)
            : undefined
          const actualGpuName = actualGpuRow?.name ?? null
          return {
            port: inst.port,
            gpuUuid: inst.gpuUuid,
            gpuName: inst.gpuName,
            actualGpuUuid,
            actualGpuName,
            owned: instanceOwned[i] ?? false,
            endpoint: `http://127.0.0.1:${inst.port}`,
            state: iServer.state,
            ...(iRunningKey !== undefined ? { runningModelKey: iRunningKey } : {}),
            ...(iRunningKey === null && iServer.modelPath !== undefined ? { unrecognizedModelPath: iServer.modelPath } : {}),
            ...(iServer.liveContext !== undefined ? { liveContext: iServer.liveContext } : {}),
            slots: (iServer.slots ?? []).map((slot) => ({ id: slot.id, context: slot.n_ctx, busy: slot.isProcessing })),
            busy: iServer.busyUnknown === false ? iServer.busy === true : undefined,
            ...(iServer.busyUnknown ? { busyUnknown: true } : {}),
          }
        })
      : undefined

    return {
      generatedAt: new Date().toISOString(),
      endpoint: config.endpointBase,
      ...(serversArray !== undefined ? { servers: serversArray } : {}),
      // Endpoints this manager watches but does not own: the identity a caller
      // needs to tie a loopback route to a card, reported only for ports that
      // actually answered.
      ...(observedRows.length > 0 ? { observedEndpoints: observedRows } : {}),
      server: {
        state: server.state,
        ...(runningKey === undefined ? {} : { runningModelKey: runningKey }),
        ...(runningKey === null && server.modelPath !== undefined ? { unrecognizedModelPath: server.modelPath } : {}),
        ...(server.liveContext === undefined ? {} : { liveContext: server.liveContext }),
        slots: (server.slots ?? []).map((slot) => ({ id: slot.id, context: slot.n_ctx, busy: slot.isProcessing })),
        busy: server.busyUnknown === false ? server.busy === true : undefined,
        ...(server.busyUnknown ? { busyUnknown: true } : {}),
        ...(server.error === undefined ? {} : { error: server.error }),
      },
      models,
      strata: strataView,
      gpus: gpuRows,
      gpuQueryStatus: gpus.status,
      ...(gpus.status === 'unavailable' ? { gpuQueryError: gpus.error } : {}),
      backends,
      actionsAvailable: { start: true, stop: true, switch: true, multipleJobs: slotsSupport.supported === true },
      launchProfiles: launchProfileRows,
      errors: [...this.#errors],
      ...(contextSelectionsReadError !== undefined ? { contextSelectionsReadError } : {}),
      ...(discovery !== null ? { discovery } : {}),
      ...(config.userDiscoveryDirsPath !== '' ? { userDiscoveryDirs: userDirsResult } : {}),
      // V2A: Model Advisor integration data (read-only, verified, never guessed)
      modelAdvisor: {
        hardware: modelAdvisorData.hardware,
        runtimes: modelAdvisorData.runtimes,
        compatibility: modelAdvisorData.compatibility,
      },
      // Electricity: measured GPU board power only, never whole-system estimate.
      electricity: this.#electricity(gpuRows, config),
    }
  }

  /**
   * The electricity block for one snapshot: the current rate, the live draw,
   * and the measured energy and cost of the job the sampled window observed.
   *
   * Every figure states its measurement class and its coverage. A window the
   * sampler did not observe is reported as a gap, never scaled up to look
   * complete, and a shared card is labelled approximate.
   *
   * @param {Array<object>} gpuRows the snapshot's GPU rows.
   * @param {object} config the validated config.
   * @returns {object} the electricity block.
   */
  #electricity(gpuRows, config) {
    const targetUuid = config.tariffGpuUuid !== '' ? config.tariffGpuUuid : config.preferredLaunchGpuUuid
    const nowMs = Date.now()
    const rate = periodAt(nowMs)
    const gpu = gpuRows.find((row) => row.uuid === targetUuid)
    const watts = typeof gpu?.powerDrawW === 'number' ? gpu.powerDrawW : null
    const base = {
      measurement: 'gpu-board-energy',
      measurementNote: 'Measured GPU board power from nvidia-smi; excludes CPU, drives, PSU losses, and other system draw. Not wall power.',
      gpuUuid: targetUuid !== '' ? targetUuid : null,
      gpuName: gpu?.name ?? null,
      tariff: {
        zone: 'America/Toronto',
        period: rate.period,
        centsPerKwh: rate.centsPerKwh,
        season: rate.season,
        effectiveFrom: TOU_EFFECTIVE_FROM,
        source: TOU_SOURCE,
      },
      powerDrawW: watts,
      powerLimitW: typeof gpu?.powerLimitW === 'number' ? gpu.powerLimitW : null,
      centsPerHour: watts === null ? null : centsPerHour(watts, rate.centsPerKwh),
    }
    if (this.#powerRing === null) {
      return { ...base, sampling: { enabled: false }, job: null }
    }
    const ring = this.#powerRing
    const window = activeWindow(ring, targetUuid)
    const sampling = {
      enabled: true,
      capacity: ring.capacity,
      retained: ring.size,
      intervalMs: config.powerSampleIntervalMs,
      windowMs: ring.capacity * config.powerSampleIntervalMs,
    }
    if (window === null) return { ...base, sampling, job: null }

    const samples = ring
      .since(window.startedAt)
      .map((record) => {
        const card = record.gpus.find((entry) => entry.uuid === targetUuid)
        return { t: record.t, watts: card?.watts ?? null }
      })
      .filter((sample) => sample.watts !== null)
    // An open job integrates to its newest sample, not to "now": the seconds
    // since the last sample were not measured and must not be invented.
    const endMs = window.open
      ? (samples.length === 0 ? window.lastBusyAt : samples[samples.length - 1].t)
      : window.lastBusyAt
    const span = integrate(samples, window.startedAt, endMs, { maxGapMs: config.powerSampleIntervalMs * 3 })
    const attribution = classifyAttribution({
      coverage: span.coverage,
      distinctPids: window.distinctPids.length,
      overlappingRequests: 0,
    })
    return {
      ...base,
      sampling,
      job: {
        startedAt: new Date(window.startedAt).toISOString(),
        endedAt: window.open ? null : new Date(window.lastBusyAt).toISOString(),
        open: window.open,
        runtimeS: Math.max(0, (endMs - window.startedAt) / 1000),
        energyWh: span.wh,
        costCents: span.cents,
        coverage: span.coverage,
        sampleCount: span.sampleCount,
        gapCount: span.gaps.length,
        distinctPids: window.distinctPids,
        attribution: attribution.label,
        approximate: attribution.approximate,
        attributionReasons: attribution.reasons,
        tariffPieces: span.pieces.map((piece) => ({
          period: piece.period,
          centsPerKwh: piece.centsPerKwh,
          fromMs: piece.fromMs,
          toMs: piece.toMs,
          wh: piece.wh,
          cents: piece.cents,
        })),
      },
    }
  }

  /**
   * Start the bounded power sampler. Called from `apply` through `ctx.effect`,
   * which owns the returned stop function, so the timer cannot outlive the
   * plugin. Disabled sampling leaves Phase 1 behaviour untouched.
   * @param {object} deps the sampler's injectables, for tests.
   * @returns {() => Promise<void>} the release function.
   */
  startSampling(deps = {}) {
    const { config } = this.state
    if (!config.powerSamplingEnabled) return async () => {}
    if (this.#powerSampler !== null) return async () => { await this.stopSampling() }
    const ring = deps.ring ?? new PowerRing(config.powerRingCapacity ?? DEFAULT_CAPACITY)
    const query = deps.query ?? (() => (this.state.queryGpus ?? queryGpus)(config.probeTimeoutMs, { execFile: this.state.execFile }))
    const sampler = createSampler({ ...deps, ring, query, intervalMs: config.powerSampleIntervalMs })
    this.#powerRing = ring
    this.#powerSampler = sampler
    sampler.start()
    return async () => { await this.stopSampling() }
  }

  /**
   * Release the sampler's timer and wait for any in-flight sample. Safe to call
   * when sampling never started, and safe to call twice.
   * @returns {Promise<void>} resolves once the sampler is stopped.
   */
  async stopSampling() {
    const sampler = this.#powerSampler
    this.#powerSampler = null
    if (sampler !== null) await sampler.stop()
    // The ring belongs to the sampler: a torn-down plugin reports no retained
    // measurement rather than a stale one.
    this.#powerRing = null
  }

  /**
   * The retained power records, for tests and diagnostics. Never written to disk.
   * @returns {Array<object>} the ring's records, oldest first.
   */
  powerRecords() {
    return this.#powerRing === null ? [] : this.#powerRing.all()
  }

  /**
   * Price caller-supplied spans against the retained samples. A caller that
   * owns its own notion of "the job" (a Session with several turns) passes
   * `windows`; a single span is the `fromMs`/`toMs` form. Spans are priced
   * independently and summed, so an interval the sampler did not observe stays
   * a gap instead of being extrapolated.
   *
   * @param {{fromMs?: number, toMs?: number|null, windows?: Array<{fromMs: number, toMs: number|null}>}} [params] spans to price; `toMs: null` on the last one means "still running".
   * @returns {object} the priced window, its measured span, and its attribution.
   */
  energyWindow(params) {
    const { config } = this.state
    const targetUuid = config.tariffGpuUuid !== '' ? config.tariffGpuUuid : config.preferredLaunchGpuUuid
    const spans = this.#spansOf(params)
    if (this.#powerRing === null) {
      return { status: 'unsampled', reason: 'power sampling is disabled in this deployment', gpuUuid: targetUuid !== '' ? targetUuid : null }
    }
    if (spans.length === 0) {
      return { status: 'no-window', reason: 'the caller supplied no window start', gpuUuid: targetUuid !== '' ? targetUuid : null }
    }
    const ring = this.#powerRing
    const newest = ring.oldestAt() === null ? null : ring.all()[ring.size - 1].t
    if (newest === null) {
      return { status: 'no-window', reason: 'the sampler has not retained a sample yet', gpuUuid: targetUuid !== '' ? targetUuid : null }
    }
    const priced = spans
      .map((span) => {
        const open = span.toMs === null
        const toMs = open ? newest : Math.min(span.toMs, newest)
        return { fromMs: span.fromMs, toMs, open }
      })
      .filter((span) => span.toMs > span.fromMs)
    if (priced.length === 0) {
      return { status: 'no-window', reason: 'the sampler has not retained a sample inside this window', gpuUuid: targetUuid !== '' ? targetUuid : null }
    }
    const rate = periodAt(priced[0].fromMs)
    const total = { wh: 0, cents: 0, coveredMs: 0, gapMs: 0, sampleCount: 0, gapCount: 0, periods: 0, spanMs: 0 }
    // Rate-free time-sliced energy, kept alongside the priced pieces above. The
    // priced pieces are cut at *this* deployment's tariff boundaries and carry
    // its cents; a caller pricing the same watt-hours under a different tariff
    // (another utility, another country) needs the energy alone.
    const energyPieces = []
    const pids = new Set()
    let latestWatts = null
    for (const span of priced) {
      const inWindow = ring.since(span.fromMs).filter((record) => record.t <= span.toMs)
      const samples = inWindow
        .map((record) => {
          const card = record.gpus.find((entry) => entry.uuid === targetUuid)
          return { t: record.t, watts: card?.watts ?? null }
        })
        .filter((sample) => sample.watts !== null)
      // The current draw is the newest measured sample, not the panel's live
      // query: this method answers for a retained window and never samples.
      if (samples.length > 0) latestWatts = samples[samples.length - 1].watts
      const part = integrate(samples, span.fromMs, span.toMs, { maxGapMs: config.powerSampleIntervalMs * 3 })
      total.wh += part.wh
      total.cents += part.cents
      total.coveredMs += part.coveredMs
      total.gapMs += part.gapMs
      total.sampleCount += part.sampleCount
      total.gapCount += part.gaps.length
      total.periods += part.pieces.length
      total.spanMs += span.toMs - span.fromMs
      if (Array.isArray(part.energyPieces)) energyPieces.push(...part.energyPieces)
      for (const record of inWindow) {
        for (const proc of record.processes) {
          if (proc.uuid === targetUuid) pids.add(proc.pid)
        }
      }
    }
    const coverage = total.spanMs === 0 ? 0 : Math.max(0, Math.min(1, total.coveredMs / total.spanMs))
    const attribution = classifyAttribution({ coverage, distinctPids: pids.size, overlappingRequests: 0 })
    return {
      status: 'measured',
      measurement: 'gpu-board-energy',
      measurementNote: 'Measured GPU board power from nvidia-smi; excludes CPU, drives, PSU losses, and other system draw. Not wall power.',
      gpuUuid: targetUuid !== '' ? targetUuid : null,
      tariff: {
        zone: 'America/Toronto',
        period: rate.period,
        centsPerKwh: rate.centsPerKwh,
        season: rate.season,
        effectiveFrom: TOU_EFFECTIVE_FROM,
        source: TOU_SOURCE,
      },
      powerDrawW: latestWatts,
      centsPerHour: latestWatts === null ? null : centsPerHour(latestWatts, rate.centsPerKwh),
      window: {
        fromMs: priced[0].fromMs,
        toMs: Math.max(...priced.map((span) => span.toMs)),
        open: priced.some((span) => span.open),
        spans: priced.map((span) => ({ fromMs: span.fromMs, toMs: span.toMs, open: span.open })),
      },
      span: {
        wh: total.wh,
        cents: total.cents,
        coverage,
        coveredMs: total.coveredMs,
        gapMs: total.gapMs,
        sampleCount: total.sampleCount,
        gapCount: total.gapCount,
        // Number of distinct TOU slices the spans were priced in: more than one
        // means a rate change happened inside the window, so the rate in force
        // at its start describes only its first minutes.
        periods: total.periods,
        windowCount: priced.length,
        // Rate-free energy on an epoch-aligned quarter-hour grid. This is what a
        // caller pricing energy under its own tariff should consume; `wh` and
        // `cents` above are this deployment's own tariff applied to the same
        // samples.
        energyPieces,
      },
      attribution: { label: attribution.label, approximate: attribution.approximate, reasons: attribution.reasons },
      distinctPids: pids.size,
    }
  }

  /**
   * Normalize the caller's spans. A single `fromMs`/`toMs` pair is the one-span
   * form; `windows` is the many-span form a Session with several turns uses.
   * @param {object} [params] the raw request.
   * @returns {Array<{fromMs: number, toMs: number|null}>} the spans, oldest first.
   */
  #spansOf(params) {
    const finite = (value) => typeof value === 'number' && Number.isFinite(value)
    if (Array.isArray(params?.windows) && params.windows.length > 0) {
      return params.windows
        .filter((span) => span !== null && typeof span === 'object' && finite(span.fromMs))
        .map((span) => ({ fromMs: span.fromMs, toMs: finite(span.toMs) ? span.toMs : null }))
        .sort((left, right) => left.fromMs - right.fromMs)
    }
    const fromMs = finite(params?.fromMs) ? params.fromMs : null
    if (fromMs === null) return []
    return [{ fromMs, toMs: finite(params?.toMs) ? params.toMs : null }]
  }


  _strataControl() {
    if (this.__strataControl === undefined) {
      const options = {
        config: this.state.config,
        readStatus: () => (this.state.readStrataStatus ?? readStrataStatus)(),
        reservedGpus: () => this.actions.getReservedGpus(),
      }
      if (this.state.strataProbe !== undefined) options.probe = this.state.strataProbe
      if (this.state.runStrataCommand !== undefined) options.runCommand = this.state.runStrataCommand
      this.__strataControl = createStrataActions(options)
    }
    return this.__strataControl
  }

  async planStrataAction(action, params) {
    const plan = await this._strataControl().plan(action, params ?? {})
    this.#record({
      action: `strata-${action}`,
      status: plan.status === 'planned' ? 'planned' : 'refused',
      detail: plan.status === 'planned' ? plan.impact : plan.reason,
    })
    return plan
  }

  async confirmStrataAction(confirmToken) {
    const outcome = await this._strataControl().confirm(confirmToken)
    this.#record({
      action: `strata-${outcome.action ?? 'unknown'}`,
      status: outcome.status,
      detail: outcome.status === 'ok' ? outcome.message : outcome.reason ?? '',
    })
    return outcome
  }

  /**
   * Step 1 of an operational action: build the safety envelope and a
   * single-use confirm token. Refusals carry plain-language reasons.
   * Pass `params.instancePort` to target a specific multi-instance server;
   * absent falls back to the single-instance actions machine.
   * @param {string} action 'start' | 'stop' | 'switch'.
   * @param {{modelKey?: string, instancePort?: number}} [params] target model and/or instance port.
   */
  async planAction(action, params) {
    const instancePort = typeof params?.instancePort === 'number' ? params.instancePort : undefined
    let actions = this.actions
    if (instancePort !== undefined && this.instanceActions.length > 0) {
      const entry = this.instanceActions.find((e) => e.instanceConfig.port === instancePort)
      if (entry === undefined) {
        const reason = `instance port ${instancePort} is not a configured multi-instance port`
        this.#record({ action, status: 'refused', detail: reason })
        return { status: 'refused', reason }
      }
      // Refuse destructive actions on servers this panel did not start.
      if (action === 'stop' || action === 'switch') {
        const lockDir = (process.env['XDG_RUNTIME_DIR'] ?? '/run/user/1000') + '/dsh-launcher'
        try {
          await (this.state.access ?? access)(`${lockDir}/instance-p${instancePort}.rec`)
        } catch {
          const reason = `instance on port ${instancePort} was not started by this panel's launcher — stop is only available for servers this panel started`
          this.#record({ action, status: 'refused', detail: reason })
          return { status: 'refused', reason }
        }
      }
      actions = entry.actions
    }
    const plan = await actions.plan(action, params ?? {})
    if (plan.status !== 'planned') {
      this.#record({ action, status: 'refused', detail: plan.reason })
      return plan
    }
    return plan
  }

  /**
   * Step 2: the owner confirms. The busy state is re-checked right before
   * execution; the token is single-use. The confirm routes to whichever actions
   * machine issued the token — the per-instance machines are searched when the
   * main machine does not hold it.
   * @param {string} confirmToken token from planAction.
   * @param {{acknowledgeInterruption?: boolean}} [acknowledgment] explicit interruption acknowledgment.
   */
  async confirmAction(confirmToken, acknowledgment) {
    const tid = typeof confirmToken === 'string' ? confirmToken : ''
    // Locate which actions machine issued the token.
    let actions = this.actions
    let instanceEntry = undefined
    if (this.instanceActions.length > 0 && !this.actions._tokens.has(tid)) {
      for (const entry of this.instanceActions) {
        if (entry.actions._tokens.has(tid)) {
          actions = entry.actions
          instanceEntry = entry
          break
        }
      }
    }
    const outcome = await actions.confirm(tid, acknowledgment ?? {})
    this.#record({ action: outcome.action ?? 'unknown', status: outcome.status, detail: outcome.status === 'ok' ? 'completed' : outcome.reason ?? outcome.explanation ?? outcome.output ?? '' })
    if (outcome.status === 'ok' && outcome.action === 'start') {
      const model = this.state.modelByKey(typeof outcome.modelKey === 'string' ? outcome.modelKey : '')
      // Use the per-instance probe when the token came from an instance machine,
      // so context verification checks the correct endpoint instead of endpointBase.
      const probeFn = instanceEntry !== undefined
        ? (this.state.probeInstances?.[instanceEntry.instanceConfig.port] ?? (() => this.state.probe()))
        : undefined
      const verification = model === undefined ? undefined : await this.#verifyStartedContext(model, outcome, probeFn)
      if (verification !== undefined) return { ...outcome, context: verification }
    }
    return outcome
  }

  /**
   * Step 1 of a profile-based launch: validate the profile, check GPU
   * boundary, check engine support, find the model, check the launcher, probe
   * the server, and issue a single-use confirm token with an honest preview.
   * Refusals carry plain-language reasons. The three inference states (release,
   * installed, verified) are never consulted or implied here.
   * @param {string} profileId the configured launch profile to plan.
   */
  async planLaunch(profileId) {
    const { state } = this
    const { config } = state

    // 1. Find the profile in the validated config.
    const profile = config.launchProfiles.find((p) => p.profileId === profileId)
    if (profile === undefined) {
      const reason = `launch profile "${profileId}" is not configured`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 2. GPU boundary: every UUID must not be the currently-reserved protected
    //    GPU, and must be in the owner-configured allowed set. When the owner
    //    has explicitly released the protected-GPU reservation, the UUID check
    //    passes here and the allowedSet check below gates the outer boundary.
    const allowedSet = new Set(config.allowedGpuUuids)
    for (const uuid of profile.gpuUuids) {
      if (this.actions.isGpuReserved(uuid)) {
        const gpuName = (uuid === config.caseGpuUuid ? config.caseGpuName : config.protectedGpuName) ?? uuid
        const reason = `profile "${profileId}" includes ${gpuName} (${uuid}), which you reserved manually as a launch target (a manual lock persists across refreshes and restarts); release it in My Graphics Cards before targeting this GPU`
        this.#record({ action: 'launch', status: 'refused', detail: reason })
        return { status: 'refused', reason }
      }
      if (!allowedSet.has(uuid)) {
        const reason = `profile "${profileId}" references GPU ${uuid} which is not in the allowed GPU list`
        this.#record({ action: 'launch', status: 'refused', detail: reason })
        return { status: 'refused', reason }
      }
    }

    // 3. GPU mode: "both" requires at least two GPU UUIDs in the profile.
    if (profile.gpuMode === 'both' && profile.gpuUuids.length < 2) {
      const reason = `profile "${profileId}" uses gpuMode "both" but provides only ${profile.gpuUuids.length} GPU UUID${profile.gpuUuids.length === 1 ? '' : 's'}; gpuMode "both" requires at least two UUID entries in gpuUuids`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 4. Engine support: check via the engine adapter registry.
    const adapterCheck = validateEngineAdapter(profile.engineId)
    if (!adapterCheck.ok) {
      const reason = `profile "${profileId}" uses engine "${profile.engineId}" which the trusted launcher does not currently support`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 4b. Launch flags must not set the context themselves: the selected
    //     context argv is appended last, so an owner `-c` inside launchArgs
    //     would make the applied context ambiguous. Refuse loudly instead.
    const conflictingFlag = conflictingContextFlag(profile.launchArgs)
    if (conflictingFlag !== undefined) {
      const reason = `launch profile "${profileId}" sets the context through "${conflictingFlag}" in launchArgs; remove it so the panel-selected context applies`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 5. Model lookup: profile.modelKey must match an LMM-managed model key.
    const model = state.modelByKey(profile.modelKey)
    if (model === undefined) {
      const reason = `profile "${profileId}" references model key "${profile.modelKey}" which is not in the managed catalog`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // Determine the target instance for per-slot probe and launcher selection.
    // A single-GPU profile whose GPU UUID matches one configured instance targets
    // that slot; all other profiles (both-GPU, or no matching instance) fall back
    // to the global probe and installed launcher.
    const targetInstance = profile.gpuMode === 'single' && profile.gpuUuids.length === 1
      ? (config.instances.find((inst) => inst.gpuUuid === profile.gpuUuids[0]) ?? null)
      : null

    // 6. Launcher check: use the candidate launcher for per-instance targets.
    const effectiveLauncherPath = targetInstance !== null && config.candidateLauncherPath !== ''
      ? config.candidateLauncherPath
      : config.launcherPath
    const launcher = await checkLauncher(effectiveLauncherPath, { access: state.access })
    if (!launcher.ok) {
      const reason = `cannot operate: ${launcher.problem} (${effectiveLauncherPath})`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 7. Server probe: refuse if this slot already has something running.
    // Per-instance profiles probe only the target slot; global profiles probe endpointBase.
    const probeFn = targetInstance !== null
      ? (state.probeInstances?.[targetInstance.port] ?? (() => state.probe()))
      : (() => state.probe())
    const server = await probeFn()
    if (server.state === 'running' && server.modelPath === model.ggufPath) {
      const reason = `${model.name} is already the running model — nothing to launch`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    if (server.state === 'running') {
      const reason = targetInstance !== null
        ? `another model is running on port ${targetInstance.port}; stop this instance before launching a different model on it`
        : 'another model is running; use Switch to change the running model rather than launching a new one'
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 8. Issue a single-use token.
    const nowMs = (state.now ?? Date.now)()
    const tokenId = `launch-${nowMs.toString(36)}-${Math.floor(nowMs % 1e6).toString(36)}`
    this.#launchTokens.set(tokenId, { profile, model, targetInstance, createdAt: nowMs })
    for (const [id, token] of this.#launchTokens) {
      if (id !== tokenId && (state.now ?? Date.now)() - token.createdAt > config.confirmTtlMs) {
        this.#launchTokens.delete(id)
      }
    }

    const gpuNameByUuid = {
      [config.caseGpuUuid]: config.caseGpuName,
      [config.protectedGpuUuid]: config.protectedGpuName,
    }
    const gpuName = profile.gpuUuids.map((uuid) => gpuNameByUuid[uuid] ?? uuid).join(', ')

    return {
      status: 'planned',
      profileId,
      engineId: profile.engineId,
      engineVersion: profile.engineVersion,
      modelKey: profile.modelKey,
      modelName: model.name,
      gpuUuids: profile.gpuUuids,
      gpuMode: profile.gpuMode,
      gpuName,
      launchArgs: profile.launchArgs,
      label: profile.label,
      ...(profile.notes !== undefined ? { notes: profile.notes } : {}),
      impact: `${model.name} will be started on ${gpuName} using the "${profile.label}" launch profile (engine: ${profile.engineId} ${profile.engineVersion}).`,
      confirmToken: tokenId,
      expiresInMs: config.confirmTtlMs,
    }
  }

  /**
   * Step 2 of a profile-based launch: consume the single-use token, re-probe
   * the server state, and execute the launch via the trusted launcher. The
   * outcome is the launcher's real result, never an assumption.
   * @param {string} confirmToken token from planLaunch.
   */
  async confirmLaunch(confirmToken) {
    const { state } = this
    const { config } = state

    const token = this.#launchTokens.get(typeof confirmToken === 'string' ? confirmToken : '')
    if (token === undefined) {
      const reason = 'this launch confirmation is no longer valid (expired, already used, or never issued); plan the launch again'
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    if ((state.now ?? Date.now)() - token.createdAt > config.confirmTtlMs) {
      this.#launchTokens.delete(confirmToken)
      const reason = 'this launch confirmation has expired; plan the launch again'
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    this.#launchTokens.delete(confirmToken) // single use: consumed by this attempt

    // Re-probe before executing; use the per-instance probe for this slot when applicable.
    const { profile, model, targetInstance } = token
    const probeFn = targetInstance !== null
      ? (state.probeInstances?.[targetInstance.port] ?? (() => state.probe()))
      : (() => state.probe())
    const server = await probeFn()
    if (server.state === 'running') {
      const reason = 'the model server started running since this launch was planned; review the current state and plan again'
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // Build the launch command via the engine adapter; pass full process env so
    // the launcher inherits PATH and other required variables. The selected
    // context argv is appended last; when nothing is recorded, the launcher's
    // own config-derived context applies.
    const contextArgs = await this.#selectedContextArgs(model.key)
    const adapter = buildLlamaCppLaunch(profile, model, process.env, { contextArgv: contextArgs })
    if (!adapter.ok) {
      const reason = `cannot build launch command: ${adapter.reason}`
      this.#record({ action: 'launch', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // For per-instance profiles, use the candidate launcher and inject the
    // instance's port and GPU UUID so the launcher targets the correct slot.
    const executionConfig = targetInstance !== null
      ? { ...config, launcherPath: config.candidateLauncherPath }
      : config
    const executionEnv = targetInstance !== null
      ? { ...adapter.env, MODEL_SERVER_PORT: String(targetInstance.port), MODEL_SERVER_GPU_UUID: targetInstance.gpuUuid, CUDA_VISIBLE_DEVICES: targetInstance.gpuUuid }
      : adapter.env
    const executed = await runLauncherRaw(executionConfig, adapter.argv, executionEnv, { spawn: state.spawn })
    const detail = executed.status === 'ok' ? `profile "${profile.profileId}" launched` : executed.output ?? ''
    this.#record({ action: 'launch', status: executed.status, detail })
    const probeFnForVerify = targetInstance !== null
      ? (state.probeInstances?.[targetInstance.port] ?? undefined)
      : undefined
    const verification = await this.#verifyStartedContext(model, executed, probeFnForVerify)
    return {
      status: executed.status,
      profileId: profile.profileId,
      modelKey: profile.modelKey,
      exitCode: executed.exitCode,
      timedOut: executed.timedOut,
      output: executed.output,
      ...(verification !== undefined ? { context: verification } : {}),
      ...(executed.status === 'failed' && executed.exitCode !== 0 && executed.exitCode !== null
        ? { explanation: `the launcher exited with code ${executed.exitCode}` } : {}),
    }
  }

  /**
   * After a successful launcher run, read the live runtime context back and
   * compare it with the context the launch pinned (selection argv or launcher
   * config derivation). The outcome is recorded in the error ring and
   * returned for owner visibility; a mismatch never re-fails the launch
   * itself — the reported facts are the protection.
   * @param {object} model catalog row that was started.
   * @param {{status: string, output?: string}} executed launcher result.
   * @returns {Promise<{expected: number|undefined, live: number|undefined, verified: boolean, note: string}|undefined>}
   */
  async #verifyStartedContext(model, executed, probeFn) {
    const doProbe = probeFn ?? (() => this.state.probe())
    const server = await doProbe()
    if (server.state !== 'running' || server.modelPath !== model.ggufPath || server.liveContext === undefined) {
      return undefined
    }
    const context = server.liveContext
    const selections = this.state.config.contextSelectionsPath === ''
      ? { selections: {} }
      : await readContextSelections(this.state.config.contextSelectionsPath)
    const expected = selections.selections[model.key]?.context
    const verified = expected !== undefined && expected === context
    if (expected !== undefined && !verified) {
      this.#record({
        action: 'context-verify',
        status: 'failed',
        detail: `${model.name} is running with n_ctx ${context} but the selected context was ${expected}; requests sized for the selected value may be rejected until the server is started with the pinned value`,
      })
      return { expected, live: context, verified: false, note: 'the running server uses a different context than the selected one' }
    }
    if (expected !== undefined) {
      this.#record({ action: 'context-verify', status: 'ok', detail: `${model.name} is running with the selected context ${context}` })
    }
    return { expected, live: context, verified, note: verified ? 'the running server uses the selected context' : 'no selected context was recorded for this model' }
  }

  /** The bounded recent-operational-error list, latest last. */
  async recentErrors() {
    return { errors: [...this.#errors] }
  }

  /**
   * Validate and persist one new user-added GGUF discovery directory. The
   * path must be absolute, exist as a directory, and not duplicate an already-
   * configured location. Persists atomically to `userDiscoveryDirsPath`.
   * Returns `{ status: 'added', dir, dirs }` on success or
   * `{ status: 'refused' | 'failed', reason }` on failure.
   * @param {string} dirPath absolute path to add.
   */
  async addDiscoveryDir(dirPath) {
    const { config } = this.state

    // 1. Feature gate: the settings file path must be configured.
    if (config.userDiscoveryDirsPath === '') {
      return { status: 'refused', reason: 'userDiscoveryDirsPath is not configured in cordis.patch.yml; add it to enable this feature' }
    }

    // 2. Path format: must be a non-empty absolute path.
    if (typeof dirPath !== 'string' || !dirPath.trim().startsWith('/')) {
      return { status: 'refused', reason: 'The directory path must be an absolute path starting with /.' }
    }
    const normalized = dirPath.trim()

    // 3. Existence and type check.
    const doStat = this.state.stat ?? stat
    try {
      const info = await doStat(normalized)
      if (!info.isDirectory()) {
        return { status: 'refused', reason: `${normalized} is not a directory.` }
      }
    } catch {
      return { status: 'refused', reason: `${normalized} does not exist or cannot be read.` }
    }

    // 4. Read current user dirs; check for duplicates against both static and user-added.
    const userDirsResult = await this.state.readUserDirs()
    const currentUserDirs = userDirsResult.dirs ?? []
    const allConfigured = [...config.discoveryDirs, ...currentUserDirs]
    if (allConfigured.includes(normalized)) {
      return { status: 'refused', reason: `${normalized} is already a configured scan location.` }
    }

    // 5. Capacity limit.
    if (currentUserDirs.length >= MAX_USER_DIRS) {
      return { status: 'refused', reason: `Maximum of ${MAX_USER_DIRS} user-added directories reached.` }
    }

    // 6. Persist atomically.
    const newDirs = [...currentUserDirs, normalized]
    try {
      await this.state.writeUserDirs(newDirs)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.#record({ action: 'addDiscoveryDir', status: 'failed', detail: msg })
      return { status: 'failed', reason: `Could not save the directory list: ${msg}` }
    }

    return { status: 'added', dir: normalized, dirs: newDirs }
  }

  /**
   * Step 1 of an adopt-external-server operation: verify the running server's
   * process identity through seven independent checks and return a single-use
   * confirm token. Every check must pass; a single failure refuses the plan.
   * Checks: configured port, no existing ownership record, server running,
   * PID listening on port, GPU identity matches config, systemd unit found.
   * @param {number} port the instance port to adopt.
   */
  async planAdoptInstance(port) {
    const { state } = this
    const { config } = state

    // 1. Port must match a configured instance.
    const inst = config.instances.find((i) => i.port === port)
    if (inst === undefined) {
      const reason = `port ${port} is not a configured multi-instance port`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 2. Must not already be owned (no existing .rec file).
    const lockDir = (process.env['XDG_RUNTIME_DIR'] ?? '/run/user/1000') + '/dsh-launcher'
    try {
      await (state.access ?? access)(`${lockDir}/instance-p${port}.rec`)
      const reason = `port ${port} already has an ownership record; no adoption needed`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    } catch {
      // Expected: .rec file is absent — continue.
    }

    // 3. Server must be running (probe the instance endpoint).
    const probeForInstance = state.probeInstances?.[port] ?? (() => state.probe())
    const server = await probeForInstance()
    if (server.state !== 'running') {
      const reason = `port ${port} is not currently running; adopt is only available for running servers`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 4. Get the PID listening on the port.
    const execDeps = { execFile: state.execFile }
    const pid = await (state.getServerPid ?? getServerPid)(port, execDeps)
    if (typeof pid !== 'number') {
      const reason = `cannot identify the process listening on port ${port}; adopt cannot proceed without a verified PID`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 5. Identify the GPU UUID for this PID via nvidia-smi.
    const gpuData = await (state.queryGpus ?? queryGpus)(config.probeTimeoutMs, execDeps)
    if (gpuData.status === 'unavailable') {
      const reason = `cannot query GPU processes: ${gpuData.error ?? 'nvidia-smi unavailable'}; adopt cannot proceed without GPU identity verification`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    const gpuProcess = Array.isArray(gpuData.processes) ? gpuData.processes.find((p) => p.pid === pid) : undefined
    if (gpuProcess === undefined) {
      const reason = `PID ${pid} (port ${port}) was not found in the GPU process list; cannot verify GPU identity`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 6. The actual GPU UUID must match the configured GPU UUID for this instance.
    if (gpuProcess.uuid !== inst.gpuUuid) {
      const reason = `port ${port} is running on GPU ${gpuProcess.uuid} but this instance is configured for ${inst.gpuUuid}; adopt refused to prevent mis-attribution`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 7. Find the systemd unit owning this PID.
    const doFindUnit = state.findUnitForPid ?? findUnitForPid
    const unitResult = await doFindUnit(pid, execDeps)
    if (unitResult.status !== 'ok') {
      const reason = unitResult.status === 'error'
        ? `could not query systemd units: ${unitResult.error}`
        : `no active dsh-model-* systemd unit owns PID ${pid} on port ${port}; cannot create a verifiable ownership record`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // Issue a single-use token with the verified facts.
    const nowMs = (state.now ?? Date.now)()
    const tokenId = `adopt-${nowMs.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`
    this.#adoptTokens.set(tokenId, { port, pid, unitName: unitResult.unitName, gpuUuid: gpuProcess.uuid, modelPath: server.modelPath, createdAt: nowMs })
    for (const [id, tok] of this.#adoptTokens) {
      if (id !== tokenId && (state.now ?? Date.now)() - tok.createdAt > config.confirmTtlMs) {
        this.#adoptTokens.delete(id)
      }
    }

    const modelKey = server.modelPath !== undefined
      ? (config.models.find((m) => m.ggufPath === server.modelPath)?.key ?? null)
      : undefined
    const modelName = modelKey != null
      ? (config.models.find((m) => m.key === modelKey)?.name ?? modelKey)
      : (server.modelPath ?? 'unrecognized model')
    const gpuRow = Array.isArray(gpuData.gpus) ? gpuData.gpus.find((g) => g.uuid === inst.gpuUuid) : undefined
    const gpuDisplayName = gpuRow?.name ?? inst.gpuName ?? inst.gpuUuid

    return {
      status: 'planned',
      port,
      pid,
      unitName: unitResult.unitName,
      gpuUuid: inst.gpuUuid,
      gpuName: gpuDisplayName,
      modelPath: server.modelPath,
      ...(modelKey != null ? { modelKey } : {}),
      modelName,
      impact: `Port ${port} (${modelName} on ${gpuDisplayName}) will be adopted. Unit "${unitResult.unitName}" (PID ${pid}) becomes owner-managed. Stop and Switch controls will be enabled after adoption.`,
      confirmToken: tokenId,
      expiresInMs: config.confirmTtlMs,
    }
  }

  /**
   * Step 2 of an adopt-external-server operation: re-verify process identity
   * and write the ownership record atomically. Token is single-use. Four
   * re-checks: no existing record, PID unchanged on port, systemd unit
   * unchanged, then tmp→rename atomic write of the `.rec` file.
   * @param {string} confirmToken token from planAdoptInstance.
   */
  async confirmAdoptInstance(confirmToken) {
    const { state } = this
    const { config } = state

    // 1. Validate and consume the token.
    const token = this.#adoptTokens.get(typeof confirmToken === 'string' ? confirmToken : '')
    if (token === undefined) {
      const reason = 'this adopt confirmation is no longer valid (expired, already used, or never issued); plan the adoption again'
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    if ((state.now ?? Date.now)() - token.createdAt > config.confirmTtlMs) {
      this.#adoptTokens.delete(confirmToken)
      const reason = 'this adopt confirmation has expired; plan the adoption again'
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }
    this.#adoptTokens.delete(confirmToken) // single use: consumed by this attempt

    const { port, pid, unitName, gpuUuid, modelPath } = token
    const execDeps = { execFile: state.execFile }
    const lockDir = (process.env['XDG_RUNTIME_DIR'] ?? '/run/user/1000') + '/dsh-launcher'

    // 2. Re-check not already owned.
    try {
      await (state.access ?? access)(`${lockDir}/instance-p${port}.rec`)
      const reason = `port ${port} was adopted by another process since this was planned; no action taken`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    } catch {
      // Good: still absent.
    }

    // 3. Re-verify the same PID is still listening on the port.
    const currentPid = await (state.getServerPid ?? getServerPid)(port, execDeps)
    if (currentPid !== pid) {
      const reason = `the process on port ${port} changed between plan and confirm (was PID ${pid}, now ${currentPid ?? 'none'}); plan the adoption again`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 4. Re-verify the systemd unit still owns the same PID.
    const doFindUnit = state.findUnitForPid ?? findUnitForPid
    const unitResult = await doFindUnit(pid, execDeps)
    if (unitResult.status !== 'ok' || unitResult.unitName !== unitName) {
      const reason = unitResult.status !== 'ok'
        ? `could not re-verify the systemd unit for PID ${pid}: ${unitResult.status === 'error' ? unitResult.error : 'unit not found'}`
        : `the systemd unit owning PID ${pid} changed between plan and confirm; plan the adoption again`
      this.#record({ action: 'adopt', status: 'refused', detail: reason })
      return { status: 'refused', reason }
    }

    // 5. Write the ownership record atomically (tmp → rename), matching the
    //    candidate launcher's .rec format exactly.
    const recPath = `${lockDir}/instance-p${port}.rec`
    const tmpPath = `${recPath}.tmp-adopt`
    const recContent = `unit=${unitName}\ngpu=${gpuUuid}\nmodel=${modelPath ?? ''}\nport=${port}\n`
    try {
      const doWrite = state.writeFile ?? writeFile
      const doRename = state.rename ?? rename
      await doWrite(tmpPath, recContent, 'utf8')
      await doRename(tmpPath, recPath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.#record({ action: 'adopt', status: 'failed', detail: `failed to write ownership record: ${msg}` })
      return { status: 'failed', reason: `could not write ownership record: ${msg}` }
    }

    this.#record({ action: 'adopt', status: 'ok', detail: `port ${port} adopted; unit ${unitName} (PID ${pid})` })
    return {
      status: 'ok',
      port,
      unitName,
      gpuUuid,
      modelPath,
      message: `Port ${port} is now owner-managed. Stop and Switch controls are enabled.`,
    }
  }

  /**
   * Step 1 of a GPU compute-mode change: validate the UUID against the
   * configured allowlist, read the current mode, and return a single-use
   * confirm token. The UI-supplied UUID is never trusted without allowlist
   * validation. Refusals carry plain-language reasons and the required
   * disclosure.
   * @param {string} uuid GPU UUID from the UI (validated against config allowlist here).
   * @param {'locked'|'unlocked'} desiredState the requested target state.
   */
  async planGpuLock(uuid, desiredState) {
    const plan = await this.gpuLock.plan(
      typeof uuid === 'string' ? uuid : '',
      typeof desiredState === 'string' ? desiredState : '',
    )
    if (plan.status !== 'planned') {
      this.#record({ action: `gpu-lock:${desiredState ?? 'unknown'}`, status: 'refused', detail: plan.reason })
    }
    return plan
  }

  /**
   * Step 2 of a GPU compute-mode change: the owner confirms. The mode is
   * re-read immediately before the driver command; the token is single-use.
   * The outcome is the real driver result, never an assumption.
   * @param {string} confirmToken token from planGpuLock.
   */
  async confirmGpuLock(confirmToken) {
    const outcome = await this.gpuLock.confirm(typeof confirmToken === 'string' ? confirmToken : '')
    const detail = outcome.status === 'ok'
      ? `compute mode set to ${outcome.actualMode} on ${outcome.gpuName}`
      : outcome.error ?? outcome.reason ?? outcome.warning ?? ''
    this.#record({ action: `gpu-lock:${outcome.desiredState ?? 'unknown'}`, status: outcome.status, detail })
    return outcome
  }

  /**
   * Step 1 of a manual GPU launch reservation change. Generic: works for every
   * allowlisted GPU and both directions (reserve / release). The plan is
   * evaluated against the durable manual reservation set — with no state file
   * and no entries, every GPU is unreserved and a release is refused as a
   * no-op.
   * @param {{uuid?: string, desired?: string}} params uuid + 'reserved'|'unreserved'.
   */
  async planGpuReservation(params) {
    const plan = this.actions.planGpuReservation(
      typeof params?.uuid === 'string' ? params.uuid : '',
      params?.desired === 'reserved' ? 'reserved' : params?.desired === 'unreserved' ? 'unreserved' : 'invalid',
    )
    if (plan.status !== 'planned') {
      this.#record({ action: `gpu-reservation:${plan.desired ?? 'unknown'}`, status: 'refused', detail: plan.reason })
    }
    return plan
  }

  /**
   * Step 2: the owner confirms the reservation change. On success the new set
   * is persisted atomically to the durable state file; an empty file or a
   * missing file still means "nothing is reserved".
   * @param {string} confirmToken token from planGpuReservation.
   */
  async confirmGpuReservation(confirmToken) {
    const outcome = this.actions.confirmGpuReservation(typeof confirmToken === 'string' ? confirmToken : '')
    let persisted = false
    if (outcome.status === 'ok' && this.state.config.gpuLaunchStatePath !== '') {
      try {
        const write = this.state.writeGpuLaunchState ?? writeGpuLaunchState
        write(this.state.config.gpuLaunchStatePath, this.actions.getReservedGpus())
        this.#manualLaunchReservations = null // clear the pending override; the file is now the authority
        persisted = true
      } catch (error) {
        persisted = false
        this.#record({ action: 'gpu-launch-state-write', status: 'failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    const detail = outcome.status === 'ok'
      ? `${outcome.message}${persisted ? '' : ' (in-memory only: no durable state path is configured)'}`
      : outcome.error ?? outcome.reason ?? ''
    this.#record({ action: `gpu-reservation:${outcome.desired ?? 'unknown'}`, status: outcome.status, detail })
    return { ...outcome, persisted }
  }

  /**
   * Read the durable manual reservations. Every read consults the state file
   * (a pending in-memory write from a just-confirmed change takes precedence
   * until the file catches up), so a reservation released by another service
   * instance is never resurrected from a stale copy. A missing file, a read
   * error, or an unrecognized file all degrade to the unreserved state; the
   * service never synthesizes a reservation.
   * @returns {string[]}
   */
  #reservedGpus() {
    if (this.#manualLaunchReservations !== null) return this.#manualLaunchReservations
    if (this.state.config.gpuLaunchStatePath === '') return []
    const read = this.state.readGpuLaunchState ?? readGpuLaunchState
    const stored = read(this.state.config.gpuLaunchStatePath)
    if (stored.readError !== undefined) {
      this.#record({ action: 'gpu-launch-state-read', status: 'failed', detail: stored.readError })
    }
    return stored.reservations
  }
}

/** One merged marker set for all exported methods, stored on the service prototype. */
Object.defineProperty(LocalModelManagerService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))),
  }),
})

export function apply(ctx, config) {
  const configValue = validateConfig(config)
  const state = {
    config: configValue,
    modelByKey: (key) => configValue.models.find((model) => model.key === key),
    probe: (deps) => probeServer(configValue.endpointBase, configValue.probeTimeoutMs, { fetch: deps?.fetch }),
    // Read-only observation of local servers this manager does not launch.
    observeEndpoints: () => Promise.all(configValue.localEndpoints.map((entry) => observeEndpoint(entry, configValue.probeTimeoutMs, {}))),
    // Per-instance probes: keyed by port number, one per configured instance.
    probeInstances: Object.fromEntries(configValue.instances.map((inst) => [
      inst.port,
      () => probeServer(`http://127.0.0.1:${inst.port}`, configValue.probeTimeoutMs, {}),
    ])),
    readProviderFacts: () => readProviderFacts(configValue),
    readGgufMeta: (ggufPath) => readGgufMeta(ggufPath),
    execFile: undefined,
    stat: undefined,
    spawn: undefined,
    access: undefined,
    findUnitForPid: undefined,
    writeFile: undefined,
    rename: undefined,
    buildDiscovery: (dirs, knownPaths, mmprojPaths) => buildDiscoveryResult(dirs, knownPaths, mmprojPaths),
    writeDiscovery: (destPath, result) => writeDiscoveryCache(destPath, result),
    readUserDirs: () => readUserDirs(configValue.userDiscoveryDirsPath),
    readGpuLaunchState: (path) => readGpuLaunchState(path),
    writeGpuLaunchState: (path, reservations) => writeGpuLaunchState(path, reservations),
    writeUserDirs: (dirs) => writeUserDirs(configValue.userDiscoveryDirsPath, dirs),
    queryComputeMode: undefined,
    applyComputeMode: undefined,
    detectVllm: async () => {
      try {
        await access(configValue.vllmBinPath)
        return 'detected'
      } catch {
        return 'absent'
      }
    },
    // V2A: Model Advisor adapter - read-only, bounded, never throws
    getModelAdvisorData: async () => {
      const timeoutMs = configValue.probeTimeoutMs * 3 // 9s default for Model Advisor
      const [hardwareResult, runtimesResult, compatibilityResult] = await Promise.all([
        getHardwareProfile({ timeoutMs }),
        getRuntimeDiscovery([], { timeoutMs }),
        getCompatibility([], { timeoutMs }),
      ])
      return {
        hardware: hardwareResult.status === 'ok'
          ? { status: 'ok', data: hardwareResult.hardware }
          : { status: 'unavailable', error: hardwareResult.error },
        runtimes: runtimesResult.status === 'ok'
          ? { status: 'ok', data: runtimesResult.runtimes }
          : { status: 'unavailable', error: runtimesResult.error },
        compatibility: compatibilityResult.status === 'ok'
          ? { status: 'ok', data: compatibilityResult.compatibility }
          : { status: 'unavailable', error: compatibilityResult.error },
      }
    },
  }
  const service = createLocalModelManagerService(state)
  ctx.effect(() => ctx.reflect.provide(SERVICE_KEY, service), 'local-model-manager: service')
  // The sampler's timer is owned by this effect: releasing the plugin stops it,
  // so no sampling continues against a torn-down service.
  ctx.effect(() => {
    const release = service.startSampling()
    return async () => { await release() }
  }, 'local-model-manager: power sampler')
}