/**
 * Installed-version detection for the registered inference engines.
 *
 * Every probe here is bounded, read-only, and answers one question: which
 * version of this engine is installed on this host? None of them starts,
 * stops, loads, unloads, downloads, or reconfigures anything, and a failure to
 * answer is recorded as `null` — never guessed from the upstream release tag.
 *
 * Why each engine needs its own probe:
 *   ollama       `ollama --version` prints a human line; the number is inside it.
 *   vllm         `vllm --version` imports torch (~5 s) and warns loudly, so the
 *                version is read from installed package metadata instead.
 *   llama.cpp    has no package manager entry; a built binary is the only
 *                evidence, and a source tree without one is not an install.
 *   strata       reports its engine component through its own JSON inventory.
 *   sglang       detected through package metadata like vLLM.
 *   tensorrt-llm detected through package metadata like vLLM.
 *
 * Python metadata is read by running the interpreter with a fixed `-c`
 * program. No shell is involved, no user input reaches the program string, and
 * the answer is the package version or an import error.
 */

import { STRATA_ENGINE_PROBE, parseStrataEngineProbe } from './strata-engine.js'

/** Registry ids that report through Python package metadata. */
const PYTHON_METADATA_ENGINES = Object.freeze({
  vllm: 'vllm',
  sglang: 'sglang',
  'tensorrt-llm': 'tensorrt_llm',
})

/**
 * The `-c` program used to read one installed package version.
 *
 * It prints only the version, so a warning on stderr (vLLM emits several)
 * cannot be mistaken for an answer.
 */
const PYTHON_VERSION_PROGRAM = [
  'import importlib.metadata as m, sys',
  'try:',
  '    print(m.version(sys.argv[1]))',
  'except Exception:',
  '    sys.exit(1)',
].join('\n')

/** Candidate interpreters, in the order the host is most likely to have one. */
const PYTHON_CANDIDATES = Object.freeze(['python3', 'python'])

/**
 * Extract a version number from the human-readable `ollama --version` output.
 *
 * @param {string} text stdout of `ollama --version`.
 * @returns {string|null} the version, or null when the output is unfamiliar.
 */
export const parseOllamaVersion = (text) => {
  if (typeof text !== 'string') return null
  const match = text.match(/\b(\d+\.\d+(?:\.\d+)*)\b/)
  return match === null ? null : match[1]
}

/**
 * Extract a version from `llama-cli --version`, `llama-server --version`, or a
 * llama.cpp build banner (`version: 5100 (b5100)`).
 *
 * Build numbers are kept in their `b`-prefixed form so they stay in llama.cpp's
 * own version series rather than looking like a dotted release.
 *
 * @param {string} text stdout or stderr of a llama.cpp binary.
 * @returns {string|null} the version, or null when the output is unfamiliar.
 */
export const parseLlamaCppVersion = (text) => {
  if (typeof text !== 'string') return null
  const build = text.match(/\bb(\d{3,})\b/i)
  if (build !== null) return `b${build[1]}`
  const dotted = text.match(/\b(\d+\.\d+\.\d+)\b/)
  return dotted === null ? null : dotted[1]
}

/**
 * Run one bounded probe and reduce it to a trimmed first line of stdout.
 *
 * Resolves to null instead of rejecting: detection is advisory, and a missing
 * binary or a timeout must never fail the engine check that called it.
 *
 * @param {(file: string, args: string[], options: object, callback: (error: (Error & {code?: unknown}) | null, stdout: string, stderr?: string) => void) => unknown} execFileFn
 * @param {string} file executable name.
 * @param {string[]} args fixed argument vector.
 * @param {number} timeoutMs probe deadline.
 * @returns {Promise<{ok: true, stdout: string, stderr: string} | {ok: false, reason: string}>}
 */
