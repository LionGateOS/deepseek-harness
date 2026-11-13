import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { renderPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/src/model-selection-settings.ts'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { serialize } from '@deepseek-ai/dsh-llm-deepseek/src/serialize.ts'
import type { GenerateOptions, LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

function serializeRequest(request: GenerateOptions) {
  const connection = resolveAdapterOptions({ models: [{ id: request.model, systemPromptUpdate: 'in-history' }] })
  return serialize(request, connection, request.messages, new Map(), () => undefined)
}

function runtimeContextText(request: GenerateOptions) {
  const context = request.messages.findLast(message => message.source?.kind === 'runtime-context')
  return context?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

const SIGNAL = new AbortController().signal
const TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
].sort()

const roots: string[] = []
const contexts = new Set<Context>()
let callNumber = 0

/** Session query implementation whose search faces are outside these tests. */
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

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  legacyControl = false,
  selectionConfig?: { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> },
) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  if (legacyControl) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  // Load the selection config before the Lead so the policy is captured at composition time.
  if (selectionConfig !== undefined) await ctx.plugin(SubagentModelSelectionConfig, selectionConfig)
  const fiber = await ctx.plugin(toolTeam)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('tool-team-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, fiber, adapter }
}

async function setupWithReasoning(
  script: ConstructorParameters<typeof MockAdapter>[0],
  reasoning: LlmModelReasoningInfo,
  selectionConfig?: { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> },
) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  // Load the selection config before the Lead so the policy is captured at composition time.
  if (selectionConfig !== undefined) await ctx.plugin(SubagentModelSelectionConfig, selectionConfig)
  const fiber = await ctx.plugin(toolTeam)
  const adapter = new MockAdapter(script, reasoning)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('tool-team-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, fiber, adapter }
}

function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: ToolCallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function spawnedChildId(ctx: Context, lead: Agent, result: Awaited<ReturnType<typeof execute>>): SessionId {
  const parsed = JSON.parse(text(result)) as { member: { target: string } }
  const member = ctx.agentTeams.listMembers(lead).find(member => member.name === parsed.member.target)
  if (member === undefined) throw new Error('spawn_teammate target has no roster member')
  return member.id
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return ctx.systemPrompt.assemble({ scope })
}

async function runTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    return child!
  }, { timeout: 5_000 })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

