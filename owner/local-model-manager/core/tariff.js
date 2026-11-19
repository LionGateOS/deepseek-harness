/**
 * Ontario Time-of-Use electricity prices as pure functions. Every decision here
 * is a wall-clock fact in America/Toronto, so DST is resolved by the time zone
 * database rather than by arithmetic on offsets: the repeated 01:00 hour on the
 * November fall-back is one local hour, not two.
 *
 * The published rates are the OEB TOU energy component including the Global
 * Adjustment. Delivery, regulatory charges, and tax are NOT included, and the
 * caller must label any figure as the energy component only.
 */

/** TOU energy component in cents per kWh, OEB, effective 2026-11-01. */
export const TOU_RATES = Object.freeze({ offPeak: 9.1, midPeak: 14.6, onPeak: 18.9 })

/** The date these prices took effect; nothing later is knowable from this table. */
export const TOU_EFFECTIVE_FROM = '2026-11-01'

/** Where the rates come from, recorded with every figure derived from them. */
export const TOU_SOURCE = 'OEB Time-of-Use prices, effective 2026-11-01 (energy component incl. Global Adjustment)'

/**
 * OEB-recognized holidays for 2026. A holiday that lands on a weekend is
 * observed on the next non-holiday weekday, which `holidayKeys` computes.
 */
export const ONTARIO_HOLIDAYS_2026 = Object.freeze([
  '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
  '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
])

const ZONE = 'America/Toronto'

const FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  weekday: 'short',
})

/** Hours (local) at which the TOU period can change, plus midnight. */
const BOUNDARY_HOURS = Object.freeze([0, 7, 11, 17, 19])

/**
 * Wall-clock fields for one instant in America/Toronto.
 * @param {number} ms epoch milliseconds.
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number, weekday: string}} local fields.
 */
export const localParts = (ms) => {
  const parts = FORMATTER.formatToParts(new Date(ms))
  const pick = (type) => parts.find((part) => part.type === type)?.value
  const hour = Number(pick('hour')) % 24 // some ICU builds render midnight as "24"
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour,
    minute: Number(pick('minute')),
    second: Number(pick('second')),
    weekday: String(pick('weekday')),
  }
}

/** `YYYY-MM-DD` for one local date. */
const dateKey = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/**
 * The epoch instant of a local wall-clock hour. Ambiguous local times (the
 * repeated hour when clocks fall back) resolve to the first occurrence, which
 * keeps a tariff boundary unique.
 * @param {number} year local year.
 * @param {number} month local month, 1-12.
 * @param {number} day local day.
 * @param {number} hour local hour, 0-23.
 * @returns {number} epoch milliseconds.
 */
export const instantForLocalHour = (year, month, day, hour) => {
  const want = Date.UTC(year, month - 1, day, hour)
  let guess = want
  for (let i = 0; i < 3; i += 1) {
    const p = localParts(guess)
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const delta = want - rendered
    if (delta === 0) break
    guess += delta
  }
  return guess
}

/**
 * Dates treated as holidays for TOU purposes, including weekend observances
 * shifted to the next non-holiday weekday.
 * @param {string[]} holidays ISO dates of the declared holidays.
 * @returns {Set<string>} the dates that price as off-peak.
 */
export const holidayKeys = (holidays = ONTARIO_HOLIDAYS_2026) => {
  const keys = new Set(holidays)
  for (const iso of holidays) {
    const [y, m, d] = iso.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    if (dow !== 0 && dow !== 6) continue
    // Shift forward to the next weekday that is not itself a declared holiday.
    const cursor = new Date(Date.UTC(y, m - 1, d))
    for (let step = 0; step < 7; step += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      const candidate = dateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())
      if (keys.has(candidate)) continue
      if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue
      keys.add(candidate)
      break
    }
  }
  return keys
}

const HOLIDAYS = holidayKeys()

/** Summer TOU season runs May 1 through October 31. */
const isSummerMonth = (month) => month >= 5 && month <= 10

/**
 * The TOU period in force at one instant.
 * @param {number} ms epoch milliseconds.
 * @returns {{period: string, centsPerKwh: number, season: string, onHoliday: boolean, onWeekend: boolean}} the period and its label.
 */
export const periodAt = (ms) => {
  const p = localParts(ms)
  const isWeekend = p.weekday === 'Sat' || p.weekday === 'Sun'
  const onHoliday = HOLIDAYS.has(dateKey(p.year, p.month, p.day))
  const season = isSummerMonth(p.month) ? 'summer' : 'winter'
  if (isWeekend || onHoliday) {
    return { period: 'off-peak', centsPerKwh: TOU_RATES.offPeak, season, onHoliday, onWeekend: isWeekend }
  }
  const summer = season === 'summer'
  let period
  if (p.hour >= 7 && p.hour < 11) period = summer ? 'mid-peak' : 'on-peak'
  else if (p.hour >= 11 && p.hour < 17) period = summer ? 'on-peak' : 'mid-peak'
  else if (p.hour >= 17 && p.hour < 19) period = summer ? 'mid-peak' : 'on-peak'
  else period = 'off-peak'
  const centsPerKwh = period === 'on-peak' ? TOU_RATES.onPeak : period === 'mid-peak' ? TOU_RATES.midPeak : TOU_RATES.offPeak
  return { period, centsPerKwh, season, onHoliday, onWeekend: false }
}

/**
 * The next instant strictly after `ms` at which the TOU period can change.
 * @param {number} ms epoch milliseconds.
 * @returns {number|null} the boundary instant, or null past the search horizon.
 */
export const nextBoundary = (ms) => {
  const p = localParts(ms)
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset))
    const y = base.getUTCFullYear()
    const mo = base.getUTCMonth() + 1
    const d = base.getUTCDate()
    for (const hour of BOUNDARY_HOURS) {
      const instant = instantForLocalHour(y, mo, d, hour)
      if (instant > ms) return instant
    }
  }
  return null
}

/**
 * Split a span at every TOU boundary, so each piece prices at one rate.
 * @param {number} startMs span start.
 * @param {number} endMs span end.
 * @returns {Array<{fromMs: number, toMs: number, period: string, centsPerKwh: number}>} the pieces, in order.
 */
export const splitAtBoundaries = (startMs, endMs) => {
  const pieces = []
  let cursor = startMs
  let guard = 0
  while (cursor < endMs && guard < 10000) {
    const boundary = nextBoundary(cursor)
    const stop = boundary === null || boundary >= endMs ? endMs : boundary
    const rate = periodAt(cursor)
    pieces.push({ fromMs: cursor, toMs: stop, period: rate.period, centsPerKwh: rate.centsPerKwh })
    cursor = stop
    guard += 1
  }
  return pieces
}
