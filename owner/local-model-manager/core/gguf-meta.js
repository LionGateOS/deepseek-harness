/**
 * Read-only GGUF header metadata parsing. Parses only the metadata key/value
 * section at the start of a GGUF file — no tensor data, no model loading —
 * with a bounded byte budget so a huge vocab array cannot exhaust memory.
 * Values needed by the context sizer (architecture, trained context length)
 * are read best-effort; truncation is reported, never guessed around.
 *
 * GGUF wire format (v2/v3): u32 magic "GGUF", u32 version, u64 tensor count,
 * u64 metadata count, then that many key/value pairs. Keys are u64-length
 * UTF-8 strings; value types are the GGUFMetadataType enum.
 */

/** Value-type constants from the GGUF spec (gguf-py / gguf.h GGUFMetadataType). */
const TYPE_UINT8 = 0
const TYPE_INT8 = 1
const TYPE_UINT16 = 2
const TYPE_INT16 = 3
const TYPE_UINT32 = 4
const TYPE_INT32 = 5
const TYPE_FLOAT32 = 6
const TYPE_BOOL = 7
const TYPE_STRING = 8
const TYPE_ARRAY = 9
const TYPE_UINT64 = 10
const TYPE_INT64 = 11
const TYPE_FLOAT64 = 12

const SCALAR_WIDTH = {
  [TYPE_UINT8]: 1,
  [TYPE_INT8]: 1,
  [TYPE_UINT16]: 2,
  [TYPE_INT16]: 2,
  [TYPE_UINT32]: 4,
  [TYPE_INT32]: 4,
  [TYPE_FLOAT32]: 4,
  [TYPE_BOOL]: 1,
  [TYPE_UINT64]: 8,
  [TYPE_INT64]: 8,
  [TYPE_FLOAT64]: 8,
}

/** Parse an unsigned 64-bit little-endian value as a safe JS number. */
const readU64 = (buf, offset) => {
  const lo = buf.readUInt32LE(offset)
  const hi = buf.readUInt32LE(offset + 4)
  if (hi > 0x1fffff) return Number.POSITIVE_INFINITY // beyond bounded parsing
  return hi * 0x100000000 + lo
}

/**
 * Incremental byte feed over (possibly partial) header bytes; supports
 * bounded reads that never need the tensor-data region.
 */
class ByteReader {
  /**
   * @param {Buffer} buf the buffered header bytes.
   * @param {number} limit maximum bytes this reader may consume.
   */
  constructor(buf, limit) {
    this.buf = buf
    this.limit = Math.min(limit, buf.length)
    this.pos = 0
    this.truncated = false
  }

  /** @returns {number} bytes still available under the limit. */
  get remaining() {
    return this.limit - this.pos
  }

