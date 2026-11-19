/**
 * Strata engine detection.
 *
 * Strata publishes two version spaces that must never be compared:
 *
 *   - the **control** version, which is the application/AppImage release
 *     (GitHub tags such as `v0.2.12`), and
 *   - the **engine** build, which is the inference component
 *     (versions such as `0.1.56`).
 *
 * A release check therefore answers "what does the project publish?" while a
 * detection answers "which engine build is installed?". Neither one implies
 * the other, and the panel must not render a control tag next to an engine
 * build as though they were the same sequence.
 *
 * Detection reads one deterministic JSON document — `strata components engine
 * --output json` — and nothing else. It never starts, stops, loads, unloads,
 * upgrades, or reconfigures anything: the probe reports installed components
 * and exits.
 */

/** Registry id of the Strata engine row. */
export const STRATA_ENGINE_ID = 'strata'

/** Argument vector of the read-only detection probe. */
export const STRATA_ENGINE_PROBE = Object.freeze(['components', 'engine', '--output', 'json'])

/**
 * Read the installed engine build out of one `components engine` document.
 *
 * @param {string} text raw stdout of the probe.
 * @returns {{ok: true, version: string, platform: string|null, backend: string|null, variant: string|null, signed: boolean|null} | {ok: false, reason: string}}
 */
export const parseStrataEngineProbe = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the probe did not answer with JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'the probe answered with JSON that is not an object' }
  }
  if (parsed['ok'] === false) {
    const problems = Array.isArray(parsed['problems']) ? parsed['problems'] : []
    const first = problems.find((p) => p !== null && typeof p === 'object' && typeof p['message'] === 'string')
    return { ok: false, reason: first === undefined ? 'the probe reported a failure' : first['message'] }
  }
  const installed = parsed['installed']
  if (!Array.isArray(installed) || installed.length === 0) {
    return { ok: false, reason: 'no Strata engine component is installed' }
  }
  const engine = installed.find(
    (entry) => entry !== null && typeof entry === 'object' && typeof entry['version'] === 'string' && entry['version'].trim() !== '',
  )
  if (engine === undefined) {
    return { ok: false, reason: 'the installed engine record carries no version' }
  }
  const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null)
  return {
    ok: true,
    version: String(engine['version']).trim(),
    platform: textOf(engine['platform']),
    backend: textOf(engine['backend']),
    variant: textOf(engine['variant']),
    signed: typeof engine['signed'] === 'boolean' ? engine['signed'] : null,
  }
}

/**
 * Run the detection probe and reduce its answer to a version.
 *
 * `execFileFn` is injected so a test can drive the whole path without spawning
 * a process. The probe is bounded by `timeoutMs`, inherits no shell, and
 * captures at most 1 MiB: a component listing is a small JSON document, and a
 * surprise larger than that is treated as a failed probe rather than buffered.
 *
 * @param {(file: string, args: string[], options: object, callback: (error: (Error & {code?: unknown}) | null, stdout: string) => void) => unknown} execFileFn
 * @param {number} timeoutMs
 * @returns {Promise<{status: 'ok', version: string} | {status: 'failed', reason: string}>}
 */
export const probeStrataEngine = (execFileFn, timeoutMs) => new Promise((resolve) => {
  execFileFn(
    'strata',
    [...STRATA_ENGINE_PROBE],
    { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error !== null && error !== undefined) {
        resolve({
          status: 'failed',
          reason: error.code === 'ENOENT' ? 'the strata command is not installed' : `the strata probe failed: ${error.message}`,
        })
        return
      }
      const parsed = parseStrataEngineProbe(stdout)
      resolve(parsed.ok ? { status: 'ok', version: parsed.version } : { status: 'failed', reason: parsed.reason })
    },
  )
})

/**
 * The installed version of one engine, or null when it cannot be determined.
 *
 * Only the Strata row has a detector. Every other engine answers null: a
 * version is never inferred from a release tag.
 *
 * @param {string} engineId
 * @param {(file: string, args: string[], options: object, callback: Function) => unknown} execFileFn
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
export const detectInstalledVersion = async (engineId, execFileFn, timeoutMs) => {
  if (engineId !== STRATA_ENGINE_ID) return null
  const probe = await probeStrataEngine(execFileFn, timeoutMs)
  return probe.status === 'ok' ? probe.version : null
}
