/**
 * Host half of the Model Guide & Cost Router bundle.
 *
 * Reuses the existing Harness surfaces only: `ctx.llm` for the live
 * provider/model inventory (the same discovery the GUI uses) and `ctx.tools`
 * for the read-only agent tools. The Host service is registered with
 * `ctx.reflect.provide` plus Typert SRC markers so the Client page calls the
 * same read endpoints the agent tools call. Owner files under the configured
 * model-guidance directory are read/written with plain node fs, scoped to that
 * directory; nothing here launches, stops, switches, or reconfigures any model
 * or GPU, and nothing under ~/.dsh is touched.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath, sep } from 'node:path'

import { calculateActualCost, priceFreshness } from './core/cost.js'
import { generatedGuideText, routingGuideText } from './core/guides.js'
import { guidanceText } from './core/guidance-text.js'
import { overlay, validateOwnerMetadata } from './core/overlay.js'
import { recommendForTask } from './core/recommend.js'
import { modelKey } from './core/catalog.js'
import { snapshotRecord, applyUpdate } from './core/update.js'
import { ENGINE_SOURCES, applyEngineUpdate } from './core/engine-update.js'
import { mergeVerificationsIntoEngines } from './core/engine-verification.js'
import { withReleaseComparison } from './core/engine-version.js'
import { mergeLaunchProfilesIntoEngines } from './core/launch-profile.js'
import { createGuidanceTools } from './core/tools.js'
import { composeRecommendation } from './core/composed.js'
import { createAutoRoute } from './core/auto-routing.js'
import { unresolvedModels, proposeResearcher, researchPromptText, scopeUnresolvedModels, RESEARCH_SCOPES } from './core/research.js'
import { validateResearchResults } from './core/research-import.js'
import { parseOllamaModelPricing, mapOllamaRates, rateRecordFromRow } from './core/ollama-pricing.js'
import { factsFromShowRecord, modelNamesFromTags, planFactMerge } from './core/ollama-metadata.js'
import { factsFromModelsListing, planRouteCapabilities } from './core/route-capabilities.js'
import { createAutoRefresh } from './core/auto-refresh.js'
import { detectEngineVersion, detectStrataEngineIdentity } from './core/engine-detect.js'
import { parseDriverVersion, readStrataEngineRelease, STRATA_UPDATE_FEED_URL } from './core/strata-feed.js'
import { withEngineAdvice, engineAdvicePromptText, ENGINE_RECOMMENDATIONS } from './core/engine-advice.js'

/** The protocol constant Typert stores Remote markers under (plain-JS form of the `@Remote` decorator). */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
/** The service key the Host registers; the Typert wire namespace defaults to it. */
const SERVICE_KEY = 'modelGuide'

const DEFAULT_MAX_PRICE_AGE_DAYS = 90
const DEFAULT_PROVIDER_QUERY_TIMEOUT_MS = 4000
const DEFAULT_PROVIDER_CACHE_MS = 60_000
const DEFAULT_FETCH_TIMEOUT_MS = 8000
const DEFAULT_MAX_CATALOG_HISTORY = 5
const DEFAULT_MAX_ENGINE_CHECK_AGE_DAYS = 7
const DEFAULT_OLLAMA_BASE_URL = 'https://ollama.com'
/**
 * The profile row that owns the provider routes. Its hierarchical id is
 * `include/llm-pi-ai`; the stable name inside that tree is what identifies it.
 */
const PROVIDER_ENTRY_ID = 'llm-pi-ai'
/** How many metadata lookups run at once; the provider is a public endpoint. */
const METADATA_CONCURRENCY = 4
/**
 * Automatic refresh is OFF until the owner turns it on. Recurring network
 * traffic is a runtime behaviour the owner authorizes, not a default a plugin
 * starts emitting on activation.
 */
const DEFAULT_AUTO_REFRESH_INTERVAL_HOURS = 6
/**
 * Engine release checks default to daily. Releases arrive on a weekly-to-monthly
 * cadence, and the check costs six GitHub requests, so a day is ample; the six
 * hour model refresh is a different question with a different rate.
 */
const DEFAULT_ENGINE_CHECK_INTERVAL_HOURS = 24
/** How long a research-review token (Step 3 authorization) stays valid. */
const REVIEW_TTL_MS = 30 * 60 * 1000

/** Remote methods the service exports; the wire namespace defaults to the service key. */
const REMOTE_METHODS = [
  'snapshot',
  'guidanceText',
  'actualCost',
  'recommendModels',
  'updateModelsAndPricing',
  'lastUpdateReport',
  'generatedGuide',
  'routingGuide',
  'customizationStatus',
  'researchStatus',
  'researchPrompt',
  'previewResearchResults',
  'applyResearchResults',
  'engineCatalog',
  'updateEngines',
  'refreshModelMetadata',
  'autoRefreshStatus',
  'syncRouteCapabilities',
]

/**
 * Validate one deployment-provided config value; absent fields fall back to a
 * documented default, anything malformed fails loudly here at activation.
 * @param {Record<string, unknown>} value raw row config.
 * @returns {object} the validated config.
 */
