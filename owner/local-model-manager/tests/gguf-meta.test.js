/**
 * GGUF header metadata tests: synthetic GGUF byte buffers built in-memory
 * cover the magic/version validation, scalar and string decoding, bounded
 * array skipping, truncation reporting, and fact extraction — no model
 * loading, no real GGUF files.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, rm } from 'node:fs/promises'

import { parseGgufHeader, ggufContextFacts, readGgufMeta } from '../core/gguf-meta.js'

/** GGUF value-type constants used by the synthetic encoder. */
const TYPE_UINT32 = 4
const TYPE_UINT64 = 10
const TYPE_FLOAT32 = 6
const TYPE_STRING = 8
const TYPE_ARRAY = 9

const u32 = (value) => {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value, 0)
  return buf
}
const u64 = (value) => {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(value), 0)
  return buf
}
const str = (text) => Buffer.concat([u64(text.length), Buffer.from(text, 'utf8')])
const enc = (type, key, valueBuf) => Buffer.concat([str(key), u32(type), valueBuf])

/** Build a v3 GGUF header with the given metadata entries. */
const buildGguf = (entries) => {
  const header = Buffer.concat([
    Buffer.from('GGUF', 'latin1'),
    u32(3),
    u64(0), // tensor count
    u64(entries.length),
  ])
  return Buffer.concat([header, ...entries])
}

test('parseGgufHeader rejects non-GGUF bytes and unsupported versions', () => {
  const badMagic = parseGgufHeader(Buffer.from('NOPE0000', 'latin1'))
  assert.equal(badMagic.ok, false)
  assert.match(badMagic.problem, /magic/)
  const badVersion = parseGgufHeader(Buffer.concat([Buffer.from('GGUF', 'latin1'), u32(9), u64(0), u64(0)]))
  assert.equal(badVersion.ok, false)
  assert.match(badVersion.problem, /version/)
})

test('parseGgufHeader decodes scalar and string metadata values', () => {
  const buf = buildGguf([
    enc(TYPE_STRING, 'general.architecture', str('qwen35')),
    enc(TYPE_UINT64, 'qwen35.context_length', u64(262144)),
    enc(TYPE_UINT32, 'qwen35.block_count', u32(64)),
    enc(TYPE_FLOAT32, 'qwen35.attention.key_length', Buffer.alloc(4)),
  ])
  const parsed = parseGgufHeader(buf)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.version, 3)
  assert.equal(parsed.kv['general.architecture'], 'qwen35')
  assert.equal(parsed.kv['qwen35.context_length'], 262144)
  assert.equal(parsed.kv['qwen35.block_count'], 64)
  assert.equal(parsed.truncated, undefined)
})

test('parseGgufHeader skips large string arrays without materializing them and reports truncation honestly', () => {
  const giantVocab = Buffer.concat([u64(300000), ...Array.from({ length: 300000 }, () => str('tok'))])
  const buf = buildGguf([
    enc(TYPE_STRING, 'general.architecture', str('llama')),
    // Architecture facts would sit after the vocab in a truncated parse budget.
    enc(TYPE_ARRAY, 'tokenizer.ggml.tokens', giantVocab),
    enc(TYPE_UINT64, 'llama.context_length', u64(131072)),
  ])
  const parsed = parseGgufHeader(buf.slice(0, 4 * 1024 * 1024), 4 * 1024 * 1024)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.kv['llama.context_length'], undefined)
  assert.equal(parsed.truncated, true)
})

test('ggufContextFacts extracts the advertised context per architecture', () => {
  const facts = ggufContextFacts({
    ok: true,
    kv: { 'general.architecture': 'qwen35', 'qwen35.context_length': 262144, 'qwen35.block_count': 64 },
  })
  assert.equal(facts.architecture, 'qwen35')
  assert.equal(facts.contextLength, 262144)
  assert.equal(facts.blockCount, 64)
})

test('ggufContextFacts discovers the architecture from the typed field when general.architecture is missing', () => {
  const facts = ggufContextFacts({
    ok: true,
    kv: { 'deepseek2.context_length': 163840 },
  })
  assert.equal(facts.architecture, 'deepseek2')
  assert.equal(facts.contextLength, 163840)
})

test('ggufContextFacts honestly reports a failed parse', () => {
  const facts = ggufContextFacts({ ok: false, problem: 'missing GGUF magic' })
  assert.equal(facts.contextLength, undefined)
  assert.match(facts.problem, /magic/)
})

test('readGgufMeta reads a synthetic GGUF file with an injected bounded read', async () => {
  const buf = buildGguf([
    enc(TYPE_STRING, 'general.architecture', str('qwen35')),
    enc(TYPE_UINT64, 'qwen35.context_length', u64(262144)),
  ])
  const filePath = join(tmpdir(), `lmm-gguf-test-${process.pid}-${Date.now()}.gguf`)
  try {
    await writeFile(filePath, buf)
    const result = await readGgufMeta(filePath)
    assert.equal(result.status, 'ok')
    assert.equal(result.facts.contextLength, 262144)
  } finally {
    await rm(filePath, { force: true })
  }
})

test('readGgufMeta reports unavailable for a missing file without throwing', async () => {
  const result = await readGgufMeta('/nonexistent/lmm-test-model.gguf')
  assert.equal(result.status, 'unavailable')
  assert.match(result.error, /could not open/)
})