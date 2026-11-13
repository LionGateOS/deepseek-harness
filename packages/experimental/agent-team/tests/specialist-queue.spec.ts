import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamId } from '../src/types.ts'
import { SpecialistQueue } from '../src/specialist-queue.ts'
import type { SpawnTeammateRequest, SpawnTeammateResult, TeamMemberView } from '../src/types.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Build a minimal fake TeamMemberView for test results. */
function fakeView(id: string): TeamMemberView {
  return {
    id: SessionId(id),
    name: id,
    role: 'teammate',
    status: 'running',
    description: 'test specialist',
    provider: 'spawn',
    context: 'fresh',
    diagnostics: [],
  }
}

/** Build a minimal fake SpawnTeammateRequest with optional signal and provider. */
function fakeRequest(name: string, signal: AbortSignal = new AbortController().signal, provider = 'spawn'): SpawnTeammateRequest {
  return {
    name,
    description: `${name} specialist`,
    prompt: [{ type: 'text', text: `You are ${name}` }],
    context: 'fresh',
    provider,
    signal,
  }
}

/** Fake Agent used as the roster root. */
const ROOT = { id: SessionId('lead') } as unknown as Agent

describe('SpecialistQueue', () => {
  describe('slot accounting', () => {
    it('starts immediately when activeCount < maxActive', async () => {
      const spawnFn = vi.fn().mockResolvedValue({ member: fakeView('s1') })
      const queue = new SpecialistQueue(2, spawnFn)
      const teamId = TeamId('team-a')

      const result = queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      expect(result.status).toBe('active')
      expect(queue.activeCount(teamId)).toBe(1)
      await (result as { status: 'active'; promise: Promise<SpawnTeammateResult> }).promise
      expect(spawnFn).toHaveBeenCalledOnce()
    })

    it('queues when activeCount reaches maxActive', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const queue = new SpecialistQueue(2, spawnFn)
      const teamId = TeamId('team-b')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))
      expect(queue.activeCount(teamId)).toBe(2)

      const r3 = queue.startOrQueue(ROOT, teamId, fakeRequest('s3'))
      expect(r3.status).toBe('queued')
      expect(queue.pendingCount(teamId)).toBe(1)
      expect(queue.activeCount(teamId)).toBe(2)
    })

    it('reports correct pending count for multiple queued items', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const queue = new SpecialistQueue(2, spawnFn)
      const teamId = TeamId('team-c')

      // Fill 2 slots
      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))

      // Queue 4 more (6 selected, 2 active, 4 queued)
      const r3 = queue.startOrQueue(ROOT, teamId, fakeRequest('s3'))
      const r4 = queue.startOrQueue(ROOT, teamId, fakeRequest('s4'))
      const r5 = queue.startOrQueue(ROOT, teamId, fakeRequest('s5'))
      const r6 = queue.startOrQueue(ROOT, teamId, fakeRequest('s6'))

      expect(r3.status).toBe('queued')
      expect(r4.status).toBe('queued')
      expect(r5.status).toBe('queued')
      expect(r6.status).toBe('queued')
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(4)
    })
  })

  describe('slot release and promotion', () => {
    it('promotes the front queued entry when a slot opens', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const queue = new SpecialistQueue(2, spawnFn)
      const teamId = TeamId('team-d')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s3'))
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(1)

      // Settle s1
      const s1Id = SessionId('specialist-s1')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(queue.activeCount(teamId)).toBe(2))

      // Promote s3 and settle it
      queue.onSpecialistSettled(s1Id)
      await vi.waitFor(() => expect(queue.pendingCount(teamId)).toBe(0))
      expect(queue.activeCount(teamId)).toBe(2)
    })

    it('never exceeds maxActive during promotion of multiple queued entries', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const queue = new SpecialistQueue(2, spawnFn)
      const teamId = TeamId('team-e')

      // 8 specialists in catalog; select 6; maxActive = 2 → 2 active + 4 queued
      for (let i = 1; i <= 6; i++) {
        queue.startOrQueue(ROOT, teamId, fakeRequest(`s${i}`))
      }
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(4)
      expect(spawnFn).toHaveBeenCalledTimes(2)

      // Complete s1 → s3 promoted; active stays at 2
      const s1Id = SessionId('sid-s1')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      queue.onSpecialistSettled(s1Id)
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(3))
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(3)

      // Complete s2 → s4 promoted
      const s2Id = SessionId('sid-s2')
      resolvers[1]!({ member: { ...fakeView('s2'), id: s2Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(3))
      queue.onSpecialistSettled(s2Id)
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(4))
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(2)
    })

    it('releases slot and promotes on spawn failure', async () => {
      let callCount = 0
      const spawnFn = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('spawn failed'))
        return Promise.resolve({ member: fakeView(`s${callCount}`) })
      })
      const queue = new SpecialistQueue(1, spawnFn)
      const teamId = TeamId('team-f')

      // First spawn fails; slot released; second (queued) is promoted
      const r1 = queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      expect(r1.status).toBe('active')
      const r2 = queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))
      expect(r2.status).toBe('queued')

      // Await r1 to reject
      const p1 = (r1 as { status: 'active'; promise: Promise<SpawnTeammateResult> }).promise
      await expect(p1).rejects.toThrow('spawn failed')

      // Slot released; s2 should have been promoted
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      expect(queue.activeCount(teamId)).toBe(1)
    })
  })

  describe('cancellation', () => {
    it('marks queued entry cancelled on signal abort', async () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const queue = new SpecialistQueue(1, spawnFn)
      const teamId = TeamId('team-g')

      // Fill slot
      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))

      // Queue s2 with a cancellable signal
      const ctrl = new AbortController()
      const r2 = queue.startOrQueue(ROOT, teamId, fakeRequest('s2', ctrl.signal))
      expect(r2.status).toBe('queued')
      expect(queue.pendingCount(teamId)).toBe(1)

      ctrl.abort()
      // After abort, pendingCount should drop to 0 (entry marked cancelled)
      expect(queue.pendingCount(teamId)).toBe(0)
    })

    it('skips cancelled entries during promotion and continues to next', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const queue = new SpecialistQueue(1, spawnFn)
      const teamId = TeamId('team-h')

      // Fill the single slot
      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))

      // Queue s2 (to be cancelled) and s3
      const ctrl = new AbortController()
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', ctrl.signal))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s3'))
      ctrl.abort()
      expect(queue.pendingCount(teamId)).toBe(1) // only s3 remains

      // Settle s1 → should skip cancelled s2 and promote s3
      const s1Id = SessionId('sid-s1-h')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1))
      queue.onSpecialistSettled(s1Id)
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      expect(queue.activeCount(teamId)).toBe(1)
    })
  })

  describe('session tracking', () => {
    it('ignores onSpecialistSettled for unknown session ids', () => {
      const spawnFn = vi.fn()
      const queue = new SpecialistQueue(2, spawnFn)
      // Should not throw
      queue.onSpecialistSettled(SessionId('unknown-session'))
    })
  })

  describe('per-route concurrency limits', () => {
    it('enforces route ceiling alongside team-wide ceiling', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const queue = new SpecialistQueue(4, spawnFn, [{ provider: 'route-a', maxActive: 1 }])
      const teamId = TeamId('team-rl-1')

      // First specialist on route-a claims the route slot and global slot
      const r1 = queue.startOrQueue(ROOT, teamId, fakeRequest('s1', new AbortController().signal, 'route-a'))
      expect(r1.status).toBe('active')
      expect(queue.activeCount(teamId)).toBe(1)

      // Second on route-a is queued (route ceiling = 1, already full)
      const r2 = queue.startOrQueue(ROOT, teamId, fakeRequest('s2', new AbortController().signal, 'route-a'))
      expect(r2.status).toBe('queued')
      expect(queue.pendingCount(teamId)).toBe(1)

      // A specialist on a different route starts immediately (global ceiling 4, route-b uncapped)
      const r3 = queue.startOrQueue(ROOT, teamId, fakeRequest('s3', new AbortController().signal, 'route-b'))
      expect(r3.status).toBe('active')
      expect(queue.activeCount(teamId)).toBe(2)
    })

    it('releases route slot on settlement and promotes next queued on that route', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const queue = new SpecialistQueue(4, spawnFn, [{ provider: 'route-a', maxActive: 1 }])
      const teamId = TeamId('team-rl-2')

      // Start s1 (route-a slot taken)
      queue.startOrQueue(ROOT, teamId, fakeRequest('s1', new AbortController().signal, 'route-a'))
      // Queue s2 (route-a blocked)
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', new AbortController().signal, 'route-a'))

      expect(queue.activeCount(teamId)).toBe(1)
      expect(queue.pendingCount(teamId)).toBe(1)
      expect(spawnFn).toHaveBeenCalledTimes(1)

      // s1 settles → s2 should be promoted
      const s1Id = SessionId('sid-rl-s1')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1))
      queue.onSpecialistSettled(s1Id)
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      expect(queue.activeCount(teamId)).toBe(1)
      expect(queue.pendingCount(teamId)).toBe(0)
    })

    it('skips route-blocked entries and promotes a compatible entry further in queue', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      // maxActive=2, route-a limit=1
      const queue = new SpecialistQueue(2, spawnFn, [{ provider: 'route-a', maxActive: 1 }])
      const teamId = TeamId('team-rl-3')

      // Fill both global slots with route-a and route-b
      queue.startOrQueue(ROOT, teamId, fakeRequest('s1', new AbortController().signal, 'route-a'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', new AbortController().signal, 'route-b'))
      expect(queue.activeCount(teamId)).toBe(2)

      // Queue s3 (route-a, blocked by route limit), s4 (route-b, should be promotable when route-b slot opens)
      queue.startOrQueue(ROOT, teamId, fakeRequest('s3', new AbortController().signal, 'route-a'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s4', new AbortController().signal, 'route-b'))
      expect(queue.pendingCount(teamId)).toBe(2)

      // Settle s2 (route-b) → global slot opens; s3 is route-a blocked; should skip to s4 (route-b)
      const s2Id = SessionId('sid-rl-s2')
      resolvers[1]!({ member: { ...fakeView('s2'), id: s2Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      queue.onSpecialistSettled(s2Id)
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(3))
      // s4 was promoted; s3 remains queued
      expect(queue.activeCount(teamId)).toBe(2)
      expect(queue.pendingCount(teamId)).toBe(1)
    })

    it('releases route slot on spawn failure and promotes next', async () => {
      let callCount = 0
      const spawnFn = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('spawn failed'))
        return Promise.resolve({ member: fakeView(`s${callCount}`) })
      })
      const queue = new SpecialistQueue(2, spawnFn, [{ provider: 'route-a', maxActive: 1 }])
      const teamId = TeamId('team-rl-4')

      // s1 starts on route-a (takes route slot)
      const r1 = queue.startOrQueue(ROOT, teamId, fakeRequest('s1', new AbortController().signal, 'route-a'))
      // s2 queued (route-a blocked)
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', new AbortController().signal, 'route-a'))

      const p1 = (r1 as { status: 'active'; promise: Promise<SpawnTeammateResult> }).promise
      await expect(p1).rejects.toThrow('spawn failed')

      // Route slot released; s2 should be promoted
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
      expect(queue.activeCount(teamId)).toBe(1)
    })
  })

  describe('lifecycle callbacks', () => {
    it('fires onQueued when a specialist is pushed to queue', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const onQueued = vi.fn()
      const queue = new SpecialistQueue(1, spawnFn, [], { onQueued })
      const teamId = TeamId('team-cb-1')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))  // fills slot
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))  // queued
      expect(onQueued).toHaveBeenCalledOnce()
      expect(onQueued).toHaveBeenCalledWith(ROOT, teamId, 's2', 'spawn', 0)
    })

    it('fires onPromoted when a queued entry is dequeued', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const onPromoted = vi.fn()
      const queue = new SpecialistQueue(1, spawnFn, [], { onPromoted })
      const teamId = TeamId('team-cb-2')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2'))

      const s1Id = SessionId('sid-cb-s1')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1))
      queue.onSpecialistSettled(s1Id)
      await vi.waitFor(() => expect(onPromoted).toHaveBeenCalledOnce())
      expect(onPromoted).toHaveBeenCalledWith(ROOT, teamId, 's2')
    })

    it('fires onCancelled when a queued signal aborts', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const onCancelled = vi.fn()
      const queue = new SpecialistQueue(1, spawnFn, [], { onCancelled })
      const teamId = TeamId('team-cb-3')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      const ctrl = new AbortController()
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', ctrl.signal))
      ctrl.abort()
      expect(onCancelled).toHaveBeenCalledOnce()
      expect(onCancelled).toHaveBeenCalledWith(ROOT, teamId, 's2')
    })

    it('fires onFinished when an active specialist session disposes', async () => {
      const resolvers: Array<(value: SpawnTeammateResult) => void> = []
      const spawnFn = vi.fn().mockImplementation(() =>
        new Promise<SpawnTeammateResult>((resolve) => { resolvers.push(resolve) }),
      )
      const onFinished = vi.fn()
      const queue = new SpecialistQueue(2, spawnFn, [], { onFinished })
      const teamId = TeamId('team-cb-4')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))
      const s1Id = SessionId('sid-cb4-s1')
      resolvers[0]!({ member: { ...fakeView('s1'), id: s1Id } })
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1))

      queue.onSpecialistSettled(s1Id)
      expect(onFinished).toHaveBeenCalledOnce()
      expect(onFinished).toHaveBeenCalledWith(ROOT, teamId, 's1')
    })

    it('does not fire onQueued for a pre-aborted signal', () => {
      const spawnFn = vi.fn().mockReturnValue(new Promise(() => undefined))
      const onQueued = vi.fn()
      const queue = new SpecialistQueue(1, spawnFn, [], { onQueued })
      const teamId = TeamId('team-cb-5')

      queue.startOrQueue(ROOT, teamId, fakeRequest('s1'))  // fills slot

      // Add s2 with an already-aborted signal
      const ctrl = new AbortController()
      ctrl.abort()
      queue.startOrQueue(ROOT, teamId, fakeRequest('s2', ctrl.signal))
      expect(onQueued).not.toHaveBeenCalled()
    })
  })
})
