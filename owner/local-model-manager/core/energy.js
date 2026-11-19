/**
 * Energy integration over timestamped power samples. Pure: no clock, no I/O,
 * no knowledge of where samples came from, so every rule here is testable
 * offline and the caller owns all timing decisions.
 *
 * Two invariants matter more than the arithmetic:
 *  - a span the samples do not cover is reported as a gap, never extrapolated;
 *  - every interval is split at the tariff boundary it crosses, so a job that
 *    runs across a price change is priced piece by piece at each real rate.
 */

import { periodAt, splitAtBoundaries } from './tariff.js'

/**
 * Integrate power over `[fromMs, toMs]` at a constant wattage.
 * @param {number} watts average power for the span.
 * @param {number} fromMs span start.
 * @param {number} toMs span end.
 * @returns {number} energy in watt-hours.
 */
export const intervalWh = (watts, fromMs, toMs) => {
  const seconds = (toMs - fromMs) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(watts)) return 0
  return (watts * seconds) / 3600
}

/**
 * Cost of one energy amount at one TOU rate.
 * @param {number} wh energy in watt-hours.
 * @param {number} centsPerKwh the TOU energy component.
 * @returns {number} cost in cents.
 */
export const costCents = (wh, centsPerKwh) => (wh / 1000) * centsPerKwh

/**
 * Steady-state cost per hour at a given draw and rate.
 * @param {number} watts current draw.
 * @param {number} centsPerKwh the TOU energy component.
 * @returns {number} cents per hour, or null when the draw is unknown.
 */
export const centsPerHour = (watts, centsPerKwh) => {
  if (!Number.isFinite(watts) || watts < 0 || !Number.isFinite(centsPerKwh)) return null
  return (watts / 1000) * centsPerKwh
}

/** Samples closer together than this integrate as one interval; a longer hole is a gap. */
export const DEFAULT_MAX_GAP_MS = 3000

/**
 * Keep only usable samples, sorted by time. A sample without a finite,
 * non-negative wattage cannot contribute and is dropped rather than read as 0,
 * which would silently deflate the total.
 * @param {Array<{t: number, watts: number}>} samples raw samples.
 * @returns {Array<{t: number, watts: number}>} sorted, usable samples.
 */
export const usableSamples = (samples) => {
  const kept = []
  for (const sample of samples ?? []) {
    if (!sample || typeof sample !== 'object') continue
    const { t, watts } = sample
    if (!Number.isFinite(t) || !Number.isFinite(watts) || watts < 0) continue
    kept.push({ t, watts })
  }
  return kept.sort((a, b) => a.t - b.t)
}

/**
 * Energy and cost over a span, with the uncovered part reported as gaps.
 *
 * Coverage is the fraction of the span that measurement actually observed.
 * The result is deliberately not scaled up to fill gaps: a partial figure stays
 * partial, and the caller decides how to present it.
 *
 * @param {Array<{t: number, watts: number}>} samples timestamped power samples in watts.
 * @param {number} fromMs span start.
 * @param {number} toMs span end.
 * @param {{maxGapMs?: number}} [options] gap threshold, defaulting to {@link DEFAULT_MAX_GAP_MS}.
 * @returns {{wh: number, cents: number, coverage: number, coveredMs: number, gapMs: number, sampleCount: number, pieces: Array<object>, energyPieces: Array<{fromMs: number, toMs: number, wh: number}>, gaps: Array<{fromMs: number, toMs: number}>}} the integration.
 */
