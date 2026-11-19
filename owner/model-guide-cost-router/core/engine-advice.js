/**
 * Engine update advice: turn a comparison verdict into a recommendation, a
 * destination, and a copy-ready investigation prompt.
 *
 * Three separate questions are answered here, and conflating them is the usual
 * way an update advisor goes wrong:
 *
 *   Is there a newer release?   engine-version.js answers this, and may answer
 *                               "unknown" — this module never overrules it.
 *   Should the owner look?      a recommendation, which is advice, not action.
 *   Who should act on it?       a destination, because installing an engine is
 *                               WorkRunner's authority and investigating one is
 *                               a DeepSeek Harness read.
 *
 * Nothing in this module installs, upgrades, downloads, or restarts anything,
 * and no recommendation grants permission to. `REQUIRES_OWNER_APPROVAL` is part
 * of every actionable recommendation for that reason.
 */

import { planReleaseComparison, isPrereleaseTag, RELEASE_COMPARISON_REASONS } from './engine-version.js'

/** The recommendation vocabulary. These three are the whole answer set. */
export const ENGINE_RECOMMENDATIONS = Object.freeze({
  /** A newer release exists and looking at it is worth the owner's time. */
  REVIEW: 'REVIEW',
  /** A newer release exists, but acting on it now is not advisable. */
  DEFER: 'DEFER',
  /** Nothing to do: up to date, or no verdict is possible. */
  NO_ACTION: 'NO_ACTION',
})

/**
 * Where a follow-up belongs. The split follows the system's authority model,
 * not preference: investigation is a read, installation is execution, and
 * hardware suitability is a Model Advisor question.
 */
export const ADVICE_DESTINATIONS = Object.freeze({
  /** Read-only investigation of release notes, changelogs, and compatibility. */
  DSH: 'DeepSeek Harness',
  /** Installing, upgrading, or rolling back — WorkRunner holds execution authority. */
  WORKRUNNER: 'WorkRunner',
  /** Whether a model fits the available GPU memory and configuration. */
  MODEL_ADVISOR: 'Model Advisor',
})

/** Why a recommendation was made. Stable keys; the UI owns the wording. */
export const ADVICE_REASONS = Object.freeze({
  NEWER_STABLE: 'newer-stable',
  NEWER_PRERELEASE: 'newer-prerelease',
  DRIVER_BELOW_MINIMUM: 'driver-below-minimum',
  DRIVER_UNKNOWN: 'driver-unknown',
  CHECK_FAILED: 'check-failed',
  CHECK_STALE: 'check-stale',
  UP_TO_DATE: 'up-to-date',
  NOT_DETECTED: 'not-detected',
  NOT_CHECKED: 'not-checked',
  INCOMPARABLE: 'incomparable',
  CONTROL_SPACE: 'control-space',
})

/** How many days a successful release check stays useful, by default. */
export const DEFAULT_ADVICE_STALE_DAYS = 7

/**
 * Plan the advice for one engine record.
 *
 * @param {object} engine a merged engine record carrying `updateAvailable`/`updateReason` or the raw version fields.
 * @param {object} [options]
 * @param {string} [options.now] ISO timestamp used for the staleness judgement.
 * @param {number} [options.maxStaleDays] defaults to DEFAULT_ADVICE_STALE_DAYS.
 * @param {string|null} [options.driverVersion] installed NVIDIA driver, when known.
 * @returns {{recommendation: string, reason: string, destination: string, requiresOwnerApproval: boolean, prerelease: boolean}}
 */
