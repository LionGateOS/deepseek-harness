/**
 * Engine update discovery: fetch and record the latest upstream release for
 * each registered inference engine.
 *
 * Separation from model/pricing refresh: engine releases are versioned
 * software artifacts published on GitHub; model metadata and cloud pricing are
 * API-level runtime facts. A failed engine check must never affect model or
 * pricing refresh results, and this module performs no I/O of its own — the
 * host supplies all fetch results.
 *
 * Each engine record captures:
 *   installedVersion  owner-recorded or host-detected version (null when unknown)
 *   latestRelease     latest upstream tag_name from the official GitHub API
 *   releaseUrl        the release page html_url
 *   releasedAt        when that release was published upstream
 *   lastCheckAt       when the upstream API was last queried successfully
 *   status            'success' | 'error' | 'not-checked'
 *
 * No engine is automatically installed, upgraded, executed, or activated.
 */

/** Default number of days before a successful check is considered stale. */
export const DEFAULT_ENGINE_CHECK_STALE_DAYS = 7

/** How much of a release body is kept as evidence. Enough for the summary line. */
export const RELEASE_NOTES_LIMIT = 2000

/**
 * Official upstream release sources for registered inference engines.
 * Each entry uses the GitHub Releases API (`/repos/:owner/:repo/releases/latest`),
 * whose JSON schema is stable enough to use one deterministic parser across
 * all entries. Add new entries here to extend the registry.
 *
 * `versionSpace` names what the release feed publishes. `control` means the tag
 * versions the application/AppImage, which for Strata is a different sequence
 * from the installed engine build reported by `installedVersion`; the two are
 * never compared. Omitted means the feed versions the engine itself.
 *
 * @type {readonly {readonly id: string, readonly displayName: string, readonly releaseApiUrl: string, readonly versionSpace?: 'control'}[]}
 */
export const ENGINE_SOURCES = Object.freeze([
  Object.freeze({ id: 'vllm',          displayName: 'vLLM',                  releaseApiUrl: 'https://api.github.com/repos/vllm-project/vllm/releases/latest' }),
  Object.freeze({ id: 'llama.cpp',     displayName: 'llama.cpp',             releaseApiUrl: 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' }),
  Object.freeze({ id: 'ollama',        displayName: 'Ollama',                releaseApiUrl: 'https://api.github.com/repos/ollama/ollama/releases/latest' }),
  Object.freeze({ id: 'sglang',        displayName: 'SGLang',                releaseApiUrl: 'https://api.github.com/repos/sgl-project/sglang/releases/latest' }),
  Object.freeze({ id: 'tensorrt-llm',  displayName: 'NVIDIA TensorRT-LLM',   releaseApiUrl: 'https://api.github.com/repos/NVIDIA/TensorRT-LLM/releases/latest' }),
  // Strata's GitHub releases tag the control application (v0.2.x); the engine
  // component it installs carries its own build number (0.1.x), so this row
  // reports a control release and an engine build side by side without ever
  // treating them as comparable.
  Object.freeze({ id: 'strata',        displayName: 'Strata',                releaseApiUrl: 'https://api.github.com/repos/Niko1221/Strata/releases/latest', versionSpace: 'control' }),
])

/**
 * Parse one GitHub Releases API JSON response for an engine.
 *
 * The parser is strict: any missing or unexpected shape in the three key
 * fields (tag_name, html_url, published_at) is an error rather than a
 * silent partial record, so a schema change cannot produce a wrong version.
 *
 * Three further fields are captured as advisory evidence when present, and are
 * never allowed to fail the parse: `name`, an excerpt of `body`, and the
 * `prerelease` flag. The flag alone is not trustworthy — vLLM publishes
 * `v0.33.0rc3` with `prerelease: false` — so it is recorded as published and
 * the tag itself is judged separately.
 *
 * @param {string} body raw response body from the GitHub Releases API.
 * @returns {{ ok: true, tagName: string, releaseUrl: string, publishedAt: string, releaseName: string|null, releaseNotes: string|null, prereleaseFlag: boolean|null } | { ok: false, reason: string }}
 */
export const parseGitHubRelease = (body) => {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { ok: false, reason: 'response body is empty or not a string' }
  }
  let data
  try {
    data = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'response body is not valid JSON' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'response is not a JSON object' }
  }
  const tagNameRaw = data['tag_name']
  const htmlUrlRaw = data['html_url']
  const publishedAtRaw = data['published_at']
  if (typeof tagNameRaw !== 'string' || tagNameRaw.trim().length === 0) {
    return { ok: false, reason: 'tag_name field is missing or empty; GitHub API schema may have changed' }
  }
  const htmlUrl = typeof htmlUrlRaw === 'string' ? htmlUrlRaw.trim() : ''
  if (htmlUrl.length === 0 || !htmlUrl.startsWith('https://')) {
    return { ok: false, reason: 'html_url field is missing or not an https URL; GitHub API schema may have changed' }
  }
  if (typeof publishedAtRaw !== 'string') {
    return { ok: false, reason: 'published_at field is missing; GitHub API schema may have changed' }
  }
  const nameRaw = data['name']
  const bodyRaw = data['body']
  const notes = typeof bodyRaw === 'string' && bodyRaw.trim().length > 0
    ? bodyRaw.trim().slice(0, RELEASE_NOTES_LIMIT)
    : null
  return {
    ok: true,
    tagName: tagNameRaw.trim(),
    releaseUrl: htmlUrl,
    publishedAt: publishedAtRaw.trim(),
    releaseName: typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw.trim() : null,
    releaseNotes: notes,
    prereleaseFlag: typeof data['prerelease'] === 'boolean' ? data['prerelease'] : null,
  }
}

