/** Specialist scheduling projection derived from the team/specialist/* event stream. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { TeamId as toTeamId } from './types.ts'
import type { SpecialistPhase, SpecialistQueueView, SpecialistStatusSnapshot, TeamId } from './types.ts'

/** Mutable specialist entry held in projection state. */
interface SpecialistEntry {
  readonly name: string
  phase: SpecialistPhase
  position?: number
  readonly provider: string
}

/**
 * Checkpoint-safe state for the specialist scheduling projection owned by one Lead Session.
 * Records specialist entries in spawn order; phases advance forward only.
 */
export interface SpecialistQueueState {
  readonly id: TeamId
  readonly specialists: readonly SpecialistEntry[]
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Specialist scheduling phases for the Team rooted at the projected Session. */
    agentTeamSpecialists: SpecialistQueueView
  }
}

/** Event types that belong to the specialist queue domain. */
type SpecialistEventType =
  | 'team/specialist/queued'
  | 'team/specialist/promoted'
  | 'team/specialist/cancelled'
  | 'team/specialist/finished'

function isSpecialistEvent(event: SessionEvent): boolean {
  return event.type === 'team/specialist/queued'
    || event.type === 'team/specialist/promoted'
    || event.type === 'team/specialist/cancelled'
    || event.type === 'team/specialist/finished'
}

/** Zod schemas for the checkpoint-safe state. */
const teamIdSchema = z.string().min(1).transform(v => toTeamId(v))

const specialistPhaseSchema = z.enum(['queued', 'working', 'finished', 'cancelled']) as z.ZodType<SpecialistPhase>

const specialistEntrySchema = z.object({
  name: z.string().min(1),
  phase: specialistPhaseSchema,
  position: z.number().int().nonnegative().optional(),
  provider: z.string(),
}).strict() as z.ZodType<SpecialistEntry>

const specialistQueueStateSchema = z.object({
  id: teamIdSchema,
  specialists: z.array(specialistEntrySchema),
  failure: z.string().optional(),
}).strict() as z.ZodType<SpecialistQueueState>

function emptySpecialistQueueState(rootId: SessionId): SpecialistQueueState {
  return { id: toTeamId(rootId), specialists: [] }
}

/** Loose schema for event-level team-id selection. */
const eventSelectorSchema = z.object({
  version: z.number().int().nonnegative(),
  teamId: teamIdSchema,
}).loose()

/** Recompute queue positions across all entries currently in 'queued' phase. */
function recomputePositions(specialists: readonly SpecialistEntry[]): SpecialistEntry[] {
  let pos = 0
  return specialists.map(entry => {
    if (entry.phase !== 'queued') return entry
    return { ...entry, position: pos++ }
  })
}

function applySpecialistEvent(
  state: SpecialistQueueState,
  event: SessionEvent,
): SpecialistQueueState {
  if (state.failure !== undefined) return state
  if (!isSpecialistEvent(event)) return state
  try {
    const selector = eventSelectorSchema.parse(event.data)
    if (selector.teamId !== state.id) return state
    if (selector.version !== 1) {
      throw new Error(`unsupported team/specialist event version ${String(selector.version)}`)
    }
    return applyCurrentEvent(state, event.type as SpecialistEventType, event.data)
  } catch (error: unknown) {
    /* v8 ignore next -- the owned specialist transition throws Error instances. */
    return { ...state, failure: error instanceof Error ? error.message : String(error) }
  }
}

function applyCurrentEvent(
  state: SpecialistQueueState,
  type: SpecialistEventType,
  data: unknown,
): SpecialistQueueState {
  const payload = data as Record<string, unknown>
  const name = payload['name'] as string
  switch (type) {
    case 'team/specialist/queued': {
      const provider = payload['provider'] as string
      const position = payload['position'] as number
      if (state.specialists.some(e => e.name === name && e.phase === 'queued')) {
        throw new Error(`specialist "${name}" queued twice`)
      }
      return {
        ...state,
        specialists: [...state.specialists, { name, phase: 'queued', position, provider }],
      }
    }
    case 'team/specialist/promoted': {
      const index = state.specialists.findLastIndex(e => e.name === name && e.phase === 'queued')
      if (index < 0) throw new Error(`promoted specialist "${name}" was not queued`)
      const next = state.specialists.map((e, i) =>
        i === index ? { name: e.name, phase: 'working' as SpecialistPhase, provider: e.provider } : e,
      )
      return { ...state, specialists: recomputePositions(next) }
    }
    case 'team/specialist/cancelled': {
      const index = state.specialists.findLastIndex(e => e.name === name && e.phase === 'queued')
      if (index < 0) throw new Error(`cancelled specialist "${name}" was not queued`)
      const next = state.specialists.map((e, i) =>
        i === index ? { name: e.name, phase: 'cancelled' as SpecialistPhase, provider: e.provider } : e,
      )
      return { ...state, specialists: recomputePositions(next) }
    }
    case 'team/specialist/finished': {
      const index = state.specialists.findLastIndex(e => e.name === name && e.phase === 'working')
      if (index < 0) return state  // specialist not tracked (e.g., direct spawn without queue)
      const next = state.specialists.map((e, i) =>
        i === index ? { ...e, phase: 'finished' as SpecialistPhase } : e,
      )
      return { ...state, specialists: next }
    }
  }
}

/** Wire view schema for the specialist queue. */
const specialistStatusSnapshotSchema = z.object({
  name: z.string(),
  phase: specialistPhaseSchema,
  position: z.number().int().nonnegative().optional(),
  provider: z.string().optional(),
}).strict() as z.ZodType<SpecialistStatusSnapshot>

const specialistQueueViewSchema = z.object({
  specialists: z.array(specialistStatusSnapshotSchema),
}).strict() as z.ZodType<SpecialistQueueView>

function buildSpecialistQueueView(state: SpecialistQueueState): SpecialistQueueView {
  return {
    specialists: state.specialists.map(({ name, phase, position, provider }): SpecialistStatusSnapshot => ({
      name,
      phase,
      ...position !== undefined ? { position } : {},
      provider,
    })),
  }
}

/**
 * Projection definition for the specialist scheduling queue.
 * Processes team/specialist/* events and surfaces phase, position, and provider
 * for each specialist that has been queued or promoted through the scheduler.
 * Additive only: existing sessions without these events load with an empty list.
 */
export const specialistQueueProjectionDefinition = {
  key: 'agentTeamSpecialists',
  stateVersion: 1,
  stateSchema: specialistQueueStateSchema,
  init: (header) => emptySpecialistQueueState(brandString<SessionId>(header.id)),
  apply: applySpecialistEvent,
  wire: { viewSchema: specialistQueueViewSchema, view: buildSpecialistQueueView },
} satisfies ProjectionDefinition<'agentTeamSpecialists', SpecialistQueueState>
