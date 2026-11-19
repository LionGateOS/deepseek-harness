/**
 * Model catalog facts: installed-state verification on disk plus per-model
 * provider facts (configured context window, reasoning efforts, input
 * modalities) read from the active provider configuration. The provider file
 * is YAML, which the plain-JS plugin does not parse itself; a small read-only
 * python3 helper — the same approach the trusted launcher already uses —
 * converts the two candidate files to JSON. Facts stay labeled with their
 * source (configured-file vs runtime); nothing is inferred.
 */

import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

const PYTHON_HELPER = `
from pathlib import Path
import json, sys, yaml

wanted = {}
doc = None
for path in sys.argv[1:-1]:
    if path == "-":
        continue
    file = Path(path)
    if not file.is_file():
        continue
    try:
        data = yaml.safe_load(file.read_text())
    except Exception:
        continue
    entries = data if isinstance(data, list) else []
    if isinstance(data, dict):
        entries = [data]
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id") == "llm-pi-ai":
            providers = (entry.get("config") or {}).get("providers")
            if isinstance(providers, dict) and providers:
                doc = providers
                break
    if doc:
        break

out = {"source": None, "models": {}}
if doc:
    out["source"] = "provider-config"
    for provider in doc.values():
        if not isinstance(provider, dict):
            continue
        for model in provider.get("models", []) or []:
            if not isinstance(model, dict):
                continue
            mid = model.get("id")
            if not isinstance(mid, str):
                continue
            efforts = model.get("reasoningEfforts")
            facts = {}
            if isinstance(efforts, dict):
                facts["reasoningEfforts"] = sorted(k for k in efforts.keys() if isinstance(k, str))
            elif efforts is False:
                facts["reasoningEfforts"] = []
            else:
                facts["reasoningEffortsUnknown"] = True
            if isinstance(model.get("contextWindow"), int):
                facts["contextWindow"] = model["contextWindow"]
            if isinstance(model.get("input"), list):
                facts["input"] = [str(v) for v in model["input"] if isinstance(v, str)]
            out["models"][mid] = facts
print(json.dumps(out))
`

/**
 * Read per-model provider facts from the configured provider files via the
 * python3 YAML helper. Read-only; bounded; never throws.
 * @param {object} config validated plugin config.
 * @param {{spawn?: typeof spawn, pythonBin?: string}} [deps] injectables for tests.
 * @returns {Promise<{status:'ok'|'unavailable', source?: string, byPath?: Record<string, object>, error?: string}>}
 */
export const readProviderFacts = async (config, deps = {}) => {
  const doSpawn = deps.spawn ?? spawn
  const args = ['-c', PYTHON_HELPER, config.providerPatchPath, config.settingsPath, '-']
  const child = doSpawn(deps.pythonBin ?? 'python3', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  /** @type {Buffer[]} */
  const chunks = []
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'unavailable', error: 'provider-facts helper timed out' }), config.probeTimeoutMs)
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: 'unavailable', error: error.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = Buffer.concat(chunks).toString('utf8')
      if (code !== 0) return resolve({ status: 'unavailable', error: `provider-facts helper exited ${code}` })
      try {
        const value = JSON.parse(text)
        resolve(value.status === undefined && typeof value.models === 'object' ? { status: 'ok', source: value.source ?? 'provider-config', byPath: value.models } : { status: 'unavailable', error: 'helper output was not the expected JSON' })
      } catch {
        resolve({ status: 'unavailable', error: 'helper output was not valid JSON' })
      }
    })
  })
  return result
}

/**
 * Verify each catalog model's files on disk.
 * @param {Array<{key: string, ggufPath: string}>} models catalog rows.
 * @param {{stat?: typeof stat}} [deps] injectable stat for tests.
 * @returns {Promise<Record<string, {installed: boolean, diskBytes?: number, problem?: string}>>}
 */
export const verifyInstalled = async (models, deps = {}) => {
  const doStat = deps.stat ?? stat
  const checked = await Promise.all(models.map(async (model) => {
    try {
      const info = await doStat(model.ggufPath)
      if (!info.isFile()) return [model.key, { installed: false, problem: 'path exists but is not a regular file' }]
      return [model.key, { installed: true, diskBytes: info.size }]
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
      return [model.key, { installed: false, problem: code === 'ENOENT' ? 'model file not found' : `could not be inspected (${code ?? 'stat failed'})` }]
    }
  }))
  return Object.fromEntries(checked)
}