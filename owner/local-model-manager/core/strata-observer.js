import { readFile } from 'node:fs/promises'

export const STRATA_MODEL_MODE_PATH =
  '/home/liongateos/.local/share/strata/install/model-mode'
export const STRATA_GPU_MODE_PATH =
  '/home/liongateos/.local/share/strata/install/gpu-mode'

const MODELS = Object.freeze({
  iq3xxs: Object.freeze({
    key: 'iq3xxs',
    id: 'qwen3.8-flash-next-iq3_xxs',
    name: 'Qwen3.8-Flash-Next IQ3_XXS',
    contextWindow: 131072,
    vision: true,
  }),
  deepseek: Object.freeze({
    key: 'deepseek',
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1-Flash 2.25 bpw',
    contextWindow: 131072,
    vision: true,
  }),
})

const GPU_MODES = Object.freeze({
  gpu0: Object.freeze({
    key: 'gpu0',
    label: 'RTX 3090 only',
    gpuIndexes: [0],
  }),
  gpu1: Object.freeze({
    key: 'gpu1',
    label: 'RTX 3090 Ti only',
    gpuIndexes: [1],
  }),
  gpu01: Object.freeze({
    key: 'gpu01',
    label: 'RTX 3090 + RTX 3090 Ti',
    gpuIndexes: [0, 1],
  }),
})

async function readChoice(path, allowed, read) {
  try {
    const raw = String(await read(path, 'utf8')).trim()
    if (Object.hasOwn(allowed, raw)) return { status: 'ok', value: raw }
    return { status: 'unavailable', error: `unrecognized value "${raw}"` }
  } catch (error) {
    return {
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Read Strata's existing owner-controlled model/GPU selections.
 *
 * This observer is deliberately read-only. It never starts, stops, switches,
 * rewrites, reserves, locks, or otherwise controls Strata or either GPU.
 */
export async function readStrataStatus({
  read = readFile,
  modelModePath = STRATA_MODEL_MODE_PATH,
  gpuModePath = STRATA_GPU_MODE_PATH,
} = {}) {
  const [modelChoice, gpuChoice] = await Promise.all([
    readChoice(modelModePath, MODELS, read),
    readChoice(gpuModePath, GPU_MODES, read),
  ])

  return {
    authority: 'Strata Control Panel',
    control: 'read-only',
    endpoint: 'http://127.0.0.1:8080',
    installedModels: Object.values(MODELS),
    modelSelection: modelChoice.status === 'ok'
      ? { status: 'ok', ...MODELS[modelChoice.value] }
      : modelChoice,
    gpuSelection: gpuChoice.status === 'ok'
      ? { status: 'ok', ...GPU_MODES[gpuChoice.value] }
      : gpuChoice,
  }
}
