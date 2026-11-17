/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import { TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { TeamMemberView, StartSpecialistResult, SpecialistDefinition } from '@deepseek-ai/dsh-experimental-agent-team'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  subagentModelSelectionProjectionDefinition,
  subagentModelSelectionPolicy,
  recordSubagentModelSelection,
} from '@deepseek-ai/dsh-tool-subagent/src/model-selection-state.ts'
import type { AllowedModelRoute, ModelSelectionPolicy } from '@deepseek-ai/dsh-tool-subagent/src/model-selection.ts'
// Type-only: merge `ctx.subagentModelSelection`, `ctx.llm`, and `ctx.sessionProjections` into the Context interface.
import type {} from '@deepseek-ai/dsh-tool-subagent/src/model-selection-settings.ts'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: merge the optional `ctx.commands` service so `/orchestrate` can register when composed.
import type {} from '@deepseek-ai/dsh-commands'
import {
  orchestrationModeOf,
  orchestrationModeProjectionDefinition,
  parseOrchestrationMode,
  recordOrchestrationMode,
} from './orchestration-mode.ts'
import type { OrchestrationMode } from './orchestration-mode.ts'
import {
  assertAutomaticSpecialistStart,
  recordAutomaticSpecialistStart,
  recordSpecialistCheckpoint,
  specialistContinuationProjectionDefinition,
  specialistContinuationStateOf,
  specialistContinuationTurnKey,
} from './continuation-gate.ts'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt', 'sessionProjections']

/** Tool routing configuration. */
export interface Config {
  /** Register `interrupt_agent` and its policy guidance. Defaults to true; false leaves the domain API available. */
  readonly interrupt?: boolean
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  interrupt: z.boolean().default(true),
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
})

/**
 * Mode-dependent delegation guidance. The mode selects one paragraph; the rest of the
 * Team policy is shared so a mode change cannot rewrite unrelated collaboration rules.
 */
const MODE_GUIDANCE: Readonly<Record<OrchestrationMode, string>> = {
  off: 'Automatic specialist delegation is OFF for this Team. Work directly unless the owner explicitly asks you to delegate; the specialist tools remain available for that explicit, manual use. Do not start a specialist merely because a listed role happens to exist.',
  auto: 'Automatic specialist delegation is AUTO for this Team, the normal setting. Evaluate for yourself whether a specialist provides meaningful expected benefit under the criteria above, and prefer the smallest useful team. Simple factual questions, tiny edits, and other single-step work stay with you.',
  on: 'Automatic specialist delegation is ON for this Team. Strongly prefer a specialist for non-trivial work whenever a listed role fits it, and say which role and why. ON is a preference for useful delegation, not permission to spawn as many agents as possible: trivial or single-step work may still stay with you, and every limit stated here still applies.',
}

/** Model-facing collaboration guidance shared by Lead and teammates. */
function teamPolicy(interrupt: boolean, mode: OrchestrationMode): string {
  return `Agent Teams is available in this session

Specialists are optional tools, not a required step. The catalog lists named roles you can start with spawn_specialist; each keeps its catalog role and receives the concrete work you pass in \`task\`. Delegation earns its cost when a distinct role adds independence or expertise you would not otherwise have: independently verifying finished work, reviewing architecture or design, auditing security or safety, separating implementation from review, separating research from synthesis, or investigating independent parts in parallel. It does not earn its cost when the task is trivial or single-step, when describing the work costs more than doing it, when the specialist would duplicate work already underway, or when the context it needs cannot be stated clearly and completely in \`task\`. Start the smallest team that covers the work; one specialist is often enough.

As Team Lead you own the outcome. Decompose the task, choose the specialist that fits it, and write a \`task\` that states the concrete work plus the paths, acceptance criteria, and write scope the specialist needs to act without your conversation. Then read the result critically, reconcile conflicting findings, and write the final answer yourself; a specialist's output informs your judgement and does not replace it. \`task\` selects work and never widens a specialist's role, permissions, or route, and a specialist reporting that it cannot act within its fixed scope is reporting a real limit rather than requesting wider authority. Existing limits continue to apply: only the Team Lead can start specialists, the per-team concurrency cap and FIFO queue decide when a started specialist runs, and session route and model-selection policy still governs every specialist call. Do not plan work around nested delegation, because a teammate cannot start a specialist, and do not start several specialists on the same assignment.

${MODE_GUIDANCE[mode]}

In AUTO and ON, automatic specialists are bounded to at most four starts in wave 1 and at most four starts in one optional follow-up wave. Before opening the follow-up wave, wait until every queued or working specialist has settled, then call specialist_checkpoint after reviewing wave-1 findings, provide concrete evidence from those findings, and choose continue only when unresolved risk, conflicting evidence, failed verification, or a newly discovered subsystem justifies more specialist work. Choosing synthesize closes automatic specialist delegation for the current human turn. Wave 2 is final: there is no third automatic wave. Automatic AUTO/ON delegation uses spawn_specialist; spawn_teammate remains the direct manual Team primitive and must not be used as an automatic bypass around this continuation gate. OFF remains owner-explicit manual delegation and does not use this automatic wave budget.

The orchestration mode changes delegation preference only. It cannot widen filesystem permissions, model-selection permission, paid or cloud routes, concurrency limits, specialist role contracts, or session and tool permissions, and it never authorizes recursive delegation.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message${interrupt ? ' and interrupt_agent' : ''}, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`
}

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

