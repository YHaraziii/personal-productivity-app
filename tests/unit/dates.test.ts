// Runs with TZ=America/New_York (see vite.config.ts), which has DST changes
// on 2026-03-08 (spring forward) and 2026-11-01 (fall back).
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonthsClamped,
  dueBucket,
  dueInstant,
  formatDate,
  formatDue,
  formatTime,
  isValidDate,
  normalizeTime,
  todayLocal,
} from '../../src/lib/dates'

const task = (due_date: string | null, due_time: string | null = null, completed_at: string | null = null) => ({ due_date, due_time, completed_at })

describe('date helpers', () => {
  it('runs in a DST-observing time zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York')
  })

  it('formats readable dates and times', () => {
    expect(formatDate('2026-10-27')).toBe('Oct 27, 2026')
    expect(formatTime('15:30:00')).toBe('3:30 PM')
    expect(formatDue('2026-10-27', null)).toBe('Oct 27, 2026')
    expect(formatDue('2026-10-27', '09:05')).toBe('Oct 27, 2026, 9:05 AM')
  })

  it('validates calendar dates and times', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('26-1-1')).toBe(false)
    expect(normalizeTime('9:00')).toBeNull()
    expect(normalizeTime('09:00')).toBe('09:00:00')
    expect(normalizeTime('23:59:59.123')).toBe('23:59:59')
    expect(normalizeTime('24:00')).toBeNull()
  })

  it('adds days across DST transitions without shifting the date', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('clamps months to the last day', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('resolves timed deadlines in local time, including DST days', () => {
    // 09:00 on the spring-forward day is 13:00 UTC (EDT, UTC-4).
    expect(dueInstant('2026-03-08', '09:00').toISOString()).toBe('2026-03-08T13:00:00.000Z')
    expect(dueInstant('2026-03-07', '09:00').toISOString()).toBe('2026-03-07T14:00:00.000Z')
    // 02:30 does not exist on 2026-03-08; it resolves to a valid later instant.
    expect(dueInstant('2026-03-08', '02:30').getHours()).toBe(3)
    // 01:30 occurs twice on 2026-11-01; it resolves to a real instant on that date.
    const ambiguous = dueInstant('2026-11-01', '01:30')
    expect(todayLocal(ambiguous)).toBe('2026-11-01')
    expect(ambiguous.getHours()).toBe(1)
  })

  it('local "today" follows the local calendar, not UTC', () => {
    // 23:30 local on Oct 27 is already Oct 28 in UTC.
    expect(todayLocal(new Date('2026-10-28T03:30:00Z'))).toBe('2026-10-27')
  })
})

describe('dueBucket', () => {
  const now = new Date(2026, 9, 27, 14, 0) // Oct 27, 2026 14:00 local

  it('treats a date-only deadline as due all day, overdue from the next day', () => {
    expect(dueBucket(task('2026-10-27'), now)).toBe('today')
    expect(dueBucket(task('2026-10-27'), new Date(2026, 9, 27, 23, 59))).toBe('today')
    expect(dueBucket(task('2026-10-26'), now)).toBe('overdue')
  })

  it('makes a timed deadline overdue once its time has passed', () => {
    expect(dueBucket(task('2026-10-27', '13:59'), now)).toBe('overdue')
    expect(dueBucket(task('2026-10-27', '14:00'), now)).toBe('overdue')
    expect(dueBucket(task('2026-10-27', '14:01'), now)).toBe('today')
  })

  it('classifies upcoming, later, undated and completed tasks', () => {
    expect(dueBucket(task('2026-10-28'), now)).toBe('upcoming')
    expect(dueBucket(task('2026-11-03'), now)).toBe('upcoming')
    expect(dueBucket(task('2026-11-04'), now)).toBe('later')
    expect(dueBucket(task(null), now)).toBe('none')
    expect(dueBucket(task('2026-10-20', null, '2026-10-21T00:00:00Z'), now)).toBe('past')
    expect(dueBucket(task('2026-10-27', '09:00', '2026-10-27T12:00:00Z'), now)).toBe('today')
  })
})
