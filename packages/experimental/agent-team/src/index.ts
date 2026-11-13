/** Agent Teams service façade over roster, messaging, task, and runtime lifecycle owners. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { teamProjectionDefinition } from './projection.ts'
import { specialistQueueProjectionDefinition } from './specialist-projection.ts'
import { resolveActiveMember, TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { SpecialistQueue } from './specialist-queue.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpecialistDefinition,
  SpecialistQueueView,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  StartSpecialistRequest,
  StartSpecialistResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from './types.ts'
import { assignedTask } from './validation.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 16
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_MAX_ACTIVE_SPECIALISTS = 4

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/**
 * Compose the initial child prompt for one specialist job.
 *
 * The catalog role is emitted as its own leading block so the durable role
 * contract cannot be replaced by the assignment text, and the assignment is
 * emitted as a separate subordinate block labelled with the assigning Lead.
 * Both blocks share one message so the child receives role and work together.
 * @param def - catalog entry owning the role contract.
 * @param task - normalized work the Lead assigned, when any.
 * @returns content blocks in role-then-assignment order.
 */
function specialistPrompt(def: SpecialistDefinition, task: string | undefined): ContentBlock[] {
  const role: ContentBlock = { type: 'text', text: def.prompt }
  if (task === undefined) return [role]
  return [
    role,
    {
      type: 'text',
      text: `Your assigned task (from the Team Lead):\n${task}\n\n`
        + 'This assignment defines the work to perform. It does not extend your permission scope '
        + 'or replace your role above; report any part you cannot complete under your fixed scope.',
    },
  ]
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
    specialists: z.array(z.object({
      name: z.string().required(),
      description: z.string().required(),
      prompt: z.string().required(),
      provider: z.string(),
    })).default([]),
    maxActiveSpecialists: z.number().step(1).min(1).default(DEFAULT_MAX_ACTIVE_SPECIALISTS),
    routeLimits: z.array(z.object({
      provider: z.string().required(),
      maxActive: z.number().step(1).min(1).required(),
    })).default([]),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly specialistQueue: SpecialistQueue
  private readonly tasks: TeamTaskBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
      specialists: Array.from(config.specialists ?? []),
      maxActiveSpecialists: positiveLimit(
        'maxActiveSpecialists',
        config.maxActiveSpecialists ?? DEFAULT_MAX_ACTIVE_SPECIALISTS,
      ),
      routeLimits: Array.from(config.routeLimits ?? []),
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers)
    this.specialistQueue = new SpecialistQueue(
      this.config.maxActiveSpecialists,
      (root, req) => this.roster.spawn(root, req),
      this.config.routeLimits,
      {
        onQueued: (root, teamId, name, provider, position) => {
          // The Lead session may close before this event flushes during specialist disposal at teardown.
          void this.journal.appendAndFlush(root, 'team/specialist/queued', {
            version: 1 as const, teamId, name, provider, position,
          }).catch(() => undefined)
        },
        onPromoted: (root, teamId, name) => {
          // The Lead session may close before this event flushes during specialist disposal at teardown.
          void this.journal.appendAndFlush(root, 'team/specialist/promoted', {
            version: 1 as const, teamId, name,
          }).catch(() => undefined)
        },
        onCancelled: (root, teamId, name) => {
          // The Lead session may close before this event flushes during specialist disposal at teardown.
          void this.journal.appendAndFlush(root, 'team/specialist/cancelled', {
            version: 1 as const, teamId, name,
          }).catch(() => undefined)
        },
        onFinished: (root, teamId, name) => {
          // The Lead session may close before this event flushes during specialist disposal at teardown.
          void this.journal.appendAndFlush(root, 'team/specialist/finished', {
            version: 1 as const, teamId, name,
          }).catch(() => undefined)
        },
      },
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)

    ctx.on('agent/created', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.on('agent/disposed', ({ agent }) => { this.specialistQueue.onSpecialistSettled(agent.id) })
    ctx.effect(() => {
      const disposeTeamProjection = ctx.root.sessionProjections.register(teamProjectionDefinition)
      const disposeSpecialistProjection = ctx.root.sessionProjections.register(specialistQueueProjectionDefinition)
      return async () => {
        try {
          await this.disposeRuntime()
        } finally {
          disposeTeamProjection()
          disposeSpecialistProjection()
        }
      }
    }, 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Steer one peer message into the target inbox or reject the attempt.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and cancellation before acceptance.
   * @returns accepted inbox identity; acceptance follows normal Agent persistence and does not await model processing.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    return await this.lifecycle.track(this.sendAdmitted(caller, {
      ...request,
      signal: AbortSignal.any([request.signal, this.lifecycle.signal]),
    }))
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /** The configured specialist catalog; empty when no specialists are defined. */
  get specialists(): readonly SpecialistDefinition[] {
    return this.config.specialists
  }

  /**
   * Return current specialist scheduling phases for the calling Lead.
   * @param agent - exact live Lead Agent.
   * @returns wire view of all specialists and their current phase.
   */
  listSpecialistStatus(agent: Agent): SpecialistQueueView {
    const { root, role } = this.roster.membership(agent)
    if (role !== 'lead') {
      throw new TeamError('only the Team Lead can view specialist status', 'TEAM_LEAD_REQUIRED')
    }
    const state = this.ctx.sessionProjections.stateOf(root.session, 'agentTeamSpecialists')
    if (state === undefined) return { specialists: [] }
    return specialistQueueProjectionDefinition.wire.view(state)
  }

  /**
   * Start or queue one specialist job for the calling Lead.
   * Claims a per-team slot immediately if one is available; otherwise queues
   * the job and returns `{ status: 'queued' }` without blocking. Queued jobs
   * start automatically when a slot opens on specialist disposal.
   * Never throws ACTIVATION_LIMIT_REACHED when the specialist cap is full.
   * @param caller - exact live Lead Agent.
   * @param req - specialist name, assigned task, provider fallback, and caller cancellation.
   * @returns immediate result: slot claimed with member row, or queue position.
   */
  async startSpecialist(caller: Agent, req: StartSpecialistRequest): Promise<StartSpecialistResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can spawn specialists', 'TEAM_LEAD_REQUIRED')
    }
    const def = this.config.specialists.find(s => s.name === req.name)
    if (def === undefined) {
      throw new TeamError(`specialist "${req.name}" not found in catalog`, 'SPECIALIST_NOT_FOUND')
    }
    const task = req.task === undefined ? undefined : assignedTask(req.task)
    const signal = AbortSignal.any([req.signal, this.lifecycle.signal])
    const spawnRequest: SpawnTeammateRequest = {
      name: def.name,
      description: def.description,
      prompt: specialistPrompt(def, task),
      context: 'fresh',
      provider: def.provider ?? req.provider,
      ...(req.agentOptions !== undefined ? { agentOptions: req.agentOptions } : {}),
      signal,
    }
    const outcome = this.specialistQueue.startOrQueue(membership.root, membership.id, spawnRequest)
    if (outcome.status === 'active') {
      const result = await outcome.promise
      return { status: 'active', name: def.name, member: result.member }
    }
    return { status: 'queued', name: def.name, pending: outcome.pending }
  }

  /** Deliver an admitted send using the Lead's authority and the actual sender's identity. */
  private async sendAdmitted(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    const membership = this.roster.membership(caller)
    request.signal.throwIfAborted()
    const { root } = membership
    const target = resolveActiveMember(root, this.journal.state(root), request.target)
    if (target.id === caller.id) throw new TeamError('a Team member cannot message itself', 'TEAM_SELF_MESSAGE')
    const content = [
      { type: 'text' as const, text: `Team message from ${membership.name}:` },
      ...structuredClone(request.content),
    ]
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > this.config.maxMessageBytes) {
      throw new TeamError(`team message exceeds ${this.config.maxMessageBytes} bytes`, 'TEAM_MESSAGE_TOO_LARGE')
    }
    const source = { kind: 'agent-message' as const, form: 'relay' as const, senderSessionId: caller.id }
    let messageId
    if (target.id === root.id) {
      const input = createUserMessage({ content, source })
      root.steer(input)
      messageId = input.id
    } else {
      messageId = await steerHostSubagentPrompt(this.ctx.subagents, root, target.id, content, source, request.signal)
    }
    this.activity.notify(membership.id)
    return { messageId }
  }

  /** Queue one contained provisioning reconciliation after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.roster.recoverFor(agent, this.lifecycle.signal).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.lifecycle.pending(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