const continuationTails = new Map<string, Promise<void>>()

async function serializeContinuation<T>(teamKey: string, operation: () => Promise<T>): Promise<T> {
  const prior = continuationTails.get(teamKey) ?? Promise.resolve()
  const run = prior.then(operation, operation)
  const tail = run.then(() => undefined, () => undefined)
  continuationTails.set(teamKey, tail)
  try {
    return await run
  } finally {
    if (continuationTails.get(teamKey) === tail) continuationTails.delete(teamKey)
  }
}

/**
 * One model-facing roster row. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Expose the member name as its model-facing target. */
function modelMember(member: TeamMemberView): InferValue<typeof MEMBER_VIEW_SCHEMA> {
  const { id: _id, name, ...details } = member
  return { target: name, ...details }
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPECIALIST_CATALOG_VALUE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', required: true },
      description: { type: 'string', required: true },
    },
  },
} as const

const SPECIALIST_STATUS_VALUE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', required: true },
      phase: { type: 'string', required: true, enum: ['queued', 'working', 'finished', 'cancelled'] },
      position: { type: 'integer' },
      provider: { type: 'string' },
    },
  },
} as const

const SPECIALIST_CHECKPOINT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', required: true, enum: ['continue', 'synthesize'] },
    wave: { type: 'integer', required: true },
    nextWave: { type: 'integer' },
  },
} as const

const SPAWN_SPECIALIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['active', 'queued'] },
    name: { type: 'string', required: true },
    member: { ...MEMBER_VIEW_SCHEMA },
    pending: { type: 'integer' },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sent: { type: 'boolean', required: true, const: true },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/**
 * Capture the session-bound model-selection policy for one Team member at
 * composition time. Samples the global setting on first use and records it
 * immutably in the session log; subsequent calls for the same session read
 * from that record. Returns undefined when model selection is unavailable or
 * disabled at the moment this session was composed.
 * @param ctx - Team tool plugin context with sessionProjections and optional subagentModelSelection.
 * @param agent - the Team member agent whose session receives the policy capture.
 * @returns the session-bound selection policy, or undefined when disabled.
 */
function captureModelSelectionPolicy(ctx: Context, agent: Agent): ModelSelectionPolicy | undefined {
  const selectionSvc = ctx.get('subagentModelSelection')
  if (selectionSvc === undefined) return undefined
  let allowedModels = subagentModelSelectionPolicy(ctx.sessionProjections, agent.session)
  if (allowedModels === undefined) {
    const current = selectionSvc.current()
    if (!current.enabled) return undefined
    allowedModels = current.allowedModels
    recordSubagentModelSelection(ctx.sessionProjections, agent.session, allowedModels)
  }
  return { routes: allowedModels }
}

/**
 * Validate model selection fields from a spawn_teammate call and return the
 * resolved child AgentOptions, or `undefined` when no selection was requested.
 * Rejects selection when disabled, unauthorized, incompatible with fork context,
 * or when the LLM preflight reports an invalid route or effort.
 * @param ctx - Team tool plugin context.
 * @param agent - Exact live caller (the Team Lead Agent).
 * @param policy - Session-bound model-selection policy captured at composition time.
 * @param context - fresh or fork context mode.
 * @param provider - Optional provider override from the model-facing call.
 * @param model - Optional model override from the model-facing call.
 * @param rawReasoningEffort - Optional reasoning-effort override from the model-facing call.
 * @param signal - Caller cancellation signal.
 * @returns Child AgentOptions if selection was requested, or undefined for pure inheritance.
 */
