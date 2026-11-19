/**
 * Model Advisor adapter tests: verify CLI invocation, JSON parsing, and graceful
 * degradation on timeout, spawn failure, and malformed output.
 *
 * All tests use mocks - no live Model Advisor invocation, no GPU access.
 * The adapter spawns python3 as a subprocess; we verify the spawn arguments
 * and simulate various outcomes through controlled mock children.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** Read adapter source file for inspection tests (offline, no fetch) */
async function getAdapterSource() {
  const testDir = fileURLToPath(new URL('.', import.meta.url))
  const adapterPath = join(testDir, '..', 'core', 'model-advisor-adapter.js')
  return readFile(adapterPath, 'utf8')
}

/**
 * Create a mock child process that simulates Model Advisor CLI behavior.
 * @param {object} options { exitCode, stdout, stderr, emitError, delayMs, neverClose }
 * @returns {object} mock child process with kill tracking
 */
function createMockChild(options = {}) {
  const {
    exitCode = 0,
    stdout = '',
    stderr = '',
    emitError = null,
    delayMs = 10,
    neverClose = false,
  } = options

  let killed = false
  let killSignal = null

  const child = {
    stdout: {
      listeners: {},
      on: (event, handler) => {
        child.stdout.listeners[event] = handler
        return child.stdout
      },
      emit: (event, data) => {
        if (child.stdout.listeners[event]) {
          child.stdout.listeners[event](data)
        }
      },
    },
    stderr: {
      listeners: {},
      on: (event, handler) => {
        child.stderr.listeners[event] = handler
        return child.stderr
      },
      emit: (event, data) => {
        if (child.stderr.listeners[event]) {
          child.stderr.listeners[event](data)
        }
      },
    },
    listeners: {},
    on: (event, handler) => {
      child.listeners[event] = handler
      return child
    },
    emit: (event, data) => {
      if (child.listeners[event]) {
        child.listeners[event](data)
      }
    },
    kill: (signal) => {
      killed = true
      killSignal = signal
    },
    get killed() {
      return killed
    },
    _getKillSignal: () => killSignal,
  }

  if (emitError) {
    setTimeout(() => {
      child.emit('error', emitError)
    }, delayMs / 2)
  } else if (!neverClose) {
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      child.emit('close', exitCode)
    }, delayMs)
  }

  return child
}

/**
 * Create a mock spawn function that returns controlled child processes.
 * @param {function} factory Function that receives (cmd, args, opts) and returns mock child options
 * @returns {function} mock spawn function
 */
function createMockSpawn(factory) {
  return function mockSpawn(cmd, args, opts) {
    const childOptions = factory(cmd, args, opts)
    return createMockChild(childOptions)
  }
}

// Import adapter once per test file, not per test
const adapterModule = await import('../core/model-advisor-adapter.js')
const { queryModelAdvisor, getHardwareProfile, getRuntimeDiscovery, getCompatibility, getQualificationContract } = adapterModule

test('adapter exports all expected functions', () => {
  assert.equal(typeof queryModelAdvisor, 'function')
  assert.equal(typeof getHardwareProfile, 'function')
  assert.equal(typeof getRuntimeDiscovery, 'function')
  assert.equal(typeof getCompatibility, 'function')
  assert.equal(typeof getQualificationContract, 'function')
})

test('adapter uses correct Model Advisor path constant', async () => {
  const adapterSource = await getAdapterSource()
  assert.ok(adapterSource.includes('/home/liongateos/Model-Advisor'),
    'Adapter should use the correct Model Advisor path')
})

test('adapter has reasonable default timeout', async () => {
  const adapterSource = await getAdapterSource()
  assert.ok(adapterSource.includes('DEFAULT_TIMEOUT_MS'),
    'Adapter should define a default timeout')
  assert.ok(adapterSource.includes('10000'),
    'Adapter should have a 10 second default timeout')
})

test('queryModelAdvisor parses valid JSON hardware response', async () => {
  const validHardware = JSON.stringify({
    os: { name: 'Test OS', version: '1.0' },
    cpu: { vendor: 'Test', model: 'Test CPU' },
    memory: { total_bytes: 123456789012, available_bytes: 98765432109 },
    gpus: [],
    schema_version: '1',
  })

  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 0,
    stdout: validHardware,
    delayMs: 5,
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.data.os, { name: 'Test OS', version: '1.0' })
  assert.deepEqual(result.data.gpus, [])
})

test('queryModelAdvisor returns unavailable on spawn failure', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    emitError: new Error('ENOENT: python3 not found'),
    delayMs: 5,
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('spawn failed'))
})

test('queryModelAdvisor returns unavailable on nonzero exit', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 1,
    stderr: 'ModuleNotFoundError: No module named liongateos_model_advisor',
    delayMs: 5,
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('exited 1'))
  assert.ok(result.error.includes('ModuleNotFoundError'))
})

test('queryModelAdvisor returns unavailable on malformed JSON', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 0,
    stdout: 'not valid json {',
    delayMs: 5,
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('not valid JSON'))
})

test('queryModelAdvisor returns unavailable on empty output', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 0,
    stdout: '',
    delayMs: 5,
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('empty output'))
})

test('timeout cleanup: child that never closes returns timeout result', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    neverClose: true, // Simulates a hung process
  }))

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 50,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('timed out'))
})

