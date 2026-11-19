/**
 * Read-only GPU inspection through `nvidia-smi` query mode. The plugin never
 * sets, stops, or reconfigures anything on any GPU; a query failure degrades
 * to an explicit "unavailable" state and never becomes permission to use the
 * protected GPU. The protected GPU's identity comes from validated config, so
 * Protected/Reserved is displayed even when nvidia-smi is unreachable.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/**
 * Parse one wattage cell. `nvidia-smi` reports unsupported readings as
 * `[N/A]`, `[Not Supported]`, or blank; all of those become null so the panel
 * says "not reported" instead of inventing a number.
 * @param {string|undefined} raw one CSV cell.
 * @returns {number|null} watts, or null when the cell carries no usable value.
 */
const parseWatts = (raw) => {
  const text = (raw ?? '').trim()
  if (!/^\d+(?:\.\d+)?(?:\s*W)?$/i.test(text)) return null
  const value = Number(text.replace(/\s*W$/i, ''))
  return Number.isFinite(value) ? value : null
}

/**
 * Parse one `--query-gpu --format=csv,noheader,nounits` line. Wattage and free
 * memory are optional trailing columns: a row from the classic identity/memory
 * query keeps `powerDrawW`/`powerLimitW`/`memFreeMiB` null rather than dropping
 * the whole row. The accepted widths are the two query shapes this module
 * issues, so a driver that rejects a trailing column never reorders the fields
 * that come before it.
 * @param {string} line raw CSV line.
 * @returns {object|null} parsed row or null when malformed.
 */
export const parseGpuLine = (line) => {
  const parts = line.trim().split(',').map((part) => part.trim())
  if (parts.length < 6) return null
  const [index, name, uuid, memUsed, memTotal, util, powerInstant, powerDraw, powerLimit, memFree] = parts
  if (uuid === undefined || uuid.length === 0) return null
  const trailingFree = parts.length >= 10 ? memFree : undefined
  const freeMib = /^\d+$/.test(trailingFree ?? '') ? Number(trailingFree) : undefined
  return {
    uuid,
    name,
    index: /^\d+$/.test(index ?? '') ? Number(index) : undefined,
    memUsedMiB: /^\d+$/.test(memUsed ?? '') ? Number(memUsed) : undefined,
    memTotalMiB: /^\d+$/.test(memTotal ?? '') ? Number(memTotal) : undefined,
    // Free VRAM is driver-reported, never derived from total minus used: a
    // region the driver withholds is not the same fact as an unused one. The key
    // is absent when the row did not carry the column.
    ...(freeMib === undefined ? {} : { memFreeMiB: freeMib }),
    utilizationPct: /^\d+$/.test(util ?? '') ? Number(util) : undefined,
    // `power.draw.instant` is the live reading; `power.draw` (a short-window
    // average) is the fallback when the driver does not expose the instant one.
    powerDrawW: parseWatts(powerInstant) ?? parseWatts(powerDraw),
    powerLimitW: parseWatts(powerLimit),
  }
}

/**
 * Parse one `--query-compute-apps --format=csv,noheader,nounits` line.
 * @param {string} line raw CSV line.
 * @returns {object|null} parsed row or null when malformed.
 */
export const parseComputeAppLine = (line) => {
  const parts = line.trim().split(',').map((part) => part.trim())
  if (parts.length < 4) return null
  const [uuid, pid, processName, memUsed] = parts
  if (uuid.length === 0) return null
  return {
    uuid,
    pid: /^\d+$/.test(pid ?? '') ? Number(pid) : undefined,
    processName: processName ?? 'unknown',
    memUsedMiB: /^\d+$/.test(memUsed ?? '') ? Number(memUsed) : undefined,
  }
}

/**
 * Look up the PID of the process listening on `port` using `ss`. Returns null
 * when the port has no listener or when `ss` is unavailable. Used to identify
 * which llama-server process owns the managed endpoint, even when multiple GPUs
 * have llama-server processes running.
 * @param {number} port TCP port to query.
 * @param {{execFile?: typeof execFileP}} [deps] injectable executor for tests.
 * @returns {Promise<number|null>}
 */