async function resolveTeammateAgentOptions(
  ctx: Context,
  agent: Agent,
  policy: ModelSelectionPolicy | undefined,
  context: 'fresh' | 'fork',
  provider: string | undefined,
  model: string | undefined,
  rawReasoningEffort: string | undefined,
  signal: AbortSignal,
): Promise<AgentOptions | undefined> {
  const hasProvider = provider !== undefined
  const hasModel = model !== undefined
  const hasEffort = rawReasoningEffort !== undefined

  if (!hasProvider && !hasModel && !hasEffort) return undefined

  if (hasProvider && provider.length === 0) throw new Error('child LLM `provider` must be non-empty')
  if (hasModel && model.length === 0) throw new Error('child LLM `model` must be non-empty')
  if (hasEffort && rawReasoningEffort.length === 0) throw new Error('child LLM `reasoning_effort` must be non-empty')

  if (hasProvider !== hasModel) throw new Error('child LLM `provider` and `model` must be supplied together')

  // Fork context inherits the parent route; route-changing overrides are not supported.
  if (context === 'fork' && hasProvider) {
    throw new Error('fork teammates inherit the parent route; `provider` and `model` cannot be changed')
  }

  // Authorization gate: model selection must be explicitly enabled with a non-empty allowlist.
  // The policy is captured once at session composition time and is immutable per session;
  // global setting changes after composition do not affect already-composed sessions.
  if (policy === undefined) {
    throw new Error('child model selection is disabled for this session')
  }

  // The effective parent route at delegation time, not the creation-time options.
  // Uses the latest committed request header so a mid-session model switch is reflected.
  const parentOptions = parentAgentOptionsForDelegation(agent)

  // Allowlist gate: only required when the caller is selecting a new route.
  // Effort-only overrides inherit the parent route and do not consult the allowlist.
  if (hasProvider) {
    if (!policy.routes.some((route: AllowedModelRoute) => route.provider === provider && route.model === model)) {
      throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`)
    }
  }

  const resolvedEffort = hasEffort ? ReasoningEffortId(rawReasoningEffort) : undefined

  if (provider !== undefined && model !== undefined) {
    // Route-changing spawn: provider and model are narrowed to string.
    const agentOptions: AgentOptions = {
      provider,
      model,
      ...(resolvedEffort !== undefined ? { reasoningEffort: resolvedEffort } : {}),
    }
    // Preflight: validate the new route and optional effort. Fail closed if LLM unavailable.
    const llm = ctx.get('llm')
    if (llm === undefined) {
      throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
    }
    await llm.resolveCallConfig({
      provider,
      model,
      ...(resolvedEffort !== undefined ? { reasoningEffort: resolvedEffort } : {}),
    }, signal)
    return agentOptions
  }

  // Effort-only: inherits the parent route. Requires a live parent route for preflight.
  const inheritedProvider = parentOptions.provider
  const inheritedModel = parentOptions.model
  if (inheritedProvider === undefined || inheritedModel === undefined) {
    throw new Error('cannot apply reasoning effort without an effective provider and model')
  }
  const agentOptions: AgentOptions = {
    ...(resolvedEffort !== undefined ? { reasoningEffort: resolvedEffort } : {}),
  }
  // Preflight: validate the inherited route with the new effort. Fail closed if LLM unavailable.
  if (resolvedEffort !== undefined) {
    const llm = ctx.get('llm')
    if (llm === undefined) {
      throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
    }
    await llm.resolveCallConfig({
      provider: inheritedProvider,
      model: inheritedModel,
      reasoningEffort: resolvedEffort,
    }, signal)
  }
  return agentOptions
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  // Capture the session-bound policy once at composition time. The closed-over value is
  // immutable for the agent's lifetime; global setting changes do not reach open sessions.
  const teamSelectionPolicy = captureModelSelectionPolicy(ctx, agent)
  // The mode is durable state of the Team, not of one member: every member reads the
  // Lead's log, so the rendered policy stays identical across the Team at any moment.
  const teamSession = ctx.agentTeams.membership(agent).root.session
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: () => teamPolicy(config.interrupt, orchestrationModeOf(ctx.sessionProjections, teamSession)),
    }))
    register(scoped.systemPrompt.context({
      name: 'team:identity',
      order: scoped.systemPrompt.getContextOrder('TEAM_IDENTITY'),
      required: true,
      text: () => {
        const { role, name } = ctx.agentTeams.membership(agent)
        return `${role === 'lead'
          ? 'You are the Team Lead named "lead".'
          : `You are teammate "${name}".\nYour Team Lead is named "lead".\nTo message your Team Lead, use send_message({ target: "lead", message: "..." }).`}
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`
      },
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        provider: {
          type: 'string',
          description: 'LLM provider id for this teammate. Requires model selection to be enabled. Must be supplied with model.',
        },
        model: {
          type: 'string',
          description: 'Exact model id for this teammate. Requires model selection to be enabled. Must be supplied with provider.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Reasoning effort for this teammate. Requires model selection to be enabled. Omitting on a route change lets the selected model use its own default.',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const agentOptions = await resolveTeammateAgentOptions(
          ctx, agent, teamSelectionPolicy, context,
          args.provider, args.model, args.reasoning_effort,
          exec.signal,
        )
        const result = await ctx.agentTeams.spawnTeammate(agent, {
          name: args.name,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...agentOptions !== undefined ? { agentOptions } : {},
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      async execute(args, exec) {
        await ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
        return { sent: true }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')).map(modelMember))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, message, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    if (config.interrupt) {
      register(scoped.tools.register(defineTool({
        name: 'interrupt_agent',
        description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
        parameters: {
          target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
        },
        output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
        execute(args, exec) {
          return Promise.resolve(ctx.agentTeams.interrupt(callingAgent(exec.agent, 'interrupt_agent'), args.target))
        },
      })))
    }

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'list_specialists',
      description: 'List the available specialist catalog entries. Use spawn_specialist to start one by name.',
      parameters: {},
      output: jsonOutput(SPECIALIST_CATALOG_VALUE_SCHEMA),
      execute(_args, _exec) {
        return Promise.resolve(
          ctx.agentTeams.specialists.map(({ name, description }) => ({ name, description })),
        )
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_specialist_status',
      description: 'List the current scheduling phase and queue position for all specialists started in this session. Only the Team Lead may call this tool.',
      parameters: {},
      output: jsonOutput(SPECIALIST_STATUS_VALUE_SCHEMA),
      execute(_args, exec) {
        const agent = callingAgent(exec.agent, 'list_specialist_status')
        const view = ctx.agentTeams.listSpecialistStatus(agent)
        return Promise.resolve(view.specialists)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'specialist_checkpoint',
      description: 'Record the Lead evidence checkpoint after a settled automatic specialist wave. In AUTO/ON, choose continue to open the one allowed follow-up wave, or synthesize to close automatic specialist delegation for this human turn. Only the Team Lead may call this tool.',
      parameters: {
        decision: {
          type: 'string',
          required: true,
          enum: ['continue', 'synthesize'],
          description: 'continue opens wave 2 after wave 1; synthesize closes automatic specialist delegation for this human turn.',
        },
        evidence: {
          type: 'string',
          required: true,
          description: 'Concrete findings already obtained from the settled wave that justify the decision. Must be non-empty.',
        },
      },
      output: jsonOutput(SPECIALIST_CHECKPOINT_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'specialist_checkpoint')
        return await serializeContinuation(String(teamSession.id), async () => {
          const membership = ctx.agentTeams.tryMembership(agent)
          if (membership?.role !== 'lead') throw new Error('specialist_checkpoint requires the Team Lead')
          const mode = orchestrationModeOf(ctx.sessionProjections, teamSession)
          if (mode === 'off') {
            throw new Error('specialist_checkpoint applies only to automatic AUTO/ON orchestration; OFF is owner-explicit manual delegation')
          }
          const evidence = args.evidence.trim()
          if (evidence.length === 0) throw new Error('specialist checkpoint evidence must be non-empty')
          if (evidence.length > 8_000) throw new Error('specialist checkpoint evidence exceeds 8000 characters')
          const turnKey = specialistContinuationTurnKey(teamSession)
          const state = specialistContinuationStateOf(ctx.sessionProjections, teamSession, turnKey)
          if (state.startedInWave === 0) throw new Error(`specialist wave ${state.wave} has no recorded starts to checkpoint`)
          const unsettled = ctx.agentTeams.listSpecialistStatus(agent).specialists
            .filter(specialist => specialist.phase === 'queued' || specialist.phase === 'working')
          if (unsettled.length > 0) {
            const summary = unsettled.map(specialist => `${specialist.name}:${specialist.phase}`).join(', ')
            throw new Error(`specialist wave ${state.wave} is not settled; wait for queued/working specialists before checkpointing: ${summary}`)
          }
          if (args.decision === 'continue' && state.wave !== 1) {
            throw new Error('a third automatic specialist wave is not allowed; synthesize the Lead answer')
          }
          recordSpecialistCheckpoint(teamSession, turnKey, state.wave, args.decision, evidence)
          return {
            decision: args.decision,
            wave: state.wave,
            ...(args.decision === 'continue' ? { nextWave: 2 } : {}),
          }
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'spawn_specialist',
      description: 'Start one specialist from the catalog and give it a concrete assignment. `name` selects the specialist role; `task` is the work that specialist must perform. The specialist keeps its catalog role and receives `task` as its assignment. If the per-team concurrency limit is reached the specialist is queued and starts automatically when a slot opens. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', required: true, description: 'Specialist role to start, from list_specialists.' },
        task: {
          type: 'string',
          required: true,
          description: 'Concrete work this specialist must perform. Include enough context to act without the Lead conversation, such as paths, goals, acceptance criteria, and any write scope you expect it to own.',
        },
        provider: {
          type: 'string',
          description: 'Optional approved LLM provider route for this specialist. Must be supplied together with model.',
        },
        model: {
          type: 'string',
          description: 'Optional approved LLM model for this specialist. Must be supplied together with provider.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Optional reasoning-effort override for the specialist.',
        },
      },
      output: jsonOutput(SPAWN_SPECIALIST_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_specialist')
        const mode = orchestrationModeOf(ctx.sessionProjections, teamSession)

        const start = async () => {
          const turnKey = specialistContinuationTurnKey(teamSession)
          const continuation = specialistContinuationStateOf(ctx.sessionProjections, teamSession, turnKey)
          assertAutomaticSpecialistStart(mode, continuation)
          const def = ctx.agentTeams.specialists.find((s: SpecialistDefinition) => s.name === args.name)
          const effectiveModel = args.model ?? def?.model
          const effectiveProvider = args.provider ?? def?.provider
          const resolvedProvider = effectiveModel !== undefined && effectiveProvider === undefined
            ? config.freshProvider
            : effectiveProvider
          const agentOptions = await resolveTeammateAgentOptions(
            ctx,
            agent,
            teamSelectionPolicy,
            'fresh',
            resolvedProvider,
            effectiveModel,
            args.reasoning_effort,
            exec.signal,
          )
          const result: StartSpecialistResult = await ctx.agentTeams.startSpecialist(agent, {
            name: args.name,
            task: args.task,
            provider: config.freshProvider,
            ...(agentOptions !== undefined ? { agentOptions } : {}),
            signal: exec.signal,
          })
          if (mode !== 'off') recordAutomaticSpecialistStart(teamSession, turnKey, continuation.wave)
          if (result.member !== undefined) {
            return { status: result.status, name: result.name, member: modelMember(result.member) }
          }
          return {
            status: result.status,
            name: result.name,
            ...result.pending !== undefined ? { pending: result.pending } : {},
          }
        }

        return mode === 'off' ? await start() : await serializeContinuation(String(teamSession.id), start)
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  // Register the model-selection projection so captureModelSelectionPolicy can read
  // the session-bound policy. Registration is ref-counted and safe across HMR cycles.
  ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
  ctx.sessionProjections.register(orchestrationModeProjectionDefinition)
  ctx.sessionProjections.register(specialistContinuationProjectionDefinition)
  const resolved: Required<Config> = {
    interrupt: config.interrupt ?? true,
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
  registerOrchestrationCommand(ctx)
}

/**
 * Register `/orchestrate` when a command registry is composed. The registry is optional,
 * so the plugin keeps working without it; the mode is then only readable through its projection.
 * @param ctx - plugin context that owns the optional command registration.
 */
function registerOrchestrationCommand(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'orchestrate',
      description: 'Select or show the Team orchestration mode',
      input: { hint: '[off|auto|on|status]' },
      handler: ({ agent, rawInput }) => {
        const member = ctx.agentTeams.tryMembership(agent)
        if (member === undefined) {
          return { kind: 'error', text: 'Orchestration mode applies to an Agent Team; this session is not a Team member.' }
        }
        const requested = rawInput.trim().toLowerCase()
        if (requested === '' || requested === 'status') {
          return { kind: 'success', text: `Orchestration mode is ${orchestrationModeOf(ctx.sessionProjections, member.root.session)}.` }
        }
        const mode = parseOrchestrationMode(requested)
        if (mode === undefined) {
          return { kind: 'error', text: `Unknown orchestration mode "${rawInput.trim()}". Use off, auto, on, or status.` }
        }
        if (member.role !== 'lead') {
          return { kind: 'error', text: 'Only the Team Lead can change the orchestration mode.' }
        }
        const current = orchestrationModeOf(ctx.sessionProjections, member.root.session)
        if (current === mode) return { kind: 'success', text: `Orchestration mode is already ${mode}.` }
        recordOrchestrationMode(member.root.session, mode)
        return { kind: 'success', text: `Orchestration mode set to ${mode}.` }
      },
    })
  })
}
