/**
 * Persistent context selections. Stored as a versioned JSON file at
 * `contextSelectionsPath` from the plugin config so the automatically chosen
 * context survives service restarts, and so the owner can pin a per-model
 * manual override that the automatic path always honors. Reads fail safe
 * (missing file means no selections and no overrides). Writes are atomic
 * (tmp + rename). Schema:
 * `{ version: 1, selections: { [modelKey]: { context, source, decidedAt, reasons? } } }`
 * where `source` is `'auto'` (computed from evidence, overwritten by later
 * evidence) or `'manual'` (owner-authored, never overwritten).
 */

import { readFile, writeFile as fsWriteFile, rename, unlink } from 'node:fs/promises'

/** Manual selections are the only entries the automatic path may never replace. */
export const MANUAL_SOURCE = 'manual'
export const AUTO_SOURCE = 'auto'

/**
 * Parse the text of a selections file. Invalid entries are dropped at read
 * time; an unrecognized schema is reported as a read error, never guessed.
 * @param {string} text raw file text.
 * @returns {{ selections: Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>, readError?: string }}
 */
const parseSelectionsFile = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { selections: {}, readError: 'file is not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { selections: {}, readError: 'file does not match the expected schema' }
  }
  if (parsed.version !== 1) {
    return { selections: {}, readError: `unrecognized schema version: ${String(parsed.version)}` }
  }
  if (typeof parsed.selections !== 'object' || parsed.selections === null || Array.isArray(parsed.selections)) {
    return { selections: {}, readError: 'file does not match the expected schema' }
  }
  const selections = {}
  for (const [key, entry] of Object.entries(parsed.selections)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (typeof entry !== 'object' || entry === null) continue
    const context = entry['context']
    if (typeof context !== 'number' || !Number.isInteger(context) || context <= 0) continue
    const source = entry['source'] === MANUAL_SOURCE ? MANUAL_SOURCE : AUTO_SOURCE
    selections[key] = {
      context,
      source,
      ...(typeof entry['decidedAt'] === 'string' ? { decidedAt: entry['decidedAt'] } : {}),
      ...(Array.isArray(entry['reasons']) ? { reasons: entry['reasons'].filter((r) => typeof r === 'string') } : {}),
    }
  }
  return { selections }
}

/**
 * Read persisted context selections. Returns an empty map when the file is
 * absent. Never throws.
 * @param {string} filePath absolute path; empty string disables persistence.
 * @param {{ readFile?: function }} [deps] injectable for tests.
 * @returns {Promise<{ selections: Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>, readError?: string }>}
 */
export const readContextSelections = async (filePath, deps = {}) => {
  if (typeof filePath !== 'string' || filePath === '') return { selections: {} }
  const doRead = deps.readFile ?? readFile
  let text
  try {
    text = await doRead(filePath, 'utf8')
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    if (code === 'ENOENT') return { selections: {} }
    return { selections: {}, readError: error instanceof Error ? error.message : String(error) }
  }
  return parseSelectionsFile(text)
}

/**
 * Merge one computed selection into the stored map without discarding a
 * manual override: `'manual'` entries win over `'auto'` always, and an
 * identical auto record is not rewritten (no write churn).
 * @param {Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>} stored existing selections.
 * @param {string} modelKey model key to record.
 * @param {{selected: number|undefined, source: string, reasons?: string[]}} computed freshly computed selection.
 * @param {string} decidedAt ISO timestamp for the record.
 * @returns {{ changed: boolean, next: Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>, record?: { context: number, source: string, decidedAt?: string, reasons?: string[] } }}
 */
export const mergeSelection = (stored, modelKey, computed, decidedAt) => {
  const record = computed.selected === undefined ? undefined : {
    context: computed.selected,
    source: computed.source === MANUAL_SOURCE ? MANUAL_SOURCE : AUTO_SOURCE,
    decidedAt,
    ...(Array.isArray(computed.reasons) && computed.reasons.length > 0 ? { reasons: computed.reasons } : {}),
  }
  const existing = stored[modelKey]
  if (record !== undefined && existing !== undefined && existing.source === MANUAL_SOURCE && computed.source !== MANUAL_SOURCE) {
    return { changed: false, next: stored }
  }
  if (record !== undefined && existing !== undefined
    && existing.context === record.context && existing.source === record.source) {
    return { changed: false, next: stored, record }
  }
  const next = { ...stored }
  if (record === undefined) {
    if (existing !== undefined && existing.source !== MANUAL_SOURCE) delete next[modelKey]
    else return { changed: false, next: stored }
  } else {
    next[modelKey] = record
  }
  return { changed: true, next, record }
}

/**
 * Atomically write the selections map. Writes to a `.tmp` sibling first, then
 * renames; cleans up the tmp file on failure.
 * @param {string} filePath absolute path.
 * @param {Record<string, {context: number, source: string, decidedAt?: string, reasons?: string[]}>} selections map to persist.
 * @param {{ writeFile?: function, rename?: function, unlink?: function }} [deps] injectables for tests.
 * @returns {Promise<void>}
 */
export const writeContextSelections = async (filePath, selections, deps = {}) => {
  const doWriteFile = deps.writeFile ?? fsWriteFile
  const doRename = deps.rename ?? rename
  const doUnlink = deps.unlink ?? unlink
  const tmpPath = `${filePath}.tmp`
  const json = JSON.stringify({ version: 1, selections }, null, 2)
  try {
    await doWriteFile(tmpPath, json, 'utf8')
    await doRename(tmpPath, filePath)
  } catch (error) {
    try { await doUnlink(tmpPath) } catch { /* best-effort cleanup */ }
    throw error
  }
}