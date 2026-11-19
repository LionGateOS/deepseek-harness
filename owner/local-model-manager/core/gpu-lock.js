/**
 * GPU compute-mode lock controls through `nvidia-smi`. Uses only
 * EXCLUSIVE_PROCESS (nvidia-smi -c 3) for the locked state and DEFAULT
 * (nvidia-smi -c 0) for the unlocked state. PROHIBITED (-c 2) is never used.
 *
 * All commands use fixed executable arguments — no shell expansion, no string
 * interpolation. UUIDs must come from the validated config allowlist; this
 * module re-validates every UUID inside `createGpuLockActions.plan` before
 * anything is executed.
 *
 * Required disclosure (always surfaced to the owner when a lock operation is
 * presented; do not remove or omit any item):
 *   - Not owner-specific: a sufficiently privileged process can override or
 *     bypass EXCLUSIVE_PROCESS mode.
 *   - Does not persist across reboots.
 *   - Does not prevent a sufficiently privileged process from accessing the GPU.
 *   - This panel does not claim this lock makes the GPU impossible for every
 *     AI agent or process to access.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** nvidia-smi -c argument values for the two managed states. */
export const COMPUTE_MODE_ARGS = Object.freeze({ unlocked: '0', locked: '3' })

/**
 * Required disclosure items. Every item is an independent sentence and must
 * be presented to the owner before any lock-state change is confirmed.
 */
export const LOCK_DISCLOSURE = Object.freeze([
  'EXCLUSIVE_PROCESS mode is not owner-specific: a sufficiently privileged process can override or bypass it.',
  'The setting does not persist across reboots; the GPU returns to DEFAULT on restart.',
  'A sufficiently privileged process can still access the GPU regardless of this setting.',
  'This panel does not claim this lock prevents every AI agent or process from accessing the GPU.',
])

/**
 * Map one raw nvidia-smi compute_mode field value to a managed state label.
 * @param {string} raw the raw nvidia-smi output word.
 * @returns {'unlocked'|'locked'|'prohibited'|'exclusive_thread'|'unknown'}
 */
export const parseComputeMode = (raw) => {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'default': return 'unlocked'
    case 'exclusive_process': return 'locked'
    case 'prohibited': return 'prohibited'
    case 'exclusive_thread': return 'exclusive_thread'
    default: return 'unknown'
  }
}

/**
 * Query the current compute mode for one GPU by UUID. Fixed argv, bounded,
 * never throws.
 * @param {string} uuid GPU UUID — must already come from the validated allowlist.
 * @param {number} timeoutMs query timeout in milliseconds.
 * @param {{execFile?: typeof execFileP}} [deps] injectable executor for tests.
 * @returns {Promise<{status:'ok',mode:string}|{status:'unavailable',error:string}>}
 */
