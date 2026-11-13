/**
 * VS3C: durable OFF/AUTO/ON orchestration mode.
 *
 * The mode is durable session state owned by the Team tool plugin: `/orchestrate`
 * appends a plugin record, a projection folds it, and the `team:policy` section
 * renders the mode-specific delegation guidance. These tests cover the persisted
 * mode, the projection, the command, and the invariants a mode change must not
 * disturb.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import { subagentModelSelectionPolicy } from '@deepseek-ai/dsh-tool-subagent/src/model-selection-state.ts'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/src/model-selection-settings.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import TeamService from '../../agent-team/src/index.ts'
import type { SpecialistDefinition } from '../../agent-team/src/types.ts'
import * as toolTeam from '../src/index.ts'
import {
  DEFAULT_ORCHESTRATION_MODE,
  ORCHESTRATION_MODE_RECORD,
  orchestrationModeOf,
  orchestrationModeProjectionDefinition,
  parseOrchestrationMode,
  recordOrchestrationMode,
} from '../src/orchestration-mode.ts'
import type { OrchestrationMode } from '../src/orchestration-mode.ts'

const SIGNAL = new AbortController().signal
const TEAM_POLICY_PREFIX = 'Agent Teams is available in this session'
const roots: string[] = []
const contexts = new Set<Context>()
let callNumber = 0

const ONE_SPECIALIST: SpecialistDefinition[] = [
  { name: 'code-reviewer', description: 'Reviews code for correctness', prompt: 'You are a code reviewer.' },
]

/** Team tools that must stay mounted whatever the mode is. */
const TEAM_TOOLS = [
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
  'list_specialists',
  'list_specialist_status',
  'spawn_specialist',
].sort()

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

interface SetupOptions {
  /** Mount the command runtime so `/orchestrate` registers. */
  readonly commands?: boolean
  /** Mount the legacy subagent control surface, whose schemas must stay untouched. */
  readonly legacyControl?: boolean
  /** Mount the model-selection settings so Gate #4 has an active policy. */
  readonly selection?: { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> }
  /** Reuse an existing persistence root instead of creating one. */
  readonly storageRoot?: string
  /** Lead session id, so a resumed session's own id stays free. */
  readonly leadSessionId?: SessionId
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = options.storageRoot ?? mkdtempSync(join(tmpdir(), 'dsh-orchestration-mode-'))
  if (options.storageRoot === undefined) roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  if (options.legacyControl === true) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, { specialists: ONE_SPECIALIST, maxActiveSpecialists: 2 })
  if (options.selection !== undefined) await ctx.plugin(SubagentModelSelectionConfig, options.selection)
  await ctx.plugin(toolTeam)
  if (options.commands === true) await ctx.plugin(CommandRuntime)
  // 'hang' keeps a spawned teammate running so its rendered policy can be read.
  const adapter = new MockAdapter(['hang'])
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(
    options.leadSessionId ?? SessionId('orchestration-lead'),
    { provider: 'mock', model: 'mock' },
  )
  // The command registry resolves `ctx.inject` children asynchronously.
  await new Promise(resolve => setImmediate(resolve))
  return { ctx, lead, adapter, storageRoot }
}

