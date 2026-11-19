/**
 * LLMFIT Advisor tests: verify the fixed-argv construction, the closed argument
 * contract, typed failure classification, and the removed capacity field.
 *
 * Every test injects a fake spawn and a fake executable check. No test starts
 * llmfit, runs a model, touches a GPU, or performs network access — the point of
 * this suite is that the adapter's contract holds without any of that.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  ADVISORY_BOUNDARY,
  ALLOWED_USE_CASES,
  LLMFIT_BINARY,
  MAX_LIMIT,
  MAX_STDOUT_BYTES,
  MIN_LIMIT,
  buildArgv,
  projectDocument,
  queryRecommend,
  readLimit,
} from '../core/advisor.js'

/** Read the plugin entry so wiring tests can inspect it without activating it. */
async function getPluginSource() {
  const testDir = fileURLToPath(new URL('.', import.meta.url))
  return readFile(join(testDir, '..', 'index.js'), 'utf8')
}

/** One minimal valid llmfit document. */
function sampleDocument() {
  return {
    system: { gpu_name: 'GeForce RTX 3090', gpu_vram_gb: 24.0 },
    models: [
      {
        name: 'vendor/Some-Model-Q4_K_M',
        provider: 'vendor',
        parameter_count: '24.4B',
        quantization: 'Q4_K_M',
        best_quant: 'Q4_K_M',
        memory_required_gb: 13.18,
        memory_available_gb: 48.0,
        fit_level: 'perfect',
        fit_label: 'Perfect',
        estimated_tps: 42.3,
        context_length: 262144,
        effective_context_length: 8192,
        runtime: 'vllm',
        runtime_label: 'vLLM',
        score: 100.0,
        license: 'apache-2.0',
      },
    ],
    returned_models: 1,
    total_models: 681,
  }
}

/**
 * Build a fake subprocess handle resolving to the supplied outcome.
 * @param {object} options { exitCode, stdoutText, stderrText, lossy, signal, spawnThrows, neverResolves }
 * @returns {{ spawn: Function, specs: object[] }}
 */
function fakeSpawn(options = {}) {
  const specs = []
  const spawn = (spec) => {
    specs.push(spec)
    if (options.spawnThrows === true) throw new Error('argv contained a NUL byte')
    const stdoutText = options.stdoutText ?? JSON.stringify(sampleDocument())
    const stderrText = options.stderrText ?? ''
    return {
      collected: {
        stdout: { readFrom: () => ({ text: stdoutText, nextOffset: stdoutText.length, lossy: options.lossy === true }) },
        stderr: { readFrom: () => ({ text: stderrText, nextOffset: stderrText.length, lossy: false }) },
      },
      done: options.neverResolves === true
        ? new Promise(() => {})
        : Promise.resolve({
          exitCode: options.exitCode ?? 0,
          signal: options.signal ?? null,
        }),
      terminate: () => {},
    }
  }
  return { spawn, specs }
}

/** A check that always reports the binary as executable. */
const executableOk = async () => {}

// --- 1-2. Fixed argv for valid use-cases -----------------------------------

test('coding use-case builds only the intended fixed argv', () => {
  assert.deepEqual(buildArgv('coding', 3), [
    LLMFIT_BINARY, '--no-dashboard', 'recommend', '--json', '--use-case', 'coding', '--limit', '3',
  ])
})

test('reasoning use-case builds only the intended fixed argv', () => {
  assert.deepEqual(buildArgv('reasoning', 3), [
    LLMFIT_BINARY, '--no-dashboard', 'recommend', '--json', '--use-case', 'reasoning', '--limit', '3',
  ])
})

// --- 3. Invalid use-case ---------------------------------------------------

test('invalid use-case is rejected before subprocess spawn', async () => {
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding; rm -rf /', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'invalid_arguments')
  assert.equal(specs.length, 0, 'no process may be spawned for an invalid use-case')
})

// --- 4-5. Limit bounds ----------------------------------------------------

test('limit below the minimum is rejected', async () => {
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 0, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'invalid_arguments')
  assert.equal(specs.length, 0)
})

test('limit above the maximum is rejected', async () => {
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: MAX_LIMIT + 1, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'invalid_arguments')
  assert.equal(specs.length, 0)
})

