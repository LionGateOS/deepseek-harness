/** Per-team specialist concurrency gate with FIFO queuing behind the global ActivationPool. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { RouteLimit, SpawnTeammateRequest, SpawnTeammateResult, TeamId } from './types.ts'

/** One pending specialist job waiting for a concurrency slot. */
interface QueueEntry {
  /** True when the caller's signal aborted before this job started. */
  cancelled: boolean
  readonly root: Agent
  readonly request: SpawnTeammateRequest
}

/** Per-team slot accounting and FIFO pending queue. */
interface TeamSlots {
  activeCount: number
  readonly pending: QueueEntry[]
  /** Per-provider active specialist count; enforced alongside the team-wide ceiling. */
  readonly routeActive: Map<string, number>
}

/**
 * Optional lifecycle callbacks fired at each specialist phase transition.
 * Each callback returns void; the caller is responsible for managing any
 * asynchronous work (e.g., fire-and-forget session event writes).
 */
export interface SpecialistQueueCallbacks {
  /** Called when a specialist enters the queue; position is 0-indexed depth ahead of this entry. */
  onQueued?: (root: Agent, teamId: TeamId, name: string, provider: string, position: number) => void
  /** Called when a queued specialist claims a slot and starts provisioning. */
  onPromoted?: (root: Agent, teamId: TeamId, name: string) => void
  /** Called when a queued specialist's signal aborts before it was promoted. */
  onCancelled?: (root: Agent, teamId: TeamId, name: string) => void
  /** Called when an active specialist's session disposes. */
  onFinished?: (root: Agent, teamId: TeamId, name: string) => void
}

/**
 * Guards per-team specialist concurrency before the global ActivationPool.
 * Maintains per-team slot counters and a FIFO pending queue backed by a plain
 * array. At most `maxActive` specialists per Team hold an activation slot at
 * any moment; excess requests are queued and promoted automatically as slots
 * open on agent disposal. Per-route ceilings further restrict the total budget
 * for one provider route; the effective admission decision respects both.
 */
export class SpecialistQueue {
  private readonly teams = new Map<TeamId, TeamSlots>()
  private readonly sessionToTeam = new Map<SessionId, TeamId>()
  private readonly sessionToProvider = new Map<SessionId, string>()
  private readonly sessionToName = new Map<SessionId, string>()
  private readonly teamToRoot = new Map<TeamId, Agent>()
  private readonly routeLimits: ReadonlyMap<string, number>

  /**
   * @param maxActive - Maximum concurrently active specialists per Team.
   * @param spawnFn - Delegate that starts one specialist (roster.spawn).
   * @param routeLimits - Optional per-route active-specialist ceilings.
   * @param callbacks - Optional lifecycle notification callbacks.
   */
  constructor(
    private readonly maxActive: number,
    private readonly spawnFn: (root: Agent, request: SpawnTeammateRequest) => Promise<SpawnTeammateResult>,
    routeLimits: readonly RouteLimit[] = [],
    private readonly callbacks: SpecialistQueueCallbacks = {},
  ) {
    this.routeLimits = new Map(routeLimits.map(r => [r.provider, r.maxActive]))
  }

  /**
   * Claim one slot and start the specialist immediately, or push to the FIFO queue.
   * Both the team-wide ceiling and any matching per-route ceiling must permit admission.
   * @param root - exact live Lead Agent.
   * @param teamId - Team identity owning the specialist budget.
   * @param request - specialist spawn request; signal covers the queued wait too.
   * @returns `{ status: 'active', promise }` when a slot was available, or
   *          `{ status: 'queued', pending }` when the job was queued.
   */
  startOrQueue(
    root: Agent,
    teamId: TeamId,
    request: SpawnTeammateRequest,
  ): { status: 'active'; promise: Promise<SpawnTeammateResult> } | { status: 'queued'; pending: number } {
    this.teamToRoot.set(teamId, root)
    const slots = this.ensureSlots(teamId)
    const routeLimit = this.routeLimits.get(request.provider)
    const routeCount = slots.routeActive.get(request.provider) ?? 0
    if (slots.activeCount < this.maxActive && (routeLimit === undefined || routeCount < routeLimit)) {
      slots.activeCount++
      slots.routeActive.set(request.provider, routeCount + 1)
      return { status: 'active', promise: this.doSpawn(root, teamId, slots, request) }
    }
    const position = slots.pending.filter(e => !e.cancelled).length
    const entry: QueueEntry = { cancelled: false, root, request }
    if (request.signal.aborted) {
      entry.cancelled = true
    } else {
      request.signal.addEventListener('abort', () => {
        entry.cancelled = true
        this.callbacks.onCancelled?.(root, teamId, request.name)
      }, { once: true })
    }
    slots.pending.push(entry)
    if (!entry.cancelled) {
      this.callbacks.onQueued?.(root, teamId, request.name, request.provider, position)
    }
    return { status: 'queued', pending: slots.pending.filter(e => !e.cancelled).length }
  }

