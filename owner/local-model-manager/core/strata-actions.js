import { spawn } from 'node:child_process'
import { access, constants as fsConstants, readFile, rename, unlink, writeFile } from 'node:fs/promises'

export const STRATA_SET_MODEL = '/home/liongateos/.local/bin/strata-set-model'
export const STRATA_GPU_MODE = '/home/liongateos/.local/share/strata/install/gpu-mode'
export const STRATA_ENGINE_MODE = '/home/liongateos/.local/share/strata/install/engine-mode'
export const STRATA_UNIT = 'strata-engine.service'
export const STRATA_ENDPOINT = 'http://127.0.0.1:8080'

const MODEL_CHOICES = Object.freeze({
  'qwen3.8-flash-next-iq3_xxs': Object.freeze({ choice: 'fast', name: 'Qwen3.8-Flash-Next IQ3_XXS' }),
  'deepseek-v4.1-flash': Object.freeze({ choice: 'deep', name: 'DeepSeek V4.1-Flash 2.25 bpw' }),
})

const GPU_CHOICES = Object.freeze({
  gpu0: 'RTX 3090 only',
  gpu1: 'RTX 3090 Ti only',
  gpu01: 'RTX 3090 + RTX 3090 Ti',
})

const command = (file, args, { spawnImpl = spawn, timeoutMs = 120000 } = {}) => new Promise((resolve) => {
  let output = ''
  let timedOut = false
  const child = spawnImpl(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (chunk) => { output += String(chunk) })
  child.stderr?.on('data', (chunk) => { output += String(chunk) })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, timeoutMs)
  child.on('error', (error) => {
    clearTimeout(timer)
    resolve({ status: 'failed', exitCode: null, timedOut, output: `${output}\n${error.message}`.trim() })
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    resolve({ status: code === 0 && !timedOut ? 'ok' : 'failed', exitCode: code, timedOut, output: output.trim() })
  })
})