/**
 * Validate the shape of a stored engine catalog JSON value.
 * @param {unknown} raw
 * @returns {{ ok: true, catalog: { engines: object[] } } | { ok: false }}
 */
export const validateEngineCatalog = (raw) => {
  if (raw === undefined || raw === null) return { ok: false }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const obj = /** @type {Record<string, unknown>} */ (raw)
  if (obj['version'] !== 1) return { ok: false }
  if (!Array.isArray(obj['engines'])) return { ok: false }
  return { ok: true, catalog: { engines: /** @type {object[]} */ (obj['engines']) } }
}

/**
 * Check whether a stored engine record's release data is fresh, stale, or unknown.
 *
 * Only 'success' records with a parseable lastCheckAt count as fresh or stale;
 * error and not-checked records are always 'unknown'.
 *
 * @param {object | null | undefined} record a stored engine record.
 * @param {number} [maxStaleDays] defaults to DEFAULT_ENGINE_CHECK_STALE_DAYS.
 * @returns {'fresh' | 'stale' | 'unknown'}
 */
export const engineReleaseFreshness = (record, maxStaleDays = DEFAULT_ENGINE_CHECK_STALE_DAYS) => {
  if (record == null || record['status'] !== 'success' || typeof record['lastCheckAt'] !== 'string') {
    return 'unknown'
  }
  const ageMs = Date.now() - new Date(record['lastCheckAt']).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown'
  return ageMs <= maxStaleDays * 24 * 60 * 60 * 1000 ? 'fresh' : 'stale'
}

/**
 * Apply one engine release refresh pass over the given fetch results.
 *
 * Purely functional: performs no I/O. The host supplies all fetch results.
 *
 * Safety invariants:
 *   - A fetch failure preserves the previous record's release facts and sets status 'error'.
 *   - A parse failure preserves the previous record's release facts and sets status 'error'.
 *   - An engine absent from fetchResults is preserved unchanged from the previous catalog.
 *   - installedVersion is never inferred from the fetched release; it comes only from
 *     fetchResults[].installedVersion (host-detected or owner-recorded) or the previous record.
 *   - No engine is installed, launched, or activated.
 *   - A failed check for one engine does not affect the records for any other engine.
 *
 * @param {object} input
 * @param {unknown} input.previousCatalog previous engine catalog JSON (may be undefined/null/malformed).
 * @param {{ engineId: string, result: {status: 'fetched'|'failed', body?: string, fetchedAt: string, error?: string}, installedVersion?: string|null, engineRelease?: string|null, engineReleaseDetail?: object|null }[]} input.fetchResults host-supplied per-engine fetch results.
 * @param {string} input.now ISO timestamp of this run.
 * @returns {{ engines: object[], report: object, catalog: object, catalogWasMalformed: boolean }}
 */