describe('dsh-tool-team', () => {
  it.each(['running', 'inactive', 'provisioning', 'failed'] as const)(
    'projects %s members consistently in creation, listing, and schemas', async (status) => {
      const { ctx, lead } = await setup([])
      const member = {
        id: SessionId('private-member-session'), name: 'reviewer', role: 'teammate' as const,
        status, description: 'review changes', diagnostics: [],
      }
      vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockResolvedValue({ member })
      vi.spyOn(ctx.agentTeams, 'listMembers').mockReturnValue([member])
      const expected = {
        target: 'reviewer', role: 'teammate', status,
        description: 'review changes', diagnostics: [],
      }
      const spawned = await execute(ctx, lead, 'spawn_teammate', {
        name: 'reviewer', description: 'review changes', prompt: 'review',
      })
      const listed = await execute(ctx, lead, 'list_agents', {})
      expect(spawned.isError).toBe(false)
      expect(listed.isError).toBe(false)
      expect(JSON.parse(text(spawned))).toEqual({ member: expected })
      expect(JSON.parse(text(listed))).toEqual([expected])
      const scope = scopeOf(lead.ctx)
      const spawnSchema = ctx.tools.get('spawn_teammate', scope)?.output.schema.properties?.member
      const listSchema = ctx.tools.get('list_agents', scope)?.output.schema.items
      for (const schema of [spawnSchema, listSchema]) {
        expect(schema?.properties).toHaveProperty('target')
        expect(schema?.properties).not.toHaveProperty('id')
        expect(schema?.properties).not.toHaveProperty('name')
        expect(schema?.properties?.status?.enum).toEqual(['running', 'inactive', 'provisioning', 'failed'])
      }
      expect(ctx.agentTeams.listMembers(lead)).toEqual([member])
    },
  )

  it.each(['running', 'inactive'] as const)('returns interrupted %s status', async (previousStatus) => {
    const { ctx, lead } = await setup([])
    const interrupt = vi.spyOn(ctx.agentTeams, 'interrupt').mockReturnValue({ previousStatus })
    const result = await execute(ctx, lead, 'interrupt_agent', { target: 'reviewer' })
    expect(JSON.parse(text(result))).toEqual({ previousStatus })
    expect(interrupt).toHaveBeenCalledWith(lead, 'reviewer')
  })

  it('omits interrupt tools and guidance for Leads and new teammates when disabled', async () => {
    const { ctx, lead, fiber } = await setup(['hang'])
    await fiber.dispose()
    await ctx.plugin(toolTeam, { interrupt: false })
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'worker', description: 'stay active', prompt: 'wait',
    })
    expect(spawned.isError, text(spawned)).toBe(false)
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)
    for (const agent of [lead, child]) {
      const assembled = await assembly(ctx, agent)
      expect(assembled.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
        .toEqual(TOOL_NAMES.filter(name => name !== 'interrupt_agent'))
      expect(renderPrompt(assembled)).not.toContain('interrupt_agent')
      const result = await execute(ctx, agent, 'interrupt_agent', { target: 'worker' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('unknown tool "interrupt_agent"')
    }
    expect(child.status).toBe('running')
    expect((await execute(ctx, lead, 'list_agents', {})).isError).toBe(false)
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'running' })
    await waitNoAgent(ctx, childId)
  })

  it('uses returned targets for messages, interruption, and task assignment', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review changes', prompt: 'wait for work',
    })
    const { member } = JSON.parse(text(spawned)) as { member: { target: string } }
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)
    expect(member).not.toHaveProperty('id')
    expect(member).not.toHaveProperty('name')
    const listed = JSON.parse(text(await execute(ctx, lead, 'list_agents', {}))) as Array<{ target: string }>
    expect(listed.map(row => row.target)).toEqual(['lead', member.target])
    const created = await execute(ctx, lead, 'team_task_create', { subject: 'review', description: 'review changes' })
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    const assigned = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id, expected_revision: task.revision, action: 'reassign', owner: member.target,
    })
    expect(assigned.isError).toBe(false)
    expect(JSON.parse(text(assigned))).toMatchObject({ ownerName: member.target })
    const tasks = await execute(ctx, lead, 'team_task_list', { owner: listed[1]!.target })
    expect(JSON.parse(text(tasks))).toMatchObject({ tasks: [{ id: task.id, ownerName: member.target }] })
    const sent = await execute(ctx, lead, 'send_message', { target: member.target, message: 'review the diff' })
    expect(sent.isError).toBe(false)
    expect(JSON.parse(text(sent))).toEqual({ sent: true })
    const interrupted = await execute(ctx, lead, 'interrupt_agent', { target: listed[1]!.target })
    expect(interrupted.isError).toBe(false)
    await child.whenIdle()
    expect(child.status).toBe('idle')
    expect(ctx.agentTeams.interrupt(lead, member.target)).toEqual({ previousStatus: 'inactive' })
    const stored = await execute(ctx, lead, 'list_agents', {})
    expect(JSON.parse(text(stored))).toContainEqual(expect.objectContaining({ target: member.target, status: 'inactive' }))
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ id: childId, name: member.target, status: 'inactive' })
  })

  it('installs the complete scoped schema and shared-checkout policy for roots and teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const leadPrompt = renderPrompt(leadAssembly)
    expect(leadPrompt).toContain('Agent Teams is available in this session\n\n')
    expect(leadPrompt).toContain('FS_STALE_VERSION')
    expect(leadPrompt).toContain('Bash, formatters, code generators, and scripts are not fully protected')
    expect(leadPrompt).toContain('Task readiness never starts an owner')
    expect(leadPrompt).toContain('returns noProgress immediately')
    expect(leadPrompt).not.toContain('Your Team role')
    expect(renderContextSnapshot(leadAssembly)).toContain('You are the Team Lead named "lead".')

    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'tool-worker',
      description: 'exercise scoped tools',
      prompt: 'stay available',
    })
    expect(spawned.isError, text(spawned)).toBe(false)
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect(renderPrompt(childAssembly)).toBe(leadPrompt)
    expect(renderContextSnapshot(childAssembly)).toContain('You are teammate "tool-worker".')
    expect(childAssembly.contexts).toContainEqual(expect.objectContaining({ name: 'team:identity' }))
    const initialPrompt = child.session.snapshotEvents().find(event => event.type === 'user/message'
      && event.data.source.kind === 'user')
    expect(initialPrompt?.type === 'user/message'
      ? initialPrompt.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : []).toEqual(['stay available'])

    const denied = await execute(ctx, child, 'spawn_teammate', {
      name: 'nested', description: 'not allowed', prompt: 'no',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('only the Team Lead')
    await execute(ctx, lead, 'interrupt_agent', { target: 'tool-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it.each([
    ['fresh', undefined], ['fork', undefined], ['fork', 'in-history'],
  ] as const)('records %s teammate identity with update mode %s and keeps the wire prefix', async (mode, systemPromptUpdate) => {
    const { ctx, lead, adapter } = await setup([textResponse('parent answer'), textResponse('child answer')])
    if (systemPromptUpdate !== undefined) adapter.systemPromptUpdate = systemPromptUpdate
    await runTurn(lead, 'Parent task')
    const parentRequest = serializeRequest(adapter.requests[0]!)
    const parentHistory = structuredClone(lead.session.deriveMessages())
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review', prompt: 'Review the work', context: mode,
    })
    expect(spawned.isError, text(spawned)).toBe(false)
    const childId = spawnedChildId(ctx, lead, spawned)
    await waitNoAgent(ctx, childId)
    const childRequest = serializeRequest(adapter.requests[1]!)
    expect(childRequest.tools).toEqual(parentRequest.tools)
    expect(childRequest.system).toEqual(parentRequest.system)
    expect(childRequest.system).not.toContain('Your Team role')
    if (mode === 'fork') {
      expect(childRequest.messages.slice(0, parentRequest.messages.length)).toEqual(parentRequest.messages)
      expect(adapter.requests[1]!.messages.slice(0, parentHistory.length)).toEqual(parentHistory)
    } else {
      expect(JSON.stringify(childRequest.messages)).not.toContain('Parent task')
    }
    expect(runtimeContextText(adapter.requests[1]!)).toContain('You are teammate "reviewer".')
    expect(childRequest.messages.at(-1)?.content).toContainEqual({ type: 'text', text: 'Review the work' })
    await using persisted = await ctx.sessionPersistence.open(childId, 'read')
    const { events } = await persisted.read()
    const initial = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(initial?.type === 'user/message' ? initial.data.content : []).toEqual([
      { type: 'text', text: 'Review the work' },
    ])
  })

  it('reuses unchanged Lead identity in an ordinary Lead fork', async () => {
    const { ctx, lead, adapter } = await setup([textResponse('parent answer'), textResponse('fork answer')])
    await runTurn(lead, 'Parent task')
    const seed = lead.session.snapshotEvents()
    const childId = SessionId('ordinary-team-fork')
    const handle = await ctx.agents.create({
      sessionId: childId,
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      meta: { parentSession: lead.id, isSeeded: true },
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: SIGNAL,
    })
    await runTurn(handle.agent, 'Continue independently')
    const parentRequest = serializeRequest(adapter.requests[0]!)
    const childRequest = serializeRequest(adapter.requests[1]!)
    expect(childRequest.tools).toEqual(parentRequest.tools)
    expect(childRequest.messages.slice(0, parentRequest.messages.length)).toEqual(parentRequest.messages)
    expect(childRequest.messages.at(-1)?.content).toContainEqual({ type: 'text', text: 'Continue independently' })
    expect(JSON.stringify(childRequest.messages)).not.toContain('system-reminder')
    expect(handle.agent.session.snapshotEvents().slice(0, seed.length)).toEqual(seed)
    expect(ctx.agentTeams.listMembers(handle.agent).map(member => member.name)).toEqual(['lead'])
    await handle.dispose()
  })

  it.each([undefined, 'in-history'] as const)('appends current Lead identity to a teammate fork with update mode %s', async (systemPromptUpdate) => {
    const { ctx, lead, adapter } = await setup([textResponse('review done'), textResponse('lead notified'), textResponse('fork answer')])
    if (systemPromptUpdate !== undefined) adapter.systemPromptUpdate = systemPromptUpdate
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review', prompt: 'Review the work',
    })
    const teammateId = spawnedChildId(ctx, lead, spawned)
    await waitNoAgent(ctx, teammateId)
    await using persisted = await ctx.sessionPersistence.open(teammateId, 'read')
    const { events: seed } = await persisted.read()
    const handle = await ctx.agents.create({
      sessionId: SessionId('fork-from-teammate'),
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      meta: { parentSession: teammateId, isSeeded: true },
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: SIGNAL,
    })
    try {
      const inheritedHistory = structuredClone(handle.agent.session.deriveMessages())
      await runTurn(handle.agent, 'Continue independently')
      const original = serializeRequest(adapter.requests.find(request => request.sessionId === teammateId)!)
      const forkRequest = adapter.requests.find(request => request.sessionId === handle.agent.id)!
      const fork = serializeRequest(forkRequest)
      expect(fork.tools).toEqual(original.tools)
      expect(fork.messages.slice(0, original.messages.length)).toEqual(original.messages)
      expect(forkRequest.messages.slice(0, inheritedHistory.length)).toEqual(inheritedHistory)
      expect(fork.messages.at(-1)?.content).toContainEqual({ type: 'text', text: 'Continue independently' })
      expect(runtimeContextText(forkRequest)).toContain('You are the Team Lead named "lead".')
      expect(handle.agent.session.snapshotEvents().slice(0, seed.length)).toEqual(seed)
    } finally {
      await handle.dispose()
    }
  })

  it('restores compacted identity and does not repeat an unchanged retained snapshot', async () => {
    const { ctx, lead, adapter } = await setup([
      toolCallResponse('first-list', 'list_agents', {}),
      toolCallResponse('second-list', 'list_agents', {}),
      textResponse('done'),
    ])
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      if (step === 3) {
        const identity = agent.session.snapshotEvents().find(event => event.type === 'user/message'
          && event.data.source.kind === 'runtime-context')
        if (identity === undefined) throw new Error('expected teammate runtime context')
        agent.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'Compacted earlier context.' }],
          source: { kind: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', startSeq: identity.seq, endSeq: identity.seq },
          sourceEventSeqs: [identity.seq],
        })
      }
      return next()
    })
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review', prompt: 'Review the work',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    await waitNoAgent(ctx, childId)
    for (const request of adapter.requests.filter(request => request.sessionId === childId)) {
      const snapshots = request.messages.filter(message => message.source?.kind === 'runtime-context')
      expect(snapshots).toHaveLength(1)
      expect(runtimeContextText(request)).toContain('You are teammate "reviewer".')
    }
    await using persisted = await ctx.sessionPersistence.open(childId, 'read')
    const { events } = await persisted.read()
    expect(events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'runtime-context')).toHaveLength(2)
  })

  it.each(['reject', 'empty', 'abort'] as const)('does not revive a teammate step after %s', async (mode) => {
    const { ctx, lead, adapter } = await setup([])
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = await next()
      if (agent === lead) return decision
      if (mode === 'reject') return { kind: 'reject' }
      if (mode === 'abort') agent.cancel({ kind: 'user' })
      return { kind: 'enter', messages: [] }
    })
    await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review', prompt: 'Review the work',
    })
    const childId = SessionId(ctx.agentTeams.listMembers(lead).find(member => member.name === 'reviewer')!.id)
    await waitNoAgent(ctx, childId)
    expect(adapter.requests.filter(request => request.sessionId === childId)).toEqual([])
    await using persisted = await ctx.sessionPersistence.open(childId, 'read')
    const { events } = await persisted.read()
    expect(events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'user')).toEqual([])
  })

  it('keeps required Team identities when optional runtime context is suppressed', async () => {
    const { ctx, lead, adapter } = await setup([textResponse('worker done')])
    ctx.systemPrompt.suppressRuntimeContext()
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'reviewer', description: 'review', prompt: 'Review the work',
    })
    expect(spawned.isError, text(spawned)).toBe(false)
    await waitNoAgent(ctx, spawnedChildId(ctx, lead, spawned))
    expect(renderContextSnapshot(await assembly(ctx, lead))).toContain('You are the Team Lead named "lead".')
    expect(runtimeContextText(adapter.requests[0]!)).toContain('You are teammate "reviewer".')
  })

  it('returns actionable no-progress output and renders structured wait cancellation', async () => {
    const inactiveSetup = await setup([textResponse('worker done')])
    const inactiveSpawn = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'spawn_teammate', {
      name: 'inactive-worker', description: 'finish immediately', prompt: 'finish',
    })
    const inactiveId = spawnedChildId(inactiveSetup.ctx, inactiveSetup.lead, inactiveSpawn)
    await waitNoAgent(inactiveSetup.ctx, inactiveId)
    const noProgress = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms: 3_600_000 })
    expect(noProgress.isError).toBe(false)
    expect(JSON.parse(text(noProgress))).toEqual({
      timedOut: false,
      noProgress: {
        reason: 'no-active-peer',
        message: 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.',
      },
    })
    for (const timeout_ms of [9_999, 3_600_001, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('timeoutMs must be an integer from 10000 through 3600000')
    }

    const activeSetup = await setup(['hang'])
    const activeSpawn = await execute(activeSetup.ctx, activeSetup.lead, 'spawn_teammate', {
      name: 'active-worker', description: 'stay active', prompt: 'wait',
    })
    const activeId = spawnedChildId(activeSetup.ctx, activeSetup.lead, activeSpawn)
    await waitRunning(activeSetup.ctx, activeId)
    const controller = new AbortController()
    const waiting = execute(activeSetup.ctx, activeSetup.lead, 'wait_agent', { timeout_ms: 10_000 }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort({ kind: 'user' })
    const aborted = await waiting
    expect(aborted.isError).toBe(true)
    expect(text(aborted)).toBe("Error: wait_agent aborted: { kind: 'user' }")
    await execute(activeSetup.ctx, activeSetup.lead, 'interrupt_agent', { target: 'active-worker' })
    await waitNoAgent(activeSetup.ctx, activeId)
  })

  it('adapts roster, mailbox, wait, and task CAS operations to canonical JSON', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('lead received wakeup')])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'json-worker', description: 'json worker', prompt: 'wait', context: 'fresh',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)

    const roster = await execute(ctx, child, 'list_agents', {})
    expect(JSON.parse(text(roster))).toMatchObject([
      { target: 'lead', role: 'lead' },
      { target: 'json-worker', role: 'teammate' },
    ])
    // Every Team result reaches the model as compact JSON: indentation would
    // spend tokens on every roster, task, and receipt without adding meaning.
    expect(text(roster)).toBe(JSON.stringify(JSON.parse(text(roster))))
    const peer = await execute(ctx, child, 'send_message', { target: 'lead', message: 'progress report' })
    expect(peer.isError).toBe(false)
    expect(JSON.parse(text(peer))).toEqual({ sent: true })
    const followup = await execute(ctx, child, 'send_message', { target: 'lead', message: 'review the report' })
    expect(followup.isError).toBe(false)
    expect(JSON.parse(text(followup))).toEqual({ sent: true })
    await lead.whenIdle()

    const created = await execute(ctx, lead, 'team_task_create', {
      subject: 'tool task',
      description: 'created through tool',
      blocked_by: [],
      write_scopes: ['src/team'],
    })
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    const listed = await execute(ctx, child, 'team_task_list', { ready: true, limit: 1 })
    expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ id: task.id, ready: true }] })
    const read = await execute(ctx, child, 'team_task_get', { task_id: task.id })
    expect(JSON.parse(text(read))).toMatchObject({ id: task.id, revision: 1 })
    const claimed = await execute(ctx, child, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'claim',
    })
    expect(JSON.parse(text(claimed))).toMatchObject({ status: 'in_progress', ownerName: 'json-worker' })
    const stale = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'delete',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task')

    const wait = execute(ctx, lead, 'wait_agent', { timeout_ms: 10_000 })
    const completedCall = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, child, 'team_task_update', {
          task_id: task.id,
          expected_revision: 2,
          action: 'complete',
        }).then(resolve, reject)
      }, 0)
    })
    await expect(wait).resolves.toMatchObject({ isError: false })
    expect((await completedCall).isError).toBe(false)

    const childInterrupt = await execute(ctx, child, 'interrupt_agent', { target: 'json-worker' })
    expect(childInterrupt.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'json-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts optional task filters, mutations, pagination, and default waiting', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'fork-worker', description: 'fork worker', prompt: 'stay active', context: 'fork',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    await waitRunning(ctx, childId)

    const firstResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'first', description: 'first task',
    })
    const secondResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'second', description: 'second task',
    })
    const first = JSON.parse(text(firstResult)) as { id: string; revision: number }
    const second = JSON.parse(text(secondResult)) as { id: string; revision: number }
    const claimed = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id, expected_revision: first.revision, action: 'claim',
    })
    const claim = JSON.parse(text(claimed)) as { revision: number }

    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      status: 'in_progress', owner: 'lead', cursor: 0, limit: 1,
    })))).toMatchObject({ tasks: [{ id: first.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      owner: 'unowned', limit: 1,
    })))).toMatchObject({ tasks: [{ id: second.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 0, limit: 1,
    })))).toMatchObject({ nextCursor: 1 })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 1,
    })))).not.toHaveProperty('nextCursor')
    expect((await execute(ctx, lead, 'team_task_list', { cursor: -1 })).isError).toBe(true)
    expect((await execute(ctx, lead, 'team_task_list', { limit: 101 })).isError).toBe(true)

    const edited = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: claim.revision,
      action: 'edit',
      subject: 'edited',
      description: 'edited description',
      write_scopes: ['src/team'],
    })
    const edit = JSON.parse(text(edited)) as { revision: number }
    const dependencies = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: edit.revision,
      action: 'set_dependencies',
      blocked_by: [second.id],
    })
    expect(dependencies.isError).toBe(false)
    const dependency = JSON.parse(text(dependencies)) as { revision: number }
    expect((await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: dependency.revision,
      action: 'reassign',
      owner: 'fork-worker',
    })).isError).toBe(true)

    const wait = execute(ctx, lead, 'wait_agent', {})
    const wake = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, lead, 'team_task_create', {
          subject: 'wake', description: 'wake default wait',
        }).then(resolve, reject)
      }, 0)
    })
    expect((await wait).isError).toBe(false)
    expect((await wake).isError).toBe(false)

    await execute(ctx, lead, 'interrupt_agent', { target: 'fork-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('removes and reinstalls every scoped registration across plugin HMR without stopping the child', async () => {
    const { ctx, lead, fiber } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'hmr-worker', description: 'hmr worker', prompt: 'wait',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)

    await fiber.dispose()
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect(ctx.agents.get(childId)).toBe(child)
    for (const agent of [lead, child]) {
      expect((await assembly(ctx, agent)).contexts.some(context => context.name === 'team:identity')).toBe(false)
    }

    const disabled = await ctx.plugin(toolTeam, { interrupt: false })
    for (const agent of [lead, child]) {
      const assembled = await assembly(ctx, agent)
      expect(assembled.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
        .toEqual(TOOL_NAMES.filter(name => name !== 'interrupt_agent'))
      expect(renderPrompt(assembled)).not.toContain('interrupt_agent')
    }
    expect(child.status).toBe('running')
    await disabled.dispose()

    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    await execute(ctx, lead, 'interrupt_agent', { target: 'hmr-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    await replacement.dispose()
  })

  it('shadows legacy global control names only inside Team member scopes', async () => {
    const { ctx, lead, fiber } = await setup([], true)
    const teamSchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(teamSchema)).toContain('target')
    expect(JSON.stringify(teamSchema)).not.toContain('subagent_id')

    await fiber.dispose()
    const legacySchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(legacySchema)).toContain('agent_id')
  })

  it('rolls back partial scoped installation after a same-scope collision', async () => {
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    lead.ctx.tools.register(defineContentToolFixture({
      name: 'spawn_teammate',
      description: 'intentional collision',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'collision' }] },
    }))

    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    const assembled = await assembly(ctx, lead)
    expect(assembled.tools.filter(schema => TOOL_NAMES.includes(schema.name)).map(schema => schema.name))
      .toEqual(['spawn_teammate'])
    expect(assembled.contexts.some(context => context.name === 'team:identity')).toBe(false)
  })

  it('resolves direct-apply defaults without Loader schema normalization', async () => {
    const { ctx, lead, fiber, adapter } = await setup([textResponse('ordinary child')])
    await fiber.dispose()
    toolTeam.apply(ctx, {})
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const ordinary = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: [{ type: 'text', text: 'finish' }], parent: lead },
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(ordinary.childId)).toBeUndefined() }, { timeout: 5_000 })
    const request = adapter.requests.find(request => request.sessionId === ordinary.childId)
    expect(request).toBeDefined()
    expect(JSON.stringify(request?.messages)).not.toContain('You are the Team Lead')
  })

  it.each([true, false])('reinstalls Team scope with interrupt=%s before a cold-resumed request', async (interrupt) => {
    const { ctx, lead, adapter, fiber } = await setup([textResponse('first'), textResponse('lead received settlement'), 'hang'])
    await fiber.dispose()
    await ctx.plugin(toolTeam, { interrupt })
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'cold-worker', description: 'cold worker', prompt: 'finish once',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    expect(await ctx.subagents.listChildren(lead.id)).toContainEqual(expect.objectContaining({
      id: childId,
      mode: 'continuable',
    }))
    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.sessionId === lead.id)).toHaveLength(1)
    })
    await lead.whenIdle()

    const receipt = await ctx.agentTeams.sendMessage(lead, {
      target: 'cold-worker',
      content: [{ type: 'text', text: 'resume with Team scope' }],
      signal: SIGNAL,
    })
    expect(receipt.messageId).toEqual(expect.any(String))
    const resumed = await waitRunning(ctx, childId)
    expect((await assembly(ctx, resumed)).tools.map(schema => schema.name)
      .filter(name => TOOL_NAMES.includes(name)).sort()).toEqual(TOOL_NAMES.filter(name => interrupt || name !== 'interrupt_agent'))
    expect(renderPrompt(await assembly(ctx, resumed)).includes('interrupt_agent')).toBe(interrupt)
    expect(renderContextSnapshot(await assembly(ctx, resumed))).toContain('You are teammate "cold-worker".')
    const childRequests = () => adapter.requests.filter(request => request.messages.some(message => message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text.includes('You are teammate "cold-worker".'))))
    await vi.waitFor(() => { expect(childRequests()).toHaveLength(2) })
    const firstMessages = childRequests()[0]!.messages
    expect(childRequests()[1]!.messages.slice(0, firstMessages.length)).toEqual(firstMessages)
    expect(resumed.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'user')).toHaveLength(1)
    ctx.agentTeams.interrupt(lead, 'cold-worker')
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('fails safely without a calling Agent and has the function-plugin export shape', async () => {
    const { ctx } = await setup([])
    const result = await execute(ctx, undefined, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "list_agents"')
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-agent-team')
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'tools', 'systemPrompt', 'sessionProjections'])
  })

  it('uses configured fresh and fork provider names', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('custom')])
    await fiber.dispose()
    await ctx.plugin(SubagentSpawn, { providerName: 'team-fresh' })
    await ctx.plugin(toolTeam, { freshProvider: 'team-fresh', forkProvider: 'fork' })
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'custom-provider', description: 'custom provider', prompt: 'go',
    })
    expect(result.isError).toBe(false)
    const childId = spawnedChildId(ctx, lead, result)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ provider: 'team-fresh' })
  })

  describe('single-model multi-agent', () => {
    // These tests verify that multiple independent agent Sessions can use the
    // same provider/model route, demonstrating native single-model multi-agent
    // operation. All agents share one adapter instance; requests are handled
    // sequentially by the MockAdapter (one inference slot), establishing that
    // agent concurrency and inference concurrency are independent concerns.

    it('one lead and three teammates all use the same model; sessions and contexts are independent', async () => {
      // Three distinct text responses: one per teammate.
      const { ctx, lead, adapter } = await setup([
        textResponse('worker-1 task complete'),
        textResponse('worker-2 task complete'),
        textResponse('worker-3 task complete'),
      ])

      // Spawn three fresh teammates. All inherit the Lead's mock/mock route.
      const spawn1 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'worker-1', description: 'First worker', prompt: 'Complete task 1',
      })
      const spawn2 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'worker-2', description: 'Second worker', prompt: 'Complete task 2',
      })
      const spawn3 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'worker-3', description: 'Third worker', prompt: 'Complete task 3',
      })

      expect(spawn1.isError, text(spawn1)).toBe(false)
      expect(spawn2.isError, text(spawn2)).toBe(false)
      expect(spawn3.isError, text(spawn3)).toBe(false)

      const id1 = spawnedChildId(ctx, lead, spawn1)
      const id2 = spawnedChildId(ctx, lead, spawn2)
      const id3 = spawnedChildId(ctx, lead, spawn3)

      // All three are distinct sessions.
      expect(new Set([id1, id2, id3]).size).toBe(3)

      await waitNoAgent(ctx, id1)
      await waitNoAgent(ctx, id2)
      await waitNoAgent(ctx, id3)

      // All used the same model/provider as the Lead (single-model multi-agent).
      for (const id of [id1, id2, id3]) {
        const request = adapter.requests.find(r => r.sessionId === id)
        expect(request?.provider).toBe('mock')
        expect(request?.model).toBe('mock')
      }

      // Three separate LLM calls: one per teammate session.
      const childRequests = adapter.requests.filter(r =>
        r.sessionId === id1 || r.sessionId === id2 || r.sessionId === id3)
      expect(childRequests).toHaveLength(3)

      // Sessions are independent: each request carries a distinct session id.
      const sessionIds = childRequests.map(r => r.sessionId)
      expect(new Set(sessionIds).size).toBe(3)

      // Roster shows Lead + 3 teammates.
      const members = ctx.agentTeams.listMembers(lead)
      expect(members).toHaveLength(4)
      expect(members.map(m => m.name).sort()).toEqual(['lead', 'worker-1', 'worker-2', 'worker-3'])

      // Teammates ran on separate sessions with independent initial prompts.
      for (const [id, expected] of [[id1, 'Complete task 1'], [id2, 'Complete task 2'], [id3, 'Complete task 3']] as const) {
        const req = adapter.requests.find(r => r.sessionId === id)
        const userMessages = req?.messages.filter(m => m.role === 'user') ?? []
        expect(JSON.stringify(userMessages)).toContain(expected)
      }
    })

    it('shared task board is accessible to all three teammates on the same model', async () => {
      const { ctx, lead } = await setup([
        textResponse('task-1 done'),
        textResponse('task-2 done'),
        textResponse('task-3 done'),
      ])

      // Create three tasks before spawning teammates.
      const t1Result = await execute(ctx, lead, 'team_task_create', {
        subject: 'Task A', description: 'First task description',
      })
      const t2Result = await execute(ctx, lead, 'team_task_create', {
        subject: 'Task B', description: 'Second task description',
      })
      const t3Result = await execute(ctx, lead, 'team_task_create', {
        subject: 'Task C', description: 'Third task description',
      })
      expect(t1Result.isError).toBe(false)
      expect(t2Result.isError).toBe(false)
      expect(t3Result.isError).toBe(false)

      const t1 = JSON.parse(text(t1Result)) as { id: string; revision: number }
      const t2 = JSON.parse(text(t2Result)) as { id: string; revision: number }
      const t3 = JSON.parse(text(t3Result)) as { id: string; revision: number }

      // Spawn teammates.
      const s1 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'task-worker-a', description: 'Worker A', prompt: 'Handle Task A',
      })
      const s2 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'task-worker-b', description: 'Worker B', prompt: 'Handle Task B',
      })
      const s3 = await execute(ctx, lead, 'spawn_teammate', {
        name: 'task-worker-c', description: 'Worker C', prompt: 'Handle Task C',
      })
      expect(s1.isError, text(s1)).toBe(false)
      expect(s2.isError, text(s2)).toBe(false)
      expect(s3.isError, text(s3)).toBe(false)

      const id1 = spawnedChildId(ctx, lead, s1)
      const id2 = spawnedChildId(ctx, lead, s2)
      const id3 = spawnedChildId(ctx, lead, s3)

      // Lead assigns one task to each teammate (Lead-only reassign action).
      await execute(ctx, lead, 'team_task_update', {
        task_id: t1.id, expected_revision: t1.revision, action: 'reassign', owner: 'task-worker-a',
      })
      await execute(ctx, lead, 'team_task_update', {
        task_id: t2.id, expected_revision: t2.revision, action: 'reassign', owner: 'task-worker-b',
      })
      await execute(ctx, lead, 'team_task_update', {
        task_id: t3.id, expected_revision: t3.revision, action: 'reassign', owner: 'task-worker-c',
      })

      await waitNoAgent(ctx, id1)
      await waitNoAgent(ctx, id2)
      await waitNoAgent(ctx, id3)

      // Task board still shows the three pending tasks (teammates ran but no tool calls).
      const taskList = await execute(ctx, lead, 'team_task_list', {})
      const tasks = JSON.parse(text(taskList)) as { tasks: Array<{ subject: string; ownerName: string }> }
      expect(tasks.tasks).toHaveLength(3)
      expect(tasks.tasks.map(t => t.ownerName).sort()).toEqual(['task-worker-a', 'task-worker-b', 'task-worker-c'])

      // All five agents (Lead + 3 live teammates) are on the roster.
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(4)
    })

    it('send_message resumes an inactive teammate on the same model without a second server', async () => {
      // 'hang' keeps the agent in running state so waitRunning can observe it before
      // the turn completes — required because MockAdapter is synchronous.
      const { ctx, lead, adapter } = await setup([
        textResponse('initial task complete'),
        'hang',
      ])

      const spawn = await execute(ctx, lead, 'spawn_teammate', {
        name: 'resumable', description: 'Resumable worker', prompt: 'First task',
      })
      expect(spawn.isError, text(spawn)).toBe(false)
      const childId = spawnedChildId(ctx, lead, spawn)

      // After the first turn, wait for the second LLM request to arrive (first request).
      // This confirms the agent ran its initial turn.
      await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThanOrEqual(1) }, { timeout: 5_000 })
      await waitNoAgent(ctx, childId)

      // Teammate is inactive after completing its turn.
      const listAfter = JSON.parse(text(await execute(ctx, lead, 'list_agents', {}))) as Array<{ target: string; status: string }>
      expect(listAfter.find(m => m.target === 'resumable')?.status).toBe('inactive')

      // Lead resumes the teammate by sending a message.
      const receipt = await ctx.agentTeams.sendMessage(lead, {
        target: 'resumable',
        content: [{ type: 'text', text: 'Please resume work' }],
        signal: SIGNAL,
      })
      expect(receipt.messageId).toEqual(expect.any(String))
      const resumed = await waitRunning(ctx, childId)

      // Resumed teammate still uses the same model — no route switch, no new server.
      expect(resumed.options.model).toBe('mock')
      expect(resumed.options.provider).toBe('mock')

      // Verify: the second LLM call came from the same adapter and same model.
      const secondReq = adapter.requests.at(-1)!
      expect(secondReq.sessionId).toBe(childId)
      expect(secondReq.model).toBe('mock')

      ctx.agentTeams.interrupt(lead, 'resumable')
      await waitNoAgent(ctx, childId)
    }, 15_000)

    it('effort-only override on the inherited route is authorized without an allowlist entry', async () => {
      // The parent uses mock/mock. An effort-only override for a fresh teammate
      // inherits the same route and does NOT require mock/mock in the allowlist.
      // Model selection must still be enabled, but the allowlist is not consulted.
      // mock/mock is intentionally absent — effort-only does NOT consult the allowlist.
      const { ctx, lead, adapter } = await setupWithReasoning(
        [textResponse('effort child done')],
        { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('medium'), name: 'Medium' }] },
        { enabled: true, allowedModels: [{ provider: 'other', model: 'other-model' }] },
      )

      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'effort-fresh', description: 'effort fresh', prompt: 'go',
        reasoning_effort: 'low',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      const childReq = adapter.requests.find(r => r.sessionId === childId)
      expect(childReq?.reasoningEffort).toBe('low')
      expect(childReq?.model).toBe('mock') // inherited route
    })

    it('fork effort-only override is authorized; fork provider+model override is rejected', async () => {
      // Fork with effort-only: authorized even when mock/mock is absent from the allowlist.
      const { ctx, lead, adapter } = await setupWithReasoning([
        textResponse('parent turn'),
        textResponse('fork effort done'),
      ], { efforts: [{ id: ReasoningEffortId('medium'), name: 'Medium' }] },
      { enabled: true, allowedModels: [{ provider: 'other', model: 'other-model' }] })
      await runTurn(lead, 'parent work')

      const forkEffort = await execute(ctx, lead, 'spawn_teammate', {
        name: 'fork-effort', description: 'fork with effort', prompt: 'continue',
        context: 'fork', reasoning_effort: 'medium',
      })
      expect(forkEffort.isError, text(forkEffort)).toBe(false)
      const forkId = spawnedChildId(ctx, lead, forkEffort)
      await waitNoAgent(ctx, forkId)

      // The fork ran under the parent's model route.
      const forkReq = adapter.requests.find(r => r.sessionId === forkId)
      expect(forkReq?.model).toBe('mock')
      expect(forkReq?.reasoningEffort).toBe('medium')

      // Fork with route change: rejected before the auth gate, regardless of allowlist.
      const forkRoute = await execute(ctx, lead, 'spawn_teammate', {
        name: 'fork-route', description: 'fork with route change', prompt: 'go',
        context: 'fork', provider: 'mock', model: 'mock-fast',
      })
      expect(forkRoute.isError).toBe(true)
      expect(text(forkRoute)).toContain('fork teammates inherit the parent route')
    })
  })

  describe('model selection', () => {
    const ALLOWED_ROUTES = [
      { provider: 'mock', model: 'mock' },
      { provider: 'mock', model: 'mock-fast' },
    ]

    /** Set up a context with model selection enabled, using the ALLOWED_ROUTES list. */
    async function setupWithSelection(script: ConstructorParameters<typeof MockAdapter>[0]) {
      return setup(script, false, { enabled: true, allowedModels: ALLOWED_ROUTES })
    }

    it('existing spawn without model selection fields uses pure parent inheritance (test #1)', async () => {
      const { ctx, lead } = await setup([textResponse('child done')])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'no-selection', description: 'no selection', prompt: 'go',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      // Child should have inherited the Lead's route.
      expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ name: 'no-selection' })
    })

    it('fresh teammate receives authorized provider and model (test #2)', async () => {
      const { ctx, lead, adapter } = await setupWithSelection([textResponse('authorized child')])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'authorized', description: 'authorized model', prompt: 'go',
        provider: 'mock', model: 'mock-fast',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      // Child ran under the selected route — verified via the LLM adapter request.
      const childRequest = adapter.requests.find(r => r.sessionId === childId)
      expect(childRequest?.model).toBe('mock-fast')
    })

    it('explicit reasoning effort is forwarded to the child (test #3)', async () => {
      // Register a separate provider that declares reasoning-effort support.
      // Selection config is loaded before the Lead so the policy is captured at composition time.
      const { ctx, lead } = await setup([], false, {
        enabled: true,
        allowedModels: [{ provider: 'mock-reasoning-provider', model: 'mock' }],
      })
      const reasoningAdapter = new MockAdapter([textResponse('effort child')], {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('medium'), name: 'Medium' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      })
      ctx.llm.registerAdapter(['mock-reasoning-provider'], reasoningAdapter)
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'effort-worker', description: 'with effort', prompt: 'go',
        provider: 'mock-reasoning-provider', model: 'mock', reasoning_effort: 'low',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      const childRequest = reasoningAdapter.requests.find(r => r.sessionId === childId)
      expect(childRequest?.reasoningEffort).toBe('low')
    })

    it('changed model without reasoning effort uses selected model default (test #4)', async () => {
      // Lead has no reasoningEffort; child route changes to mock-fast with no effort.
      // resolveChildAgentOptions clears inherited effort on route change, so none is passed.
      const { ctx, lead, adapter } = await setupWithSelection([textResponse('fast child')])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'fast-worker', description: 'fast model', prompt: 'go',
        provider: 'mock', model: 'mock-fast',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      const childRequest = adapter.requests.find(r => r.sessionId === childId)
      expect(childRequest?.model).toBe('mock-fast')
      // No explicit reasoning effort was forwarded.
      expect(childRequest?.reasoningEffort).toBeUndefined()
    })

    it('unauthorized provider/model is rejected before provisioning (test #5)', async () => {
      const { ctx, lead } = await setupWithSelection([])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'blocked', description: 'unlisted route', prompt: 'go',
        provider: 'mock', model: 'unlisted-model',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not allowed for this Session')
      // No roster entry created.
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    })

    it('provider without model (incomplete route) is rejected (test #6)', async () => {
      const { ctx, lead } = await setupWithSelection([])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'incomplete', description: 'incomplete route', prompt: 'go',
        provider: 'mock',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('must be supplied together')
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    })

    it('model without provider (incomplete route) is rejected (test #6b)', async () => {
      const { ctx, lead } = await setupWithSelection([])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'incomplete-b', description: 'incomplete route b', prompt: 'go',
        model: 'mock',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('must be supplied together')
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    })

    it('disabled model selection cannot be bypassed (test #7)', async () => {
      // Service not loaded at all.
      const { ctx, lead } = await setup([])
      const noServiceResult = await execute(ctx, lead, 'spawn_teammate', {
        name: 'blocked-no-service', description: 'no service', prompt: 'go',
        provider: 'mock', model: 'mock',
      })
      expect(noServiceResult.isError).toBe(true)
      expect(text(noServiceResult)).toContain('disabled')
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)

      // Service loaded with enabled: false before the Lead so policy is captured at composition time.
      const { ctx: ctx2, lead: lead2 } = await setup([], false, { enabled: false, allowedModels: ALLOWED_ROUTES })
      const disabledResult = await execute(ctx2, lead2, 'spawn_teammate', {
        name: 'blocked-disabled', description: 'disabled', prompt: 'go',
        provider: 'mock', model: 'mock',
      })
      expect(disabledResult.isError).toBe(true)
      expect(text(disabledResult)).toContain('disabled')
      expect(ctx2.agentTeams.listMembers(lead2)).toHaveLength(1)
    })

    it('provider without agentOptions capability fails explicitly (test #8)', async () => {
      // Register a provider with agentOptions: false.
      const { ctx, lead, fiber } = await setup([])
      await fiber.dispose()
      ctx.subagents.registerProvider({
        name: 'no-agent-opts',
        capabilities: {
          agentOptions: false,
          agentPreset: false,
          outputSchema: false,
          depthLimit: false,
        } satisfies SubagentCapabilities,
        inheritsParentContext: false,
        async prepareContinuable() { return {} },
      })
      await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: ALLOWED_ROUTES })
      await ctx.plugin(toolTeam, { freshProvider: 'no-agent-opts', forkProvider: 'fork' })
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'capability-check', description: 'no agentOptions support', prompt: 'go',
        provider: 'mock', model: 'mock',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/UNSUPPORTED_CAPABILITY|capability/u)
    })

    it('fork without overrides inherits parent route (test #9)', async () => {
      const { ctx, lead, adapter } = await setup([textResponse('parent'), textResponse('fork child')])
      await runTurn(lead, 'parent work')
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'fork-inherits', description: 'fork inherits', prompt: 'continue',
        context: 'fork',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      const childRequest = adapter.requests.find(r => r.sessionId === childId)
      // Fork child runs under the same route as the Lead.
      expect(childRequest?.model).toBe(lead.options.model)
    })

    it('fork with provider/model override is rejected (test #10)', async () => {
      const { ctx, lead } = await setupWithSelection([])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'fork-override', description: 'fork route change', prompt: 'go',
        context: 'fork',
        provider: 'mock', model: 'mock-fast',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('fork teammates inherit the parent route')
      expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
    })

    it('durable resume of a fresh teammate retains selected child configuration (test #12)', async () => {
      const { ctx, lead } = await setupWithSelection([textResponse('first turn'), textResponse('woken up')])
      const result = await execute(ctx, lead, 'spawn_teammate', {
        name: 'persistent', description: 'route persisted', prompt: 'finish first',
        provider: 'mock', model: 'mock-fast',
      })
      expect(result.isError, text(result)).toBe(false)
      const childId = spawnedChildId(ctx, lead, result)
      await waitNoAgent(ctx, childId)
      // Resume the teammate via sendMessage (cold resume path).
      const receipt = await ctx.agentTeams.sendMessage(lead, {
        target: 'persistent',
        content: [{ type: 'text', text: 'wake up' }],
        signal: SIGNAL,
      })
      expect(receipt.messageId).toEqual(expect.any(String))
      const resumed = await waitRunning(ctx, childId)
      // Resumed child must still use the originally selected route.
      expect(resumed.options.model).toBe('mock-fast')
      ctx.agentTeams.interrupt(lead, 'persistent')
      await waitNoAgent(ctx, childId)
    })

    it('existing Task and roster behavior is unchanged by model selection code (test #13)', async () => {
      const { ctx, lead } = await setupWithSelection([textResponse('worker done')])
      const spawnResult = await execute(ctx, lead, 'spawn_teammate', {
        name: 'task-worker', description: 'task worker', prompt: 'do task',
      })
      expect(spawnResult.isError, text(spawnResult)).toBe(false)
      await waitNoAgent(ctx, spawnedChildId(ctx, lead, spawnResult))
      const task = await execute(ctx, lead, 'team_task_create', {
        subject: 'model-selection-task', description: 'task unchanged',
      })
      expect(task.isError).toBe(false)
      const listed = await execute(ctx, lead, 'team_task_list', {})
      expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ subject: 'model-selection-task' }] })
    })
  })
})

