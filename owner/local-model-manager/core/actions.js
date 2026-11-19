/**
 * The only execution path of the plugin: allowlisted invocations of the
 * trusted `dsh-model-server` launcher with fixed argv (no shell, no
 * interpolation). Every disruptive action is a two-step owner flow:
 * plan (safety envelope + single-use token) then confirm (state re-checked
 * immediately before execution). Active-job detection is authoritative from
 * `/slots`; when busy state cannot be verified, disruptive actions fail
 * closed. The spawn environment pins `CUDA_VISIBLE_DEVICES` to the CASE GPU
 * UUID as defense in depth on top of the launcher's own pin — the protected
 * GPU UUID never enters any spawned environment.
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { access, constants as fsConstants } from 'node:fs/promises'

/** Actions the allowlist recognizes; anything else is refused before use. */
export const ALLOWED_ACTIONS = /** @type {const} */ (['start', 'stop', 'switch'])

/** Model keys and switch names come from validated config; the argv builder double-checks. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/

/**
 * Build the launcher argv for one allowlisted action. `extraArgs` (used for
 * the selected context `-c` pin) are appended on `start` only: the launcher's
 * trailing-args slot is honored there, while `switch` execs `start-<target>`
 * without forwarding extra arguments, so a pinned switch would be silently
 * dropped. Switch contexts are covered by the post-start live verification
 * instead.
 * @param {string} action allowlisted action.
 * @param {{switchName: string}} [model] catalog row for start/switch.
 * @param {string[]} [extraArgs] validated argv fragment appended on start.
 * @returns {string[]|null} argv, or null when not allowlisted.
 */
export const launcherArgv = (action, model, extraArgs = []) => {
  const safeExtra = Array.isArray(extraArgs) ? extraArgs : []
  switch (action) {
    case 'stop': return ['stop']
    case 'start': return model !== undefined && SAFE_SLUG.test(model.switchName ?? '')
      ? ['start-' + model.switchName, ...safeExtra]
      : null
    case 'switch': return model !== undefined && SAFE_SLUG.test(model.switchName ?? '')
      ? ['switch', model.switchName]
      : null
    default: return null
  }
}

/**
 * Check the launcher itself is present and executable.
 * @param {string} launcherPath configured launcher path.
 * @param {{access?: typeof access}} [deps] injectable access for tests.
 * @returns {Promise<{ok: true}|{ok: false, problem: string}>}
 */
export const checkLauncher = async (launcherPath, deps = {}) => {
  const doAccess = deps.access ?? access
  if (typeof launcherPath !== 'string' || launcherPath.length === 0 || !isAbsolute(launcherPath)) {
    return { ok: false, problem: 'the launcher path is not configured correctly' }
  }
  try {
    const result = await doAccess(launcherPath, fsConstants.X_OK)
    // fs.access resolves undefined on success; an Error result means failure.
    if (result instanceof Error) {
      const code = result.code
      return { ok: false, problem: code === 'ENOENT' ? 'the launcher file was not found' : 'the launcher is not executable by this account (permission denied)' }
    }
    return { ok: true }
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    return { ok: false, problem: code === 'ENOENT' ? 'the launcher file was not found' : 'the launcher is not executable by this account (permission denied)' }
  }
}

const friendlyExitNote = (code) => ({
  2: 'the launcher reported a usage problem (unknown model or command)',
  3: 'the port is already used by another process; nothing was stopped or started',
  4: 'the server did not become ready in time; see the launcher log it named',
  5: 'the launcher could not verify which process owns the port, so it refused to stop anything',
  6: 'the process on the port is not one of our known model servers; the launcher refused to touch it',
  7: 'the verified server did not release the port; no force-kill was attempted',
}[code] ?? `the launcher exited with code ${code}`)

/**
 * Spawn the launcher for one allowlisted action and collect its output.
 * `deps.contextArgs` (validated `-c` pin from the context sizer) is appended
 * to start actions; see launcherArgv.
 * @param {object} config validated plugin config.
 * @param {string} action allowlisted action.
 * @param {{switchName: string}} model catalog row.
 * @param {{spawn?: typeof spawn, contextArgs?: string[]}} [deps] injectable spawn for tests plus the selected context argv.
 * @returns {Promise<{status: 'ok'|'failed', exitCode: number|null, timedOut: boolean, output: string}>}
 */