export const applyEngineUpdate = ({ previousCatalog, fetchResults, now }) => {
  const previousCheck = validateEngineCatalog(previousCatalog)
  const previousEngines = previousCheck.ok ? previousCheck.catalog.engines : []
  const catalogWasMalformed = !previousCheck.ok
    && previousCatalog !== undefined && previousCatalog !== null

  /** @type {Map<string, object>} */
  const previousById = new Map(previousEngines.map((engine) => [/** @type {any} */ (engine).id, engine]))
  /** @type {Map<string, {engineId: string, result: object, installedVersion?: string|null}>} */
  const fetchById = new Map(fetchResults.map((r) => [r.engineId, r]))

  /** @type {string[]} */
  const firstSeen = []
  /** @type {{id: string, from: string, to: string}[]} */
  const updated = []
  /** @type {{id: string, error: string}[]} */
  const failed = []
  /** @type {string[]} */
  const retained = []
  /** @type {string[]} */
  const succeeded = []

  const mappedEngines = ENGINE_SOURCES.map((source) => {
    const previous = previousById.get(source.id)
    const fetch = fetchById.get(source.id)

    if (fetch === undefined) {
      // Not checked this run: preserve previous or record as not-yet-checked.
      if (previous !== undefined) retained.push(source.id)
      return previous ?? {
        id: source.id,
        displayName: source.displayName,
        installedVersion: null,
        latestRelease: null,
        releaseUrl: null,
        lastCheckAt: null,
        status: 'not-checked',
      }
    }

    // installedVersion: host-supplied value wins; otherwise carry forward from previous.
    const installedVersion = fetch.installedVersion !== undefined
      ? fetch.installedVersion
      : (/** @type {any} */ (previous)?.installedVersion ?? null)

    if (fetch.result.status !== 'fetched') {
      const error = fetch.result.error ?? 'fetch failed'
      failed.push({ id: source.id, error })
      // Preserve previous release facts; update lastCheckAt and status.
      return previous !== undefined
        ? { ...previous, installedVersion, lastCheckAt: fetch.result.fetchedAt, status: 'error', errorDetail: error }
        : { id: source.id, displayName: source.displayName, installedVersion, latestRelease: null, releaseUrl: null, lastCheckAt: fetch.result.fetchedAt, status: 'error', errorDetail: error }
    }

    const parsed = parseGitHubRelease(fetch.result.body ?? '')
    if (!parsed.ok) {
      const error = `response could not be parsed: ${parsed.reason}`
      failed.push({ id: source.id, error })
      return previous !== undefined
        ? { ...previous, installedVersion, lastCheckAt: fetch.result.fetchedAt, status: 'error', errorDetail: error }
        : { id: source.id, displayName: source.displayName, installedVersion, latestRelease: null, releaseUrl: null, lastCheckAt: fetch.result.fetchedAt, status: 'error', errorDetail: error }
    }

    succeeded.push(source.id)
    const wasKnown = previous !== undefined && /** @type {any} */ (previous).latestRelease !== null
    if (!wasKnown) {
      firstSeen.push(source.id)
    } else if (/** @type {any} */ (previous).latestRelease !== parsed.tagName) {
      updated.push({ id: source.id, from: /** @type {any} */ (previous).latestRelease, to: parsed.tagName })
    }

    /** @type {Record<string, unknown>} */
    const record = {
      id: source.id,
      displayName: source.displayName,
      installedVersion,
      latestRelease: parsed.tagName,
      releaseUrl: parsed.releaseUrl,
      releasedAt: parsed.publishedAt,
      lastCheckAt: fetch.result.fetchedAt,
      status: 'success',
    }
    // Release evidence is recorded but never required: a release that publishes
    // no body still yields a valid version record.
    if (parsed.releaseName !== null) record['releaseName'] = parsed.releaseName
    if (parsed.releaseNotes !== null) record['releaseNotes'] = parsed.releaseNotes
    if (parsed.prereleaseFlag !== null) record['prerelease'] = parsed.prereleaseFlag
    // A per-engine published engine build, when the host could read one. This is
    // what makes a project whose release feed versions the application
    // comparable with an installed engine build.
    if (fetch.engineRelease !== undefined && fetch.engineRelease !== null) {
      record['engineRelease'] = fetch.engineRelease
    } else if (/** @type {any} */ (previous)?.engineRelease !== undefined) {
      record['engineRelease'] = /** @type {any} */ (previous).engineRelease
    }
    if (fetch.engineReleaseDetail !== undefined && fetch.engineReleaseDetail !== null) {
      record['engineReleaseDetail'] = fetch.engineReleaseDetail
    } else if (/** @type {any} */ (previous)?.engineReleaseDetail !== undefined) {
      record['engineReleaseDetail'] = /** @type {any} */ (previous).engineReleaseDetail
    }
    return record
  })

  const engines = mappedEngines.map((engine, index) => {
    const source = ENGINE_SOURCES[index]
    return source.versionSpace === undefined ? engine : { ...engine, versionSpace: source.versionSpace }
  })

  /** @type {{kind: string, message: string}[]} */
  const notes = []
  if (catalogWasMalformed) {
    notes.push({ kind: 'engine-catalog-malformed', message: 'the previous engine catalog was malformed; a fresh catalog was built without history comparison' })
  }
  if (updated.length > 0) {
    notes.push({ kind: 'engine-update-available', message: `${updated.length} engine(s) have a newer upstream release: ${updated.map((e) => `${e.id} (${e.from} → ${e.to})`).join('; ')}` })
  }
  if (failed.length > 0) {
    notes.push({ kind: 'engine-check-failed', message: `${failed.length} engine source(s) could not be checked; previously recorded data was preserved where available` })
  }
  if (retained.length > 0) {
    notes.push({ kind: 'engine-retained', message: `${retained.length} engine(s) were not checked this run; previously recorded data was preserved` })
  }

  const report = {
    generatedAt: now,
    firstSeen,
    updated,
    failed,
    retained,
    notes,
    counts: {
      engines: engines.length,
      checked: fetchResults.length,
      succeeded: succeeded.length,
    },
  }

  const catalog = {
    version: 1,
    generatedAt: now,
    engines,
    lastUpdate: report,
  }

  return { engines, report, catalog, catalogWasMalformed }
}
