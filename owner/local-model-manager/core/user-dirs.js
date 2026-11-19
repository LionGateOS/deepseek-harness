/**
 * Persistent user-added GGUF discovery directories. Stored as a versioned
 * JSON file at `userDiscoveryDirsPath` from the plugin config. Reads fail
 * safe (missing file returns an empty list). Writes are atomic (tmp + rename).
 * Schema: { version: 1, dirs: string[] } — all entries are absolute paths.
 */

import { readFile, writeFile as fsWriteFile, rename, unlink } from 'node:fs/promises'

/** Conservative upper bound on user-added directories to keep scanning bounded. */
export const MAX_USER_DIRS = 20

/**
 * Parse the text of a user-dirs settings file. Returns the valid dirs list;
 * silently drops invalid (non-absolute) entries; reports schema errors.
 * @param {string} text raw file text.
 * @returns {{ dirs: string[], readError?: string }}
 */
const parseUserDirsFile = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { dirs: [], readError: 'file is not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { dirs: [], readError: 'file does not match the expected schema' }
  }
  if (parsed.version !== 1) {
    return { dirs: [], readError: `unrecognized schema version: ${String(parsed.version)}` }
  }
  if (!Array.isArray(parsed.dirs)) {
    return { dirs: [], readError: 'file does not match the expected schema' }
  }
  // Keep only valid absolute paths; silently drop malformed entries.
  const dirs = parsed.dirs.filter((d) => typeof d === 'string' && d.startsWith('/'))
  return { dirs }
}

/**
 * Read the user-added directory list from filePath. Returns `{ dirs: [] }`
 * when the file is absent. Returns `{ dirs: [], readError }` when the file
 * is present but unreadable or malformed. Never throws.
 * @param {string} filePath absolute path to the settings file; empty string disables the feature.
 * @param {{ readFile?: function }} [deps] injectable for tests.
 * @returns {Promise<{ dirs: string[], readError?: string }>}
 */
export const readUserDirs = async (filePath, deps = {}) => {
  if (typeof filePath !== 'string' || filePath === '') return { dirs: [] }
  const doRead = deps.readFile ?? readFile
  let text
  try {
    text = await doRead(filePath, 'utf8')
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    if (code === 'ENOENT') return { dirs: [] }
    return { dirs: [], readError: error instanceof Error ? error.message : String(error) }
  }
  return parseUserDirsFile(text)
}

/**
 * Atomically write the user-added directory list to filePath. Writes to a
 * `.tmp` sibling first, then renames atomically. Cleans up the tmp file on
 * any failure.
 * @param {string} filePath absolute path.
 * @param {string[]} dirs validated absolute paths to persist.
 * @param {{ writeFile?: function, rename?: function, unlink?: function }} [deps] injectable for tests.
 * @returns {Promise<void>}
 */
export const writeUserDirs = async (filePath, dirs, deps = {}) => {
  const doWriteFile = deps.writeFile ?? fsWriteFile
  const doRename = deps.rename ?? rename
  const doUnlink = deps.unlink ?? unlink
  const tmpPath = `${filePath}.tmp`
  const json = JSON.stringify({ version: 1, dirs }, null, 2)
  try {
    await doWriteFile(tmpPath, json, 'utf8')
    await doRename(tmpPath, filePath)
  } catch (error) {
    try { await doUnlink(tmpPath) } catch { /* best-effort cleanup */ }
    throw error
  }
}
