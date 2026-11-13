/** Endpoint placement ranks configured llama.cpp targets and probes them read-only. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import DefaultModel from '../src/index.ts'
import { decidePlacement, probeEndpoint } from '../src/placement.ts'
import type { PlacementTarget } from '../src/placement.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const MODEL = '/models/Qwen3.8-27B-Uncensored-Q8_0.gguf'
const TI: PlacementTarget = { provider: 'qwen-local', endpoint: 'http://127.0.0.1:8001' }
const G: PlacementTarget = { provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002' }
const TARGETS = [TI, G] as const

interface Route { status?: number; body?: unknown }

/** Fetch stub keyed by origin+path; unknown routes reject like a refused connection. */
function fetchStub(routes: Map<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const route = routes.get(`${url.origin}${url.pathname}`)
    if (route === undefined) throw new TypeError('fetch failed')
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function endpointRoutes(origin: string, overrides: { busy?: boolean; model?: string; health?: number; slots?: Route } = {}): Map<string, Route> {
  const routes = new Map<string, Route>()
  routes.set(`${origin}/health`, { body: { status: 'ok' }, ...(overrides.health === undefined ? {} : { status: overrides.health }) })
  if (overrides.slots === undefined) routes.set(`${origin}/slots`, { body: [{ id: 1, is_processing: overrides.busy ?? false }] })
  else routes.set(`${origin}/slots`, overrides.slots)
  if (overrides.model === undefined) routes.set(`${origin}/v1/models`, { body: { data: [{ id: MODEL }] } })
  else if (overrides.model === null) routes.delete(`${origin}/v1/models`)
  else routes.set(`${origin}/v1/models`, { body: { data: [{ id: overrides.model }] } })
  return routes
}

afterEach(() => vi.unstubAllGlobals())

describe('probeEndpoint', () => {
  it('observes a running endpoint serving the model with a free slot', async () => {
    const state = await probeEndpoint(TI, 50, fetchStub(endpointRoutes('http://127.0.0.1:8001')))
    expect(state).toEqual({ state: 'running', modelPath: MODEL, busy: false, busyUnknown: false })
  })

  it('marks an unreachable endpoint stopped with the failure explanation', async () => {
    const state = await probeEndpoint(TI, 50, fetchStub(new Map()))
    expect(state.state).toBe('stopped')
    expect(state.error).toBe('fetch failed')
    expect(state.busyUnknown).toBeUndefined()
  })

  it('marks a failing health endpoint unhealthy with unknown busy state', async () => {
    const state = await probeEndpoint(TI, 50, fetchStub(endpointRoutes('http://127.0.0.1:8001', { health: 500 })))
    expect(state.state).toBe('unhealthy')
    expect(state.busyUnknown).toBe(true)
    expect(state.error).toContain('HTTP 500')
  })

  it('keeps an unreadable slot list as unknown busy state with an error', async () => {
    const state = await probeEndpoint(TI, 50, fetchStub(endpointRoutes('http://127.0.0.1:8001', { slots: { status: 500 } })))
    expect(state).toEqual({ state: 'running', modelPath: MODEL, busyUnknown: true, error: 'HTTP 500 from /slots' })
  })

  it('classifies a timed-out health probe as unhealthy, not stopped', async () => {
    const hang = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
      }))
    const state = await probeEndpoint(TI, 20, hang)
    expect(state.state).toBe('unhealthy')
    expect(state.busyUnknown).toBe(true)
    expect(state.error).toMatch(/timeout|aborted/i)
  })
})

describe('decidePlacement', () => {
  const free = { state: 'running' as const, modelPath: MODEL, busy: false, busyUnknown: false }
  const busy = { state: 'running' as const, modelPath: MODEL, busy: true, busyUnknown: false }
  const unknown = { state: 'running' as const, modelPath: MODEL, busyUnknown: true }
  const stopped = { state: 'stopped' as const, error: 'fetch failed' }
  const wrongModel = { state: 'running' as const, modelPath: 'other', busy: false, busyUnknown: false }

  it('prefers the first target when both endpoints serve the model free', () => {
    expect(decidePlacement(TARGETS, [free, free], MODEL, 'static').provider).toBe('qwen-local')
  })

  it('moves eligible work to the second endpoint while the first processes', () => {
    expect(decidePlacement(TARGETS, [busy, free], MODEL, 'static').provider).toBe('qwen-local-3090')
  })

  it('prefers the known-free endpoint over one whose slot state is unreadable', () => {
    expect(decidePlacement(TARGETS, [unknown, free], MODEL, 'static').provider).toBe('qwen-local-3090')
  })

  it('places on an unknown-slot endpoint before declaring it busy', () => {
    expect(decidePlacement(TARGETS, [busy, unknown], MODEL, 'static').provider).toBe('qwen-local-3090')
  })

  it('falls back to the static provider with full evidence when no target is eligible', () => {
    const decision = decidePlacement(TARGETS, [stopped, wrongModel], MODEL, 'static')
    expect(decision.provider).toBe('static')
    expect(decision.evidence).toEqual([stopped, wrongModel])
  })
})

describe('placedSelection', () => {
  async function service(config: Record<string, unknown>) {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const live = await liveConfig(ctx, DefaultModel, { provider: 'qwen-local', model: MODEL, ...config })
    return { ctx, live }
  }

  it('returns the static default unprobed without placement configuration', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { ctx } = await service({})
    await expect(ctx.agentDefaultModel.placedSelection()).resolves.toEqual({ provider: 'qwen-local', model: MODEL })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('places the default on the first eligible target, RTX 3090 Ti before RTX 3090', async () => {
    vi.stubGlobal('fetch', fetchStub(new Map([
      ...endpointRoutes('http://127.0.0.1:8001'),
      ...endpointRoutes('http://127.0.0.1:8002'),
    ])))
    const { ctx, live } = await service({})
    await live.update({ placement: [...TARGETS] })
    const placed = await ctx.agentDefaultModel.placedSelection()
    expect(placed.provider).toBe('qwen-local')
    expect(placed.model).toBe(MODEL)
  })

  it('routes around a busy RTX 3090 Ti to a free RTX 3090 serving the same model', async () => {
    vi.stubGlobal('fetch', fetchStub(new Map([
      ...endpointRoutes('http://127.0.0.1:8001', { busy: true }),
      ...endpointRoutes('http://127.0.0.1:8002'),
    ])))
    const { ctx, live } = await service({})
    await live.update({ placement: [...TARGETS] })
    const placed = await ctx.agentDefaultModel.placedSelection()
    expect(placed.provider).toBe('qwen-local-3090')
    expect(placed.model).toBe(MODEL)
  })

  it('keeps the static provider when every target is ineligible so the request fails loudly', async () => {
    vi.stubGlobal('fetch', fetchStub(new Map([
      ...endpointRoutes('http://127.0.0.1:8001', { busy: true }),
      ...endpointRoutes('http://127.0.0.1:8002', { model: 'other' }),
    ])))
    const { ctx, live } = await service({})
    await live.update({ placement: [...TARGETS] })
    await expect(ctx.agentDefaultModel.placedSelection()).resolves.toEqual({ provider: 'qwen-local', model: MODEL })
  })
})