export const queryComputeMode = async (uuid, timeoutMs = 5000, deps = {}) => {
  const run = deps.execFile ?? execFileP
  try {
    const out = await run(
      'nvidia-smi',
      ['--query-gpu=compute_mode', '--format=csv,noheader,nounits', `--id=${uuid}`],
      { timeout: timeoutMs },
    )
    const line = String(out.stdout ?? '').split('\n').find((l) => l.trim().length > 0)
    if (line === undefined) {
      return { status: 'unavailable', error: 'nvidia-smi returned no compute-mode row for this GPU' }
    }
    return { status: 'ok', mode: parseComputeMode(line) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { status: 'unavailable', error: msg.split('\n')[0] ?? 'nvidia-smi unavailable' }
  }
}

/**
 * Apply a compute mode change for one GPU. Fixed argv, bounded, never throws.
 * Uses `sudo -n` for non-interactive elevation (fails immediately if a
 * password would be needed rather than hanging). Permission errors are reported
 * honestly without retrying or escalating.
 * @param {string} uuid GPU UUID — must already come from the validated allowlist.
 * @param {'locked'|'unlocked'} desiredState the target managed state.
 * @param {number} timeoutMs apply timeout in milliseconds.
 * @param {{execFile?: typeof execFileP}} [deps] injectable executor for tests.
 * @returns {Promise<{status:'ok',output:string,exitCode:number,stdout:string,stderr:string}|{status:'permission-denied',error:string,exitCode:number|null,stdout:string,stderr:string}|{status:'failed',error:string,exitCode:number|null,stdout:string,stderr:string}>}
 */
export const applyComputeMode = async (uuid, desiredState, timeoutMs = 10000, deps = {}) => {
  const run = deps.execFile ?? execFileP
  const arg = COMPUTE_MODE_ARGS[desiredState]
  if (arg === undefined) {
    return { status: 'failed', error: `"${desiredState}" is not a managed compute mode; only "locked" and "unlocked" are supported`, exitCode: null, stdout: '', stderr: '' }
  }
  try {
    const out = await run('sudo', ['-n', 'nvidia-smi', '-i', uuid, '-c', arg], { timeout: timeoutMs })
    const stdout = String(out.stdout ?? '')
    const stderr = String(out.stderr ?? '')
    const output = (stdout + stderr).trim()
    return { status: 'ok', output, exitCode: 0, stdout, stderr }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const lower = msg.toLowerCase()
    const exitCode = /** @type {any} */ (error)?.code ?? null
    const stdout = String(/** @type {any} */ (error)?.stdout ?? '')
    const stderr = String(/** @type {any} */ (error)?.stderr ?? '')
    const isPermission = (
      lower.includes('permission denied') ||
      lower.includes('not permitted') ||
      lower.includes('eacces') ||
      lower.includes('requires root') ||
      lower.includes('insufficient privilege') ||
      lower.includes('must be root') ||
      lower.includes('password') ||
      lower.includes('sorry') ||
      lower.includes('sudo:')
    )
    if (isPermission) {
      return {
        status: 'permission-denied',
        error: `nvidia-smi reported a permission error: ${msg.split('\n')[0]}`,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        stdout,
        stderr,
      }
    }
    return {
      status: 'failed',
      error: msg.split('\n')[0] ?? 'nvidia-smi failed',
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      stdout,
      stderr,
    }
  }
}

/**
 * Create the GPU lock plan/confirm state machine. UUID allowlist validation
 * happens here before any query or command reaches the driver.
 *
 * @param {object} opts
 * @param {object} opts.config validated plugin config (must include caseGpuUuid,
 *   protectedGpuUuid, caseGpuName, protectedGpuName, probeTimeoutMs,
 *   actionTimeoutMs, confirmTtlMs).
 * @param {typeof queryComputeMode} [opts.queryFn] injectable query function for tests.
 * @param {typeof applyComputeMode} [opts.applyFn] injectable apply function for tests.
 * @param {() => number} [opts.now] injectable clock for tests.
 */
export const createGpuLockActions = ({
  config,
  queryFn = queryComputeMode,
  applyFn = applyComputeMode,
  now = Date.now,
}) => {
  /** Single-use confirm tokens: tokenId → bound plan. */
  const tokens = new Map()

  /** Strict UUID → name allowlist; only config-sourced UUIDs may drive commands. */
  const allowed = new Map([
    [config.caseGpuUuid, config.caseGpuName],
    [config.protectedGpuUuid, config.protectedGpuName],
  ])

  /**
   * Step 1: validate UUID against the allowlist, read the current compute
   * mode, and build a single-use confirm token. Refusals carry plain-language
   * reasons.
   * @param {string} uuid GPU UUID supplied by the UI.
   * @param {'locked'|'unlocked'} desiredState the requested target state.
   * @param {{execFile?: function}} [deps] injectable executor for tests.
   */
  const plan = async (uuid, desiredState, deps = {}) => {
    // UUID must come from config — never trust an arbitrary UI-supplied value.
    if (typeof uuid !== 'string' || !allowed.has(uuid)) {
      return {
        status: 'refused',
        reason: 'that GPU UUID is not in the configured allowlist and cannot be targeted for lock operations',
      }
    }
    if (desiredState !== 'locked' && desiredState !== 'unlocked') {
      return {
        status: 'refused',
        reason: `"${desiredState}" is not a supported lock state; only "locked" and "unlocked" are valid`,
      }
    }
    const gpuName = allowed.get(uuid)
    const current = await queryFn(uuid, config.probeTimeoutMs, deps)
    if (current.status === 'unavailable') {
      return {
        status: 'refused',
        reason: `cannot read the current compute mode for ${gpuName}: ${current.error}`,
      }
    }
    if (current.mode === desiredState) {
      return {
        status: 'refused',
        reason: `${gpuName} is already in the ${desiredState} state (current compute mode: ${current.mode})`,
      }
    }
    const impact = desiredState === 'locked'
      ? `The compute mode for ${gpuName} will be set to EXCLUSIVE_PROCESS (nvidia-smi -c 3). New processes will be refused context creation on this GPU until it is unlocked. This does not prevent a sufficiently privileged process from overriding the setting.`
      : `The compute mode for ${gpuName} will be set to DEFAULT (nvidia-smi -c 0). Any process may create a context on this GPU.`
    const nowMs = now()
    const tokenId = `gpu-${nowMs.toString(36)}-${Math.floor(nowMs % 1e6).toString(36)}`
    tokens.set(tokenId, { uuid, gpuName, desiredState, currentMode: current.mode, createdAt: nowMs })
    // Bounded token store: drop expired entries, never the one just created.
    for (const [id, token] of tokens) {
      if (id !== tokenId && now() - token.createdAt > config.confirmTtlMs) tokens.delete(id)
    }
    return {
      status: 'planned',
      uuid,
      gpuName,
      desiredState,
      currentMode: current.mode,
      impact,
      confirmToken: tokenId,
      expiresInMs: config.confirmTtlMs,
      disclosure: LOCK_DISCLOSURE,
    }
  }

  /**
   * Step 2: the owner confirms. The compute mode is re-read immediately before
   * applying; the token is single-use and expires.
   * @param {string} tokenId token from plan().
   * @param {{execFile?: function}} [deps] injectable executor for tests.
   */
  const confirm = async (tokenId, deps = {}) => {
    const token = tokens.get(tokenId)
    if (token === undefined) {
      return {
        status: 'refused',
        reason: 'this confirmation is no longer valid (expired, already used, or never issued)',
      }
    }
    if (now() - token.createdAt > config.confirmTtlMs) {
      tokens.delete(tokenId)
      return {
        status: 'refused',
        reason: 'this confirmation has expired — review the action again and confirm once more',
      }
    }
    tokens.delete(tokenId) // single use — consumed by this attempt

    // Re-read mode immediately before applying.
    const current = await queryFn(token.uuid, config.probeTimeoutMs, deps)
    if (current.status === 'unavailable') {
      return {
        status: 'refused',
        reason: `cannot read the current compute mode for ${token.gpuName} before applying: ${current.error}`,
      }
    }
    if (current.mode === token.desiredState) {
      return {
        status: 'refused',
        reason: `${token.gpuName} is already in the ${token.desiredState} state; nothing was changed`,
      }
    }

    const applyResult = await applyFn(token.uuid, token.desiredState, config.actionTimeoutMs, deps)
    if (applyResult.status !== 'ok') {
      return {
        status: applyResult.status,
        gpuName: token.gpuName,
        desiredState: token.desiredState,
        error: applyResult.error,
        exitCode: applyResult.exitCode,
        stdout: applyResult.stdout,
        stderr: applyResult.stderr,
      }
    }

    // Read back the actual state to confirm the driver accepted the change.
    const readback = await queryFn(token.uuid, config.probeTimeoutMs, deps)
    const actualMode = readback.status === 'ok' ? readback.mode : 'unknown'
    const succeeded = actualMode === token.desiredState
    return {
      status: succeeded ? 'ok' : 'partial',
      gpuName: token.gpuName,
      desiredState: token.desiredState,
      actualMode,
      output: applyResult.output,
      exitCode: applyResult.exitCode,
      stdout: applyResult.stdout,
      stderr: applyResult.stderr,
      ...(succeeded ? {} : {
        warning: `The driver command completed but the readback shows "${actualMode}" instead of "${token.desiredState}". The driver may have refused the change or the readback result is stale.`,
      }),
    }
  }

  return { plan, confirm, _tokens: tokens }
}
