import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import TeamService from '../src/index.ts'
import type { TeamMemberSnapshot } from '../src/index.ts'
import type { AllowedModelRoute } from '../src/model-selection.ts'
import { assertTeammateModelSelection, recordedModelSelectionRoutes } from '../src/model-selection.ts'
import { teamProjectionDefinition } from '../src/projection.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Host-only fold for the shared `subagentModelSelectionPolicy` projection key.
 * Mirrors the durable shape the tool layer records, so the guard reads the
 * identical session state without a package dependency. Tests that need "no
 * recorded policy" skip registration, matching a deployment without the
 * model-selection opt-in.
 */
const policyProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: {
    parse: (value: unknown) => value as AllowedModelRoute[] | null,
  },
  init: () => null,
  apply: (policy: AllowedModelRoute[] | null, event: SessionEvent): AllowedModelRoute[] | null => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    return allowedModels.map(route => ({ ...route }))
  },
} satisfies import('@deepseek-ai/dsh-session-projection').ProjectionDefinition<
  'subagentModelSelectionPolicy',
  AllowedModelRoute[] | null
>

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

/** Read the durable Team member roster for one Lead through the same fold as the service. */
function durableMembers(agent: Agent): readonly TeamMemberSnapshot[] {
  let state = teamProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.snapshotEvents()) state = teamProjectionDefinition.apply(state, event)
  return state.members
}

/** Wait until a spawned teammate's child Agent has run to completion and torn down. */
async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  policy: AllowedModelRoute[] | undefined,
  leadOptions: { provider?: string; model?: string } = { provider: 'mock', model: 'mock' },
  reasoning?: LlmModelReasoningInfo,
): Promise<{ ctx: Context; lead: Agent }> {
  const ctx = new Context()
  contexts.push(ctx)
  currentContext = ctx
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-model-selection-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  const adapter = new MockAdapter(
    script,
    ...(reasoning === undefined ? [] : [reasoning]),
  )
  ctx.llm.registerAdapter(['mock'], adapter)
  if (policy !== undefined) {
    ctx.root.sessionProjections.register(policyProjectionDefinition)
  }
  const lead = await ctx.agentLoop.create(SessionId('lead'), {
    ...leadOptions.provider === undefined ? {} : { provider: leadOptions.provider },
    ...leadOptions.model === undefined ? {} : { model: leadOptions.model },
  })
  if (policy !== undefined) {
    lead.session.append('subagent/model-selection-policy', { allowedModels: policy })
  }
  return { ctx, lead }
}

interface SpawnOptions {
  readonly context?: 'fresh' | 'fork'
  readonly agentOptions?: {
    provider?: string
    model?: string
    reasoningEffort?: string
    maxTokens?: number
  }
}

function spawn(
  ctx: Context,
  lead: Agent,
  name: string,
  options: SpawnOptions = {},
) {
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: content(`${name} initial`),
    context: options.context ?? 'fresh',
    provider: options.context === 'fork' ? 'fork' : 'spawn',
    ...(options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions }),
    signal: SIGNAL,
  })
}

function leadRoute(lead: Agent): AllowedModelRoute {
  const provider = lead.options.provider
  const model = lead.options.model
  if (provider === undefined || model === undefined) throw new Error('test Lead must carry a concrete route')
  return { provider, model }
}

