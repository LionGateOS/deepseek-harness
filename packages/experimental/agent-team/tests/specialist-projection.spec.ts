import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { specialistQueueProjectionDefinition } from '../src/specialist-projection.ts'
import type { SpecialistQueueState } from '../src/specialist-projection.ts'
import { TeamId } from '../src/types.ts'
import type { SpecialistStatusSnapshot } from '../src/types.ts'

const ROOT = SessionId('lead-session')
const TEAM = TeamId(ROOT)
const OTHER_TEAM = TeamId(SessionId('other-lead'))

function event<T extends Extract<SessionEventType, `team/specialist/${string}`>>(
  type: T,
  data: SessionEventMap[T],
  seq = SessionSeq(1),
): SessionEvent<T> {
  return { type, data, seq, time: seq } as unknown as SessionEvent<T>
}

function project(rootId: SessionId, events: readonly SessionEvent[]): SpecialistQueueState {
  let state = specialistQueueProjectionDefinition.init({
    version: SESSION_FORMAT_VERSION,
    id: rootId,
    createdAt: 0,
    isSeeded: false,
  })
  for (const ev of events) state = specialistQueueProjectionDefinition.apply(state, ev)
  return state
}

function specialists(state: SpecialistQueueState): SpecialistStatusSnapshot[] {
  return specialistQueueProjectionDefinition.wire.view(state).specialists
}

describe('specialist-projection', () => {
  describe('initial state', () => {
    it('starts empty with matching team id', () => {
      const state = project(ROOT, [])
      expect(state.id).toBe(TEAM)
      expect(state.specialists).toHaveLength(0)
      expect(state.failure).toBeUndefined()
    })

    it('ignores non-specialist events', () => {
      const nonSpecialist = {
        type: 'team/member',
        data: { version: 2, teamId: TEAM, member: {} as never },
        seq: SessionSeq(1),
        time: SessionSeq(1),
      } as unknown as SessionEvent
      const state = project(ROOT, [nonSpecialist])
      expect(state.specialists).toHaveLength(0)
      expect(state.failure).toBeUndefined()
    })
  })

  describe('team/specialist/queued', () => {
    it('appends a new queued entry with position and provider', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
      ])
      expect(state.specialists).toHaveLength(1)
      const [entry] = state.specialists
      expect(entry!.name).toBe('alpha')
      expect(entry!.phase).toBe('queued')
      expect(entry!.position).toBe(0)
      expect(entry!.provider).toBe('spawn')
    })

    it('appends multiple entries preserving order', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'beta', provider: 'spawn', position: 1 }),
      ])
      expect(state.specialists).toHaveLength(2)
      expect(state.specialists[0]!.name).toBe('alpha')
      expect(state.specialists[1]!.name).toBe('beta')
    })

    it('ignores events for a different team', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: OTHER_TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
      ])
      expect(state.specialists).toHaveLength(0)
    })

    it('enters failure when the same specialist is queued twice', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 1 }),
      ])
      expect(state.failure).toMatch(/queued twice/)
    })

    it('enters failure on unsupported version', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 999 as never, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
      ])
      expect(state.failure).toMatch(/unsupported/)
    })
  })

  describe('team/specialist/promoted', () => {
    it('transitions the last queued entry to working and clears its position', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      const [entry] = state.specialists
      expect(entry!.phase).toBe('working')
      expect(entry!.position).toBeUndefined()
    })

    it('recomputes queue positions for remaining queued entries after promotion', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'beta', provider: 'spawn', position: 1 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'gamma', provider: 'spawn', position: 2 }),
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      // alpha is working (no position); beta and gamma are reindexed to 0 and 1
      const alpha = state.specialists.find(e => e.name === 'alpha')!
      const beta = state.specialists.find(e => e.name === 'beta')!
      const gamma = state.specialists.find(e => e.name === 'gamma')!
      expect(alpha.phase).toBe('working')
      expect(alpha.position).toBeUndefined()
      expect(beta.phase).toBe('queued')
      expect(beta.position).toBe(0)
      expect(gamma.phase).toBe('queued')
      expect(gamma.position).toBe(1)
    })

    it('enters failure when promoted specialist was not queued', () => {
      const state = project(ROOT, [
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      expect(state.failure).toMatch(/not queued/)
    })
  })

  describe('team/specialist/cancelled', () => {
    it('transitions the last queued entry to cancelled and clears its position', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/cancelled', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      const [entry] = state.specialists
      expect(entry!.phase).toBe('cancelled')
      expect(entry!.position).toBeUndefined()
    })

    it('recomputes positions for remaining queued entries after cancellation', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'beta', provider: 'spawn', position: 1 }),
        event('team/specialist/cancelled', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      const beta = state.specialists.find(e => e.name === 'beta')!
      expect(beta.phase).toBe('queued')
      expect(beta.position).toBe(0)
    })

    it('enters failure when cancelled specialist was not queued', () => {
      const state = project(ROOT, [
        event('team/specialist/cancelled', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      expect(state.failure).toMatch(/not queued/)
    })
  })

  describe('team/specialist/finished', () => {
    it('transitions the last working entry to finished', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'spawn', position: 0 }),
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
        event('team/specialist/finished', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      const [entry] = state.specialists
      expect(entry!.phase).toBe('finished')
    })

    it('is a no-op when the specialist was not tracked as working (direct spawn)', () => {
      // Direct spawns bypass the queue; a finished event for them should be ignored gracefully
      const state = project(ROOT, [
        event('team/specialist/finished', { version: 1, teamId: TEAM, name: 'untracked' }),
      ])
      expect(state.failure).toBeUndefined()
      expect(state.specialists).toHaveLength(0)
    })
  })

  describe('failure stickiness', () => {
    it('stays in failure state after subsequent events', () => {
      const state = project(ROOT, [
        // Trigger failure: promoting an unqueued specialist
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
        // Subsequent valid event should not clear the failure
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'beta', provider: 'spawn', position: 0 }),
      ])
      expect(state.failure).toBeDefined()
      // State is frozen at the point of failure; beta was not added
      expect(state.specialists).toHaveLength(0)
    })
  })

  describe('wire view', () => {
    it('surfaces phase, position, and provider for all specialists', () => {
      const state = project(ROOT, [
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'alpha', provider: 'route-a', position: 0 }),
        event('team/specialist/queued', { version: 1, teamId: TEAM, name: 'beta', provider: 'route-b', position: 1 }),
        event('team/specialist/promoted', { version: 1, teamId: TEAM, name: 'alpha' }),
      ])
      const view = specialists(state)
      expect(view).toHaveLength(2)
      const alpha = view.find(s => s.name === 'alpha')!
      const beta = view.find(s => s.name === 'beta')!
      expect(alpha.phase).toBe('working')
      expect(alpha.position).toBeUndefined()
      expect(alpha.provider).toBe('route-a')
      expect(beta.phase).toBe('queued')
      expect(beta.position).toBe(0)
      expect(beta.provider).toBe('route-b')
    })
  })
})
