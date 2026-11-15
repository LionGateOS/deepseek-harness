/** Public Agent Teams identities, durable records, and service request values. */

import type { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** One durable roster row published through the `agentTeam` Session projection. */
export interface TeamMemberProjection {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  /** Durable lifecycle; the Lead row is always `active`. Turn activity comes from Session status. */
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; members and tasks then stay at the last valid state.
 */
export interface TeamProjection {
  readonly members: TeamMemberProjection[]
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Durable roster and non-deleted task board of the Team rooted at the projected Session. */
    agentTeam: TeamProjection
  }
}

/** One peer message recorded by the historical Team mailbox. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}

/** Source recorded by a target Session for one historical Team mailbox delivery. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Per-route specialist concurrency ceiling, applied together with maxActiveSpecialists. */
export interface RouteLimit {
  /** Provider route identifier matching SpawnTeammateRequest.provider. */
  readonly provider: string
  /** Maximum concurrently active specialists on this route. */
  readonly maxActive: number
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds for shared operation settlement and for each Team child drain. */
  readonly disposalTimeoutMs?: number
  /**
   * Optional wall-clock budget for delegated Team work, in milliseconds.
   * The clock starts at the first durable teammate/specialist creation event.
   * Omission disables the leash. Expiry blocks new child work at safe
   * boundaries; it does not interrupt a model request already in progress.
   */
  readonly maxTeamRuntimeMs?: number
  /** Specialist catalog; spawn_specialist selects from this list by name. */
  readonly specialists?: SpecialistDefinition[]
  /** Maximum concurrently active specialists per Team. Defaults to 4. */
  readonly maxActiveSpecialists?: number
  /**
   * Optional per-route concurrency ceilings. Each entry further restricts the
   * maxActiveSpecialists budget for one provider route. No entry means no route-
   * specific restriction. The effective admission decision respects both ceilings.
   */
  readonly routeLimits?: RouteLimit[]
}

/** Lifecycle phase for a specialist managed by the scheduling queue. */
export type SpecialistPhase = 'queued' | 'working' | 'finished' | 'cancelled'

/** One specialist's scheduling state surfaced through the agentTeamSpecialists projection. */
export interface SpecialistStatusSnapshot {
  readonly name: string
  readonly phase: SpecialistPhase
  /** Queue depth ahead of this entry; present only when phase is 'queued'. */
  readonly position?: number
  /** Provider route; present once known. */
  readonly provider?: string
}

/** Wire view of specialist scheduling state projected to browser clients. */
export interface SpecialistQueueView {
  readonly specialists: SpecialistStatusSnapshot[]
}

/**
 * One entry in the specialist catalog. Specialists are pre-configured agent
 * templates; the Lead selects entries by name and the Team service manages
 * their concurrency under {@link Config.maxActiveSpecialists}.
 */
export interface SpecialistDefinition {
  /** Unique kebab-case name identifying this specialist. */
  readonly name: string
  /** Short description of the specialist's role, surfaced by list_specialists. */
  readonly description: string
  /**
   * Durable role contract, sent as the specialist's leading prompt. It defines
   * how the specialist works and is never replaced by a Lead assignment.
   */
  readonly prompt: string
  /** Provider route override; inherits freshProvider from tool config when omitted. */
  readonly provider?: string
}

/**
 * Provider, model, and inference overrides for a spawned teammate.
 * Structurally identical to `AgentOptions` from `dsh-agent`; defined here
 * to keep `types.ts` free of host-only context augmentations.
 */
export interface TeammateAgentOptions {
  /** Provider route for the teammate (must be registered at spawn time). */
  provider?: string
  /** Model id for the teammate, interpreted by the selected provider. */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens per conversation-model request. */
  maxTokens?: number
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  /**
   * Optional provider, model, reasoning-effort, and output-token overrides for the child.
   * Requires the backing subagent provider to advertise `agentOptions` capability.
   * Omission inherits the parent's current route. For fork context, route-changing
   * overrides (provider or model) are rejected; effort-only overrides are accepted.
   */
  readonly agentOptions?: TeammateAgentOptions
  readonly signal: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Request to start or queue one specialist job. */
export interface StartSpecialistRequest {
  /** Specialist name from the catalog. */
  readonly name: string
  /**
   * Concrete work this specialist must perform. Appended to the catalog role
   * prompt as a separate assignment; omission starts the specialist with its
   * role contract alone.
   */
  readonly task?: string
  /** Provider route for the specialist; used when the catalog entry omits one. */
  readonly provider: string
  /**
   * Optional validated child LLM route/inference overrides.
   * Uses the same AgentOptions contract as direct teammate spawning.
   */
  readonly agentOptions?: TeammateAgentOptions
  readonly signal: AbortSignal
}

/** Result of a start-or-queue specialist call. */
export interface StartSpecialistResult {
  /** 'active' when started immediately into a slot; 'queued' when waiting for a slot. */
  readonly status: 'active' | 'queued'
  /** Specialist name as confirmed from the catalog. */
  readonly name: string
  /** Runtime member row; set only when status is 'active'. */
  readonly member?: TeamMemberView
  /** Number of pending queued specialists when status is 'queued'. */
  readonly pending?: number
}

/** Input for one direct peer-message attempt. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Target inbox acceptance under ordinary Agent persistence; no Team retry or deduplication. */
export interface SendTeamMessageResult {
  readonly messageId: MessageId
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 2; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 2; teamId: TeamId; task: TeamTaskSnapshot }
    /** Historical mailbox enqueue; new sends use the target Agent inbox. */
    'team/message/queued': { version: 2; teamId: TeamId; message: TeamMessageSnapshot }
    /** Historical acknowledgement that the target Session recorded a queued message. */
    'team/message/delivered': {
      version: 2
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
    /** Specialist entered the FIFO queue waiting for a concurrency slot. */
    'team/specialist/queued': { version: 1; teamId: TeamId; name: string; provider: string; position: number }
    /** Specialist left the queue and started provisioning (slot claimed). */
    'team/specialist/promoted': { version: 1; teamId: TeamId; name: string }
    /** Queued specialist was cancelled before it could be promoted. */
    'team/specialist/cancelled': { version: 1; teamId: TeamId; name: string }
    /** Specialist session disposed; marks the end of the specialist's lifecycle. */
    'team/specialist/finished': { version: 1; teamId: TeamId; name: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Specialist scheduling phases derived from the team/specialist/* event stream. */
    agentTeamSpecialists: import('./specialist-projection.ts').SpecialistQueueState
  }
}
