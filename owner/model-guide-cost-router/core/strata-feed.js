/**
 * Strata engine-update feed: what the project publishes, without touching the
 * installed component directory.
 *
 * Strata's own `update --check` reads the feed but also takes a lock inside the
 * installed components directory, so on a host where that directory is not
 * writable it fails and reports a filesystem error rather than an update
 * answer. The feed itself is a plain signed JSON document over HTTPS, so this
 * module reads it directly and parses it, performing no local writes at all.
 *
 * The feed carries three separate version spaces, and they must stay separate:
 *
 *   engine.packages[].version  the inference engine build (`0.1.58`)
 *   control.version            the control component build (`0.1.58`)
 *   app.version                the desktop application release (`0.2.12`)
 *
 * The GitHub Releases API used by the engine registry tags the *application*,
 * so `latestRelease` and an installed engine build are never comparable. This
 * module supplies the engine build the feed publishes, which is the value that
 * can legitimately be compared with `strata components engine`.
 */

/** The published, signed update feed for Strata. */
export const STRATA_UPDATE_FEED_URL = 'https://github.com/Niko1221/Strata/releases/latest/download/strata-feed.json'

/**
 * Parse one Strata update feed.
 *
 * @param {string} body raw feed JSON.
 * @returns {{ok: true, sequence: number|null, channel: string|null, generatedAt: string|null, engineVersions: string[], controlVersion: string|null, appVersion: string|null, packages: {version: string, variant: string|null, platform: string|null, minDriver: string|null}[]} | {ok: false, reason: string}}
 */
export const parseStrataFeed = (body) => {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { ok: false, reason: 'the update feed was empty' }
  }
  let feed
  try {
    feed = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'the update feed was not valid JSON' }
  }
  if (feed === null || typeof feed !== 'object' || Array.isArray(feed)) {
    return { ok: false, reason: 'the update feed was not a JSON object' }
  }

  const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
  const engine = feed['engine']
  const rawPackages = engine !== null && typeof engine === 'object' && Array.isArray(engine['packages'])
    ? engine['packages']
    : []

  /** @type {{version: string, variant: string|null, platform: string|null, minDriver: string|null}[]} */
  const packages = []
  for (const entry of rawPackages) {
    if (entry === null || typeof entry !== 'object') continue
    const version = textOf(entry['version'])
    if (version === null) continue
    const minDriver = entry['min_driver']
    packages.push({
      version,
      variant: textOf(entry['variant']),
      platform: textOf(entry['platform']),
      minDriver: minDriver !== null && typeof minDriver === 'object' ? textOf(minDriver['nvidia']) : null,
    })
  }
  if (packages.length === 0) {
    return { ok: false, reason: 'the update feed publishes no engine package' }
  }

  // Highest published engine version, by the shared comparator's rules.
  const engineVersions = [...new Set(packages.map((entry) => entry.version))]
  const control = feed['control']
  const app = feed['app']
  return {
    ok: true,
    sequence: typeof feed['sequence'] === 'number' ? feed['sequence'] : null,
    channel: textOf(feed['channel']),
    generatedAt: textOf(feed['generated_at']),
    engineVersions,
    controlVersion: control !== null && typeof control === 'object' ? textOf(control['version']) : null,
    appVersion: app !== null && typeof app === 'object' ? textOf(app['version']) : null,
    packages,
  }
}

/**
 * Pick the published engine package that matches this host.
 *
 * Matching is by platform and, when the feed names one, the variant the
 * installed component already runs (`cuda13`, `cuda12`, …). A package with no
 * variant is the generic build and matches any host. When several match, the
 * first one wins, which keeps the choice deterministic for a fixed feed.
 *
 * @param {{version: string, variant: string|null, platform: string|null, minDriver: string|null}[]} packages parsed feed packages.
 * @param {{platform?: string|null, variant?: string|null}} installed the installed engine's recorded identity.
 * @returns {{version: string, variant: string|null, platform: string|null, minDriver: string|null} | null}
 */
export const selectStrataPackage = (packages, installed) => {
  const platform = installed.platform ?? null
  const variant = installed.variant ?? null
  const onPlatform = packages.filter((entry) => entry.platform === null || platform === null || entry.platform === platform)
  if (onPlatform.length === 0) return null
  if (variant !== null) {
    const exact = onPlatform.find((entry) => entry.variant === variant)
    if (exact !== undefined) return exact
  }
  return onPlatform.find((entry) => entry.variant === null) ?? null
}

/**
 * Compare a numeric driver version against a minimum from the feed.
 *
 * @param {string|null|undefined} installed installed driver version, e.g. `580.178.04`.
 * @param {string|null|undefined} minimum minimum required, e.g. `580.65`.
 * @returns {boolean|null} true when satisfied, false when not, null when unknown.
 */
export const meetsMinimumDriver = (installed, minimum) => {
  if (typeof installed !== 'string' || typeof minimum !== 'string') return null
  const left = installed.split('.').map(Number)
  const right = minimum.split('.').map(Number)
  if (left.some((part) => !Number.isFinite(part)) || right.some((part) => !Number.isFinite(part))) return null
  const width = Math.max(left.length, right.length)
  for (let i = 0; i < width; i++) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/**
 * Read the published engine build for this host out of the signed feed.
 *
 * Dependencies are injected so the same code runs in the service and in a test:
 * the caller supplies how to fetch the document, how the installed engine
 * identifies itself, and the installed driver version. Any failure answers
 * `{engineRelease: null, detail: null}` — an unreadable feed leaves the
 * previously recorded build alone rather than erasing it.
 *
 * @param {object} options
 * @param {(url: string) => Promise<{status: string, body?: unknown, fetchedAt?: string}>} options.fetchDocument bounded document fetch.
 * @param {() => Promise<{platform: string|null, variant: string|null}>} options.identity installed engine identity.
 * @param {() => Promise<string|null>} options.driverVersion installed driver version reader.
 * @param {string} options.url the feed URL.
 * @returns {Promise<{engineRelease: string|null, detail: object|null}>}
 */
export const readStrataEngineRelease = async ({ fetchDocument, identity, driverVersion, url }) => {
  const response = await fetchDocument(url)
  if (response?.status !== 'fetched' || typeof response.body !== 'string') {
    return { engineRelease: null, detail: null }
  }
  const parsed = parseStrataFeed(response.body)
  if (!parsed.ok) return { engineRelease: null, detail: null }
  const chosen = selectStrataPackage(parsed.packages, await identity())
  if (chosen === null) return { engineRelease: null, detail: null }
  const driver = await driverVersion()
  return {
    engineRelease: chosen.version,
    detail: {
      variant: chosen.variant,
      platform: chosen.platform,
      minimumDriver: chosen.minDriver,
      driverVersion: driver,
      driverSatisfied: meetsMinimumDriver(driver, chosen.minDriver),
      controlVersion: parsed.controlVersion,
      appVersion: parsed.appVersion,
      sequence: parsed.sequence,
      feedUrl: url,
      fetchedAt: response.fetchedAt ?? null,
    },
  }
}

/**
 * Read the NVIDIA driver version from sysfs text.
 *
 * @param {string} text contents of `/sys/module/nvidia/version`.
 * @returns {string|null}
 */
export const parseDriverVersion = (text) => {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed.length === 0 ? null : trimmed
}