  /**
   * Release one specialist slot and promote the next queued job.
   * Called by TeamService on `agent/disposed` for tracked specialist sessions.
   * @param id - disposed specialist Agent's Session identity.
   */
  onSpecialistSettled(id: SessionId): void {
    const teamId = this.sessionToTeam.get(id)
    if (teamId === undefined) return
    this.sessionToTeam.delete(id)
    const provider = this.sessionToProvider.get(id)
    this.sessionToProvider.delete(id)
    const name = this.sessionToName.get(id)
    this.sessionToName.delete(id)
    const slots = this.teams.get(teamId)
    if (slots === undefined) return
    slots.activeCount--
    if (provider !== undefined) {
      const rc = slots.routeActive.get(provider) ?? 0
      slots.routeActive.set(provider, Math.max(0, rc - 1))
    }
    if (name !== undefined) {
      const settledRoot = this.teamToRoot.get(teamId)
      if (settledRoot !== undefined) this.callbacks.onFinished?.(settledRoot, teamId, name)
    }
    this.promoteNext(teamId, slots)
  }

  /** Active specialist count for one Team; zero if the Team has no entries. */
  activeCount(teamId: TeamId): number {
    return this.teams.get(teamId)?.activeCount ?? 0
  }

  /** Non-cancelled pending queue depth for one Team; zero if the Team has no entries. */
  pendingCount(teamId: TeamId): number {
    return this.teams.get(teamId)?.pending.filter(e => !e.cancelled).length ?? 0
  }

  /** Execute one spawn and register the resulting session for slot accounting. */
  private doSpawn(
    root: Agent,
    teamId: TeamId,
    slots: TeamSlots,
    request: SpawnTeammateRequest,
  ): Promise<SpawnTeammateResult> {
    return this.spawnFn(root, request).then(
      (result) => {
        this.sessionToTeam.set(result.member.id, teamId)
        this.sessionToProvider.set(result.member.id, request.provider)
        this.sessionToName.set(result.member.id, request.name)
        return result
      },
      (error: unknown) => {
        slots.activeCount--
        const rc = slots.routeActive.get(request.provider) ?? 0
        slots.routeActive.set(request.provider, Math.max(0, rc - 1))
        this.promoteNext(teamId, slots)
        throw error
      },
    )
  }

  /**
   * Promote queued entries until one starts or the queue is exhausted.
   * Cancelled entries are removed in-place. Route-blocked entries are skipped
   * (not removed) so they remain eligible when their route opens.
   */
  private promoteNext(teamId: TeamId, slots: TeamSlots): void {
    if (slots.activeCount >= this.maxActive) return
    let i = 0
    while (i < slots.pending.length) {
      const entry = slots.pending[i]!
      if (entry.cancelled) {
        slots.pending.splice(i, 1)
        continue
      }
      const routeLimit = this.routeLimits.get(entry.request.provider)
      const routeCount = slots.routeActive.get(entry.request.provider) ?? 0
      if (routeLimit !== undefined && routeCount >= routeLimit) {
        i++
        continue  // route at ceiling; look further in queue
      }
      slots.pending.splice(i, 1)
      slots.activeCount++
      slots.routeActive.set(entry.request.provider, routeCount + 1)
      this.callbacks.onPromoted?.(entry.root, teamId, entry.request.name)
      void this.doSpawn(entry.root, teamId, slots, entry.request)
      return
    }
  }

  private ensureSlots(teamId: TeamId): TeamSlots {
    let slots = this.teams.get(teamId)
    if (slots === undefined) {
      slots = { activeCount: 0, pending: [], routeActive: new Map() }
      this.teams.set(teamId, slots)
    }
    return slots
  }
}