const runProbe = (execFileFn, file, args, timeoutMs) => new Promise((resolve) => {
  execFileFn(file, [...args], { timeout: timeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error !== null && error !== undefined) {
      const code = /** @type {{code?: unknown}} */ (error).code
      resolve({ ok: false, reason: code === 'ENOENT' ? `${file} is not installed` : `${file} probe failed: ${error.message}` })
      return
    }
    resolve({ ok: true, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' })
  })
})

/**
 * Read one installed Python package version through its metadata.
 *
 * vLLM's `--version` is not usable: it imports torch, which takes seconds and
 * prints compatibility warnings. `importlib.metadata` answers in milliseconds
 * and reads the same installed distribution record the runtime would.
 *
 * @param {(file: string, args: string[], options: object, callback: Function) => unknown} execFileFn
 * @param {string} distribution package name as installed.
 * @param {number} timeoutMs probe deadline.
 * @returns {Promise<string|null>}
 */
const probePythonPackage = async (execFileFn, distribution, timeoutMs) => {
  for (const interpreter of PYTHON_CANDIDATES) {
    const probe = await runProbe(execFileFn, interpreter, ['-c', PYTHON_VERSION_PROGRAM, distribution], timeoutMs)
    if (probe.ok) {
      const version = probe.stdout.trim().split('\n').pop()?.trim() ?? ''
      return version.length === 0 ? null : version
    }
    // A missing interpreter is worth trying the next candidate; any other
    // failure means the package is not installed under this one.
    if (!probe.reason.includes('is not installed')) return null
  }
  return null
}

/**
 * Detect the installed version of one registered engine.
 *
 * @param {string} engineId registry id.
 * @param {(file: string, args: string[], options: object, callback: Function) => unknown} execFileFn injected subprocess runner.
 * @param {number} timeoutMs per-probe deadline.
 * @returns {Promise<string|null>} the installed version, or null when unknown.
 */
export const detectEngineVersion = async (engineId, execFileFn, timeoutMs) => {
  if (engineId === 'ollama') {
    const probe = await runProbe(execFileFn, 'ollama', ['--version'], timeoutMs)
    return probe.ok ? parseOllamaVersion(`${probe.stdout}\n${probe.stderr}`) : null
  }
  if (engineId === 'llama.cpp') {
    for (const binary of ['llama-cli', 'llama-server']) {
      const probe = await runProbe(execFileFn, binary, ['--version'], timeoutMs)
      if (!probe.ok) continue
      const version = parseLlamaCppVersion(`${probe.stdout}\n${probe.stderr}`)
      if (version !== null) return version
    }
    return null
  }
  if (engineId === 'strata') {
    const identity = await detectStrataEngineIdentity(execFileFn, timeoutMs)
    return identity.ok ? identity.version : null
  }
  const distribution = PYTHON_METADATA_ENGINES[engineId]
  if (distribution !== undefined) return probePythonPackage(execFileFn, distribution, timeoutMs)
  return null
}

/**
 * Read the installed Strata engine's full identity, not just its build number.
 *
 * The variant matters for choosing which published package applies to this
 * host: a cuda13 host should be shown the cuda13 package and its driver floor,
 * not the generic one.
 *
 * @param {(file: string, args: string[], options: object, callback: Function) => unknown} execFileFn injected subprocess runner.
 * @param {number} timeoutMs per-probe deadline.
 * @returns {Promise<{ok: true, version: string, platform: string|null, backend: string|null, variant: string|null, signed: boolean|null} | {ok: false, reason: string}>}
 */
export const detectStrataEngineIdentity = (execFileFn, timeoutMs) => new Promise((resolve) => {
  execFileFn(
    'strata',
    [...STRATA_ENGINE_PROBE],
    { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error !== null && error !== undefined) {
        resolve({
          ok: false,
          reason: error.code === 'ENOENT' ? 'the strata command is not installed' : `the strata probe failed: ${error.message}`,
        })
        return
      }
      const parsed = parseStrataEngineProbe(typeof stdout === 'string' ? stdout : '')
      resolve(parsed.ok
        ? {
            ok: true,
            version: parsed.version,
            platform: parsed.platform ?? null,
            backend: parsed.backend ?? null,
            variant: parsed.variant ?? null,
            signed: parsed.signed ?? null,
          }
        : { ok: false, reason: parsed.reason })
    },
  )
})

/**
 * Detect every registered engine's installed version.
 *
 * Runs in parallel so one slow probe does not delay the others, and isolates
 * each failure: an engine that cannot answer records null while its neighbours
 * still report.
 *
 * @param {string[]} engineIds registry ids in order.
 * @param {(file: string, args: string[], options: object, callback: Function) => unknown} execFileFn injected subprocess runner.
 * @param {number} timeoutMs per-probe deadline.
 * @returns {Promise<Map<string, string|null>>} engine id to version, or null.
 */
export const detectEngineVersions = async (engineIds, execFileFn, timeoutMs) => {
  const versions = await Promise.all(engineIds.map(async (engineId) => {
    try {
      return [engineId, await detectEngineVersion(engineId, execFileFn, timeoutMs)]
    } catch {
      return [engineId, null]
    }
  }))
  return new Map(versions)
}