describe('teammate model-selection enforcement', () => {
  it('allows a spawn without agentOptions to inherit normally', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    const result = await spawn(ctx, lead, 'inheriting-worker')
    expect(result.member.context).toBe('fresh')
    await waitNoAgent(ctx, result.member.id)
    expect(durableMembers(lead).map(member => member.name)).toEqual(['inheriting-worker'])
  })

  it('allows a fresh teammate explicitly placed on the effective Lead route without a policy', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    const route = leadRoute(lead)
    const result = await spawn(ctx, lead, 'lead-route-worker', {
      agentOptions: { provider: route.provider, model: route.model },
    })
    await waitNoAgent(ctx, result.member.id)
    expect(durableMembers(lead).map(member => member.name)).toEqual(['lead-route-worker'])
  })

  it('rejects an unknown route when no policy is recorded and appends no member event', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    await expect(spawn(ctx, lead, 'bypass-attempt', {
      agentOptions: { provider: 'elsewhere', model: 'other-model' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    expect(durableMembers(lead)).toEqual([])
    expect(ctx.agents.list().some(agent => agent.session.header.parentSession === lead.id)).toBe(false)
  })

  it('allows a route recorded in the session policy', async () => {
    const allowed: AllowedModelRoute[] = [{ provider: 'elsewhere', model: 'other-model' }]
    const { ctx, lead } = await setup([textResponse('done')], allowed)
    expect(recordedRoutes(lead.session)).toEqual(allowed)
    const result = await spawn(ctx, lead, 'allowlisted-worker', {
      agentOptions: { provider: 'elsewhere', model: 'other-model' },
    })
    await waitNoAgent(ctx, result.member.id)
    expect(durableMembers(lead).map(member => member.name)).toEqual(['allowlisted-worker'])
  })

  it('rejects a route outside a recorded policy', async () => {
    const allowed: AllowedModelRoute[] = [{ provider: 'elsewhere', model: 'other-model' }]
    const { ctx, lead } = await setup([textResponse('done')], allowed)
    await expect(spawn(ctx, lead, 'off-allowlist', {
      agentOptions: { provider: 'blocked-provider', model: 'blocked-model' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    expect(durableMembers(lead)).toEqual([])
  })

  it('rejects fork with an explicit provider/model route', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    const route = leadRoute(lead)
    await expect(spawn(ctx, lead, 'fork-route', {
      context: 'fork',
      agentOptions: { provider: route.provider, model: route.model },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    expect(durableMembers(lead)).toEqual([])
  })

  it('allows a fork with pure inheritance', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    const result = await spawn(ctx, lead, 'inherit-fork', { context: 'fork' })
    expect(result.member.context).toBe('fork')
    expect(durableMembers(lead).map(member => member.name)).toEqual(['inherit-fork'])
  })

  it('rejects provider without model and model without provider', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    await expect(spawn(ctx, lead, 'half-route-provider', {
      agentOptions: { provider: 'mock' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    await expect(spawn(ctx, lead, 'half-route-model', {
      agentOptions: { model: 'mock' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    expect(durableMembers(lead)).toEqual([])
  })

  it('rejects blank and whitespace-only provider or model values', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    await expect(spawn(ctx, lead, 'blank-provider', {
      agentOptions: { provider: '', model: 'mock' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    await expect(spawn(ctx, lead, 'blank-model', {
      agentOptions: { provider: 'mock', model: '   ' },
    })).rejects.toMatchObject({ code: 'TEAM_MODEL_SELECTION' })
    expect(durableMembers(lead)).toEqual([])
  })

  it('rejects effort-only and token-only overrides without an effective Lead route', async () => {
    const { ctx, lead } = await setup([textResponse('done')], undefined)
    // A pure-domain probe: assert the guard directly against a Lead whose
    // effective route is empty, without disturbing the running harness Lead.
    const emptyLead = { session: lead.session, options: {} } as unknown as Agent
    expect(() => assertTeammateModelSelection(
      ctx.sessionProjections,
      emptyLead,
      'fresh',
      { reasoningEffort: 'low' },
    )).toThrow(expect.objectContaining({ code: 'TEAM_MODEL_SELECTION' }))
    expect(() => assertTeammateModelSelection(
      ctx.sessionProjections,
      emptyLead,
      'fresh',
      { maxTokens: 128 },
    )).toThrow(expect.objectContaining({ code: 'TEAM_MODEL_SELECTION' }))
  })

  it('allows effort-only and token-only overrides against an effective Lead route', async () => {
    const effort = ReasoningEffortId('low')
    const reasoning: LlmModelReasoningInfo = {
      efforts: [{ id: effort, name: 'Low' }],
      defaultEffort: effort,
    }
    const { ctx, lead } = await setup([textResponse('done')], undefined, { provider: 'mock', model: 'mock' }, reasoning)
    const result = await spawn(ctx, lead, 'effort-with-route', {
      agentOptions: { reasoningEffort: effort },
    })
    await waitNoAgent(ctx, result.member.id)
    expect(durableMembers(lead).map(member => member.name)).toEqual(['effort-with-route'])
  })
})

/** Read the recorded policy routes detached from the projected state. */
function recordedRoutes(session: Session): AllowedModelRoute[] | undefined {
  return recordedModelSelectionRoutes(currentContext.sessionProjections, session)
}

/** The most recently created test context. */
let currentContext: Context
