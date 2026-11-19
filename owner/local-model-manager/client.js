/**
 * Browser half of the Local Model Manager bundle.
 *
 * Renders one main panel (sidebar entry keyed `local-model-manager`) reading
 * the Host service's ten endpoints: snapshot, planAction, confirmAction,
 * recentErrors, planLaunch, confirmLaunch, planGpuLock, confirmGpuLock,
 * planGpuReservation, and confirmGpuReservation. Buttons follow the
 * host contract exactly: every
 * start/stop/switch click plans first (which may refuse with a
 * plain-language reason), the plan card explains the impact in plain
 * language, and only an explicit owner confirmation executes the action.
 * Interrupted-work acknowledgment is a required checkbox whenever an active
 * job is detected. Text follows the locale service; colors use only
 * `--dsw-alias-*` tokens. Nothing here talks to any non-loopback host.
 */

window.__ModuleLoader__.load({
  id: '@local/local-model-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = '@local/local-model-manager'
    const NS = 'localModelManager.page'
    const PANEL_ID = 'local-model-manager'
    const SERVICE_KEY = 'localModelManager'

    const en = {
      title: 'Local Model Manager',
      subtitle: 'My installed models, my graphics cards, and safe one-click control',
      loading: 'Checking my local models…',
      loadFailed: 'Could not load the model manager',
      retry: 'Retry',
      renderErrorTitle: 'Panel render error',
      renderErrorRetry: 'Try again',
      refresh: 'Refresh',
      refreshTitle: 'Refresh model inventory and server status',
      serverStateRunning: 'Running',
      serverStateStopped: 'Stopped',
      serverStateError: 'Server problem',
      serverStateUnknown: 'Status unknown',
      runningModel: 'Running model',
      liveContext: 'Context actually in use',
      configContext: 'Context configured',
      configured: 'configured',
      fromRuntime: 'from live server',
      contextPendingNote: 'The context in use is older than the configured value. An approved restart of the model server applies the new size.',
      contextSelected: 'Context selected',
      contextAdvertised: 'Model advertised context (from the GGUF file)',
      contextConfigured: 'Configured context (provider config)',
      contextHardwareCap: 'Hardware context cap',
      contextDshUsable: 'Usable session context after reserves',
      contextSourceAuto: 'selected automatically',
      contextSourceManual: 'manually overridden',
      contextSourceUnavailable: 'no context evidence readable',
      contextUnknown: 'not readable',
      contextFitReduced: 'The running server uses a smaller context than the selected value. Stop and start the model to apply the selected value; the engine may also reduce it when it cannot allocate the full window.',
      contextVerifyDone: 'The running server uses the selected context.',
      usableExhaustedNote: 'The configured output and headroom reservations consume the whole window; no session budget remains.',
      overrideActive: 'A manual context override is active and is honored exactly.',
      busyNow: 'A job is running right now',
      idle: 'No active jobs',
      busyUnknown: 'Active-job state could not be read — stop and switch stay refused while the panel cannot confirm this',
      slots: 'Slot',
      endpoint: 'Local endpoint',
      myModels: 'My Local Models',
      modelsHint: 'Verified facts only: where a value could not be read live, it says so instead of guessing.',
      capabilityDashboard: 'Capability Dashboard',
      capabilityDashboardHint: 'Verified configuration and disk facts are shown directly. Performance ratings remain Not measured until benchmark evidence exists.',
      capabilityEvidence: 'Evidence status',
      capabilityVerifiedFacts: 'Verified facts; performance not measured',
      capabilityPermittedGpu: 'Permitted GPU',
      capabilityTwoGpu: 'Two-GPU use',
      capabilityTwoGpuUnavailable: 'Unavailable by owner policy',
      capabilityAssessment: 'Performance assessment',
      capabilityCoding: 'Coding',
      capabilityReasoningScore: 'Reasoning',
      capabilityAgentic: 'Agentic',
      capabilityVisionScore: 'Vision quality',
      capabilityGeneralWriting: 'General / Writing',
      capabilitySpeed: 'Speed',
      capabilityBestFor: 'Best For',
      capabilityNotMeasured: 'Not measured',
      capabilityBestForPending: 'Not measured — benchmark evidence required',
      installed: 'Installed',
      missing: 'Missing on disk',
      sizeOnDisk: 'File size',
      runtimeRunning: 'Running now',
      runtimeStopped: 'Stopped',
      runtimeError: 'Problem detected',
      currentEngine: 'Serving engine',
      engineNote: 'llama.cpp — verified engine',
      gpuAll: 'Runs on',
      reasoning: 'Reasoning options',
      reasoningNone: 'none (by configuration)',
      reasoningUnknown: 'not readable from configuration',
      visionSupport: 'Reads images',
      textOnly: 'Text only',
      concurrency: 'Jobs at once',
      concurrencyOne: 'One job at a time (verified: the launcher starts one slot)',
      profiles: 'Operating profiles',
      available: 'Available',
      disabled: 'Not available',
      why: 'Why',
      recommended: 'What fits this model',
      startLabel: 'Start',
      stopLabel: 'Stop',
      switchLabel: 'Switch to this model',
      restoreHint: 'After a failed switch, start the previous model again from its card.',
      planTitle: 'Before doing anything — check this',
      planImpact: 'What will happen',
      planActiveJobs: 'Active jobs that would be interrupted',
      planNoAckNeeded: 'No active job was detected. The server is idle.',
      acknowledge: 'I understand this will interrupt the job listed above.',
      confirmExecute: 'Confirm and do it',
      cancel: 'Cancel',
      actionDone: 'Done',
      actionFailed: 'It did not work',
      actionRefused: 'The panel refused this action',
      actionOutput: 'Launcher report',
      close: 'Close',
      gpusTitle: 'My Graphics Cards',
      gpusHint: 'No GPU is reserved automatically. Reserve a card to keep it a refused launch target until you release it; unused memory on a reserved card is still not permission to use it.',
      preferredTargetBadge: 'Preferred launch target',
      protectedBadge: 'Reserved (manual lock)',
      protectedNote: 'Manually reserved as a launch target from this panel. Launch attempts onto it are refused while it stays reserved, and nothing re-applies or removes the reservation automatically. Running workloads are never touched.',
      generalNote: 'Available as a launch target. No GPU is reserved automatically — only your own Reserve/Release actions change that, and they persist across refreshes and restarts.',
      memUsed: 'Memory in use',
      memTotal: 'Total memory',
      util: 'Utilization',
      powerDraw: 'Power draw',
      powerNotReported: 'Not reported by this driver',
      electricityTitle: 'Electricity',
      electricityMeasured: 'Measured GPU board power',
      electricityNote: 'Board power reported by the graphics driver. It covers the card only: CPU, drives, cooling, and power-supply losses are not included, so this is a lower bound on what the machine draws.',
      electricityNow: 'Current draw',
      electricityRate: 'Rate now',
      electricityPerHour: 'At this draw',
      electricityJobTitle: 'Last measured job',
      electricityJobRunning: 'Running now',
      electricityJobEnergy: 'Energy measured',
      electricityJobCost: 'Cost of that energy',
      electricityJobRuntime: 'Observed for',
      electricityJobCoverage: 'Measured coverage',
      electricitySampleUnit: 'samples',
      electricityJobPids: 'GPU process IDs',
      electricityJobPieces: 'Rate changes inside the job',
      electricityAttributionExclusive: 'This card was used by one process only.',
      electricityAttributionShared: 'Approximate — another process also used this card.',
      electricityAttributionOverlapping: 'Approximate — more than one job overlapped on this card.',
      electricityAttributionPartial: 'Partial — measurement gaps, so the real total is higher.',
      electricityDisabled: 'Energy sampling is off. Turn on power sampling to measure per-job energy.',
      electricityNoJob: 'No recent job has been measured yet.',
      gpuUnavailable: 'Reading this card failed',
      gpuProcesses: 'Processes using this card',
      gpuNoProcesses: 'No processes detected on this card.',
      gpuQueryFailed: 'The graphics card health check could not run on this machine, so live memory numbers are unavailable. The protection rule still applies fully.',
      enginesTitle: 'Serving engines',
      engVerified: 'Working default',
      engNotConfigured: 'Not configured — requires setup',
      errorsTitle: 'Recent operational errors',
      errorsNone: 'No operational errors recorded in this session.',
      modesTitle: 'Simple Operating Modes',
      modesHint: 'Pick a mode and the panel only offers models and setups that genuinely support it.',
      modeReliable: 'Reliable — One Job: run one workload with the tested setup.',
      modeMultiple: 'Multiple Jobs: not available yet — the installed launcher starts one job per model. It stays disabled until an approved launcher upgrade.',
      modeResearch: 'Long Research: models with large verified context windows.',
      modeAdvanced: 'Advanced: show the real engine, context, slot, and GPU settings with explanations.',
      launchProfilesTitle: 'Launch Profiles',
      launchProfilesHint: 'Each profile sends a verified command to the trusted launcher. All safety checks still apply.',
      launchProfilesEmpty: 'No launch profiles are configured. Add a launchProfiles entry to cordis.patch.yml to use this feature.',
      launchLabel: 'Launch with this profile',
      launchPlanTitle: 'Before launching — check this',
      launchPlanEngine: 'Engine',
      launchPlanGpu: 'GPU',
      launchPlanArgs: 'Extra launch arguments',
      launchPlanArgsNone: 'none',
      launchPlanNotes: 'Notes',
      confirmLaunchLabel: 'Confirm and launch',
      launchDone: 'Launch started',
      launchFailed: 'Launch failed',
      discoveredTitle: 'Models discovered on disk',
      discoveredHint: 'These GGUF files were found on disk but are not registered with the Harness provider. They cannot be used for conversations yet.',
      discoveredCandidate: 'Candidate',
      discoveredMultiPart: 'Multi-shard',
      discoveredNone: 'No new GGUF files found on disk.',
      discoveredScanError: 'Some directories could not be fully scanned.',
      discoveredPath: 'File',
      discoveredShards: 'Total shards',
      discoveredNote: 'To use this model, register it with the Harness provider and add it to the managed catalog.',
      gpuComputeMode: 'Compute mode',
      gpuComputeModeLocked: 'Locked (EXCLUSIVE_PROCESS)',
      gpuComputeModeUnlocked: 'Unlocked (DEFAULT)',
      gpuComputeModeProhibited: 'Prohibited (set outside this panel)',
      gpuComputeModeExclusiveThread: 'Exclusive Thread (set outside this panel)',
      gpuComputeModeUnknown: 'Unknown mode',
      gpuComputeModeUnavailable: 'Could not be read',
      gpuLockButton: 'Lock (EXCLUSIVE_PROCESS)',
      gpuUnlockButton: 'Unlock (DEFAULT)',
      gpuLockPlanTitle: 'Before changing GPU compute mode',
      gpuLockPlanImpact: 'What will happen',
      gpuLockDisclosureTitle: 'Required disclosure',
      gpuLockConfirmButton: 'Confirm and apply',
      gpuLockCancel: 'Cancel',
      gpuLockDone: 'Compute mode changed',
      gpuLockPartial: 'Command ran — readback shows different mode',
      gpuLockPartialDetail: 'The driver may have refused the change or the readback is stale.',
      gpuLockFailed: 'Compute mode change failed',
      gpuLockPermissionDenied: 'Permission denied — elevated privileges are required to change compute mode',
      gpuLockRefused: 'Change refused',
      gpuLockActualMode: 'Actual mode after change',
      gpuLockClose: 'Close',
      releaseReservationButton: 'Release Reservation',
      reserveButton: 'Reserve as launch target',
      reservationPlanTitle: 'Before changing the GPU launch reservation',
      releaseReservationImpact: 'What will happen',
      releaseReservationDisclosure: 'Important',
      releaseReservationConfirmButton: 'Release reservation',
      reserveReservationConfirmButton: 'Reserve GPU',
      releaseReservationCancel: 'Cancel',
      releaseReservationDone: 'Reservation updated',
      releaseReservationRefused: 'Change refused',
      releaseReservationClose: 'Close',
      gpuReleasedBadge: 'Available — not reserved',
      gpuReleasedNote: 'Available as a launch target. No GPU is reserved automatically; only your own Reserve/Release actions change that, and the choice persists across refreshes and restarts. Nothing re-applies a reservation.',
      addDirTitle: 'Scan Locations',
      addDirHint: 'The panel scans these folders on disk for GGUF files not in the managed catalog.',
      addDirUserLabel: 'Added by you',
      addDirNone: 'No custom scan folders added yet.',
      addDirReadError: 'Could not read the saved folder list',
      addDirInputLabel: 'Add a folder to scan',
      addDirInputPlaceholder: '/home/liongateos/models/my-new-models',
      addDirButton: 'Add',
      addDirBusy: 'Adding…',
      addDirSuccess: 'Folder added — refreshing discovery results…',
      addDirRefused: 'Could not add this folder',
      addDirFailed: 'Error — could not save the folder list',
      gpuSelectionTitle: 'GPU Selection',
      gpuSelectionHint: 'Launch on a specific GPU. The server must be stopped first. See profile notes for qualification status.',
      gpuSelectionReserved: 'Manually reserved — release it in My Graphics Cards to launch here.',
      serversTitle: 'Active Servers',
      serversHint: 'Two independent model servers, one per GPU. Each is started and stopped independently.',
      startOnGpu: 'Start on',
      stopOnGpu: 'Stop on',
      serverManagedBadge: 'Managed',
      serverExternalBadge: 'External',
      serverExternalNote: 'This server was not started by the Local Model Manager — stop is not available.',
      serverConfiguredGpu: 'Configured target',
      serverActualGpu: 'Actual GPU',
      serverActualGpuMismatch: 'Running GPU differs from configured target',
      serverActualGpuUnknown: 'Actual GPU unknown',
      instanceSwitchTitle: 'Switch model',
      instanceSwitchHint: 'Stop the current model and start a different one on this GPU.',
      instanceSwitchBlockedNote: 'This server was started outside the panel — switch is not available. Stop it manually, then use Start on this GPU from a model card below.',
      adoptLabel: 'Adopt',
      adoptPlanTitle: 'Before adopting this server',
      adoptImpact: 'What will happen',
      adoptUnitNote: 'Verified systemd unit',
      adoptConfirmButton: 'Adopt server',
      adoptCancel: 'Cancel',
      adoptDone: 'Server adopted',
      adoptFailed: 'Adoption failed',
      adoptRefused: 'Adoption refused',
      adoptClose: 'Close',
    }
    const zh = {
      title: '本地模型管理器',
      subtitle: '已安装的模型、显卡，以及安全的一键控制',
      loading: '正在检查本地模型…',
      loadFailed: '无法加载模型管理器',
      retry: '重试',
      renderErrorTitle: '面板渲染错误',
      renderErrorRetry: '重试',
      refresh: '刷新',
      refreshTitle: '刷新模型清单和服务器状态',
      serverStateRunning: '运行中',
      serverStateStopped: '已停止',
      serverStateError: '服务器异常',
      serverStateUnknown: '状态未知',
      runningModel: '正在运行的模型',
      liveContext: '实际使用的上下文',
      configContext: '已配置的上下文',
      configured: '配置值',
      fromRuntime: '来自运行中的服务器',
      contextPendingNote: '当前使用的上下文小于已配置的值。经您批准的重启后才会应用新的大小。',
      contextSelected: '选择的上下文',
      contextAdvertised: '模型标称上下文（来自 GGUF 文件）',
      contextConfigured: '已配置上下文（提供方配置）',
      contextHardwareCap: '硬件上下文上限',
      contextDshUsable: '预留输出与缓冲后的可会话上下文',
      contextSourceAuto: '自动选择',
      contextSourceManual: '手动覆盖',
      contextSourceUnavailable: '无可读取的上下文依据',
      contextUnknown: '无法读取',
      contextFitReduced: '运行中的服务器使用的上下文小于所选值。请停止后重新启动该模型以应用所选值；引擎在无法分配完整窗口时也可能自行缩小。',
      contextVerifyDone: '运行中的服务器正在使用所选上下文。',
      usableExhaustedNote: '已配置的输出与缓冲预留占满了整个窗口，没有剩余会话预算。',
      overrideActive: '手动上下文覆盖已生效并被原样采用。',
      busyNow: '当前有任务正在运行',
      idle: '当前没有活动任务',
      busyUnknown: '无法读取任务状态——在确认之前，停止和切换将保持拒绝',
      slots: '槽位',
      endpoint: '本地端点',
      myModels: '我的本地模型',
      modelsHint: '只显示已核实的信息：无法实时读取的数值会如实标注，而不是猜测。',
      capabilityDashboard: 'Capability Dashboard',
      capabilityDashboardHint: 'Verified configuration and disk facts are shown directly. Performance ratings remain Not measured until benchmark evidence exists.',
      capabilityEvidence: 'Evidence status',
      capabilityVerifiedFacts: 'Verified facts; performance not measured',
      capabilityPermittedGpu: 'Permitted GPU',
      capabilityTwoGpu: 'Two-GPU use',
      capabilityTwoGpuUnavailable: 'Unavailable by owner policy',
      capabilityAssessment: 'Performance assessment',
      capabilityCoding: 'Coding',
      capabilityReasoningScore: 'Reasoning',
      capabilityAgentic: 'Agentic',
      capabilityVisionScore: 'Vision quality',
      capabilityGeneralWriting: 'General / Writing',
      capabilitySpeed: 'Speed',
      capabilityBestFor: 'Best For',
      capabilityNotMeasured: 'Not measured',
      capabilityBestForPending: 'Not measured — benchmark evidence required',
      installed: '已安装',
      missing: '磁盘上缺失',
      sizeOnDisk: '文件大小',
      runtimeRunning: '正在运行',
      runtimeStopped: '已停止',
      runtimeError: '检测到问题',
      currentEngine: '服务引擎',
      engineNote: 'llama.cpp——已验证的引擎',
      gpuAll: '运行于',
      reasoning: '推理选项',
      reasoningNone: '无（按配置关闭）',
      reasoningUnknown: '无法从配置中读取',
      visionSupport: '可读取图片',
      textOnly: '仅文本',
      concurrency: '同时任务数',
      concurrencyOne: '一次一个任务（已核实：启动器以单槽位启动）',
      profiles: '运行模式',
      available: '可用',
      disabled: '不可用',
      why: '原因',
      recommended: '这个模型适合做什么',
      startLabel: '启动',
      stopLabel: '停止',
      switchLabel: '切换到这个模型',
      restoreHint: '切换失败后，可从原模型卡片重新启动上一个模型。',
      planTitle: '执行之前——请先确认',
      planImpact: '会发生什么',
      planActiveJobs: '将被中断的活动任务',
      planNoAckNeeded: '未检测到活动任务。服务器当前空闲。',
      acknowledge: '我明白这个操作会中断上面列出的任务。',
      confirmExecute: '确认执行',
      cancel: '取消',
      actionDone: '已完成',
      actionFailed: '没有成功',
      actionRefused: '面板拒绝了该操作',
      actionOutput: '启动器报告',
      close: '关闭',
      gpusTitle: '我的显卡',
      gpusHint: '不会自动保留任何显卡。将某张卡设为保留后，它会被拒绝作为启动目标，直到您自己释放；已保留卡上闲置的显存依然不代表可以使用。',
      preferredTargetBadge: '首选启动显卡',
      protectedBadge: '已保留（手动锁定）',
      protectedNote: '通过本面板手动设为保留的启动目标显卡。保留期间对它的启动请求会被拒绝；系统不会自动重新应用或移除该保留，也不会影响正在运行的工作负载。',
      generalNote: '可作为启动目标使用。系统不会自动保留任何显卡——只有您自己的"保留/释放"操作会改变这一状态，且该状态在刷新和重启后保持。',
      memUsed: '已用显存',
      memTotal: '总显存',
      util: '占用率',
      powerDraw: '功耗',
      powerNotReported: '此驱动未提供该读数',
      electricityTitle: '用电',
      electricityMeasured: '实测显卡整卡功耗',
      electricityNote: '这是驱动报告的整卡功耗，只包含显卡本身：不含 CPU、硬盘、散热与电源损耗，因此是整机实际耗电的下限。',
      electricityNow: '当前功耗',
      electricityRate: '当前电价',
      electricityPerHour: '按当前功耗计算',
      electricityJobTitle: '最近一次实测任务',
      electricityJobRunning: '正在运行',
      electricityJobEnergy: '实测电量',
      electricityJobCost: '该电量电费',
      electricityJobRuntime: '已观测时长',
      electricityJobCoverage: '实测覆盖率',
      electricitySampleUnit: '次采样',
      electricityJobPids: '使用显卡的进程号',
      electricityJobPieces: '任务内的电价变化',
      electricityAttributionExclusive: '该显卡仅被一个进程使用。',
      electricityAttributionShared: '近似值——还有其他进程在使用该显卡。',
      electricityAttributionOverlapping: '近似值——多个任务在该显卡上重叠。',
      electricityAttributionPartial: '不完整——存在测量空档，实际电量更高。',
      electricityDisabled: '能耗采样未开启。开启功耗采样后才能统计每个任务的电量。',
      electricityNoJob: '尚未实测到最近的任务。',
      gpuUnavailable: '读取这张显卡失败',
      gpuProcesses: '正在使用这张显卡的进程',
      gpuNoProcesses: '未检测到使用这张显卡的进程。',
      gpuQueryFailed: '本机无法读取显卡健康状态，因此显存数据不可用。保护规则依然完全生效。',
      enginesTitle: '服务引擎',
      engVerified: '默认可用',
      engNotConfigured: '未配置——需要先完成设置',
      errorsTitle: '最近的操作错误',
      errorsNone: '本次会话没有记录到操作错误。',
      modesTitle: '简单运行模式',
      modesHint: '选择一个模式，面板只提供真正支持它的模型和设置。',
      modeReliable: '可靠——单任务：用验证过的设置运行一个工作负载。',
      modeMultiple: '多任务：暂不可用——当前启动器每个模型只启动一个任务。需经批准的启动器升级后才会启用。',
      modeResearch: '长篇研究：上下文窗口大且已验证的模型。',
      modeAdvanced: '高级：查看真实的引擎、上下文、槽位和显卡设置及说明。',
      launchProfilesTitle: '启动配置',
      launchProfilesHint: '每个配置向可信启动器发送经过核实的命令。所有安全检查仍然生效。',
      launchProfilesEmpty: '未配置启动配置。请在 cordis.patch.yml 中添加 launchProfiles 条目以使用此功能。',
      launchLabel: '使用此配置启动',
      launchPlanTitle: '启动之前——请先确认',
      launchPlanEngine: '引擎',
      launchPlanGpu: '显卡',
      launchPlanArgs: '额外启动参数',
      launchPlanArgsNone: '无',
      launchPlanNotes: '备注',
      confirmLaunchLabel: '确认并启动',
      launchDone: '启动已开始',
      launchFailed: '启动失败',
      discoveredTitle: '磁盘上发现的模型',
      discoveredHint: '这些 GGUF 文件已在磁盘上找到，但尚未在 Harness 提供商中注册。它们暂时无法用于对话。',
      discoveredCandidate: '候选',
      discoveredMultiPart: '多分片',
      discoveredNone: '磁盘上未发现新的 GGUF 文件。',
      discoveredScanError: '部分目录无法完整扫描。',
      discoveredPath: '文件',
      discoveredShards: '总分片数',
      discoveredNote: '要使用此模型，请将其在 Harness 提供商中注册并添加到托管目录。',
      gpuComputeMode: '计算模式',
      gpuComputeModeLocked: '已锁定（EXCLUSIVE_PROCESS）',
      gpuComputeModeUnlocked: '已解锁（DEFAULT）',
      gpuComputeModeProhibited: '已禁止（在本面板外设置）',
      gpuComputeModeExclusiveThread: '独占线程（在本面板外设置）',
      gpuComputeModeUnknown: '未知模式',
      gpuComputeModeUnavailable: '无法读取',
      gpuLockButton: '锁定（EXCLUSIVE_PROCESS）',
      gpuUnlockButton: '解锁（DEFAULT）',
      gpuLockPlanTitle: '更改显卡计算模式之前',
      gpuLockPlanImpact: '将会发生什么',
      gpuLockDisclosureTitle: '必要说明',
      gpuLockConfirmButton: '确认并应用',
      gpuLockCancel: '取消',
      gpuLockDone: '计算模式已更改',
      gpuLockPartial: '命令已执行——回读显示的是不同模式',
      gpuLockPartialDetail: '驱动程序可能拒绝了更改，或回读结果是旧的。',
      gpuLockFailed: '计算模式更改失败',
      gpuLockPermissionDenied: '权限不足——更改计算模式需要提升权限',
      gpuLockRefused: '更改被拒绝',
      gpuLockActualMode: '更改后的实际模式',
      gpuLockClose: '关闭',
      releaseReservationButton: '释放保留',
      reserveButton: '设为保留启动目标',
      reservationPlanTitle: '更改显卡启动保留之前',
      releaseReservationImpact: '将会发生什么',
      releaseReservationDisclosure: '重要说明',
      releaseReservationConfirmButton: '释放保留',
      reserveReservationConfirmButton: '保留该显卡',
      releaseReservationCancel: '取消',
      releaseReservationDone: '保留状态已更新',
      releaseReservationRefused: '操作被拒绝',
      releaseReservationClose: '关闭',
      gpuReleasedBadge: '可用——未保留',
      gpuReleasedNote: '可作为启动目标。系统不会自动保留任何显卡；只有您自己的"保留/释放"操作会改变该状态，且该状态在刷新和重启后保持，不会自动重新应用。',
      addDirTitle: '扫描位置',
      addDirHint: '面板会扫描这些文件夹，查找未在托管目录中注册的 GGUF 文件。',
      addDirUserLabel: '您添加的',
      addDirNone: '尚未添加自定义扫描文件夹。',
      addDirReadError: '无法读取已保存的文件夹列表',
      addDirInputLabel: '添加扫描文件夹',
      addDirInputPlaceholder: '/home/liongateos/models/my-new-models',
      addDirButton: '添加',
      addDirBusy: '添加中…',
      addDirSuccess: '文件夹已添加——正在刷新发现结果…',
      addDirRefused: '无法添加此文件夹',
      addDirFailed: '错误——无法保存文件夹列表',
      gpuSelectionTitle: 'GPU 选择',
      gpuSelectionHint: '在指定 GPU 上启动。服务器必须先停止。配置说明见各配置的备注。',
      gpuSelectionReserved: '已手动保留——请先在"我的显卡"中释放才能在此启动。',
      serversTitle: '运行中的服务',
      serversHint: '两个独立的模型服务，每张 GPU 各一个，可以分别启动和停止。',
      startOnGpu: '在此启动',
      stopOnGpu: '停止',
      serverManagedBadge: '已托管',
      serverExternalBadge: '外部启动',
      serverExternalNote: '此服务不是由本地模型管理器启动的——停止操作不可用。',
      serverConfiguredGpu: '配置目标',
      serverActualGpu: '实际 GPU',
      serverActualGpuMismatch: '运行中的 GPU 与配置目标不同',
      serverActualGpuUnknown: '实际 GPU 未知',
      instanceSwitchTitle: '切换模型',
      instanceSwitchHint: '停止当前模型并在此 GPU 上启动另一个模型。',
      instanceSwitchBlockedNote: '此服务器在面板外部启动——切换不可用。请手动停止它，然后从下方的模型卡片使用"在此 GPU 上启动"。',
      adoptLabel: '接管',
      adoptPlanTitle: '接管此服务前',
      adoptImpact: '将会发生什么',
      adoptUnitNote: '已核实的 systemd 单元',
      adoptConfirmButton: '确认接管',
      adoptCancel: '取消',
      adoptDone: '服务已接管',
      adoptFailed: '接管失败',
      adoptRefused: '接管被拒绝',
      adoptClose: '关闭',
    }

    /** Format one byte count; a non-number stays null (never invented). */
    const fmtBytes = (bytes) => {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
      return `${(bytes / (1024 ** 3)).toFixed(1)} GiB`
    }
    /** Format one number for display; a non-number stays null. */
    const fmtNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : null)

    /**
     * Format one card's live wattage. `power.draw.instant` is a running value,
     * so it keeps one decimal; an unreadable draw says so instead of showing a
     * fabricated number, and a readable limit is still named alongside it.
     * @param {{powerDrawW?: number|null, powerLimitW?: number|null}} g one GPU row.
     * @param {function} t locale lookup.
     * @returns {string} display text for the power row.
     */
    const fmtPower = (g, t) => {
      const limit = typeof g.powerLimitW === 'number' && Number.isFinite(g.powerLimitW)
        ? `${fmtNum(g.powerLimitW)} W limit`
        : null
      if (typeof g.powerDrawW === 'number' && Number.isFinite(g.powerDrawW)) {
        const draw = `${g.powerDrawW.toFixed(1)} W`
        return limit === null ? draw : `${draw} / ${limit}`
      }
      return limit === null ? t('powerNotReported') : `${t('powerNotReported')} / ${limit}`
    }

    /** Format watt-hours; sub-1 Wh keeps two decimals so a short job is not shown as zero. */
    const fmtWh = (wh) => {
      if (typeof wh !== 'number' || !Number.isFinite(wh)) return null
      return `${wh < 1 ? wh.toFixed(2) : wh.toFixed(1)} Wh`
    }

    /** Format a cent amount; below one cent keeps four decimals so a tiny job is not shown as zero. */
    const fmtCents = (cents) => {
      if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
      if (cents === 0) return '\u00a20.00'
      return `\u00a2${cents < 0.01 ? cents.toFixed(4) : cents.toFixed(2)}`
    }

    /** Format an ISO instant as a short local time; an unparseable value is shown as-is. */
    const fmtInstant = (iso) => {
      if (typeof iso !== 'string') return null
      const parsed = Date.parse(iso)
      if (!Number.isFinite(parsed)) return iso
      return new Date(parsed).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    /** Format a rate in cents per kWh. */
    const fmtRate = (centsPerKwh) => (typeof centsPerKwh === 'number' && Number.isFinite(centsPerKwh)
      ? `${centsPerKwh.toFixed(1)} \u00a2/kWh`
      : null)

    /** Format a coverage fraction as a percentage. */
    const fmtPct = (fraction) => (typeof fraction === 'number' && Number.isFinite(fraction)
      ? `${Math.round(fraction * 100)} %`
      : null)

    /** Format a duration in seconds as a short human span. */
    const fmtDuration = (seconds) => {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
      if (seconds < 90) return `${seconds.toFixed(1)} s`
      const minutes = Math.floor(seconds / 60)
      const rest = Math.round(seconds % 60)
      return `${minutes} min ${rest} s`
    }

    /**
     * The electricity card: the current rate, the live draw, and the measured
     * energy and cost of the job the sampler observed. Every figure names its
     * measurement class; an incomplete or shared measurement says so instead of
     * presenting a number that looks exact.
     * @param {{electricity: object|null, t: function}} props the snapshot block and locale lookup.
     */
    const ElectricityCard = ({ electricity, t }) => {
      if (electricity === undefined || electricity === null) return null
      const e = electricity
      const job = e.job ?? null
      const attributionKey = job === null
        ? null
        : { exclusive: 'electricityAttributionExclusive', shared: 'electricityAttributionShared', 'overlapping-jobs': 'electricityAttributionOverlapping', partial: 'electricityAttributionPartial' }[job.attribution] ?? null
      const rateLabel = e.tariff === undefined || e.tariff === null
        ? null
        : `${e.tariff.period} · ${fmtRate(e.tariff.centsPerKwh)}`
      const drawValue = e.powerDrawW === null || e.powerDrawW === undefined
        ? null
        : (e.powerLimitW === null || e.powerLimitW === undefined
          ? `${e.powerDrawW.toFixed(1)} W`
          : `${e.powerDrawW.toFixed(1)} W / ${fmtNum(e.powerLimitW)} W limit`)
      return card({},
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('strong', null, t('electricityTitle')),
          pill(t('electricityMeasured'), 'var(--dsw-static-blue-500, blue)')),
        h('div', { style: { margin: '8px 0' } },
          row(t('electricityNow'), drawValue ?? t('powerNotReported')),
          row(t('electricityRate'), rateLabel),
          row(t('electricityPerHour'), fmtCents(e.centsPerHour)),
          e.sampling === undefined || e.sampling === null || e.sampling.enabled !== true
            ? row(t('electricityJobTitle'), t('electricityDisabled'))
            : job === null
              ? row(t('electricityJobTitle'), t('electricityNoJob'))
              : [
                row(t('electricityJobTitle'), job.open === true ? t('electricityJobRunning') : fmtInstant(job.startedAt)),
                row(t('electricityJobEnergy'), fmtWh(job.energyWh)),
                row(t('electricityJobCost'), fmtCents(job.costCents)),
                row(t('electricityJobRuntime'), fmtDuration(job.runtimeS)),
                row(t('electricityJobCoverage'), `${fmtPct(job.coverage)} · ${fmtNum(job.sampleCount)} ${t('electricitySampleUnit')}`),
                row(t('electricityJobPids'), (job.distinctPids ?? []).join(', ')),
                (job.tariffPieces ?? []).length > 1
                  ? row(t('electricityJobPieces'), job.tariffPieces
                    .map((piece) => `${piece.period} ${fmtWh(piece.wh)} @ ${fmtRate(piece.centsPerKwh)}`)
                    .join(' · '))
                  : null,
              ]),
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } }, t('electricityNote')),
        job !== null && job.approximate === true && attributionKey !== null ? warnNote(t(attributionKey)) : null,
        job !== null && job.approximate !== true && attributionKey !== null
          ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } }, t(attributionKey))
          : null)
    }

    const card = (style, ...children) => h('div', {
      style: {
        border: '1px solid var(--dsw-alias-border-strong, transparent)',
        borderRadius: '12px',
        padding: '16px',
        margin: '8px 0',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        ...style,
      },
    }, ...children)
    const heading = (text) => h('h3', { style: { margin: '16px 0 4px 0', fontSize: '15px' } }, text)
    const row = (label, value) => h('div', { style: { display: 'flex', gap: '8px', lineHeight: '1.6' } },
      h('span', { style: { color: 'var(--dsw-alias-label-secondary, gray)', minWidth: '150px' } }, label),
      h('span', null, value ?? '—'))
    const warnNote = (text) => h('div', {
      style: { fontSize: '12px', color: 'var(--dsw-static-orange-500, orange)', margin: '2px 0' },
    }, text)
    const pill = (text, color) => h('span', {
      style: {
        display: 'inline-block', padding: '1px 8px', borderRadius: '999px',
        fontSize: '12px', border: `1px solid ${color}`, color,
      },
    }, text)
    const button = (label, onClick, { danger = false, disabled = false, primary = false, title } = {}) => h('button', {
      onClick,
      disabled,
      title,
      style: {
        padding: '5px 12px', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
        border: '1px solid var(--dsw-alias-border-strong, gray)',
        background: primary ? 'var(--dsw-alias-bg-accent, transparent)' : 'transparent',
        color: danger ? 'var(--dsw-static-red-500, red)' : 'inherit',
        opacity: disabled ? 0.5 : 1,
        marginRight: '8px',
      },
    }, label)

    /** Sidebar glyph (decorative; the sidebar owns the accessible label). */
    const PanelIcon = () => h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true },
      h('rect', { x: 3, y: 4, width: 18, height: 7, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
      h('rect', { x: 3, y: 14, width: 8, height: 6, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
      h('circle', { cx: 17, cy: 17, r: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }))

    // CAPABILITY DASHBOARD V1 — verified facts only.
    // Performance scores deliberately remain "Not measured" until Model Advisor
    // has benchmark-backed evidence. Do not infer a score from model size,
    // architecture, marketing labels, or configuration metadata.
    const CapabilityDashboard = ({ models, t }) => {
      const list = Array.isArray(models) ? models : []
      const notMeasured = t('capabilityNotMeasured')

      return h('div', { 'data-lmm-capability-dashboard-v1': 'true' },
        heading(t('capabilityDashboard')),
        h('div', {
          style: {
            color: 'var(--dsw-alias-label-secondary, gray)',
            fontSize: '13px',
            marginBottom: '8px',
          },
        }, t('capabilityDashboardHint')),

        ...list.map((m) => {
          const selectedContext =
            typeof m.context?.selected === 'number'
              ? fmtNum(m.context.selected)
              : typeof m.configContext === 'number'
                ? fmtNum(m.configContext)
                : t('contextUnknown')

          const reasoning =
            Array.isArray(m.reasoningEfforts)
              ? (m.reasoningEfforts.length === 0
                  ? t('reasoningNone')
                  : m.reasoningEfforts.join(', '))
              : t('reasoningUnknown')

          const size =
            m.installed === true && m.diskBytes !== undefined
              ? fmtBytes(m.diskBytes)
              : t('contextUnknown')

          const permittedGpu =
            typeof m.gpu?.name === 'string' && m.gpu.name.length > 0
              ? m.gpu.name
              : t('contextUnknown')

          return card(
            { key: `capability-${m.key}` },

            h('div', {
              style: {
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                flexWrap: 'wrap',
              },
            },
              h('strong', { style: { fontSize: '15px' } }, m.name),
              pill(
                t('capabilityVerifiedFacts'),
                'var(--dsw-static-green-500, green)',
              ),
            ),

            h('div', { style: { margin: '8px 0' } },
              row(t('sizeOnDisk'), size),
              row(t('contextSelected'), selectedContext),
              row(t('reasoning'), reasoning),
              row(
                t('capabilityVisionScore'),
                m.vision === true ? t('visionSupport') : t('textOnly'),
              ),
              row(t('capabilityPermittedGpu'), permittedGpu),
              row(t('capabilityTwoGpu'), t('capabilityTwoGpuUnavailable')),
              row(t('capabilityEvidence'), t('capabilityVerifiedFacts')),
            ),

            h('div', {
              style: {
                fontWeight: 600,
                margin: '8px 0 4px 0',
              },
            }, t('capabilityAssessment')),

            row(t('capabilityCoding'), notMeasured),
            row(t('capabilityReasoningScore'), notMeasured),
            row(t('capabilityAgentic'), notMeasured),
            row(t('capabilityVisionScore'), notMeasured),
            row(t('capabilityGeneralWriting'), notMeasured),
            row(t('capabilitySpeed'), notMeasured),
            row(t('capabilityBestFor'), t('capabilityBestForPending')),
          )
        }),
      )
    }

    /**
     * One model card: verified facts, plain-language recommendations, the
     * four operating profiles, GPU selection (when profiles are configured),
     * and its plan-then-confirm action buttons. In multi-instance mode (`servers`
     * present), Start shows one button per stopped instance; Stop is available
     * when the model is running on any instance.
     * @param {{m: object, t: function, onAction: function, gpuProfiles: Array<object>, onLaunch: function, reservedUuids: Set<string>, servers: Array<object>|null}} props.
     */
    const ModelCard = ({ m, t, onAction, gpuProfiles, onLaunch, reservedUuids, servers }) => {
      const label = (key) => t(key)
      const running = m.runtime === 'running'
      return card({},
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
          h('strong', { style: { fontSize: '15px' } }, m.name),
          m.installed === true ? pill(label('installed'), 'var(--dsw-static-green-500, green)') : pill(label('missing'), 'var(--dsw-static-red-500, red)'),
          running ? pill(label('runtimeRunning'), 'var(--dsw-static-green-500, green)')
            : m.runtime === 'error' ? pill(label('runtimeError'), 'var(--dsw-static-red-500, red)')
              : pill(label('runtimeStopped'), 'var(--dsw-alias-label-secondary, gray)')),
        h('div', { style: { margin: '8px 0' } },
          row(label('currentEngine'), `${m.engine.id} · ${m.engine.note}`),
          row(label('configContext'), typeof m.configContext === 'number' ? `${fmtNum(m.configContext)} (${label('configured')})` : label('reasoningUnknown')),
          running && typeof m.liveContext === 'number' ? row(label('liveContext'), `${fmtNum(m.liveContext)} (${label('fromRuntime')})`) : null,
          typeof m.context === 'object' && m.context !== null ? h('div', { style: { margin: '4px 0' } },
            row(label('contextSelected'), typeof m.context.selected === 'number'
              ? `${fmtNum(m.context.selected)} (${m.context.source === 'manual' ? label('contextSourceManual') : label('contextSourceAuto')})`
              : label('contextSourceUnavailable')),
            typeof m.context.advertised === 'number' ? row(label('contextAdvertised'), fmtNum(m.context.advertised)) : null,
            typeof m.context.configured === 'number' ? row(label('contextConfigured'), fmtNum(m.context.configured)) : null,
            typeof m.context.hardwareCap === 'number' ? row(label('contextHardwareCap'), fmtNum(m.context.hardwareCap)) : null,
            typeof m.context.dshUsable === 'number' ? row(label('contextDshUsable'), fmtNum(m.context.dshUsable)) : null,
            m.context.dshUsableExhausted === true ? warnNote(label('usableExhaustedNote')) : null,
            m.context.override !== undefined ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-static-blue-500, blue)', margin: '2px 0' } }, label('overrideActive')) : null,
            Array.isArray(m.context.reasons) && m.context.reasons.length > 0
              ? h('ul', { style: { margin: '4px 0', paddingLeft: '20px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } },
                  ...m.context.reasons.map((reason, i) => h('li', { key: i }, reason)))
              : null,
            running && typeof m.context.live === 'number' && typeof m.context.selected === 'number' && m.context.live !== m.context.selected
              ? warnNote(label('contextFitReduced'))
              : running && typeof m.context.live === 'number' && m.context.selected !== undefined && m.context.live === m.context.selected
                ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-static-green-500, green)', margin: '2px 0' } }, label('contextVerifyDone'))
                : null) : null,
          m.installed === true && m.diskBytes !== undefined ? row(label('sizeOnDisk'), fmtBytes(m.diskBytes)) : null,
          row(label('gpuAll'), m.gpu.name),
          row(label('reasoning'), Array.isArray(m.reasoningEfforts)
            ? (m.reasoningEfforts.length === 0 ? label('reasoningNone') : m.reasoningEfforts.join(', '))
            : label('reasoningUnknown')),
          row(label('concurrency'), label('concurrencyOne')),
          row('', m.vision === true ? label('visionSupport') : label('textOnly')),
          m.installed === false && m.installProblem !== undefined
            ? h('div', { style: { color: 'var(--dsw-static-red-500, red)', margin: '6px 0' } }, m.installProblem) : null),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontWeight: 600 } }, label('recommended')),
        h('ul', { style: { margin: '4px 0 8px 0', paddingLeft: '20px' } },
          ...(m.recommendations ?? []).map((note, i) => h('li', { key: i }, note))),
        h('div', { style: { fontWeight: 600, margin: '8px 0 4px 0' } }, label('profiles')),
        ...(m.profiles ?? []).map((p) => h('div', {
          key: p.id,
          style: { padding: '6px 8px', border: '1px solid var(--dsw-alias-border-strong, transparent)', borderRadius: '8px', margin: '4px 0', opacity: p.available ? 1 : 0.8 },
        },
          pill(p.available ? label('available') : label('disabled'), p.available ? 'var(--dsw-static-green-500, green)' : 'var(--dsw-alias-label-secondary, gray)'),
          ' ',
          h('strong', null, p.label),
          h('div', { style: { fontSize: '13px' } }, p.reason),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } }, `${label('why')}: ${p.requirement}`),
          p.pendingRestart === true ? h('div', { style: { fontSize: '12px' } }, label('contextPendingNote')) : null)),
        Array.isArray(gpuProfiles) && gpuProfiles.length > 0
          ? h('div', { style: { margin: '10px 0 0 0' } },
              h('div', { style: { fontWeight: 600, margin: '8px 0 2px 0' } }, label('gpuSelectionTitle')),
              h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '12px', marginBottom: '6px' } }, label('gpuSelectionHint')),
              ...gpuProfiles.map((profile) => {
                const needsRelease = Array.isArray(profile.gpuUuids) && profile.gpuUuids.some((uuid) => reservedUuids.has(uuid))
                return h('div', { key: profile.profileId, style: { margin: '3px 0' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                    button(profile.gpuName ?? profile.label, () => onLaunch && onLaunch(profile), { disabled: needsRelease }),
                    needsRelease
                      ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } }, label('gpuSelectionReserved'))
                      : null),
                  profile.notes !== undefined
                    ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)', marginTop: '2px', marginLeft: '4px' } }, profile.notes)
                    : null)
              }))
          : null,
        Array.isArray(servers) && servers.length > 0
          ? h('div', { style: { margin: '10px 0 0 0' } },
              // Multi-instance: show "Start on [GPU]" for each stopped instance.
              ...servers.filter((srv) => srv.state === 'stopped').map((srv) =>
                button(`${label('startOnGpu')} ${srv.gpuName}`, () => onAction('start', m, srv.port), { disabled: !m.installed })),
              // Per-instance Stop buttons — one per port where this model is running.
              // Each button passes the exact instancePort so the correct server is targeted.
              ...(Array.isArray(m.runningOnPorts) ? m.runningOnPorts : []).map((port) => {
                const srv = servers.find((s) => s.port === port)
                return button(`${label('stopOnGpu')} ${srv?.gpuName ?? String(port)}`, () => onAction('stop', m, port), { danger: true, disabled: srv?.owned === false })
              }))
          : h('div', { style: { margin: '10px 0 0 0' } },
              button(label('startLabel'), () => onAction('start', m), { disabled: !m.installed || running }),
              button(label('switchLabel'), () => onAction('switch', m), { disabled: !m.installed || running || m.runtime === 'error' }),
              button(label('stopLabel'), () => onAction('stop', m), { disabled: !running, danger: true })),
        running === false ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)', marginTop: '4px' } }, label('restoreHint')) : null,
      )
    }

    /** Map a compute mode value to a display label key. */
    const computeModeLabel = (mode, t) => {
      if (mode === 'locked') return t('gpuComputeModeLocked')
      if (mode === 'unlocked') return t('gpuComputeModeUnlocked')
      if (mode === 'prohibited') return t('gpuComputeModeProhibited')
      if (mode === 'exclusive_thread') return t('gpuComputeModeExclusiveThread')
      if (mode === null || mode === undefined) return t('gpuComputeModeUnavailable')
      return t('gpuComputeModeUnknown')
    }

    /**
     * GPU lock plan/confirm dialog. Handles refused, planned, ok, partial,
     * failed, and permission-denied outcomes.
     * @param {{plan: object|null, t: function, onConfirm: function, onClose: function}} props.
     */
    const GpuLockDialog = ({ plan, t, onConfirm, onClose }) => {
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('gpuLockRefused')),
            h('p', null, plan.reason),
            button(t('gpuLockClose'), onClose)))
      }
      if (plan.status === 'ok') {
        return overlay(
          card({},
            h('h4', { style: { marginTop: 0 } }, t('gpuLockDone')),
            h('p', null, plan.gpuName),
            row(t('gpuLockActualMode'), computeModeLabel(plan.actualMode, t)),
            typeof plan.output === 'string' && plan.output.length > 0
              ? h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '120px', overflow: 'auto' } }, plan.output)
              : null,
            button(t('gpuLockClose'), onClose)))
      }
      if (plan.status === 'partial') {
        return overlay(
          card({},
            h('h4', { style: { marginTop: 0 } }, t('gpuLockPartial')),
            h('p', null, t('gpuLockPartialDetail')),
            h('p', null, plan.warning),
            row(t('gpuLockActualMode'), computeModeLabel(plan.actualMode, t)),
            button(t('gpuLockClose'), onClose)))
      }
      if (plan.status === 'permission-denied') {
        return overlay(
          card({},
            h('h4', { style: { marginTop: 0 } }, t('gpuLockFailed')),
            h('p', null, t('gpuLockPermissionDenied')),
            h('p', null, plan.error),
            button(t('gpuLockClose'), onClose)))
      }
      if (plan.status === 'failed') {
        return overlay(
          card({},
            h('h4', { style: { marginTop: 0 } }, t('gpuLockFailed')),
            h('p', null, plan.error),
            button(t('gpuLockClose'), onClose)))
      }
      if (plan.status !== 'planned') return null
      return overlay(
        card({ maxWidth: '620px', width: '90%' },
          h('h4', { style: { marginTop: 0 } }, t('gpuLockPlanTitle')),
          h('div', { style: { fontWeight: 600 } }, t('gpuLockPlanImpact')),
          h('p', null, plan.impact),
          h('div', { style: { fontWeight: 600, marginTop: '10px' } }, t('gpuLockDisclosureTitle')),
          h('ul', { style: { fontSize: '13px', paddingLeft: '18px' } },
            ...(plan.disclosure ?? []).map((item, i) => h('li', { key: i, style: { marginBottom: '4px' } }, item))),
          h('div', { style: { marginTop: '12px' } },
            button(t('gpuLockConfirmButton'), () => onConfirm(plan.confirmToken), { primary: true }),
            button(t('gpuLockCancel'), onClose))))
    }

    /**
     * Manual GPU launch reservation plan/confirm dialog. Generic for every
     * allowlisted GPU and both directions (reserve / release). The plan's
     * `desired` field picks the confirm button; the persisted-state guarantee
     * is part of the service disclosure.
     * @param {{plan: object|null, t: function, onConfirm: function, onClose: function}} props.
     */
    const ReservationDialog = ({ plan, t, onConfirm, onClose }) => {
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('releaseReservationRefused')),
            h('p', null, plan.reason),
            button(t('releaseReservationClose'), onClose)))
      }
      if (plan.status === 'ok') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('releaseReservationDone')),
            h('p', null, plan.message),
            button(t('releaseReservationClose'), onClose)))
      }
      if (plan.status !== 'planned') return null
      const confirmingRelease = plan.desired !== 'reserved'
      return overlay(
        card({ maxWidth: '620px', width: '90%' },
          h('h4', { style: { marginTop: 0 } }, t('reservationPlanTitle')),
          h('div', { style: { fontWeight: 600 } }, t('releaseReservationImpact')),
          h('p', null, plan.impact),
          h('div', { style: { fontWeight: 600, marginTop: '10px' } }, t('releaseReservationDisclosure')),
          h('p', { style: { fontSize: '13px' } }, plan.disclosure),
          h('div', { style: { marginTop: '12px' } },
            button(confirmingRelease ? t('releaseReservationConfirmButton') : t('reserveReservationConfirmButton'),
              () => onConfirm(plan.confirmToken), { primary: true, danger: confirmingRelease }),
            button(t('releaseReservationCancel'), onClose))))
    }

    /**
     * One GPU card: live facts, compute-mode lock controls, and the generic
     * manual launch-reservation control (reserve when unreserved, release when
     * reserved — the owner's choice persists; nothing is reserved by default).
     * @param {{g: object, t: function, onLock: function, onReserve: function}} props.
     */
    const GpuCard = ({ g, t, onLock, onReserve }) => card({},
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('strong', null, g.name),
        g.preferredLaunchTarget === true ? pill(t('preferredTargetBadge'), 'var(--dsw-static-blue-500, blue)') : null,
        g.launchReserved === true
          ? pill(t('protectedBadge'), 'var(--dsw-static-red-500, red)')
          : pill(t('gpuReleasedBadge'), 'var(--dsw-static-green-500, green)')),
      h('div', { style: { margin: '8px 0' } },
        row('UUID', g.uuid),
        g.status === 'ok' ? row(t('memUsed'), `${fmtNum(g.memUsedMiB)} MiB`) : null,
        g.status === 'ok' ? row(t('memTotal'), `${fmtNum(g.memTotalMiB)} MiB`) : null,
        g.status === 'ok' && typeof g.utilizationPct === 'number' ? row(t('util'), `${g.utilizationPct} %`) : null,
        g.status === 'ok' ? row(t('powerDraw'), fmtPower(g, t)) : null,
        g.status !== 'ok' ? row(t('gpuUnavailable'), g.error) : null,
        row(t('gpuComputeMode'), computeModeLabel(g.computeMode ?? null, t)),
        row(t('gpuProcesses'), (g.processes ?? []).length === 0
          ? t('gpuNoProcesses')
          : (g.processes ?? []).map((p) => `PID ${fmtNum(p.pid) ?? '?'} · ${p.processName}`).join(', '))),
      h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, gray)' } },
        g.launchReserved === true ? t('protectedNote') : t('generalNote')),
      h('div', { style: { marginTop: '10px' } },
        button(t('gpuLockButton'), () => onLock(g.uuid, 'locked'), { disabled: g.computeMode === 'locked' || g.computeModeStatus === 'unavailable' }),
        button(t('gpuUnlockButton'), () => onLock(g.uuid, 'unlocked'), { disabled: g.computeMode === 'unlocked' || g.computeModeStatus === 'unavailable' }),
        g.launchReserved === true
          ? button(t('releaseReservationButton'), () => onReserve(g.uuid, 'unreserved'), { danger: true })
          : button(t('reserveButton'), () => onReserve(g.uuid, 'reserved'))))

    /**
     * The plan/confirm dialog. States: refused (reason only), planned (impact
     * + active jobs + required acknowledgment + confirm/cancel), and the
     * executed outcome (done or failed with the real launcher report).
     * @param {{plan: object|null, t: function, onConfirm: function, onClose: function}} props.
     */
    const PlanDialog = ({ plan, t, onConfirm, onClose }) => {
      const [ack, setAck] = React.useState(false)
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('actionRefused')),
            h('p', null, plan.reason),
            button(t('close'), onClose)))
      }
      if (plan.status === 'ok' || plan.status === 'failed') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, plan.status === 'ok' ? t('actionDone') : t('actionFailed')),
            plan.explanation !== undefined ? h('p', null, plan.explanation) : null,
            plan.timedOut === true ? h('p', null, t('busyUnknown')) : null,
            plan.reason !== undefined ? h('p', null, plan.reason) : null,
            typeof plan.output === 'string' && plan.output.length > 0
              ? h('div', null,
                h('div', { style: { fontWeight: 600, margin: '4px 0' } }, t('actionOutput')),
                h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '200px', overflow: 'auto' } }, plan.output))
              : null,
            button(t('close'), onClose)))
      }
      if (plan.status !== 'planned') return null
      const jobs = plan.activeJobs ?? []
      return overlay(
        card({ maxWidth: '620px', width: '90%' },
          h('h4', { style: { marginTop: 0 } }, t('planTitle')),
          h('div', { style: { fontWeight: 600 } }, t('planImpact')),
          h('p', null, plan.impact),
          h('div', { style: { fontWeight: 600 } }, t('planActiveJobs')),
          jobs.length === 0
            ? h('p', null, t('planNoAckNeeded'))
            : h('ul', null, ...jobs.map((job, i) => h('li', { key: i }, `${t('busyNow')}${job.task !== undefined ? ` (${job.task})` : ''}`))),
          plan.requiresAcknowledge === true
            ? h('label', { style: { display: 'block', margin: '8px 0' } },
              h('input', { type: 'checkbox', checked: ack, onChange: (e) => setAck(e.target.checked) }),
              ` ${t('acknowledge')}`)
            : null,
          h('div', { style: { marginTop: '10px' } },
            button(t('confirmExecute'), () => onConfirm(plan.confirmToken, plan.requiresAcknowledge === true ? { acknowledgeInterruption: true } : {}), { disabled: plan.requiresAcknowledge === true && ack === false, primary: true }),
            button(t('cancel'), onClose))))
    }

    /**
     * The launch plan/confirm dialog. States: refused (reason only), ok/failed
     * (real launcher report), planned (engine/GPU/args preview + confirm/cancel).
     * @param {{plan: object|null, t: function, onConfirm: function, onClose: function}} props.
     */
    const LaunchPlanDialog = ({ plan, t, onConfirm, onClose }) => {
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('actionRefused')),
            h('p', null, plan.reason),
            button(t('close'), onClose)))
      }
      if (plan.status === 'ok' || plan.status === 'failed') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, plan.status === 'ok' ? t('launchDone') : t('launchFailed')),
            plan.explanation !== undefined ? h('p', null, plan.explanation) : null,
            plan.timedOut === true ? h('p', null, t('busyUnknown')) : null,
            plan.reason !== undefined ? h('p', null, plan.reason) : null,
            typeof plan.output === 'string' && plan.output.length > 0
              ? h('div', null,
                h('div', { style: { fontWeight: 600, margin: '4px 0' } }, t('actionOutput')),
                h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '200px', overflow: 'auto' } }, plan.output))
              : null,
            button(t('close'), onClose)))
      }
      if (plan.status !== 'planned') return null
      const args = Array.isArray(plan.launchArgs) && plan.launchArgs.length > 0 ? plan.launchArgs.join(' ') : t('launchPlanArgsNone')
      return overlay(
        card({ maxWidth: '620px', width: '90%' },
          h('h4', { style: { marginTop: 0 } }, t('launchPlanTitle')),
          h('p', null, plan.impact),
          h('div', { style: { margin: '8px 0' } },
            row(t('launchPlanEngine'), `${plan.engineId} ${plan.engineVersion}`),
            row(t('launchPlanGpu'), plan.gpuName),
            row(t('launchPlanArgs'), args),
            plan.notes !== undefined ? row(t('launchPlanNotes'), plan.notes) : null),
          h('div', { style: { marginTop: '10px' } },
            button(t('confirmLaunchLabel'), () => onConfirm(plan.confirmToken), { primary: true }),
            button(t('cancel'), onClose))))
    }

    /**
     * One launch profile card: label, engine, model, GPU, and a launch button.
     * @param {{profile: object, t: function, onLaunch: function}} props.
     */
    const LaunchProfileCard = ({ profile, t, onLaunch }) => card({},
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
        h('strong', { style: { fontSize: '14px' } }, profile.label)),
      h('div', { style: { margin: '6px 0' } },
        row(t('launchPlanEngine'), `${profile.engineId} ${profile.engineVersion}`),
        row(t('runningModel'), profile.modelName),
        row(t('launchPlanGpu'), profile.gpuName),
        (Array.isArray(profile.launchArgs) && profile.launchArgs.length > 0)
          ? row(t('launchPlanArgs'), profile.launchArgs.join(' ')) : null),
      h('div', { style: { marginTop: '8px' } },
        button(t('launchLabel'), () => onLaunch(profile))))

    /**
     * One discovered-candidate card. Read-only: no action buttons. Shows path,
     * size, shard count, and a note explaining the model is not yet registered.
     * @param {{c: object, t: function}} props.
     */
    const DiscoveredModelCard = ({ c, t }) => card({},
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
        h('strong', { style: { fontSize: '14px' } }, c.name),
        pill(t('discoveredCandidate'), 'var(--dsw-alias-label-secondary, gray)'),
        c.multiPart === true ? pill(t('discoveredMultiPart'), 'var(--dsw-alias-label-secondary, gray)') : null),
      h('div', { style: { margin: '6px 0' } },
        row(t('discoveredPath'), c.path),
        row(t('sizeOnDisk'), fmtBytes(c.sizeBytes)),
        c.multiPart === true ? row(t('discoveredShards'), String(c.totalShards)) : null),
      h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)', marginTop: '4px' } }, t('discoveredNote')))

    /**
     * First-class Strata model controls. Actions delegate to the existing Strata
     * selector/service through the host-side plan/confirm safety boundary.
     */
    const StrataSection = ({ strata, onStrataAction }) => {
      if (strata === undefined || strata === null) return null
      const selectedId = strata.modelSelection?.status === 'ok' ? strata.modelSelection.id : null
      const selectedGpu = strata.gpuSelection?.status === 'ok' ? strata.gpuSelection.key : null
      const endpointState = Array.isArray(strata.observedEndpoints)
        ? strata.observedEndpoints.find((e) => e.port === 8080)
        : null
      const running = endpointState?.state === 'running'

      return h('div', null,
        heading('Strata Models'),
        h('div', {
          style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' },
        }, 'Start, switch, and stop Strata here. These controls reuse the existing Strata service and presets; Local Model Manager applies its normal safety and GPU-reservation checks first.'),
        ...(strata.installedModels ?? []).map((m) => card({ key: m.id },
          h('div', {
            style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
          },
            h('strong', null, m.name),
            selectedId === m.id
              ? pill(running ? 'Active in Strata' : 'Selected in Strata', 'var(--dsw-static-green-500, green)')
              : pill('Installed', 'var(--dsw-alias-label-secondary, gray)')),
          h('div', { style: { marginTop: '6px' } },
            row('Model ID', m.id),
            row('Context', fmtNum(m.contextWindow)),
            row('Vision', m.vision === true ? 'Reads images' : 'Text only')),
          h('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            ...(strata.gpuTargets ?? []).map((target) => {
              const activeHere = running && selectedId === m.id && selectedGpu === target.mode
              if (activeHere) {
                return pill(`Active — ${target.label}`, 'var(--dsw-static-green-500, green)')
              }
              if (target.available === false) {
                return pill(`Reserved — ${target.label}`, 'var(--dsw-alias-label-secondary, gray)')
              }
              return button(`Start on ${target.label}`, () =>
                onStrataAction('activate', { modelId: m.id, gpuMode: target.mode }))
            })))),
        card({},
          row('Authority', strata.authority ?? 'Strata Control Panel'),
          row('Control from this panel', 'Start / Switch / Stop through Strata'),
          row('Selected model',
            strata.modelSelection?.status === 'ok'
              ? strata.modelSelection.name
              : `Unavailable — ${strata.modelSelection?.error ?? 'not readable'}`),
          row('Selected graphics cards',
            strata.gpuSelection?.status === 'ok'
              ? strata.gpuSelection.label
              : `Unavailable — ${strata.gpuSelection?.error ?? 'not readable'}`),
          row('Endpoint', strata.endpoint ?? 'http://127.0.0.1:8080'),
          endpointState !== null ? row('Observed endpoint state', endpointState.state ?? 'unknown') : null,
          h('div', { style: { marginTop: '8px' } },
            button('Stop Strata', () => onStrataAction('stop', {}), { disabled: !running, danger: true })))
      )
    }

    const StrataDialog = ({ plan, onConfirm, onClose }) => {
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(card({}, h('h4', { style: { marginTop: 0 } }, 'Strata action refused'),
          h('p', null, plan.reason), button('Close', onClose)))
      }
      if (plan.status === 'failed') {
        return overlay(card({}, h('h4', { style: { marginTop: 0 } }, 'Strata action failed'),
          h('p', null, plan.reason), button('Close', onClose)))
      }
      if (plan.status === 'ok') {
        return overlay(card({}, h('h4', { style: { marginTop: 0 } }, 'Strata updated'),
          h('p', null, plan.message),
          plan.chatRestartRequired === true ? h('p', {
            style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '12px' },
          }, plan.chatRestartNote) : null,
          button('Close', onClose)))
      }
      if (plan.status !== 'planned') return null
      return overlay(card({ maxWidth: '620px', width: '90%' },
        h('h4', { style: { marginTop: 0 } }, 'Confirm Strata action'),
        h('p', null, plan.impact),
        h('div', { style: { marginTop: '12px' } },
          button('Confirm', () => onConfirm(plan.confirmToken), { primary: true }),
          button('Cancel', onClose))))
    }

    /**
     * Scan locations display and Add Directory form. Shown when the snapshot
     * includes `userDiscoveryDirs` (i.e. `userDiscoveryDirsPath` is configured).
     * Owner-added dirs are listed; a path input submits via `addDiscoveryDir`
     * and triggers a panel refresh on success. Discovery is informational only:
     * submitting a dir never registers a model or changes any launch setting.
     * @param {{userDiscoveryDirs: object, addDiscoveryDir: function, onRefresh: function, t: function}} props.
     */
    const AddDirectorySection = ({ userDiscoveryDirs, addDiscoveryDir, onRefresh, t }) => {
      const [input, setInput] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const onAdd = async () => {
        const trimmed = input.trim()
        if (busy || trimmed === '') return
        setBusy(true)
        setResult(null)
        const res = await addDiscoveryDir(trimmed)
        setResult(res)
        setBusy(false)
        if (res.status === 'added') {
          setInput('')
          onRefresh()
        }
      }
      const dirs = userDiscoveryDirs?.dirs ?? []
      const readError = userDiscoveryDirs?.readError
      return h('div', null,
        heading(t('addDirTitle')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('addDirHint')),
        readError !== undefined
          ? card({}, h('div', { style: { color: 'var(--dsw-static-red-500, red)', fontSize: '13px' } }, `${t('addDirReadError')}: ${readError}`))
          : null,
        dirs.length === 0
          ? card({}, h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('addDirNone')))
          : h('div', null, ...dirs.map((d, i) => card({ key: i },
              h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                pill(t('addDirUserLabel'), 'var(--dsw-alias-label-secondary, gray)'),
                h('code', { style: { fontSize: '13px', wordBreak: 'break-all' } }, d))))),
        card({},
          h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, t('addDirInputLabel')),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'text',
              value: input,
              onChange: (e) => setInput(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') void onAdd() },
              placeholder: t('addDirInputPlaceholder'),
              disabled: busy,
              style: {
                flex: 1, minWidth: '200px', padding: '5px 10px', borderRadius: '8px',
                border: '1px solid var(--dsw-alias-border-strong, gray)',
                background: 'var(--dsw-alias-bg-layer-1, transparent)',
                color: 'inherit', fontSize: '14px',
              },
            }),
            button(busy ? t('addDirBusy') : t('addDirButton'), onAdd, { disabled: busy || input.trim() === '', primary: true })),
          result !== null
            ? h('div', {
                style: {
                  marginTop: '8px', fontSize: '13px',
                  color: result.status === 'added' ? 'var(--dsw-static-green-500, green)' : 'var(--dsw-static-red-500, red)',
                },
              }, result.status === 'added' ? t('addDirSuccess') : (result.reason ?? (result.status === 'failed' ? t('addDirFailed') : t('addDirRefused'))))
            : null))
    }

    /**
     * Multi-instance server status section. Shown when snap.servers is present.
     * Each card shows the instance endpoint, GPU, state, running model, and a
     * Stop button that targets only that instance's port. An Adopt button is
     * shown for running external servers so the owner can take control without
     * restarting.
     * @param {{servers: Array<object>, models: Array<object>, t: function, onAction: function, onAdopt: function}} props.
     */
    const MultiServerSection = ({ servers, models, t, onAction, onAdopt }) =>
      h('div', null,
        heading(t('serversTitle')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('serversHint')),
        ...servers.map((srv) => {
          const runningModel = models.find((m) => m.key === srv.runningModelKey)
          const serverLabel = { running: t('serverStateRunning'), stopped: t('serverStateStopped'), unhealthy: t('serverStateError') }[srv.state] ?? t('serverStateUnknown')
          const gpuMismatch = srv.actualGpuUuid !== null && srv.actualGpuUuid !== undefined && srv.actualGpuUuid !== srv.gpuUuid
          const gpuDisplay = srv.actualGpuName !== null && srv.actualGpuName !== undefined
            ? (gpuMismatch
                ? `${srv.gpuName} (${t('serverConfiguredGpu')}) / ${srv.actualGpuName} (${t('serverActualGpu')})`
                : srv.gpuName)
            : `${srv.gpuName} — ${t('serverActualGpuUnknown')}`
          // Models available to switch to on this server: installed and not already running here.
          const switchableModels = models.filter((m) => m.installed === true && m.key !== srv.runningModelKey)
          return card({ key: srv.port },
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' } },
              h('strong', null, gpuDisplay),
              h('code', null, srv.endpoint ?? `http://127.0.0.1:${srv.port}`),
              pill(serverLabel, srv.state === 'running' ? 'var(--dsw-static-green-500, green)' : srv.state === 'stopped' ? 'var(--dsw-alias-label-secondary, gray)' : 'var(--dsw-static-red-500, red)'),
              srv.owned === true
                ? pill(t('serverManagedBadge'), 'var(--dsw-static-green-500, green)')
                : pill(t('serverExternalBadge'), 'var(--dsw-static-orange-500, orange)')),
            gpuMismatch ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-static-orange-500, orange)', margin: '2px 0' } }, t('serverActualGpuMismatch')) : null,
            h('div', { style: { marginTop: '6px' } },
              row(t('runningModel'), runningModel?.name ?? (srv.unrecognizedModelPath !== undefined ? `${srv.unrecognizedModelPath} (${t('reasoningUnknown')})` : '—')),
              srv.liveContext !== undefined ? row(t('liveContext'), fmtNum(srv.liveContext)) : null,
              row('', srv.busy === true ? t('busyNow') : srv.busyUnknown === true ? t('busyUnknown') : t('idle'))),
            srv.owned === false
              ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-static-orange-500, orange)', margin: '6px 0' } }, t('serverExternalNote'))
              : null,
            srv.state === 'running' && srv.owned === true && switchableModels.length > 0
              ? h('div', { style: { margin: '8px 0' } },
                  h('div', { style: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' } }, t('instanceSwitchTitle')),
                  h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)', marginBottom: '6px' } }, t('instanceSwitchHint')),
                  ...switchableModels.map((m) => button(m.name, () => onAction('switch', m, srv.port), { disabled: srv.busy === true })))
              : null,
            srv.state === 'running' && srv.owned === false
              ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)', margin: '6px 0' } }, t('instanceSwitchBlockedNote'))
              : null,
            h('div', { style: { marginTop: '8px' } },
              srv.state === 'running' && srv.owned === false
                ? button(t('adoptLabel'), () => onAdopt(srv.port))
                : null,
              button(t('stopLabel'), () => onAction('stop', null, srv.port), { disabled: srv.state !== 'running' || srv.owned === false, danger: true })))
        }))

    /**
     * Adopt-external-server plan/confirm dialog. States: refused (reason only),
     * ok (success message), failed (error), planned (impact + unit + confirm/cancel).
     * @param {{plan: object|null, t: function, onConfirm: function, onClose: function}} props.
     */
    const AdoptDialog = ({ plan, t, onConfirm, onClose }) => {
      if (plan === null) return null
      if (plan.status === 'refused') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('adoptRefused')),
            h('p', null, plan.reason),
            button(t('adoptClose'), onClose)))
      }
      if (plan.status === 'ok') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('adoptDone')),
            h('p', null, plan.message),
            button(t('adoptClose'), onClose)))
      }
      if (plan.status === 'failed') {
        return overlay(
          card({}, h('h4', { style: { marginTop: 0 } }, t('adoptFailed')),
            h('p', null, plan.reason),
            button(t('adoptClose'), onClose)))
      }
      if (plan.status !== 'planned') return null
      return overlay(
        card({ maxWidth: '620px', width: '90%' },
          h('h4', { style: { marginTop: 0 } }, t('adoptPlanTitle')),
          h('div', { style: { fontWeight: 600 } }, t('adoptImpact')),
          h('p', null, plan.impact),
          h('div', { style: { fontWeight: 600, marginTop: '8px' } }, t('adoptUnitNote')),
          h('p', { style: { fontFamily: 'monospace', fontSize: '13px' } }, `${plan.unitName} · PID ${plan.pid}`),
          h('div', { style: { marginTop: '12px' } },
            button(t('adoptConfirmButton'), () => onConfirm(plan.confirmToken), { primary: true }),
            button(t('adoptCancel'), onClose))))
    }

    /** Fixed overlay wrapper for the dialog (centers the dialog cards). */
    const overlay = (...children) => h('div', {
      role: 'dialog', 'aria-modal': true,
      style: { position: 'fixed', inset: 0, background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.4))', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 },
    }, ...children)

    /** Error boundary so a render fault never blanks the whole workspace. */
    class PanelErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      render() {
        if (this.state.failed === true) {
          return card({}, h('strong', null, this.props.t?.('renderErrorTitle') ?? 'Panel render error'),
            h('div', null, this.props.t?.('renderErrorRetry') ?? 'Try again'))
        }
        return this.props.children
      }
    }

    /**
     * The panel page.
     * @param {{load: function, planAction: function, confirmAction: function, planLaunch: function, confirmLaunch: function, planGpuLock: function, confirmGpuLock: function, planGpuReservation: function, confirmGpuReservation: function, addDiscoveryDir: function, planAdoptInstance: function, confirmAdoptInstance: function, t: function}} props.
     */
    const Page = ({ load, planAction, confirmAction, planLaunch, confirmLaunch, planStrataAction, confirmStrataAction, planGpuLock, confirmGpuLock, planGpuReservation, confirmGpuReservation, addDiscoveryDir, planAdoptInstance, confirmAdoptInstance, t }) => {
      const [snap, setSnap] = React.useState(undefined)
      const [dialog, setDialog] = React.useState(null)
      const [launchDialog, setLaunchDialog] = React.useState(null)
      const [lockDialog, setLockDialog] = React.useState(null)
      const [reservationDialog, setReservationDialog] = React.useState(null)
      const [adoptDialog, setAdoptDialog] = React.useState(null)
      const [strataDialog, setStrataDialog] = React.useState(null)
      const callLoad = React.useCallback(async () => {
        try {
          setSnap(await load())
        } catch {
          setSnap(null)
        }
      }, [load])
      React.useEffect(() => { void callLoad() }, [callLoad])
      if (snap === undefined) return card({}, t('loading'))
      if (snap === null) {
        return card({},
          h('strong', null, t('loadFailed')),
          h('div', { style: { marginTop: '8px' } }, button(t('retry'), callLoad)))
      }
      const onAction = async (action, model, instancePort) => {
        const baseParams = action === 'stop' ? {} : { modelKey: model?.key }
        const params = instancePort !== undefined ? { ...baseParams, instancePort } : baseParams
        setDialog(await planAction(action, params))
      }
      const onConfirm = async (token, acknowledgment) => {
        setDialog(await confirmAction(token, acknowledgment))
      }
      const onLaunch = async (profile) => {
        setLaunchDialog(await planLaunch(profile.profileId))
      }
      const onConfirmLaunch = async (token) => {
        setLaunchDialog(await confirmLaunch(token))
      }
      const onLock = async (uuid, desiredState) => {
        setLockDialog(await planGpuLock(uuid, desiredState))
      }
      const onLockConfirm = async (token) => {
        setLockDialog(await confirmGpuLock(token))
      }
      const onReserve = async (uuid, desired) => {
        setReservationDialog(await planGpuReservation({ uuid, desired }))
      }
      const onReservationConfirm = async (token) => {
        const result = await confirmGpuReservation(token)
        setReservationDialog(result)
        if (result.status === 'ok') void callLoad()
      }
      const onAdopt = async (port) => {
        setAdoptDialog(await planAdoptInstance(port))
      }
      const onAdoptConfirm = async (token) => {
        const result = await confirmAdoptInstance(token)
        setAdoptDialog(result)
        if (result.status === 'ok') void callLoad()
      }
      const onStrataAction = async (action, params) => {
        setStrataDialog(await planStrataAction(action, params))
      }
      const onStrataConfirm = async (token) => {
        const result = await confirmStrataAction(token)
        setStrataDialog(result)
        if (result.status === 'ok') void callLoad()
      }

      const server = snap.server ?? {}
      const serverLabel = { running: t('serverStateRunning'), stopped: t('serverStateStopped'), unhealthy: t('serverStateError') }[server.state] ?? t('serverStateUnknown')
      const runningModel = (snap.models ?? []).find((m) => m.runtime === 'running')
      const reservedUuids = new Set((snap.gpus ?? []).filter((g) => g.launchReserved === true).map((g) => g.uuid))
      return h('div', { style: { padding: '16px 20px', overflow: 'auto', height: '100%', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
          h('h2', { style: { margin: '4px 0' } }, t('title')),
          button(t('refresh'), callLoad, { title: t('refreshTitle') })),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)' } }, t('subtitle')),
        Array.isArray(snap.servers) && snap.servers.length > 0
          ? h(MultiServerSection, { servers: snap.servers, models: snap.models ?? [], t, onAction, onAdopt })
          : card({},
              h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' } },
                h('strong', null, t('endpoint')),
                h('code', null, snap.endpoint ?? ''),
                pill(serverLabel, server.state === 'running' ? 'var(--dsw-static-green-500, green)' : server.state === 'stopped' ? 'var(--dsw-alias-label-secondary, gray)' : 'var(--dsw-static-red-500, red)')),
              h('div', { style: { marginTop: '6px' } },
                row(t('runningModel'), runningModel?.name ?? (server.unrecognizedModelPath !== undefined ? `${server.unrecognizedModelPath} (${t('reasoningUnknown')})` : '—')),
                server.liveContext !== undefined ? row(t('liveContext'), fmtNum(server.liveContext)) : null,
                row('', server.busy === true ? t('busyNow') : server.busyUnknown === true ? t('busyUnknown') : t('idle')),
                ...(server.slots ?? []).map((slot) => h('div', { key: slot.id, style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, gray)' } },
                  `${t('slots')} ${slot.id}: ${fmtNum(slot.context) ?? '?'} ctx · ${slot.busy ? t('busyNow') : t('idle')}`))),
            ),
        heading(t('myModels')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('modelsHint')),
        h(CapabilityDashboard, { models: snap.models ?? [], t }),
        ...(snap.models ?? []).map((m) => h(ModelCard, { key: m.key, m, t, onAction, gpuProfiles: (snap.launchProfiles ?? []).filter((p) => p.modelKey === m.key), onLaunch, reservedUuids, servers: snap.servers ?? null })),
        ...(snap.discovery !== null && snap.discovery !== undefined
          ? [
            heading(t('discoveredTitle')),
            h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('discoveredHint')),
            ...(snap.discovery.roots ?? []).some((r) => r.subdirErrors?.length > 0 || (r.status !== 'ok' && r.status !== 'not-found'))
              ? [card({}, h('div', { style: { color: 'var(--dsw-static-red-500, red)', fontSize: '13px' } }, t('discoveredScanError')))]
              : [],
            ...(snap.discovery.roots ?? []).flatMap((r) => (r.candidates ?? []).map((c, i) => h(DiscoveredModelCard, { key: `${r.root}-${i}`, c, t }))),
            ...(snap.discovery.roots ?? []).every((r) => (r.candidates ?? []).length === 0)
              ? [card({}, h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('discoveredNone')))]
              : [],
          ]
          : []),
        snap.userDiscoveryDirs !== undefined && snap.userDiscoveryDirs !== null
          ? h(AddDirectorySection, { userDiscoveryDirs: snap.userDiscoveryDirs, addDiscoveryDir, onRefresh: callLoad, t })
          : null,
        h(StrataSection, {
          strata: snap.strata === undefined
            ? undefined
            : { ...snap.strata, observedEndpoints: snap.observedEndpoints ?? [] },
          onStrataAction,
        }),
        h(StrataDialog, {
          plan: strataDialog,
          onConfirm: onStrataConfirm,
          onClose: () => setStrataDialog(null),
        }),
        heading(t('modesTitle')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('modesHint')),
        card({}, ...['modeReliable', 'modeMultiple', 'modeResearch', 'modeAdvanced'].map((key) => h('div', { key, style: { margin: '4px 0' } }, t(key)))),
        heading(t('gpusTitle')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('gpusHint')),
        snap.gpuQueryStatus === 'unavailable' ? card({}, t('gpuQueryFailed')) : null,
        ...(snap.gpus ?? []).map((g) => h(GpuCard, { key: g.uuid, g, t, onLock, onReserve })),
        h(ElectricityCard, { electricity: snap.electricity, t }),
        heading(t('enginesTitle')),
        ...(snap.backends ?? []).map((b) => card({},
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
            h('strong', null, b.label),
            pill(b.status === 'verified' ? t('engVerified') : t('engNotConfigured'), b.status === 'verified' ? 'var(--dsw-static-green-500, green)' : 'var(--dsw-alias-label-secondary, gray)')),
          h('div', { style: { fontSize: '13px' } }, b.note),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, gray)' } }, b.evidence))),
        heading(t('launchProfilesTitle')),
        h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('launchProfilesHint')),
        (snap.launchProfiles ?? []).length === 0
          ? card({}, h('div', { style: { color: 'var(--dsw-alias-label-secondary, gray)', fontSize: '13px' } }, t('launchProfilesEmpty')))
          : h('div', null, ...(snap.launchProfiles ?? []).map((profile) => h(LaunchProfileCard, { key: profile.profileId, profile, t, onLaunch }))),
        heading(t('errorsTitle')),
        card({},
          (snap.errors ?? []).length === 0
            ? t('errorsNone')
            : h('ul', { style: { paddingLeft: '20px' } }, ...(snap.errors ?? []).map((e, i) => h('li', { key: i },
              `${e.at} — ${e.action}: ${e.status}${e.detail ? ` — ${e.detail}` : ''}`)))),
        h(PlanDialog, { plan: dialog, t, onConfirm, onClose: () => setDialog(null) }),
        h(LaunchPlanDialog, { plan: launchDialog, t, onConfirm: onConfirmLaunch, onClose: () => setLaunchDialog(null) }),
        h(GpuLockDialog, { plan: lockDialog, t, onConfirm: onLockConfirm, onClose: () => setLockDialog(null) }),
        h(ReservationDialog, { plan: reservationDialog, t, onConfirm: onReservationConfirm, onClose: () => setReservationDialog(null) }),
        h(AdoptDialog, { plan: adoptDialog, t, onConfirm: onAdoptConfirm, onClose: () => setAdoptDialog(null) }))
    }

    /** Strict pass-through codec accepted by the client-side mount validator. */
    const strictJson = () => ({
      mode: 'strict',
      typeSymbol: 'local-model-manager/plain-json',
      create: () => ({ parse: (value) => value }),
    })

    /**
     * Build one SRC-plane invocation descriptor.
     * @param {string} method service method under the `localModelManager` namespace.
     * @param {Array<{name: string}>} params ordered business parameters.
     */
    const descriptor = (method, params) => ({
      id: `${PACKAGE}#${SERVICE_KEY}/${method}`,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method,
      invocation: { kind: 'direct' },
      parameters: params.map((param) => ({
        name: param.name,
        wire: param.name,
        source: 'json',
        codec: strictJson(),
      })),
      result: strictJson(),
    })

    /**
     * Register the main panel against one call adapter: live namespace scope
     * or a mount-failure scope folding into a service-unavailable card.
     * @param {object} ctx the scope registering the slots.
     * @param {function} call async (method, ...args) → {ok, value} envelope.
     * @returns {object} the slot registration disposer.
     */
    const registerPanel = (ctx, call) => ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({
        load: async () => {
          const result = await call('snapshot')
          if (result.ok !== true) throw new Error(result.error?.message ?? 'snapshot failed')
          return result.value
        },
        planAction: async (action, params) => {
          const result = await call('planAction', action, params)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the action could not be planned' }
          return result.value
        },
        confirmAction: async (token, acknowledgment) => {
          const result = await call('confirmAction', token, acknowledgment)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the action could not be executed' }
          return result.value
        },
        planLaunch: async (profileId) => {
          const result = await call('planLaunch', profileId)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the launch could not be planned' }
          return result.value
        },
        confirmLaunch: async (token) => {
          const result = await call('confirmLaunch', token)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the launch could not be executed' }
          return result.value
        },
        planStrataAction: async (action, params) => {
          const result = await call('planStrataAction', action, params)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the Strata action could not be planned' }
          return result.value
        },
        confirmStrataAction: async (token) => {
          const result = await call('confirmStrataAction', token)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the Strata action could not be executed' }
          return result.value
        },
        planGpuLock: async (uuid, desiredState) => {
          const result = await call('planGpuLock', uuid, desiredState)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the lock plan could not be created' }
          return result.value
        },
        confirmGpuLock: async (token) => {
          const result = await call('confirmGpuLock', token)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the lock change could not be executed' }
          return result.value
        },
        planGpuReservation: async ({ uuid, desired }) => {
          const result = await call('planGpuReservation', { uuid, desired })
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the reservation plan could not be created' }
          return result.value
        },
        confirmGpuReservation: async (token) => {
          const result = await call('confirmGpuReservation', token)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the reservation change could not be executed' }
          return result.value
        },
        addDiscoveryDir: async (dirPath) => {
          const result = await call('addDiscoveryDir', dirPath)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the directory could not be added' }
          return result.value
        },
        planAdoptInstance: async (port) => {
          const result = await call('planAdoptInstance', port)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the adopt plan could not be created' }
          return result.value
        },
        confirmAdoptInstance: async (token) => {
          const result = await call('confirmAdoptInstance', token)
          if (result.ok !== true) return { status: 'refused', reason: result.error?.message ?? 'the adoption could not be completed' }
          return result.value
        },
      }),
    }, (props) => h(PanelErrorBoundary, { t: props.t }, h(Page, props))))

    return {
      labels: { en, zh },
      inject: ['remote', 'slots', 'locale'],
      async apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-model-manager: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 14,
          locale: NS,
          label: () => t('title'),
        }, PanelIcon))
        let disposeRemote
        const mount = async () => {
          disposeRemote = await ctx.remote.$mount({
            package: PACKAGE,
            descriptors: [
              descriptor('snapshot', []),
              descriptor('planAction', [{ name: 'action' }, { name: 'params' }]),
              descriptor('confirmAction', [{ name: 'confirmToken' }, { name: 'acknowledgment' }]),
              descriptor('recentErrors', []),
              descriptor('planLaunch', [{ name: 'profileId' }]),
              descriptor('confirmLaunch', [{ name: 'confirmToken' }]),
              descriptor('planStrataAction', [{ name: 'action' }, { name: 'params' }]),
              descriptor('confirmStrataAction', [{ name: 'confirmToken' }]),
              descriptor('planGpuLock', [{ name: 'uuid' }, { name: 'desiredState' }]),
              descriptor('confirmGpuLock', [{ name: 'confirmToken' }]),
              descriptor('planGpuReservation', [{ name: 'params' }]),
              descriptor('confirmGpuReservation', [{ name: 'confirmToken' }]),
              descriptor('addDiscoveryDir', [{ name: 'dirPath' }]),
              descriptor('planAdoptInstance', [{ name: 'port' }]),
              descriptor('confirmAdoptInstance', [{ name: 'confirmToken' }]),
            ],
          })
          return ctx.inject([`remote.${SERVICE_KEY}`, 'slots', 'locale'], (scope) => {
            const svc = scope.remote[SERVICE_KEY]
            const call = async (method, ...args) => {
              try {
                return await svc[method](...args)
              } catch (error) {
                return { ok: false, error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error) } }
              }
            }
            return registerPanel(ctx, call)
          })
        }
        try {
          const ui = await mount()
          return async () => { await ui.dispose(); await disposeRemote() }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          const failing = async () => ({
            ok: false,
            error: { code: 'gateway/service-unavailable', message: `The ${SERVICE_KEY} remote namespace failed to mount: ${detail}` },
          })
          const ui = registerPanel(ctx, failing)
          const disposeFailing = async () => { await ui.dispose() }
          return disposeFailing
        }
      },
    }
  },
})