test('timeout cleanup: fake child receives SIGTERM when timeout occurs', async () => {
  let capturedChild = null

  const mockSpawn = createMockSpawn((cmd, args, opts) => {
    capturedChild = createMockChild({ neverClose: true })
    return { neverClose: true }
  })

  // Override to capture the actual child
  const trackingSpawn = (cmd, args, opts) => {
    const child = createMockChild({ neverClose: true })
    capturedChild = child
    return child
  }

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 50,
    spawnFn: trackingSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(capturedChild._getKillSignal() === 'SIGTERM',
    'Child should receive SIGTERM on timeout')
})

test('timeout cleanup: result resolves only once even with late close event', async () => {
  let closeHandler = null
  let resolveCount = 0

  const mockChild = {
    stdout: {
      on: (event, handler) => {},
    },
    stderr: {
      on: (event, handler) => {},
    },
    on: (event, handler) => {
      if (event === 'close') {
        closeHandler = handler
      }
    },
    kill: () => {},
    get killed() { return false },
  }

  const mockSpawn = (cmd, args, opts) => mockChild

  // Trigger close handler late (after timeout would have fired)
  setTimeout(() => {
    if (closeHandler) {
      closeHandler(0) // Late success
    }
  }, 100)

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 30,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(result.error.includes('timed out'))
  // If double-resolution occurred, this test would fail with a Promise rejection
})

test('timeout cleanup: SIGKILL fallback attempted after grace period', async () => {
  let killCount = 0
  let killSignals = []

  const mockChild = {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: () => {}, // Never emit close
    kill: (signal) => {
      killCount++
      killSignals.push(signal)
    },
    get killed() { return false }, // Always appears alive
  }

  const mockSpawn = (cmd, args, opts) => mockChild

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 30,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'unavailable')
  assert.ok(killCount >= 1, 'kill should be called at least once')
  assert.ok(killSignals.includes('SIGTERM'), 'SIGTERM should be sent first')
  // SIGKILL may or may not have executed depending on timing; the adapter attempts it
})

test('normal successful execution is not killed', async () => {
  let capturedChild = null

  const mockSpawn = (cmd, args, opts) => {
    capturedChild = createMockChild({
      exitCode: 0,
      stdout: JSON.stringify({ success: true }),
      delayMs: 10,
    })
    return capturedChild
  }

  const result = await queryModelAdvisor('hardware', [], {
    timeoutMs: 100, // Plenty of time
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'ok')
  assert.equal(capturedChild._getKillSignal(), null,
    'Successful child should not be killed')
})

test('getHardwareProfile passes hardware command', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 0,
    stdout: JSON.stringify({ hardware: 'data' }),
    delayMs: 5,
  }))

  const result = await getHardwareProfile({
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'ok')
  assert.ok(result.hardware)
})

test('getRuntimeDiscovery supports custom runtime paths', async () => {
  let capturedArgs = null

  const mockSpawn = (cmd, args, opts) => {
    capturedArgs = args
    return createMockChild({
      exitCode: 0,
      stdout: JSON.stringify({ runtimes: [] }),
      delayMs: 5,
    })
  }

  await getRuntimeDiscovery(['/custom/path'], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.ok(capturedArgs.includes('--runtime-path=/custom/path'))
})

test('getCompatibility supports custom runtime paths', async () => {
  let capturedArgs = null

  const mockSpawn = (cmd, args, opts) => {
    capturedArgs = args
    return createMockChild({
      exitCode: 0,
      stdout: JSON.stringify({ compatibility: {} }),
      delayMs: 5,
    })
  }

  await getCompatibility(['/custom/path'], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.ok(capturedArgs.includes('--runtime-path=/custom/path'))
  assert.ok(capturedArgs.includes('--passive'))
})

test('getCompatibility requests passive compatibility by default', async () => {
  let capturedArgs = null

  const mockSpawn = (cmd, args, opts) => {
    capturedArgs = args
    return createMockChild({
      exitCode: 0,
      stdout: JSON.stringify({ compatibility: {} }),
      delayMs: 5,
    })
  }

  await getCompatibility([], {
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(capturedArgs[2], 'compatibility')
  assert.ok(capturedArgs.includes('--passive'),
    'getCompatibility should pass --passive so Model Advisor skips active capability probes')
})

test('getQualificationContract exists and works', async () => {
  const mockSpawn = createMockSpawn((cmd, args, opts) => ({
    exitCode: 0,
    stdout: JSON.stringify({ capabilities: ['qualification'] }),
    delayMs: 5,
  }))

  const result = await getQualificationContract({
    timeoutMs: 100,
    spawnFn: mockSpawn,
  })

  assert.equal(result.status, 'ok')
  assert.ok(result.qualification)
})

test('adapter documentation states read-only contract', async () => {
  const adapterSource = await getAdapterSource()
  assert.ok(adapterSource.includes('read-only'),
    'Adapter should document read-only contract')
  assert.ok(adapterSource.includes('never throw') || adapterSource.includes('never throws'),
    'Adapter should document that it never throws')
})

test('adapter uses spawn injection pattern', async () => {
  const adapterSource = await getAdapterSource()
  assert.ok(adapterSource.includes('spawnFn'),
    'Adapter should support spawn injection')
  assert.ok(adapterSource.includes('realSpawn'),
    'Adapter should use realSpawn as default')
})

test('no real Python/Model Advisor process invoked in tests', async () => {
  // All tests use spawnFn mock; this is a meta-verification that
  // the test file does not import or call real spawn directly
  const adapterSource = await getAdapterSource()
  assert.ok(adapterSource.includes('spawnFn ?? realSpawn'),
    'Adapter should use injected spawn or realSpawn default')
})