function execute(ctx: Context, agent: Agent | undefined, name: string, args: unknown) {
  return ctx.tools.execute({
    callId: ToolCallId(`orchestration-call-${++callNumber}`),
    name,
    arguments: args,
    signal: SIGNAL,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

async function policyOf(ctx: Context, agent: Agent): Promise<string> {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return renderPrompt(await ctx.systemPrompt.assemble({ scope }))
}

/** Run one `/orchestrate` line against an agent and return its result. */
async function orchestrate(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], SIGNAL)
  if (execution === undefined) throw new Error(`command did not resolve: ${line}`)
  return execution.result
}

/** Durable mode records in one committed log. */
function modeRecords(events: readonly SessionEvent[]) {
  return events.flatMap(event => {
    const record = pluginRecordOf(event)
    return record?.type === ORCHESTRATION_MODE_RECORD ? [{ seq: record.seq, data: record.data }] : []
  })
}

/** Fold the projection definition directly, the way a resumed session rebuilds it. */
function foldMode(header: SessionHeader, events: readonly SessionEvent[]) {
  // Widen the literal to the registry contract so `init`/`apply` accept their
  // declared arguments; the definition itself stays `satisfies`-checked at source.
  const definition: ProjectionDefinition<'toolAgentTeamOrchestrationMode', OrchestrationMode> =
    orchestrationModeProjectionDefinition
  return events.reduce(
    (state, event) => definition.apply(state, event),
    definition.init(header, SessionLogOffset(0)),
  )
}

/** Spawn one teammate and wait until it is running. */
async function spawnRunningTeammate(ctx: Context, lead: Agent, name: string): Promise<Agent> {
  const spawned = await execute(ctx, lead, 'spawn_teammate', { name, description: `${name} probe`, prompt: 'wait' })
  expect(spawned.isError, text(spawned)).toBe(false)
  const parsed = JSON.parse(text(spawned)) as { member: { target: string } }
  const childId = ctx.agentTeams.listMembers(lead).find(member => member.name === parsed.member.target)?.id
  if (childId === undefined) throw new Error('spawn_teammate target has no roster member')
  return await vi.waitFor(() => {
    const running = ctx.agents.get(childId)
    expect(running?.status).toBe('running')
    return running!
  }, { timeout: 5_000 })
}

/** Interrupt one teammate and wait for it to leave the roster. */
async function retireTeammate(ctx: Context, lead: Agent, name: string): Promise<void> {
  const childId = ctx.agentTeams.listMembers(lead).find(member => member.name === name)?.id
  await execute(ctx, lead, 'interrupt_agent', { target: name })
  if (childId !== undefined) await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
}

describe('orchestration mode state', () => {
  it('defaults to AUTO for a Team that never selected a mode', async () => {
    const { ctx, lead } = await setup()
    expect(DEFAULT_ORCHESTRATION_MODE).toBe('auto')
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe('auto')
    // Absence of a selection IS the default mode, not a missing value.
    expect(modeRecords(lead.session.snapshotEvents())).toHaveLength(0)
    expect(await policyOf(ctx, lead)).toContain('Automatic specialist delegation is AUTO')
  })

  it.each(['off', 'auto', 'on'] as const)('persists and projects %s', async mode => {
    const { ctx, lead } = await setup({ commands: true })
    // Start from a different mode so every case exercises a real change; selecting
    // the mode already in force is the idempotent no-op covered separately.
    if (orchestrationModeOf(ctx.sessionProjections, lead.session) === mode) {
      await orchestrate(ctx, lead, mode === 'auto' ? '/orchestrate off' : '/orchestrate auto')
    }
    const before = modeRecords(lead.session.snapshotEvents()).length
    const result = await orchestrate(ctx, lead, `/orchestrate ${mode}`)
    expect(result.kind, JSON.stringify(result)).toBe('success')
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe(mode)
    const records = modeRecords(lead.session.snapshotEvents())
    expect(records).toHaveLength(before + 1)
    // One whole-value record carries the complete post-change mode.
    expect(records.at(-1)?.data).toEqual({ mode })
  })

  it('appends one record per change and keeps the last one authoritative', async () => {
    const { ctx, lead } = await setup({ commands: true })
    await orchestrate(ctx, lead, '/orchestrate off')
    await orchestrate(ctx, lead, '/orchestrate on')
    await orchestrate(ctx, lead, '/orchestrate auto')
    expect(modeRecords(lead.session.snapshotEvents()).map(record => record.data))
      .toEqual([{ mode: 'off' }, { mode: 'on' }, { mode: 'auto' }])
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe('auto')
  })

  it('reports the current mode through status and a bare invocation', async () => {
    const { ctx, lead } = await setup({ commands: true })
    expect(await orchestrate(ctx, lead, '/orchestrate status'))
      .toEqual({ kind: 'success', text: 'Orchestration mode is auto.' })
    await orchestrate(ctx, lead, '/orchestrate on')
    expect(await orchestrate(ctx, lead, '/orchestrate status'))
      .toEqual({ kind: 'success', text: 'Orchestration mode is on.' })
    expect(await orchestrate(ctx, lead, '/orchestrate'))
      .toEqual({ kind: 'success', text: 'Orchestration mode is on.' })
  })

  it('rejects an unknown mode without changing the durable state', async () => {
    const { ctx, lead } = await setup({ commands: true })
    const result = await orchestrate(ctx, lead, '/orchestrate turbo')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Unknown orchestration mode "turbo"')
    expect(result.text).toContain('off, auto, on, or status')
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe('auto')
    expect(modeRecords(lead.session.snapshotEvents())).toHaveLength(0)
  })

  it('reports an unchanged selection instead of logging a duplicate record', async () => {
    const { ctx, lead } = await setup({ commands: true })
    expect(await orchestrate(ctx, lead, '/orchestrate auto'))
      .toEqual({ kind: 'success', text: 'Orchestration mode is already auto.' })
    expect(modeRecords(lead.session.snapshotEvents())).toHaveLength(0)
    await orchestrate(ctx, lead, '/orchestrate off')
    expect(await orchestrate(ctx, lead, '/orchestrate off'))
      .toEqual({ kind: 'success', text: 'Orchestration mode is already off.' })
    expect(modeRecords(lead.session.snapshotEvents())).toHaveLength(1)
  })

  it('recovers the mode from the persisted log after a restart', async () => {
    const first = await setup({ commands: true })
    await orchestrate(first.ctx, first.lead, '/orchestrate off')
    expect(foldMode(first.lead.session.header, first.lead.session.snapshotEvents())).toBe('off')
    expect(first.adapter.requests).toHaveLength(0)

    // Prove durability through a real persistence round trip in a fresh context.
    await first.ctx.sessions.flush(first.lead.session)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup({ commands: true, storageRoot: first.storageRoot, leadSessionId: SessionId('resumed-lead') })
    const resumed = await second.ctx.agents.resume({
      resumeSessionId: SessionId('orchestration-lead'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(orchestrationModeOf(second.ctx.sessionProjections, resumed.agent.session)).toBe('off')
    expect(foldMode(resumed.agent.session.header, resumed.agent.session.snapshotEvents())).toBe('off')
    expect(await policyOf(second.ctx, resumed.agent)).toContain('Automatic specialist delegation is OFF')
    await resumed.dispose()
  })

  it('parses only the three named modes', () => {
    expect(parseOrchestrationMode(' off ')).toBe('off')
    expect(parseOrchestrationMode('AUTO')).toBe('auto')
    expect(parseOrchestrationMode('on')).toBe('on')
    expect(parseOrchestrationMode('status')).toBeUndefined()
    expect(parseOrchestrationMode('')).toBeUndefined()
    expect(parseOrchestrationMode('delegate')).toBeUndefined()
  })
})

describe('orchestration mode policy', () => {
  it('OFF disables automatic delegation while keeping the specialist tools available', async () => {
    const { ctx, lead } = await setup({ commands: true })
    await orchestrate(ctx, lead, '/orchestrate off')
    const policy = await policyOf(ctx, lead)
    expect(policy).toContain('Automatic specialist delegation is OFF')
    expect(policy).toContain('Work directly unless the owner explicitly asks you to delegate')
    expect(policy).toContain('the specialist tools remain available for that explicit, manual use')
    // The mode changes preference, not availability.
    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(lead.ctx)! })
    expect(assembly.tools.map(schema => schema.name).filter(name => TEAM_TOOLS.includes(name)).sort())
      .toEqual(TEAM_TOOLS)
    const listed = await execute(ctx, lead, 'list_specialists', {})
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('code-reviewer')
  })

  it('AUTO keeps the context-dependent delegation criteria', async () => {
    const { ctx, lead } = await setup({ commands: true })
    const policy = await policyOf(ctx, lead)
    expect(policy).toContain('Automatic specialist delegation is AUTO')
    expect(policy).toContain('Evaluate for yourself whether a specialist provides meaningful expected benefit')
    expect(policy).toContain('prefer the smallest useful team')
    expect(policy).toContain('trivial or single-step')
    expect(policy).toContain('Start the smallest team that covers the work')
  })

  it('ON strongly prefers useful delegation without mandating runaway spawning', async () => {
    const { ctx, lead } = await setup({ commands: true })
    await orchestrate(ctx, lead, '/orchestrate on')
    const policy = await policyOf(ctx, lead)
    expect(policy).toContain('Automatic specialist delegation is ON')
    expect(policy).toContain('Strongly prefer a specialist for non-trivial work')
    expect(policy).toContain('not permission to spawn as many agents as possible')
    expect(policy).toContain('trivial or single-step work may still stay with you')
  })

  it('states in every mode that the mode changes preference only', async () => {
    const { ctx, lead } = await setup({ commands: true })
    for (const mode of ['off', 'auto', 'on'] as const) {
      await orchestrate(ctx, lead, `/orchestrate ${mode}`)
      const policy = await policyOf(ctx, lead)
      expect(policy).toContain('The orchestration mode changes delegation preference only.')
      expect(policy).toContain('It cannot widen filesystem permissions')
      expect(policy).toContain('paid or cloud routes')
      expect(policy).toContain('it never authorizes recursive delegation')
    }
  })

  it('keeps the shared VS3B guidance in every mode', async () => {
    const { ctx, lead } = await setup({ commands: true })
    for (const mode of ['off', 'auto', 'on'] as const) {
      await orchestrate(ctx, lead, `/orchestrate ${mode}`)
      const policy = await policyOf(ctx, lead)
      // VS3B guarantees are not weakened by any mode.
      expect(policy).toContain('Specialists are optional tools, not a required step.')
      expect(policy).toContain('As Team Lead you own the outcome')
      expect(policy).toContain('write the final answer yourself')
      expect(policy).toContain('per-team concurrency cap and FIFO queue')
      expect(policy).toContain('a teammate cannot start a specialist')
      expect(policy).toContain('do not start several specialists on the same assignment')
      expect(policy).toContain('only the Team Lead can start specialists')
    }
  })

  it('renders the same policy for the Lead and a teammate in any mode', async () => {
    const { ctx, lead } = await setup({ commands: true })
    await orchestrate(ctx, lead, '/orchestrate on')
    const child = await spawnRunningTeammate(ctx, lead, 'mode-worker')
    expect(await policyOf(ctx, child)).toBe(await policyOf(ctx, lead))
    await retireTeammate(ctx, lead, 'mode-worker')
  })
})

describe('orchestration mode authority boundaries', () => {
  it('does not change the model-selection policy', async () => {
    const selection = { enabled: true, allowedModels: [{ provider: 'mock', model: 'mock' }] }
    const { ctx, lead } = await setup({ commands: true, selection })
    const before = subagentModelSelectionPolicy(ctx.sessionProjections, lead.session)
    await orchestrate(ctx, lead, '/orchestrate on')
    expect(subagentModelSelectionPolicy(ctx.sessionProjections, lead.session)).toEqual(before)
    // Gate #4 still rejects an unlisted route while ON.
    const denied = await execute(ctx, lead, 'spawn_teammate', {
      name: 'blocked', description: 'unlisted route', prompt: 'go',
      provider: 'mock', model: 'unlisted-model',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('not allowed for this Session')
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
  })

  it('does not change the tool catalog or permissions', async () => {
    const { ctx, lead } = await setup({ commands: true, legacyControl: true })
    const before = await ctx.systemPrompt.assemble({ scope: scopeOf(lead.ctx)! })
    await orchestrate(ctx, lead, '/orchestrate off')
    await orchestrate(ctx, lead, '/orchestrate on')
    const after = await ctx.systemPrompt.assemble({ scope: scopeOf(lead.ctx)! })
    expect(after.tools.map(schema => schema.name).sort())
      .toEqual(before.tools.map(schema => schema.name).sort())
    expect(after.tools.map(schema => schema.name).filter(name => TEAM_TOOLS.includes(name)).sort())
      .toEqual(TEAM_TOOLS)
    // A teammate still cannot start a specialist under ON.
    const child = await spawnRunningTeammate(ctx, lead, 'authority-worker')
    const denied = await execute(ctx, child, 'spawn_specialist', { name: 'code-reviewer', task: 'review' })
    expect(denied.isError).toBe(true)
    await retireTeammate(ctx, lead, 'authority-worker')
  })

  it('keeps the VS3A specialist task contract intact', async () => {
    const { ctx, lead } = await setup({ commands: true })
    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(lead.ctx)! })
    const schema = assembly.tools.find(tool => tool.name === 'spawn_specialist')
    if (schema === undefined) throw new Error('spawn_specialist is not mounted')
    const parameters = schema.parameters as {
      required?: readonly string[]
      properties?: Record<string, { description?: string }>
    }
    expect(parameters.required).toEqual(expect.arrayContaining(['name', 'task']))
    expect(Object.keys(parameters.properties ?? {}).sort()).toEqual([
      'model',
      'name',
      'provider',
      'reasoning_effort',
      'task',
    ])
    expect(parameters.properties?.task?.description).toContain('Concrete work this specialist must perform')
    // The tool still rejects a missing assignment before touching the Team.
    const missing = await execute(ctx, lead, 'spawn_specialist', { name: 'code-reviewer' })
    expect(missing.isError).toBe(true)
  })

  it('refuses a mode change from a teammate', async () => {
    const { ctx, lead } = await setup({ commands: true })
    const child = await spawnRunningTeammate(ctx, lead, 'mode-probe')
    const denied = await orchestrate(ctx, child, '/orchestrate off')
    expect(denied.kind).toBe('error')
    expect(denied.text).toContain('Only the Team Lead can change the orchestration mode')
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe('auto')
    await retireTeammate(ctx, lead, 'mode-probe')
  })

  it('keeps durability and policy when no command registry is composed', async () => {
    const { ctx, lead } = await setup()
    expect(ctx.get('commands')).toBeUndefined()
    recordOrchestrationMode(lead.session, 'off')
    expect(orchestrationModeOf(ctx.sessionProjections, lead.session)).toBe('off')
    const policy = await policyOf(ctx, lead)
    expect(policy).toContain('Automatic specialist delegation is OFF')
    // The Team section still renders in full without a command registry.
    expect(policy).toContain(TEAM_POLICY_PREFIX)
    expect(policy).toContain('The Lead must wait for required teammates before giving the final answer.')
  })
})
