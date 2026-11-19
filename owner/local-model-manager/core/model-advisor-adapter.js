/**
 * Model Advisor V2A adapter: read-only JSON interface to the Model Advisor CLI.
 *
 * This adapter spawns the Model Advisor Python module as a subprocess to obtain
 * verified hardware, runtime, and compatibility data. It does not duplicate any
 * discovery logic; it simply invokes the existing CLI and parses its JSON output.
 *
 * All operations are read-only, bounded by timeouts, and never throw.
 * Unknown or unavailable data is preserved as-is from Model Advisor's output.
 */

import { spawn as realSpawn } from 'node:child_process'

const MODEL_ADVISOR_PATH = '/home/liongateos/Model-Advisor'
const DEFAULT_TIMEOUT_MS = 10000

/**
 * Spawn the Model Advisor CLI with the given command and optional arguments.
 * @param {string} command CLI command (hardware, runtimes, compatibility, models).
 * @param {string[]} [extraArgs] Additional CLI arguments.
 * @param {{timeoutMs?: number, pythonBin?: string, spawnFn?: function}} [options]
 * @returns {Promise<{status: 'ok' | 'unavailable', data?: object, error?: string}>}
 */
export async function queryModelAdvisor(command, extraArgs = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pythonBin = options.pythonBin ?? 'python3'
  const spawnFn = options.spawnFn ?? realSpawn

  const args = ['-m', 'liongateos_model_advisor', command, ...(extraArgs ?? [])]

  return new Promise((resolve) => {
    let child = null
    let resolved = false

    const onTimeout = () => {
      if (resolved) return
      resolved = true
      // Kill the orphaned child process to prevent resource leak
      if (child && !child.killed) {
        child.kill('SIGTERM')
        // Force kill after brief delay if still running
        setTimeout(() => {
          if (child && !child.killed) {
            child.kill('SIGKILL')
          }
        }, 100)
      }
      resolve({ status: 'unavailable', error: `Model Advisor ${command} timed out after ${timeoutMs}ms` })
    }

    const timer = setTimeout(onTimeout, timeoutMs)

    child = spawnFn(pythonBin, args, {
      cwd: MODEL_ADVISOR_PATH,
      env: { ...process.env, PYTHONPATH: 'src' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    /** @type {Buffer[]} */
    const stdoutChunks = []
    /** @type {Buffer[]} */
    const stderrChunks = []

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk))

    child.on('error', (error) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve({ status: 'unavailable', error: `Model Advisor spawn failed: ${error.message}` })
    })

    child.on('close', (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)

      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
        resolve({ status: 'unavailable', error: `Model Advisor exited ${code}${stderr ? ': ' + stderr : ''}` })
        return
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim()
      if (!stdout) {
        resolve({ status: 'unavailable', error: 'Model Advisor returned empty output' })
        return
      }

      try {
        const data = JSON.parse(stdout)
        resolve({ status: 'ok', data })
      } catch (parseError) {
        resolve({
          status: 'unavailable',
          error: `Model Advisor output was not valid JSON: ${parseError.message}`,
        })
      }
    })
  })
}

/**
 * Query hardware profile from Model Advisor.
 * @param {{timeoutMs?: number, pythonBin?: string}} [options]
 * @returns {Promise<{status: 'ok' | 'unavailable', hardware?: object, error?: string}>}
 */
export async function getHardwareProfile(options) {
  const result = await queryModelAdvisor('hardware', [], options)
  if (result.status !== 'ok') {
    return { status: 'unavailable', error: result.error }
  }
  return { status: 'ok', hardware: result.data }
}

/**
 * Query runtime discovery from Model Advisor.
 * @param {string[]} [customPaths] Custom llama.cpp paths.
 * @param {{timeoutMs?: number, pythonBin?: string}} [options]
 * @returns {Promise<{status: 'ok' | 'unavailable', runtimes?: object, error?: string}>}
 */
export async function getRuntimeDiscovery(customPaths = [], options = {}) {
  const args = customPaths.map((p) => `--runtime-path=${p}`)
  const result = await queryModelAdvisor('runtimes', args, options)
  if (result.status !== 'ok') {
    return { status: 'unavailable', error: result.error }
  }
  return { status: 'ok', runtimes: result.data }
}

/**
 * Query hardware/runtime compatibility from Model Advisor.
 * Passes `--passive` so Model Advisor skips its active runtime capability
 * probes (`ollama ps`, llama.cpp `--list-devices`/`--help`,
 * `vllm collect-env`) and keeps the default 10s timeout budget.
 * @param {string[]} [customPaths] Custom llama.cpp paths.
 * @param {{timeoutMs?: number, pythonBin?: string}} [options]
 * @returns {Promise<{status: 'ok' | 'unavailable', compatibility?: object, error?: string}>}
 */
export async function getCompatibility(customPaths = [], options = {}) {
  const args = [...customPaths.map((p) => `--runtime-path=${p}`), '--passive']
  const result = await queryModelAdvisor('compatibility', args, options)
  if (result.status !== 'ok') {
    return { status: 'unavailable', error: result.error }
  }
  return { status: 'ok', compatibility: result.data }
}

/**
 * Query qualification capability contract from Model Advisor.
 * @param {{timeoutMs?: number, pythonBin?: string}} [options]
 * @returns {Promise<{status: 'ok' | 'unavailable', qualification?: object, error?: string}>}
 */
export async function getQualificationContract(options) {
  const result = await queryModelAdvisor('qualification', [], options)
  if (result.status !== 'ok') {
    return { status: 'unavailable', error: result.error }
  }
  return { status: 'ok', qualification: result.data }
}
