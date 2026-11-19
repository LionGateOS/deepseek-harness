/**
 * GPU inspection coverage: CSV parsing of the read-only nvidia-smi queries
 * (identity, memory, utilization, and live wattage) and explicit degradation
 * when the query is unavailable. The protected GPU identity never depends on a
 * working query — it comes from config.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseGpuLine, parseComputeAppLine, queryGpus } from '../core/gpus.js'

const GPU_COLUMNS = 'index,name,uuid,memory.used,memory.total,utilization.gpu'
const POWER_COLUMNS = 'power.draw.instant,power.draw,power.limit'
const FREE_COLUMNS = 'memory.free'

test('nvidia-smi CSV rows parse into structured GPU facts', () => {
  assert.deepEqual(
    parseGpuLine('0, NVIDIA GeForce RTX 3090, GPU-4144e557-ad9a-83b3-014a-61f67141c547, 18743, 24576, 42'),
    {
      uuid: 'GPU-4144e557-ad9a-83b3-014a-61f67141c547',
      name: 'NVIDIA GeForce RTX 3090',
      index: 0,
      memUsedMiB: 18743,
      memTotalMiB: 24576,
      utilizationPct: 42,
      powerDrawW: null,
      powerLimitW: null,
    },
  )
  assert.equal(parseGpuLine('garbage'), null)
})

test('a row with wattage columns parses the decimal instant reading', () => {
  const row = parseGpuLine('0, NVIDIA GeForce RTX 3090, GPU-4144e557, 18743, 24576, 42, 318.47, 305.12, 350.00')
  assert.equal(row.powerDrawW, 318.47, 'power.draw.instant wins over power.draw')
  assert.equal(row.powerLimitW, 350)
  // The pre-existing facts are untouched by the added columns.
  assert.equal(row.uuid, 'GPU-4144e557')
  assert.equal(row.name, 'NVIDIA GeForce RTX 3090')
  assert.equal(row.index, 0)
  assert.equal(row.memUsedMiB, 18743)
  assert.equal(row.memTotalMiB, 24576)
  assert.equal(row.utilizationPct, 42)
})

test('the RTX 3090 Ti row keeps its own identity and wattage', () => {
  const row = parseGpuLine('1, NVIDIA GeForce RTX 3090 Ti, GPU-009aea9f-7c11, 23000, 24576, 97, 421.09, 419.5, 450.00')
  assert.equal(row.uuid, 'GPU-009aea9f-7c11')
  assert.equal(row.name, 'NVIDIA GeForce RTX 3090 Ti')
  assert.equal(row.powerDrawW, 421.09)
  assert.equal(row.powerLimitW, 450)
})

test('an unsupported instant reading falls back to power.draw', () => {
  const row = parseGpuLine('0, RTX 3090, GPU-x, 100, 24576, 0, [N/A], 87.5, 350.00')
  assert.equal(row.powerDrawW, 87.5, 'the average reading is used when the instant one is unsupported')
  assert.equal(row.powerLimitW, 350)
})

test('blank, malformed, and unsupported wattage cells stay explicitly unavailable', () => {
  const unsupported = parseGpuLine('0, RTX 3090, GPU-x, 100, 24576, 0, [N/A], [Not Supported], [N/A]')
  assert.equal(unsupported.powerDrawW, null)
  assert.equal(unsupported.powerLimitW, null)
  assert.equal(unsupported.memTotalMiB, 24576, 'a missing wattage reading must not drop the card facts')

  const blank = parseGpuLine('0, RTX 3090, GPU-x, 100, 24576, 0, , , ')
  assert.equal(blank.powerDrawW, null)
  assert.equal(blank.powerLimitW, null)

  const malformed = parseGpuLine('0, RTX 3090, GPU-x, 100, 24576, 0, 3x8.4, 12 W, -5')
  assert.equal(malformed.powerDrawW, 12, 'a trailing W is accepted; garbage and negatives are not')
  assert.equal(malformed.powerLimitW, null)

  const negative = parseGpuLine('0, RTX 3090, GPU-x, 100, 24576, 0, -1.5, -2, 350')
  assert.equal(negative.powerDrawW, null)
  assert.equal(negative.powerLimitW, 350)
})

test('compute-app rows map to their owning GPU UUID', () => {
  assert.deepEqual(
    parseComputeAppLine('GPU-4144e557-ad9a-83b3-014a-61f67141c547, 12345, llama-server, 18200'),
    { uuid: 'GPU-4144e557-ad9a-83b3-014a-61f67141c547', pid: 12345, processName: 'llama-server', memUsedMiB: 18200 },
  )
  assert.equal(parseComputeAppLine('x, y'), null)
})

test('queryGpus requests the wattage columns after the existing ones', async () => {
  const queryArgs = []
  await queryGpus(50, {
    execFile: async (_bin, args) => {
      if (!args[0].includes('compute-apps')) queryArgs.push(args[0])
      return { stdout: args[0].includes('compute-apps') ? '' : '0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00' }
    },
  })
  assert.deepEqual(
    queryArgs,
    [`--query-gpu=${GPU_COLUMNS},${POWER_COLUMNS},${FREE_COLUMNS}`],
    'identity, memory, and utilization come first; wattage and free memory are appended',
  )
  assert.match(queryArgs[0], /power\.draw\.instant,power\.draw,power\.limit/)
})

test('queryGpus degrades to an explicit unavailable state without throwing', async () => {
  const ok = await queryGpus(50, {
    execFile: async (_bin, args) => ({
      stdout: args[0].includes('compute-apps')
        ? 'GPU-case, 1234, llama-server, 95'
        : '0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00',
    }),
  })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.gpus.length, 1)
  assert.equal(ok.gpus[0].powerDrawW, 300.5)
  assert.equal(ok.gpus[0].powerLimitW, 350)
  assert.deepEqual(ok.processes, [{ uuid: 'GPU-case', pid: 1234, processName: 'llama-server', memUsedMiB: 95 }])

  const failed = await queryGpus(50, {
    execFile: async () => { throw new Error('NVIDIA-SMI has failed\nmore detail') },
  })
  assert.equal(failed.status, 'unavailable')
  assert.match(failed.error, /NVIDIA-SMI has failed/)
})

test('a driver that rejects the power fields still reports memory and utilization', async () => {
  const attempts = []
  const result = await queryGpus(50, {
    execFile: async (_bin, args) => {
      const query = args[0]
      if (query.includes('compute-apps')) return { stdout: '' }
      attempts.push(query)
      if (query.includes('power')) throw new Error('Field "power.draw.instant" is not a valid field to query.')
      return { stdout: '0, RTX 3090, GPU-case, 18743, 24576, 42' }
    },
  })
  assert.equal(result.status, 'ok', 'the reduced query keeps the card visible')
  assert.equal(result.gpus[0].memUsedMiB, 18743)
  assert.equal(result.gpus[0].utilizationPct, 42)
  assert.equal(result.gpus[0].powerDrawW, null)
  assert.equal(result.gpus[0].powerLimitW, null)
  assert.deepEqual(
    attempts,
    [`--query-gpu=${GPU_COLUMNS},${POWER_COLUMNS},${FREE_COLUMNS}`, `--query-gpu=${GPU_COLUMNS},${POWER_COLUMNS}`, `--query-gpu=${GPU_COLUMNS}`],
    'each fallback omits the trailing fields the driver rejected',
  )
})

test('free VRAM is reported per GPU from the driver, not derived', () => {
  const row = parseGpuLine('0, RTX 3090, GPU-case, 18743, 24576, 42, 318.47, 305.12, 350.00, 4021')
  assert.equal(row.memFreeMiB, 4021, 'driver-reported free memory is kept as its own fact')
  assert.equal(row.memTotalMiB, 24576)
  assert.equal(row.memUsedMiB, 18743)
})

test('free VRAM is absent rather than guessed when the row omits the column', () => {
  const row = parseGpuLine('0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00')
  assert.equal(Object.hasOwn(row, 'memFreeMiB'), false, 'no free figure is invented from used and total')
})

test('free VRAM is dropped when the free column is not a plain integer', () => {
  const notSupported = parseGpuLine('0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00, [N/A]')
  assert.equal(Object.hasOwn(notSupported, 'memFreeMiB'), false)
  const blank = parseGpuLine('0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00, ')
  assert.equal(Object.hasOwn(blank, 'memFreeMiB'), false)
})

test('queryGpus asks for free memory on every card', async () => {
  const queryArgs = []
  await queryGpus(50, {
    execFile: async (_bin, args) => {
      if (!args[0].includes('compute-apps')) queryArgs.push(args[0])
      return { stdout: args[0].includes('compute-apps') ? '' : '0, RTX 3090, GPU-case, 100, 24576, 0, 300.5, 299.0, 350.00, 4096' }
    },
  })
  assert.equal(queryArgs.length, 1)
  assert.match(queryArgs[0], /memory\.free/, 'the query carries the free-memory field')
  assert.match(queryArgs[0], /power\.draw\.instant,power\.draw,power\.limit,memory\.free/, 'free memory is appended last')
})

test('a driver without free memory keeps the wattage and memory facts', async () => {
  const attempts = []
  const result = await queryGpus(50, {
    execFile: async (_bin, args) => {
      const query = args[0]
      if (query.includes('compute-apps')) return { stdout: '' }
      attempts.push(query)
      if (query.includes('memory.free')) throw new Error('Field "memory.free" is not a valid field to query.')
      return { stdout: '0, RTX 3090, GPU-case, 18743, 24576, 42, 318.47, 305.12, 350.00' }
    },
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.gpus[0].powerDrawW, 318.47, 'wattage survives a missing free reading')
  assert.equal(result.gpus[0].memUsedMiB, 18743)
  assert.equal(result.gpus[0].memFreeMiB, undefined)
  assert.deepEqual(attempts, [`--query-gpu=${GPU_COLUMNS},${POWER_COLUMNS},${FREE_COLUMNS}`, `--query-gpu=${GPU_COLUMNS},${POWER_COLUMNS}`])
})