  /** Mark truncation when a read needs more bytes than the limit allows. */
  #need(count) {
    if (this.remaining < count) {
      this.truncated = true
      return false
    }
    return true
  }

  /** @returns {number|undefined} u32, or undefined past the limit. */
  u32() {
    if (!this.#need(4)) return undefined
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  /** @returns {number|undefined} u64 (safe-number range), or undefined past the limit. */
  u64() {
    if (!this.#need(8)) return undefined
    const v = readU64(this.buf, this.pos)
    this.pos += 8
    return Number.isFinite(v) ? v : (this.truncated = true, undefined)
  }

  /** @returns {string|undefined} a GGUF string value, or undefined past the limit. */
  string() {
    const len = this.u64()
    if (len === undefined) return undefined
    if (!this.#need(len)) return undefined
    const text = this.buf.toString('utf8', this.pos, this.pos + len)
    this.pos += len
    return text
  }

  /**
   * Skip one array value without materializing it: consumes the element type
   * and count and advances by the wire size of the elements only.
   * @param {number} valueType declared array element type (for type 9 nested arrays).
   * @returns {boolean} true when the value was skipped within the limit.
   */
  skipArray(elementType) {
    const count = this.u64()
    if (count === undefined) return false
    if (elementType === TYPE_STRING) {
      for (let i = 0; i < count; i++) {
        const len = this.u64()
        if (len === undefined) return false
        if (!this.#need(len)) return false
        this.pos += len
      }
      return true
    }
    if (elementType === TYPE_ARRAY) {
      for (let i = 0; i < count; i++) {
        const nestedType = this.u32()
        if (nestedType === undefined) return false
        if (!this.skipArray(nestedType)) return false
      }
      return true
    }
    const width = SCALAR_WIDTH[elementType]
    if (width === undefined) return false
    const bytes = Number.isFinite(count) ? count * width : Number.POSITIVE_INFINITY
    if (!this.#need(bytes)) return false
    this.pos += bytes
    return true
  }

  /**
   * Read one complete KV value and return its decoded form; arrays are
   * skipped (only scalars/strings are useful metadata for sizing).
   * @param {number} type declared value type.
   * @returns {number|string|undefined|null} decoded value; null for skipped arrays.
   */
  value(type) {
    if (type === TYPE_UINT8 || type === TYPE_INT8 || type === TYPE_BOOL) {
      if (!this.#need(1)) return undefined
      const v = this.buf.readUInt8(this.pos)
      this.pos += 1
      return v
    }
    if (type === TYPE_UINT16 || type === TYPE_INT16) {
      const w = SCALAR_WIDTH[type]
      if (!this.#need(w)) return undefined
      const v = type === TYPE_UINT16 ? this.buf.readUInt16LE(this.pos) : this.buf.readInt16LE(this.pos)
      this.pos += w
      return v
    }
    if (type === TYPE_UINT32 || type === TYPE_INT32 || type === TYPE_FLOAT32) {
      if (!this.#need(4)) return undefined
      const v = type === TYPE_FLOAT32 ? this.buf.readFloatLE(this.pos) : this.buf.readUInt32LE(this.pos)
      this.pos += 4
      return v
    }
    if (type === TYPE_UINT64 || type === TYPE_INT64 || type === TYPE_FLOAT64) {
      if (!this.#need(8)) return undefined
      const v = type === TYPE_FLOAT64 ? this.buf.readDoubleLE(this.pos) : readU64(this.buf, this.pos)
      this.pos += 8
      return Number.isFinite(v) ? v : (this.truncated = true, undefined)
    }
    if (type === TYPE_STRING) return this.string()
    if (type === TYPE_ARRAY) {
      const elementType = this.u32()
      if (elementType === undefined) return undefined
      return this.skipArray(elementType) ? null : undefined
    }
    this.truncated = true
    return undefined
  }
}

/**
 * Pure GGUF metadata parser over the header bytes of one GGUF file.
 * @param {Buffer} buf the first bytes of a GGUF file.
 * @param {number} maxBytes parse budget: this many bytes, best-effort.
 * @returns {{ ok: boolean, version?: number, kv?: Record<string, number|string>, truncated?: boolean, problem?: string }}
 */
export const parseGgufHeader = (buf, maxBytes = 24 * 1024 * 1024) => {
  if (buf.length < 8) return { ok: false, problem: 'file too small to be a GGUF file' }
  if (buf.toString('latin1', 0, 4) !== 'GGUF') return { ok: false, problem: 'missing GGUF magic' }
  const version = buf.readUInt32LE(4)
  if (version !== 2 && version !== 3) return { ok: false, problem: `unsupported GGUF version ${version}` }
  const reader = new ByteReader(buf, maxBytes)
  reader.pos = 8
  const tensorCount = reader.u64()
  const kvCount = reader.u64()
  if (reader.truncated || tensorCount === undefined || kvCount === undefined) {
    return { ok: false, problem: 'GGUF header counts are outside the parse budget' }
  }
  const kv = {}
  let parsed = 0
  while (parsed < kvCount) {
    if (reader.truncated) break
    const key = reader.string()
    if (key === undefined) break
    const type = reader.u32()
    if (type === undefined) break
    const value = reader.value(type)
    if (reader.truncated) break
    kv[key] = value
    parsed += 1
  }
  return {
    ok: true,
    version,
    kv,
    ...(parsed < kvCount || reader.truncated ? { truncated: true } : {}),
  }
}

/**
 * Extract the metadata facts the context sizer uses. Keys follow the gguf
 * convention `<architecture>.<field>` plus `general.*`; an unknown
 * architecture has no field keys, so facts may be absent honestly.
 * @param {{ ok?: boolean, kv?: Record<string, number|string>, truncated?: boolean, problem?: string }} parsed
 * @returns {{ architecture?: string, contextLength?: number, blockCount?: number, kvHeads?: number, keyLength?: number, valueLength?: number, truncated?: boolean, problem?: string }}
 */
export const ggufContextFacts = (parsed) => {
  if (parsed?.ok !== true) return { problem: parsed?.problem ?? 'not parsed' }
  const kv = parsed.kv ?? {}
  const num = (key) => (typeof kv[key] === 'number' ? kv[key] : undefined)
  // Discover the architecture from its typed fields even when
  // general.architecture itself was beyond the parse budget.
  const contextKey = Object.keys(kv).find((k) => k.endsWith('.context_length'))
  const architecture = typeof kv['general.architecture'] === 'string'
    ? kv['general.architecture']
    : contextKey !== undefined ? contextKey.slice(0, -'.context_length'.length) : undefined
  const architectureKey = (field) => (architecture !== undefined ? `${architecture}.${field}` : undefined)
  const typedNum = (field) => {
    const key = architectureKey(field)
    return key === undefined ? undefined : num(key)
  }
  const contextLength = architecture !== undefined ? num(`${architecture}.context_length`) : undefined
  return {
    ...(architecture !== undefined ? { architecture } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(typedNum('block_count') !== undefined ? { blockCount: typedNum('block_count') } : {}),
    ...(typedNum('attention.head_count_kv') !== undefined ? { kvHeads: typedNum('attention.head_count_kv') } : {}),
    ...(typedNum('attention.key_length') !== undefined ? { keyLength: typedNum('attention.key_length') } : {}),
    ...(typedNum('attention.value_length') !== undefined ? { valueLength: typedNum('attention.value_length') } : {}),
    ...(parsed.truncated === true ? { truncated: true } : {}),
    ...(parsed.problem !== undefined ? { problem: parsed.problem } : {}),
  }
}

const GGUF_FD_CHUNK = 1024 * 1024

/**
 * Read one GGUF file's header metadata with an open() handle-free bounded
 * sequential read. Reads at most maxBytes; tokenizer arrays larger than the
 * budget truncate parsing (reported), and no tensor data is touched.
 * @param {string} ggufPath absolute path to the GGUF file.
 * @param {{ open?: typeof import('node:fs/promises').open, maxBytes?: number }} [deps] injectables for tests.
 * @returns {Promise<{ status: 'ok'|'unavailable', facts?: object, error?: string }>}
 */
export const readGgufMeta = async (ggufPath, deps = {}) => {
  if (typeof ggufPath !== 'string' || !ggufPath.startsWith('/')) {
    return { status: 'unavailable', error: 'ggufPath must be an absolute path' }
  }
  const doOpen = deps.open ?? (await import('node:fs/promises')).open
  const maxBytes = deps.maxBytes ?? 24 * 1024 * 1024
  let handle
  try {
    handle = await doOpen(ggufPath, 'r')
  } catch (error) {
    return { status: 'unavailable', error: `could not open the model file (${error instanceof Error ? error.message : String(error)})` }
  }
  const chunks = []
  let total = 0
  try {
    while (total < maxBytes) {
      const size = Math.min(GGUF_FD_CHUNK, maxBytes - total)
      const buf = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buf, 0, size, total)
      if (bytesRead === 0) break
      if (bytesRead < size) {
        chunks.push(buf.subarray(0, bytesRead))
        total += bytesRead
        break
      }
      chunks.push(buf.subarray(0, bytesRead))
      total += bytesRead
    }
  } catch (error) {
    return { status: 'unavailable', error: `could not read the model file (${error instanceof Error ? error.message : String(error)})` }
  } finally {
    await handle.close().catch(() => { /* best-effort close after a read failure */ })
  }
  const parsed = parseGgufHeader(Buffer.concat(chunks), total)
  if (parsed.ok !== true) return { status: 'unavailable', error: parsed.problem ?? 'not a parsable GGUF header' }
  return { status: 'ok', facts: ggufContextFacts(parsed) }
}