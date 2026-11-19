/**
 * Engine version comparison: decide whether an upstream release is newer than
 * the installed build, without ever guessing.
 *
 * The two values come from different producers and different formats. Detectors
 * report an operator-facing version (`0.22.1`, `0.19.0`, `b5100`), while the
 * GitHub Releases API reports a tag (`v0.40.15`, `v0.33.0rc3`). Comparing those
 * strings directly makes an identical version look different — `'0.40.15'` is
 * not `'v0.40.15'` — so every engine appears to have a pending update, forever,
 * including immediately after the owner upgrades it.
 *
 * This module answers one question with three possible results:
 *   true   the upstream release is strictly newer than the installed build
 *   false  the installed build is the same or newer
 *   null   the two values cannot be compared; no verdict is issued
 *
 * A `null` verdict is not a failure to compute — it is the correct answer when
 * the inputs are unknown, when they belong to different version spaces, or when
 * either side is not a version string. Callers must not render "update
 * available" for it.
 *
 * Two version spaces are supported:
 *   `semver`  dot-separated numbers with an optional prerelease suffix
 *   `build`   llama.cpp-style build numbers (`b5100`), a single monotonic integer
 *
 * A `build` value is never compared with a `semver` value: the numbers measure
 * different things, and inventing an ordering between them would be a guess.
 */

/**
 * Why a comparison produced its verdict. Stable machine keys so the UI can own
 * the wording.
 */
export const RELEASE_COMPARISON_REASONS = Object.freeze({
  /** The release feed versions an application, not the installed engine build. */
  CONTROL_SPACE: 'control-space',
  /** No upstream release has been recorded yet. */
  NOT_CHECKED: 'not-checked',
  /** The installed build was never detected on this host. */
  NOT_DETECTED: 'not-detected',
  /** Both values exist but do not share a comparable version space or format. */
  INCOMPARABLE: 'incomparable',
  /** The installed build is the same as, or newer than, the upstream release. */
  CURRENT: 'current',
  /** The upstream release is strictly newer than the installed build. */
  NEWER: 'newer',
})

/** A single leading `v`/`V` is a tag prefix, not part of the version. */
const LEADING_TAG_PREFIX = /^[vV]/
/** llama.cpp publishes monotonic build numbers such as `b5100`. */
const BUILD_VERSION = /^[bB](\d+)$/
/** Numeric core followed by an optional prerelease suffix with no separator. */
const NUMERIC_CORE = /^(\d+(?:\.\d+)*)(.*)$/
/** A prerelease identifier is alphanumeric; a numeric one sorts numerically. */
const PRERELEASE_IDENTIFIER = /^[0-9A-Za-z]+$/
const NUMERIC_IDENTIFIER = /^\d+$/
const MAX_CORE_SEGMENTS = 4

/**
 * A prerelease marker at the end of a tag.
 *
 * The GitHub `prerelease` flag cannot be trusted on its own: vLLM publishes
 * `v0.33.0rc3` with `prerelease: false` and a release name of `v0.33.0`. The
 * tag is the authoritative evidence, so this pattern is matched against it.
 *
 * The marker may follow a separator (`-rc3`, `.rc3`) or run straight on from the
 * numeric core (`0.33.0rc3`), so the boundary class admits a digit as well.
 */
const PRERELEASE_TAG = /(?:^|[\d._-])(?:rc|alpha|beta|pre|preview|dev|nightly|snapshot)(?:[-._]?\d+)?$/i

/**
 * Decide whether a release tag names a prerelease.
 *
 * @param {string|null|undefined} tag the upstream tag.
 * @param {boolean|null|undefined} [flag] the release API's own flag, when recorded.
 * @returns {boolean} true when either the flag is set or the tag carries a marker.
 */
export const isPrereleaseTag = (tag, flag) => {
  if (flag === true) return true
  if (typeof tag !== 'string' || tag.trim().length === 0) return false
  return PRERELEASE_TAG.test(tag.trim().replace(LEADING_TAG_PREFIX, ''))
}