export const getServerPid = async (port, deps = {}) => {
  const run = deps.execFile ?? execFileP
  try {
    const result = await run('ss', ['-ltnp', `sport = :${port}`], { timeout: 3000 })
    const match = result.stdout.match(/pid=(\d+)/)
    return match !== null ? Number(match[1]) : null
  } catch {
    return null
  }
}

/** Columns the panel has always read; a driver must support all of them. */
const GPU_COLUMNS = 'index,name,uuid,memory.used,memory.total,utilization.gpu'
/** Wattage columns, appended last so `parseGpuLine` maps them positionally. */
const POWER_COLUMNS = 'power.draw.instant,power.draw,power.limit'
/**
 * Free VRAM, appended after the wattage columns. Read-only telemetry: the panel
 * could previously report used and total, so "how much is actually free" was a
 * subtraction the UI had to invent. Driver-reported free memory distinguishes a
 * region the driver will not hand out from one that is merely unused.
 */
const FREE_COLUMNS = 'memory.free'

/**
 * Run both nvidia-smi queries and parse them.
 * @param {(bin: string, args: string[], options: {timeout: number}) => Promise<{stdout: string}>} run executor.
 * @param {string} columns the `--query-gpu` column list.
 * @param {string[]} apps the `--query-compute-apps` args.
 * @param {number} timeoutMs nvidia-smi timeout.
 * @returns {Promise<{gpus: Array<object>, processes: Array<object>}>} parsed rows.
 */
const readGpuQuery = async (run, columns, apps, timeoutMs) => {
  const [gpuOut, appOut] = await Promise.all([
    run('nvidia-smi', [`--query-gpu=${columns}`, '--format=csv,noheader,nounits'], { timeout: timeoutMs }),
    run('nvidia-smi', apps, { timeout: timeoutMs }),
  ])
  return {
    gpus: gpuOut.stdout.split('\n').map(parseGpuLine).filter(Boolean),
    processes: appOut.stdout.split('\n').map(parseComputeAppLine).filter(Boolean),
  }
}

/**
 * Query the GPUs. Bounded, read-only, never throws.
 * @param {number} timeoutMs nvidia-smi timeout.
 * @param {{execFile?: typeof execFileP}} [deps] injectable executor for tests.
 * @returns {Promise<{status: 'ok'|'unavailable', gpus?: Array<object>, processes?: Array<object>, error?: string}>}
 */
export const queryGpus = async (timeoutMs = 5000, deps = {}) => {
  const run = deps.execFile ?? execFileP
  const apps = ['--query-compute-apps=gpu_uuid,pid,process_name,used_memory', '--format=csv,noheader,nounits']
  let result
  try {
    result = await readGpuQuery(run, `${GPU_COLUMNS},${POWER_COLUMNS},${FREE_COLUMNS}`, apps, timeoutMs)
  } catch {
    // A driver without the free-memory field rejects that query. Fall back to
    // the wattage query so a missing free reading never removes the memory,
    // utilization, and wattage facts this panel already showed.
    try {
      result = await readGpuQuery(run, `${GPU_COLUMNS},${POWER_COLUMNS}`, apps, timeoutMs)
    } catch {
      // A driver without the power fields rejects the whole query too. Read the
      // same cards without them so an unsupported wattage reading never removes
      // the memory and utilization facts this panel already showed.
      try {
        result = await readGpuQuery(run, GPU_COLUMNS, apps, timeoutMs)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        // Short "nvidia-smi has failed..." text; keep one bounded line.
        return { status: 'unavailable', error: detail.split('\n')[0] ?? 'nvidia-smi unavailable' }
      }
    }
  }
  if (result.gpus.length === 0) return { status: 'unavailable', error: 'nvidia-smi returned no GPU rows' }
  return { status: 'ok', gpus: result.gpus, processes: result.processes }
}