/** Default model references remain live without a settings service. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import DefaultModel from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

it('reads complete selections from volatile config and clears omitted reasoning effort', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm' })
  const consumer = ctx.agentDefaultModel
  await live.update({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  expect(consumer.currentSelection()).toEqual({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  await live.replace({ provider: 'p', model: 'm' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
  await consumer.saveSelection({ provider: 'unsaved', model: 'unsaved' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
})

it('persists complete selections through its owning profile entry', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')
  const { ctx } = await configurationFixture({ hmr: false })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'next', reasoningEffort: ReasoningEffortId('high') })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'next', reasoningEffort: 'high' })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'final' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, { provider: 'test', model: 'original' })
  await standalone.agentDefaultModel.saveSelection({ provider: 'test', model: 'ignored' })
  expect(standalone.agentDefaultModel.currentSelection().model).toBe('original')
})

it('serializes overlapping saves and continues after a rejected write', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editor = ctx.configEditor
  const edit = editor.edit.bind(editor)
  const calls: string[] = []
  const intercepted = vi.spyOn(editor, 'edit').mockImplementationOnce(async () => {
    calls.push('rejected')
    entered.resolve(undefined)
    await release.promise
    throw new Error('read-only document')
  }).mockImplementation(async (entry, change) => {
    calls.push('saved')
    await edit(entry, change)
  })
  const first = ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'rejected' })
  const failed = expect(first).rejects.toThrow('read-only document')
  const lastSelection = { provider: 'test', model: 'final' }
  const last = ctx.agentDefaultModel.saveSelection(lastSelection)
  onTestFinished(async () => {
    release.resolve(undefined)
    await Promise.allSettled([failed, last])
    intercepted.mockRestore()
  })
  lastSelection.model = 'mutated'
  await entered.promise
  expect(calls).toEqual(['rejected'])
  release.resolve(undefined)
  await failed
  await last
  expect(calls).toEqual(['rejected', 'saved'])
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
})

describe('inter-provider fallback GPU policy', () => {
  async function service(config: Record<string, unknown>) {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm', ...config })
    return ctx
  }

  it('returns no candidate without placement configuration (fallback disabled by default)', async () => {
    const ctx = await service({})
    expect(ctx.agentDefaultModel.findFallbackProvider()).toBe(null)
  })

  it('selects the owner-approved RTX 3090 primary target when it has an explicit model', async () => {
    const ctx = await service({
      placement: [{ provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002', automaticFallback: true, model: 'glm-5.3-flash' }],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toEqual({ provider: 'qwen-local-3090', model: 'glm-5.3-flash' })
  })

  it('never auto-falls-back to RTX 3090 Ti targets', async () => {
    const ctx = await service({
      placement: [
        { provider: 'qwen-local', endpoint: 'http://127.0.0.1:8001' },
        { provider: 'strata-local', endpoint: 'http://127.0.0.1:8080' },
      ],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toBe(null)
  })

  it('automaticFallback:true WITHOUT explicit model => null (fail-closed)', async () => {
    const ctx = await service({
      placement: [{ provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002', automaticFallback: true }],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toBe(null)
  })

  it('skips owner-approval and dual-GPU routes to reach the eligible primary', async () => {
    const ctx = await service({
      placement: [
        { provider: 'qwen-local-dual', endpoint: 'http://127.0.0.1:8000', automaticFallback: true, model: 'dual-model' },
        { provider: 'strata-local', endpoint: 'http://127.0.0.1:8080', automaticFallback: true, model: 'strata-model' },
        { provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002', automaticFallback: true, model: 'glm-5.3-flash' },
      ],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toEqual({ provider: 'qwen-local-dual', model: 'dual-model' })
  })

  it('qwen-local RTX 3090 Ti unflagged => never selected as fallback', async () => {
    const ctx = await service({
      placement: [
        { provider: 'qwen-local', endpoint: 'http://127.0.0.1:8001' },
        { provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002', automaticFallback: true, model: 'glm-5.3-flash' },
      ],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toEqual({ provider: 'qwen-local-3090', model: 'glm-5.3-flash' })
  })

  it('strata-local RTX 3090 Ti unflagged => never selected as fallback', async () => {
    const ctx = await service({
      placement: [
        { provider: 'strata-local', endpoint: 'http://127.0.0.1:8080' },
        { provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002', automaticFallback: true, model: 'glm-5.3-flash' },
      ],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toEqual({ provider: 'qwen-local-3090', model: 'glm-5.3-flash' })
  })

  it('keeps eligibility opt-in per target rather than name-based', async () => {
    const ctx = await service({
      placement: [{ provider: 'qwen-local-3090', endpoint: 'http://127.0.0.1:8002' }],
    })
    expect(ctx.agentDefaultModel.findFallbackProvider()).toBe(null)
  })
})