/**
 * Parse one version string into a comparable form.
 *
 * Accepts a leading `v`, dot-separated numeric segments, an optional prerelease
 * suffix with or without a separator (`0.33.0rc3`, `0.33.0-rc3`, `0.33.0-rc.3`),
 * and a llama.cpp build number (`b5100`).
 *
 * @param {unknown} raw the version string to parse.
 * @returns {{ ok: true, series: 'semver' | 'build', core: number[], prerelease: string[], normalized: string } | { ok: false, reason: string }}
 */
export const parseVersion = (raw) => {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'version is not a string' }
  }
  const text = raw.trim()
  if (text.length === 0) {
    return { ok: false, reason: 'version is empty' }
  }
  const body = text.replace(LEADING_TAG_PREFIX, '')
  if (body.length === 0) {
    return { ok: false, reason: 'version is only a tag prefix' }
  }

  const build = body.match(BUILD_VERSION)
  if (build !== null) {
    const number = Number(build[1])
    if (!Number.isSafeInteger(number)) {
      return { ok: false, reason: 'build number is out of range' }
    }
    return { ok: true, series: 'build', core: [number], prerelease: [], normalized: `b${number}` }
  }

  const match = body.match(NUMERIC_CORE)
  if (match === null) {
    return { ok: false, reason: 'version does not start with a numeric segment' }
  }
  const core = /** @type {string} */ (match[1]).split('.').map(Number)
  if (core.length > MAX_CORE_SEGMENTS) {
    return { ok: false, reason: `version has more than ${MAX_CORE_SEGMENTS} numeric segments` }
  }
  if (core.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return { ok: false, reason: 'version contains a numeric segment that is out of range' }
  }

  const suffix = /** @type {string} */ (match[2])
  /** @type {string[]} */
  const prerelease = []
  if (suffix.length > 0) {
    const identifiers = suffix.replace(/^[-.]/, '').split(/[-.]/).filter((part) => part.length > 0)
    if (identifiers.length === 0) {
      return { ok: false, reason: 'prerelease marker is not followed by an identifier' }
    }
    if (identifiers.some((part) => !PRERELEASE_IDENTIFIER.test(part))) {
      return { ok: false, reason: 'prerelease identifier contains unsupported characters' }
    }
    // An unseparated suffix such as `rc10` is one identifier, but its trailing
    // number still has to order numerically — otherwise `rc10` sorts below
    // `rc9`. Split each identifier into its letter and digit runs so the
    // comparison sees the number. Separator forms (`rc.10`) are unaffected.
    for (const identifier of identifiers) {
      for (const run of identifier.match(/[0-9]+|[^0-9]+/g) ?? [identifier]) {
        prerelease.push(run)
      }
    }
  }

  const normalized = core.join('.') + (prerelease.length === 0 ? '' : `-${prerelease.join('.')}`)
  return { ok: true, series: 'semver', core, prerelease, normalized }
}

/**
 * Order two prerelease identifier lists.
 *
 * Follows the conventional ordering: a version with a prerelease sorts below
 * the same version without one (`0.33.0rc3` < `0.33.0`); numeric identifiers
 * sort numerically and below alphanumeric ones; a shorter list that is a prefix
 * of a longer one sorts first.
 *
 * @param {string[]} a left prerelease identifiers.
 * @param {string[]} b right prerelease identifiers.
 * @returns {-1 | 0 | 1}
 */
const comparePrerelease = (a, b) => {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    const left = /** @type {string} */ (a[i])
    const right = /** @type {string} */ (b[i])
    const leftNumeric = NUMERIC_IDENTIFIER.test(left)
    const rightNumeric = NUMERIC_IDENTIFIER.test(right)
    if (leftNumeric && rightNumeric) {
      const difference = Number(left) - Number(right)
      if (difference !== 0) return difference < 0 ? -1 : 1
      continue
    }
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    if (left !== right) return left < right ? -1 : 1
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? -1 : 1
}

/**
 * Compare two version strings.
 *
 * Missing numeric segments count as zero, so `1.2` equals `1.2.0`.
 *
 * @param {unknown} a left version string.
 * @param {unknown} b right version string.
 * @returns {-1 | 0 | 1 | null} null when either side is unparseable or the two
 *   belong to different version spaces; callers must treat that as unknown.
 */