export const runLauncher = (config, action, model, deps = {}) => {
  const doSpawn = deps.spawn ?? spawn
  const argv = launcherArgv(action, model, deps.contextArgs)
  if (argv === null) return Promise.resolve({ status: 'failed', exitCode: null, timedOut: false, output: `action ${action} is not on the allowlist` })
  if (config.preferredLaunchGpuUuid.length === 0) {
    return Promise.resolve({ status: 'failed', exitCode: null, timedOut: false, output: 'no preferred launch GPU is configured; refusing to launch so a specific GPU is always selected explicitly' })
  }
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    // Pin CUDA_VISIBLE_DEVICES to the preferred launch GPU (RTX 3090 Ti);
    // the launcher honors this environment pin and falls back to the same
    // preferred UUID for direct invocations, so the target is never ambiguous.
    const env = { ...process.env, CUDA_VISIBLE_DEVICES: config.preferredLaunchGpuUuid }
    const child = doSpawn(config.launcherPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, config.actionTimeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ status: 'failed', exitCode: null, timedOut, output: `${output}\nlaunch error: ${error.message}`.trim() })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code === 0 && !timedOut ? 'ok' : 'failed', exitCode: code, timedOut, output: output.trim() })
    })
  })
}

/**
 * Spawn the launcher with a pre-built argv and environment. Same timeout and
 * output collection as runLauncher, but the caller controls argv and env
 * entirely; no validation or default env injection is applied here.
 * @param {object} config validated plugin config.
 * @param {string[]} argv pre-built argument vector for the launcher.
 * @param {Record<string, string>} env pre-built spawn environment.
 * @param {{spawn?: typeof spawn}} [deps] injectable spawn for tests.
 * @returns {Promise<{status: 'ok'|'failed', exitCode: number|null, timedOut: boolean, output: string}>}
 */
export const runLauncherRaw = (config, argv, env, deps = {}) => {
  const doSpawn = deps.spawn ?? spawn
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const child = doSpawn(config.launcherPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, config.actionTimeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ status: 'failed', exitCode: null, timedOut, output: `${output}\nlaunch error: ${error.message}`.trim() })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code === 0 && !timedOut ? 'ok' : 'failed', exitCode: code, timedOut, output: output.trim() })
    })
  })
}

/**
 * Spawn the candidate multi-instance launcher for one allowlisted action,
 * targeting a specific server instance. Injects MODEL_SERVER_PORT,
 * MODEL_SERVER_GPU_UUID, and CUDA_VISIBLE_DEVICES for the named instance;
 * uses config.candidateLauncherPath (never the installed launcherPath).
 * @param {object} config validated plugin config.
 * @param {{port: number, gpuUuid: string}} instanceConfig target instance.
 * @param {string} action allowlisted action.
 * @param {{switchName: string}} [model] catalog row for start/switch.
 * @param {{spawn?: typeof spawn, contextArgs?: string[]}} [deps]
 * @returns {Promise<{status: 'ok'|'failed', exitCode: number|null, timedOut: boolean, output: string}>}
 */
export const runLauncherForInstance = (config, instanceConfig, action, model, deps = {}) => {
  const doSpawn = deps.spawn ?? spawn
  const argv = launcherArgv(action, model, deps.contextArgs)
  if (argv === null) return Promise.resolve({ status: 'failed', exitCode: null, timedOut: false, output: `action ${action} is not on the allowlist` })
  if (!config.candidateLauncherPath || config.candidateLauncherPath.length === 0) {
    return Promise.resolve({ status: 'failed', exitCode: null, timedOut: false, output: 'no candidateLauncherPath is configured; multi-instance operations require an explicit candidate launcher path' })
  }
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const env = {
      ...process.env,
      MODEL_SERVER_PORT: String(instanceConfig.port),
      MODEL_SERVER_GPU_UUID: instanceConfig.gpuUuid,
      CUDA_VISIBLE_DEVICES: instanceConfig.gpuUuid,
    }
    const child = doSpawn(config.candidateLauncherPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, config.actionTimeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ status: 'failed', exitCode: null, timedOut, output: `${output}\nlaunch error: ${error.message}`.trim() })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code === 0 && !timedOut ? 'ok' : 'failed', exitCode: code, timedOut, output: output.trim() })
    })
  })
}