const validateConfig = (value) => {
  const raw = value === undefined || value === null ? {} : value
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('model-guide: config must be a JSON object')
  const ownerMetadataPath = raw['ownerMetadataPath']
  if (typeof ownerMetadataPath !== 'string' || ownerMetadataPath.trim().length === 0) {
    throw new TypeError('model-guide: config ownerMetadataPath must be a non-empty string')
  }
  /**
   * @param {string} name
   * @param {number} fallback
   * @returns {number}
   */
  const readPositiveInt = (name, fallback) => {
    const given = raw[name]
    if (given === undefined) return fallback
    if (typeof given !== 'number' || !Number.isFinite(given) || given <= 0) {
      throw new TypeError(`model-guide: config ${name} must be a positive number`)
    }
    return given
  }
  /**
   * Read one optional absolute-path config field into the owner directory.
   * @param {string} name
   * @param {string} fallback
   * @returns {string}
   */
  const readOwnerPath = (name, fallback) => {
    const given = raw[name]
    const candidate = given === undefined ? fallback : String(given).trim()
    if (candidate.length === 0 || !candidate.startsWith('/')) {
      throw new TypeError(`model-guide: config ${name} must be an absolute host path`)
    }
    const ownerDir = resolvePath(dirname(ownerMetadataPath))
    if (!resolvePath(candidate).startsWith(ownerDir + sep)) {
      throw new TypeError(`model-guide: config ${name} must stay inside the owner metadata directory ${ownerDir}`)
    }
    return candidate
  }
  /**
   * Read one optional cross-bundle absolute-path config field. Unlike
   * readOwnerPath, this does not enforce the owner-directory containment
   * rule — it is for paths that intentionally reference files outside the
   * owner metadata directory, such as a shared cache written by another bundle.
   * @param {string} name
   * @returns {string}
   */
  const readOptionalAbsPath = (name) => {
    const given = raw[name]
    if (given === undefined || given === null || String(given).trim().length === 0) return ''
    const candidate = String(given).trim()
    if (!candidate.startsWith('/')) {
      throw new TypeError(`model-guide: config ${name} must be an absolute path`)
    }
    return candidate
  }
  /**
   * Read one optional non-empty string, or undefined when it is not set.
   * @param {string} name
   * @returns {string|undefined}
   */
  const readOptionalString = (name) => {
    const given = raw[name]
    if (given === undefined || given === null) return undefined
    if (typeof given !== 'string') throw new TypeError(`model-guide: config ${name} must be a string`)
    const candidate = given.trim()
    return candidate.length === 0 ? undefined : candidate
  }
  /**
   * @param {string} name
   * @param {boolean} fallback
   * @returns {boolean}
   */
  const readBoolean = (name, fallback) => {
    const given = raw[name]
    if (given === undefined) return fallback
    if (typeof given !== 'boolean') throw new TypeError(`model-guide: config ${name} must be true or false`)
    return given
  }
  /**
   * @param {string} name
   * @param {number} fallback
   * @returns {number}
   */
  const readPositiveNumber = (name, fallback) => {
    const given = raw[name]
    if (given === undefined) return fallback
    if (typeof given !== 'number' || !Number.isFinite(given) || given <= 0) {
      throw new TypeError(`model-guide: config ${name} must be a positive number`)
    }
    return given
  }
  /**
   * Read one optional provider base URL. https only: the enrichment talks to a
   * public endpoint and must never be pointed at a plaintext or loopback
   * service by a config typo.
   * @param {string} name
   * @param {string} fallback
   * @returns {string}
   */
  const readBaseUrl = (name, fallback) => {
    const given = raw[name]
    if (given === undefined) return fallback
    if (typeof given !== 'string' || !/^https:\/\//.test(given.trim())) {
      throw new TypeError(`model-guide: config ${name} must be an https URL`)
    }
    return given.trim().replace(/\/$/, '')
  }
  const pricingProviderIdRaw = raw['pricingProviderId']
  if (pricingProviderIdRaw !== undefined && (typeof pricingProviderIdRaw !== 'string' || pricingProviderIdRaw.trim().length === 0)) {
    throw new TypeError('model-guide: config pricingProviderId must be a non-empty provider id')
  }
  const pricingCheckUrls = raw['pricingCheckUrls']
  if (pricingCheckUrls !== undefined) {
    if (!Array.isArray(pricingCheckUrls) || pricingCheckUrls.some((url) => typeof url !== 'string' || !/^https:\/\//.test(url))) {
      throw new TypeError('model-guide: config pricingCheckUrls must be a list of https URLs')
    }
  }
  return {
    ownerMetadataPath: ownerMetadataPath.trim(),
    catalogPath: readOwnerPath('catalogPath', `${dirname(ownerMetadataPath).replace(/\/$/, '')}/model-catalog.json`),
    guideGeneratedPath: readOwnerPath('guideGeneratedPath', `${dirname(ownerMetadataPath).replace(/\/$/, '')}/MODEL_GUIDE.generated.md`),
    ...(pricingCheckUrls === undefined ? {} : { pricingCheckUrls: pricingCheckUrls.map((url) => String(url).trim()) }),
    pricingProviderId: pricingProviderIdRaw === undefined ? 'ollama' : pricingProviderIdRaw.trim(),
    customizationStatusPath: raw['customizationStatusPath'] === undefined
      ? undefined
      : String(raw['customizationStatusPath']).trim(),
    maxPriceAgeDays: readPositiveInt('maxPriceAgeDays', DEFAULT_MAX_PRICE_AGE_DAYS),
    providerQueryTimeoutMs: readPositiveInt('providerQueryTimeoutMs', DEFAULT_PROVIDER_QUERY_TIMEOUT_MS),
    providerCacheMs: readPositiveInt('providerCacheMs', DEFAULT_PROVIDER_CACHE_MS),
    fetchTimeoutMs: readPositiveInt('fetchTimeoutMs', DEFAULT_FETCH_TIMEOUT_MS),
    maxCatalogHistory: readPositiveInt('maxCatalogHistory', DEFAULT_MAX_CATALOG_HISTORY),
    engineCatalogPath: readOwnerPath('engineCatalogPath', `${dirname(ownerMetadataPath).replace(/\/$/, '')}/engine-catalog.json`),
    maxEngineCheckAgeDays: readPositiveInt('maxEngineCheckAgeDays', DEFAULT_MAX_ENGINE_CHECK_AGE_DAYS),
    localDiscoveryCachePath: readOptionalAbsPath('localDiscoveryCachePath'),
    // Metadata enrichment and automatic refresh. Both are opt-in-shaped: the
    // enrichment has an endpoint but no background traffic of its own, and the
    // refresh timer only runs when the owner sets autoRefresh: true.
    ollamaBaseUrl: readBaseUrl('ollamaBaseUrl', DEFAULT_OLLAMA_BASE_URL),
    metadataEnrichment: readBoolean('metadataEnrichment', true),
    autoRefresh: readBoolean('autoRefresh', false),
    autoRefreshHours: readPositiveNumber('autoRefreshHours', DEFAULT_AUTO_REFRESH_INTERVAL_HOURS),
    refreshOnActivation: readBoolean('refreshOnActivation', true),
    // Engine release checks run on their own schedule: releases arrive weekly to
    // monthly, so a daily check is ample, and coupling it to the model refresh
    // would either over-poll GitHub or under-check the engines.
    engineCheck: readBoolean('engineCheck', true),
    engineCheckHours: readPositiveNumber('engineCheckHours', DEFAULT_ENGINE_CHECK_INTERVAL_HOURS),
    // The copy-ready investigation prompt states which model and reasoning level
    // to run under. These are deployment choices, so they are config fields
    // rather than constants baked into the prompt text.
    advicePromptWorkspace: readOptionalString('advicePromptWorkspace'),
    advicePromptModel: readOptionalString('advicePromptModel'),
    advicePromptReasoning: readOptionalString('advicePromptReasoning'),
    // Automatic routing. Both default off: replacing the model a request would
    // use, or asking the owner a per-task question, are runtime behaviours the
    // owner authorizes, not defaults a plugin starts on activation.
    autoSwitch: readBoolean('autoSwitch', false),
    autoRouteAsk: readBoolean('autoRouteAsk', false),
    autoRouteAskTimeoutMs: readPositiveInt('autoRouteAskTimeoutMs', 60_000),
    // The owner's Qwen3.8 GPU rule: Qwen3.8 27B may run ONLY on a verified
    // RTX 3090 (non-Ti) provider route, never the RTX 3090 Ti. Reads as a
    // non-empty string or a list of non-empty strings; anything else fails
    // loud at activation. The default names this deployment's verified route.
    qwen38Providers: readProviderList('qwen38Providers', ['qwen-local-3090']),
  }
  /**
   * Read a provider id or provider id list; at least one non-empty entry.
   * @param {string} name
   * @param {string[]} fallback
   * @returns {string[]}
   */
  function readProviderList(name, fallback) {
    const given = raw[name]
    const list = given === undefined ? fallback
      : typeof given === 'string' ? [given]
      : Array.isArray(given) ? given
      : undefined
    if (list === undefined || !list.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
      throw new TypeError(`model-guide: config ${name} must be a provider id or a non-empty list of provider ids`)
    }
    return list.map((entry) => entry.trim())
  }
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'local.model-guide-cost-router',
    /** Synchronous standard-schema validation; the Loader rejects issues loudly. */
    validate(value) {
      try {
        return { value: validateConfig(/** @type {Record<string, unknown>} */ (value)) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}

export const inject = ['llm', 'tools']

/**
 * Service exposing the read endpoints and the staged update flow. A plain-JS
 * class: its prototype carries the Typert Remote markers and the instance
 * carries the frozen `typertRemote` binding the Gateway's SRC fallback reads.
 * No member can touch request streaming or model lifecycle.
 */
class ModelGuideService {
  /** Single-use research-review tokens: reviewId → bound canonical facts. */
  #reviews = new Map()
  /**
   * @param {object} state dependencies and caches captured from the apply closure.
   */
  constructor(state) {
    /** The frozen binding the Gateway reads; the SRC fallback requires these exact fields. */
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE_KEY, namespace: SERVICE_KEY })
    this.state = state
  }

  /** Read one merged inventory snapshot; provider facts degrade to Unknown. */
  async snapshot(signal) {
    const { state } = this
    const { config } = state
    const [owner, discovered] = await Promise.all([
      state.readOwnerMetadata(signal),
      state.discover(signal),
    ])
    const merged = state.mergeSnapshot(owner, discovered, config)
    return { ...merged, ...(discovered.localFiles !== undefined ? { localFiles: discovered.localFiles } : {}) }
  }

  /**
   * Shared merge step so every path (snapshot, guides, tools) sees one
   * consistent merged shape.
   */
  #merge(owner, discovered) {
    return this.state.mergeSnapshot(owner, discovered, this.state.config)
  }

  /**
   * All merged rows in one list.
   * @param {object} snapshot a merged snapshot.
   * @returns {Array<object>} live rows first, curated-only rows after.
   */
  #rows(snapshot) {
    return [
      ...snapshot.providers.flatMap((providerData) => providerData.models),
      ...snapshot.curatedOnly,
    ]
  }

  /** Canonical deterministic text for one exact model; an Unknown model stays Unknown. */
  async guidanceText(provider, model) {
    const snapshot = await this.snapshot(undefined)
    const row = this.#rows(snapshot).find((candidate) => candidate.provider === provider
      && (candidate.id === model || candidate.name === model))
    if (row === undefined) {
      return 'Unknown model: no live provider or owner-curated entry matches '
        + `${provider}/${model}. Nothing was guessed; run list_model_guidance to see detected models.`
    }
    return guidanceText(row, snapshot.routingRule)
  }

  /** Pure actual-cost math over one real usage report and the stored rates. */
  async actualCost(request) {
    const providerName = typeof request?.provider === 'string' ? request.provider : ''
    const modelId = typeof request?.model === 'string' ? request.model : ''
    const snapshot = await this.snapshot(undefined)
    const row = this.#rows(snapshot).find((candidate) => candidate.provider === providerName && candidate.id === modelId)
    if (row === undefined) {
      return { status: 'invalid_usage', reason: `no discovered or owner-curated row matches ${providerName}/${modelId}`, breakdown: { portions: [], unknown: [] } }
    }
    return calculateActualCost(row.pricing ?? {}, typeof request?.usage === 'object' && request.usage !== null ? request.usage : {})
  }

  /** Advisory ordered shortlist for one task under the owner routing rule. */
  async recommendModels(task) {
    const snapshot = await this.snapshot(undefined)
    const result = recommendForTask(this.#rows(snapshot), typeof task === 'string' ? task : '')
    return {
      rule: snapshot.routingRule,
      advisoryOnly: 'The owner keeps control of the actual model choice; nothing here selects, launches, stops, or switches a model.',
      ...(snapshot.routingRule === null ? { needsReview: ['routingRule'] } : {}),
      unreviewedCount: result.unreviewedCount,
      shortlist: result.order.map((item) => ({
        provider: item.row.provider,
        model: item.row.id,
        name: item.row.name,
        localVsCloud: item.row.localVsCloud,
        unreviewed: item.unreviewed,
        ...(item.why.length === 0 ? {} : { reasoning: item.why }),
        ...(item.row.reasoning?.recommendedRoutine === undefined ? {} : { recommendedRoutine: item.row.reasoning.recommendedRoutine }),
        ...(item.row.pricing?.costTier === undefined ? {} : { costTier: item.row.pricing.costTier }),
      })),
    }
  }

  /**
   * One composed answer to "which model should I use for this task?".
   *
   * Three sources, each read through the seam that owns it: installed truth and
   * GPU facts from Local Model Manager, guidance and cost ordering from this
   * plugin, hardware fit from the llmfit advisor. Both peer services are
   * optional; an absent one degrades to an explicit status rather than letting
   * the answer look complete.
   *
   * @param {string} task what the caller is about to do.
   * @param {string} [useCase] hardware-fit workload class; omitted means no fit advisory is requested.
   * @returns {Promise<object>} the composed recommendation document.
   */
  async recommendForWorkload(task, useCase) {
    const snapshot = await this.snapshot(undefined)
    const result = recommendForTask(this.#rows(snapshot), typeof task === 'string' ? task : '')

    const manager = this.state.localModelManager()
    let installedModels = null
    let gpus = []
    let installedUnavailableReason
    if (manager === undefined) {
      installedUnavailableReason = 'the Local Model Manager service is not present in this deployment'
    } else {
      try {
        const view = await manager.snapshot()
        if (Array.isArray(view?.models)) {
          installedModels = view.models
          if (Array.isArray(view.gpus)) gpus = view.gpus
        } else {
          installedUnavailableReason = 'the Local Model Manager snapshot did not include a model list'
        }
      } catch (error) {
        installedUnavailableReason = `the Local Model Manager snapshot failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    const advisor = this.state.llmfitAdvisor()
    let fit = null
    if (useCase !== undefined) {
      if (advisor === undefined) {
        fit = { status: 'unavailable', error: 'the llmfit advisor service is not present in this deployment' }
      } else {
        try {
          fit = await advisor.recommend({ useCase })
        } catch (error) {
          fit = { status: 'unavailable', error: `the llmfit advisor failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
    }

    return composeRecommendation({
      task: typeof task === 'string' ? task : '',
      ...(useCase === undefined ? {} : { useCase }),
      order: result.order,
      installedModels,
      gpus,
      fit,
      ...(installedUnavailableReason === undefined ? {} : { installedUnavailableReason }),
    })
  }

  /**
   * The staged Update Models & Pricing flow: rescan → diff → verify → record.
   * Rescans discovery fresh (cache bypassed), diffs against the saved catalog,
   * captures official pricing pages, refreshes verified provider rates from the
   * official structured table when confidently parsed (fail-closed: any
   * parse/mapping/write failure retains previous prices), records newly
   * detected uncurated models as Research Needed, then writes the catalog and
   * the regenerated guide. Owner reasoning settings and recommendations are
   * never corrected by this flow.
   */
  async updateModelsAndPricing() {
    const { state } = this
    const { config } = state
    const owner = await state.readOwnerMetadata(undefined)
    // Force a fresh scan past any cache.
    state.cache = undefined
    const discovered = await state.discover(undefined)
    const previous = await state.readJsonFile(config.catalogPath)
    const attempts = []
    for (const url of config.pricingCheckUrls ?? []) {
      attempts.push({ url, result: await state.fetchPageSnapshot(url) })
    }
    const snapshots = attempts.map(({ url, result }) => snapshotRecord(result))
    const now = new Date().toISOString()
    const freshness = (rates) => priceFreshness(rates, { maxAgeDays: config.maxPriceAgeDays })
    // Verified official-rate refresh: parse the fetched official pages, map
    // rates onto the configured provider's ids by exact match only, apply to
    // EXISTING owner entries only, and retain everything previous on any
    // parse/mapping/write failure (fail closed).
    const { pricingRefresh, ownerPricingWrite } = await this.#refreshOfficialPricing({
      attempts,
      owner: owner.data,
      providerId: config.pricingProviderId,
      discovered: discovered.providers,
      now,
    })
    // Newly detected models with no owner curation become Research Needed
    // records; nothing about them is curated automatically.
    const researchNeeded = discovered.providers.flatMap((providerData) =>
      providerData.models
        .filter((model) => owner.data?.models?.[modelKey(providerData.id, model.id)] === undefined)
        .map((model) => ({
          key: modelKey(providerData.id, model.id),
          name: model.name,
          fields: ['deployment (local vs cloud)', 'modalities (input types)', 'reasoning support (efforts list)',
            'native/default reasoning behavior', 'context size', 'tool/function-calling support',
            'pricing (input / cached-input / output USD per 1M tokens from the official source, with verifiedAt)'],
        })))
    const { catalog, report, catalogWasMalformed } = applyUpdate({
      previousRaw: previous.value,
      discovered: discovered.providers,
      ownerData: owner.data,
      freshness,
      snapshots,
      pricingRefresh,
      researchNeeded,
      now,
      maxHistory: config.maxCatalogHistory,
    })
    const guideText = generatedGuideText(this.#merge(owner, discovered))
    const written = await state.writeCatalogAndGuide(config.catalogPath, config.guideGeneratedPath, JSON.stringify(catalog, null, 2) + '\n', guideText)
    return {
      report: {
        ...report,
        // An unreadable catalog directory is worth its own named note;
        // missing/malformed catalogs are already named by the update core.
        ...(previous.status === 'unreadable' ? { notes: [
          { kind: 'catalog-unreadable', message: `the previous catalog file could not be read (${previous.error ?? 'unknown error'}); a fresh catalog was written without history comparison` },
          ...report.notes,
        ] } : {}),
      },
      written: {
        catalogPath: config.catalogPath,
        guidePath: config.guideGeneratedPath,
        ...(written.catalog === 'failed' || written.guide === 'failed' ? { writeErrors: [
          ...(written.catalog === 'failed' ? [{ path: config.catalogPath }] : []),
          ...(written.guide === 'failed' ? [{ path: config.guideGeneratedPath }] : []),
        ] } : {}),
      },
    }
  }

  /**
   * Parse fetched official pricing pages and apply confidently-mapped rates to
   * existing owner entries. One parsed source wins; a schema/parse failure, a
   * mapping failure, or a metadata write failure retains every previous
   * verified price (fail closed). Price changes are computed against the
   * pre-refresh rates and reported per model key.
   * @param {{attempts: {url: string, result: {status: string, body?: string}}[], owner: {models?: Record<string, object>}, providerId: string, discovered: {id: string, models: {id: string}[]}[], now: string}} input
   * @returns {Promise<{pricingRefresh: object, ownerPricingWrite: 'ok'|'skipped'|'failed'}>}
   */
  async #refreshOfficialPricing({ attempts, owner, providerId, discovered, now }) {
    /** @type {{status: 'updated'|'retained'|'failed', source?: string, verifiedAt?: string, reason?: string, changed: object[], unmapped: string[], ambiguous: {id: string, reason: string}[]}} */
    const pricingRefresh = { status: 'retained', reason: undefined, changed: [], unmapped: [], ambiguous: [] }
    const parseFailures = attempts.filter(({ result }) => result.status !== 'fetched')
    for (const { url, result } of attempts) {
      if (result.status !== 'fetched') continue
      const parsed = parseOllamaModelPricing(result.body ?? '')
      if (!parsed.ok) {
        parseFailures.push({ url, result: { status: 'failed', error: parsed.reason } })
        continue
      }
      const providerRow = discovered.find((candidate) => candidate.id === providerId)
      if (providerRow === undefined) {
        return {
          pricingRefresh: { ...pricingRefresh, status: 'failed', source: url, reason: `the "${providerId}" provider was not listed this update; no rates were changed` },
          ownerPricingWrite: 'skipped',
        }
      }
      const mapping = mapOllamaRates(parsed.table, providerRow.models.map((model) => model.id))
      const ownerModels = owner?.models ?? {}
      const ratesByOwnerKey = {}
      const changed = []
      for (const [id, mapped] of Object.entries(mapping.mapped)) {
        const key = modelKey(providerId, id)
        /** @type {any} */ const entry = ownerModels[key]
        if (entry === undefined || typeof entry !== 'object') continue // never curate a new owner entry
        const rates = rateRecordFromRow(mapped, url, now)
        const previous = /** @type {any} */ (entry).pricing ?? {}
        const fieldChanges = []
        for (const field of /** @type {const} */ (['inputPerMTok', 'cachedInputPerMTok', 'outputPerMTok'])) {
          if (previous[field] !== rates[field]) {
            fieldChanges.push({ field, from: previous[field] ?? null, to: rates[field] ?? null })
          }
        }
        // Structured fields flatten to per-rate scalar diffs so no renderer
        // ever stringifies an object.
        const previousOffPeak = previous['offPeak'] ?? null
        const nextOffPeak = rates['offPeak'] ?? null
        if (JSON.stringify(previousOffPeak) !== JSON.stringify(nextOffPeak)) {
          for (const sub of ['inputPerMTok', 'cachedInputPerMTok', 'outputPerMTok']) {
            const from = previousOffPeak === null ? null : previousOffPeak[sub] ?? null
            const to = nextOffPeak === null ? null : nextOffPeak[sub] ?? null
            if (from !== to) fieldChanges.push({ field: `offPeak.${sub}`, from, to })
          }
        }
        ratesByOwnerKey[key] = rates
        changed.push({ key, changes: fieldChanges })
      }
      if (Object.keys(ratesByOwnerKey).length === 0) {
        return {
          pricingRefresh: { ...pricingRefresh, status: 'retained', source: url,
            reason: 'no owner-curated models matched the published table by exact name; nothing was changed' },
          ownerPricingWrite: 'skipped',
        }
      }
      const write = await this.state.applyOwnerPricing(ratesByOwnerKey)
      if (write === 'failed') {
        return {
          pricingRefresh: { ...pricingRefresh, status: 'failed', source: url, reason: 'the owner metadata file could not be read or written; all previous verified prices were retained' },
          ownerPricingWrite: 'failed',
        }
      }
      return {
        pricingRefresh: {
          status: 'updated',
          source: url,
          verifiedAt: now,
          ...(parsed.offPeakNote === undefined ? {} : { offPeakNote: parsed.offPeakNote }),
          changed: changed.filter((entry) => entry.changes.length > 0),
          unmapped: mapping.unmatched,
          ambiguous: mapping.ambiguous,
        },
        ownerPricingWrite: 'ok',
      }
    }
    const firstFailure = parseFailures[0]
    return {
      pricingRefresh: attempts.length === 0
        ? { ...pricingRefresh, reason: 'no pricing source is configured' }
        : parseFailures.length === attempts.length
          ? { ...pricingRefresh, status: 'failed', reason: firstFailure === undefined ? 'no official page could be fetched' : `the official pricing source could not be verified: ${firstFailure.url} — ${firstFailure.result.error ?? 'fetch failed'}` }
          : { ...pricingRefresh, reason: 'no fetched page contained a parseable official model-pricing table' },
      ownerPricingWrite: 'skipped',
    }
  }

  /**
   * Read the provider's own metadata for every configured Ollama model and
   * write the verified capability facts onto owner entries.
   *
   * The provider is the authority on its own model: context length, input
   * modalities, tool support and the published reasoning levels all come from
   * `POST /api/show`. Nothing is inferred, and no subjective field — strengths,
   * avoid, recommendations — is ever written here.
   *
   * Owner curation wins per field. `planFactMerge` keeps a deliberately
   * recorded `nativeReasoningDefault` and fills only what is missing, so an
   * audited entry such as `ollama/kimi-k3` is refreshed with new provider
   * facts without losing its hand-written judgements.
   *
   * Bounded on every axis: at most `METADATA_CONCURRENCY` lookups at once, one
   * `fetchTimeoutMs` per request, and a failed model is named in the report
   * rather than aborting the batch.
   * @param {object|undefined} request optional `{models?: string[]}` to limit the sweep.
   * @returns {Promise<object>} a per-model report of what was filled, kept, or failed.
   */
  async refreshModelMetadata(request) {
    const { state } = this
    const { config } = state
    if (config.metadataEnrichment !== true) {
      return { status: 'disabled', reason: 'metadata enrichment is turned off in this deployment', models: [] }
    }
    const owner = await state.readOwnerMetadata(undefined)
    const ownerModels = owner.data?.models ?? {}
    const base = config.ollamaBaseUrl
    const now = new Date().toISOString()
    const provenance = {
      source: `${base}/api/show`,
      verifiedAt: now,
      // The configured provider whose base URL is the official Ollama service
      // is a cloud deployment; anything else is treated as not-cloud.
      cloud: true,
    }
    // Which models to sweep: the request's list when given, otherwise every
    // owner entry plus every live Ollama model the provider lists.
    const requested = Array.isArray(request?.models)
      ? request.models.filter((id) => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
      : undefined
    const tags = await state.fetchJson(`${base}/api/tags`)
    const listed = tags.status === 'ok' ? modelNamesFromTags(tags.value) : []
    const ownerIds = Object.keys(ownerModels)
      .filter((key) => key.startsWith(`${config.pricingProviderId}/`))
      .map((key) => key.slice(config.pricingProviderId.length + 1))
    const candidates = requested ?? [...new Set([...ownerIds, ...listed])]
    if (candidates.length === 0) {
      return {
        status: 'nothing-to-do',
        reason: 'no Ollama model is curated or listed, so there is no metadata to read',
        source: base,
        verifiedAt: now,
        models: [],
        ...(tags.status === 'ok' ? {} : { tagsError: tags.error }),
      }
    }
    /** @type {{key: string, model: string, status: 'filled'|'unchanged'|'failed', filled: string[], kept: object[], reason?: string}[]} */
    const results = []
    const limit = Math.max(1, Math.min(METADATA_CONCURRENCY, 8))
    let cursor = 0
    const worker = async () => {
      while (cursor < candidates.length) {
        const model = candidates[cursor]
        cursor += 1
        const key = `${config.pricingProviderId}/${model}`
        const show = await state.fetchJson(`${base}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })
        if (show.status !== 'ok') {
          results.push({ key, model, status: 'failed', filled: [], kept: [], reason: show.error ?? 'the provider did not answer' })
          continue
        }
        const facts = factsFromShowRecord(show.value, provenance)
        const plan = planFactMerge(ownerModels[key], facts)
        // `plan.accepted` is keyed by OWNER field and carries the fact name, so
        // the write lands where the merge reads it back.
        const filled = Object.keys(plan.accepted)
        // Report both values, not just prose about them: the panel shows the
        // discrepancy so the owner can decide, and a sentence alone would make
        // them retype what the provider published to compare it.
        const kept = plan.kept.map((row) => ({
          field: row.field,
          recorded: row.recorded,
          published: row.published,
          reason: `recorded ${JSON.stringify(row.recorded)}; the provider now publishes ${JSON.stringify(row.published)} — kept because a recorded value is an audit result, not a cache`,
        }))
        if (filled.length === 0) {
          results.push({
            key, model, status: 'unchanged', filled: [], kept,
            reason: kept.length === 0
              ? 'every fact this model publishes is already recorded and agrees with the provider'
              : 'every field the provider publishes is already recorded; disagreeing values are reported, never overwritten',
          })
          continue
        }
        const write = await state.applyOwnerFacts({ [key]: Object.fromEntries(Object.entries(plan.accepted).map(([field, payload]) => [field, payload.value])) })
        if (write !== 'ok') {
          results.push({ key, model, status: 'failed', filled: [], kept, reason: 'the owner metadata file could not be written; recorded values were retained' })
          continue
        }
        results.push({ key, model, status: 'filled', filled, kept })
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, candidates.length) }, worker))
    const filledCount = results.filter((row) => row.status === 'filled').length
    const failed = results.filter((row) => row.status === 'failed')
    return {
      status: failed.length === results.length ? 'failed' : filledCount > 0 ? 'updated' : 'unchanged',
      source: base,
      verifiedAt: now,
      ...(tags.status === 'ok' ? {} : { tagsError: tags.error ?? 'the model list could not be read' }),
      filled: filledCount,
      unchanged: results.filter((row) => row.status === 'unchanged').length,
      failedCount: failed.length,
      models: results.sort((a, b) => a.key.localeCompare(b.key)),
      ...(failed.length > 0 ? { reason: `${failed.length} of ${results.length} models could not be read from the provider` } : {}),
      note: 'Only provider-published capability facts are written. Strengths, avoid notes, and recommendations stay owner-authored.',
    }
  }

  /**
   * Transfer provider-confirmed capabilities into the configured provider route.
   *
   * The route's `models:` list replaces the installed catalog, so an entry that
   * declares only `id` and `name` serves the deployment fallbacks — 262,144
   * context and text-only input — as though the provider had said so. This
   * method reads what the provider actually publishes and fills only the fields
   * the owner left absent, through the profile configuration editor.
   *
   * Nothing is overwritten. A value the owner recorded — including an explicit
   * `false` or a deliberately capped window — is an audit result, so a
   * disagreement is reported as a conflict for the owner to resolve. A field
   * the provider does not publish stays absent, which the route reports as
   * unknown rather than defaulting to a claim.
   * @param {object|undefined} request optional `{apply?: boolean, provider?: string}`.
   * @returns {Promise<object>} the plan, what was written, and the conflicts found.
   */
  async syncRouteCapabilities(request) {
    const { state } = this
    const { config } = state
    const editor = state.editor?.()
    if (editor === undefined || typeof state.entry !== 'function' || typeof state.entryRoute !== 'function'
      || typeof state.applyRouteConfig !== 'function') {
      return {
        status: 'unavailable',
        reason: 'this deployment has no configuration editor, so the provider route cannot be updated',
        changed: [],
        conflicts: [],
      }
    }
    const providerId = typeof request?.provider === 'string' && request.provider.trim().length > 0
      ? request.provider.trim()
      : config.pricingProviderId
    const entry = state.entry(providerId)
    if (entry === undefined) {
      return {
        status: 'unavailable',
        reason: `no provider route named "${providerId}" is configured in this profile`,
        changed: [],
        conflicts: [],
      }
    }
    const base = config.ollamaBaseUrl
    const listing = await state.fetchJson(`${base}/v1/models`)
    if (listing.status !== 'ok') {
      return {
        status: 'failed',
        reason: `the provider listing could not be read: ${listing.error}`,
        source: `${base}/v1/models`,
        changed: [],
        conflicts: [],
      }
    }
    const facts = factsFromModelsListing(listing.value)
    const route = state.entryRoute(entry, providerId)
    const plan = planRouteCapabilities(route, facts.models, facts.inventory)
    if (plan.changed.length === 0 && plan.adopted.length === 0) {
      return {
        status: plan.conflicts.length > 0 ? 'conflicts' : 'unchanged',
        source: `${base}/v1/models`,
        verifiedAt: new Date().toISOString(),
        changed: [],
        adopted: [],
        withheld: plan.withheld,
        conflicts: plan.conflicts,
        unknown: plan.unknown,
        refused: plan.refused,
        reason: plan.conflicts.length > 0
          ? 'every absent capability was filled; recorded values that disagree with the provider are reported, never overwritten'
          : 'the route already declares every capability the provider publishes',
      }
    }
    if (request?.apply !== true) {
      return {
        status: 'planned',
        source: `${base}/v1/models`,
        verifiedAt: new Date().toISOString(),
        changed: plan.changed,
        adopted: plan.adopted,
        withheld: plan.withheld,
        conflicts: plan.conflicts,
        unknown: plan.unknown,
        refused: plan.refused,
        next: plan.next,
        note: 'Nothing was written; pass apply: true to persist this plan through the configuration editor.',
      }
    }
    const write = await state.applyRouteConfig(entry, providerId, facts.models, facts.inventory)
    return {
      status: write === 'ok' ? 'updated' : 'failed',
      source: `${base}/v1/models`,
      verifiedAt: new Date().toISOString(),
      changed: plan.changed,
      adopted: plan.adopted,
      withheld: plan.withheld,
      conflicts: plan.conflicts,
      unknown: plan.unknown,
      refused: plan.refused,
      ...(write === 'ok' ? {} : { reason: write }),
    }
  }

  /** The automatic-refresh state, for the panel and for a health check. */
  async autoRefreshStatus() {
    const controller = this.state.autoRefresh
    const config = this.state.config
    const engines = this.state.engineRefresh
    // The engine check is reported alongside the model refresh because both are
    // schedules the owner must be able to see; neither is inferred from the other.
    const engineCheck = engines === undefined
      ? {
          enabled: config.engineCheck === true,
          intervalHours: config.engineCheckHours,
          scheduled: false,
          reason: 'engine release checks are off for this deployment',
        }
      : { ...engines.status(), intervalHours: config.engineCheckHours }
    if (controller === undefined) {
      return {
        status: 'disabled',
        enabled: config.autoRefresh === true,
        engineCheck,
        reason: config.autoRefresh === true
          ? 'automatic refresh is enabled but no scheduler was created for this deployment'
          : 'automatic refresh is off; nothing runs on a timer until the owner turns it on',
      }
    }
    return {
      status: 'ok',
      config: { enabled: config.autoRefresh === true, intervalHours: config.autoRefreshHours },
      ...controller.status(),
      engineCheck,
    }
  }

  /** The last stored update report from the saved catalog, or null. */
  async lastUpdateReport() {
    const previous = await this.state.readJsonFile(this.state.config.catalogPath)
    if (previous.status !== 'ok') return { status: previous.status, report: null }
    const lastUpdate = previous.value?.['lastUpdate']
    return { status: 'ok', report: lastUpdate ?? null }
  }

  /**
   * The generated human-readable guide: from the regenerated file when present,
   * otherwise composed on the fly from the current merged snapshot (never
   * written by this read).
   */
  async generatedGuide() {
    const file = await this.state.readTextFile(this.state.config.guideGeneratedPath)
    if (file.status === 'ok') return { source: 'file', text: file.text }
    const snapshot = await this.snapshot(undefined)
    return { source: 'live', text: generatedGuideText(snapshot) }
  }

  /** The copyable recommended-routing guide, composed from the current rows. */
  async routingGuide() {
    const snapshot = await this.snapshot(undefined)
    return routingGuideText(this.#rows(snapshot), snapshot.routingRule)
  }

  /**
   * Owner Customizations statuses produced by the external recovery tool. The
   * Harness UI only displays it; the external tool remains the only restore
   * path, so recovery works even without this UI.
   */
  async customizationStatus() {
    const path = this.state.config.customizationStatusPath
    if (path === undefined || path.length === 0) return { status: 'unconfigured', entries: [] }
    const file = await this.state.readJsonFile(path)
    if (file.status === 'missing') return { status: 'missing', entries: [] }
    if (file.status === 'malformed') return { status: 'malformed', entries: [] }
    if (file.status === 'unreadable') return { status: 'unreadable', entries: [] }
    const data = file.value
    const dir = path.split('/').slice(0, -1).join('/')
    const toolPath = `${dir}/recover-customizations.mjs`
    return {
      status: 'ok',
      checkedAt: typeof data?.['checkedAt'] === 'string' ? data['checkedAt'] : null,
      entries: Array.isArray(data?.['entries']) ? data['entries'] : [],
      // The external recovery tool stays the only restore path; the UI copies
      // its commands instead of executing anything, and the tool's own dry-run
      // default plus --apply gate keep restoration explicit.
      recovery: {
        toolPath,
        checkCommand: `node ${toolPath}`,
        applyCommand: `node ${toolPath} --apply`,
        applyPolicy: 'external: review the dry run, then run --apply manually; only Can Restore Cleanly entries are applied, Needs Review and Incompatible are refused',
      },
    }
  }

  /**
   * Deterministic detection of unresolved models plus the proposed research
   * executor under the canonical routing rule. Read-only; the UI shows it as
   * preflight before any research prompt is copied.
   */
  async researchStatus(scope) {
    const owner = await this.state.readOwnerMetadata(undefined)
    const snapshot = await this.snapshot(undefined)
    const freshness = (rates) => priceFreshness(rates, { maxAgeDays: this.state.config.maxPriceAgeDays })
    const all = unresolvedModels(snapshot, owner.data, freshness)
    const chosenScope = RESEARCH_SCOPES.includes(scope) ? scope : 'newly-detected'
    const models = scopeUnresolvedModels(all, chosenScope, undefined, owner.data?.models)
    return {
      status: 'ok',
      scope: chosenScope,
      scopes: RESEARCH_SCOPES,
      counts: { allUnverified: all.length, newlyDetected: scopeUnresolvedModels(all, 'newly-detected', undefined, owner.data?.models).length },
      models,
      researcher: proposeResearcher(snapshot, owner.data, freshness),
    }
  }

  /**
   * The deterministic research prompt for currently unresolved models. Pure
   * text; copying it consumes no tokens, and running it elsewhere is the
   * owner's explicit decision.
   */
  async researchPrompt(scope, keys) {
    const owner = await this.state.readOwnerMetadata(undefined)
    const snapshot = await this.snapshot(undefined)
    const freshness = (rates) => priceFreshness(rates, { maxAgeDays: this.state.config.maxPriceAgeDays })
    const all = unresolvedModels(snapshot, owner.data, freshness)
    const chosenScope = RESEARCH_SCOPES.includes(scope) ? scope : 'newly-detected'
    const models = scopeUnresolvedModels(all, chosenScope, keys, owner.data?.models)
    const generatedAt = new Date().toISOString()
    return {
      status: 'ok',
      scope: chosenScope,
      generatedAt,
      prompt: researchPromptText(models, { routingRule: owner.data?.routingRule ?? '', generatedAt, scope: chosenScope }),
    }
  }

  /**
   * Validate owner-pasted research results and produce the reviewable diff
   * without writing anything. On success a single-use review token is issued
   * and bound to exactly this normalized payload; applyResearchResults
   * accepts nothing without that token.
   */
  async previewResearchResults(results) {
    const owner = await this.state.readOwnerMetadata(undefined)
    const snapshot = await this.snapshot(undefined)
    const knownKeys = snapshot.providers.flatMap((provider) =>
      provider.models.map((model) => modelKey(provider.id, model.id)))
      .concat(Object.keys(owner.data?.models ?? {}))
    const validated = validateResearchResults(results, owner.data?.models, knownKeys)
    if (validated.ok !== true) {
      return { status: 'rejected', changes: validated.changes, rejected: validated.rejected, factsByOwnerKey: {},
        reason: validated.rejected.length > 0 ? 'no verified fact passed validation — nothing to review' : undefined }
    }
    // Bind the review token to the canonical form of exactly these facts, so
    // a payload changed after review can never be applied with an old token.
    const factsCanonical = JSON.stringify(validated.factsByOwnerKey)
    const reviewId = `review-${createHash('sha256').update(factsCanonical).update(String(Date.now())).digest('hex').slice(0, 16)}`
    this.#reviews.set(reviewId, { factsCanonical, createdAt: Date.now() })
    for (const [id, review] of this.#reviews) {
      if (Date.now() - review.createdAt > REVIEW_TTL_MS || this.#reviews.size > 10) this.#reviews.delete(id)
    }
    return { status: 'ok', changes: validated.changes, rejected: validated.rejected, factsByOwnerKey: validated.factsByOwnerKey, reviewId }
  }

  /**
   * The owner has reviewed a preview and confirms it; only then are the exact
   * reviewed fact fields written. Owner recommendations (and owner preference
   * fields like costTier) are never written; verified cloud pricing enters
   * only through this reviewed flow. Unknown keys and malformed facts were
   * already rejected by the preview. The review token is single-use: applying
   * consumes it, so a second apply needs a fresh review, and a changed
   * payload never matches a previously reviewed token.
   * @param {unknown} results the exact payload that was previously previewed.
   * @param {string|undefined} reviewId the token from that preview.
   */
  async applyResearchResults(results, reviewId) {
    const { state } = this
    if (typeof reviewId !== 'string') {
      return { status: 'rejected', applied: false, changes: [], rejected: [],
        reason: 'review first — click "Review Changes" in Step 3 to see and confirm the proposed changes before they can be saved' }
    }
    const review = this.#reviews.get(reviewId)
    if (review === undefined || Date.now() - review.createdAt > REVIEW_TTL_MS) {
      return { status: 'rejected', applied: false, changes: [], rejected: [],
        reason: 'this review is no longer valid (expired or already used) — review the results again, then apply' }
    }
    const { config } = state
    const owner = await state.readOwnerMetadata(undefined)
    const snapshot = await this.snapshot(undefined)
    const knownKeys = snapshot.providers.flatMap((provider) =>
      provider.models.map((model) => modelKey(provider.id, model.id)))
      .concat(Object.keys(owner.data?.models ?? {}))
    const validated = validateResearchResults(results, owner.data?.models, knownKeys)
    if (validated.ok !== true || JSON.stringify(validated.factsByOwnerKey) !== review.factsCanonical) {
      return { status: 'rejected', applied: false, changes: [], rejected: validated.rejected,
        reason: 'the payload no longer matches the reviewed facts — review the current results again, then apply' }
    }
    this.#reviews.delete(reviewId) // single use: consumed by this apply
    // The validated facts are composed owner-field values; flattened review
    // labels like `pricing.inputPerMTok` exist only in the diff text.
    const write = await state.applyOwnerFacts(validated.factsByOwnerKey)
    if (write === 'failed') {
      return { status: 'failed', applied: false, reason: 'the owner metadata file could not be read or written; nothing was applied', changes: [], rejected: [] }
    }
    // Regenerate the catalog and the guide over the fresh owner facts.
    state.cache = undefined
    const discovered = await state.discover(undefined)
    const previous = await state.readJsonFile(config.catalogPath)
    const now = new Date().toISOString()
    const freshness = (rates) => priceFreshness(rates, { maxAgeDays: config.maxPriceAgeDays })
    const { catalog } = applyUpdate({
      previousRaw: previous.value,
      discovered: discovered.providers,
      ownerData: owner.data,
      freshness,
      snapshots: [],
      pricingRefresh: undefined,
      researchNeeded: [],
      now,
      maxHistory: config.maxCatalogHistory,
    })
    const guideText = generatedGuideText(this.#merge(owner, discovered))
    await state.writeCatalogAndGuide(config.catalogPath, config.guideGeneratedPath, JSON.stringify(catalog, null, 2) + '\n', guideText)
    return { status: 'applied', applied: true, changes: validated.changes, rejected: [] }
  }

  /**
   * Read the stored engine release catalog, or return a not-yet-checked
   * catalog when none exists. Owner-recorded verification records from the
   * owner metadata file are merged into each engine entry. Never throws;
   * read errors are reported as status.
   *
   * Every entry also carries `updateAvailable` (`true`/`false`/`null`) and
   * `updateReason`, computed by the engine-version module. The panel renders
   * "update available" only from `updateAvailable === true`, so a comparison
   * the bundle cannot justify shows as unknown rather than as a pending update.
   *
   * Each entry additionally carries `advice`: a REVIEW / DEFER / NO ACTION
   * recommendation, the reason for it, the destination a follow-up belongs to,
   * and whether it needs the owner's approval. Advice is derived on read from
   * the recorded versions, so it is never stale in the catalog, and `prompt` is
   * a copy-ready investigation prompt for the entries that warrant one.
   */
  async engineCatalog() {
    const { state } = this
    const [file, owner] = await Promise.all([
      state.readJsonFile(state.config.engineCatalogPath),
      state.readOwnerMetadata(undefined),
    ])
    const verifications = owner.data?.engineVerifications ?? []
    const launchProfiles = owner.data?.launchProfiles ?? []
    if (file.status === 'missing') {
      const baseEngines = ENGINE_SOURCES.map((source) => ({
        id: source.id,
        displayName: source.displayName,
        installedVersion: null,
        latestRelease: null,
        releaseUrl: null,
        lastCheckAt: null,
        status: 'not-checked',
        ...(source.versionSpace === undefined ? {} : { versionSpace: source.versionSpace }),
      }))
      const withVerifications = mergeVerificationsIntoEngines(baseEngines, verifications)
      return {
        status: 'not-checked',
        catalogPath: state.config.engineCatalogPath,
        engines: await this.#adviseEngines(
          withReleaseComparison(mergeLaunchProfilesIntoEngines(withVerifications, launchProfiles)),
          verifications,
        ),
      }
    }
    if (file.status !== 'ok') {
      return { status: file.status, catalogPath: state.config.engineCatalogPath, engines: [] }
    }
    const rawEngines = Array.isArray(file.value?.['engines']) ? file.value['engines'] : []
    const withVerifications = mergeVerificationsIntoEngines(rawEngines, verifications)
    return {
      status: 'ok',
      catalogPath: state.config.engineCatalogPath,
      ...file.value,
      engines: await this.#adviseEngines(
        withReleaseComparison(mergeLaunchProfilesIntoEngines(withVerifications, launchProfiles)),
        verifications,
      ),
    }
  }

  /**
   * Attach advice to already-compared engine records.
   *
   * Reads the installed NVIDIA driver once for the whole set: it is the only
   * compatibility fact this host can check without guessing, and an absent
   * driver is reported as unknown rather than as satisfied.
   *
   * @param {object[]} engines engine records carrying comparison verdicts.
   * @param {object[]} verifications owner-recorded verification evidence.
   * @returns {Promise<object[]>} new array of records carrying `advice`.
   */
  async #adviseEngines(engines, verifications) {
    const { config } = this.state
    // `state` is an injected dependency bag, so a Host assembled without a driver
    // probe still gets advice: the driver floor simply stays unverified.
    const driverVersion = typeof this.state.readDriverVersion === 'function'
      ? await this.state.readDriverVersion()
      : null
    const advised = withEngineAdvice(engines, {
      maxStaleDays: config.maxEngineCheckAgeDays,
      driverVersion,
    })
    return advised.map((engine) => {
      if (engine.advice?.recommendation === ENGINE_RECOMMENDATIONS.NO_ACTION) return engine
      const own = verifications.filter((entry) => entry?.engineId === engine.id)
      return {
        ...engine,
        prompt: engineAdvicePromptText(engine, {
          workspace: config.advicePromptWorkspace,
          model: config.advicePromptModel,
          reasoning: config.advicePromptReasoning,
          verifications: own,
        }),
      }
    })
  }

  /**
   * Fetch the latest upstream release for each registered inference engine and
   * write the engine catalog. Separate from updateModelsAndPricing: a failure
   * in an engine check does not affect model metadata or cloud pricing.
   *
   * Installed versions are reported when host detection is available; they are
   * never inferred from the upstream release tag alone. No engine is installed,
   * upgraded, executed, or activated.
   */
  async updateEngines() {
    const { state } = this
    const { config } = state
    const previousFile = await state.readJsonFile(config.engineCatalogPath)
    const now = new Date().toISOString()

    // Fetch each engine's GitHub release in parallel; each failure is bounded.
    const fetchResults = await Promise.all(
      ENGINE_SOURCES.map(async (source) => {
        const result = await state.fetchEngineRelease(source.releaseApiUrl)
        const installedVersion = await state.detectInstalledVersion(source.id)
        /** @type {Record<string, unknown>} */
        const entry = { engineId: source.id, result }
        if (installedVersion !== null) entry['installedVersion'] = installedVersion
        // Strata versions its engine separately from its application tag. The
        // published engine build comes from the project's signed update feed,
        // because that is the only source that names it. A deployment that
        // supplies no feed reader still gets the release check.
        if (source.versionSpace === 'control' && typeof state.fetchEngineFeed === 'function') {
          const published = await state.fetchEngineFeed(STRATA_UPDATE_FEED_URL, source.id)
          if (published.engineRelease !== null) entry['engineRelease'] = published.engineRelease
          if (published.detail !== null) entry['engineReleaseDetail'] = published.detail
        }
        return entry
      }),
    )

    const { catalog, report } = applyEngineUpdate({
      previousCatalog: previousFile.value,
      fetchResults,
      now,
    })

    // Advice is derived, not stored: it is recomputed on every read from the
    // recorded versions and the current time, so a change to the judgement
    // rules never leaves stale advice behind in the catalog.
    const written = await state.writeTextFile(config.engineCatalogPath, JSON.stringify(catalog, null, 2) + '\n')
    return {
      report: {
        ...report,
        ...(previousFile.status === 'unreadable' ? { notes: [
          { kind: 'engine-catalog-unreadable', message: `the previous engine catalog could not be read (${previousFile.error ?? 'unknown error'}); a fresh catalog was written` },
          ...report.notes,
        ] } : {}),
      },
      written: {
        catalogPath: config.engineCatalogPath,
        ...(written === 'failed' ? { writeError: true } : {}),
      },
    }
  }
}

/** One merged marker set for all exported methods, stored on the service prototype. */
Object.defineProperty(ModelGuideService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))),
  }),
})

/**
 * Build one service instance over the given state; separate from `apply` so
 * tests construct the exact live surface without a Cordis context.
 * @param {object} state the captured dependencies object `apply` passes.
 * @returns {ModelGuideService}
 */
export function createModelGuideService(state) {
  return new ModelGuideService(state)
}

/**
 * Parse raw JSON discovery cache text into a structured result. Validates
 * schema version, top-level structure, and each candidate's required fields;
 * malformed or incomplete candidates are silently excluded. Never throws;
 * malformed or unsupported input always returns an appropriate status with an
 * empty candidates array rather than a confusingly empty-but-ok result.
 * @param {string} text raw JSON text of the LMM discovery cache file.
 * @returns {{status: 'ok'|'malformed'|'schema-unsupported', candidates: Array<{path: string, name: string, sizeBytes: number, multiPart: boolean, totalShards: number}>, generatedAt?: string, schemaVersion?: number}}
 */
export const parseDiscoveryCacheText = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'malformed', candidates: [] }
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'malformed', candidates: [] }
  if (typeof parsed['version'] !== 'number') return { status: 'malformed', candidates: [] }
  if (parsed['version'] !== 1) {
    return { status: 'schema-unsupported', candidates: [], schemaVersion: parsed['version'] }
  }
  if (!Array.isArray(parsed['roots'])) return { status: 'malformed', candidates: [] }
  const generatedAt = typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : undefined
  const candidates = []
  for (const root of parsed['roots']) {
    if (typeof root !== 'object' || root === null) continue
    if (!Array.isArray(root['candidates'])) continue
    for (const c of root['candidates']) {
      if (typeof c !== 'object' || c === null) continue
      if (typeof c['path'] !== 'string' || !c['path'].startsWith('/')) continue
      if (typeof c['name'] !== 'string' || c['name'].length === 0) continue
      if (typeof c['sizeBytes'] !== 'number' || c['sizeBytes'] < 0) continue
      if (typeof c['multiPart'] !== 'boolean') continue
      if (typeof c['totalShards'] !== 'number' || c['totalShards'] < 1) continue
      candidates.push({
        path: c['path'],
        name: c['name'],
        sizeBytes: c['sizeBytes'],
        multiPart: c['multiPart'],
        totalShards: c['totalShards'],
      })
    }
  }
  return { status: 'ok', candidates, ...(generatedAt !== undefined ? { generatedAt } : {}) }
}

export function apply(ctx, config) {
  const configValue = validateConfig(config)
  /** @type {{cache?: {at: number, providers: Array<object>}}} */
  const state = {
    config: configValue,
    cache: undefined,
    /**
     * The installed-model truth owner. Optional: a deployment without Local
     * Model Manager still recommends from owner guidance, and says so.
     * @returns {object|undefined} the service, when present and usable.
     */
    localModelManager() {
      const service = ctx.get('localModelManager')
      return service !== undefined && typeof service.snapshot === 'function' ? service : undefined
    },
    /**
     * The bounded hardware-fit advisor. Optional for the same reason: without it
     * the answer carries guidance and installed truth but no fit arithmetic.
     * @returns {object|undefined} the service, when present and usable.
     */
    llmfitAdvisor() {
      const service = ctx.get('llmfitAdvisor')
      return service !== undefined && typeof service.recommend === 'function' ? service : undefined
    },
    /** Shared merge step (same shape the snapshot method returns). */
    mergeSnapshot(owner, discovered, config) {
      return overlay(discovered.providers, owner.data, {
        generatedAt: new Date().toISOString(),
        freshness: (rates) => priceFreshness(rates, { maxAgeDays: config.maxPriceAgeDays }),
        metadataStatus: owner.status,
        metadataPath: config.ownerMetadataPath,
        ...(owner.problems === undefined ? {} : { metadataProblems: owner.problems }),
      })
    },
    /**
     * Read the owner metadata file; data problems degrade to a status with
     * named problems and never throw.
     */
    async readOwnerMetadata(signal) {
      const result = await this.readTextFile(this.config.ownerMetadataPath)
      if (result.status === 'missing') return { status: 'missing', data: {} }
      if (result.status !== 'ok') {
        return { status: result.status, data: {}, problems: [`owner metadata could not be read: ${result.error}`] }
      }
      const validated = validateOwnerMetadata(result.text)
      return validated.status === 'ok'
        ? { status: 'ok', data: validated.data, ...(validated.problems.length > 0 ? { problems: validated.problems } : {}) }
        : { status: 'malformed', data: {}, problems: validated.problems }
    },
    /** Read one UTF-8 owner file; bounded failure, never throws. */
    async readTextFile(path) {
      try {
        return { status: 'ok', text: await readFile(path, 'utf8') }
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
        if (code === 'ENOENT') return { status: 'missing' }
        return { status: 'unreadable', error: code ?? 'read failed' }
      }
    },
    /** Read and parse one JSON owner file; bounded failure, never throws. */
    async readJsonFile(path) {
      const file = await this.readTextFile(path)
      if (file.status !== 'ok') return file
      try {
        return { status: 'ok', value: JSON.parse(file.text) }
      } catch {
        return { status: 'malformed' }
      }
    },
    /**
     * Read and validate the shared LMM discovery cache. Never throws; returns
     * status 'unconfigured' when no path is set, 'missing'/'unreadable'/
     * 'malformed'/'schema-unsupported' for each failure mode, and 'ok' with a
     * validated candidates array on success. Missing or inaccessible drives
     * produce 'missing' or 'unreadable', never a confusingly empty-but-ok result.
     * @returns {Promise<{status: string, candidates: Array<object>, generatedAt?: string, schemaVersion?: number, error?: string}>}
     */
    async readLocalDiscoveryCache() {
      const cachePath = this.config.localDiscoveryCachePath
      if (cachePath === undefined || cachePath.length === 0) {
        return { status: 'unconfigured', candidates: [] }
      }
      const file = await this.readTextFile(cachePath)
      if (file.status === 'missing') return { status: 'missing', candidates: [] }
      if (file.status !== 'ok') return { status: 'unreadable', candidates: [], error: file.error }
      return parseDiscoveryCacheText(file.text)
    },
    /** Write the catalog and regenerated guide; each write reported, never thrown. */
    async writeCatalogAndGuide(catalogPath, guidePath, catalogText, guideText) {
      /**
       * @param {string} path
       * @param {string} content
       * @returns {Promise<'ok'|'failed'>}
       */
      const write = async (path, content) => {
        try {
          await writeFile(path, content, 'utf8')
          return 'ok'
        } catch {
          return 'failed'
        }
      }
      return {
        catalog: await write(catalogPath, catalogText),
        guide: await write(guidePath, guideText),
      }
    },
    /**
     * Fetch and parse one JSON endpoint with a bounded timeout.
     *
     * Separate from `fetchPageSnapshot` on purpose: that one returns raw bytes
     * plus a sha256 as *evidence* for a human-audited price page, while this one
     * is for machine-readable API answers where the parsed value is the point.
     * Offline, a timeout, a non-2xx answer, or malformed JSON all become a named
     * failure — nothing here throws, so a scheduled refresh can never take the
     * process down.
     * @param {string} url
     * @param {{method?: string, body?: string}} [init]
     * @returns {Promise<{status: 'ok', value: unknown} | {status: 'failed', error: string}>}
     */
    async fetchJson(url, init = {}) {
      try {
        const response = await fetch(url, {
          ...(init.method === undefined ? {} : { method: init.method }),
          ...(init.body === undefined ? {} : { body: init.body, headers: { 'Content-Type': 'application/json' } }),
          signal: AbortSignal.timeout(this.config.fetchTimeoutMs),
        })
        if (!response.ok) return { status: 'failed', error: `HTTP ${response.status}` }
        const text = await response.text()
        try {
          return { status: 'ok', value: JSON.parse(text) }
        } catch {
          return { status: 'failed', error: 'the endpoint answered with text that is not JSON' }
        }
      } catch (error) {
        return { status: 'failed', error: error instanceof Error ? error.message : 'the endpoint could not be reached' }
      }
    },
    /**
     * Fetch one official pricing page: raw bytes plus sha256 and time as an
     * evidence snapshot, with the body carried separately for the structured
     * rate parser (`updateModelsAndPricing`); snapshot records stay body-free.
     */
    async fetchPageSnapshot(url) {
      const fetchedAt = new Date().toISOString()
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(this.config.fetchTimeoutMs) })
        if (!response.ok) return { url, status: 'failed', fetchedAt, error: `HTTP ${response.status}` }
        const body = await response.text()
        return { url, status: 'fetched', fetchedAt, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), body }
      } catch (error) {
        return { url, status: 'failed', fetchedAt, error: error instanceof Error ? error.message : 'fetch failed' }
      }
    },
    /**
     * Apply verified official pricing to EXISTING owner model entries only:
     * reads the metadata fresh, replaces each matched entry's `pricing` field,
     * writes the file back once. Owner recommendations and unknown keys are
     * never touched — a missing key is skipped, never created.
     * @param {Record<string, object>} ratesByOwnerKey owner metadata key → verified rate record.
     * @returns {Promise<'ok'|'failed'>}
     */
    async applyOwnerPricing(ratesByOwnerKey) {
      const file = await this.readTextFile(this.config.ownerMetadataPath)
      if (file.status !== 'ok') return 'failed'
      let data
      try {
        data = JSON.parse(file.text)
      } catch {
        return 'failed'
      }
      if (typeof data !== 'object' || data === null || typeof data['models'] !== 'object' || data['models'] === null) return 'failed'
      const models = /** @type {Record<string, object>} */ (data['models'])
      for (const [key, rates] of Object.entries(ratesByOwnerKey)) {
        const entry = models[key]
        if (entry === undefined || typeof entry !== 'object') continue // never curate a new owner entry
        models[key] = { ...entry, pricing: rates }
      }
      try {
        await writeFile(this.config.ownerMetadataPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
        return 'ok'
      } catch {
        return 'failed'
      }
    },
    /**
     * Merge VERIFIED fact fields into owner model entries: reads the metadata
     * fresh, writes exactly the supplied fields (entries missing keys are
     * created with only these facts), and never touches recommendations,
     * pricing, curation notes, or any other field. One read-modify-write.
     * @param {Record<string, Record<string, unknown>>} factsByOwnerKey owner key → verified fact fields.
     * @returns {Promise<'ok'|'failed'>}
     */
    async applyOwnerFacts(factsByOwnerKey) {
      const file = await this.readTextFile(this.config.ownerMetadataPath)
      if (file.status !== 'ok') return 'failed'
      let data
      try {
        data = JSON.parse(file.text)
      } catch {
        return 'failed'
      }
      if (typeof data !== 'object' || data === null) return 'failed'
      if (typeof data['models'] !== 'object' || data['models'] === null) data['models'] = {}
      const models = /** @type {Record<string, object>} */ (data['models'])
      for (const [key, facts] of Object.entries(factsByOwnerKey)) {
        if (!/^[^/\s]+\/[^/\s]+$/.test(key)) continue // never accept a malformed owner key
        const entry = typeof models[key] === 'object' && models[key] !== null ? models[key] : {}
        models[key] = { ...entry, ...facts }
      }
      try {
        await writeFile(this.config.ownerMetadataPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
        return 'ok'
      } catch {
        return 'failed'
      }
    },
    /**
     * Discover the live provider/model inventory with bounded per-provider
     * failure. Provider facts degrade to Unknown; nothing is fabricated.
     */
    async discover(signal) {
      const now = Date.now()
      if (this.cache !== undefined && now - this.cache.at < this.config.providerCacheMs) {
        return { providers: this.cache.providers, localFiles: this.cache.localFiles }
      }
      const llm = ctx.llm
      const providers = llm.listConfigurableProviders()
      /**
       * @param {{provider: string, displayName: string}} provider
       * @returns {Promise<object>} the provider's model rows, or an error row.
       */
      const discoverProvider = async (provider) => {
        try {
          const models = await /** @type {Promise<any>} */ (new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('provider listing timed out')), this.config.providerQueryTimeoutMs)
            llm.listModels(provider.provider).then((result) => { clearTimeout(timer); resolve(result) }, (error) => { clearTimeout(timer); reject(error) })
          }))
          const enriched = await Promise.all(models.map(async (model) => {
            try {
              const resolved = await llm.resolveModelInfo(provider.provider, model.id, signal)
              return {
                id: model.id,
                name: model.name,
                ...(model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] }),
                ...(resolved.context === undefined && resolved.reasoning === undefined ? {} : {
                  ...(resolved.context === undefined ? {} : { contextWindow: resolved.context.contextWindow }),
                  ...(resolved.reasoning === undefined ? {} : { reasoning: {
                    efforts: resolved.reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
                    ...(resolved.reasoning.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort }),
                  } }),
                }),
              }
            } catch {
              // Provider-side failure: keep the model row, leave its provider facts absent.
              return { id: model.id, name: model.name }
            }
          }))
          return { id: provider.provider, name: provider.displayName, models: enriched }
        } catch (error) {
          return {
            id: provider.provider,
            name: provider.displayName,
            ...(error instanceof Error ? { error: error.message } : { error: 'provider listing failed' }),
            models: [],
          }
        }
      }
      const discoveredProviders = await Promise.all(providers.map(discoverProvider))
      const localFiles = await this.readLocalDiscoveryCache()
      this.cache = { at: now, providers: discoveredProviders, localFiles }
      return { providers: discoveredProviders, localFiles }
    },
    /**
     * Write one text file; bounded failure, never throws.
     * @param {string} path
     * @param {string} content
     * @returns {Promise<'ok'|'failed'>}
     */
    async writeTextFile(path, content) {
      try {
        await writeFile(path, content, 'utf8')
        return 'ok'
      } catch {
        return 'failed'
      }
    },
    /**
     * Fetch one engine release URL. Reuses fetchPageSnapshot so the same
     * bounded network capability serves both model pricing and engine checks.
     * @param {string} url the GitHub Releases API endpoint.
     * @returns {Promise<{url: string, status: 'fetched'|'failed', fetchedAt: string, body?: string, error?: string}>}
     */
    async fetchEngineRelease(url) {
      return this.fetchPageSnapshot(url)
    },
    /**
     * Detect the installed version of one engine when reliably available.
     * Returns null when detection is not possible or the engine is not found.
     * Override this in tests to supply a known installed version.
     * No engine is executed or activated; this is always a read-only probe.
     * @param {string} engineId
     * @returns {Promise<string|null>}
     */
    async detectInstalledVersion(engineId) {
      return detectEngineVersion(engineId, execFile, this.config.fetchTimeoutMs)
    },
    /**
     * Read the engine build a project publishes, from its update feed.
     *
     * Strata is the case this exists for: its GitHub releases tag the control
     * application, while the engine component it installs carries its own
     * build, published only in this feed. The feed is a plain signed JSON
     * document over HTTPS, which is why it is read here rather than through
     * `strata update --check` — that command takes a write lock inside the
     * installed components directory and fails when the directory is read-only.
     *
     * @param {string} url the signed feed URL.
     * @param {string} engineId registry id the feed belongs to.
     * @returns {Promise<{engineRelease: string|null, detail: object|null}>}
     */
    async fetchEngineFeed(url, engineId) {
      // Reuses the same bounded fetch capability the release check uses, so a
      // deployment that supplies one supplies both. Only an engine that
      // publishes an engine build asks for its identity.
      return readStrataEngineRelease({
        url,
        fetchDocument: (target) => this.fetchEngineRelease(target),
        identity: () => (engineId === 'strata'
          ? this.detectStrataIdentity()
          : Promise.resolve({ platform: null, variant: null })),
        driverVersion: () => this.readDriverVersion(),
      })
    },
    /**
     * The installed Strata engine identity, when it can be read.
     *
     * Best-effort: a missing binary or an unfamiliar document leaves the package
     * choice to the generic build instead of failing the engine check.
     *
     * @returns {Promise<{platform: string|null, variant: string|null}>}
     */
    async detectStrataIdentity() {
      try {
        const identity = await detectStrataEngineIdentity(execFile, this.config.fetchTimeoutMs)
        return identity.ok
          ? { platform: identity.platform, variant: identity.variant }
          : { platform: null, variant: null }
      } catch {
        return { platform: null, variant: null }
      }
    },
    /**
     * The installed NVIDIA driver version, from sysfs.
     *
     * Best-effort: a host without the NVIDIA module reports null, which leaves
     * the driver floor unverified rather than assumed satisfied.
     *
     * @returns {Promise<string|null>}
     */
    async readDriverVersion() {
      try {
        return parseDriverVersion(await readFile('/sys/module/nvidia/version', 'utf8'))
      } catch {
        return null
      }
    },
    /**
     * Locate the live configuration editor. Optional on purpose: a deployment
     * without one still reports the plan, it just cannot apply it.
     * @returns {object|undefined} the editor, when this Host exposes one.
     */
    editor() {
      const editor = ctx.get('configEditor')
      return editor !== undefined && typeof editor.edit === 'function' && typeof editor.entries === 'function'
        ? editor
        : undefined
    },
    /**
     * This provider's profile row, identified by the stable name inside its
     * containing tree (`llm-pi-ai`), never by a guessed hierarchical id.
     * @param {object} editor the configuration editor.
     * @param {string} providerId the provider route key.
     * @returns {object|undefined} the entry whose config holds that route.
     */
    entry(providerId) {
      const editor = this.editor()
      if (editor === undefined) return undefined
      const matches = (candidate) => candidate?.options?.id === PROVIDER_ENTRY_ID
        || (typeof candidate?.id === 'string' && candidate.id.split('/').pop() === PROVIDER_ENTRY_ID)
      return editor.entries().find((candidate) => {
        if (!matches(candidate)) return false
        const providers = candidate?.options?.config?.['providers']
        if (typeof providers !== 'object' || providers === null) return false
        return Object.hasOwn(providers, providerId)
      })
    },
    /**
     * The provider route as the profile currently declares it. Read from the
     * entry's live config so a concurrent edit is not silently reverted.
     * @param {object} entry the provider's profile row.
     * @param {string} providerId the provider route key.
     * @returns {object|undefined} the declared route.
     */
    entryRoute(entry, providerId) {
      const providers = entry?.options?.config?.['providers']
      if (typeof providers !== 'object' || providers === null) return undefined
      const route = providers[providerId]
      return typeof route === 'object' && route !== null ? route : undefined
    },
    /**
     * Persist the capability fill through the configuration editor, which
     * validates against the real schema before writing and reconciles the
     * profile so the change applies without a restart.
     *
     * The plan is recomputed from the route the editor reads inside the lock,
     * not from the copy inspected earlier: a concurrent owner edit must not be
     * reverted by a stale plan.
     *
     * @param {object} entry the provider's profile row.
     * @param {string} providerId the provider route key.
     * @param {Map<string, object>} facts provider facts keyed by model id.
     * @param {Array<object>} [inventory] the provider's published models, so a
     *   genuinely new one is adopted here instead of being reported as unknown.
     * @returns {Promise<'ok'|string>} `ok`, or a bounded failure reason.
     */
    async applyRouteConfig(entry, providerId, facts, inventory) {
      const editor = this.editor()
      if (editor === undefined) return 'this deployment has no configuration editor'
      try {
        await editor.edit(entry, (current) => {
          const providers = typeof current['providers'] === 'object' && current['providers'] !== null
            ? current['providers']
            : {}
          const live = providers[providerId]
          const planned = planRouteCapabilities(
            typeof live === 'object' && live !== null ? live : undefined,
            facts,
            inventory,
          )
          return planned.next === undefined
            ? { ...current, providers: { ...providers } }
            : { ...current, providers: { ...providers, [providerId]: planned.next } }
        })
        return 'ok'
      } catch (error) {
        return error instanceof Error ? error.message : 'the configuration editor rejected the change'
      }
    },
  }

  const service = new ModelGuideService(state)

  /**
   * The bounded refresh scheduler. It is created unconditionally so the panel
   * can report its state, but it schedules nothing unless the owner turned
   * `autoRefresh` on — recurring network traffic is an owner decision, and a
   * plugin must not start emitting it on activation.
   *
   * One scheduler per plugin instance: the host half is mounted once, and the
   * controller refuses a second `start()` on itself.
   */
  const autoRefresh = createAutoRefresh({
    enabled: state.config.autoRefresh === true,
    intervalMs: Math.round(state.config.autoRefreshHours * 60 * 60 * 1000),
    runOnStartup: state.config.refreshOnActivation === true,
    // A moment after activation, so activation itself stays fast and a failing
    // endpoint cannot delay the plugin becoming available.
    startupDelayMs: 5000,
    run: async () => {
      // Route capabilities first: the guide reads the adapter's resolved facts,
      // so the profile has to carry the provider's answers before discovery
      // runs. The write is additive only and is skipped when nothing is absent.
      await service.syncRouteCapabilities({ apply: true })
      await service.refreshModelMetadata(undefined)
      await service.updateModelsAndPricing()
    },
    onEvent: (event) => {
      state.lastAutoRefresh = event
    },
  })
  state.autoRefresh = autoRefresh

  /**
   * The engine release checker runs on its own schedule, deliberately separate
   * from the model refresh above.
   *
   * They answer different questions on different clocks: model metadata and
   * cloud pricing are runtime API facts that can change any day, while engine
   * releases arrive weekly to monthly. Coupling them would either poll GitHub
   * twelve times more often than needed, or leave engine checks hours stale.
   * Both run through the same controller type, so both obey the no-overlap and
   * failure-isolation rules, and this one starts no separate polling service.
   */
  const engineRefresh = createAutoRefresh({
    enabled: state.config.engineCheck === true,
    intervalMs: Math.round(state.config.engineCheckHours * 60 * 60 * 1000),
    runOnStartup: state.config.refreshOnActivation === true,
    // Later than the model sweep, so the two activation runs never overlap the
    // same moment and the engine check cannot delay the model inventory.
    startupDelayMs: 20_000,
    run: async () => {
      await service.updateEngines()
    },
    onEvent: (event) => {
      state.lastEngineCheck = event
    },
  })
  state.engineRefresh = engineRefresh

  ctx.effect(() => ctx.reflect.provide(SERVICE_KEY, service), 'model-guide: service')
  ctx.effect(() => {
    autoRefresh.start()
    // Disposal is what makes a reload safe: without it the old plugin's timer
    // keeps firing against torn-down state.
    return () => autoRefresh.stop()
  }, 'model-guide: bounded automatic refresh')
  ctx.effect(() => {
    engineRefresh.start()
    return () => engineRefresh.stop()
  }, 'model-guide: daily engine release check')

  /**
   * A model adapter change is the other moment the inventory goes stale: the
   * owner edited a provider route, so the set of models — and therefore the
   * metadata worth reading — just moved. `loader/volatile-update` is the same
   * signal the provider adapter itself listens for.
   *
   * The refresh runs through the same controller, so it obeys the owner switch
   * and the no-overlap rule rather than becoming a second, unscheduled path.
   */
  if (state.config.autoRefresh === true) {
    ctx.on('loader/volatile-update', () => {
      state.cache = undefined
      void autoRefresh.refreshNow()
    })
  }

  // -----------------------------------------------------------------------
  // Automatic model routing.
  //
  // Two listeners, both no-ops unless the owner enabled routing: classify the
  // task at the earliest existing seam (`agent/pre-step`, step 1 = the first
  // user message of a turn), then apply the decision at `agent/request` where
  // the loop already lets a listener replace the call configuration. The
  // recommendation always comes from the same advisory composition the
  // `recommend_model_for_workload` tool reads — this wiring adds invocation,
  // not a second selector. Auto-switching needs `autoSwitch: true`; otherwise
  // a materially better model asks the owner once through the existing
  // user-questions waterfall, and every bounded failure keeps the current
  // model so the task never blocks on routing.
  // -----------------------------------------------------------------------
  const questionAgent = { current: /** @type {object|undefined} */ (undefined) }
  /**
   * Only a live top-level agent is routable: children and specialists keep the
   * route their creator chose, and an ask inside an owned child would fail the
   * user-questions boundary anyway. Unavailable registry → nothing routes.
   */
  const liveRoots = () => {
    const agents = ctx.get('agents')
    return agents !== undefined && typeof agents.roots === 'function' ? new Set(agents.roots()) : null
  }
  const isRoutableAgent = (agent) => {
    const roots = liveRoots()
    return roots !== null && agent !== undefined && roots.has(agent)
  }
  const autoRoute = createAutoRoute({
    config: state.config,
    recommend: (task, useCase) => service.recommendForWorkload(task, useCase),
    askOwner: async (question, agent) => {
      const questions = ctx.get('userQuestions')
      if (questions === undefined || typeof questions.ask !== 'function') {
        return { answered: false, reason: 'no user-questions service in this deployment' }
      }
      try {
        const answer = await questions.ask({
          questions: [question],
          ...(agent === undefined ? {} : { agent }),
          signal: AbortSignal.timeout(state.config.autoRouteAskTimeoutMs),
        })
        if (answer.aborted === true) return { answered: false, reason: 'the ask was aborted' }
        return { answered: true, approve: answer.answers[question.id] === 'Yes, switch for this task' }
      } catch (error) {
        return { answered: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
    isRoot: isRoutableAgent,
  })
  if (state.config.autoSwitch === true || state.config.autoRouteAsk === true) {
    ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next) => {
      return autoRoute.onPreStep({ agent, messages, turn, step, signal }, next)
    })
    ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
      const config = await next()
      if (signal.aborted) return config
      const override = await autoRoute.onRequest({ agent, turn, signal, config })
      return override ?? config
    })
  }
  ctx.effect(() => () => autoRoute.dispose(), 'model-guide: automatic routing state')
  ctx.effect(function* tools() {
    for (const definition of createGuidanceTools({
      snapshot: (signal) => service.snapshot(signal),
      guidanceText: (provider, model) => service.guidanceText(provider, model),
      actualCost: (request) => service.actualCost(request),
      recommendModels: (task) => service.recommendModels(task),
      recommendForWorkload: (task, useCase) => service.recommendForWorkload(task, useCase),
    })) {
      yield ctx.tools.register(definition)
    }
  }, 'model-guide: read-only agent tools')
}