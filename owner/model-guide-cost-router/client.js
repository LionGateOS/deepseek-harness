/**
 * Browser half of the Model Guide & Cost Router bundle.
 *
 * Renders a Model Guide main panel (sidebar panel entry keyed `model-guide`)
 * reading the same Host read endpoints the agent tools call, mounted through
 * hand-authored SRC-plane Typert descriptors. Copy Model Info pulls the exact
 * canonical text the Host produces. Text follows the locale service; colors
 * use only `--dsw-alias-*` tokens.
 */

window.__ModuleLoader__.load({
  id: '@local/model-guide-cost-router',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = '@local/model-guide-cost-router'
    const NS = 'modelGuide.page'
    const PANEL_ID = 'model-guide'
    const OWNERS_PANEL_ID = 'owner-customizations'

    const en = {
      title: 'Model Guide & Cost Router',
      subtitle: 'Dynamic provider inventory overlaid with owner-curated guidance',
      search: 'Search models',
      copy: 'Copy Model Info',
      copied: 'Copied to clipboard',
      copyFailed: 'Copy failed',
      loading: 'Loading model inventory…',
      loadFailed: 'Could not load the model guide',
      retry: 'Retry',
      routingRule: 'Global routing rule',
      gpuBoundary: 'GPU boundary',
      protectedGpu: 'Protected — never use, stop, restart, unload, or reconfigure',
      generalGpu: 'Allowed for local model work',
      providers: 'Live providers',
      curatedOnly: 'Owner-curated (not detected live)',
      needsReview: 'Needs review',
      unknown: 'Unknown',
      local: 'Local',
      cloud: 'Cloud',
      context: 'Context',
      ownerConfigured: 'owner-configured',
      providerReported: 'provider-reported',
      modalities: 'Modalities',
      toolSupport: 'Tool support',
      reasoningModes: 'Reasoning modes',
      nativeDefault: 'Native reasoning default',
      providerDefault: 'provider',
      ownerDefault: 'owner',
      routine: 'Recommended routine setting',
      heavy: 'Recommended difficult-task setting',
      pricing: 'Cloud token rates (per 1M tokens)',
      inputRate: 'Input',
      cachedRate: 'Cached input',
      outputRate: 'Output',
      notListed: 'not listed by provider',
      priceFresh: 'Price verified',
      priceStale: 'Price stale — verify before cost-sensitive decisions',
      priceUnverified: 'Price unverified',
      costTier: 'Owner cost tier',
      costNote: 'Reasoning settings change total cost only through real token usage; no per-level multiplier exists.',
      localPricing: 'N/A — local model; $0 cloud/API token charge',
      localCostNote: 'Cloud/API token charge is $0 for this local model; local resource consumption (GPU time, VRAM, electricity, local compute availability) is separate from provider token pricing. The reasoning level changes only how much local compute and thinking time is used — no per-level price multiplier exists.',
      cloudCostNote: 'Actual dollar cost is calculated from real token counts and the verified provider rates; the reasoning level itself has no fixed multiplier — reasoning changes total spend only through real token usage.',
      actualCost: 'Actual cost uses real token counts × stored rates only',
      strengths: 'Strengths',
      avoid: 'Avoid for',
      evidence: 'Evidence',
      metadataMalformed: 'Owner metadata file has problems — invalid entries were rejected and flagged for review',
      metadataMissing: 'Owner metadata file not found',
      metadataUnreadable: 'Owner metadata file could not be read',
      guideFile: 'Canonical guide file',
      update: 'Update Models & Pricing',
      updating: 'Updating — rescanning providers, diffing the catalog, capturing pricing pages…',
      updateDone: 'Update complete',
      updateFailed: 'Update failed',
      changes: 'Changes since last update',
      noChangesYet: 'No update has been run yet. Use Update Models & Pricing to record one.',
      added: 'Added models',
      removed: 'Removed models',
      changed: 'Changed facts',
      reasoningChanges: 'Reasoning metadata changes (verify before trusting)',
      ownerMismatches: 'Owner native-default mismatches (owner recommendations stay authoritative)',
      pricingSnapshots: 'Pricing page snapshots (official source retained as evidence; verified rates are parsed deterministically from the official table — a failure retains prior verified prices and stays Needs Review)',
      stalePrices: 'Prices flagged stale or unverified',
      notes: 'Update notes',
      copyFullGuide: 'Copy Full Model Guide',
      copyRoutingGuide: 'Copy Recommended Routing Guide',
      ownerTitle: 'Owner Customizations',
      ownerSubtitle: 'Statuses from the external recovery tool; the external layer can always restore even without this page',
      ownerRefresh: 'Check My Customizations',
      ownerNoEntries: 'No customizations are registered in the preservation manifest yet. Run Check My Customizations after adding or restoring an external customization.',
      renderErrorTitle: 'Panel render error',
      renderErrorRetry: 'Try again',
      ownerRestoreHint: 'These differ: Step 1 (Check My Customizations) checks the CURRENT installation status; the Dry-Run Check previews what the recovery tool WOULD restore and changes nothing; Apply Restore actually performs an approved restore — only after you review the dry run. Needs Review and Incompatible entries are always refused.',
      ownerRestoreCommand: 'Copy Dry-Run Check Command',
      ownerApplyCommand: 'Copy Apply Restore Command',
      ownerPlanned: 'Planned restore actions',
      ownerNoPlanned: 'No planned actions recorded for this entry.',
      researchButton: 'Research Unverified Models',
      researchTitle: 'Research preflight - nothing runs automatically',
      researchIntro: 'Research consumes model tokens only if you run the copied prompt yourself or approve an agent to. Nothing here runs a model automatically.',
      researchModels: 'Models with unresolved fields',
      researchNoModels: 'No models currently have unresolved capability or pricing fields.',
      researchResearcher: 'Proposed researcher (least expensive capable model under the canonical routing rule)',
      researchLocal: 'local - no cloud token charge; consumes local GPU time',
      researchPaid: 'paid cloud - token-billed at stored verified rates',
      researchReasoning: 'Reasoning level',
      researchCopyPrompt: 'Copy Research Prompt',
      researchScopeNewlyDetected: 'Research Newly Detected',
      researchScopeAllUnverified: 'Research All Unverified',
      researchScopeSelected: 'Research Selected Model',
      researchTokensFree: "copying the prompt is free of model tokens; running it elsewhere may consume tokens",
      researchCopySelected: 'Copy Prompt for Selected',
      importTitle: 'Import / Review Research Results',
      importHelp: 'Paste the research results as the JSON array the prompt itself specifies (one block per model with "model" and "facts"). Only the importable fact fields are accepted — including pricing for cloud deployments (canonical { inputPerMTok, cachedInputPerMTok, outputPerMTok, offPeak? } record with official source and verifiedAt); recorded-local models must not include pricing. Every fact requires its official source URL and verifiedAt; owner recommendations are never overwritten. Unsupported fields are rejected.',
      importPlaceholder: '[\n  {\n    "model": "deepseek-official/deepseek-v4-pro",\n    "facts": {\n      "contextWindow": { "value": 262144, "source": "https://api-docs.deepseek.com/...", "verifiedAt": "2026-10-14" },\n      "pricing": { "value": { "inputPerMTok": 0.3, "cachedInputPerMTok": 0.006, "outputPerMTok": 1.2 }, "source": "https://api-docs.deepseek.com/pricing", "verifiedAt": "2026-10-14" }\n    }\n  }\n]',
      importReview: 'Review Changes',
      importReviewHint: 'These are the facts that WOULD be saved. Check them before continuing. Nothing is saved yet. Review this diff:',
      importApply: 'Apply Reviewed Facts',
      importApplied: 'Applied: the reviewed facts were saved to the catalog and the guide was regenerated. Rejected fields were not applied.',
      researchLoadFailed: 'Could not load the research preflight',
      stepsTitle: 'Your workflow — four steps',
      shareTitle: 'Share / Copy Guide Information',
      nextChecking: 'Checking your progress…',
      nextUpToDate: 'Everything is up to date. Use Step 1 whenever you want to check for newer models or prices.',
      ownerDryRunHelp: 'Copies a Linux terminal command that shows what would be restored. It does not make the restore changes.',
      ownerApplyRestoreHelp: 'Copies a Linux terminal command that performs the approved restore. The command is only copied here; it does not run until you paste it into your terminal.',
      step1Title: 'Step 1 — Check Models & Prices',
      step1Help: 'The "Update Models & Pricing" button checks which models are available and refreshes verified provider prices. It does not run a model and spends no model tokens. Afterwards inspect "Changes since last update".',
      step2Title: 'Step 2 — Research Missing Information',
      step2Help: 'When a new model is missing facts (context size, reasoning, tool support, pricing), prepare research instructions here. Creating or copying the research prompt does not spend model tokens — tokens are used only when you paste and run that prompt in ChatGPT, DeepSeek, or another research-capable model. Destination: ChatGPT / DeepSeek research session.',
      step3Title: 'Step 3 — Paste & Review Research Results',
      step3Help: 'Paste the JSON result returned by the research assistant into the box in this card, then click "Review Changes". Nothing is saved yet.',
      step4Title: 'Step 4 — Save Reviewed Facts',
      step4Help: '"Apply Reviewed Facts" saves only the facts shown in the review above.',
      recommended: 'Recommended',
      whatNext: 'What do I do next?',
      nextStart: 'Start with Step 1: update the model list and prices.',
      nextNewDetected: '$N new models need research. Continue with Step 2.',
      nextResearchPrompt: 'Use Step 2: pick the recommended scope, copy the research prompt, and run it in ChatGPT or DeepSeek.',
      nextPromptCopied: 'Research prompt copied. Run it in ChatGPT/DeepSeek and bring the JSON result back here.',
      nextReviewReady: 'Results are ready to review. Continue to Step 3.',
      nextReviewDone: 'Review complete. If everything looks right, use Step 4.',
      nextApplied: 'Saved. Everything is up to date unless new models or missing facts appear.',
      nextFresh: 'Everything is up to date.',
      scopeHelpNewlyDetected: 'Research only new models we have not documented yet. Recommended.',
      scopeHelpSelected: 'Choose one or more models yourself (tick the checkboxes).',
      scopeHelpAllUnverified: 'Research every model that still has missing facts. This can create a much larger research job.',
      copyResearchHelp: 'Copies the research instructions. Paste them into a ChatGPT or DeepSeek research session. Bring the JSON result back here for Step 3. Destination: ChatGPT / DeepSeek research session.',
      copyConfirm: 'Copied — paste it into ChatGPT or DeepSeek.',
      helpUpdate: 'Refreshes the available model list and verified provider prices. Does not run a model and spends no model tokens.',
      helpResearch: 'Prepares research instructions for models with missing facts. Copying the prompt is free; running it in a model may use tokens.',
      helpChanges: 'Shows what changed the last time models or prices were refreshed.',
      helpFullGuide: 'Copies the complete model catalog, including capabilities, reasoning, pricing, and owner guidance — mainly for audits, planning, handoffs, or when another assistant needs the full picture. Destination: ChatGPT / DeepSeek prompt or an audit/handoff document.',
      helpRoutingGuide: 'Copies the short model-selection rules — paste it into ChatGPT or DeepSeek when you want it to choose the least expensive model that can do the job properly. Destination: ChatGPT / DeepSeek prompt.',
      helpApplyFacts: 'Saves only the facts you reviewed in Step 3.',
      applyNeedsReview: 'Review the proposed changes in Step 3 before you can save them.',
      copyModelInfoHelp: "Copies this model's capabilities, reasoning options, pricing, and owner guidance. Paste it into a ChatGPT or DeepSeek session when you want that assistant to use, evaluate, or compare this specific model. Destination: ChatGPT / DeepSeek prompt.",
      cardsHelp: 'These cards are your model catalog. You normally do not need to click them — use Copy Model Info only when you want another assistant to know about one specific model.',
      ownerIntro: 'This page helps preserve your custom DeepSeek features when DeepSeek is updated. Checking is safe and does not change anything.',
      ownerStep1Title: 'Step 1 — Check My Customizations',
      ownerStep1Help: 'Checks the current status of your saved customizations. This does not change anything.',
      ownerStep2Title: 'Step 2 — Restore if Needed',
      statusHelpInstalled: 'Already present. Next: nothing to do.',
      statusHelpCanRestore: 'The saved customization appears compatible and can be restored. Next: if it is missing after an update, use the Step 2 dry-run first.',
      statusHelpNeedsReview: 'Do not apply automatically. Next: have it reviewed first.',
      statusHelpIncompatible: 'The saved customization does not match this version. Next: do not apply this saved customization to this version.',
      ownerStep2Help: 'If a customization needs attention, copy the matching command below and run it yourself.',
      ownerCmdHelp: 'Copies a terminal command. It does not run it — paste it into your Linux terminal only when you want to perform the action.',
      ownerTerminalDestination: 'Destination: Linux terminal.',
      ownerRestoreVsApply: 'Difference: the check command only REPORTS the current state; the apply command PERFORMS the restore — check first, read the result, then apply.',
      priceChanges: 'Price changes since last update (official verified rates)',
      researchNeededLabel: 'Research Needed (newly detected, no owner curation)',

      ownerMissing: 'No status file found. Run the external checker from a terminal:',
      ownerUnconfigured: 'External status file is not configured for this panel.',
      ownerMalformed: 'External status file is unreadable or malformed.',
      ownerUnavailable: 'The status service is unreachable (the Model Guide host service is not answering).',
      ownerChecked: 'Checked',
      statusInstalled: 'Installed',
      statusCanRestore: 'Can Restore Cleanly',
      statusNeedsReview: 'Needs Review',
      statusIncompatible: 'Incompatible',
      statusUnknown: 'Unknown',
      enginesButton: 'Engines',
      enginesButtonHelp: 'Shows the latest upstream release, installed version, and owner-verified configurations for each registered inference engine.',
      enginesSectionTitle: 'Inference Engine Releases',
      enginesDescription: 'Three separate states per engine: release available (from GitHub), installed (host-detected or owner-recorded), and verified (owner-tested configuration). No engine is installed or activated from here.',
      enginesCheckButton: 'Check Engine Releases',
      enginesChecking: 'Checking upstream releases…',
      enginesCheckDone: 'Engine check complete',
      enginesCheckFailed: 'Engine check failed',
      enginesLatestLabel: 'Latest upstream',
      enginesInstalledLabel: 'Installed',
      enginesNotDetected: 'Not detected',
      enginesNotChecked: 'Not yet checked',
      enginesReleasedAt: 'Released',
      enginesLastChecked: 'Last checked',
      enginesUpdateAvailable: 'Newer release available',
      enginesVerifiedTitle: 'Verified configurations',
      enginesNoVerified: 'No verified configurations recorded.',
      enginesVerifiedPassed: 'Passed',
      enginesVerifiedFailed: 'Failed',
      enginesVerifiedModel: 'Model',
      enginesVerifiedGpus: 'GPUs',
      enginesVerifiedAt: 'Verified',
      enginesVerifiedEvidence: 'Evidence',
      enginesDistinctionNote: 'Release ≠ installed; installed ≠ verified. A verified configuration means the owner ran a real test — it says nothing about other models or GPU sets.',
      enginesControlVersionNote: 'This project versions its application and its engine separately, so the release tag above is not comparable with the installed engine build.',
      enginesEngineBuildLabel: 'Published engine build',
      enginesMinimumDriverLabel: 'Minimum driver',
      enginesAdviceReview: 'Review',
      enginesAdviceDefer: 'Defer',
      enginesAdviceNoAction: 'No action',
      enginesAdviceWhy: 'Why',
      enginesAdviceDestination: 'Investigate in',
      enginesAdviceApproval: 'Owner approval is required before anything is installed or upgraded.',
      enginesCopyPrompt: 'Copy investigation prompt',
      enginesReasonNewerStable: 'a newer stable release is published upstream',
      enginesReasonPrerelease: 'the newest upstream release is a prerelease',
      enginesReasonDriverBelow: 'this host\'s GPU driver is below the release minimum',
      enginesReasonDriverUnknown: 'the release minimum driver could not be verified on this host',
      enginesReasonCheckFailed: 'the last upstream check failed',
      enginesReasonStale: 'the recorded check is older than the freshness window',
      enginesReasonUpToDate: 'the installed version matches the published one',
      enginesReasonNotDetected: 'the installed version could not be detected',
      enginesReasonNotChecked: 'this engine has never been checked',
      enginesReasonIncomparable: 'the two versions cannot be compared',
      enginesReasonControlSpace: 'this project publishes its engine build separately from its application release',
      localFilesTitle: 'Local GGUF Models',
      localFilesSubtitle: 'Discovered local GGUF model files from the shared discovery cache',
      localFilesUnconfigured: 'Local discovery cache path is not configured',
      localFilesMissing: 'Local discovery cache file not found',
      localFilesUnreadable: 'Local discovery cache file could not be read',
      localFilesMalformed: 'Local discovery cache file is not valid JSON',
      localFilesSchemaUnsupported: 'Local discovery cache schema version is not supported',
      localFilesOk: 'Local discovery cache loaded successfully',
      localFilesGeneratedAt: 'Cache generated',
      localFilesCandidates: 'Discovered models',
      localFilesNoCandidates: 'No local models discovered',
      localFilesMultiPart: 'Multi-part',
      localFilesSinglePart: 'Single file',
      localFilesShards: 'shards',
      localFilesSize: 'Size',
      localFilesPath: 'Path',
      localFilesCachePath: 'Cache path',
    }

    /**
     * Owner-facing friendly local time for a stored ISO timestamp.
     * @param {string} iso stored canonical timestamp.
     * @returns {string} browser-local text like 'Oct 13, 9:44 PM · about 5 hours ago'.
     */
    const friendlyLocalWhen = (iso) => {
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return String(iso)
      const local = `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      const minutes = Math.round((Date.now() - when.getTime()) / 60000)
      const rel = minutes <= 0 ? null
        : minutes < 60 ? `about ${minutes} minute${minutes === 1 ? '' : 's'} ago`
        : minutes < 60 * 36 ? `about ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} ago`
        : `about ${Math.round(minutes / (60 * 24))} day${Math.round(minutes / (60 * 24)) === 1 ? '' : 's'} ago`
      return rel === null ? local : `${local} · ${rel}`
    }
    const zh = {
      title: '模型指南与成本路由',
      subtitle: '动态供应商清单叠加所有者策划的指引',
      search: '搜索模型',
      copy: '复制模型信息',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败',
      loading: '正在加载模型清单…',
      loadFailed: '无法加载模型指南',
      retry: '重试',
      routingRule: '全局路由规则',
      gpuBoundary: 'GPU 边界',
      protectedGpu: '受保护——禁止使用、停止、重启、卸载或重新配置',
      generalGpu: '可用于本地模型工作',
      providers: '在线供应商',
      curatedOnly: '所有者策划（未在线检测到）',
      needsReview: '需要复查',
      unknown: '未知',
      local: '本地',
      cloud: '云端',
      context: '上下文',
      ownerConfigured: '所有者配置',
      providerReported: '供应商报告',
      modalities: '模态',
      toolSupport: '工具支持',
      reasoningModes: '推理模式',
      nativeDefault: '原生推理默认值',
      providerDefault: '供应商',
      ownerDefault: '所有者',
      routine: '推荐日常设置',
      heavy: '推荐难题设置',
      pricing: '云端令牌单价（每 100 万令牌）',
      inputRate: '输入',
      cachedRate: '缓存输入',
      outputRate: '输出',
      notListed: '供应商未列出',
      priceFresh: '价格已核实',
      priceStale: '价格已过期——成本敏感决策前请核实',
      priceUnverified: '价格未核实',
      costTier: '所有者成本档',
      costNote: '推理设置只通过真实令牌用量改变总成本；不存在按档位乘数。',
      localPricing: '不适用——本地模型；云端/API 令牌费用为 $0',
      localCostNote: '本地模型的云端/API 令牌费用为 $0；本地资源消耗（GPU 时间、显存、电力、本地算力可用性）与供应商令牌定价相互独立。推理级别只改变使用的本地算力与思考时间——不存在按档位乘数。',
      cloudCostNote: '实际美元成本由真实令牌数量与已核实的供应商单价计算；推理级别本身没有固定乘数——推理只通过真实令牌用量改变总花费。',
      actualCost: '实际成本 = 真实令牌数 × 存储单价',
      strengths: '优势',
      avoid: '避免用于',
      evidence: '证据',
      metadataMalformed: '所有者元数据文件存在问题——无效条目已被拒绝并标记复查',
      metadataMissing: '未找到所有者元数据文件',
      metadataUnreadable: '无法读取所有者元数据文件',
      guideFile: '规范指南文件',
      update: '更新模型与价格',
      updating: '正在更新——重新扫描供应商、比对目录、抓取价格页…',
      updateDone: '更新完成',
      updateFailed: '更新失败',
      changes: '自上次更新以来的变化',
      noChangesYet: '尚未运行过更新。使用“更新模型与价格”记录一次。',
      added: '新增模型',
      removed: '移除的模型',
      changed: '变化的事实',
      reasoningChanges: '推理元数据变化（先核实再采信）',
      ownerMismatches: '所有者原生默认值不一致（所有者推荐仍然优先）',
      pricingSnapshots: '价格页快照（官方来源已留存为证据；已核实单价由官方表格确定性解析——解析失败时保留此前的已核实单价并标记待复查）',
      stalePrices: '标记为过期或未核实的价格',
      notes: '更新说明',
      copyFullGuide: '复制完整模型指南',
      copyRoutingGuide: '复制推荐路由指南',
      ownerTitle: '所有者自定义',
      ownerSubtitle: '状态来自外部恢复工具；即使没有此页面，外部层也始终可以恢复',
      ownerRefresh: '检查我的自定义',
      ownerNoEntries: '保存清单中尚未注册任何自定义项目。添加或恢复外部自定义项目后，再执行 Check My Customizations。',
      renderErrorTitle: '面板渲染错误',
      renderErrorRetry: '重试',
      ownerRestoreHint: '三者的区别：第 1 步（检查我的自定义）只检查当前安装状态；干跑检查只预览恢复工具将要恢复的内容，不做任何更改；执行恢复才真正执行已批准的恢复——且仅在您复查干跑结果之后。"需要复查"和"不兼容"条目一律拒绝。',
      ownerRestoreCommand: '复制干跑检查命令',
      ownerApplyCommand: '复制执行恢复命令',
      ownerPlanned: '计划中的恢复操作',
      ownerNoPlanned: '该条目没有记录计划操作。',
      researchButton: '研究未验证模型',
      researchTitle: '研究前确认——不会自动运行任何内容',
      researchIntro: '只有您亲自运行复制的提示或批准某个代理执行时才消耗模型令牌。此处不会自动运行模型。',
      researchModels: '存在未解决字段的模型',
      researchNoModels: '当前没有模型存在未解决的能力或价格字段。',
      researchResearcher: '建议执行研究的模型（按规范路由规则选择最便宜且胜任者）',
      researchLocal: '本地——无云端令牌费用；消耗本地 GPU 时间',
      researchPaid: '付费云端——按存储的已核实单价计费',
      researchReasoning: '推理级别',
      researchCopyPrompt: '复制研究提示词',
      researchScopeNewlyDetected: '研究新发现的模型',
      researchScopeAllUnverified: '研究所有未核实模型',
      researchScopeSelected: '研究选中模型',
      researchTokensFree: '复制提示词不消耗模型令牌；在其他地方运行才会消耗',
      researchCopySelected: '为选中模型复制提示词',
      importTitle: '导入/复查研究结果',
      importHelp: '按研究提示词自身规定的 JSON 数组格式粘贴研究结果（每个模型一个 "model"/"facts" 块）。只接受可导入的事实字段——云部署模型可包含 pricing（规范 { inputPerMTok, cachedInputPerMTok, outputPerMTok, offPeak? } 记录，须带官方来源与核实日期）；记录为本地的模型不得包含 pricing。每条事实都必须带官方来源 URL 和核实日期；绝不会覆盖所有者推荐设置。不支持的字段会被拒绝。',
      importPlaceholder: '[\n  {\n    "model": "deepseek-official/deepseek-v4-pro",\n    "facts": {\n      "contextWindow": { "value": 262144, "source": "https://api-docs.deepseek.com/...", "verifiedAt": "2026-10-14" },\n      "pricing": { "value": { "inputPerMTok": 0.3, "cachedInputPerMTok": 0.006, "outputPerMTok": 1.2 }, "source": "https://api-docs.deepseek.com/pricing", "verifiedAt": "2026-10-14" }\n    }\n  }\n]',
      importReview: '复查变更',
      importReviewHint: '以下是将要保存的事实。请先检查再继续。尚未保存任何内容。请复查差异：',
      importApply: '保存已复查事实',
      importApplied: '已应用：已复查事实已保存到目录中；指南已重新生成。被拒绝的字段未应用。',
      researchLoadFailed: '无法加载研究前确认',
      stepsTitle: '您的工作流程——共四步',
      shareTitle: '分享 / 复制指南信息',
      nextChecking: '正在检查您的进度……',
      nextUpToDate: '一切均是最新的。您随时可以使用第 1 步检查是否有更新的模型或单价。',
      ownerDryRunHelp: '复制一条 Linux 终端命令，它会显示将要恢复的内容。它不会执行恢复更改。',
      ownerApplyRestoreHelp: '复制一条 Linux 终端命令，它会执行已批准的恢复。这里只复制命令；只有当您把它粘贴到终端中运行时才会执行。',
      step1Title: '第 1 步 — 检查模型与单价',
      step1Help: '"检查模型与单价"按钮检查当前可用的模型并刷新已核实的供应商单价。它不会运行模型，也不消耗模型令牌。完成后可查看"自上次更新以来的变化"。',
      step2Title: '第 2 步 — 研究缺失信息',
      step2Help: '当新模型缺少事实（上下文长度、推理、工具支持、单价）时，在此准备研究说明。创建或复制研究提示词不消耗模型令牌——只有当您把提示词粘贴到 ChatGPT、DeepSeek 或其他有研究能力的模型中运行时才消耗。去向：ChatGPT / DeepSeek 研究会话。',
      step3Title: '第 3 步 — 粘贴并复查研究结果',
      step3Help: '把研究助手返回的 JSON 结果粘贴到此卡片文本框中，然后点击"复查变更"。尚未保存任何内容。',
      step4Title: '第 4 步 — 保存已复查事实',
      step4Help: '"保存已复查事实"只保存上方复查中显示的事实。',
      recommended: '推荐',
      whatNext: '接下来做什么？',
      nextStart: '从第 1 步开始：更新模型列表与单价。',
      nextNewDetected: '$N 个新模型需要研究。请继续第 2 步。',
      nextResearchPrompt: '使用第 2 步：选择推荐的范围，复制研究提示词，并在 ChatGPT 或 DeepSeek 中运行。',
      nextPromptCopied: '研究提示词已复制。请在 ChatGPT/DeepSeek 中运行，并把 JSON 结果带回到这里。',
      nextReviewReady: '结果已就绪，可以复查。继续第 3 步。',
      nextReviewDone: '复查完成。如果一切看起来正确，使用第 4 步保存。',
      nextApplied: '已保存。除非出现新模型或缺失事实，否则一切均是最新的。',
      nextFresh: '一切都已是最新的。',
      scopeHelpNewlyDetected: '只研究我们尚未记录的新模型。推荐。',
      scopeHelpSelected: '自己勾选一个或多个模型。',
      scopeHelpAllUnverified: '研究所有仍缺失事实的模型。这会产生大得多的研究任务。',
      copyResearchHelp: '复制研究说明。把它们粘贴到 ChatGPT 或 DeepSeek 研究会话中。把 JSON 结果带回到这里的第 3 步。去向：ChatGPT / DeepSeek 研究会话。',
      copyConfirm: '已复制——请粘贴到 ChatGPT 或 DeepSeek 中。',
      helpUpdate: '刷新可用模型列表和已核实的供应商单价。不会运行模型，也不消耗模型令牌。',
      helpResearch: '为缺失事实的模型准备研究说明。复制提示词免费；在模型中运行可能消耗令牌。',
      helpChanges: '显示上次刷新模型或单价时的变化。',
      helpFullGuide: '复制完整模型目录，包括能力、推理、单价和所有者指引——主要用于审计、规划、交接，或当另一个助手需要完整信息时。去向：ChatGPT / DeepSeek 提示词或审计/交接文档。',
      helpRoutingGuide: '复制简短的模型选择规则——当您希望 ChatGPT 或 DeepSeek 选择能胜任工作且最便宜的模型时，把这段话粘贴给它。去向：ChatGPT / DeepSeek 提示词。',
      helpApplyFacts: '只保存您在第 3 步复查过的事实。',
      applyNeedsReview: '请先在第 3 步复查拟议的变更，然后才能保存。',
      copyModelInfoHelp: '复制该模型的能力、推理选项、单价和所有者指引。当您希望 ChatGPT 或 DeepSeek 使用、评估或对比这个特定模型时，把这段信息粘贴给它。去向：ChatGPT / DeepSeek 提示词。',
      cardsHelp: '这些卡片就是您的模型目录。您通常不需要点击它们——只有当您想让另一个助手了解某个特定模型时，才使用"复制模型信息"。',
      ownerIntro: '此页面帮助您在 DeepSeek 更新时保全您的自定义功能。检查是安全的，不会改变任何内容。',
      ownerStep1Title: '第 1 步 — 检查我的自定义项目',
      ownerStep1Help: '检查已保存自定义项目的当前状态。这不会改变任何内容。',
      ownerStep2Title: '第 2 步 — 需要时恢复',
      statusHelpInstalled: '已存在。下一步：无需操作。',
      statusHelpCanRestore: '保存的自定义项目看起来兼容，可以恢复。下一步：更新后若缺失，请先使用第 2 步的干跑检查。',
      statusHelpNeedsReview: '不要自动应用。下一步：先进行人工复查。',
      statusHelpIncompatible: '保存的自定义项目与此版本不匹配。下一步：不要将该已保存自定义项目应用到当前版本。',
      ownerStep2Help: '如果某个自定义项目需要处理，复制下面对应的命令并自行运行。',
      ownerCmdHelp: '复制终端命令。它不会运行——只有当您想执行该操作时，才把命令粘贴到 Linux 终端中。',
      ownerTerminalDestination: '去向：Linux 终端。',
      ownerRestoreVsApply: '区别：检查命令只报告当前状态；执行命令才真正执行恢复——先检查、看结果，再执行。',
      priceChanges: '价格变化（自上次更新，官方已核实单价）',
      researchNeededLabel: '需要研究（新检测到、无所有者策划）',

      ownerMissing: '未找到状态文件。请在终端运行外部检查器：',
      ownerUnconfigured: '此面板未配置外部状态文件。',
      ownerMalformed: '外部状态文件不可读或格式错误。',
      ownerUnavailable: '状态服务不可达（模型指南宿主服务未应答）。',
      ownerChecked: '检查时间',
      statusInstalled: '已安装',
      statusCanRestore: '可干净恢复',
      statusNeedsReview: '需要复查',
      statusIncompatible: '不兼容',
      statusUnknown: '未知',
      enginesButton: '引擎',
      enginesButtonHelp: '显示每个已注册推理引擎的最新上游版本、已安装版本和所有者验证配置。',
      enginesSectionTitle: '推理引擎版本',
      enginesDescription: '每个引擎有三个独立状态：版本可用（来自 GitHub）、已安装（宿主检测或所有者记录），以及已验证（所有者测试的配置）。不会从此处安装或激活任何引擎。',
      enginesCheckButton: '检查引擎版本',
      enginesChecking: '正在检查上游版本…',
      enginesCheckDone: '引擎检查完成',
      enginesCheckFailed: '引擎检查失败',
      enginesLatestLabel: '最新上游版本',
      enginesInstalledLabel: '已安装',
      enginesNotDetected: '未检测到',
      enginesNotChecked: '尚未检查',
      enginesReleasedAt: '发布时间',
      enginesLastChecked: '上次检查时间',
      enginesUpdateAvailable: '有可用的新版本',
      enginesVerifiedTitle: '已验证配置',
      enginesNoVerified: '尚无已记录的验证配置。',
      enginesVerifiedPassed: '通过',
      enginesVerifiedFailed: '失败',
      enginesVerifiedModel: '模型',
      enginesVerifiedGpus: 'GPU',
      enginesVerifiedAt: '验证时间',
      enginesVerifiedEvidence: '证据',
      enginesDistinctionNote: '版本可用 ≠ 已安装；已安装 ≠ 已验证。已验证配置表示所有者已运行真实测试——不适用于其他模型或 GPU 组合。',
      enginesControlVersionNote: '此项目对应用与引擎分别编号，因此上方发布版本与已安装的引擎版本不可直接比较。',
      enginesEngineBuildLabel: '已发布的引擎构建',
      enginesMinimumDriverLabel: '最低驱动版本',
      enginesAdviceReview: '建议评估',
      enginesAdviceDefer: '暂缓',
      enginesAdviceNoAction: '无需操作',
      enginesAdviceWhy: '原因',
      enginesAdviceDestination: '调查入口',
      enginesAdviceApproval: '安装或升级前必须获得所有者批准。',
      enginesCopyPrompt: '复制调查提示词',
      enginesReasonNewerStable: '上游已发布更新的稳定版本',
      enginesReasonPrerelease: '上游最新版本是预发布版本',
      enginesReasonDriverBelow: '本机 GPU 驱动低于该版本的最低要求',
      enginesReasonDriverUnknown: '无法在本机验证该版本的最低驱动要求',
      enginesReasonCheckFailed: '上次上游检查失败',
      enginesReasonStale: '记录的检查时间已超过新鲜度窗口',
      enginesReasonUpToDate: '已安装版本与已发布版本一致',
      enginesReasonNotDetected: '无法检测已安装版本',
      enginesReasonNotChecked: '该引擎尚未检查',
      enginesReasonIncomparable: '两个版本无法比较',
      enginesReasonControlSpace: '该项目将引擎构建与应用发布分开编号',
      localFilesTitle: '本地 GGUF 模型',
      localFilesSubtitle: '来自共享发现缓存的本地 GGUF 模型文件',
      localFilesUnconfigured: '本地发现缓存路径未配置',
      localFilesMissing: '未找到本地发现缓存文件',
      localFilesUnreadable: '无法读取本地发现缓存文件',
      localFilesMalformed: '本地发现缓存文件不是有效 JSON',
      localFilesSchemaUnsupported: '本地发现缓存架构版本不受支持',
      localFilesOk: '本地发现缓存加载成功',
      localFilesGeneratedAt: '缓存生成时间',
      localFilesCandidates: '发现的模型',
      localFilesNoCandidates: '未发现本地模型',
      localFilesMultiPart: '多部分',
      localFilesSinglePart: '单文件',
      localFilesShards: '分片',
      localFilesSize: '大小',
      localFilesPath: '路径',
      localFilesCachePath: '缓存路径',
    }

    /**
     * Strict pass-through codec. Client-side mount validation
     * (`requireStrictCodec` in the Remote gateway) accepts only
     * `mode: 'strict'` codecs; call time never re-parses plain JSON
     * arguments, so the schema is an identity parse. The Host still validates
     * its own side through the SRC fallback descriptor's src-json codec.
     */
    const strictJson = () => ({
      mode: 'strict',
      typeSymbol: 'model-guide/plain-json',
      create: () => ({ parse: (value) => value }),
    })

    /**
     * Build one SRC-plane invocation descriptor.
     * @param {string} method endpoint method name under the `modelGuide` namespace.
     * @param {Array<{name: string}>} params ordered business parameters.
     */
    const descriptor = (method, params) => ({
      id: `${PACKAGE}#modelGuide/${method}`,
      service: 'modelGuide',
      namespace: 'modelGuide',
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

    /** @param {string|undefined} value */
    const show = (value) => value === undefined || value === null ? h('span', null) : String(value)

    /**
     * Unwrap one RemoteResult envelope from a mounted Remote method.
     * @param {object} result {ok: true, value} or {ok: false, error}.
     * @returns {object} the value, or a rejected-shaped error.
     */
    const unwrap = (result) => {
      if (result !== null && typeof result === 'object' && 'ok' in result) {
        if (result.ok) return result.value
        throw result.error
      }
      return result
    }

    /**
     * Display text for a thrown Remote failure: the error object's message
     * when present, otherwise the plain string conversion.
     * @param {unknown} failure thrown rejection reason.
     * @returns {string} user-visible message.
     */
    const failureText = (failure) => failure instanceof Error ? failure.message
      : failure !== null && typeof failure === 'object' && typeof failure.message === 'string' ? failure.message
        : String(failure)

    /** Unknown/needs-review inline marker. */
    const Unknown = ({ t, review }) => h('span', {
      style: {
        color: review ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
      },
    }, review ? t('needsReview') : t('unknown'))

    const badge = (text, tone) => h('span', {
      style: {
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 12,
        border: `1px solid ${tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)'}`,
        color: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
      },
    }, text)

    const field = (label, value) => h('div', { style: { minWidth: 180, flex: '1 1 auto', margin: '4px 0' } },
      h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } }, label),
      h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, value))

    /**
     * Display text for one derived engine recommendation.
     *
     * The Host decides the verdict; this maps it to words and never infers a
     * recommendation from a version itself.
     * @param {string} recommendation REVIEW, DEFER or NO_ACTION.
     * @param {object} t locale lookup.
     * @returns {string} user-visible label.
     */
    const adviceLabel = (recommendation, t) => recommendation === 'REVIEW' ? t('enginesAdviceReview')
      : recommendation === 'DEFER' ? t('enginesAdviceDefer')
        : t('enginesAdviceNoAction')

    /**
     * Display text for the reason behind one engine recommendation.
     *
     * A reason the client does not know is shown verbatim rather than hidden:
     * an unexplained recommendation is worse than an untranslated one.
     * @param {string} reason one of the Host's advice reasons.
     * @param {object} t locale lookup.
     * @returns {string} user-visible label.
     */
    const adviceReasonLabel = (reason, t) => ({
      'newer-stable': t('enginesReasonNewerStable'),
      'newer-prerelease': t('enginesReasonPrerelease'),
      'driver-below-minimum': t('enginesReasonDriverBelow'),
      'driver-unknown': t('enginesReasonDriverUnknown'),
      'check-failed': t('enginesReasonCheckFailed'),
      'check-stale': t('enginesReasonStale'),
      'up-to-date': t('enginesReasonUpToDate'),
      'not-detected': t('enginesReasonNotDetected'),
      'not-checked': t('enginesReasonNotChecked'),
      incomparable: t('enginesReasonIncomparable'),
      'control-space': t('enginesReasonControlSpace'),
    })[reason] ?? reason

    /**
     * Join card field parts that actually exist; a missing side renders
     * nothing instead of dash placeholders, and an empty list renders a
     * Needs Review unknown element.
     * @param {(string|null)[]} parts
     * @param {object} t locale lookup for the placeholder.
     * @returns {string|object}
     */
    const partsJoin = (parts, t) => {
      const kept = parts.filter((part) => typeof part === 'string' && part.trim().length > 0)
      return kept.length === 0 ? h(Unknown, { t, review: true }) : kept.join('; ')
    }

    const sectionCard = (title, body) => h('div', {
      style: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        padding: '12px 16px',
        marginBottom: 12,
      },
    }, h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 } }, title),
      ...body)

    /**
     * One merged model row.
     * @param {object} props { rowKey, row, t, onCopy, copyKey, copyResult }
     */
    function ModelCard({ rowKey, row, t, onCopy, copyKey, copyResult }) {
      // Only the clicked row reacts; every other row stays in its normal state.
      const copyState = copyKey === rowKey ? copyResult : undefined
      const reasoning = row.reasoning ?? undefined
      const pricing = row.pricing ?? undefined
      const context = row.context ?? undefined
      const modalities = row.modalities ?? undefined
      const [expanded, setExpanded] = React.useState(false)
      return h('div', {
        style: {
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 10,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer', flexWrap: 'wrap' }, onClick: () => setExpanded(!expanded) },
          h('strong', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } }, row.name ?? row.id),
          badge(row.provider, undefined),
          row.localVsCloud === 'unknown'
            ? badge(t('needsReview'), 'warn')
            : badge(row.localVsCloud === 'local' ? t('local') : t('cloud'), undefined),
          pricing?.freshness === 'stale' ? badge(t('priceStale'), 'warn')
            : pricing?.freshness === 'unverified' ? badge(t('priceUnverified'), 'warn') : null,
          row.needsReview ? badge(t('needsReview'), 'warn') : null,
          h('span', { style: { flex: 1 } }),
          h('button', {
            type: 'button',
            style: {
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-overlay)',
              color: 'var(--dsw-alias-label-primary)',
              borderRadius: 8,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 12,
            },
            title: t('copyModelInfoHelp'),
            onClick: (event) => { event.stopPropagation(); onCopy(row.provider, row.id) },
          }, copyState === 'done' ? t('copyConfirm') : copyState === 'failed' ? t('copyFailed') : t('copy')),
        ),
        expanded ? h('div', { style: { marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 12 } },
          field(t('context'), context === undefined ? h(Unknown, { t, review: true }) : [
            context.ownerConfigured === undefined ? null : `${t('ownerConfigured')} ${context.ownerConfigured}`,
            context.ownerConfigured !== undefined && context.providerReported !== undefined ? '; ' : null,
            context.providerReported === undefined ? null : `${t('providerReported')} ${context.providerReported}`,
          ].filter((part) => part !== null)),
          field(t('modalities'), modalities === undefined
            ? h(Unknown, { t, review: true })
            : partsJoin([
              (modalities.owner ?? []).length > 0 ? `owner ${modalities.owner.join(', ')}` : null,
              (modalities.providerReported ?? []).length > 0 ? `reported ${modalities.providerReported.join(', ')}` : null,
            ], t)),
          field(t('toolSupport'), row.toolSupport === undefined ? h(Unknown, { t, review: true })
            : row.toolSupport === null ? t('unknown') : row.toolSupport ? 'Yes' : 'No'),
          field(t('reasoningModes'), reasoning === undefined ? h(Unknown, { t, review: true })
            : partsJoin([
              (reasoning.ownerModes ?? []).length > 0 ? `owner ${reasoning.ownerModes.join(' / ')}` : null,
              reasoning.providerEfforts === undefined ? null : `reported: ${reasoning.providerEfforts.map((effort) => effort.name).join(' / ')}`,
            ], t)),
          field(t('nativeDefault'), reasoning === undefined ? h(Unknown, { t, review: true })
            : [
              reasoning.ownerNativeDefault === undefined ? null : `${t('ownerDefault')}: ${reasoning.ownerNativeDefault}`,
              reasoning.ownerNativeDefault !== undefined && reasoning.providerDefault !== undefined ? '; ' : null,
              reasoning.providerDefault === undefined ? null : `${t('providerDefault')}: ${reasoning.providerDefault}`,
            ].filter((part) => part !== null)),
          field(t('routine'), reasoning?.recommendedRoutine === undefined ? h(Unknown, { t, review: true }) : reasoning.recommendedRoutine),
          field(t('heavy'), reasoning?.recommendedHeavy === undefined ? h(Unknown, { t, review: false }) : reasoning.recommendedHeavy),
          h('div', { style: { width: '100%' } }),
          h('div', { style: { minWidth: 260, flex: '2 1 auto' } },
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } },
              `${t('pricing')} — ${t('actualCost')}`),
            row.localVsCloud === 'local'
              ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('localPricing'))
              : pricing === undefined
                ? h(Unknown, { t, review: true })
                : h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
                `${t('inputRate')}: $${pricing.inputPerMTok ?? 'Unknown'} · ${t('cachedRate')}: ${pricing.cachedInputPerMTok == null ? t('notListed') : `$${pricing.cachedInputPerMTok}`} · ${t('outputRate')}: $${pricing.outputPerMTok ?? t('unknown')}`,
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
                  [pricing.source, pricing.verifiedAt, pricing.costTier ? `${t('costTier')}: ${pricing.costTier}` : null]
                    .filter((part) => part != null).join(' · ') || '—')),
          ),
          field(t('costTier'), pricing?.costTier === undefined ? h(Unknown, { t, review: false }) : pricing.costTier),
          h('div', { style: { width: '100%', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            row.localVsCloud === 'local' ? t('localCostNote') : row.localVsCloud === 'cloud' ? t('cloudCostNote') : t('costNote')),
          reasoning?.note === undefined ? null : h('div', { style: { width: '100%', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, reasoning.note),
          (row.strengths === undefined && row.avoid === undefined && row.evidence === undefined) ? null : h('div', { style: { width: '100%' } },
            row.strengths === undefined ? null : h('div', { style: { fontSize: 12, marginTop: 6 } },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${t('strengths')}: `),
              h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, row.strengths.join('; '))),
            row.avoid === undefined ? null : h('div', { style: { fontSize: 12, marginTop: 2 } },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${t('avoid')}: `),
              h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, row.avoid.join('; '))),
            row.evidence === undefined ? null : h('div', { style: { fontSize: 12, marginTop: 2, color: 'var(--dsw-alias-label-secondary)' } }, `${t('evidence')}: ${row.evidence}`)),
          row.ownerProblems === undefined ? null : h('div', { style: { width: '100%', fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)', marginTop: 6 } },
            `${t('needsReview')}: ${row.ownerProblems.join('; ')}`),
        ) : null,
      )
    }

    /**
     * The model guide page.
     * @param {object} props { load, copyGuidance, update, lastReport, copyFullGuide, copyRoutingGuide, t }
     */
    /**
     * The research preflight panel: shows the owner-visible scope controls
     * (safe default: newly detected), which models have unresolved fields with
     * per-model field counts, the proposed researcher with its local/paid
     * cost nature and reasoning level, a deterministic Copy Research Prompt
     * action for the active scope or the owner's selected models, and the
     * Import & Review → Apply workflow for structured research results.
     * Nothing here invokes a model: copying the prompt is free; running it
     * elsewhere is the owner's explicit act, and every imported fact needs an
     * official source URL plus a verifiedAt — owner recommendations are
     * never overwritten.
     * @param {object} props { research, researchScope, researchSelection, importState,
     *   onScope, onToggle, researchCopyState, onCopyResearch, onPreviewImport, onApplyImport, onClose, t }
     */
    function ResearchPanel({ research, researchScope, researchSelection, importState, onScope, onToggle, researchCopyState, onCopyResearch, onPreviewImport, onApplyImport, onClose, t }) {
      const [draft, setDraft] = React.useState('')
      const rowStyle = { fontSize: 12, marginBottom: 6, padding: '6px 8px', background: 'var(--dsw-alias-bg-overlay)', borderRadius: 8 }
      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)',
        borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
      }
      const scopeLabels = {
        'newly-detected': t('researchScopeNewlyDetected'),
        'all-unverified': t('researchScopeAllUnverified'),
        selected: t('researchScopeSelected'),
      }
      const models = research?.data?.models ?? []
      const importPhase = importState?.phase ?? 'idle'
      return h('div', {
        style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
          h('strong', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } }, t('researchTitle')),
          h('button', { type: 'button', onClick: onClose, style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '✕')),
        h('div', { style: { fontSize: 12, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' } }, t('researchIntro')),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
          Object.entries(scopeLabels).map(([scope, label]) => h('button', { key: scope, type: 'button', onClick: () => onScope(scope),
            title: t(scope === 'newly-detected' ? 'scopeHelpNewlyDetected' : scope === 'selected' ? 'scopeHelpSelected' : 'scopeHelpAllUnverified'),
            style: { ...buttonStyle, background: researchScope === scope ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-overlay)', color: researchScope === scope ? 'var(--dsw-alias-bg-layer-1)' : 'var(--dsw-alias-label-primary)' } },
            scope === 'newly-detected' ? `${label} · ${t('recommended')}` : label))),
        research.status === 'loading'
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
          : research.status === 'error'
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, `${t('researchLoadFailed')}: ${research.message}`)
            : h('div', null,
                h('div', { style: { fontSize: 12, marginBottom: 4, color: 'var(--dsw-alias-label-secondary)' } },
                  `${scopeLabels[research?.data?.scope ?? 'newly-detected'] ?? research?.data?.scope ?? ''} · ${t('researchModels')}: ${models.length} · ${t('researchTokensFree')}`),
                h('div', { style: { marginBottom: 8 } }, models.length === 0
                  ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('researchNoModels'))
                  : models.map((model, index) => h('div', { key: model.key, style: rowStyle },
                      h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } },
                        h('input', { type: 'checkbox', checked: researchSelection.includes(model.key), onChange: () => onToggle(model.key), style: { margin: 0 } }),
                        h('strong', null, `${model.key}`), ` — ${model.name}`),
                      h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: 2, fontSize: 12 } }, `${index + 1}. ${model.fields.length} field(s): `),
                      h('ul', { style: { margin: '2px 0 0 18px', padding: 0, color: 'var(--dsw-alias-label-secondary)' } },
                        model.fields.map((field, fieldIndex) => h('li', { key: fieldIndex }, field)))))),
                research.data?.researcher?.primary === undefined ? null : h('div', { style: { fontSize: 12, marginBottom: 6, color: 'var(--dsw-alias-label-primary)' } },
                  `${t('researchResearcher')}: ${research.data.researcher.primary.name} (${research.data.researcher.primary.key}) — `,
                  research.data.researcher.primary.localVsCloud === 'local'
                    ? h('span', { style: { color: 'var(--dsw-alias-state-ok-primary)' } }, t('researchLocal'))
                    : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, t('researchPaid')),
                  ' ',
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    `${t('researchReasoning')}: ${String(research.data.researcher.primary.reasoningLevel)}`)),
                research.data?.researcher?.paidAlternative === undefined ? null : h('div', { style: { fontSize: 12, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' } },
                  `${t('researchPaid')}: ${research.data.researcher.paidAlternative.name} (${research.data.researcher.paidAlternative.key})`),
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  h('button', { type: 'button', title: t('copyResearchHelp'), onClick: () => onCopyResearch(), style: buttonStyle },
                    `${researchCopyState === 'done' ? t('copyConfirm') : researchCopyState === 'failed' ? t('copyFailed') : t('researchCopyPrompt')} (${models.length})`),
                  researchSelection.length === 0 ? null
                    : h('button', { type: 'button', onClick: () => onCopyResearch(researchSelection), style: buttonStyle },
                      `${t('researchCopySelected')} (${researchSelection.length})`))),
        h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: 10, paddingTop: 8 } },
          h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('importTitle')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0' } }, t('importHelp')),
          h('textarea', { value: draft, rows: 6, onChange: (event) => setDraft(event.target.value), placeholder: t('importPlaceholder'),
            style: { width: '100%', fontSize: 12, fontFamily: 'monospace', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8, boxSizing: 'border-box' } }),
          importPhase === 'error'
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', margin: '6px 0' } }, importState.message)
            : null,
          importPhase === 'preview' || importPhase === 'applied' ? h('div', { style: { fontSize: 12, margin: '6px 0' } },
            h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } },
              importPhase === 'applied' ? t('importApplied') : t('importReviewHint')),
            (importState?.data?.changes ?? []).length === 0 ? null : h('ul', { style: { margin: '2px 0 8px 18px', padding: 0 } },
              importState.data.changes.map((change, index) => h('li', { key: index, style: { marginBottom: 4 } },
                `${change.key} — ${priceFieldLabel(change.field)}: ${priceValueText(change.from)} → ${priceValueText(change.to)} · ${change.source} (${change.verifiedAt})`))),
            (importState?.data?.rejected ?? []).length === 0 ? null : h('div', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, h('ul', { style: { margin: '2px 0 8px 18px', padding: 0 } },
              importState.data.rejected.map((item, index) => h('li', { key: index },
                `${item.model ?? ''}${item.fact === undefined ? '' : ` — ${item.fact}`}: ${item.reason}`)))))
            : null,
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', onClick: () => onPreviewImport(draft), title: t('step3Title'), style: buttonStyle }, t('importReview')),
            h('button', {
              type: 'button',
              disabled: importPhase !== 'preview',
              title: importPhase === 'preview' ? t('helpApplyFacts') : t('applyNeedsReview'),
              onClick: () => { if (importPhase === 'preview') onApplyImport(draft, importState?.data?.reviewId) },
              style: { ...buttonStyle, opacity: importPhase === 'preview' ? 1 : 0.55, cursor: importPhase === 'preview' ? 'pointer' : 'not-allowed' },
            }, t('importApply')),
            importPhase === 'preview' || importPhase === 'applied'
              ? null
              : h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' } }, t('applyNeedsReview')),
            importPhase === 'idle' || importPhase === 'applied' ? null : h('button', { type: 'button', onClick: () => setDraft(''), style: { ...buttonStyle, cursor: 'pointer' } }, '✕')),
        ))
    }

    function Page({ load, copyGuidance, update, lastReport, copyFullGuide, copyRoutingGuide, researchStatus, researchPrompt, previewResearchResults, applyResearchResults, loadEngineCatalog, checkEngines, t }) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [query, setQuery] = React.useState('')
      const [copyState, setCopyState] = React.useState()
      const [updateState, setUpdateState] = React.useState()
      const [showChanges, setShowChanges] = React.useState(false)
      const [changesReport, setChangesReport] = React.useState(undefined)
      const [guideCopyState, setGuideCopyState] = React.useState()
      const [research, setResearch] = React.useState(undefined)
      const [researchCopyState, setResearchCopyState] = React.useState()
      // Owner-visible research scope (safe default: newly detected) and the
      // selected model keys for a scoped prompt; the import state drives the
      // Import & Review → Apply confirmation flow for research results.
      const [researchScope, setResearchScope] = React.useState('newly-detected')
      const [researchSelection, setResearchSelection] = React.useState([])
      const [importState, setImportState] = React.useState({ phase: 'idle' })
      const [showEngines, setShowEngines] = React.useState(false)
      const [enginesData, setEnginesData] = React.useState(undefined)
      const [enginesCheckState, setEnginesCheckState] = React.useState(undefined)
      const [promptCopyState, setPromptCopyState] = React.useState()
      React.useEffect(() => {
        let active = true
        setState({ status: 'loading' })
        load().then((data) => { if (active) setState({ status: 'ready', data }) },
          (failure) => { if (active) setState({ status: 'error', message: failureText(failure) }) })
        return () => { active = false }
      }, [])
      // Copy feedback is scoped to the row that owns the click: the state is
      // a {key, result} pair keyed by the row's stable `provider/modelId`
      // identity, never a shared boolean for all rows.
      const doCopy = React.useCallback(async (provider, model) => {
        const rowKey = `${provider}/${model}`
        setCopyState({ key: rowKey, result: undefined })
        try {
          const text = await copyGuidance(provider, model)
          await navigator.clipboard.writeText(text)
          setCopyState({ key: rowKey, result: 'done' })
        } catch {
          setCopyState({ key: rowKey, result: 'failed' })
        }
        setTimeout(() => setCopyState((current) => (current?.key === rowKey ? undefined : current)), 2000)
      }, [copyGuidance])
      const doUpdate = React.useCallback(async () => {
        setUpdateState({ status: 'running' })
        setShowChanges(true)
        try {
          const result = await update()
          setChangesReport(result.report ?? null)
          setUpdateState({ status: 'done' })
          // Reload the merged snapshot so new/removed models appear immediately.
          load().then((data) => setState({ status: 'ready', data }), () => {})
        } catch (message) {
          setUpdateState({ status: 'failed', message: failureText(message) })
        }
      }, [update, load])
      const doCopyGuide = React.useCallback(async (fetcher, setFlag) => {
        try {
          const value = await fetcher()
          const text = typeof value === 'object' && value !== null && 'text' in value ? value.text : value
          await navigator.clipboard.writeText(text)
          setFlag('done')
        } catch {
          setFlag('failed')
        }
        setTimeout(() => setFlag(undefined), 2000)
      }, [])
      // Preflight is pure read: it shows what WOULD be researched, by whom,
      // and whether that costs local or paid tokens — before anything runs.
      const doResearch = React.useCallback(async (scope) => {
        if (typeof scope !== 'string') scope = undefined // never an event object
        if (research !== undefined && scope === undefined) { setResearch(undefined); return }
        const chosen = scope ?? researchScope
        setResearchScope(chosen)
        setResearch({ status: 'loading' })
        try {
          setResearch({ status: 'ready', data: await researchStatus(chosen) })
        } catch (message) {
          setResearch({ status: 'error', message: failureText(message) })
        }
      }, [research, researchScope, researchStatus])
      // Copying the prompt is free of model tokens; running it is the
      // owner's explicit act elsewhere.
      const doCopyResearch = React.useCallback(async (selectedKeys) => {
        const scope = Array.isArray(selectedKeys) && selectedKeys.length > 0 ? 'selected' : researchScope
        try {
          const result = await researchPrompt(scope, Array.isArray(selectedKeys) ? selectedKeys : undefined)
          await navigator.clipboard.writeText(typeof result === 'object' && result !== null && 'prompt' in result ? result.prompt : String(result))
          setResearchCopyState('done')
        } catch {
          setResearchCopyState('failed')
        }
        setTimeout(() => setResearchCopyState(undefined), 2000)
      }, [researchScope, researchPrompt])
      const doPreviewImport = React.useCallback(async (raw) => {
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          setImportState({ phase: 'error', message: `invalid JSON: ${failureText(error)}` })
          return
        }
        try {
          const preview = await previewResearchResults(parsed)
          setImportState(preview.status === 'ok'
            ? { phase: 'preview', data: preview }
            : { phase: 'error', data: preview, message: preview.reason ?? 'no verified fact passed validation' })
        } catch (message) {
          setImportState({ phase: 'error', message: failureText(message) })
        }
      }, [previewResearchResults])
      const doApplyImport = React.useCallback(async (raw, reviewId) => {
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          setImportState({ phase: 'error', message: `invalid JSON: ${failureText(error)}` })
          return
        }
        try {
          const applied = await applyResearchResults(parsed, reviewId)
          setImportState(applied.status === 'applied'
            ? { phase: 'applied', data: applied }
            : { phase: 'error', data: applied, message: applied.reason ?? 'nothing was applied' })
          // Refresh the guide rows over the fresh owner facts.
          if (applied.status === 'applied') load().then((data) => setState({ status: 'ready', data }), () => {})
        } catch (message) {
          setImportState({ phase: 'error', message: failureText(message) })
        }
      }, [applyResearchResults, load])
      const toggleChanges = React.useCallback(async () => {
        setShowChanges((visible) => !visible)
        if (changesReport === undefined) {
          try {
            const stored = await lastReport()
            setChangesReport(stored?.report ?? null)
          } catch {
            setChangesReport(null)
          }
        }
      }, [lastReport, changesReport])
      // Toggle the engine section and load the catalog on first open.
      const doToggleEngines = React.useCallback(async () => {
        const opening = !showEngines
        setShowEngines(opening)
        if (opening && enginesData === undefined) {
          setEnginesData({ status: 'loading' })
          try {
            const result = await loadEngineCatalog()
            setEnginesData({ status: 'ready', data: result })
          } catch (failure) {
            setEnginesData({ status: 'error', message: failureText(failure) })
          }
        }
      }, [showEngines, enginesData, loadEngineCatalog])
      // Trigger a live engine release check, then reload the catalog.
      const doCheckEngines = React.useCallback(async () => {
        setEnginesCheckState({ status: 'running' })
        try {
          await checkEngines()
          setEnginesCheckState({ status: 'done' })
          const result = await loadEngineCatalog()
          setEnginesData({ status: 'ready', data: result })
        } catch (failure) {
          setEnginesCheckState({ status: 'failed', message: failureText(failure) })
        }
      }, [checkEngines, loadEngineCatalog])
      // The investigation prompt is composed by the Host, so this only copies
      // the text it already produced; nothing is sent anywhere from the panel.
      const doCopyEnginePrompt = React.useCallback(async (prompt) => {
        try {
          await navigator.clipboard.writeText(prompt)
          setPromptCopyState('done')
        } catch {
          setPromptCopyState('failed')
        }
        setTimeout(() => setPromptCopyState(undefined), 2000)
      }, [])
      const actionButton = (label, onClick, flag, disabled, helpTitle) => h('button', {
        type: 'button',
        disabled: disabled === true,
        title: helpTitle,
        'aria-label': helpTitle,
        onClick,
        style: {
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-overlay)',
          color: disabled === true ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
          borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, opacity: disabled === true ? 0.6 : 1,
        },
      }, flag === 'done' ? t('copyConfirm') : flag === 'failed' ? t('copyFailed') : label)
      if (state.status === 'loading') return h('div', { style: { padding: 24, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
      if (state.status === 'error') return h('div', { style: { padding: 24 } },
        h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', marginBottom: 12 } }, `${t('loadFailed')}: ${state.message}`),
        h('button', { type: 'button', onClick: () => setState({ status: 'loading' }) || load().then((data) => setState({ status: 'ready', data }), (message) => setState({ status: 'error', message: failureText(message) })) }, t('retry')))
      const data = state.data ?? {}
      const metadataBanner = () => {
        if (data.metadata?.status === 'ok') return null
        const text = data.metadata?.status === 'malformed' ? t('metadataMalformed')
          : data.metadata?.status === 'missing' ? t('metadataMissing') : t('metadataUnreadable')
        const problems = data.metadata?.problems?.length === undefined ? null : h('div', { style: { fontSize: 12, marginTop: 4 } }, data.metadata.problems.join('; '))
        return h('div', { role: 'status', style: { border: '1px solid var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12 } }, text, problems)
      }
      // One plain-language instruction at a time, derived from the visible state.
      const whatNext = () => {
        // Session-transient progress first (pending review / fresh save).
        if (importState?.phase === 'preview') return t('nextReviewDone')
        if (importState?.phase === 'applied') return t('nextApplied')
        if (researchCopyState === 'done') return t('nextPromptCopied')
        if (research !== undefined && (importState === undefined || importState?.phase === 'idle')) return t('nextReviewReady')
        // Durable progress: the snapshot already carries persisted owner data
        // overlaid on live discovery, so a refresh cannot reset this to Step 1.
        const counts = data.researchCounts
        if (counts === undefined || counts === null) return t('nextChecking')
        const known = (data.providers?.length ?? 0) + (data.curatedOnly?.length ?? 0)
        if (known === 0) return t('nextStart')
        const newly = counts.newlyDetected
        if (typeof newly === 'number' && newly > 0) return t('nextNewDetected').replace('$N', String(newly))
        if (typeof counts.allUnverified === 'number' && counts.allUnverified > 0) return t('nextResearchPrompt')
        return t('nextUpToDate')
      }
      const rows = [
        ...(data.providers ?? []).flatMap((provider) => provider.models.map((row) => ({ ...row, providerError: provider.error }))),
        ...(data.curatedOnly ?? []),
      ]
      const needle = query.trim().toLowerCase()
      const matched = rows.filter((row) => needle.length === 0 || `${row.provider}/${row.id} ${row.name}`.toLowerCase().includes(needle))
      return h('div', { style: { padding: '16px 20px', overflow: 'auto', height: '100%', boxSizing: 'border-box' } },
        h('h2', { style: { margin: '0 0 2px', fontSize: 18, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 } }, t('subtitle')),
        // Instructions before actions: the owner reads what an action does
        // before meeting the action itself.
        h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 10, padding: '8px 14px', marginBottom: 12 } },
          h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 } },
            `${t('whatNext')}: `, h('strong', null, whatNext())),
          h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: '6px 0 2px' } }, t('stepsTitle')),
          ...['step1', 'step2', 'step3', 'step4'].map((step) => h('div', { key: step, style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
            h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, t(`${step}Title`)), ` — ${t(`${step}Help`)}`))),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 } },
          actionButton(updateState?.status === 'running' ? t('updating') : t('update'), doUpdate, undefined, updateState?.status === 'running', t('helpUpdate')),
          // Explicit no-arg wrapper: React passes the click event to a bare
          // handler, and a SyntheticEvent must never become a scope argument.
          actionButton(t('researchButton'), () => doResearch(), undefined, false, t('helpResearch')),
          actionButton(t('changes'), toggleChanges, undefined, false, t('helpChanges')),
          actionButton(t('enginesButton'), doToggleEngines, undefined, false, t('enginesButtonHelp')),
        ),
        h('div', { style: { marginBottom: 12 } },
          h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 6 } }, t('shareTitle')),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            actionButton(t('copyFullGuide'), () => doCopyGuide(copyFullGuide, setGuideCopyState), guideCopyState, false, t('helpFullGuide')),
            actionButton(t('copyRoutingGuide'), () => doCopyGuide(copyRoutingGuide, setGuideCopyState), guideCopyState, false, t('helpRoutingGuide')))),
        updateState?.status === 'failed' ? h('div', { style: { border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12 } }, `${t('updateFailed')}: ${updateState.message}`) : null,
        showChanges ? h(ChangesView, { report: changesReport, t }) : null,
        showEngines ? h(EnginesSection, {
          data: enginesData, checkState: enginesCheckState, onCheck: doCheckEngines,
          promptCopyState, onCopyPrompt: doCopyEnginePrompt, t,
        }) : null,
        state.status === 'ready' ? h(LocalFilesSection, { localFiles: state.data?.localFiles, t }) : null,
        research === undefined ? null : h(ResearchPanel, {
          research, researchScope, researchSelection, importState,
          onScope: doResearch, onToggle: (key) => setResearchSelection((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]),
          researchCopyState, onCopyResearch: doCopyResearch,
          onPreviewImport: doPreviewImport, onApplyImport: doApplyImport,
          onClose: () => setResearch(undefined), t,
        }),
