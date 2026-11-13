/**
 * Session model-selection enforcement for direct teammate spawning.
 *
 * The `spawn_teammate` tool validates child route selection at the tool layer;
 * this module applies the equivalent session policy when
 * {@link SpawnTeammateRequest.agentOptions} arrives through the domain API
 * directly, so programmatic callers cannot bypass it.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import { TeamError } from './error.ts'

/**
 * One exact provider/model route authorized for explicit child selection.
 * Structural copy of `AllowedModelRoute` in `@deepseek-ai/dsh-tool-subagent`;
 * both declarations augment the same `SessionProjectionStateMap` entry, and
 * TypeScript merges identical shapes, so this package reads the durable
 * projection without a dependency on the tool package.
 */
export interface AllowedModelRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Exact routes authorized for child LLM selection, or null when disabled. */
    subagentModelSelectionPolicy: AllowedModelRoute[] | null
  }
}

/**
 * Read the exact route list recorded for this session's child selection.
 * @param projections - registry that owns the policy projection.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined when the projection is
 * unregistered or the recorded state still means "disabled" (`null`).
 */
export function recordedModelSelectionRoutes(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return projections.stateOf(session, 'subagentModelSelectionPolicy')?.map(route => ({ ...route }))
}

/**
 * Whether one `agentOptions` selection names any child LLM value at all.
 * @param options - teammate route and inference overrides, when present.
 * @returns whether any provider, model, effort, or token field is set.
 */
function hasSelection(options: TeammateRouteOptions): boolean {
  return options.provider !== undefined
    || options.model !== undefined
    || options.reasoningEffort !== undefined
    || options.maxTokens !== undefined
}

/** Model-facing overrides carried by {@link SpawnTeammateRequest.agentOptions}. */
interface TeammateRouteOptions {
  /** Provider route for the teammate. */
  provider?: string
  /** Model id for the teammate. */
  model?: string
  /** Adapter-owned reasoning effort; the guard reads presence only. */
  reasoningEffort?: unknown
  /** Maximum output tokens per request. */
  maxTokens?: number
}

/**
 * Enforce the session's model-selection policy over one directly requested
 * teammate `agentOptions` value. Pure inheritance (`undefined` or an empty
 * value naming no child LLM field) stays outside this policy. Blank values and
 * half-specified routes are malformed requests. An explicit route equal to the
 * Lead's effective route is always allowed; any other route needs a recorded
 * policy that names it. A fork names its route by inheritance, so an explicit
 * route there is a contradiction. Effort- and token-only overrides keep the
 * inherited route and need an effective Lead route to resolve against.
 * @param projections - registry that owns the policy projection.
 * @param lead - exact live Team Lead whose route the teammate inherits.
 * @param context - fresh or fork creation mode.
 * @param agentOptions - requested teammate overrides, when any.
 * @throws {TeamError} `TEAM_MODEL_SELECTION` on every rejected request.
 */
export function assertTeammateModelSelection(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  lead: Agent,
  context: 'fresh' | 'fork',
  agentOptions: TeammateRouteOptions | undefined,
): void {
  if (agentOptions === undefined || !hasSelection(agentOptions)) return
  guardExplicitSelection(projections, lead, context, {
    ...agentOptions,
    ...trimmedRoute(agentOptions),
  })
}

/** Blank provider/model values fail loudly under the shared failure code. */
function trimmedRoute(options: TeammateRouteOptions): { provider?: string; model?: string } {
  const route: { provider?: string; model?: string } = {}
  for (const field of ['provider', 'model'] as const) {
    const value = options[field]
    if (value === undefined) continue
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new TeamError(`child LLM \`${field}\` must be non-empty`, 'TEAM_MODEL_SELECTION')
    }
    route[field] = trimmed
  }
  return route
}

/** Enforce the policy over a request that names at least one child LLM value. */
function guardExplicitSelection(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  lead: Agent,
  context: 'fresh' | 'fork',
  selection: TeammateRouteOptions & { provider?: string; model?: string },
): void {
  const hasRoute = selection.provider !== undefined
  if (hasRoute !== (selection.model !== undefined)) {
    throw new TeamError('child LLM `provider` and `model` must be supplied together', 'TEAM_MODEL_SELECTION')
  }
  if (context === 'fork' && hasRoute) {
    throw new TeamError(
      'fork teammates inherit the parent route; `provider` and `model` cannot be changed',
      'TEAM_MODEL_SELECTION',
    )
  }

  // The effective Lead route at delegation time, not the creation-time options;
  // the latest committed request header owns it after a mid-session switch.
  const leadOptions = parentAgentOptionsForDelegation(lead)
  const leadProvider = leadOptions.provider
  const leadModel = leadOptions.model

  if (hasRoute) {
    if (selection.provider === leadProvider && selection.model === leadModel) return
    const routes = recordedModelSelectionRoutes(projections, lead.session)
    if (routes === undefined) {
      throw new TeamError('child model selection is disabled for this session', 'TEAM_MODEL_SELECTION')
    }
    if (!routes.some(route => route.provider === selection.provider && route.model === selection.model)) {
      throw new TeamError(
        `child LLM route "${selection.provider}/${selection.model}" is not allowed for this Session`,
        'TEAM_MODEL_SELECTION',
      )
    }
    return
  }

  // Effort- or token-only overrides inherit the Lead route; without one there
  // is nothing to resolve the inference values against.
  if (leadProvider === undefined || leadModel === undefined) {
    throw new TeamError('cannot apply inference overrides without an effective provider and model', 'TEAM_MODEL_SELECTION')
  }
}
