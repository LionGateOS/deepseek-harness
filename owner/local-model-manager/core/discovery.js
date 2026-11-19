/**
 * Bounded two-level GGUF discovery scanner. Scans each configured root
 * directory and its immediate subdirectories for GGUF files not already known
 * to the managed catalog, and optionally writes the result to an atomic cache
 * file for consumption by other panels. Discovery never registers providers,
 * modifies guidance, authorizes launches, changes GPU policy, or starts or
 * stops models.
 */

import { readdir, stat, rename, unlink, writeFile as fsWriteFile } from 'node:fs/promises'
import path from 'node:path'

/** Maximum candidates reported per root directory before truncation. */
const MAX_CANDIDATES_PER_ROOT = 200

/** Matches multi-shard GGUF files: basename-NNNNN-of-MMMMM.gguf */
const SHARD_PATTERN = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/i

/**
 * Scan one root directory (itself + immediate subdirectories only) for GGUF
 * candidates not present in knownPaths or mmprojPaths.
 * @param {string} root absolute directory path.
 * @param {Set<string>} knownPaths paths already in the managed catalog.
 * @param {Set<string>} mmprojPaths mmproj companion paths from the catalog.
 * @param {{readdir?: function, stat?: function}} deps injectable for tests.
 * @returns {Promise<object>} root scan result.
 */
export const scanRootDir = async (root, knownPaths, mmprojPaths, deps = {}) => {
  const doReaddir = deps.readdir ?? readdir
  const doStat = deps.stat ?? stat
  const subdirErrors = []
  const candidates = []
  let truncated = false

  // Read the root directory.
  let rootEntries
  try {
    rootEntries = await doReaddir(root, { withFileTypes: true })
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    const status = code === 'ENOENT' ? 'not-found'
      : code === 'EACCES' ? 'access-denied'
      : code === 'ENOTDIR' ? 'not-a-directory'
      : 'error'
    return { root, status, candidates: [], subdirErrors: [], truncated: false }
  }

  const rootFiles = []
  const subdirPaths = []
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
      rootFiles.push({ name: entry.name, path: path.join(root, entry.name) })
    } else if (entry.isDirectory()) {
      subdirPaths.push(path.join(root, entry.name))
    }
  }

  /**
   * Process one flat list of GGUF files from a single directory. Groups
   * multi-shard files by base name; skips managed paths; pushes new
   * candidates up to the per-root cap.
   * @param {Array<{name: string, path: string}>} files
   */
  const processFiles = async (files) => {
    const shardGroups = new Map()
    const seenAsPartOfGroup = new Set()

    for (const file of files) {
      const m = file.name.match(SHARD_PATTERN)
      if (m !== null) {
        const baseName = m[1]
        const shardIndex = parseInt(m[2], 10)
        const totalShards = parseInt(m[3], 10)
        if (!shardGroups.has(baseName)) shardGroups.set(baseName, { totalShards, shards: [] })
        shardGroups.get(baseName).shards.push({ shardIndex, path: file.path })
      }
    }

    for (const [baseName, group] of shardGroups) {
      for (const s of group.shards) seenAsPartOfGroup.add(s.path)
      const shard1 = group.shards.find((s) => s.shardIndex === 1)
      if (shard1 === undefined) continue // incomplete shard set; skip group
      if (knownPaths.has(shard1.path) || mmprojPaths.has(shard1.path)) continue // managed catalog
      if (candidates.length >= MAX_CANDIDATES_PER_ROOT) { truncated = true; return }
      try {
        const info = await doStat(shard1.path)
        candidates.push({ path: shard1.path, name: baseName, sizeBytes: info.size, multiPart: true, totalShards: group.totalShards })
      } catch (error) {
        subdirErrors.push({ path: shard1.path, error: error instanceof Error ? error.message : String(error) })
      }
    }

    for (const file of files) {
      if (seenAsPartOfGroup.has(file.path)) continue
      if (knownPaths.has(file.path) || mmprojPaths.has(file.path)) continue
      if (candidates.length >= MAX_CANDIDATES_PER_ROOT) { truncated = true; return }
      try {
        const info = await doStat(file.path)
        candidates.push({ path: file.path, name: file.name.replace(/\.gguf$/i, ''), sizeBytes: info.size, multiPart: false, totalShards: 1 })
      } catch (error) {
        subdirErrors.push({ path: file.path, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  await processFiles(rootFiles)

  for (const subdir of subdirPaths) {
    if (truncated) break
    let subdirEntries
    try {
      subdirEntries = await doReaddir(subdir, { withFileTypes: true })
    } catch (error) {
      subdirErrors.push({ path: subdir, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    const subdirFiles = subdirEntries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gguf'))
      .map((e) => ({ name: e.name, path: path.join(subdir, e.name) }))
    await processFiles(subdirFiles)
  }

  return { root, status: 'ok', candidates, subdirErrors, truncated }
}

/**
 * Run discovery across all configured root directories and return the combined
 * result. A root that cannot be read records its failure in its status field;
 * the overall call never throws.
 * @param {string[]} dirs root directories to scan.
 * @param {Set<string>} knownPaths paths already in the managed catalog.
 * @param {Set<string>} mmprojPaths mmproj companion paths from the catalog.
 * @param {{readdir?: function, stat?: function, now?: function}} deps injectable for tests.
 * @returns {Promise<object>} the full discovery result (version, generatedAt, roots).
 */
export const buildDiscoveryResult = async (dirs, knownPaths, mmprojPaths, deps = {}) => {
  const generatedAt = deps.now !== undefined ? deps.now() : new Date().toISOString()
  const roots = await Promise.all(dirs.map((dir) => scanRootDir(dir, knownPaths, mmprojPaths, deps)))
  return { version: 1, generatedAt, roots }
}

/**
 * Atomically write the discovery cache to destPath. Writes to a `.tmp` sibling
 * first and renames atomically; cleans up the tmp file on any failure.
 * @param {string} destPath absolute path for the cache file.
 * @param {object} result discovery result from buildDiscoveryResult.
 * @param {{writeFile?: function, rename?: function, unlink?: function}} deps injectable for tests.
 * @returns {Promise<void>}
 */
export const writeDiscoveryCache = async (destPath, result, deps = {}) => {
  const doWriteFile = deps.writeFile ?? fsWriteFile
  const doRename = deps.rename ?? rename
  const doUnlink = deps.unlink ?? unlink
  const tmpPath = `${destPath}.tmp`
  const json = JSON.stringify(result, null, 2)
  try {
    await doWriteFile(tmpPath, json, 'utf8')
    await doRename(tmpPath, destPath)
  } catch (error) {
    try { await doUnlink(tmpPath) } catch { /* best-effort cleanup */ }
    throw error
  }
}