describe('delegation policy guidance', () => {
  it('presents specialists as optional and context-dependent rather than required', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('Specialists are optional tools, not a required step.')
    expect(policy).toContain('Start the smallest team that covers the work')
  })

  it('states the conditions under which delegation is worth its cost', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    for (const benefit of [
      'independently verifying finished work',
      'reviewing architecture or design',
      'auditing security or safety',
      'separating implementation from review',
      'separating research from synthesis',
      'investigating independent parts in parallel',
    ]) expect(policy).toContain(benefit)
  })

  it('states the conditions under which delegation wastes effort', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('trivial or single-step')
    expect(policy).toContain('describing the work costs more than doing it')
    expect(policy).toContain('duplicate work already underway')
    expect(policy).toContain('cannot be stated clearly and completely')
  })

  it('keeps task decomposition, result interpretation, and final synthesis with the Lead', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('As Team Lead you own the outcome')
    expect(policy).toContain('Decompose the task')
    expect(policy).toContain('write the final answer yourself')
    expect(policy).toContain('does not replace it')
  })

  it('requires a concrete assignment and denies that the assignment widens authority', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('acceptance criteria')
    expect(policy).toContain('`task` selects work and never widens a specialist')
    expect(policy).toContain('permissions, or route')
    expect(policy).toContain('requesting wider authority')
  })

  it('defers scheduling and route limits to the existing concurrency and model-selection policy', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('per-team concurrency cap and FIFO queue')
    expect(policy).toContain('session route and model-selection policy')
    expect(policy).toContain('only the Team Lead can start specialists')
  })

  it('rules out nested delegation and duplicate assignments', async () => {
    const { ctx, lead } = await setup(['hang'])
    const policy = renderPrompt(await assembly(ctx, lead))
    expect(policy).toContain('a teammate cannot start a specialist')
    expect(policy).toContain('do not start several specialists on the same assignment')
  })

  it('shares the delegation guidance with teammates without granting them specialist access', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'policy-worker', description: 'policy reader', prompt: 'wait',
    })
    const childId = spawnedChildId(ctx, lead, spawned)
    const child = await waitRunning(ctx, childId)
    expect(renderPrompt(await assembly(ctx, child))).toBe(renderPrompt(await assembly(ctx, lead)))
    const denied = await execute(ctx, child, 'spawn_specialist', { name: 'code-reviewer', task: 'review' })
    expect(denied.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'policy-worker' })
    await waitNoAgent(ctx, childId)
  })
})
