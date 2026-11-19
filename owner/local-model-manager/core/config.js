/**
 * Config validation for the Local Model Manager. Deployment-varying values
 * (paths, GPU UUIDs, the model catalog) are validated Config fields from
 * cordis.patch.yml; misconfiguration fails loudly at activation.
 */

/** Engine binaries the trusted launcher maintains, keyed by catalog value. */
export const ENGINE_BINARIES = ['stable', 'flash-next']

/** profileId must be a lowercase slug (same rule as model keys). */
const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Validate one launch profile entry from config; throws TypeError on any
 * required-field failure so misconfiguration is caught at activation.
 * @param {unknown} raw raw profile object.
 * @param {number} index position in the launchProfiles array for error messages.
 * @returns {object} validated profile.
 */
const validateLaunchProfile = (raw, index) => {
  const loc = `local-model-manager: config launchProfiles[${index}]`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError(`${loc} must be an object`)
  }
  const r = /** @type {Record<string, unknown>} */ (raw)
  const readSlug = (name) => {
    const v = r[name]
    if (typeof v !== 'string' || v.trim().length === 0) throw new TypeError(`${loc}.${name} must be a non-empty string`)
    const t = v.trim()
    if (name === 'profileId' && !SAFE_PROFILE_ID.test(t)) throw new TypeError(`${loc}.profileId must be a lowercase slug`)
    return t
  }
  const profileId = readSlug('profileId')
  const engineId = readSlug('engineId')
  const engineVersion = readSlug('engineVersion')
  const modelKey = readSlug('modelKey')
  const gpuUuids = r['gpuUuids']
  if (!Array.isArray(gpuUuids) || gpuUuids.length === 0) throw new TypeError(`${loc}.gpuUuids must be a non-empty array`)
  const validatedUuids = gpuUuids.map((uuid, i) => {
    if (typeof uuid !== 'string' || uuid.trim().length === 0) throw new TypeError(`${loc}.gpuUuids[${i}] must be a non-empty string`)
    return uuid.trim()
  })
  const seenUuids = new Set()
  for (const uuid of validatedUuids) {
    if (seenUuids.has(uuid)) throw new TypeError(`${loc}.gpuUuids contains duplicate UUID "${uuid}"; each GPU must appear at most once`)
    seenUuids.add(uuid)
  }
  const gpuMode = r['gpuMode']
  if (gpuMode !== 'single' && gpuMode !== 'both') throw new TypeError(`${loc}.gpuMode must be "single" or "both"`)
  const launchArgsRaw = r['launchArgs']
  if (!Array.isArray(launchArgsRaw)) throw new TypeError(`${loc}.launchArgs must be an array`)
  const launchArgs = launchArgsRaw.map((arg, i) => {
    if (typeof arg !== 'string' || arg.trim().length === 0) throw new TypeError(`${loc}.launchArgs[${i}] must be a non-empty string`)
    return arg.trim()
  })
  const label = r['label']
  if (typeof label !== 'string' || label.trim().length === 0) throw new TypeError(`${loc}.label must be a non-empty string`)
  const notes = r['notes']
  return {
    profileId,
    engineId,
    engineVersion,
    modelKey,
    gpuUuids: validatedUuids,
    gpuMode,
    launchArgs,
    label: label.trim(),
    ...(typeof notes === 'string' && notes.trim().length > 0 ? { notes: notes.trim() } : {}),
  }
}

/**
 * Validate one catalog model row; every field is required unless stated.
 * @param {unknown} row raw model row.
 * @returns {object} validated row.
 */
