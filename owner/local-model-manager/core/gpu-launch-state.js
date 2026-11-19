/**
 * Durable owner GPU launch reservations: every UUID in this file is a GPU the
 * owner manually locked as a launch target through the panel. The file starts
 * absent, and absence means no GPU is reserved — nothing recreates a
 * reservation automatically. The only writers are the explicit owner
 * reserve/release confirm flows.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'

/** Current on-disk schema version. */
export const GPU_LAUNCH_STATE_VERSION = 1

const MAX_RESERVATIONS = 8
const MAX_UUID_LENGTH = 128

/**
 * Read the persisted launch reservations. Every failure degrades to "no
 * reservations" with a readError the caller surfaces; a missing file is the
 * normal unreserved state, not an error.
 * @param {string} filePath absolute path to the state JSON file.
 * @param {{readFileSync?: typeof readFileSync}} [deps] injectable reader for tests.
 * @returns {{reservations: string[], readError?: string}}
 */
export const readGpuLaunchState = (filePath, deps = {}) => {
  const doRead = deps.readFileSync ?? readFileSync
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { reservations: [], readError: 'no GPU launch state path is configured' }
  }
  let raw
  try {
    raw = doRead(filePath, 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') {
      return { reservations: [] }
    }
    return { reservations: [], readError: `could not read the GPU launch reservation file: ${msg(error)}` }
  }
  let doc
  try {
    doc = JSON.parse(String(raw))
  } catch {
    return { reservations: [], readError: 'file is not valid JSON' }
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { reservations: [], readError: 'file is not a JSON object' }
  }
  if (doc.version !== GPU_LAUNCH_STATE_VERSION) {
    return { reservations: [], readError: `unrecognized schema version: ${JSON.stringify(doc.version)}` }
  }
  const list = doc.reservations
  if (!Array.isArray(list)) {
    return { reservations: [], readError: 'reservations must be a list of UUIDs' }
  }
  const reservations = []
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_UUID_LENGTH) continue
    if (reservations.includes(entry)) continue
    if (reservations.length >= MAX_RESERVATIONS) break
    reservations.push(entry)
  }
  const dropped = list.length - reservations.length
  return {
    reservations,
    ...(dropped > 0 ? { readError: `dropped ${dropped} malformed reservation entr${dropped === 1 ? 'y' : 'ies'}` } : {}),
  }
}

/**
 * Persist the reservation list atomically (tmp file + rename). Only the
 * confirmed owner flows call this.
 * @param {string} filePath absolute path to the state JSON file.
 * @param {string[]} reservations UUIDs the owner has manually reserved.
 * @param {{writeFileSync?: typeof writeFileSync, renameSync?: typeof renameSync, unlinkSync?: typeof unlinkSync}} [deps] injectable writers for tests.
 */
export const writeGpuLaunchState = (filePath, reservations, deps = {}) => {
  const doWrite = deps.writeFileSync ?? writeFileSync
  const doRename = deps.renameSync ?? renameSync
  const doUnlink = deps.unlinkSync ?? unlinkSync
  if (reservations.length > MAX_RESERVATIONS) {
    throw new RangeError(`a GPU launch state write supports at most ${MAX_RESERVATIONS} reservations; got ${reservations.length}`)
  }
  const doc = {
    version: GPU_LAUNCH_STATE_VERSION,
    reservations: [...reservations],
    updatedAt: new Date().toISOString(),
  }
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`
  doWrite(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  try {
    doRename(tmp, filePath)
  } catch (error) {
    try { doUnlink(tmp) } catch { /* the tmp path is derived and was just written; nothing to preserve */ }
    throw error
  }
}

const msg = (error) => error instanceof Error ? error.message : String(error)