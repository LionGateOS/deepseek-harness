import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/src/model-selection-settings.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import TeamService from '../../agent-team/src/index.ts'
import type { SpecialistDefinition } from '../../agent-team/src/types.ts'
import * as toolTeam from '../src/index.ts'
import { recordOrchestrationMode } from '../src/orchestration-mode.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts = new Set<Context>()
let callNumber = 0

class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Eight seed specialists matching the catalog from cordis.patch.yml. */
const EIGHT_SPECIALISTS: SpecialistDefinition[] = [
  { name: 'requirements-analyst', description: 'Breaks down goals into specifications', prompt: 'You are a requirements analyst.' },
  { name: 'implementation-planner', description: 'Designs implementation plans', prompt: 'You are an implementation planner.' },
  { name: 'code-reviewer', description: 'Reviews code for correctness', prompt: 'You are a code reviewer.' },
  { name: 'test-author', description: 'Authors unit and integration tests', prompt: 'You are a test author.' },
  { name: 'documentation-writer', description: 'Writes technical documentation', prompt: 'You are a documentation writer.' },
  { name: 'security-auditor', description: 'Audits for security vulnerabilities', prompt: 'You are a security auditor.' },
  { name: 'performance-analyst', description: 'Profiles and optimizes performance', prompt: 'You are a performance analyst.' },
  { name: 'integration-verifier', description: 'Verifies component integration', prompt: 'You are an integration verifier.' },
]

async function setup(
  specialists: SpecialistDefinition[] = [],
  maxActiveSpecialists = 4,
  selectionConfig?: { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> },
  reasoning?: ConstructorParameters<typeof MockAdapter>[1],
) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-specialist-tools-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, { specialists, maxActiveSpecialists })
  if (selectionConfig !== undefined) await ctx.plugin(SubagentModelSelectionConfig, selectionConfig)
  await ctx.plugin(toolTeam)
  const adapter = new MockAdapter([], reasoning)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('specialist-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead }
}