const validateModel = (row) => {
  if (typeof row !== 'object' || row === null) throw new TypeError('local-model-manager: each models[] entry must be an object')
  const text = (name, value) => {
    if (typeof value !== 'string' || value.trim().length === 0 || !value.startsWith('/')) {
      throw new TypeError(`local-model-manager: models[].${name} must be an absolute host path`)
    }
    return value.trim()
  }
  const key = row['key']
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    throw new TypeError('local-model-manager: models[].key must be a lowercase slug')
  }
  const name = row['name']
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(`local-model-manager: models[].name for ${key} must be a non-empty string`)
  }
  const engineBinary = row['engineBinary']
  if (!ENGINE_BINARIES.includes(engineBinary)) {
    throw new TypeError(`local-model-manager: models[].engineBinary for ${key} must be one of ${ENGINE_BINARIES.join(', ')}`)
  }
  const vision = row['vision'] === true
  const mmprojPath = row['mmprojPath'] === undefined ? undefined : text('mmprojPath', row['mmprojPath'])
  if (vision && mmprojPath === undefined) {
    throw new TypeError(`local-model-manager: models[].mmprojPath for ${key} is required when vision is true`)
  }
  return {
    key,
    name: name.trim(),
    ggufPath: text('ggufPath', row['ggufPath']),
    switchName: row['switchName'],
    engineBinary,
    vision,
    multiPart: row['multiPart'] === true,
    ...(mmprojPath === undefined ? {} : { mmprojPath }),
  }
}

/**
 * Validate the full plugin config; absent fields fall back to documented
 * defaults.
 * @param {Record<string, unknown>} value raw config.
 * @returns {object} the validated config.
 */
