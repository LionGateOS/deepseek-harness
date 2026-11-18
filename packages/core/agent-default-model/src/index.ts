/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'
import { decidePlacement, probeEndpoint, type PlacementTarget } from './placement.ts'
export type { PlacementTarget } from './placement.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Default model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route. */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
  /**
   * Placement targets for the default model, in priority order. Omission
   * keeps the static default route without probing.
   */
  placement: Volatile<readonly PlacementTarget[] | undefined>
  /** Per-probe timeout in milliseconds for placement endpoint probes. */
  placementProbeTimeoutMs: Volatile<number>
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Each operation reads the owning Config references.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    placement: z.array(z.object({
      provider: z.string(),
      endpoint: z.string(),
      automaticFallback: z.boolean().required(false),
      model: z.string().required(false),
    })).volatile(),
    placementProbeTimeoutMs: z.number().step(1).min(1).default(2000).volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    })
  }

  /**
   * Find the first placement target with `automaticFallback` set to true,
   * returning its provider route and explicit model identity. Returns `null`
   * when no target qualifies or the candidate lacks an explicit model (fail-
   * closed). The source implementation defaults to no target having this flag,
   * keeping inter-provider fallback disabled until profile activation.
   * @returns the eligible fallback candidate identity, or `null`.
   */
  findFallbackProvider(): Pick<PlacementTarget, 'provider' | 'model'> | null {
    const targets = this.config.placement.get()
    if (targets === undefined || targets.length === 0) return null
    const fallback = targets.find(target => target.automaticFallback === true)
    if (fallback === undefined) return null
    if (fallback.model === undefined) return null
    return { provider: fallback.provider, model: fallback.model }
  }

  /**
   * Read the default model selection placed on the first eligible placement
   * endpoint. Without placement configuration the static default is returned
   * unprobed. When no target is eligible the static default provider is kept
   * so the request fails loudly on its normal provider error.
   * @returns the default selection routed to the eligible provider.
   */
  async placedSelection(): Promise<ModelSelection> {
    const current = this.currentSelection()
    const targets = this.config.placement.get()
    if (targets === undefined || targets.length === 0) return current
    const timeoutMs = this.config.placementProbeTimeoutMs.get()
    const evidence = await Promise.all(targets.map(target => probeEndpoint(target, timeoutMs)))
    const { provider } = decidePlacement(targets, evidence, current.model, current.provider)
    return { ...current, provider }
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const saved = this.saves.then(() => editor.edit(entry, () => config))
    this.saves = saved.catch(() => {})
    await saved
  }

}

export default AgentDefaultModelConfig
