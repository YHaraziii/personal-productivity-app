/**
 * Recurrence rules.
 *
 * A rule is (unit, interval_count, anchor_date). Occurrence k (k = 0, 1, 2…)
 * falls on:
 *   day   -> anchor + k * interval days
 *   week  -> anchor + k * interval * 7 days  (always the anchor's weekday)
 *   month -> the anchor's day-of-month, k * interval months later; when that
 *            day does not exist the last day of the month is used.
 *
 * Every date is computed from the anchor, never from the previous occurrence,
 * so a monthly task anchored on the 31st goes Jan 31 -> Feb 28 -> Mar 31: the
 * intended day is preserved after a short month.
 */
import { addDays, addMonthsClamped, diffDays, diffMonths, parseDate, weekdayName } from './dates'
import type { RecurrenceRule, RecurrenceUnit } from './types'

export function occurrenceDate(rule: RecurrenceRule, k: number): string {
  const n = rule.interval_count
  switch (rule.unit) {
    case 'day':
      return addDays(rule.anchor_date, k * n)
    case 'week':
      return addDays(rule.anchor_date, k * n * 7)
    case 'month':
      return addMonthsClamped(rule.anchor_date, k * n)
  }
}

/** The first occurrence of the rule strictly after `after`. */
export function nextOccurrenceAfter(rule: RecurrenceRule, after: string): string {
  if (after < rule.anchor_date) return rule.anchor_date
  const n = rule.interval_count
  let k: number
  if (rule.unit === 'month') {
    k = Math.max(0, Math.floor(diffMonths(rule.anchor_date, after) / n) - 1)
  } else {
    const step = rule.unit === 'week' ? n * 7 : n
    k = Math.max(0, Math.floor(diffDays(rule.anchor_date, after) / step))
  }
  // The estimate is at most two steps short; walk forward to the exact answer.
  for (let guard = 0; guard < 8; guard++, k++) {
    const candidate = occurrenceDate(rule, k)
    if (candidate > after) return candidate
  }
  throw new Error('Recurrence calculation did not converge')
}

/**
 * The occurrence to create when the one scheduled for `scheduled` is completed
 * (or skipped) on local date `today`.
 *
 * Missed occurrences are skipped: the result is the first date of the rule
 * that is after BOTH the completed occurrence and today. Completing a daily
 * task three days late therefore schedules tomorrow, not three overdue copies;
 * completing a task early schedules the occurrence after the one completed.
 */
export function nextOccurrenceDate(rule: RecurrenceRule, scheduled: string, today: string): string {
  return nextOccurrenceAfter(rule, scheduled > today ? scheduled : today)
}

const UNIT_NOUN: Record<RecurrenceUnit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
}

/** Plain-language description of a rule, e.g. "Every 2 weeks on Tuesday". */
export function describeRule(rule: RecurrenceRule): string {
  const n = rule.interval_count
  const [one, many] = UNIT_NOUN[rule.unit]
  const every = n === 1 ? `Every ${one}` : `Every ${n} ${many}`
  const parts = parseDate(rule.anchor_date)
  if (!parts) return every
  if (rule.unit === 'week') return `${every} on ${weekdayName(rule.anchor_date)}`
  if (rule.unit === 'month') {
    const suffix = parts.d > 28 ? ' (or the last day of shorter months)' : ''
    return `${every} on day ${parts.d}${suffix}`
  }
  return every
}

export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'

export function presetOf(rule: { unit: RecurrenceUnit; interval_count: number } | null): RecurrencePreset {
  if (!rule) return 'none'
  if (rule.interval_count !== 1) return 'custom'
  return rule.unit === 'day' ? 'daily' : rule.unit === 'week' ? 'weekly' : 'monthly'
}
