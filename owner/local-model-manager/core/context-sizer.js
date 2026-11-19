/**
 * Context selection: one pure decision per model that turns every available
 * evidence source into the safest usable context configuration. Evidence
 * precedence is explicit and labeled:
 *
 * - `manual override` (owner-authored, persisted) always wins and is exposed
 *   as a manual selection, not silently re-derived.
 * - otherwise the selection is the minimum of every automatic bound:
 *   the owner-configured provider window, the model's advertised
 *   (trained) context from GGUF metadata, and the hardware cap the owner
 *   recorded for this machine.
 *
 * The automatic path never selects above the configured value: raising a
 * window changes VRAM residency and compaction economics and must remain an
 * owner decision (config value, manual override, or a supervised run). The
 * DSH-side usable budget (selected − reserved output − headroom) is reported,
 * never used to raise the runtime context.
 */

/** Context values are token counts and must stay positive integers. */
const isPositiveInt = (value) => typeof value === 'number' && Number.isInteger(value) && value > 0

/**
 * Build the runtime context argument vector for one selected value. The
 * trusted launcher derives `-c` from the provider config itself; because
 * llama.cpp arguments are last-wins, an appended duplicate reliably pins the
 * selected value over the launcher's own derivation.
 * @param {number} selected selected context in tokens.
 * @returns {string[]} argv fragment to append after the launcher's own args.
 */
export const contextArgv = (selected) => {
  if (!isPositiveInt(selected)) return []
  return ['-c', String(selected)]
}

/**
 * True when a launch-flags argument vector would fight the appended context:
 * llama.cpp last-wins parsing makes an owner `-c` inside launchArgs an
 * ambiguous override, so the launch path refuses it loudly instead.
 * @param {string[]} launchArgs configured launch flags.
 * @returns {string|undefined} the offending flag, when present.
 */
export const conflictingContextFlag = (launchArgs) => {
  for (const arg of launchArgs) {
    if (arg === '-c' || arg === '--ctx-size') return arg
    if (arg.startsWith('-c=') || arg.startsWith('--ctx-size=')) return arg.split('=')[0]
  }
  return undefined
}

/**
 * Compute the selected context for one model from every known bound.
 * @param {{advertised?: number, configured?: number, hardwareCap?: number, override?: number}} bounds evidence bounds.
 * @returns {{selected: number|undefined, source: 'manual'|'auto'|'unavailable', bounds: {advertised?: number, configured?: number, hardwareCap?: number, override?: number}, reasons: string[]}}
 */
export const selectContext = (bounds) => {
  const { advertised, configured, hardwareCap, override } = bounds
  const reasons = []
  if (override !== undefined) {
    if (!isPositiveInt(override)) {
      reasons.push('the stored manual override is not a positive integer, so it was ignored')
    } else {
      if (advertised !== undefined && override > advertised) {
        reasons.push(`manual override ${override} exceeds the advertised context ${advertised} (the engine may reduce or reject it)`)
      }
      if (hardwareCap !== undefined && override > hardwareCap) {
        reasons.push(`manual override ${override} exceeds the configured hardware cap ${hardwareCap}`)
      }
      return { selected: override, source: 'manual', bounds, reasons }
    }
  }
  const usable = (value) => value !== undefined && isPositiveInt(value)
  const candidates = { configured, advertised, hardwareCap }
  const kinds = ['configured', 'advertised', 'hardwareCap'].filter((kind) => usable(candidates[kind]))
  if (kinds.length === 0) {
    return { selected: undefined, source: 'unavailable', bounds, reasons: ['no context evidence is readable for this model'] }
  }
  const selected = Math.min(...kinds.map((kind) => candidates[kind]))
  if (kinds.includes('advertised') && advertised < configured) {
    reasons.push(`the model advertises ${advertised} tokens, so the configured ${configured} was lowered to the advertised bound`)
  }
  if (kinds.includes('hardwareCap') && hardwareCap === selected) {
    reasons.push(`the configured hardware cap (${hardwareCap}) limits the usable context`)
  }
  return { selected, source: 'auto', bounds, reasons }
}

/**
 * DSH-side usable budget: the tokens a session may actually spend after the
 * routed request reserves output tokens and the compaction headroom that
 * absorbs system-prompt sections and tool schemas. Mirrors the compaction
 * contract (`contextWindow − reservedCompletionTokens − headroomTokens`).
 * @param {number|undefined} selected runtime context in tokens.
 * @param {{reservedOutputTokens: number, headroomTokens: number}} reservation configured output/headroom reservation.
 * @returns {{usable: number|undefined, exhausted: boolean|undefined}}
 */
export const dshUsableContext = (selected, reservation) => {
  if (!isPositiveInt(selected)) return { usable: undefined, exhausted: undefined }
  const usable = selected - reservation.reservedOutputTokens - reservation.headroomTokens
  if (usable > 0) return { usable, exhausted: false }
  return { usable: undefined, exhausted: true }
}