/**
 * GPU launch reservations are a GENERIC owner feature: one allowlisted GPU may
 * be manually reserved as a launch target through the panel, and the choice
 * persists. No GPU is reserved automatically — the set starts empty and stays
 * empty until an explicit owner confirm applies a reservation. Absence from
 * the set is the unreserved state; nothing re-applies a reservation by
 * default, on startup, or after any restart.
 */
const GPU_RESERVATION_DISCLOSURE = 'The choice is persisted and survives refreshes and service restarts. Nothing re-applies or removes it automatically — only your own reserve/release action changes it. Reserving a GPU does not stop or displace any workload already running on it; launch attempts onto it are refused while you keep it reserved.'

/**
 * Create the plan/confirm state machine. `deps.probe` returns the current
 * server probe; all safety decisions read it fresh at plan and confirm time.
 * `deps.contextArgs` resolves the selected-context argv fragment (from the
 * context selections file) that start actions append; absent means the
 * launcher's own config-derived context applies. May be async.
 * `deps.reservedGpus` reads and `deps.setReservedGpus` updates the manual
 * reservation set the service persists; the set starts and stays empty
 * without owner action.
 * `deps.instanceConfig` binds this machine to one multi-instance server (port +
 * GPU UUID): plan uses candidateLauncherPath for its executable check and
 * confirm calls runLauncherForInstance. Absent means single-instance mode.
 * @param {object} config validated plugin config.
 * @param {{probe: () => Promise<object>, modelByKey: (key: string) => object|undefined, spawn?: typeof spawn, access?: typeof access, now?: () => number, contextArgs?: (modelKey: string|undefined) => string[]|Promise<string[]>, reservedGpus?: () => string[], setReservedGpus?: (uuids: string[]) => void, instanceConfig?: {port: number, gpuUuid: string, gpuName: string}}} deps
 */
