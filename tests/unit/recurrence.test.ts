import { describe, expect, it } from 'vitest'
import { describeRule, nextOccurrenceAfter, nextOccurrenceDate, occurrenceDate, presetOf } from '../../src/lib/recurrence'
import type { RecurrenceRule } from '../../src/lib/types'

const rule = (unit: RecurrenceRule['unit'], interval_count: number, anchor_date: string): RecurrenceRule => ({ unit, interval_count, anchor_date })

describe('occurrence dates', () => {
  it('daily, weekly, monthly and custom intervals', () => {
    expect([0, 1, 2].map((k) => occurrenceDate(rule('day', 1, '2026-02-27'), k))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
    expect([0, 1, 2].map((k) => occurrenceDate(rule('week', 1, '2026-10-27'), k))).toEqual(['2026-10-27', '2026-11-03', '2026-11-10'])
    expect([0, 1, 2].map((k) => occurrenceDate(rule('week', 2, '2026-10-27'), k))).toEqual(['2026-10-27', '2026-11-10', '2026-11-24'])
    expect([0, 1, 2].map((k) => occurrenceDate(rule('month', 1, '2026-10-15'), k))).toEqual(['2026-10-15', '2026-11-15', '2026-12-15'])
    expect([0, 1, 2].map((k) => occurrenceDate(rule('month', 3, '2026-11-30'), k))).toEqual(['2026-11-30', '2027-02-28', '2027-05-30'])
    expect([0, 1].map((k) => occurrenceDate(rule('day', 10, '2026-12-25'), k))).toEqual(['2026-12-25', '2027-01-04'])
  })

  it('weekly occurrences keep their weekday across DST changes', () => {
    const dates = [0, 1, 2, 3].map((k) => occurrenceDate(rule('week', 1, '2026-10-24'), k))
    expect(dates).toEqual(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14'])
    for (const d of dates) expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(6)
  })

  it('monthly on the 31st uses the last day of shorter months, then returns to the 31st', () => {
    const r = rule('month', 1, '2026-01-31')
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => occurrenceDate(r, k))).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    ])
    expect(occurrenceDate(rule('month', 1, '2028-01-30'), 1)).toBe('2028-02-29')
    expect(occurrenceDate(rule('month', 1, '2026-01-29'), 1)).toBe('2026-02-28')
  })
})

describe('next occurrence', () => {
  it('returns the first occurrence strictly after a date', () => {
    const r = rule('week', 2, '2026-01-05')
    expect(nextOccurrenceAfter(r, '2025-12-01')).toBe('2026-01-05')
    expect(nextOccurrenceAfter(r, '2026-01-05')).toBe('2026-01-19')
    expect(nextOccurrenceAfter(r, '2026-01-18')).toBe('2026-01-19')
    expect(nextOccurrenceAfter(r, '2026-01-19')).toBe('2026-02-02')
    expect(nextOccurrenceAfter(rule('month', 1, '2026-01-31'), '2026-02-28')).toBe('2026-03-31')
    expect(nextOccurrenceAfter(rule('month', 1, '2026-01-31'), '2026-02-27')).toBe('2026-02-28')
  })

  it('skips missed occurrences after a long absence (one next date, in the future)', () => {
    const r = rule('day', 1, '2026-01-01')
    expect(nextOccurrenceDate(r, '2026-01-01', '2026-06-15')).toBe('2026-06-16')
    expect(nextOccurrenceDate(rule('week', 1, '2026-01-05'), '2026-01-05', '2026-03-04')).toBe('2026-03-09')
    expect(nextOccurrenceDate(rule('month', 1, '2026-01-31'), '2026-01-31', '2026-06-10')).toBe('2026-06-30')
    expect(nextOccurrenceDate(rule('month', 2, '2026-01-31'), '2026-01-31', '2026-05-31')).toBe('2026-07-31')
  })

  it('completing on time or early schedules the following occurrence', () => {
    const r = rule('week', 1, '2026-03-02')
    expect(nextOccurrenceDate(r, '2026-03-02', '2026-03-02')).toBe('2026-03-09')
    expect(nextOccurrenceDate(r, '2026-03-09', '2026-03-03')).toBe('2026-03-16')
  })

  it('is deterministic for many years of dates', () => {
    const r = rule('month', 1, '2024-02-29')
    let d = r.anchor_date
    for (let i = 0; i < 60; i++) {
      const next = nextOccurrenceAfter(r, d)
      expect(next > d).toBe(true)
      expect(next).toBe(occurrenceDate(r, i + 1))
      d = next
    }
  })
})

describe('describeRule', () => {
  it('produces understandable text', () => {
    expect(describeRule(rule('day', 1, '2026-10-27'))).toBe('Every day')
    expect(describeRule(rule('day', 3, '2026-10-27'))).toBe('Every 3 days')
    expect(describeRule(rule('week', 1, '2026-10-27'))).toBe('Every week on Tuesday')
    expect(describeRule(rule('week', 2, '2026-10-27'))).toBe('Every 2 weeks on Tuesday')
    expect(describeRule(rule('month', 1, '2026-10-15'))).toBe('Every month on day 15')
    expect(describeRule(rule('month', 1, '2026-10-31'))).toBe('Every month on day 31 (or the last day of shorter months)')
    expect(presetOf(rule('week', 2, '2026-10-27'))).toBe('custom')
    expect(presetOf(rule('month', 1, '2026-10-27'))).toBe('monthly')
    expect(presetOf(null)).toBe('none')
  })
})
