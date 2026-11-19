/**
 * Engine verification registry: owner-recorded evidence that a specific
 * engine/model/GPU configuration passed an actual test.
 *
 * The three engine states are always separate and never inferred from
 * each other:
 *   latestRelease    — upstream tag fetched from GitHub (engine-update module)
 *   installedVersion — host-detected or owner-recorded (engine-update module)
 *   verified         — a specific engine/model/GPU combination the owner
 *                      confirmed passed an actual test (this module)
 *
 * Nothing here installs, launches, or activates any engine.
 * Purely functional: no I/O. The host supplies raw owner metadata values.
 */

const MAX_TEXT = 200
const MAX_LIST = 16

/**
 * Trim and bound one string field; returns undefined when absent or empty.
 * @param {unknown} value
 * @returns {string|undefined}
 */
const trimText = (value) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_TEXT)
}

/**
 * Validate one owner-written engine verification record.
 *
 * Required fields: engineId, engineVersion, modelKey, verifiedAt, result.
 * `result` must be 'passed' or 'failed' — never inferred.
 * Optional: gpuUuids (list of strings), evidenceNote.
 *
 * Rejects the whole record rather than silently dropping required fields,
 * so a schema mistake in the owner metadata surfaces clearly.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
export const validateOneVerification = (raw) => {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'verification entry is not an object' }
  }
  const r = /** @type {Record<string, unknown>} */ (raw)

  const engineId = trimText(r['engineId'])
  if (engineId === undefined) return { ok: false, reason: 'engineId is missing or empty' }

  const engineVersion = trimText(r['engineVersion'])
  if (engineVersion === undefined) return { ok: false, reason: 'engineVersion is missing or empty' }

  const modelKey = trimText(r['modelKey'])
  if (modelKey === undefined) return { ok: false, reason: 'modelKey is missing or empty' }

  const verifiedAt = trimText(r['verifiedAt'])
  if (verifiedAt === undefined) return { ok: false, reason: 'verifiedAt is missing or empty' }

  const result = r['result']
  if (result !== 'passed' && result !== 'failed') {
    return { ok: false, reason: `result must be "passed" or "failed", got ${JSON.stringify(result)}` }
  }

  /** @type {Record<string, unknown>} */
  const record = { engineId, engineVersion, modelKey, verifiedAt, result }

  if (Array.isArray(r['gpuUuids'])) {
    const gpuUuids = r['gpuUuids']
      .map((v) => trimText(v))
      .filter(/** @returns {v is string} */ (v) => v !== undefined)
      .slice(0, MAX_LIST)
    if (gpuUuids.length > 0) record['gpuUuids'] = gpuUuids
  }

  const evidenceNote = trimText(r['evidenceNote'])
  if (evidenceNote !== undefined) record['evidenceNote'] = evidenceNote

  return { ok: true, record }
}

/**
 * Validate a list of owner-written engine verification records.
 *
 * Invalid records are collected into `problems` and skipped; valid records
 * are returned in `valid`. A partial list never blocks the valid entries.
 *
 * @param {unknown} rawList raw value from the owner metadata file.
 * @returns {{ valid: object[], problems: string[] }}
 */
export const validateEngineVerifications = (rawList) => {
  const problems = /** @type {string[]} */ ([])
  if (rawList === undefined || rawList === null) return { valid: [], problems }
  if (!Array.isArray(rawList)) {
    problems.push('engineVerifications is not a list and was ignored')
    return { valid: [], problems }
  }
  const valid = /** @type {object[]} */ ([])
  for (let i = 0; i < rawList.length; i++) {
    const result = validateOneVerification(rawList[i])
    if (result.ok) {
      valid.push(result.record)
    } else {
      problems.push(`engineVerifications[${i}]: ${result.reason}`)
    }
  }
  return { valid, problems }
}

/**
 * Merge validated verification records into an engine catalog engines list.
 *
 * Each engine entry gains a `verifications` array containing only the records
 * whose `engineId` matches that engine. Engines with no records get an empty
 * array, so the three-state distinction stays visible for every entry.
 *
 * Inputs are never mutated; a new array is returned.
 *
 * @param {object[]} engines engine catalog entries from the engine-update module.
 * @param {object[]} verifications validated verification records from this module.
 * @returns {object[]} new array with `verifications` attached to each entry.
 */
export const mergeVerificationsIntoEngines = (engines, verifications) => {
  /** @type {Map<string, object[]>} */
  const byId = new Map()
  for (const record of verifications) {
    const id = /** @type {any} */ (record).engineId
    const list = byId.get(id)
    if (list === undefined) byId.set(id, [record])
    else list.push(record)
  }
  return engines.map((engine) => ({
    ...engine,
    verifications: byId.get(/** @type {any} */ (engine).id) ?? [],
  }))
}