export const planEngineAdvice = (engine, options = {}) => {
  const record = /** @type {Record<string, unknown>} */ (engine ?? {})
  const maxStaleDays = typeof options.maxStaleDays === 'number' ? options.maxStaleDays : DEFAULT_ADVICE_STALE_DAYS

  // A record may carry two verdicts. When the release feed versions an
  // application rather than the engine, the meaningful verdict is the one for
  // the published engine build, and it is the one an owner can act on.
  const hasBuildVerdict = Object.hasOwn(record, 'engineUpdateAvailable')
  const verdict = hasBuildVerdict
    ? {
        updateAvailable: record['engineUpdateAvailable'] ?? null,
        reason: record['engineUpdateReason'] ?? RELEASE_COMPARISON_REASONS.CURRENT,
      }
    : (typeof record['updateAvailable'] === 'boolean' || record['updateAvailable'] === null
        ? { updateAvailable: record['updateAvailable'], reason: record['updateReason'] ?? RELEASE_COMPARISON_REASONS.CURRENT }
        : planReleaseComparison(record))

  const noAction = (reason) => ({
    recommendation: ENGINE_RECOMMENDATIONS.NO_ACTION,
    reason,
    destination: ADVICE_DESTINATIONS.DSH,
    requiresOwnerApproval: false,
    prerelease: false,
  })

  if (record['status'] === 'error') {
    return noAction(ADVICE_REASONS.CHECK_FAILED)
  }
  if (verdict.reason === RELEASE_COMPARISON_REASONS.CONTROL_SPACE) {
    return noAction(ADVICE_REASONS.CONTROL_SPACE)
  }
  if (verdict.reason === RELEASE_COMPARISON_REASONS.NOT_CHECKED) {
    return noAction(ADVICE_REASONS.NOT_CHECKED)
  }
  if (verdict.reason === RELEASE_COMPARISON_REASONS.NOT_DETECTED) {
    return noAction(ADVICE_REASONS.NOT_DETECTED)
  }
  if (verdict.reason === RELEASE_COMPARISON_REASONS.INCOMPARABLE) {
    return noAction(ADVICE_REASONS.INCOMPARABLE)
  }
  if (verdict.updateAvailable !== true) {
    return noAction(ADVICE_REASONS.UP_TO_DATE)
  }

  // From here the release is genuinely newer; only the urgency varies.
  const comparisonTag = hasBuildVerdict
    ? /** @type {string|null} */ (record['engineRelease'] ?? null)
    : /** @type {string|null} */ (record['latestRelease'] ?? null)
  const prerelease = isPrereleaseTag(
    comparisonTag,
    record['prerelease'] === true ? true : null,
  )

  const stale = () => {
    const lastCheckAt = record['lastCheckAt']
    if (typeof lastCheckAt !== 'string') return true
    const at = new Date(lastCheckAt).getTime()
    if (!Number.isFinite(at)) return true
    const nowMs = typeof options.now === 'string' ? new Date(options.now).getTime() : Date.now()
    if (!Number.isFinite(nowMs)) return true
    return nowMs - at > maxStaleDays * 24 * 60 * 60 * 1000
  }

  if (prerelease) {
    return {
      recommendation: ENGINE_RECOMMENDATIONS.DEFER,
      reason: ADVICE_REASONS.NEWER_PRERELEASE,
      destination: ADVICE_DESTINATIONS.DSH,
      requiresOwnerApproval: true,
      prerelease: true,
    }
  }
  if (stale()) {
    return {
      recommendation: ENGINE_RECOMMENDATIONS.DEFER,
      reason: ADVICE_REASONS.CHECK_STALE,
      destination: ADVICE_DESTINATIONS.DSH,
      requiresOwnerApproval: true,
      prerelease: false,
    }
  }

  // A known driver floor is the one compatibility fact this host can check
  // without guessing. Unknown stays unknown rather than being assumed safe.
  const minimum = /** @type {string|null} */ (record['minimumDriver'] ?? null)
  if (minimum !== null) {
    const installedDriver = /** @type {string|null} */ (options.driverVersion ?? null)
    if (installedDriver === null) {
      return {
        recommendation: ENGINE_RECOMMENDATIONS.DEFER,
        reason: ADVICE_REASONS.DRIVER_UNKNOWN,
        destination: ADVICE_DESTINATIONS.DSH,
        requiresOwnerApproval: true,
        prerelease: false,
      }
    }
    if (!driverSatisfies(installedDriver, minimum)) {
      return {
        recommendation: ENGINE_RECOMMENDATIONS.DEFER,
        reason: ADVICE_REASONS.DRIVER_BELOW_MINIMUM,
        destination: ADVICE_DESTINATIONS.DSH,
        requiresOwnerApproval: true,
        prerelease: false,
      }
    }
  }

  return {
    recommendation: ENGINE_RECOMMENDATIONS.REVIEW,
    reason: ADVICE_REASONS.NEWER_STABLE,
    destination: ADVICE_DESTINATIONS.DSH,
    requiresOwnerApproval: true,
    prerelease: false,
  }
}

/**
 * Compare two dotted numeric versions for "installed satisfies minimum".
 *
 * @param {string} installed
 * @param {string} minimum
 * @returns {boolean}
 */