test('non-integer limit is rejected', async () => {
  assert.equal(readLimit(3.5), undefined)
  assert.equal(readLimit('3'), undefined)
  assert.equal(readLimit(3), 3)
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3.5, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'invalid_arguments')
  assert.equal(specs.length, 0)
})

// --- 6-8. Injection surface is closed ------------------------------------

test('an arbitrary llmfit subcommand cannot be injected', async () => {
  const { spawn, specs } = fakeSpawn()
  for (const attempt of ['download', 'run', 'serve', 'bench', 'hf-search', 'update', 'cluster', 'search']) {
    const result = await queryRecommend({
      useCase: attempt, limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
    })
    assert.equal(result.status, 'invalid_arguments', `subcommand "${attempt}" must be refused`)
  }
  assert.equal(specs.length, 0)
})

test('arbitrary argv cannot be injected through use_case', async () => {
  const { spawn, specs } = fakeSpawn()
  for (const attempt of ['--memory=24G', '--profile', '../llmfit', 'coding --limit 99', 'cod\\u0069ng']) {
    const result = await queryRecommend({
      useCase: attempt, limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
    })
    assert.equal(result.status, 'invalid_arguments', `value "${attempt}" must be refused`)
  }
  assert.equal(specs.length, 0)
})

test('shell metacharacters cannot create a second command', async () => {
  const { spawn, specs } = fakeSpawn()
  const attempts = [
    'coding && curl http://example.invalid',
    'coding; touch /tmp/pwned',
    'coding | tee /tmp/out',
    'coding$(id)',
    'coding`id`',
    'coding\nrecommend',
  ]
  for (const attempt of attempts) {
    const result = await queryRecommend({
      useCase: attempt, limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
    })
    assert.equal(result.status, 'invalid_arguments', `value ${JSON.stringify(attempt)} must be refused`)
  }
  assert.equal(specs.length, 0)
})

test('a valid call passes argv as an array with no shell in position zero', async () => {
  const { spawn, specs } = fakeSpawn()
  await queryRecommend({ useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk })
  assert.equal(specs.length, 1)
  const spec = specs[0]
  assert.ok(Array.isArray(spec.argv), 'argv must be an array')
  assert.equal(spec.argv[0], LLMFIT_BINARY)
  assert.ok(!/bash|sh$/.test(spec.argv[0]), 'argv[0] must never be a shell')
  assert.equal(spec.argv.includes('-c'), false, 'no shell -c may appear')
  assert.equal(spec.argv.filter((a) => a === 'recommend').length, 1)
})

// --- 9-10. Binary availability -------------------------------------------

test('missing binary returns a typed unavailable result', async () => {
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding',
    limit: 3,
    spawn,
    cwd: '/tmp',
    checkExecutable: async () => { throw new Error('ENOENT: no such file or directory') },
  })
  assert.equal(result.status, 'unavailable')
  assert.match(result.error, /pinned path/)
  assert.equal(specs.length, 0)
})

test('non-executable binary returns a typed unavailable result', async () => {
  const { spawn, specs } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding',
    limit: 3,
    spawn,
    cwd: '/tmp',
    checkExecutable: async () => { throw new Error('EACCES: permission denied') },
  })
  assert.equal(result.status, 'unavailable')
  assert.equal(specs.length, 0)
})

// --- 11-14. Process and document failures --------------------------------

test('timeout returns a typed failure', async () => {
  const { spawn } = fakeSpawn({ neverResolves: true })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk, timeoutMs: 25,
  })
  assert.equal(result.status, 'timeout')
})

test('non-zero exit returns a typed failure naming the exit code', async () => {
  const { spawn } = fakeSpawn({ exitCode: 3, stderrText: 'hardware detection failed' })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /exited 3/)
  assert.match(result.error, /hardware detection failed/)
})

test('a signal-killed process returns a typed failure', async () => {
  const { spawn } = fakeSpawn({ signal: 'SIGKILL' })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /SIGKILL/)
})

test('malformed JSON returns a typed failure', async () => {
  const { spawn } = fakeSpawn({ stdoutText: '{not json' })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /not valid JSON/)
})