function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: ToolCallId(`spec-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('list_specialists', () => {
  it('returns empty array when no specialists configured', async () => {
    const { ctx, lead } = await setup([])
    const result = await execute(ctx, lead, 'list_specialists', {})
    expect(result.isError).toBe(false)
    expect(JSON.parse(text(result))).toEqual([])
  })

  it('returns all 8 configured specialists with name and description', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS)
    const result = await execute(ctx, lead, 'list_specialists', {})
    expect(result.isError).toBe(false)
    const catalog = JSON.parse(text(result)) as Array<{ name: string; description: string }>
    expect(catalog).toHaveLength(8)
    for (const specialist of EIGHT_SPECIALISTS) {
      const entry = catalog.find(e => e.name === specialist.name)
      expect(entry).toBeDefined()
      expect(entry?.description).toBe(specialist.description)
    }
  })

  it('output omits prompt to avoid exposing implementation details to the model', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS)
    const result = await execute(ctx, lead, 'list_specialists', {})
    const catalog = JSON.parse(text(result)) as Array<Record<string, unknown>>
    for (const entry of catalog) {
      expect(entry).not.toHaveProperty('prompt')
    }
  })
})

describe('spawn_specialist', () => {
  it('rejects unknown specialist name with an error', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS)
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'nonexistent-specialist', task: 'Analyze the request.' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('nonexistent-specialist')
  })

  it('starts immediately when a slot is available', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'active',
      name: 'requirements-analyst',
      member: {
        id: SessionId('spec-session-1'),
        name: 'requirements-analyst',
        role: 'teammate',
        status: 'running',
        description: 'Breaks down goals into specifications',
        provider: 'spawn',
        context: 'fresh',
        diagnostics: [],
      },
    })
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'requirements-analyst', task: 'Analyze the request.' })
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(text(result)) as { status: string; name: string; member: unknown }
    expect(parsed.status).toBe('active')
    expect(parsed.name).toBe('requirements-analyst')
    expect(parsed.member).toBeDefined()
    expect(startSpy).toHaveBeenCalledWith(lead, expect.objectContaining({ name: 'requirements-analyst' }))
  })

  it('returns queued status when specialist cap is full', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'queued',
      name: 'code-reviewer',
      pending: 3,
    })
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'code-reviewer', task: 'Review the patch.' })
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(text(result)) as { status: string; name: string; pending?: number }
    expect(parsed.status).toBe('queued')
    expect(parsed.name).toBe('code-reviewer')
    expect(parsed.pending).toBe(3)
  })

  it('output has no member field when queued', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'queued',
      name: 'test-author',
    })
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'test-author', task: 'Write tests.' })
    const parsed = JSON.parse(text(result)) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('member')
  })

  it('output has no member id exposed (uses target from modelMember)', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'active',
      name: 'documentation-writer',
      member: {
        id: SessionId('spec-priv-session'),
        name: 'documentation-writer',
        role: 'teammate',
        status: 'running',
        description: 'Writes technical documentation',
        provider: 'spawn',
        context: 'fresh',
        diagnostics: [],
      },
    })
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'documentation-writer', task: 'Document the module.' })
    const parsed = JSON.parse(text(result)) as { member?: Record<string, unknown> }
    expect(parsed.member).toBeDefined()
    expect(parsed.member).not.toHaveProperty('id')
    expect(parsed.member).toHaveProperty('target', 'documentation-writer')
  })
})

describe('specialist scheduling proof: 8 catalog / 6 selected / maxActive=2', () => {
  it('dispatches exactly 2 immediately active and 4 queued across 6 spawn_specialist calls', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    recordOrchestrationMode(lead.session, 'off')

    // Track each call's resolution order
    let activeCount = 0
    let queuedCount = 0

    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist')
    startSpy.mockImplementation(async (_agent, req) => {
      if (activeCount < 2) {
        activeCount++
        return {
          status: 'active' as const,
          name: req.name,
          member: {
            id: SessionId(`spec-${req.name}`),
            name: req.name,
            role: 'teammate' as const,
            status: 'running' as const,
            description: 'test',
            provider: 'spawn',
            context: 'fresh' as const,
            diagnostics: [],
          },
        }
      }
      queuedCount++
      return { status: 'queued' as const, name: req.name, pending: queuedCount }
    })

    // Select 6 of 8 specialists (skip security-auditor and integration-verifier)
    const selectedNames = EIGHT_SPECIALISTS.slice(0, 6).map(s => s.name)
    const results = await Promise.all(
      selectedNames.map(name => execute(ctx, lead, 'spawn_specialist', { name, task: `Handle ${name} work.` })),
    )

    for (const result of results) {
      expect(result.isError).toBe(false)
    }

    const parsed = results.map(r => JSON.parse(text(r)) as { status: string; name: string })
    const active = parsed.filter(p => p.status === 'active')
    const queued = parsed.filter(p => p.status === 'queued')

    expect(active).toHaveLength(2)
    expect(queued).toHaveLength(4)
    expect(startSpy).toHaveBeenCalledTimes(6)
  })
})

describe('automatic specialist continuation gate', () => {
  it('requires a checkpoint after four AUTO starts', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockImplementation(async (_agent, req) => ({
      status: 'queued' as const, name: req.name, pending: 1,
    }))
    for (const specialist of EIGHT_SPECIALISTS.slice(0, 4)) {
      const result = await execute(ctx, lead, 'spawn_specialist', { name: specialist.name, task: `Handle ${specialist.name}.` })
      expect(result.isError, text(result)).toBe(false)
    }
    const blocked = await execute(ctx, lead, 'spawn_specialist', { name: EIGHT_SPECIALISTS[4]!.name, task: 'Needs checkpoint.' })
    expect(blocked.isError).toBe(true)
    expect(text(blocked)).toContain('wave 1 reached the four-specialist limit')
  })

  it('refuses a checkpoint until queued or working specialists have settled', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockImplementation(async (_agent, req) => ({
      status: 'queued' as const, name: req.name, pending: 1,
    }))
    const status = vi.spyOn(ctx.agentTeams, 'listSpecialistStatus').mockReturnValue({
      specialists: [
        { name: 'requirements-analyst', phase: 'working', provider: 'spawn' },
        { name: 'code-reviewer', phase: 'queued', position: 0, provider: 'spawn' },
      ],
    })

    expect((await execute(ctx, lead, 'spawn_specialist', {
      name: 'requirements-analyst',
      task: 'Inspect the boundary.',
    })).isError).toBe(false)

    const blocked = await execute(ctx, lead, 'specialist_checkpoint', {
      decision: 'continue',
      evidence: 'Partial findings exist but the wave is still active.',
    })
    expect(blocked.isError).toBe(true)
    expect(text(blocked)).toContain('wave 1 is not settled')
    expect(text(blocked)).toContain('requirements-analyst:working')
    expect(text(blocked)).toContain('code-reviewer:queued')

    status.mockReturnValue({
      specialists: [
        { name: 'requirements-analyst', phase: 'finished', provider: 'spawn' },
        { name: 'code-reviewer', phase: 'cancelled', provider: 'spawn' },
      ],
    })
    const accepted = await execute(ctx, lead, 'specialist_checkpoint', {
      decision: 'continue',
      evidence: 'The wave settled and exposed an unresolved integration boundary.',
    })
    expect(accepted.isError, text(accepted)).toBe(false)
    expect(JSON.parse(text(accepted))).toEqual({ decision: 'continue', wave: 1, nextWave: 2 })
  })

  it('opens one evidence-gated follow-up wave and never a third', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockImplementation(async (_agent, req) => ({
      status: 'queued' as const, name: req.name, pending: 1,
    }))
    expect((await execute(ctx, lead, 'spawn_specialist', { name: EIGHT_SPECIALISTS[0]!.name, task: 'Inspect risk.' })).isError).toBe(false)
    expect((await execute(ctx, lead, 'specialist_checkpoint', { decision: 'continue', evidence: '   ' })).isError).toBe(true)
    const checkpoint = await execute(ctx, lead, 'specialist_checkpoint', {
      decision: 'continue',
      evidence: 'Wave 1 found an unresolved integration boundary requiring independent verification.',
    })
    expect(checkpoint.isError, text(checkpoint)).toBe(false)
    expect(JSON.parse(text(checkpoint))).toEqual({ decision: 'continue', wave: 1, nextWave: 2 })
    expect((await execute(ctx, lead, 'spawn_specialist', { name: EIGHT_SPECIALISTS[1]!.name, task: 'Verify boundary.' })).isError).toBe(false)
    const third = await execute(ctx, lead, 'specialist_checkpoint', {
      decision: 'continue',
      evidence: 'Wave 2 found another question.',
    })
    expect(third.isError).toBe(true)
    expect(text(third)).toContain('third automatic specialist wave')
  })

  it('closes automatic delegation when the Lead chooses synthesis', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockImplementation(async (_agent, req) => ({
      status: 'queued' as const, name: req.name, pending: 1,
    }))
    expect((await execute(ctx, lead, 'spawn_specialist', { name: EIGHT_SPECIALISTS[0]!.name, task: 'Review.' })).isError).toBe(false)
    expect((await execute(ctx, lead, 'specialist_checkpoint', {
      decision: 'synthesize',
      evidence: 'Review complete; no unresolved issue justifies another wave.',
    })).isError).toBe(false)
    const blocked = await execute(ctx, lead, 'spawn_specialist', { name: EIGHT_SPECIALISTS[1]!.name, task: 'Do not start.' })
    expect(blocked.isError).toBe(true)
    expect(text(blocked)).toContain('continuation is closed')
  })

  it('keeps OFF manual delegation outside the automatic wave budget', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    recordOrchestrationMode(lead.session, 'off')
    vi.spyOn(ctx.agentTeams, 'startSpecialist').mockImplementation(async (_agent, req) => ({
      status: 'queued' as const, name: req.name, pending: 1,
    }))
    for (const specialist of EIGHT_SPECIALISTS.slice(0, 6)) {
      const result = await execute(ctx, lead, 'spawn_specialist', { name: specialist.name, task: `Manual ${specialist.name}.` })
      expect(result.isError, text(result)).toBe(false)
    }
    const checkpoint = await execute(ctx, lead, 'specialist_checkpoint', { decision: 'continue', evidence: 'not applicable' })
    expect(checkpoint.isError).toBe(true)
    expect(text(checkpoint)).toContain('OFF is owner-explicit manual delegation')
  })
})

describe('list_specialist_status', () => {
  it('returns empty array when no specialists have been started', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    vi.spyOn(ctx.agentTeams, 'listSpecialistStatus').mockReturnValue({ specialists: [] })
    const result = await execute(ctx, lead, 'list_specialist_status', {})
    expect(result.isError).toBe(false)
    expect(JSON.parse(text(result))).toEqual([])
  })

  it('returns queued, working, finished, and cancelled specialists', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    vi.spyOn(ctx.agentTeams, 'listSpecialistStatus').mockReturnValue({
      specialists: [
        { name: 'requirements-analyst', phase: 'working', provider: 'spawn' },
        { name: 'implementation-planner', phase: 'working', provider: 'spawn' },
        { name: 'code-reviewer', phase: 'queued', position: 0, provider: 'spawn' },
        { name: 'test-author', phase: 'queued', position: 1, provider: 'spawn' },
        { name: 'security-auditor', phase: 'cancelled', provider: 'spawn' },
        { name: 'integration-verifier', phase: 'finished', provider: 'spawn' },
      ],
    })
    const result = await execute(ctx, lead, 'list_specialist_status', {})
    expect(result.isError).toBe(false)
    const status = JSON.parse(text(result)) as Array<{
      name: string; phase: string; position?: number; provider?: string
    }>
    expect(status).toHaveLength(6)
    const working = status.filter(s => s.phase === 'working')
    const queued = status.filter(s => s.phase === 'queued')
    const cancelled = status.filter(s => s.phase === 'cancelled')
    const finished = status.filter(s => s.phase === 'finished')
    expect(working).toHaveLength(2)
    expect(queued).toHaveLength(2)
    expect(cancelled).toHaveLength(1)
    expect(finished).toHaveLength(1)
    // Position present only for queued entries
    for (const entry of queued) expect(typeof entry.position).toBe('number')
    for (const entry of [...working, ...cancelled, ...finished]) expect(entry.position).toBeUndefined()
  })

  it('output omits position for non-queued specialists', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    vi.spyOn(ctx.agentTeams, 'listSpecialistStatus').mockReturnValue({
      specialists: [
        { name: 'requirements-analyst', phase: 'working', provider: 'spawn' },
      ],
    })
    const result = await execute(ctx, lead, 'list_specialist_status', {})
    const status = JSON.parse(text(result)) as Array<Record<string, unknown>>
    expect(status[0]).not.toHaveProperty('position')
  })
})

describe('existing spawn_teammate unaffected', () => {
  it('spawn_teammate is still registered and functional alongside specialist tools', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 2)
    const spawnSpy = vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockResolvedValue({
      member: {
        id: SessionId('teammate-session'),
        name: 'analyst',
        role: 'teammate',
        status: 'running',
        description: 'test',
        provider: 'spawn',
        context: 'fresh',
        diagnostics: [],
      },
    })
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'analyst',
      description: 'test analyst',
      prompt: 'analyze this',
    })
    expect(result.isError).toBe(false)
    expect(spawnSpy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(text(result)) as { member: { target: string } }
    expect(parsed.member.target).toBe('analyst')
  })
})

describe('spawn_specialist task handoff', () => {
  it('forwards the concrete task to the Team service', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'active',
      name: 'security-auditor',
      member: {
        id: SessionId('task-handoff-session'),
        name: 'security-auditor',
        role: 'teammate',
        status: 'running',
        description: 'Audits for security vulnerabilities',
        provider: 'spawn',
        context: 'fresh',
        diagnostics: [],
      },
    })
    const result = await execute(ctx, lead, 'spawn_specialist', {
      name: 'security-auditor',
      task: 'Audit packages/experimental/agent-team for injection paths.',
    })
    expect(result.isError).toBe(false)
    expect(startSpy).toHaveBeenCalledWith(lead, expect.objectContaining({
      name: 'security-auditor',
      task: 'Audit packages/experimental/agent-team for injection paths.',
    }))
  })

  it('requires a task argument', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist')
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'code-reviewer' })
    expect(result.isError).toBe(true)
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('surfaces a rejected blank task as a tool error', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    const result = await execute(ctx, lead, 'spawn_specialist', { name: 'code-reviewer', task: '   ' })
    expect(result.isError).toBe(true)
  })
})


describe('spawn_specialist model routing', () => {
  it('inherits the Lead route when no specialist route override is requested', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4)
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'queued',
      name: 'code-reviewer',
      pending: 1,
    })

    const result = await execute(ctx, lead, 'spawn_specialist', {
      name: 'code-reviewer',
      task: 'Review the patch.',
    })

    expect(result.isError, text(result)).toBe(false)
    expect(startSpy).toHaveBeenCalledWith(lead, expect.not.objectContaining({ agentOptions: expect.anything() }))
  })

  it('forwards an explicitly allowed alternate provider/model route', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4, {
      enabled: true,
      allowedModels: [{ provider: 'mock', model: 'mock-fast' }],
    })
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'queued',
      name: 'requirements-analyst',
      pending: 1,
    })

    const result = await execute(ctx, lead, 'spawn_specialist', {
      name: 'requirements-analyst',
      task: 'Analyze the request.',
      provider: 'mock',
      model: 'mock-fast',
    })

    expect(result.isError, text(result)).toBe(false)
    expect(startSpy).toHaveBeenCalledWith(lead, expect.objectContaining({
      agentOptions: { provider: 'mock', model: 'mock-fast' },
    }))
  })

  it('rejects a disallowed provider/model route before starting a specialist', async () => {
    const { ctx, lead } = await setup(EIGHT_SPECIALISTS, 4, {
      enabled: true,
      allowedModels: [{ provider: 'mock', model: 'mock-fast' }],
    })
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist')

    const result = await execute(ctx, lead, 'spawn_specialist', {
      name: 'security-auditor',
      task: 'Audit the patch.',
      provider: 'mock',
      model: 'blocked-model',
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not allowed for this Session')
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('forwards a validated reasoning-only override while inheriting the Lead route', async () => {
    const { ctx, lead } = await setup(
      EIGHT_SPECIALISTS,
      4,
      {
        enabled: true,
        allowedModels: [{ provider: 'mock', model: 'mock' }],
      },
      { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] },
    )
    const startSpy = vi.spyOn(ctx.agentTeams, 'startSpecialist').mockResolvedValue({
      status: 'queued',
      name: 'test-author',
      pending: 1,
    })

    const result = await execute(ctx, lead, 'spawn_specialist', {
      name: 'test-author',
      task: 'Write focused tests.',
      reasoning_effort: 'low',
    })

    expect(result.isError, text(result)).toBe(false)
    expect(startSpy).toHaveBeenCalledWith(lead, expect.objectContaining({
      agentOptions: { reasoningEffort: ReasoningEffortId('low') },
    }))
  })
})