export const compareVersions = (a, b) => {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left.ok || !right.ok) return null
  if (left.series !== right.series) return null
  const width = Math.max(left.core.length, right.core.length)
  for (let i = 0; i < width; i++) {
    const x = left.core[i] ?? 0
    const y = right.core[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Decide whether a stored engine record has a newer upstream release.
 *
 * Purely functional and read-only: it consumes a catalog record and returns a
 * verdict. It never fetches, installs, upgrades, or rewrites anything.
 *
 * @param {object | null | undefined} engine a stored or merged engine catalog entry.
 * @returns {{ updateAvailable: boolean | null, reason: string }}
 *   `updateAvailable` is true only when the upstream release is strictly newer.
 *   It is null whenever no verdict can be justified, including a record whose
 *   `versionSpace` is `control`.
 */
export const planReleaseComparison = (engine) => {
  const record = /** @type {Record<string, unknown>} */ (engine ?? {})
  if (record['versionSpace'] === 'control') {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.CONTROL_SPACE }
  }
  const latest = record['latestRelease']
  const installed = record['installedVersion']
  if (latest === null || latest === undefined) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.NOT_CHECKED }
  }
  if (installed === null || installed === undefined) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.NOT_DETECTED }
  }
  const order = compareVersions(installed, latest)
  if (order === null) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.INCOMPARABLE }
  }
  return order < 0
    ? { updateAvailable: true, reason: RELEASE_COMPARISON_REASONS.NEWER }
    : { updateAvailable: false, reason: RELEASE_COMPARISON_REASONS.CURRENT }
}

/**
 * Decide whether the engine feed publishes a newer build than the installed one.
 *
 * Some projects version their application and their engine separately. Strata is
 * the case at hand: its GitHub releases tag the control application (`v0.2.12`)
 * while the engine component it installs carries its own build (`0.1.56`), and
 * the project's update feed is the only place the published *engine* version
 * appears (`0.1.58`). Comparing the application tag against an engine build is
 * meaningless, which is why `planReleaseComparison` refuses it; this function
 * supplies the comparison that is meaningful.
 *
 * @param {object | null | undefined} engine a stored or merged engine catalog entry,
 *   carrying `engineRelease` (the published engine build) and `installedVersion`.
 * @returns {{ updateAvailable: boolean | null, reason: string }}
 */
export const planEngineBuildComparison = (engine) => {
  const record = /** @type {Record<string, unknown>} */ (engine ?? {})
  const published = record['engineRelease']
  const installed = record['installedVersion']
  if (published === null || published === undefined) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.NOT_CHECKED }
  }
  if (installed === null || installed === undefined) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.NOT_DETECTED }
  }
  const order = compareVersions(installed, published)
  if (order === null) {
    return { updateAvailable: null, reason: RELEASE_COMPARISON_REASONS.INCOMPARABLE }
  }
  return order < 0
    ? { updateAvailable: true, reason: RELEASE_COMPARISON_REASONS.NEWER }
    : { updateAvailable: false, reason: RELEASE_COMPARISON_REASONS.CURRENT }
}

/**
 * Attach comparison verdicts to each engine record.
 *
 * Adds `updateAvailable` and `updateReason` without mutating the input, and
 * leaves every other field untouched so owner-merged data survives intact.
 *
 * A record that also carries `engineRelease` gets a second verdict,
 * `engineUpdateAvailable`/`engineUpdateReason`, comparing the published engine
 * build against the installed one. That is the verdict an owner should act on
 * for such a project; `updateAvailable` stays null there because the release
 * tag belongs to the application.
 *
 * @param {object[]} engines engine records, possibly already merged with owner data.
 * @returns {object[]} new array of records each carrying the verdict(s).
 */
export const withReleaseComparison = (engines) => engines.map((engine) => {
  const verdict = planReleaseComparison(engine)
  const record = { ...engine, updateAvailable: verdict.updateAvailable, updateReason: verdict.reason }
  if (/** @type {Record<string, unknown>} */ (engine)['engineRelease'] === undefined) return record
  const build = planEngineBuildComparison(engine)
  return { ...record, engineUpdateAvailable: build.updateAvailable, engineUpdateReason: build.reason }
})