const atomicChoiceWriter = async (path, value) => {
  const tmp = `${path}.lmm-${process.pid}.tmp`
  try {
    await writeFile(tmp, `${value}\n`, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

const defaultEngineMode = async () => {
  try {
    return String(await readFile(STRATA_ENGINE_MODE, 'utf8')).trim()
  } catch {
    return 'strata'
  }
}

const defaultProbe = async ({ fetchImpl = globalThis.fetch } = {}) => {
  if (typeof fetchImpl !== 'function') return { state: 'unknown', busyUnknown: true }
  try {
    const response = await fetchImpl(`${STRATA_ENDPOINT}/slots`, { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return { state: 'unknown', busyUnknown: true }
    const payload = await response.json()
    const slots = Array.isArray(payload) ? payload : (Array.isArray(payload?.slots) ? payload.slots : [])
    const busy = slots.some((slot) =>
      slot?.isProcessing === true ||
      slot?.is_processing === true ||
      slot?.processing === true ||
      slot?.state === 'processing'
    )
    return { state: 'running', busy, busyUnknown: false }
  } catch (error) {
    const code = error?.cause?.code ?? error?.code
    if (code === 'ECONNREFUSED') return { state: 'stopped', busy: false, busyUnknown: false }
    return { state: 'unknown', busyUnknown: true }
  }
}

const gpuUuidsFor = (mode, config) => ({
  gpu0: [config.caseGpuUuid],
  gpu1: [config.protectedGpuUuid],
  gpu01: [config.caseGpuUuid, config.protectedGpuUuid],
}[mode] ?? [])

export const createStrataActions = ({
  config,
  readStatus,
  reservedGpus,
  probe = defaultProbe,
  readEngineMode = defaultEngineMode,
  writeGpuMode = atomicChoiceWriter,
  runCommand = command,
  accessImpl = access,
  now = Date.now,
}) => {
  const tokens = new Map()

  const validateTarget = (gpuMode) => {
    if (!Object.hasOwn(GPU_CHOICES, gpuMode)) {
      return { ok: false, reason: `unknown Strata GPU mode "${gpuMode}"` }
    }
    const uuids = gpuUuidsFor(gpuMode, config)
    const allowed = new Set(config.allowedGpuUuids ?? [])
    for (const uuid of uuids) {
      if (!allowed.has(uuid)) {
        return { ok: false, reason: `Strata target ${GPU_CHOICES[gpuMode]} includes GPU ${uuid}, which is outside the Local Model Manager GPU allowlist` }
      }
      if ((reservedGpus?.() ?? []).includes(uuid)) {
        const name = uuid === config.protectedGpuUuid ? config.protectedGpuName : config.caseGpuName
        return { ok: false, reason: `${name} is manually reserved. Strata cannot target ${GPU_CHOICES[gpuMode]} until that reservation is released.` }
      }
    }
    return { ok: true, uuids }
  }

  const safeRuntime = async (operation) => {
    const runtime = await probe()
    if (runtime.state === 'running') {
      if (runtime.busyUnknown !== false) {
        return { ok: false, reason: `Strata is running, but Local Model Manager cannot safely verify whether a job is active. ${operation} is refused.` }
      }
      if (runtime.busy === true) {
        return { ok: false, reason: `Strata has an active job. ${operation} is refused until the job finishes.` }
      }
    } else if (runtime.state !== 'stopped') {
      return { ok: false, reason: `Strata runtime state could not be verified. ${operation} is refused.` }
    }
    return { ok: true, runtime }
  }

  const plan = async (action, params = {}) => {
    if (action !== 'activate' && action !== 'stop') {
      return { status: 'refused', reason: `unsupported Strata action "${action}"` }
    }

    const runtimeCheck = await safeRuntime(action === 'stop' ? 'Stop' : 'Start/Switch')
    if (!runtimeCheck.ok) return { status: 'refused', reason: runtimeCheck.reason }

    if (action === 'stop') {
      if (runtimeCheck.runtime.state === 'stopped') {
        return { status: 'refused', reason: 'Strata is already stopped.' }
      }
      const createdAt = now()
      const confirmToken = `strata-${createdAt.toString(36)}-${Math.floor(createdAt % 1e6).toString(36)}`
      tokens.set(confirmToken, { action, createdAt })
      return {
        status: 'planned',
        action,
        impact: 'Strata will stop. Its currently selected model and GPU choice remain saved for the next start.',
        confirmToken,
        expiresInMs: config.confirmTtlMs,
      }
    }

    const model = MODEL_CHOICES[params.modelId]
    if (model === undefined) {
      return { status: 'refused', reason: 'That model is not one of the installed Strata models.' }
    }

    const gpuMode = typeof params.gpuMode === 'string' ? params.gpuMode : ''
    const boundary = validateTarget(gpuMode)
    if (!boundary.ok) return { status: 'refused', reason: boundary.reason }

    const engineMode = await readEngineMode()
    if (engineMode === 'swarm') {
      return { status: 'refused', reason: 'The vLLM swarm is selected. Manage or stop the swarm from its own panel before activating Strata from here.' }
    }

    try {
      await accessImpl(STRATA_SET_MODEL, fsConstants.X_OK)
    } catch {
      return { status: 'refused', reason: `The trusted Strata model selector is missing or not executable: ${STRATA_SET_MODEL}` }
    }

    const status = await readStatus()
    const alreadyModel = status?.modelSelection?.status === 'ok' && status.modelSelection.id === params.modelId
    const alreadyGpu = status?.gpuSelection?.status === 'ok' && status.gpuSelection.key === gpuMode
    if (alreadyModel && alreadyGpu && runtimeCheck.runtime.state === 'running') {
      return { status: 'refused', reason: `${model.name} is already active on ${GPU_CHOICES[gpuMode]}.` }
    }

    const createdAt = now()
    const confirmToken = `strata-${createdAt.toString(36)}-${Math.floor(createdAt % 1e6).toString(36)}`
    tokens.set(confirmToken, {
      action,
      modelId: params.modelId,
      model,
      gpuMode,
      createdAt,
    })

    return {
      status: 'planned',
      action,
      modelId: params.modelId,
      modelName: model.name,
      gpuMode,
      gpuName: GPU_CHOICES[gpuMode],
      impact: `${model.name} will be activated through Strata on ${GPU_CHOICES[gpuMode]}. The existing Strata service and presets are reused; no second model server is created.`,
      confirmToken,
      expiresInMs: config.confirmTtlMs,
    }
  }

  const confirm = async (confirmToken) => {
    const token = tokens.get(typeof confirmToken === 'string' ? confirmToken : '')
    if (token === undefined) {
      return { status: 'refused', reason: 'This Strata confirmation is expired, already used, or invalid. Review the action again.' }
    }
    if (now() - token.createdAt > config.confirmTtlMs) {
      tokens.delete(confirmToken)
      return { status: 'refused', reason: 'This Strata confirmation expired. Review the action again.' }
    }
    tokens.delete(confirmToken)

    const runtimeCheck = await safeRuntime(token.action === 'stop' ? 'Stop' : 'Start/Switch')
    if (!runtimeCheck.ok) return { status: 'refused', reason: runtimeCheck.reason }

    if (token.action === 'stop') {
      const result = await runCommand('systemctl', ['--user', 'stop', STRATA_UNIT])
      if (result.status !== 'ok') {
        return { status: 'failed', reason: result.output || 'systemctl could not stop Strata' }
      }
      const verification = await probe()
      if (verification.state === 'running') {
        return { status: 'failed', reason: 'Strata still answers after the stop command, so the stop is not being reported as successful.' }
      }
      return { status: 'ok', action: 'stop', message: 'Strata stopped. The selected model and GPU choice remain saved.' }
    }

    const boundary = validateTarget(token.gpuMode)
    if (!boundary.ok) return { status: 'refused', reason: boundary.reason }

    const engineMode = await readEngineMode()
    if (engineMode === 'swarm') {
      return { status: 'refused', reason: 'The vLLM swarm became selected after this action was planned. Strata activation is refused.' }
    }

    const before = await readStatus()
    const previousGpuMode = before?.gpuSelection?.status === 'ok' ? before.gpuSelection.key : null

    try {
      await writeGpuMode(STRATA_GPU_MODE, token.gpuMode)
    } catch (error) {
      return { status: 'failed', reason: `Could not save the Strata GPU choice: ${error instanceof Error ? error.message : String(error)}` }
    }

    const result = await runCommand(STRATA_SET_MODEL, [token.model.choice])
    if (result.status !== 'ok') {
      if (previousGpuMode !== null && Object.hasOwn(GPU_CHOICES, previousGpuMode)) {
        await writeGpuMode(STRATA_GPU_MODE, previousGpuMode).catch(() => {})
      }
      return { status: 'failed', reason: result.output || 'The trusted Strata model selector failed.' }
    }

    const after = await readStatus()
    const modelOk = after?.modelSelection?.status === 'ok' && after.modelSelection.id === token.modelId
    const gpuOk = after?.gpuSelection?.status === 'ok' && after.gpuSelection.key === token.gpuMode
    if (!modelOk || !gpuOk) {
      return { status: 'failed', reason: 'Strata restarted, but its saved model/GPU state does not match the requested selection. Review the current state before trying again.' }
    }

    return {
      status: 'ok',
      action: 'activate',
      modelId: token.modelId,
      gpuMode: token.gpuMode,
      message: `${token.model.name} is now selected in Strata on ${GPU_CHOICES[token.gpuMode]}.`,
      chatRestartRequired: true,
      chatRestartNote: 'DeepSeek Harness reads the Strata chat model list at startup. Restart DSH separately when you want the chat model label/dropdown refreshed.',
    }
  }

  return { plan, confirm, _tokens: tokens }
}
