/**
 * Ontario TOU tariff coverage: the verified November 1 2026 prices, the winter
 * and summer weekday shapes, weekend and holiday off-peak pricing, the
 * shift rule for a holiday that lands on a weekend, and the DST transitions
 * that decide where one local hour begins and ends.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TOU_RATES, TOU_EFFECTIVE_FROM, ONTARIO_HOLIDAYS_2026,
  localParts, periodAt, nextBoundary, splitAtBoundaries, instantForLocalHour, holidayKeys,
} from '../core/tariff.js'

const ms = (iso) => Date.parse(iso)

test('the published energy-component prices are the verified 2026-11-01 rates', () => {
  assert.deepEqual({ ...TOU_RATES }, { offPeak: 9.1, midPeak: 14.6, onPeak: 18.9 })
  assert.equal(TOU_EFFECTIVE_FROM, '2026-11-01')
})

test('a winter weekday follows the off/mid/on shape in Toronto local time', () => {
  // Friday 2026-11-06. EST is UTC-5, so 12:00Z is 07:00 local.
  assert.equal(periodAt(ms('2026-11-06T11:00:00Z')).period, 'off-peak') // 06:00
  assert.equal(periodAt(ms('2026-11-06T12:00:00Z')).period, 'on-peak') // 07:00
  assert.equal(periodAt(ms('2026-11-06T15:59:00Z')).period, 'on-peak') // 10:59
  assert.equal(periodAt(ms('2026-11-06T16:00:00Z')).period, 'mid-peak') // 11:00
  assert.equal(periodAt(ms('2026-11-06T21:59:00Z')).period, 'mid-peak') // 16:59
  assert.equal(periodAt(ms('2026-11-06T22:00:00Z')).period, 'on-peak') // 17:00
  assert.equal(periodAt(ms('2026-11-07T00:00:00Z')).period, 'off-peak') // 19:00
})

test('a summer weekday swaps mid-peak and on-peak', () => {
  // Friday 2026-07-10. EDT is UTC-4, so 12:00Z is 08:00 local.
  assert.equal(periodAt(ms('2026-07-10T12:00:00Z')).period, 'mid-peak') // 08:00
  assert.equal(periodAt(ms('2026-07-10T16:00:00Z')).period, 'on-peak') // 12:00
  assert.equal(periodAt(ms('2026-07-10T22:00:00Z')).period, 'mid-peak') // 18:00
  assert.equal(periodAt(ms('2026-07-10T16:00:00Z')).season, 'summer')
})

test('weekends and holidays price off-peak all day', () => {
  const weekend = periodAt(ms('2026-11-07T17:00:00Z')) // Saturday 12:00 local
  assert.equal(weekend.period, 'off-peak')
  assert.equal(weekend.onWeekend, true)
  const holiday = periodAt(ms('2026-12-25T17:00:00Z')) // Christmas Day, Friday 12:00
  assert.equal(holiday.period, 'off-peak')
  assert.equal(holiday.onHoliday, true)
  assert.equal(holiday.centsPerKwh, TOU_RATES.offPeak)
})

test('a holiday landing on a weekend is observed on the next weekday', () => {
  // 2026-12-26 is a Saturday; the declared holiday is 2026-12-28 (Monday).
  const keys = holidayKeys(['2026-12-26'])
  assert.equal(keys.has('2026-12-26'), true)
  assert.equal(keys.has('2026-12-28'), true)
  // The observed day prices off-peak even though it is a Monday.
  assert.equal(periodAt(ms('2026-12-28T17:00:00Z')).period, 'off-peak')
})

test('the declared 2026 holiday list is the verified one', () => {
  assert.deepEqual([...ONTARIO_HOLIDAYS_2026], [
    '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
    '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
  ])
})

test('the DST fall-back hour resolves to exactly one local hour', () => {
  // Clocks go back at 2026-11-01 02:00 EDT; 01:30 local occurs at 05:30Z and 06:30Z.
  assert.equal(localParts(ms('2026-11-01T05:30:00Z')).hour, 1)
  assert.equal(localParts(ms('2026-11-01T06:30:00Z')).hour, 1)
  // A boundary at local 01:00 is a single instant, not two.
  const first = instantForLocalHour(2026, 11, 1, 1)
  assert.equal(new Date(first).toISOString(), '2026-11-01T05:00:00.000Z')
})

test('the DST spring-forward gap is skipped by the local clock', () => {
  // 2026-03-08 02:00 EST becomes 03:00 EDT; local 02:00 never occurs.
  assert.equal(localParts(ms('2026-03-08T06:59:00Z')).hour, 1)
  assert.equal(localParts(ms('2026-03-08T07:00:00Z')).hour, 3)
})

test('nextBoundary returns the next period change, not the next hour', () => {
  // 07:10 EST on a winter Friday: the next change is 11:00 EST = 16:00Z.
  assert.equal(nextBoundary(ms('2026-11-06T12:10:00Z')), ms('2026-11-06T16:00:00Z'))
  // 12:10 EST: the next change is 17:00 EST = 22:00Z.
  assert.equal(nextBoundary(ms('2026-11-06T17:10:00Z')), ms('2026-11-06T22:00:00Z'))
})

test('a span is split into one piece per rate it crosses', () => {
  const pieces = splitAtBoundaries(ms('2026-11-06T11:50:00Z'), ms('2026-11-06T18:00:00Z'))
  assert.deepEqual(pieces.map((piece) => piece.period), ['off-peak', 'on-peak', 'mid-peak'])
  assert.deepEqual(pieces.map((piece) => piece.centsPerKwh), [9.1, 18.9, 14.6])
  // The pieces tile the span exactly, with no gap and no overlap.
  assert.equal(pieces[0].fromMs, ms('2026-11-06T11:50:00Z'))
  assert.equal(pieces[pieces.length - 1].toMs, ms('2026-11-06T18:00:00Z'))
  for (let i = 1; i < pieces.length; i += 1) assert.equal(pieces[i].fromMs, pieces[i - 1].toMs)
})

test('a span inside one period yields one piece', () => {
  const pieces = splitAtBoundaries(ms('2026-11-06T17:10:00Z'), ms('2026-11-06T18:10:00Z'))
  assert.equal(pieces.length, 1)
  assert.equal(pieces[0].period, 'mid-peak')
})