test('a schema mismatch returns a typed failure', async () => {
  const { spawn } = fakeSpawn({ stdoutText: JSON.stringify({ system: {} }) })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /expected schema/)
})

test('oversized output returns a typed failure and no partial advisory', async () => {
  const { spawn } = fakeSpawn({ lossy: true })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'output_too_large')
  assert.equal(result.models, undefined)
})

test('a spawn that throws synchronously returns a typed failure', async () => {
  const { spawn } = fakeSpawn({ spawnThrows: true })
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /could not be started/)
})

test('the stdout cap is bounded, not unbounded', () => {
  assert.equal(typeof MAX_STDOUT_BYTES, 'number')
  assert.ok(MAX_STDOUT_BYTES > 0 && MAX_STDOUT_BYTES <= 8 * 1024 * 1024)
})

// --- 15-17. Field projection and advisory boundary -----------------------

test('memory_available_gb is removed from every model record', async () => {
  const { spawn } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.status, 'ok')
  for (const model of result.models) {
    assert.equal('memory_available_gb' in model, false, 'pooled capacity must never be returned')
  }
  assert.equal(JSON.stringify(result).includes('memory_available_gb'), false)
})

test('projectDocument strips memory_available_gb wherever it appears', () => {
  const projected = projectDocument(sampleDocument())
  assert.equal(projected.ok, true)
  assert.equal('memory_available_gb' in projected.models[0], false)
})

test('memory_required_gb is preserved when present', async () => {
  const { spawn } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.models[0].memory_required_gb, 13.18)
})

test('useful advisory fields survive projection', async () => {
  const { spawn } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  const model = result.models[0]
  for (const field of ['name', 'provider', 'best_quant', 'quantization', 'fit_level', 'estimated_tps', 'runtime_label', 'score', 'effective_context_length']) {
    assert.ok(field in model, `advisory field "${field}" must be preserved`)
  }
})

test('the advisory boundary annotation is present on a successful result', async () => {
  const { spawn } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  assert.equal(result.advisoryBoundary, ADVISORY_BOUNDARY)
  assert.match(result.advisoryBoundary, /advisory only/)
  assert.match(result.advisoryBoundary, /execution remain with LionGateOS\/DeepSeek/)
})

test('no installed-model or execution authority is claimed by a result', async () => {
  const { spawn } = fakeSpawn()
  const result = await queryRecommend({
    useCase: 'coding', limit: 3, spawn, cwd: '/tmp', checkExecutable: executableOk,
  })
  const text = JSON.stringify(result)
  assert.equal(text.includes('installedCount'), false)
  assert.equal(text.includes('canLaunch'), false)
  assert.equal(text.includes('authorizedCapacity'), false)
})

// --- 18. Namespace guard --------------------------------------------------

