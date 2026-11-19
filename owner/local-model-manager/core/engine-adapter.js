/**
 * Engine adapters: pure functions that construct validated argv and environment
 * for profile-based launch execution. No I/O, no side effects; fully testable
 * without hardware.
 *
 * Only llama.cpp is implemented as an executable adapter. All other recognized
 * engines return explicit refused results with plain-language reasons;
 * unrecognized engine IDs return a generic refused result.
 */

import { conflictingContextFlag } from './context-sizer.js'

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/

/**
 * Build the CUDA_VISIBLE_DEVICES environment from a profile's GPU UUID list.
 * Multiple UUIDs are comma-joined; a single UUID is written directly.
 * @param {string[]} gpuUuids profile GPU UUIDs (non-empty, caller-validated).
 * @param {Record<string, string>} [baseEnv] base environment to extend.
 * @returns {Record<string, string>} env object with CUDA_VISIBLE_DEVICES set.
 */
export const buildProfileEnv = (gpuUuids, baseEnv = {}) => ({
  ...baseEnv,
  CUDA_VISIBLE_DEVICES: gpuUuids.join(','),
})

/**
 * Build the launcher argv and spawn environment for a llama.cpp profile.
 * The argv is `['start-<switchName>', ...profile.launchArgs, ...contextArgv]`;
 * the env carries CUDA_VISIBLE_DEVICES set to the comma-joined profile GPU
 * UUIDs. The context pin is appended last because llama.cpp argument parsing
 * is last-wins, so it reliably overrides the launcher's own config-derived
 * `-c`. A `-c`/`--ctx-size` flag inside launchArgs is refused: it would make
 * the applied context ambiguous.
 * @param {{gpuUuids: string[], launchArgs: string[], profileId?: string}} profile validated launch profile.
 * @param {{switchName: string}} model catalog model row.
 * @param {Record<string, string>} [baseEnv] base environment to extend.
 * @param {{contextArgv?: string[]}} [deps] selected-context argv from the sizer.
 * @returns {{ok: true, argv: string[], env: Record<string, string>}|{ok: false, reason: string}}
 */
export const buildLlamaCppLaunch = (profile, model, baseEnv = {}, deps = {}) => {
  const switchName = model?.switchName
  if (typeof switchName !== 'string' || !SAFE_SLUG.test(switchName)) {
    return { ok: false, reason: `model switchName "${switchName}" is not a valid lowercase slug` }
  }
  const conflicting = conflictingContextFlag(profile.launchArgs)
  if (conflicting !== undefined) {
    return {
      ok: false,
      reason: `launch profile "${profile.profileId ?? ''}" sets the context through "${conflicting}" in launchArgs; remove it and use the context selection mechanism (manual override file or config bound) so the panel can show and verify what runs`,
    }
  }
  const argv = ['start-' + switchName, ...profile.launchArgs, ...(deps.contextArgv ?? [])]
  const env = buildProfileEnv(profile.gpuUuids, baseEnv)
  return { ok: true, argv, env }
}

/**
 * Check whether an engine ID has an executable adapter. Returns ok for
 * llama.cpp; returns a refused result with a specific plain-language reason
 * for all other recognized engines, and a generic reason for unknown ones.
 * @param {string} engineId the engine identifier from a launch profile.
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export const validateEngineAdapter = (engineId) => {
  switch (engineId) {
    case 'llama.cpp':
      return { ok: true }
    case 'vllm':
      return { ok: false, reason: '"vllm" does not currently support the trusted launcher launch path; use llama.cpp for now' }
    case 'ollama':
      return { ok: false, reason: '"ollama" is not managed by the trusted launcher; launch it from its own tooling' }
    case 'sglang':
      return { ok: false, reason: '"sglang" does not currently support the trusted launcher launch path' }
    case 'tensorrt-llm':
      return { ok: false, reason: '"tensorrt-llm" does not currently support the trusted launcher launch path' }
    default:
      return { ok: false, reason: `engine "${engineId}" is not a recognized engine; only llama.cpp is currently executable via the trusted launcher` }
  }
}
