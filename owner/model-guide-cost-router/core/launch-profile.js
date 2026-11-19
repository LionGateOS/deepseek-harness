/**
 * Validation and merge for owner-authored launch profiles. Pure functions,
 * no I/O. A launch profile records the owner's intended engine/model/GPU/arg
 * combination for a supervised launch. Records with missing required fields
 * are rejected whole.
 *
 * Three inference states — release available, installed, verified — remain
 * separate from launch profiles. A profile never implies any of them.
 */

/**
 * @param {unknown} value
 * @returns {string|undefined}
 */
const trimText = (value) => {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t.length === 0 ? undefined : t
}

/** profileId must be a lowercase alphanumeric slug. */
const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Validate one launch profile record. Returns `{ ok: true, record }` on
 * success or `{ ok: false, reason }` on the first missing or invalid field.
 * The whole record is rejected for any required-field failure.
 * @param {unknown} raw
 * @returns {{ok: true, record: object}|{ok: false, reason: string}}
 */
export const validateOneLaunchProfile = (raw) => {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'launch profile entry is not an object' }
  }
  const r = /** @type {Record<string, unknown>} */ (raw)

  const profileId = trimText(r['profileId'])
  if (profileId === undefined) return { ok: false, reason: 'profileId is missing or empty' }
  if (!SAFE_PROFILE_ID.test(profileId)) {
    return { ok: false, reason: `profileId must be a lowercase slug (got ${JSON.stringify(r['profileId'])})` }
  }

  const engineId = trimText(r['engineId'])
  if (engineId === undefined) return { ok: false, reason: 'engineId is missing or empty' }

  const engineVersion = trimText(r['engineVersion'])
  if (engineVersion === undefined) return { ok: false, reason: 'engineVersion is missing or empty' }

  const modelKey = trimText(r['modelKey'])
  if (modelKey === undefined) return { ok: false, reason: 'modelKey is missing or empty' }

  const gpuUuids = r['gpuUuids']
  if (!Array.isArray(gpuUuids) || gpuUuids.length === 0) {
    return { ok: false, reason: 'gpuUuids must be a non-empty array' }
  }
  const validatedGpuUuids = []
  for (let i = 0; i < gpuUuids.length; i++) {
    const uuid = trimText(gpuUuids[i])
    if (uuid === undefined) return { ok: false, reason: `gpuUuids[${i}] must be a non-empty string` }
    validatedGpuUuids.push(uuid)
  }

  const gpuMode = r['gpuMode']
  if (gpuMode !== 'single' && gpuMode !== 'both') {
    return { ok: false, reason: `gpuMode must be "single" or "both", got ${JSON.stringify(gpuMode)}` }
  }

  const launchArgsRaw = r['launchArgs']
  if (!Array.isArray(launchArgsRaw)) {
    return { ok: false, reason: 'launchArgs must be an array (may be empty)' }
  }
  const launchArgs = []
  for (let i = 0; i < launchArgsRaw.length; i++) {
    const arg = trimText(launchArgsRaw[i])
    if (arg === undefined) return { ok: false, reason: `launchArgs[${i}] must be a non-empty string` }
    launchArgs.push(arg)
  }

  const label = trimText(r['label'])
  if (label === undefined) return { ok: false, reason: 'label is missing or empty' }

  const notes = trimText(r['notes'])

  return {
    ok: true,
    record: {
      profileId,
      engineId,
      engineVersion,
      modelKey,
      gpuUuids: validatedGpuUuids,
      gpuMode,
      launchArgs,
      label,
      ...(notes !== undefined ? { notes } : {}),
    },
  }
}

/**
 * Validate an array of launch profile records. Returns all valid records and
 * collects one problem string per rejected entry.
 * @param {unknown} raw
 * @returns {{valid: object[], problems: string[]}}
 */
export const validateLaunchProfiles = (raw) => {
  if (!Array.isArray(raw)) {
    return { valid: [], problems: ['launchProfiles must be an array'] }
  }
  const valid = []
  const problems = []
  for (let i = 0; i < raw.length; i++) {
    const result = validateOneLaunchProfile(raw[i])
    if (result.ok) {
      valid.push(result.record)
    } else {
      problems.push(`launchProfiles[${i}]: ${result.reason}`)
    }
  }
  return { valid, problems }
}

/**
 * Merge validated launch profiles into an engine catalog array. Every engine
 * entry receives a `launchProfiles` array (empty when no profiles exist for
 * that engine). Launch profiles are separate from release, installed, and
 * verified states.
 * @param {object[]} engines engine catalog entries (each must have an `id` field).
 * @param {object[]} profiles validated launch profile records.
 * @returns {object[]}
 */
export const mergeLaunchProfilesIntoEngines = (engines, profiles) => {
  const byEngineId = new Map()
  for (const profile of profiles) {
    const id = profile.engineId
    const list = byEngineId.get(id)
    if (list === undefined) byEngineId.set(id, [profile])
    else list.push(profile)
  }
  return engines.map((engine) => ({
    ...engine,
    launchProfiles: byEngineId.get(engine.id) ?? [],
  }))
}

/**
 * Check a validated profile's GPU UUIDs against the owner-configured GPU
 * boundary. Returns `{ ok: true }` when every UUID is in the allowed set and
 * none are in the protected set.
 * @param {object} profile a validated launch profile record.
 * @param {Array<{uuid?: string, role?: string}>} gpuBoundary from owner metadata.
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export const validateProfileGpuBoundary = (profile, gpuBoundary) => {
  if (!Array.isArray(gpuBoundary) || gpuBoundary.length === 0) {
    return { ok: false, reason: 'no GPU boundary is configured in owner metadata' }
  }
  const allowedUuids = new Set()
  const protectedUuids = new Set()
  for (const entry of gpuBoundary) {
    if (typeof entry.uuid !== 'string' || typeof entry.role !== 'string') continue
    if (entry.role.startsWith('allowed')) allowedUuids.add(entry.uuid)
    else if (entry.role.startsWith('protected')) protectedUuids.add(entry.uuid)
  }
  for (const uuid of profile.gpuUuids) {
    if (protectedUuids.has(uuid)) {
      return { ok: false, reason: `profile "${profile.profileId}" includes protected GPU ${uuid}` }
    }
    if (!allowedUuids.has(uuid)) {
      return { ok: false, reason: `profile "${profile.profileId}" references unrecognized GPU ${uuid}` }
    }
  }
  if (profile.gpuMode === 'both' && profile.gpuUuids.length < 2) {
    return { ok: false, reason: `profile "${profile.profileId}" has gpuMode "both" but fewer than two GPU UUIDs` }
  }
  return { ok: true }
}