test('off-allowlist llmfit tool names are denied by the namespace guard', async () => {
  const source = await getPluginSource()
  assert.match(source, /ctx\.tools\.guard\(/)
  assert.match(source, /NAMESPACE_PREFIX = 'llmfit'/)
  assert.match(source, /execution\.name === TOOL_NAME/)
  const { apply } = await import('../index.js')

  /** @type {Array<(e: {name: string}) => string | undefined>} */
  const guards = []
  const registered = []
  /** @type {Array<{ key: string, value: object }>} */
  const provided = []
  // `ctx.effect` accepts a generator; drive it so the registration body runs the
  // same way the loader runs it, without depending on a live Cordis scope.
  const runEffect = (register) => {
    if (typeof register === 'function' && register.constructor?.name === 'GeneratorFunction') {
      // Drain the effect generator: its first `next()` performs registration and
      // yields the disposer, which is discarded here.
      const iterator = register()
      let step = iterator.next()
      while (step.done !== true) step = iterator.next()
      return
    }
    register()
  }
  const ctx = {
    effect: runEffect,
    tools: {
      register: (definition) => { registered.push(definition); return () => {} },
      guard: (fn) => { guards.push(fn); return () => {} },
    },
    subprocess: { spawn: () => { throw new Error('not used in this test') } },
    reflect: { provide: (key, value) => { provided.push({ key, value }); return () => {} } },
  }
  apply(ctx, {})
  assert.equal(registered.length, 1, 'exactly one tool must be registered')
  assert.equal(registered[0].name, 'llmfit_recommend')
  assert.equal(guards.length, 1)
  assert.equal(provided.length, 1, 'the read-only advisory service must be provided exactly once')
  assert.equal(provided[0].key, 'llmfitAdvisor')
  assert.equal(typeof provided[0].value.recommend, 'function', 'the service exposes only the bounded advisory call')
  assert.deepEqual(Object.keys(provided[0].value), ['recommend'], 'the service surface must stay one method')

  const guard = guards[0]
  assert.equal(guard({ name: 'llmfit_recommend' }), undefined, 'the one tool must be allowed')
  for (const denied of ['llmfit_search', 'llmfit_download', 'llmfit_serve', 'llmfit_run', 'llmfit_bench']) {
    assert.match(String(guard({ name: denied })), /blocked/, `"${denied}" must be denied`)
  }
  assert.equal(guard({ name: 'bash' }), undefined, 'other tools must be unaffected')
})

test('the plugin registers exactly one tool and declares both services', async () => {
  const source = await getPluginSource()
  assert.match(source, /export const inject = \['tools', 'subprocess'\]/)
  assert.equal(source.match(/ctx\.tools\.register\(/g).length, 1)
})

// --- 19-20. No model execution, no network -------------------------------

test('the production adapter imports no process-execution or network module', async () => {
  const testDir = fileURLToPath(new URL('.', import.meta.url))
  const sources = await Promise.all([
    readFile(join(testDir, '..', 'core', 'advisor.js'), 'utf8'),
    readFile(join(testDir, '..', 'index.js'), 'utf8'),
  ])
  for (const source of sources) {
    // The adapter must receive a spawn function and must not own one: owning a
    // launcher here is how a "read-only" plugin silently becomes an executor.
    assert.equal(/from 'node:child_process'/.test(source), false)
    assert.equal(/\b(fetch|undici)\s*\(/.test(source), false)
    assert.equal(/from 'node:https?'/.test(source), false)
    assert.equal(/\bexecSync\b|\bspawnSync\b/.test(source), false)
  }
})

test('the adapter is wired to the injected subprocess service, not its own launcher', async () => {
  const testDir = fileURLToPath(new URL('.', import.meta.url))
  const source = await readFile(join(testDir, '..', 'index.js'), 'utf8')
  assert.match(source, /deps\.context\.subprocess\.spawn\(spec\)/)
})

test('the allowlist is exactly the six documented use-cases', () => {
  assert.deepEqual([...ALLOWED_USE_CASES], ['general', 'coding', 'reasoning', 'chat', 'multimodal', 'embedding'])
  assert.equal(MIN_LIMIT, 1)
  assert.equal(MAX_LIMIT, 10)
})

// --- Registry compatibility ----------------------------------------------

test('both tool schemas fall inside the registry supported JSON Schema subset', async () => {
  const { assertSupportedJsonSchema } = await import('../../packages/core/tools/src/json-schema.ts')
    .catch(() => ({ assertSupportedJsonSchema: undefined }))
  // The registry rejects `minimum`/`maximum` and a `json` root at registration,
  // so a schema the plugin never validates is a schema that breaks the load.
  // When the source module is reachable, assert against the real machinery.
  if (assertSupportedJsonSchema !== undefined) {
    const { createRecommendTool } = await import('../index.js')
    const definition = createRecommendTool({
      query: async () => ({}),
      checkExecutable: async () => {},
      context: { subprocess: { spawn() {} } },
      cwd: '/tmp',
      timeoutMs: 1000,
    })
    assert.doesNotThrow(() => assertSupportedJsonSchema(definition.parameters))
    assert.doesNotThrow(() => assertSupportedJsonSchema(definition.output.schema))
  }
  // Independently of that module, no unsupported keyword may appear.
  const source = await getPluginSource()
  assert.equal(/minimum:|maximum:/.test(source), false, 'minimum/maximum are unsupported keywords')
  assert.equal(/schema:\s*\{[^}]*type:\s*'json'/.test(source), false, "a 'json' root is author-only")
})