export const integrate = (samples, fromMs, toMs, options = {}) => {
  const maxGapMs = Number.isFinite(options.maxGapMs) ? options.maxGapMs : DEFAULT_MAX_GAP_MS
  const span = toMs - fromMs
  const empty = {
    wh: 0,
    cents: 0,
    coverage: 0,
    coveredMs: 0,
    gapMs: span > 0 ? span : 0,
    sampleCount: 0,
    pieces: [],
    energyPieces: [],
    gaps: span > 0 ? [{ fromMs, toMs }] : [],
  }
  if (!Number.isFinite(span) || span <= 0) return empty
  const points = usableSamples(samples)
  if (points.length < 2) return { ...empty, sampleCount: points.length }

  const pieces = []
  const energyPieces = []
  const gaps = []
  let wh = 0
  let cents = 0
  let coveredMs = 0
  let cursor = fromMs

  /** Rate-free slice width: one quarter hour, aligned to the epoch. */
  const ENERGY_SLICE_MS = 15 * 60_000

  /**
   * Record measured energy with no rate attached, on an epoch-aligned quarter
   * hour grid. `pieces` above is cut at *this* deployment's tariff boundaries
   * and carries this deployment's cents; a caller pricing the same watt-hours
   * under a different tariff (a community user's own utility) needs the energy
   * alone, on a grid fine enough that any whole-quarter-hour-offset zone's rate
   * changes fall on a boundary.
   * @param {number} watts average draw over the interval.
   * @param {number} pieceFrom interval start.
   * @param {number} pieceTo interval end.
   */
  const addEnergyPiece = (watts, pieceFrom, pieceTo) => {
    let from = pieceFrom
    while (from < pieceTo) {
      const gridEnd = Math.floor(from / ENERGY_SLICE_MS) * ENERGY_SLICE_MS + ENERGY_SLICE_MS
      const to = Math.min(pieceTo, gridEnd)
      const sliceWh = intervalWh(watts, from, to)
      if (sliceWh > 0) {
        const last = energyPieces[energyPieces.length - 1]
        if (last !== undefined && last.toMs === from && last.whPerHour === watts) {
          last.toMs = to
          last.wh += sliceWh
        } else {
          energyPieces.push({ fromMs: from, toMs: to, wh: sliceWh, whPerHour: watts })
        }
      }
      from = to
    }
  }

  // Consecutive slices at one rate are reported as a single piece: at 1 Hz a
  // ten-minute job would otherwise produce six hundred entries that say the
  // same thing.
  const addPiece = (watts, pieceFrom, pieceTo) => {
    for (const slice of splitAtBoundaries(pieceFrom, pieceTo)) {
      const sliceWh = intervalWh(watts, slice.fromMs, slice.toMs)
      if (sliceWh <= 0) continue
      const sliceCents = costCents(sliceWh, slice.centsPerKwh)
      wh += sliceWh
      cents += sliceCents
      const last = pieces[pieces.length - 1]
      if (last && last.period === slice.period && last.centsPerKwh === slice.centsPerKwh) {
        last.toMs = slice.toMs
        last.wh += sliceWh
        last.cents += sliceCents
        continue
      }
      pieces.push({
        fromMs: slice.fromMs,
        toMs: slice.toMs,
        period: slice.period,
        centsPerKwh: slice.centsPerKwh,
        wh: sliceWh,
        cents: sliceCents,
      })
    }
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const intervalMs = b.t - a.t
    if (intervalMs <= 0) continue
    // The part of this interval that lands inside the requested span.
    const overlapFrom = Math.max(a.t, fromMs)
    const overlapTo = Math.min(b.t, toMs)
    if (overlapTo <= overlapFrom) continue
    if (intervalMs > maxGapMs) {
      // The sampler was not running between these two points; the interval
      // carries no evidence, so it is a gap rather than an interpolation.
      if (overlapFrom > cursor) gaps.push({ fromMs: cursor, toMs: overlapFrom })
      gaps.push({ fromMs: overlapFrom, toMs: overlapTo })
      cursor = Math.max(cursor, overlapTo)
      continue
    }
    if (overlapFrom > cursor) gaps.push({ fromMs: cursor, toMs: overlapFrom })
    const avgWatts = (a.watts + b.watts) / 2
    addPiece(avgWatts, overlapFrom, overlapTo)
    addEnergyPiece(avgWatts, overlapFrom, overlapTo)
    coveredMs += overlapTo - overlapFrom
    cursor = Math.max(cursor, overlapTo)
  }

  if (cursor < toMs) gaps.push({ fromMs: cursor, toMs })

  // Merge adjacent gaps so a report does not list one hole twice.
  const merged = []
  for (const gap of gaps) {
    const last = merged[merged.length - 1]
    if (last && gap.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, gap.toMs)
    else merged.push({ ...gap })
  }

  const gapMs = merged.reduce((sum, gap) => sum + Math.max(0, gap.toMs - gap.fromMs), 0)
  return {
    wh,
    cents,
    coverage: Math.max(0, Math.min(1, coveredMs / span)),
    coveredMs,
    gapMs,
    sampleCount: points.length,
    pieces,
    energyPieces,
    gaps: merged,
  }
}

/**
 * The TOU label for a span. A span that crosses a boundary is reported by its
 * pieces, so this is only the rate in force at the span's start.
 * @param {number} ms the instant.
 * @returns {object} the period at `ms`.
 */
export const rateAt = (ms) => periodAt(ms)

/**
 * Classify how safely a measured span can be attributed to one job.
 *
 * `exclusive` is the only label that may be presented as the job's own energy;
 * every other label describes the measurement as approximate, because the GPU
 * was shared, the span was only partly observed, or another request overlapped it.
 *
 * @param {{coverage: number, distinctPids: number, overlappingRequests: number}} facts observed attribution facts.
 * @param {{completeCoverage?: number}} [limits] coverage considered complete, defaulting to 0.95.
 * @returns {{label: string, approximate: boolean, reasons: string[]}} the classification.
 */
export const classifyAttribution = (facts, limits = {}) => {
  const completeCoverage = Number.isFinite(limits.completeCoverage) ? limits.completeCoverage : 0.95
  const reasons = []
  const coverage = Number.isFinite(facts?.coverage) ? facts.coverage : 0
  const distinctPids = Number.isFinite(facts?.distinctPids) ? facts.distinctPids : 0
  const overlapping = Number.isFinite(facts?.overlappingRequests) ? facts.overlappingRequests : 0
  if (coverage < completeCoverage) reasons.push(`only ${Math.round(coverage * 100)}% of the span was measured`)
  if (distinctPids > 1) reasons.push(`${distinctPids} compute processes appeared on the card`)
  if (overlapping > 0) reasons.push(`${overlapping} request(s) overlapped this one`)
  if (reasons.length === 0) return { label: 'exclusive', approximate: false, reasons }
  if (overlapping > 0) return { label: 'overlapping-jobs', approximate: true, reasons }
  if (distinctPids > 1) return { label: 'shared', approximate: true, reasons }
  return { label: 'partial', approximate: true, reasons }
}
