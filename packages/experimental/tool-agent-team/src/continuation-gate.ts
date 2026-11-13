/** Durable per-human-turn bounds for automatic specialist orchestration. */

import { z as zod } from 'zod'
import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { OrchestrationMode } from './orchestration-mode.ts'

export const MAX_AUTOMATIC_SPECIALISTS_PER_WAVE = 4
export type SpecialistCheckpointDecision = 'continue' | 'synthesize'

export interface SpecialistContinuationState {
  readonly turnKey: number
  readonly wave: 1 | 2
  readonly startedInWave: number
  readonly closed: boolean
}

export const SPECIALIST_START_RECORD = 'plugin:tool-agent-team/specialist-start'
export const SPECIALIST_CHECKPOINT_RECORD = 'plugin:tool-agent-team/specialist-checkpoint'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:tool-agent-team/specialist-start': { readonly turnKey: number; readonly wave: 1 | 2 }
    'plugin:tool-agent-team/specialist-checkpoint': {
      readonly turnKey: number
      readonly wave: 1 | 2
      readonly decision: SpecialistCheckpointDecision
      readonly evidence: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    toolAgentTeamSpecialistContinuation: SpecialistContinuationState
  }
}

const stateSchema = zod.object({
  turnKey: zod.number().int().nonnegative(),
  wave: zod.union([zod.literal(1), zod.literal(2)]),
  startedInWave: zod.number().int().nonnegative(),
  closed: zod.boolean(),
}).strict() as zod.ZodType<SpecialistContinuationState>

const startSchema = zod.object({
  turnKey: zod.number().int().nonnegative(),
  wave: zod.union([zod.literal(1), zod.literal(2)]),
}).strict()

const checkpointSchema = zod.object({
  turnKey: zod.number().int().nonnegative(),
  wave: zod.union([zod.literal(1), zod.literal(2)]),
  decision: zod.enum(['continue', 'synthesize']),
  evidence: zod.string().min(1).max(8_000),
}).strict()

function initialState(turnKey = 0): SpecialistContinuationState {
  return { turnKey, wave: 1, startedInWave: 0, closed: false }
}

export const specialistContinuationProjectionDefinition = {
  key: 'toolAgentTeamSpecialistContinuation',
  stateVersion: 1,
  stateSchema,
  init: () => initialState(),
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type === SPECIALIST_START_RECORD) {
      const data = startSchema.parse(record.data)
      if (data.turnKey !== state.turnKey) {
        if (data.wave !== 1) throw new Error('a new human turn must begin with specialist wave 1')
        return { turnKey: data.turnKey, wave: 1, startedInWave: 1, closed: false }
      }
      if (state.closed) throw new Error('cannot start an automatic specialist after synthesis was selected')
      if (data.wave !== state.wave) throw new Error('specialist start wave does not match continuation state')
      return { ...state, startedInWave: state.startedInWave + 1 }
    }
    if (record?.type === SPECIALIST_CHECKPOINT_RECORD) {
      const data = checkpointSchema.parse(record.data)
      if (data.turnKey !== state.turnKey) throw new Error('specialist checkpoint does not match the active human turn')
      if (data.wave !== state.wave) throw new Error('specialist checkpoint wave does not match continuation state')
      if (data.decision === 'continue') {
        if (state.wave !== 1) throw new Error('a third automatic specialist wave is not allowed')
        return { turnKey: state.turnKey, wave: 2, startedInWave: 0, closed: false }
      }
      return { ...state, closed: true }
    }
    return state
  },
} satisfies ProjectionDefinition<'toolAgentTeamSpecialistContinuation', SpecialistContinuationState>

export function specialistContinuationTurnKey(session: Session): number {
  let key = 0
  for (const event of session.snapshotEvents()) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') key = Number(event.seq)
  }
  return key
}

export function specialistContinuationStateOf(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
  turnKey: number,
): SpecialistContinuationState {
  const state = projections.stateOf(session, 'toolAgentTeamSpecialistContinuation')
  return state === undefined || state.turnKey !== turnKey ? initialState(turnKey) : state
}

export function assertAutomaticSpecialistStart(
  mode: OrchestrationMode,
  state: SpecialistContinuationState,
): void {
  if (mode === 'off') return
  if (state.closed) {
    throw new Error('automatic specialist continuation is closed for this human turn; synthesize the Lead answer')
  }
  if (state.startedInWave >= MAX_AUTOMATIC_SPECIALISTS_PER_WAVE) {
    if (state.wave === 1) {
      throw new Error('automatic specialist wave 1 reached the four-specialist limit; call specialist_checkpoint with evidence and choose continue or synthesize')
    }
    throw new Error('automatic specialist wave 2 reached the four-specialist limit; no third wave is allowed, synthesize the Lead answer')
  }
}

export function recordAutomaticSpecialistStart(session: Session, turnKey: number, wave: 1 | 2): number {
  return appendPluginRecord(session, SPECIALIST_START_RECORD, { turnKey, wave })
}

export function recordSpecialistCheckpoint(
  session: Session,
  turnKey: number,
  wave: 1 | 2,
  decision: SpecialistCheckpointDecision,
  evidence: string,
): number {
  return appendPluginRecord(session, SPECIALIST_CHECKPOINT_RECORD, { turnKey, wave, decision, evidence })
}
