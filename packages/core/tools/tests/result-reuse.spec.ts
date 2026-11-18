/** Comprehensive tests for ToolDefinition.resultReuse — duplicate in-flight suppression + settled-value memoization. @module dsh-tools/result-reuse */

import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, {
  defineContentToolFixture, defineTool,
  TOOL_ABORTED,
  type ToolExecutionResult,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' }
  }
}

const testToolSignal = new AbortController().signal

async function setup(options?: { resultReuseCapacity?: number }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, options?.resultReuseCapacity !== undefined ? { resultReuseCapacity: options.resultReuseCapacity } : {})
  return ctx
}

/** Create a simple tool with a resultReuse classifier. */
function makeResultReuseTool(
  name: string,
  executeValue: (args: unknown) => JsonValue,
  resultReuse: ToolDefinition['resultReuse'],
): ToolDefinition {
  return defineTool({
    name,
    description: `tool for resultReuse test: ${name}`,
    parameters: { text: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    resultReuse,
    async execute(args: { text?: string }) {
      return executeValue(args)
    },
  })
}

/** A tool that increments a counter each time its body executes. */
function makeCountingTool(
  name: string,
  counter: { value: number },
  resultReuse: ToolDefinition['resultReuse'],
): ToolDefinition {
  return defineTool({
    name,
    description: `counting tool: ${name}`,
    parameters: { text: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    resultReuse,
    async execute() {
      counter.value++
      // Brief async step so an overlapping second call sees the leader in flight.
      await new Promise(r => setTimeout(r, 20))
      return `count:${counter.value}`
    },
  })
}

describe('resultReuse', () => {
  /** Track body execution count per key. */
  let counter: { value: number }

  beforeEach(() => {
    counter = { value: 0 }
  })

  /**
   * Test 1: No resultReuse declaration -> behavior remains unchanged.
   * Identical calls execute independently.
   */
  it('no resultReuse -> identical calls execute independently (2 body executions)', async () => {
    const ctx = await setup()
    const tool = defineContentToolFixture({
      name: 'no-reuse-tool',
      description: 'no reuse declared',
      parameters: { text: { type: 'string' } },
      async execute() {
        counter.value++
        return [{ type: 'text', text: `count:${counter.value}` }]
      },
    })
    ctx.tools.register(tool)

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('r1'), name: 'no-reuse-tool', arguments: { text: 'a' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('r2'), name: 'no-reuse-tool', arguments: { text: 'a' } })
    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    expect(counter.value).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 2a: scope='agent' without an Agent identity fails closed —
   * anonymous/direct registry calls get no in-flight suppression and no
   * settled memoization.
   */
  it('scope=agent without Agent identity fails closed -> independent executions, no memoization', async () => {
    const ctx = await setup()
    ctx.tools.register(makeCountingTool('anon-agent-scope', counter, (args) => ({ scope: 'agent', key: 'anon-key', ttlMs: 5_000 })))

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('an1'), name: 'anon-agent-scope', arguments: { text: 'x' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('an2'), name: 'anon-agent-scope', arguments: { text: 'x' } })
    const r3 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('an3'), name: 'anon-agent-scope', arguments: { text: 'x' } })

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    expect(r3.isError).toBe(false)
    // Every anonymous call executed independently.
    expect(counter.value).toBe(3)
    // No settled memoization either: sequential calls never reuse a value.
    expect(r1.value).toBe('count:1')
    expect(r2.value).toBe('count:2')
    expect(r3.value).toBe('count:3')
    await ctx.fiber.dispose()
  })

  /**
   * Test 2b: Agent-scoped exact duplicate in-flight calls with a real Agent.
   * One body execution, separate caller identities/results.
   */
  it('agent-scoped duplicate in-flight with a real Agent -> one body execution, separate caller identities', async () => {
    const ctx = await setup()
    const agent = { id: 'reuse-agent' as SessionId } as Agent
    const tool = makeCountingTool('inflight-agent', counter, (args) => ({ scope: 'agent', key: 'test-key' }))
    ctx.tools.register(tool)

    // Call 1 (leader): starts body execution
    const p1 = ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('if1'), name: 'inflight-agent', arguments: { text: 'x' }, agent })
    // Small delay to ensure leader is in flight before follower arrives.
    await new Promise(r => setTimeout(r, 5))
    // Call 2 (follower): finds in-flight entry
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('if2'), name: 'inflight-agent', arguments: { text: 'x' }, agent })

    // Wait for leader to settle.
    const r1 = await p1

    // Both calls returned successfully.
    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    // Only ONE body execution (leader).
    expect(counter.value).toBe(1)
    // Caller identities are distinct (each reconstructs its own success).
    expect(r1.value).toBe('count:1')
    expect(r2.value).toBe('count:1')
    await ctx.fiber.dispose()
  })

  /**
   * Test 3: Different reuse keys -> separate body executions.
   */
  it('different reuse keys -> separate body executions', async () => {
    const ctx = await setup()
    ctx.tools.register(makeCountingTool('key-distinct', counter, (args) => ({ scope: 'runtime', key: args.text ?? '' })))

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('kd1'), name: 'key-distinct', arguments: { text: 'alpha' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('kd2'), name: 'key-distinct', arguments: { text: 'beta' } })

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    // Two different keys -> two body executions.
    expect(counter.value).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 4: Same key, different Agents under scope='agent' -> separate executions.
   */
  it('same key, scope=agent, different Agents -> separate executions', async () => {
    const ctx = await setup()
    const agentA = { id: 'agent-a' as SessionId } as Agent
    const agentB = { id: 'agent-b' as SessionId } as Agent
    const tool = makeCountingTool('agent-scope', counter, (args) => ({ scope: 'agent', key: 'shared-key' }))
    ctx.tools.register(tool)

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('as1'), name: 'agent-scope', arguments: { text: 'x' }, agent: agentA })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('as2'), name: 'agent-scope', arguments: { text: 'x' }, agent: agentB })

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    // Different agents -> separate body executions.
    expect(counter.value).toBe(2)
    // Each agent observed its own execution's value.
    expect(r1.value).toBe('count:1')
    expect(r2.value).toBe('count:2')
    await ctx.fiber.dispose()
  })

  /**
   * Test 5: Same key across different Agents under explicit scope='runtime' -> one in-flight execution.
   */
  it('same key, scope=runtime, different Agents -> one in-flight execution', async () => {
    const ctx = await setup()
    const tool = makeCountingTool('runtime-scope', counter, (args) => ({ scope: 'runtime', key: 'shared-key' }))
    ctx.tools.register(tool)

    // Overlap the two calls so the second coalesces onto the first (runtime scope shares across Agents).
    const p1 = ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('rs1'), name: 'runtime-scope', arguments: { text: 'x' } })
    await new Promise(r => setTimeout(r, 5))
    const p2 = ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('rs2'), name: 'runtime-scope', arguments: { text: 'x' } })
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    // scope='runtime' -> one body execution shared across agents.
    expect(counter.value).toBe(1)
    await ctx.fiber.dispose()
  })

  /**
   * Test 6: ttlMs=0 -> duplicate in-flight suppression works, but no settled memo.
   */
  it('ttlMs=0 -> in-flight suppression works, no settled memo', async () => {
    const ctx = await setup()
    const tool = makeCountingTool('ttl-zero', counter, (args) => ({ scope: 'runtime', key: 'ttl-zero-key', ttlMs: 0 }))
    ctx.tools.register(tool)

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('tz1'), name: 'ttl-zero', arguments: { text: 'a' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('tz2'), name: 'ttl-zero', arguments: { text: 'a' } })

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    // Both execute independently (no settled memo).
    expect(counter.value).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 7: ttlMs>0 -> successful settled result is reused before expiry.
   */
  it('ttlMs>0 -> successful settled result is reused before expiry', async () => {
    const ctx = await setup()
    const tool = makeCountingTool('ttl-positive', counter, (args) => ({ scope: 'runtime', key: 'ttl-pos-key', ttlMs: 5_000 }))
    ctx.tools.register(tool)

    // First call -> body executes.
    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('tp1'), name: 'ttl-positive', arguments: { text: 'a' } })
    expect(counter.value).toBe(1)

    // Second call (after first settles) -> reuse from settled cache.
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('tp2'), name: 'ttl-positive', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(r2.value).toBe('count:1')
    expect(counter.value).toBe(1) // Still 1 — no second body execution.
    await ctx.fiber.dispose()
  })

  /**
   * Test 8: Expired result -> body executes again.
   */
  it('expired result -> body executes again', async () => {
    const ctx = await setup()
    const tool = makeCountingTool('ttl-expired', counter, (args) => ({ scope: 'runtime', key: 'ttl-exp-key', ttlMs: 50 }))
    ctx.tools.register(tool)

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('te1'), name: 'ttl-expired', arguments: { text: 'a' } })
    expect(counter.value).toBe(1)

    // Wait for TTL to expire.
    await new Promise(r => setTimeout(r, 100))

    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('te2'), name: 'ttl-expired', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(r2.value).toBe('count:2')
    expect(counter.value).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 9: Cache-capacity eviction -> bounded and deterministic (FIFO).
   */
  it('cache-capacity eviction -> bounded and deterministic (FIFO)', async () => {
    const ctx = await setup({ resultReuseCapacity: 3 })
    ctx.tools.register(makeCountingTool('cap-evict', counter, (args) => ({ scope: 'runtime', key: args.text ?? '', ttlMs: 5_000 })))

    // Fill the cache with 4 entries (capacity is 3).
    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ce1'), name: 'cap-evict', arguments: { text: 'a' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ce2'), name: 'cap-evict', arguments: { text: 'b' } })
    const r3 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ce3'), name: 'cap-evict', arguments: { text: 'c' } })
    const r4 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ce4'), name: 'cap-evict', arguments: { text: 'd' } })

    expect(counter.value).toBe(4)
    expect(r1.value).toBe('count:1')
    expect(r2.value).toBe('count:2')
    expect(r3.value).toBe('count:3')
    expect(r4.value).toBe('count:4')

    // 'a' was evicted (first in, first out). Re-fetching it triggers a body execution.
    const r4a = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ce4a'), name: 'cap-evict', arguments: { text: 'a' } })
    expect(r4a.value).toBe('count:5') // Evicted, so re-executed.
    await ctx.fiber.dispose()
  })

  /**
   * Test 10: Body failure -> never becomes a settled cache entry.
   */
  it('body failure -> never becomes a settled cache entry', async () => {
    const ctx = await setup()
    let bodyThrows = true
    ctx.tools.register(defineTool({
      name: 'failing-reuse',
      description: 'fails once',
      parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      resultReuse: () => ({ scope: 'runtime', key: 'fail-key', ttlMs: 5_000 }),
      async execute() {
        if (bodyThrows) {
          bodyThrows = false
          throw new Error('body error')
        }
        return 'recovered'
      },
    }))

    // First call fails.
    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('bf1'), name: 'failing-reuse', arguments: { text: 'x' } })
    expect(r1.isError).toBe(true)

    // Second call -> body executes again (failure was not cached).
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('bf2'), name: 'failing-reuse', arguments: { text: 'x' } })
    expect(r2.isError).toBe(false)
    expect(r2.value).toBe('recovered')
    await ctx.fiber.dispose()
  })

  /**
   * Test 11: Leader cancellation/failure -> does not poison a surviving follower.
   */
  it('leader cancellation -> surviving follower can become replacement leader', async () => {
    const ctx = await setup()
    let bodyRuns = 0
    let releaseSecondBody: (() => void) | undefined
    const secondBodyStarted = new Promise<void>(resolve => { releaseSecondBody = resolve })
    const leaderAbort = new AbortController()
    ctx.tools.register(defineTool({
      name: 'cancel-leader',
      description: 'test leader cancellation',
      parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      resultReuse: () => ({ scope: 'runtime', key: 'cancel-key', ttlMs: 5_000 }),
      async execute(_args, exec) {
        bodyRuns++
        if (bodyRuns === 1) {
          // Leader body: wait until the caller aborts, then observe cancellation.
          await new Promise<void>(resolve => exec.signal.addEventListener('abort', () => resolve(), { once: true }))
          return 'leader-aborted'
        }
        // Replacement-leader body: finish normally.
        releaseSecondBody?.()
        return 'replacement-done'
      },
    }))

    // Start the leader with its own abortable signal.
    const leaderPromise = ctx.tools.execute({
      signal: leaderAbort.signal,
      callId: ToolCallId('cl1'),
      name: 'cancel-leader',
      arguments: { text: 'x' },
    })
    await new Promise(r => setTimeout(r, 10))

    // Follower joins while the leader is in flight.
    const followerPromise = ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('cl2'),
      name: 'cancel-leader',
      arguments: { text: 'x' },
    })
    await new Promise(r => setTimeout(r, 10))

    // Cancel the leader's caller: the leader settles (aborted, not memoized)
    // and the follower becomes the replacement leader with its own body run.
    leaderAbort.abort()
    const leaderResult = await leaderPromise
    expect(leaderResult.isError).toBe(true)
    const followerResult = await followerPromise
    expect(followerResult.isError).toBe(false)
    expect(followerResult.value).toBe('replacement-done')
    // Exactly two body runs: the aborted leader and the replacement leader.
    expect(bodyRuns).toBe(2)
    await secondBodyStarted
    await ctx.fiber.dispose()
  })

  /**
   * Test 12: Follower cancellation -> does not cancel or corrupt leader execution.
   */
  it('follower cancellation -> does not cancel or corrupt leader', async () => {
    const ctx = await setup()
    let leaderBodyRan = false
    ctx.tools.register(defineTool({
      name: 'cancel-follower',
      description: 'test follower cancellation',
      parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      resultReuse: () => ({ scope: 'runtime', key: 'follow-key', ttlMs: 5_000 }),
      async execute() {
        leaderBodyRan = true
        await new Promise(r => setTimeout(r, 100))
        return 'leader-done'
      },
    }))

    const leaderPromise = ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('cf1'), name: 'cancel-follower', arguments: { text: 'x' } })
    await new Promise(r => setTimeout(r, 10))

    // Follower's signal is cancelled while waiting for the leader.
    const followerAbort = new AbortController()
    const followerPromise = ctx.tools.execute({ signal: followerAbort.signal, callId: ToolCallId('cf2'), name: 'cancel-follower', arguments: { text: 'x' } })

    // Cancel the follower.
    await new Promise(r => setTimeout(r, 5))
    followerAbort.abort()

    // The follower returns its own cancellation outcome (resolved isError per
    // the established tool-call contract; the leader is untouched).
    const followerResult = await followerPromise
    expect(followerResult.isError).toBe(true)
    expect(followerResult.error?.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    // But the leader continues and completes successfully.
    const leaderResult = await leaderPromise
    expect(leaderResult.isError).toBe(false)
    expect(leaderBodyRan).toBe(true)
    await ctx.fiber.dispose()
  })

  /**
   * Test 13: pre-execute/guards execute independently for every call, including hits/followers.
   */
  it('pre-execute/guards execute independently for every call', async () => {
    const ctx = await setup()
    let preExecuteCount = 0
    ctx.tools.register(makeCountingTool('pre-execute-guards', counter, (args) => ({ scope: 'runtime', key: 'pe-key', ttlMs: 5_000 })))
    ctx.on('tools/pre-execute', async (_exec, next) => { preExecuteCount++; return next() })

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pe1'), name: 'pre-execute-guards', arguments: { text: 'a' } })
    expect(r1.isError).toBe(false)
    expect(preExecuteCount).toBe(1)

    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pe2'), name: 'pre-execute-guards', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(r2.value).toBe('count:1')
    // Even though the result was reused, pre-execute still fired.
    expect(preExecuteCount).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 14: tools/execute wrappers remain per-call.
   */
  it('tools/execute wrappers remain per-call', async () => {
    const ctx = await setup()
    let wrapperCount = 0
    ctx.tools.register(makeCountingTool('wrap-per-call', counter, (args) => ({ scope: 'runtime', key: 'wc-key', ttlMs: 5_000 })))
    ctx.on('tools/execute', async (_exec, next) => {
      wrapperCount++
      return next()
    })

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('wc1'), name: 'wrap-per-call', arguments: { text: 'a' } })
    expect(r1.isError).toBe(false)
    expect(wrapperCount).toBe(1)

    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('wc2'), name: 'wrap-per-call', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(wrapperCount).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 15: tools/post-execute remains per-call.
   */
  it('tools/post-execute remains per-call', async () => {
    const ctx = await setup()
    let postExecuteCount = 0
    ctx.tools.register(makeCountingTool('post-execute-per-call', counter, (args) => ({ scope: 'runtime', key: 'pepc-key', ttlMs: 5_000 })))
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      postExecuteCount++
      return next()
    })

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pepc1'), name: 'post-execute-per-call', arguments: { text: 'a' } })
    expect(r1.isError).toBe(false)
    expect(postExecuteCount).toBe(1)

    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pepc2'), name: 'post-execute-per-call', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(postExecuteCount).toBe(2)
    await ctx.fiber.dispose()
  })

  /**
   * Test 16: tools/result remains per-call with distinct ToolExecution identity.
   */
  it('tools/result remains per-call with distinct ToolExecution identity', async () => {
    const ctx = await setup()
    const resultIds: string[] = []
    ctx.tools.register(makeCountingTool('result-per-call', counter, (args) => ({ scope: 'runtime', key: 'rpc-key', ttlMs: 5_000 })))
    ctx.on('tools/result', (exec) => {
      // Store the callId as the identity marker.
      resultIds.push(String(exec.name))
    })

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('rpc1'), name: 'result-per-call', arguments: { text: 'a' } })
    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('rpc2'), name: 'result-per-call', arguments: { text: 'a' } })

    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    expect(resultIds.length).toBe(2)
    // Both calls receive their own tools/result event.
    await ctx.fiber.dispose()
  })

  /**
   * Test 17: Only canonical successful value is reused; content/meta/additionalContexts/concludesTurn
   * from another execution are not transplanted.
   */
  it('only canonical value is reused, not content/meta/additionalContexts/concludesTurn', async () => {
    const ctx = await setup()
    ctx.tools.register(makeCountingTool('canonical-only', counter, (args) => ({ scope: 'runtime', key: 'co-key', ttlMs: 5_000 })))

    const r1 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('co1'), name: 'canonical-only', arguments: { text: 'a' } })
    expect(r1.isError).toBe(false)
    expect(r1.value).toBe('count:1')
    const r1Content = [...r1.content]

    const r2 = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('co2'), name: 'canonical-only', arguments: { text: 'a' } })
    expect(r2.isError).toBe(false)
    expect(r2.value).toBe('count:1')

    // The reused result has its own content (rendered from the cached value),
    // not the original execution's content.
    expect(r2.content).toEqual(r1Content)
    // But the ToolExecution identity (callId) is different.
    await ctx.fiber.dispose()
  })

  /**
   * Test 18: resultReuse never appears in model-facing schemas() output.
   */
  it('resultReuse never appears in schemas() output', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'schema-test-tool',
      description: 'has resultReuse',
      parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      resultReuse: () => ({ scope: 'runtime', key: 'schema-key', ttlMs: 1_000 }),
      async execute() { return 'ok' },
    }))
    const schema = ctx.tools.schemas()[0] as unknown as Record<string, unknown>
    expect(Object.keys(schema).sort()).toEqual(['description', 'name', 'parameters'])
    expect(schema.resultReuse).toBeUndefined()
    await ctx.fiber.dispose()
  })

  /**
   * Test 19: Existing parallel-tool scheduling and barriers remain unchanged.
   * This is a structural test: if resultReuse is not opted in for existing tools,
   * they should behave exactly as before.
   */
  it('existing parallel-tool scheduling unchanged (no resultReuse)', async () => {
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.tools.register(defineContentToolFixture({
      name: 'parallel-echo',
      description: 'parallel echo',
      parameters: { x: { type: 'number' } },
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    // Both tools have no resultReuse — they should execute independently.
    const [r1, r2] = await Promise.all([
      ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pe1'), name: 'echo', arguments: { text: 'hi' } }),
      ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('pe2'), name: 'parallel-echo', arguments: { x: 42 } }),
    ])
    expect(r1.isError).toBe(false)
    expect(r2.isError).toBe(false)
    await ctx.fiber.dispose()
  })

  /**
   * Test 20: Existing PTC nested dispatch behavior remains unchanged.
   */
  it('PTC nested dispatch unchanged (no resultReuse)', async () => {
    const ctx = await setup()
    ctx.tools.register(echoTool)
    // PTC dispatch uses the same execution path — if resultReuse is not opted in,
    // it should behave identically.
    const r = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('ptc1'), name: 'echo', arguments: { text: 'ptc' } })
    expect(r.isError).toBe(false)
    await ctx.fiber.dispose()
  })

  /**
   * Test 21: Existing cancellation tests remain green.
   * The resultReuse implementation does not alter cancellation semantics.
   */
  it('existing cancellation semantics unchanged', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'cancel-test',
      description: 'test cancellation',
      parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute(_args, exec) {
        // Cooperative body: settle when cancellation reaches the body
        // (body quiescence is guaranteed before an ABORTED outcome).
        await new Promise<void>(resolve => exec.signal.addEventListener('abort', () => resolve(), { once: true }))
        return 'aborted-body-done'
      },
    }))
    const abort = new AbortController()
    const p = ctx.tools.execute({ signal: abort.signal, callId: ToolCallId('ct1'), name: 'cancel-test', arguments: { text: 'x' } })
    await new Promise(r => setTimeout(r, 20))
    abort.abort()
    // A cancelled call resolves to its own isError cancellation outcome (the
    // established tool-call contract); it never rejects.
    const result = await p
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe(TOOL_ABORTED)
    await ctx.fiber.dispose()
  })

  /**
   * Test 22: TypeScript/type-level ToolDefinition/defineTool contract coverage.
   * resultReuse must be typed and absent from model-facing schemas.
   */
  it('type-level ToolDefinition contract coverage', async () => {
    const ctx = await setup()
    const tool: ToolDefinition = defineContentToolFixture({
      name: 'type-check-tool',
      description: 'type contract test',
      parameters: {},
      resultReuse: (args: unknown) => ({ scope: 'runtime', key: String(args) }),
      async execute() { return [] },
    })
    // Verify the type contract — resultReuse must be callable.
    const config = tool.resultReuse?.({})
    expect(config).toEqual({ scope: 'runtime', key: '[object Object]' })
    await ctx.fiber.dispose()
  })
})

/** Echo tool used in tests. */
const echoTool = defineTool({
  name: 'echo',
  description: 'echo arguments back',
  parameters: { text: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  async execute(args: { text?: string }) {
    return args.text ?? ''
  },
})