export const validateConfig = (value) => {
  const raw = value === undefined || value === null ? {} : value
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('local-model-manager: config must be a JSON object')
  const readText = (name, fallback) => {
    const given = raw[name] === undefined ? fallback : raw[name]
    if (typeof given !== 'string' || given.trim().length === 0) {
      throw new TypeError(`local-model-manager: config ${name} must be a non-empty string`)
    }
    return given.trim()
  }
  const endpointBase = readText('endpointBase', 'http://127.0.0.1:8001')
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(endpointBase) === false) {
    throw new TypeError('local-model-manager: config endpointBase must be a localhost loopback URL (the plugin never exposes a local service) ')
  }
  const readPositiveInt = (name, fallback) => {
    const given = raw[name]
    if (given === undefined) return fallback
    if (typeof given !== 'number' || !Number.isFinite(given) || given <= 0) {
      throw new TypeError(`local-model-manager: config ${name} must be a positive number`)
    }
    return given
  }
  const modelsRaw = raw['models']
  if (!Array.isArray(modelsRaw) || modelsRaw.length === 0) {
    throw new TypeError('local-model-manager: config models must be a non-empty list')
  }
  const models = modelsRaw.map(validateModel)
  const keys = new Set(models.map((model) => model.key))
  if (keys.size !== models.length) throw new TypeError('local-model-manager: config models[].key must be unique')
  for (const model of models) {
    const sw = model.switchName
    if (typeof sw !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(sw)) {
      throw new TypeError(`local-model-manager: models[].switchName for ${model.key} must be a lowercase slug`)
    }
  }
  // Optional launch profiles validated at config load; absent means no profiles configured.
  const launchProfilesRaw = raw['launchProfiles']
  const launchProfiles = []
  if (launchProfilesRaw !== undefined && launchProfilesRaw !== null) {
    if (!Array.isArray(launchProfilesRaw)) {
      throw new TypeError('local-model-manager: config launchProfiles must be a list')
    }
    for (let i = 0; i < launchProfilesRaw.length; i++) {
      launchProfiles.push(validateLaunchProfile(launchProfilesRaw[i], i))
    }
  }
  // Extract GPU identity fields before computing the allowedGpuUuids default.
  const caseGpuUuid = readText('caseGpuUuid', '')
  const caseGpuName = readText('caseGpuName', '')
  const protectedGpuUuid = readText('protectedGpuUuid', '')
  const protectedGpuName = readText('protectedGpuName', '')

  // Optional allowedGpuUuids: owner-controlled set of GPU UUIDs that may
  // appear in launch profiles. Defaults to [caseGpuUuid] for backward compat.
  const allowedGpuUuidsRaw = raw['allowedGpuUuids']
  let allowedGpuUuids
  if (allowedGpuUuidsRaw === undefined || allowedGpuUuidsRaw === null) {
    allowedGpuUuids = caseGpuUuid.length > 0 ? [caseGpuUuid] : []
  } else {
    if (!Array.isArray(allowedGpuUuidsRaw)) {
      throw new TypeError('local-model-manager: config allowedGpuUuids must be a list')
    }
    if (allowedGpuUuidsRaw.length === 0) {
      throw new TypeError('local-model-manager: config allowedGpuUuids must not be empty')
    }
    allowedGpuUuids = allowedGpuUuidsRaw.map((uuid, i) => {
      if (typeof uuid !== 'string' || uuid.trim().length === 0) {
        throw new TypeError(`local-model-manager: config allowedGpuUuids[${i}] must be a non-empty string`)
      }
      return uuid.trim()
    })
  }

  // discoveryDirs: optional list of absolute paths to scan for GGUF candidates.
  const discoveryDirsRaw = raw['discoveryDirs']
  let discoveryDirs = []
  if (discoveryDirsRaw !== undefined && discoveryDirsRaw !== null) {
    if (!Array.isArray(discoveryDirsRaw)) throw new TypeError('local-model-manager: config discoveryDirs must be a list')
    discoveryDirs = discoveryDirsRaw.map((d, i) => {
      if (typeof d !== 'string' || !d.trim().startsWith('/')) {
        throw new TypeError(`local-model-manager: config discoveryDirs[${i}] must be an absolute path`)
      }
      return d.trim()
    })
  }

  // discoveryResultsPath: optional absolute path for the shared discovery cache file.
  const discoveryResultsPathRaw = raw['discoveryResultsPath']
  let discoveryResultsPath = ''
  if (discoveryResultsPathRaw !== undefined && discoveryResultsPathRaw !== null && discoveryResultsPathRaw !== '') {
    if (typeof discoveryResultsPathRaw !== 'string' || !discoveryResultsPathRaw.trim().startsWith('/')) {
      throw new TypeError('local-model-manager: config discoveryResultsPath must be an absolute path')
    }
    discoveryResultsPath = discoveryResultsPathRaw.trim()
  }

  // userDiscoveryDirsPath: optional absolute path for the persistent user-added directories file.
  const userDiscoveryDirsPathRaw = raw['userDiscoveryDirsPath']
  let userDiscoveryDirsPath = ''
  if (userDiscoveryDirsPathRaw !== undefined && userDiscoveryDirsPathRaw !== null && userDiscoveryDirsPathRaw !== '') {
    if (typeof userDiscoveryDirsPathRaw !== 'string' || !userDiscoveryDirsPathRaw.trim().startsWith('/')) {
      throw new TypeError('local-model-manager: config userDiscoveryDirsPath must be an absolute path')
    }
    userDiscoveryDirsPath = userDiscoveryDirsPathRaw.trim()
  }

  // contextSelectionsPath: optional absolute path for the persistent context
  // selection file (automatic selections plus owner manual overrides).
  const contextSelectionsPathRaw = raw['contextSelectionsPath']
  let contextSelectionsPath = ''
  if (contextSelectionsPathRaw !== undefined && contextSelectionsPathRaw !== null && contextSelectionsPathRaw !== '') {
    if (typeof contextSelectionsPathRaw !== 'string' || !contextSelectionsPathRaw.trim().startsWith('/')) {
      throw new TypeError('local-model-manager: config contextSelectionsPath must be an absolute path')
    }
    contextSelectionsPath = contextSelectionsPathRaw.trim()
  }

  // DSH-side session budget reservation, mirroring the compaction-basic
  // modelPolicies for the local route: output tokens one request reserves and
  // the headroom that absorbs system-prompt sections and tool schemas.
  const reservedOutputTokens = readPositiveInt('reservedOutputTokens', 8192)
  const headroomTokens = readPositiveInt('headroomTokens', 16384)
  if (!Number.isInteger(reservedOutputTokens) || !Number.isInteger(headroomTokens)) {
    throw new TypeError('local-model-manager: config reservedOutputTokens and headroomTokens must be positive integers')
  }

  // preferredLaunchGpuUuid: the GPU the plain start/switch actions target.
  // Defaults to the Ti (protectedGpuUuid key retains its historical name); the
  // owner can change the preference in configuration, and every profile launch
  // overrides it with its own gpuUuids.
  const preferredLaunchGpuUuidRaw = raw['preferredLaunchGpuUuid']
  let preferredLaunchGpuUuid = ''
  if (preferredLaunchGpuUuidRaw !== undefined && preferredLaunchGpuUuidRaw !== null && preferredLaunchGpuUuidRaw !== '') {
    if (typeof preferredLaunchGpuUuidRaw !== 'string' || preferredLaunchGpuUuidRaw.trim().length === 0) {
      throw new TypeError('local-model-manager: config preferredLaunchGpuUuid must be a non-empty string when set')
    }
    preferredLaunchGpuUuid = preferredLaunchGpuUuidRaw.trim()
  }
  if (preferredLaunchGpuUuid === '' && protectedGpuUuid === '') {
    throw new TypeError('local-model-manager: config preferredLaunchGpuUuid has no default because protectedGpuUuid is also unset; configure one of them')
  }

  // gpuLaunchStatePath: optional absolute path for the durable manual launch
  // reservation file. Absent file = no GPU reserved (the default); only owner
  // reserve/release confirms write it.
  const gpuLaunchStatePathRaw = raw['gpuLaunchStatePath']
  let gpuLaunchStatePath = ''
  if (gpuLaunchStatePathRaw !== undefined && gpuLaunchStatePathRaw !== null && gpuLaunchStatePathRaw !== '') {
    if (typeof gpuLaunchStatePathRaw !== 'string' || !gpuLaunchStatePathRaw.trim().startsWith('/')) {
      throw new TypeError('local-model-manager: config gpuLaunchStatePath must be an absolute path')
    }
    gpuLaunchStatePath = gpuLaunchStatePathRaw.trim()
  }

  // hardwareContextCaps: optional per-model hardware-derived context limit
  // (model key → positive token count) recorded from supervised evidence.
  const hardwareContextCapsRaw = raw['hardwareContextCaps']
  let hardwareContextCaps = {}
  if (hardwareContextCapsRaw !== undefined && hardwareContextCapsRaw !== null) {
    if (typeof hardwareContextCapsRaw !== 'object' || Array.isArray(hardwareContextCapsRaw)) {
      throw new TypeError('local-model-manager: config hardwareContextCaps must be an object')
    }
    const modelKeys = new Set(models.map((model) => model.key))
    hardwareContextCaps = Object.fromEntries(Object.entries(hardwareContextCapsRaw).map(([key, value]) => {
      if (!modelKeys.has(key)) throw new TypeError(`local-model-manager: config hardwareContextCaps has an entry "${key}" that is not a managed model key`)
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new TypeError(`local-model-manager: config hardwareContextCaps.${key} must be a positive integer token count`)
      }
      return [key, value]
    }))
  }

  // candidateLauncherPath: optional absolute path to the multi-instance candidate
  // launcher. Required when instances are configured; multi-instance operations
  // refuse when this path is absent.
  const candidateLauncherPathRaw = raw['candidateLauncherPath']
  let candidateLauncherPath = ''
  if (candidateLauncherPathRaw !== undefined && candidateLauncherPathRaw !== null && candidateLauncherPathRaw !== '') {
    if (typeof candidateLauncherPathRaw !== 'string' || !candidateLauncherPathRaw.trim().startsWith('/')) {
      throw new TypeError('local-model-manager: config candidateLauncherPath must be an absolute path')
    }
    candidateLauncherPath = candidateLauncherPathRaw.trim()
  }

  // powerSamplingEnabled: optional flag for the bounded in-memory power sampler.
  // Off by default: a deployment that does not want a 1 Hz nvidia-smi cycle
  // keeps the Phase 1 instantaneous wattage only. Nothing is written to disk.
  const powerSamplingEnabledRaw = raw['powerSamplingEnabled']
  let powerSamplingEnabled = false
  if (powerSamplingEnabledRaw !== undefined && powerSamplingEnabledRaw !== null) {
    if (typeof powerSamplingEnabledRaw !== 'boolean') {
      throw new TypeError('local-model-manager: config powerSamplingEnabled must be a boolean')
    }
    powerSamplingEnabled = powerSamplingEnabledRaw
  }

  // powerRingCapacity: optional number of retained samples (one per second at
  // the default interval). Bounded by construction; the ring drops the oldest.
  const powerRingCapacity = readPositiveInt('powerRingCapacity', 7200)
  if (!Number.isInteger(powerRingCapacity)) {
    throw new TypeError('local-model-manager: config powerRingCapacity must be an integer')
  }

  // powerSampleIntervalMs: optional period between samples.
  const powerSampleIntervalMs = readPositiveInt('powerSampleIntervalMs', 1000)

  // tariffGpuUuid: optional GPU UUID whose board power is priced per job. Empty
  // means "the preferred launch target"; the sampler still measures every card.
  const tariffGpuUuidRaw = raw['tariffGpuUuid']
  let tariffGpuUuid = ''
  if (tariffGpuUuidRaw !== undefined && tariffGpuUuidRaw !== null && tariffGpuUuidRaw !== '') {
    if (typeof tariffGpuUuidRaw !== 'string' || tariffGpuUuidRaw.trim().length === 0) {
      throw new TypeError('local-model-manager: config tariffGpuUuid must be a non-empty string')
    }
    tariffGpuUuid = tariffGpuUuidRaw.trim()
  }

  // instances: optional ordered list for multi-instance mode. Each entry binds
  // one loopback port to one GPU UUID so the candidate launcher is invoked with
  // MODEL_SERVER_PORT and MODEL_SERVER_GPU_UUID set for that instance.
  const instancesRaw = raw['instances']
  let instances = []
  if (instancesRaw !== undefined && instancesRaw !== null) {
    if (!Array.isArray(instancesRaw)) throw new TypeError('local-model-manager: config instances must be a list')
    instances = instancesRaw.map((inst, i) => {
      const loc = `local-model-manager: config instances[${i}]`
      if (typeof inst !== 'object' || inst === null || Array.isArray(inst)) {
        throw new TypeError(`${loc} must be an object`)
      }
      const portRaw = inst['port']
      if (typeof portRaw !== 'number' || !Number.isInteger(portRaw) || portRaw < 1024 || portRaw > 65535) {
        throw new TypeError(`${loc}.port must be an integer between 1024 and 65535`)
      }
      const gpuUuidRaw = inst['gpuUuid']
      if (typeof gpuUuidRaw !== 'string' || gpuUuidRaw.trim().length === 0) {
        throw new TypeError(`${loc}.gpuUuid must be a non-empty string`)
      }
      const gpuNameRaw = inst['gpuName']
      if (typeof gpuNameRaw !== 'string' || gpuNameRaw.trim().length === 0) {
        throw new TypeError(`${loc}.gpuName must be a non-empty string`)
      }
      return { port: portRaw, gpuUuid: gpuUuidRaw.trim(), gpuName: gpuNameRaw.trim() }
    })
    const ports = new Set(instances.map((inst) => inst.port))
    if (ports.size !== instances.length) {
      throw new TypeError('local-model-manager: config instances must have unique port values')
    }
  }

  // localEndpoints: optional read-only observation of local model servers this
  // manager does not launch. Each entry says "this loopback port serves a model
  // on this card"; nothing here grants control, because the manager has no
  // launcher record for these processes. The point is identity: a caller that
  // reached that endpoint can ask which card is behind it without guessing.
  const localEndpointsRaw = raw['localEndpoints']
  let localEndpoints = []
  if (localEndpointsRaw !== undefined && localEndpointsRaw !== null) {
    if (!Array.isArray(localEndpointsRaw)) throw new TypeError('local-model-manager: config localEndpoints must be a list')
    localEndpoints = localEndpointsRaw.map((entry, i) => {
      const loc = `local-model-manager: config localEndpoints[${i}]`
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new TypeError(`${loc} must be an object`)
      }
      const portRaw = entry['port']
      if (typeof portRaw !== 'number' || !Number.isInteger(portRaw) || portRaw < 1024 || portRaw > 65535) {
        throw new TypeError(`${loc}.port must be an integer between 1024 and 65535`)
      }
      const gpuUuidRaw = entry['gpuUuid']
      if (typeof gpuUuidRaw !== 'string' || gpuUuidRaw.trim().length === 0) {
        throw new TypeError(`${loc}.gpuUuid must be a non-empty string`)
      }
      const gpuNameRaw = entry['gpuName']
      if (typeof gpuNameRaw !== 'string' || gpuNameRaw.trim().length === 0) {
        throw new TypeError(`${loc}.gpuName must be a non-empty string`)
      }
      return { port: portRaw, gpuUuid: gpuUuidRaw.trim(), gpuName: gpuNameRaw.trim() }
    })
    const endpointPorts = new Set(localEndpoints.map((entry) => entry.port))
    if (endpointPorts.size !== localEndpoints.length) {
      throw new TypeError('local-model-manager: config localEndpoints must have unique port values')
    }
    for (const entry of localEndpoints) {
      if (instances.some((inst) => inst.port === entry.port)) {
        throw new TypeError(`local-model-manager: config localEndpoints port ${entry.port} is already a managed instance port`)
      }
    }
    for (const entry of localEndpoints) {
      if (!allowedGpuUuids.includes(entry.gpuUuid)) {
        throw new TypeError(`local-model-manager: config localEndpoints port ${entry.port} names a gpuUuid that is not in allowedGpuUuids`)
      }
    }
  }

  return {
    endpointBase,
    launcherPath: readText('launcherPath', '/home/liongateos/.local/share/liongateos/deepseek-harness-local-models/dsh-model-server'),
    providerPatchPath: readText('providerPatchPath', '/home/liongateos/.dsh/profiles/web/cordis.patch.yml'),
    settingsPath: readText('settingsPath', '/home/liongateos/.dsh/settings.yaml'),
    caseGpuUuid,
    caseGpuName,
    protectedGpuUuid,
    protectedGpuName,
    preferredLaunchGpuUuid: preferredLaunchGpuUuid !== '' ? preferredLaunchGpuUuid : protectedGpuUuid,
    gpuLaunchStatePath,
    allowedGpuUuids,
    vllmBinPath: readText('vllmBinPath', '/home/liongateos/.local/bin/vllm'),
    probeTimeoutMs: readPositiveInt('probeTimeoutMs', 3000),
    actionTimeoutMs: readPositiveInt('actionTimeoutMs', 300000),
    confirmTtlMs: readPositiveInt('confirmTtlMs', 300000),
    maxErrorRecords: readPositiveInt('maxErrorRecords', 20),
    models,
    launchProfiles,
    discoveryDirs,
    discoveryResultsPath,
    userDiscoveryDirsPath,
    contextSelectionsPath,
    reservedOutputTokens,
    headroomTokens,
    hardwareContextCaps,
    candidateLauncherPath,
    instances,
    localEndpoints,
    powerSamplingEnabled,
    powerRingCapacity,
    powerSampleIntervalMs,
    tariffGpuUuid,
  }
}