const driverSatisfies = (installed, minimum) => {
  const left = installed.split('.').map(Number)
  const right = minimum.split('.').map(Number)
  if (left.some((part) => !Number.isFinite(part)) || right.some((part) => !Number.isFinite(part))) return false
  const width = Math.max(left.length, right.length)
  for (let i = 0; i < width; i++) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/**
 * Attach advice to every engine record.
 *
 * @param {object[]} engines engine records, ideally already carrying `updateAvailable`.
 * @param {object} [options] see planEngineAdvice.
 * @returns {object[]} new array; each record gains `advice`.
 */
export const withEngineAdvice = (engines, options = {}) => engines.map((engine) => ({
  ...engine,
  advice: planEngineAdvice(engine, options),
}))

/**
 * Build a copy-ready investigation prompt for one engine.
 *
 * The prompt is addressed to a fresh DeepSeek Harness session because the first
 * step after an update appears is reading release notes and compatibility
 * evidence — a read. The prompt says so explicitly, and it says who does the
 * install, so the reader does not carry a read grant into an execution step.
 *
 * @param {object} engine the engine record, ideally carrying `advice`.
 * @param {object} [context]
 * @param {string} [context.workspace] workspace path the session should use.
 * @param {string} [context.model] model id to recommend.
 * @param {string} [context.reasoning] reasoning level to recommend.
 * @param {object[]} [context.verifications] owner-recorded verification evidence for this engine.
 * @returns {string} a complete prompt, ready to copy.
 */
export const engineAdvicePromptText = (engine, context = {}) => {
  const record = /** @type {Record<string, unknown>} */ (engine ?? {})
  const advice = /** @type {Record<string, unknown>} */ (record['advice'] ?? {})
  const workspace = typeof context.workspace === 'string' && context.workspace.trim() !== ''
    ? context.workspace.trim()
    : 'the DeepSeek Harness checkout'
  const model = typeof context.model === 'string' && context.model.trim() !== ''
    ? context.model.trim()
    : 'ollama/deepseek-v4.1-flash'
  const reasoning = typeof context.reasoning === 'string' && context.reasoning.trim() !== ''
    ? context.reasoning.trim()
    : 'high'

  const name = String(record['displayName'] ?? record['id'] ?? 'the engine')
  const installed = record['installedVersion'] === null || record['installedVersion'] === undefined
    ? 'not detected'
    : String(record['installedVersion'])
  const latest = record['latestRelease'] === null || record['latestRelease'] === undefined
    ? 'not checked'
    : String(record['latestRelease'])
  const engineRelease = record['engineRelease'] === null || record['engineRelease'] === undefined
    ? null
    : String(record['engineRelease'])
  const releasedAt = typeof record['releasedAt'] === 'string' ? record['releasedAt'] : 'unknown'
  const recommendation = String(advice['recommendation'] ?? ENGINE_RECOMMENDATIONS.NO_ACTION)
  const reason = String(advice['reason'] ?? '')
  const destination = String(advice['destination'] ?? ADVICE_DESTINATIONS.DSH)
  const verifications = Array.isArray(context.verifications) ? context.verifications : []

  const lines = [
    `PLATFORM: DeepSeek Harness`,
    `MODE: standard`,
    `MODEL: ${model}`,
    `REASONING: ${reasoning}`,
    `SESSION: NEW`,
    `WORKSPACE: ${workspace}`,
    `ACCESS: READ`,
    ``,
    `Investigate an available update for ${name}. Do not install, upgrade, or restart anything.`,
    ``,
    `Recorded state:`,
    `- Installed version: ${installed}`,
    `- Latest upstream application release: ${latest}`,
    `- Release published: ${releasedAt}`,
  ]
  if (engineRelease !== null) {
    lines.push(`- Latest published engine build: ${engineRelease}`)
  }
  lines.push(`- Current recommendation: ${recommendation}${reason === '' ? '' : ` (${reason})`}`)

  if (record['versionSpace'] === 'control') {
    lines.push(
      `- Version spaces: this project versions its application and its engine separately.`,
      `  The upstream tag above is the application release; the installed version is the engine build.`,
      `  They are different sequences and must not be compared against each other.`,
    )
  }
  if (typeof record['releaseUrl'] === 'string' && record['releaseUrl'].startsWith('https://')) {
    lines.push(`- Release page: ${record['releaseUrl']}`)
  }
  if (typeof record['releaseNotes'] === 'string' && record['releaseNotes'].trim() !== '') {
    lines.push(``, `Release notes (excerpt supplied by the release API):`, '```', record['releaseNotes'].trim(), '```')
  }
  if (verifications.length > 0) {
    lines.push(``, `Owner-recorded verification evidence for this engine:`)
    for (const entry of verifications) {
      const item = /** @type {Record<string, unknown>} */ (entry)
      const result = item['result'] === 'passed' ? 'passed' : 'failed'
      lines.push(`- ${String(item['modelKey'] ?? 'model')} on ${String(item['engineVersion'] ?? 'unknown')}: ${result}` +
        (typeof item['evidenceNote'] === 'string' && item['evidenceNote'] !== '' ? ` — ${item['evidenceNote']}` : ''))
    }
  }

  lines.push(
    ``,
    `Determine and report:`,
    `1. What changed between the installed version and the release, from the project's own changelog or release notes.`,
    `2. Whether this host meets the release's stated requirements (driver, CUDA/runtime, Python or platform).`,
    `3. Whether any locally configured model, launch profile, or GPU boundary is affected.`,
    `4. Any regression, breaking change, or migration the release documents.`,
    `5. A recommendation: review further, defer, or no action — with the evidence for it.`,
    ``,
    `Rules:`,
    `- Read-only. Do not install, upgrade, download, restart, or reconfigure any engine, model server, or GPU.`,
    `- Do not interrupt running local model servers, active sessions, or the Strata instance.`,
    `- If a fact cannot be verified from a source, report it as unknown rather than inferring it.`,
    `- Installation is not part of this task. Execution belongs to ${ADVICE_DESTINATIONS.WORKRUNNER} and requires separate owner approval.`,
    `- Model or GPU suitability questions belong to ${ADVICE_DESTINATIONS.MODEL_ADVISOR}.`,
    ``,
    `Report your findings as text. Do not modify any file.`,
  )

  return lines.join('\n')
}