data.routingRule === null || data.routingRule === undefined
          ? sectionCard(t('routingRule'), [h(Unknown, { t, review: true })])
          : sectionCard(t('routingRule'), [h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap' } }, data.routingRule)]),
        (data.gpuBoundary ?? []).length === 0 ? null : sectionCard(t('gpuBoundary'), (data.gpuBoundary ?? []).map((gpu) => h('div', { key: gpu.label, style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', marginBottom: 6 } },
          h('strong', null, gpu.label), ' — ', gpu.gpuName ?? '', ' ', gpu.role ?? '',
          gpu.uuid === undefined ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, gpu.uuid)))),
        metadataBanner(),
        data.guideMarkdownPath === undefined ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 } }, `${t('guideFile')}: ${data.guideMarkdownPath}`),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } }, t('cardsHelp')),
        h('input', {
          value: query,
          onChange: (event) => setQuery(event.target.value),
          placeholder: t('search'),
          'aria-label': t('search'),
          style: {
            width: '100%', maxWidth: 420, boxSizing: 'border-box', marginBottom: 14, padding: '6px 10px',
            borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
          },
        }),
        (data.providers ?? []).map((provider) => {
          const providerRows = provider.models
            .filter((row) => matched.some((m) => m.provider === provider.id && m.id === row.id))
          if (providerRows.length === 0) return null
          return h('div', { key: provider.id, style: { marginBottom: 16 } },
            h('h3', { style: { margin: '10px 0 8px', fontSize: 14, color: 'var(--dsw-alias-label-primary)' } },
              provider.name ?? provider.id,
              provider.error === undefined ? null : h('span', null, ' ', badge(provider.error, 'error'))),
            ...providerRows.map((row) => h(ModelCard, { rowKey: `${row.provider}/${row.id}`, row, t, onCopy: doCopy, copyKey: copyState?.key, copyResult: copyState?.result })))
        }),
        (data.curatedOnly ?? []).filter((row) => matched.some((m) => m.provider === row.provider && m.id === row.id)).length === 0 ? null
          : h('div', null,
            h('h3', { style: { margin: '10px 0 8px', fontSize: 14, color: 'var(--dsw-alias-label-secondary)' } }, t('curatedOnly')),
            ...(data.curatedOnly ?? [])
              .filter((row) => matched.some((m) => m.provider === row.provider && m.id === row.id))
              .map((row) => h(ModelCard, { rowKey: `${row.provider}/${row.id}`, row, t, onCopy: doCopy, copyKey: copyState?.key, copyResult: copyState?.result }))),
        matched.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', padding: 12 } }, t('unknown')) : null,
      )
    }

    /** Price-change field labels: structured off-peak rates render individually. */
    const PRICE_FIELD_LABELS = {
      inputPerMTok: 'Input',
      cachedInputPerMTok: 'Cached input',
      outputPerMTok: 'Output',
      offPeak: 'Off-peak',
      'offPeak.inputPerMTok': 'Off-peak input',
      'pricing.inputPerMTok': 'Pricing input', 'pricing.cachedInputPerMTok': 'Pricing cached input', 'pricing.outputPerMTok': 'Pricing output', 'pricing.offPeak.inputPerMTok': 'Pricing off-peak input', 'pricing.offPeak.cachedInputPerMTok': 'Pricing off-peak cached input', 'pricing.offPeak.outputPerMTok': 'Pricing off-peak output', 'offPeak.cachedInputPerMTok': 'Off-peak cached input',
      'offPeak.outputPerMTok': 'Off-peak output',
    }

    /** @param {string} field the price-diff field name. */
    const priceFieldLabel = (field) => PRICE_FIELD_LABELS[field] ?? field

    /**
     * One price value as display text: numbers as $X/1M, a structured rate
     * object as its three rates, nothing as "not listed" — never
     * "[object Object]" or a literal null.
     * @param {unknown} value the stored or new price value.
     * @returns {string}
     */
    const priceValueText = (value) => {
      if (value === null || value === undefined) return 'not listed'
      if (typeof value === 'number') return Number.isFinite(value) ? `$${value}/1M` : 'Unknown'
      if (typeof value === 'object') {
        return [
          `Input: ${value.inputPerMTok == null ? 'not listed' : `$${value.inputPerMTok}/1M`}`,
          `Cached input: ${value.cachedInputPerMTok == null ? 'not listed' : `$${value.cachedInputPerMTok}/1M`}`,
          `Output: ${value.outputPerMTok == null ? 'not listed' : `$${value.outputPerMTok}/1M`}`,
        ].join(' · ')
      }
      return String(value)
    }

    /** One report section of the changes view. */
    const reportSection = (title, items, render) => items.length === 0 ? null : sectionCard(title,
      items.map((item, index) => h('div', { key: index, style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 } }, render(item))))

    /**
     * The post-update / last-update report view.
     * @param {object} props { report, t }
     */
    function ChangesView({ report, t }) {
      if (report === undefined || report === null) {
        return h('div', { style: { padding: 12, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('noChangesYet'))
      }
      return h('div', null,
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '8px 0' } }, `${t('updateDone')}: ${report.generatedAt}`),
        reportSection(t('added'), report.added ?? [], (key) => String(key)),
        reportSection(t('removed'), report.removed ?? [], (key) => String(key)),
        reportSection(t('changed'), report.changed ?? [], (item) => `${item.key}: ${item.field} ${item.from ?? 'Unknown'} → ${item.to ?? 'Unknown'}`),
        reportSection(t('reasoningChanges'), report.reasoningChanges ?? [], (item) => `${item.key}: ${item.from ?? '—'} → ${item.to ?? '—'} — ${item.note ?? ''}`),
        reportSection(t('ownerMismatches'), report.ownerNativeMismatches ?? [],
          (item) => `${item.key}: owner ${item.ownerNativeDefault} vs provider ${item.providerDefault} — ${item.note}`),
        reportSection(t('priceChanges'), report.priceChanges ?? [], (item) => `${item.key}: ${item.changes.map((change) => `${priceFieldLabel(change.field)}: ${priceValueText(change.from)} → ${priceValueText(change.to)}`).join('; ')}`),
        reportSection(t('researchNeededLabel'), report.researchNeeded ?? [],
          (item) => `${item.key} (${item.name}) — ${item.fields?.join('; ') ?? ''}`),
        reportSection(t('pricingSnapshots'), report.pricingSnapshots ?? [],
          (item) => `${item.url} — ${item.ok ? `captured ${item.fetchedAt} (${item.bytes} bytes)` : `FAILED: ${item.error}`}`),
        reportSection(t('stalePrices'), report.stalePrices ?? [], (item) => `${item.key}: ${item.state} (verified ${item.verifiedAt})`),
        reportSection(t('notes'), report.notes ?? [], (item) => `${item.message}`),
      )
    }

    /**
     * The engine release, recommendation, and verification section.
     * Shows four separate states per engine: release (GitHub), the published
     * engine build where the project versions one separately, installed
     * (host-detected or owner-recorded), and verified (owner-tested config).
     * The recommendation is derived by the Host; nothing is installed,
     * launched, or activated from here.
     * @param {object} props { data, checkState, onCheck, promptCopyState, onCopyPrompt, t }
     */
    function EnginesSection({ data, checkState, onCheck, promptCopyState, onCopyPrompt, t }) {
      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)', borderRadius: 8, padding: '4px 12px',
        cursor: 'pointer', fontSize: 12,
      }
      const recommendationBadge = (advice) => {
        if (advice === undefined) return null
        const tone = advice.recommendation === 'REVIEW' ? 'warn' : undefined
        return badge(adviceLabel(advice.recommendation, t), tone)
      }
      const isRunning = checkState?.status === 'running'
      return h('div', { style: { marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
          h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('enginesSectionTitle')),
          h('button', {
            type: 'button',
            disabled: isRunning,
            title: t('enginesButtonHelp'),
            onClick: onCheck,
            style: { ...buttonStyle, opacity: isRunning ? 0.6 : 1 },
          }, isRunning ? t('enginesChecking') : checkState?.status === 'done' ? t('enginesCheckDone') : t('enginesCheckButton')),
          checkState?.status === 'failed' ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } },
            `${t('enginesCheckFailed')}: ${checkState.message ?? ''}`) : null),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } }, t('enginesDescription')),
        data === undefined || data.status === 'loading'
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
          : data.status === 'error'
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, `${t('loadFailed')}: ${data.message}`)
            : h('div', null,
                (data.data?.engines ?? []).map((engine) => {
                  // The Host compares normalized versions and reports the verdict.
                  // Rendering only `true` keeps an unjustifiable comparison, a
                  // Strata control-app tag, and an undetected build all silent
                  // instead of showing a pending update that may not exist.
                  const hasUpdate = engine.updateAvailable === true
                  return h('div', {
                    key: engine.id,
                    style: {
                      background: 'var(--dsw-alias-bg-layer-2)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      marginBottom: 8,
                    },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
                      h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, engine.displayName ?? engine.id),
                      engine.status === 'error' ? badge(t('statusNeedsReview'), 'warn') : null,
                      hasUpdate ? badge(t('enginesUpdateAvailable'), 'warn') : null,
                      recommendationBadge(engine.advice)),
                    h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 } },
                      h('div', null,
                        h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } }, t('enginesLatestLabel')),
                        h('div', { style: { color: 'var(--dsw-alias-label-primary)' } },
                          engine.latestRelease === null ? t('enginesNotChecked')
                            : engine.releaseUrl
                              ? h('a', { href: engine.releaseUrl, target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--dsw-alias-label-primary)' } }, engine.latestRelease)
                              : engine.latestRelease),
                        engine.releasedAt === undefined ? null : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
                          `${t('enginesReleasedAt')}: ${friendlyLocalWhen(engine.releasedAt)}`)),
                      engine.engineRelease === undefined || engine.engineRelease === null ? null : h('div', null,
                        h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } }, t('enginesEngineBuildLabel')),
                        h('div', { style: { color: 'var(--dsw-alias-label-primary)' } }, engine.engineRelease),
                        engine.engineReleaseDetail?.minimumDriver === undefined || engine.engineReleaseDetail?.minimumDriver === null ? null
                          : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
                            `${t('enginesMinimumDriverLabel')}: ${engine.engineReleaseDetail.minimumDriver}`)),
                      h('div', null,
                        h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } }, t('enginesInstalledLabel')),
                        h('div', { style: { color: 'var(--dsw-alias-label-primary)' } },
                          engine.installedVersion === null ? t('enginesNotDetected') : engine.installedVersion)),
                      engine.lastCheckAt === undefined || engine.lastCheckAt === null ? null : h('div', null,
                        h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: 2 } }, t('enginesLastChecked')),
                        h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, friendlyLocalWhen(engine.lastCheckAt)))),
                    engine.versionSpace === 'control' ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
                      t('enginesControlVersionNote')) : null,
                    engine.advice === undefined ? null : h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                      h('div', null, `${t('enginesAdviceWhy')}: ${adviceReasonLabel(engine.advice.reason, t)}`),
                      h('div', null, `${t('enginesAdviceDestination')}: ${engine.advice.destination}`),
                      engine.advice.requiresOwnerApproval === true
                        ? h('div', null, t('enginesAdviceApproval'))
                        : null,
                      // The prompt is composed by the Host so the mode, model,
                      // reasoning level, session and read-only grant stay
                      // consistent with the recommendation it describes.
                      engine.prompt === undefined ? null : h('button', {
                        type: 'button',
                        onClick: () => onCopyPrompt(engine.prompt, engine.id),
                        style: { ...buttonStyle, marginTop: 6 },
                      }, promptCopyState === 'done' ? t('copyConfirm') : promptCopyState === 'failed' ? t('copyFailed') : t('enginesCopyPrompt'))),
                    h('div', { style: { marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6 } },
                      h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, t('enginesVerifiedTitle')),
                      (engine.verifications ?? []).length === 0
                        ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('enginesNoVerified'))
                        : h('div', null, (engine.verifications ?? []).map((ver, index) =>
                            h('div', {
                              key: index,
                              style: { fontSize: 12, padding: '4px 8px', background: 'var(--dsw-alias-bg-overlay)', borderRadius: 6, marginBottom: 4 },
                            },
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                                badge(ver.result === 'passed' ? t('enginesVerifiedPassed') : t('enginesVerifiedFailed'),
                                  ver.result === 'passed' ? undefined : 'error'),
                                h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } }, ver.engineVersion),
                                h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                                  `${t('enginesVerifiedAt')}: ${ver.verifiedAt}`)),
                              h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
                                `${t('enginesVerifiedModel')}: ${ver.modelKey}`),
                              ver.gpuUuids === undefined ? null : h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                                `${t('enginesVerifiedGpus')}: ${ver.gpuUuids.join(', ')}`),
                              ver.evidenceNote === undefined ? null : h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                                `${t('enginesVerifiedEvidence')}: ${ver.evidenceNote}`)))),
                    ))
                }),
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, t('enginesDistinctionNote')),
              ),
      )
    }

    /**
     * The Local GGUF Models section: displays discovered local model files
     * from the shared LMM discovery cache. Display-only; no discovery,
     * polling, or execution behavior.
     * @param {object} props { localFiles, t }
     */
    function LocalFilesSection({ localFiles, t }) {
      if (localFiles === undefined || localFiles === null) {
        return null
      }
      const status = localFiles.status ?? 'unconfigured'
      const candidates = localFiles.candidates ?? []
      const generatedAt = localFiles.generatedAt

      const statusBanner = () => {
        if (status === 'ok') {
          return h('div', { style: { border: '1px solid var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12 } },
            t('localFilesOk'),
            generatedAt === undefined ? null : h('div', { style: { marginTop: 2, color: 'var(--dsw-alias-label-secondary)' } },
              `${t('localFilesGeneratedAt')}: ${friendlyLocalWhen(generatedAt)}`))
        }
        const tone = status === 'unconfigured' || status === 'missing' ? 'warn' : 'error'
        const text = status === 'unconfigured' ? t('localFilesUnconfigured')
          : status === 'missing' ? t('localFilesMissing')
          : status === 'unreadable' ? t('localFilesUnreadable')
          : status === 'malformed' ? t('localFilesMalformed')
          : status === 'schema-unsupported' ? t('localFilesSchemaUnsupported') : t('localFilesUnreadable')
        return h('div', { style: { border: `1px solid var(--dsw-alias-state-${tone}-primary)`, color: `var(--dsw-alias-state-${tone}-primary)`, borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12 } }, text)
      }

      const formatSize = (bytes) => {
        if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unknown'
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${bytes} B`
      }

      const candidateCard = (candidate, index) => {
        const isMultiPart = candidate.multiPart === true
        const totalShards = candidate.totalShards ?? (isMultiPart ? 'unknown' : 1)
        const sizeBytes = candidate.sizeBytes
        return h('div', {
          key: index,
          style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)', borderRadius: 8, padding: '10px 12px', marginBottom: 6 },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 } },
            h('strong', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13 } }, candidate.name ?? 'Unknown'),
            badge(isMultiPart ? t('localFilesMultiPart') : t('localFilesSinglePart')),
            isMultiPart ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, `${totalShards} ${t('localFilesShards')}`) : null,
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, `${t('localFilesSize')}: ${formatSize(sizeBytes)}`)),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, wordBreak: 'break-all' } },
            `${t('localFilesPath')}: ${candidate.path ?? 'Unknown'}`)
        )
      }

      return h('div', { style: { marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
          h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('localFilesTitle')),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('localFilesSubtitle'))),
        statusBanner(),
        (candidates ?? []).length === 0
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('localFilesNoCandidates'))
          : h('div', null, (candidates ?? []).map(candidateCard)),
      )
    }

    /** Shared inline style for the Owner Customizations command-copy buttons. */
    const commandButtonStyle = () => ({
      border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-primary)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
    })

    /** Locale keys for each external status label. */
    const STATUS_KEYS = {
      Installed: 'statusInstalled',
      'Can Restore Cleanly': 'statusCanRestore',
      'Needs Review': 'statusNeedsReview',
      Incompatible: 'statusIncompatible',
    }
    const statusTone = (status) => status === 'Installed' ? undefined
      : status === 'Can Restore Cleanly' ? undefined
        : status === 'Incompatible' ? 'error' : 'warn'

    /**
     * The Owner Customizations page: displays externally produced statuses. It
     * is intentionally read-only — the external layer owns every restore.
     * @param {object} props { loadStatuses, t }
     */
    function OwnerPanel({ loadStatuses, t }) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [commandCopyState, setCommandCopyState] = React.useState()
      const refresh = React.useCallback(() => {
        setState({ status: 'loading' })
        loadStatuses().then((data) => setState({ status: 'ready', data }),
          (failure) => setState({
            status: 'error',
            // Fold the failure into one classification: a Remote error object
            // carries `code`; anything else is an unexpected client fault.
            unavailable: failure !== null && typeof failure === 'object' && failure.code === 'gateway/service-unavailable',
            message: failureText(failure),
          }))
      }, [loadStatuses])
      const copyExternalCommand = React.useCallback(async (text, tag) => {
        try {
          await navigator.clipboard.writeText(text)
          setCommandCopyState(tag)
        } catch {
          setCommandCopyState('failed')
        }
        setTimeout(() => setCommandCopyState(undefined), 2000)
      }, [])
      React.useEffect(() => { refresh() }, [refresh])
      if (state.status === 'loading') return h('div', { style: { padding: 24, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
      if (state.status === 'error') return h('div', { style: { padding: 24 } },
        h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', marginBottom: 12 } },
          `${state.unavailable === true ? t('ownerUnavailable') : t('ownerMalformed')}: ${state.message}`),
        h('button', { type: 'button', onClick: refresh }, t('ownerRefresh')))
      const data = state.data ?? {}
      const banner = () => {
        if (data.status === 'ok' && (data.entries ?? []).length > 0) return null
        const text = data.status === 'missing' ? t('ownerMissing')
          : data.status === 'unconfigured' ? t('ownerUnconfigured') : t('ownerMalformed')
        const hint = data.status === 'missing'
          ? h('code', { style: { display: 'block', marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-primary)' } },
            'node ~/.local/share/liongateos/deepseek-update/recover-customizations.mjs --check')
          : null
        return h('div', { role: 'status', style: { border: '1px solid var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12 } }, text, hint)
      }
      return h('div', { style: { padding: '16px 20px', overflow: 'auto', height: '100%', boxSizing: 'border-box' } },
        h('h2', { style: { margin: '0 0 2px', fontSize: 18, color: 'var(--dsw-alias-label-primary)' } }, t('ownerTitle')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, t('ownerSubtitle')),
        h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--dsw-alias-label-primary)' } },
          h('div', { style: { fontWeight: 600 } }, t('ownerIntro')),
          h('div', { style: { marginTop: 4 } }, h('strong', null, t('ownerStep1Title')), ` — ${t('ownerStep1Help')}`),
          h('div', { style: { marginTop: 2 } }, h('strong', null, t('ownerStep2Title')), ` — ${t('ownerStep2Help')}`)),
        banner(),
        data.checkedAt === undefined || data.checkedAt === null ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 }, title: String(data.checkedAt) }, `${t('ownerChecked')}: ${friendlyLocalWhen(data.checkedAt)}`),
        h('button', {
          type: 'button',
          onClick: refresh,
          title: t('ownerStep1Help'),
          style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, marginBottom: 12 },
        }, t('ownerRefresh')),
        (data.entries ?? []).map((entry, index) => h('div', {
          key: index,
          style: { background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: '10px 14px', marginBottom: 8 },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, entry.name ?? String(index)),
            badge(STATUS_KEYS[entry.status] === undefined ? t('statusUnknown') : t(STATUS_KEYS[entry.status]), statusTone(entry.status)),
            entry.detail === undefined ? null : h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, String(entry.detail)),
          ),
          STATUS_KEYS[entry.status] === undefined ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, t({
            statusInstalled: 'statusHelpInstalled', statusCanRestore: 'statusHelpCanRestore',
            statusNeedsReview: 'statusHelpNeedsReview', statusIncompatible: 'statusHelpIncompatible',
          }[STATUS_KEYS[entry.status]] ?? '')),
          (entry.plannedActions ?? []).length === 0 ? null : h('div', { style: { marginTop: 6 } },
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('ownerPlanned')),
            h('ul', { style: { margin: '2px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              entry.plannedActions.map((action, actionIndex) => h('li', { key: actionIndex },
                `${action.kind}: `, h('code', null, String(action.cmd ?? '')))))),
        )),
        // Explicit empty state: a successful check with zero registrations.
        data.status === 'ok' && (data.entries ?? []).length === 0
          ? h('div', { style: { marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('ownerNoEntries'))
          : null,
        (data.entries ?? []).length === 0 ? null : h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, t('ownerStep2Title')), ` — ${t('ownerStep2Help')}`,
          h('div', { style: { marginTop: 4 } }, t('ownerRestoreHint')),
          data.recovery === undefined ? null : h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', title: `${t('ownerDryRunHelp')} — ${String(data.recovery.checkCommand ?? '')}`, onClick: () => copyExternalCommand(String(data.recovery.checkCommand ?? ''), 'check'), style: commandButtonStyle() },
              commandCopyState === 'check' ? t('copyConfirm') : commandCopyState === 'failed' ? t('copyFailed') : t('ownerRestoreCommand')),
            h('button', { type: 'button', title: `${t('ownerApplyRestoreHelp')} — ${String(data.recovery.applyCommand ?? '')}`, onClick: () => copyExternalCommand(String(data.recovery.applyCommand ?? ''), 'apply'), style: commandButtonStyle() },
              commandCopyState === 'apply' ? t('copyConfirm') : commandCopyState === 'failed' ? t('copyFailed') : t('ownerApplyCommand'))),
          data.recovery === undefined ? null : h('div', { style: { marginTop: 6 } },
            t('ownerTerminalDestination'), ' ', t('ownerRestoreVsApply'), ' ', data.recovery.applyPolicy),
        ),
      )
    }

    /** Decorative sidebar panel glyph for the Owner Customizations panel. */
    function OwnersPanelIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 16
      return h('svg', { viewBox: '0 0 24 24', width: edge, height: edge, 'aria-hidden': true },
        h('path', { d: 'M5 4h9l5 5v11H5z', fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        h('path', { d: 'M8.5 13l2 2 4-4.5', fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }

    /** Decorative sidebar panel glyph; the sidebar owns the accessible label. */
    function PanelIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 16
      return h('svg', { viewBox: '0 0 24 24', width: edge, height: edge, 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', 'stroke-width': 1.6 }),
        h('circle', { cx: 12, cy: 12, r: 2.4, fill: 'var(--dsw-alias-brand-primary)' }),
        h('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3', stroke: 'var(--dsw-alias-label-secondary)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }))
    }


    /**
     * Render-error boundary for one registered main panel: any exception while
     * rendering the panel shows a visible fallback card with a retry button —
     * the panel can never disappear into a blank area.
     */
    class PanelErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
        this.retry = () => { this.setState({ error: null }) }
      }

      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message
          : typeof error === 'object' && error !== null && typeof error.message === 'string'
            ? error.message : String(error) }
      }

      render() {
        if (this.state.error === null) return this.props.children
        let title = 'Panel render error / 面板渲染错误'
        try {
          if (typeof this.props.t === 'function') title = this.props.t('renderErrorTitle')
        } catch {
          // The locale lookup itself failed; the fixed bilingual title stands.
        }
        return h('div', { role: 'alert', style: { padding: 24 } },
          h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', marginBottom: 8, fontSize: 13 } }, title),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, this.state.error),
          h('button', {
            type: 'button',
            onClick: this.retry,
            style: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12 },
          }, typeof this.props.t === 'function' ? (() => { try { return this.props.t('renderErrorRetry') } catch { return 'Try again' } })() : 'Try again'))
      }
    }

    /**
     * Wrap one panel component in the render-error boundary. The boundary is
     * instantiated before the wrapped component's own `t` is dereferenced, so
     * even a broken locale lookup degrades to the fixed bilingual fallback.
     * @param {function} Component the panel component to guard.
     * @returns {function} the guarded component.
     */
    const guarded = (Component) => (props) =>
      h(PanelErrorBoundary, { t: typeof props === 'object' && props !== null ? props.t : undefined }, h(Component, props))

    /**
     * Register both main panels against one guarded call adapter. Runs either
     * inside the `remote.modelGuide` injected scope (live namespace) or, on a
     * mount failure, in a Remote-free scope whose calls fold into explicit
     * service-unavailable envelopes — a panel card, never a blank page.
     * @param {object} ctx the scope registering the slots (declares its deps).
     * @param {function} call async (method, ...args) → RemoteResult envelope.
     */
    const registerPanels = (ctx, call) => {
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          load: async () => await unwrap(await call('snapshot')),
          copyGuidance: async (provider, model) => await unwrap(await call('guidanceText', provider, model)),
          update: async () => await unwrap(await call('updateModelsAndPricing')),
          lastReport: async () => await unwrap(await call('lastUpdateReport')),
          copyFullGuide: async () => await unwrap(await call('generatedGuide')),
          copyRoutingGuide: async () => await unwrap(await call('routingGuide')),
          researchStatus: async (scope) => await unwrap(await call('researchStatus', scope)),
          researchPrompt: async (scope, keys) => await unwrap(await call('researchPrompt', scope, keys)),
          previewResearchResults: async (results) => await unwrap(await call('previewResearchResults', results)),
          applyResearchResults: async (results, reviewId) => await unwrap(await call('applyResearchResults', results, reviewId)),
          loadEngineCatalog: async () => await unwrap(await call('engineCatalog')),
          checkEngines: async () => await unwrap(await call('updateEngines')),
        }),
      }, guarded(Page)))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: OWNERS_PANEL_ID,
        locale: NS,
        inject: () => ({
          loadStatuses: async () => await unwrap(await call('customizationStatus')),
        }),
      }, guarded(OwnerPanel)))
    }

    /**
     * Mount the modelGuide contribution, then register both main panels inside
     * an injected scope that declares `remote.modelGuide`. This is the shipped
     * register-after-mount pattern (client-ui-voice-input `mount.ts`): a dotted
     * `ctx.remote.<namespace>` read resolves only in a scope whose fiber
     * declares the namespace service in its inject list, so the entry scope
     * only mounts (`remote`) and the panels read the namespace in the scope
     * that waits for its availability.
     * @param {object} ctx the plugin entry context (injects `remote`).
     * @param {function} t namespace-bound locale dictionary accessor.
     * @returns {Promise<function>} disposer joining panels and the Remote mount.
     */
    const mountPanels = async (ctx, t) => {
      let disposeRemote
      try {
        disposeRemote = await ctx.remote.$mount({
          package: PACKAGE,
          descriptors: [
            descriptor('snapshot', []),
            descriptor('guidanceText', [{ name: 'provider' }, { name: 'model' }]),
            descriptor('actualCost', [{ name: 'request' }]),
            descriptor('recommendModels', [{ name: 'task' }]),
            descriptor('updateModelsAndPricing', []),
            descriptor('lastUpdateReport', []),
            descriptor('generatedGuide', []),
            descriptor('routingGuide', []),
            descriptor('customizationStatus', []),
            descriptor('researchStatus', [{ name: 'scope' }]),
            descriptor('researchPrompt', [{ name: 'scope' }, { name: 'keys' }]),
            descriptor('previewResearchResults', [{ name: 'results' }]),
            descriptor('applyResearchResults', [{ name: 'results' }, { name: 'reviewId' }]),
            descriptor('engineCatalog', []),
            descriptor('updateEngines', []),
            // Metadata enrichment and the refresh scheduler's state. The
            // client mounts exactly the methods it calls: the gateway mounts
            // only what a contribution declares, so an undeclared method is
            // undefined at the call site even though the Host implements it.
            descriptor('refreshModelMetadata', [{ name: 'request' }]),
            descriptor('autoRefreshStatus', []),
            // Provider-confirmed route capabilities: a plan by default, a
            // write only when the caller asks to apply it.
            descriptor('syncRouteCapabilities', [{ name: 'request' }]),
          ],
        })
      } catch (error) {
        // Mount failures surface as a classified panel card. The failure path
        // declares no Remote service: it never touches the namespace.
        const detail = error instanceof Error ? error.message : String(error)
        const failing = async () => ({
          ok: false,
          error: {
            code: 'gateway/service-unavailable',
            message: `The modelGuide remote namespace failed to mount: ${detail}`,
          },
        })
        const ui = ctx.inject(['slots', 'locale'], (scope) => registerPanels(scope, failing))
        return async () => { await ui.dispose() }
      }
      const ui = ctx.inject(['remote.modelGuide', 'slots', 'locale'], (scope) => {
        const modelGuide = scope.remote.modelGuide
        const call = async (method, ...args) => {
          try {
            return await modelGuide[method](...args)
          } catch (error) {
            return {
              ok: false,
              error: { code: 'gateway/internal', message: failureText(error) },
            }
          }
        }
        registerPanels(scope, call)
      })
      return async () => { await ui.dispose(); await disposeRemote() }
    }

    return {
      labels: { en, zh },
      inject: ['remote', 'slots', 'locale'],
      async apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-guide: dictionaries')
        const t = ctx.locale.bind(NS)
        // Sidebar rows read no Remote service; they register immediately so
        // the entries exist while the namespace mounts.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 12,
          locale: NS,
          label: () => t('title'),
        }, PanelIcon))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: OWNERS_PANEL_ID,
          order: 13,
          locale: NS,
          label: () => t('ownerTitle'),
        }, OwnersPanelIcon))
        return await mountPanels(ctx, t)
      },
    }
  },
})