export const createActions = ({ config, probe, modelByKey, spawn: spawnDep, access: accessDep, now = Date.now, contextArgs: contextArgsDep, reservedGpus: reservedGpusDep, setReservedGpus: setReservedGpusDep, instanceConfig }) => {
  /** Single-use confirm tokens: tokenId → bound plan. */
  const tokens = new Map()

  /**
   * Manual launch reservations: UUIDs the owner reserved. Empty is the default
   * and the unreserved state; the owner's explicit reserve/release tokens are
   * the only writers (via `setReservedGpus`, which the service persists).
   */
  const reservedGpus = () => (typeof reservedGpusDep === 'function' ? reservedGpusDep() : [])
  const applyReservedGpus = (uuids) => {
    if (typeof setReservedGpusDep === 'function') setReservedGpusDep(uuids)
  }

  /** Allowlisted GPU identity for reservation decisions. */
  const gpuByUuid = () => new Map([
    [config.preferredLaunchGpuUuid, config.protectedGpuName],
    [config.caseGpuUuid, config.caseGpuName],
  ])

  /**
   * Step 1 of a manual GPU launch reservation change. Generic: works for every
   * allowlisted GPU and both directions (reserve / release). Returns a
   * single-use confirm token with plain-language impact.
   * @param {string} uuid GPU UUID supplied by the UI (must be in the config allowlist).
   * @param {'reserved'|'unreserved'} desired the requested direction.
   */
  const planGpuReservation = (uuid, desired) => {
    const gpus = gpuByUuid()
    const gpuName = gpus.get(typeof uuid === 'string' ? uuid : '')
    if (gpuName === undefined) {
      return { status: 'refused', reason: 'that GPU UUID is not in the configured allowlist and cannot be targeted for reservation changes' }
    }
    if (desired !== 'reserved' && desired !== 'unreserved') {
      return { status: 'refused', reason: `"${desired}" is not a supported reservation state; only "reserved" and "unreserved" are valid` }
    }
    const currentlyReserved = reservedGpus().includes(uuid)
    if (desired === 'reserved' && currentlyReserved) {
      return { status: 'refused', reason: `${gpuName} is already a manual launch reservation — nothing to change.` }
    }
    if (desired === 'unreserved' && !currentlyReserved) {
      return { status: 'refused', reason: `${gpuName} is not reserved — no GPU is reserved automatically, so releasing it now would change nothing.` }
    }
    const nowMs = now()
    const tokenId = `res-${nowMs.toString(36)}-${Math.floor(nowMs % 1e6).toString(36)}`
    tokens.set(tokenId, { uuid, gpuName, desired, createdAt: nowMs })
    // Bounded token store: drop expired entries (never the one just created).
    for (const [id, token] of tokens) {
      if (id !== tokenId && now() - token.createdAt > config.confirmTtlMs) tokens.delete(id)
    }
    const impact = desired === 'reserved'
      ? `${gpuName} will be reserved as a model launch target. Launch attempts onto it are refused while it stays reserved. Nothing currently running on the GPU is affected, and no other GPU's targeting changes.`
      : `${gpuName} will become available as a model launch target again. Nothing currently running on the GPU is affected, and no other GPU's targeting changes.`
    return {
      status: 'planned',
      gpuUuid: uuid,
      gpuName,
      desired,
      impact,
      disclosure: GPU_RESERVATION_DISCLOSURE,
      confirmToken: tokenId,
      expiresInMs: config.confirmTtlMs,
    }
  }

  /**
   * Step 2: the owner confirms the reservation change. The token is single-use
   * and expires; the new state is applied to the in-memory set (which the
   * service persists) and verified via the set contents.
   * @param {string} tokenId token from planGpuReservation().
   */
  const confirmGpuReservation = (tokenId) => {
    const token = tokens.get(tokenId)
    if (token === undefined) {
      return { status: 'refused', reason: 'this confirmation is no longer valid (expired, already used, or never issued). Review the action again and confirm once more.' }
    }
    if (now() - token.createdAt > config.confirmTtlMs) {
      tokens.delete(tokenId)
      return { status: 'refused', reason: 'this confirmation has expired — review the action again and confirm once more.' }
    }
    tokens.delete(tokenId) // single use: consumed by this attempt
    const current = reservedGpus()
    const next = token.desired === 'reserved'
      ? (current.includes(token.uuid) ? current : [...current, token.uuid])
      : current.filter((uuid) => uuid !== token.uuid)
    applyReservedGpus(next)
    const applied = reservedGpus().includes(token.uuid)
    const persisted = applied === (token.desired === 'reserved')
    if (!persisted) {
      return { status: 'failed', gpuUuid: token.uuid, gpuName: token.gpuName, desired: token.desired, error: 'the reservation update did not take effect; the persisted state was not changed', }
    }
    return {
      status: 'ok',
      gpuUuid: token.uuid,
      gpuName: token.gpuName,
      desired: token.desired,
      persisted: true,
      message: token.desired === 'reserved'
        ? `${token.gpuName} is now reserved as a model launch target. The choice is persisted; only your own release action removes it.`
        : `${token.gpuName} is now available as a model launch target. The choice is persisted; nothing re-applies the reservation automatically.`,
    }
  }

  /**
   * Step 1: build the safety envelope for one action and hand back a
   * single-use confirm token. Refusals carry plain-language reasons.
   * @param {string} action allowlisted action.
   * @param {{modelKey?: string}} [params] validated params.
   */
  const plan = async (action, params = {}) => {
    if (!ALLOWED_ACTIONS.includes(action)) {
      return { status: 'refused', reason: `the action "${action}" is not one this panel can perform` }
    }
    const model = action === 'stop' ? undefined : modelByKey(typeof params.modelKey === 'string' ? params.modelKey : '')
    if (action !== 'stop' && model === undefined) {
      return { status: 'refused', reason: 'that model is not in the managed inventory — choose one of the listed models' }
    }
    // Multi-instance mode uses the candidate launcher; single-instance uses the installed launcher.
    const effectiveLauncherPath = instanceConfig !== undefined ? config.candidateLauncherPath : config.launcherPath
    const launcher = await checkLauncher(effectiveLauncherPath, { access: accessDep })
    if (launcher.ok !== true) {
      return { status: 'refused', reason: `cannot operate: ${launcher.problem} (${effectiveLauncherPath})` }
    }
    const server = await probe()
    if (action !== 'start') {
      // Disruptive actions require reliable active-job detection: fail closed
      // when the running server's slots could not be read.
      if (server.state === 'stopped') {
        return { status: 'refused', reason: 'the model server is already stopped — there is nothing to stop or switch' }
      }
      if (server.state !== 'running' || server.busyUnknown !== false) {
        return { status: 'refused', reason: 'the system cannot safely verify whether work is running on the server (the slot status could not be read), so stop and switch are refused. Wait for current jobs to finish or check the server, then try again.' }
      }
    }
    const busySlots = (server.slots ?? []).filter((slot) => slot.isProcessing)
    if (action === 'start') {
      if (server.state === 'running' && server.modelPath === model.ggufPath) {
        return { status: 'refused', reason: `${model.name} is already the model that is running` }
      }
      if (server.state === 'running') {
        return { status: 'refused', reason: 'another model is currently running; one local model serves at a time. Use Switch to change the running model.' }
      }
    }
    const impact = (() => {
      if (action === 'stop') return 'The running model server will be shut down. Any in-flight requests will be stopped.'
      if (action === 'start') return `${model.name} will be started on the local endpoint using the tested launcher settings.`
      return `The running model will be stopped and ${model.name} will be started in its place. Any in-flight requests will be stopped.`
    })()
    const requiresAcknowledge = action !== 'start' && busySlots.length > 0
    const nowMs = now()
    const tokenId = `act-${nowMs.toString(36)}-${Math.floor(nowMs % 1e6).toString(36)}`
    tokens.set(tokenId, { action, model, requiresAcknowledge, createdAt: nowMs })
    // Bounded token store: drop expired entries (never the one just created).
    for (const [id, token] of tokens) {
      if (id !== tokenId && now() - token.createdAt > config.confirmTtlMs) tokens.delete(id)
    }
    return {
      status: 'planned',
      action,
      modelKey: model?.key,
      impact,
      activeJobs: busySlots.map((slot) => ({ slot: slot.id, task: slot.task })),
      requiresAcknowledge,
      confirmToken: tokenId,
      expiresInMs: config.confirmTtlMs,
    }
  }

  /**
   * Step 2: the owner confirms. State is re-probed immediately before
   * execution; tokens are single-use and expire.
   * @param {string} tokenId token from plan().
   * @param {{acknowledgeInterruption?: boolean}} [confirm] owner acknowledgment.
   */
  const confirm = async (tokenId, confirm = {}) => {
    const token = tokens.get(tokenId)
    if (token === undefined) {
      return { status: 'refused', reason: 'this confirmation is no longer valid (expired, already used, or never issued). Review the action again and confirm once more.' }
    }
    if (now() - token.createdAt > config.confirmTtlMs) {
      tokens.delete(tokenId)
      return { status: 'refused', reason: 'this confirmation has expired — review the action again and confirm once more.' }
    }
    tokens.delete(tokenId) // single use: consumed by this attempt
    if (token.requiresAcknowledge && confirm.acknowledgeInterruption !== true) {
      return { status: 'refused', reason: 'an active job is using the server right now. To continue, you must first acknowledge — in the panel — that the action will interrupt it.' }
    }
    const server = await probe()
    if (token.action !== 'start') {
      if (server.state === 'stopped') {
        return { status: 'refused', reason: 'the model server has already stopped on its own; nothing was done.' }
      }
      if (server.state !== 'running' || server.busyUnknown !== false) {
        return { status: 'refused', reason: 'the system cannot safely verify whether work is running on the server, so the action was not performed.' }
      }
      const busy = (server.slots ?? []).some((slot) => slot.isProcessing)
      if (busy && confirm.acknowledgeInterruption !== true) {
        return { status: 'refused', reason: 'a new active job appeared after you reviewed this action. It was not performed; review it again and acknowledge the interruption if you accept it.' }
      }
    }
    const contextArgs = typeof contextArgsDep === 'function' ? (await contextArgsDep(token.model?.key)) ?? [] : []
    const executed = instanceConfig !== undefined
      ? await runLauncherForInstance(config, instanceConfig, token.action, token.model, { spawn: spawnDep, contextArgs })
      : await runLauncher(config, token.action, token.model, { spawn: spawnDep, contextArgs })
    return {
      status: executed.status,
      action: token.action,
      modelKey: token.model?.key,
      exitCode: executed.exitCode,
      timedOut: executed.timedOut,
      output: executed.output,
      ...(executed.status === 'failed' && executed.exitCode !== 0 && executed.exitCode !== null ? { explanation: friendlyExitNote(executed.exitCode) } : {}),
    }
  }

  return {
    plan, confirm,
    planGpuReservation, confirmGpuReservation,
    getReservedGpus: () => reservedGpus(),
    isGpuReserved: (uuid) => reservedGpus().includes(typeof uuid === 'string' ? uuid : ''),
    _tokens: tokens,
  }
}
