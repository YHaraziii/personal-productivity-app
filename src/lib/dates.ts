/**
 * Calendar helpers.
 *
 * A deadline is a "floating" local value: a calendar date (YYYY-MM-DD) plus an
 * optional wall-clock time (HH:MM:SS). Date arithmetic is done on calendar
 * fields via UTC, never by adding milliseconds to a local instant, so daylight
 * saving transitions cannot shift a date. Only `dueInstant` converts to a real
 * instant, using the viewer's local time zone.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export interface DateParts {
  y: number
  m: number
  d: number
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function parseDate(s: unknown): DateParts | null {
  if (typeof s !== 'string') return null
  const match = DATE_RE.exec(s)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

export const isValidDate = (s: unknown): s is string => parseDate(s) !== null

export function toDateStr(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

function mustParse(s: string): DateParts {
  const parts = parseDate(s)
  if (!parts) throw new Error(`Invalid date: ${s}`)
  return parts
}

const toUtc = (p: DateParts) => Date.UTC(p.y, p.m - 1, p.d)

function fromUtc(ms: number): string {
  const date = new Date(ms)
  return toDateStr(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** Today's calendar date in the viewer's local time zone. */
export function todayLocal(now: Date = new Date()): string {
  return toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function addDays(s: string, n: number): string {
  const p = mustParse(s)
  return fromUtc(Date.UTC(p.y, p.m - 1, p.d + n))
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(mustParse(b)) - toUtc(mustParse(a))) / 86_400_000)
}

/** Whole calendar months from `a` to `b`, ignoring the day of month. */
export function diffMonths(a: string, b: string): number {
  const pa = mustParse(a)
  const pb = mustParse(b)
  return (pb.y - pa.y) * 12 + (pb.m - pa.m)
}

/**
 * Add `n` months to the month of `s`, landing on the same day number as `s`,
 * or on the last day of the month when that day does not exist
 * (Jan 31 + 1 month = Feb 28/29).
 */
export function addMonthsClamped(s: string, n: number): string {
  const p = mustParse(s)
  const monthIndex = p.y * 12 + (p.m - 1) + n
  const y = Math.floor(monthIndex / 12)
  const m = (monthIndex % 12) + 1
  return toDateStr(y, m, Math.min(p.d, daysInMonth(y, m)))
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayName(s: string): string {
  return WEEKDAYS[new Date(toUtc(mustParse(s))).getUTCDay()]!
}

export function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && TIME_RE.test(t)
}

/** Normalise 'HH:MM' / 'HH:MM:SS[.fff]' to 'HH:MM:SS'; null when invalid or empty. */
export function normalizeTime(t: unknown): string | null {
  if (typeof t !== 'string') return null
  const match = TIME_RE.exec(t)
  if (!match) return null
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`
}

/**
 * The instant a timed deadline is reached, in the viewer's local time zone.
 * The Date constructor resolves DST edge cases: a time skipped by "spring
 * forward" moves to the next valid instant, and a repeated "fall back" time
 * resolves to its first occurrence.
 */
export function dueInstant(date: string, time: string): Date {
  const p = mustParse(date)
  const t = normalizeTime(time)
  if (!t) throw new Error(`Invalid time: ${time}`)
  const [hh, mm, ss] = t.split(':').map(Number)
  return new Date(p.y, p.m - 1, p.d, hh, mm, ss)
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})
const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** 'Oct 27, 2026' */
export function formatDate(s: string): string {
  const p = parseDate(s)
  return p ? dateFormatter.format(new Date(toUtc(p))) : s
}

/** '3:00 PM' */
export function formatTime(t: string): string {
  const n = normalizeTime(t)
  if (!n) return t
  const [hh, mm] = n.split(':').map(Number)
  return timeFormatter.format(new Date(Date.UTC(2000, 0, 1, hh, mm)))
}

/** 'Oct 27, 2026' or 'Oct 27, 2026, 3:00 PM' */
export function formatDue(date: string, time: string | null): string {
  return time ? `${formatDate(date)}, ${formatTime(time)}` : formatDate(date)
}

/** A stored instant (ISO string) shown in local time: 'Oct 27, 2026, 3:00 PM'. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : timestampFormatter.format(new Date(ms))
}

export type DueBucket = 'none' | 'overdue' | 'past' | 'today' | 'upcoming' | 'later'

/** How many days ahead (after today) count as "upcoming". */
export const UPCOMING_DAYS = 7

/**
 * Classify a deadline relative to `now`.
 *  - overdue : not completed and the deadline has passed. A date-only deadline
 *              is overdue from the following day; a timed one from its instant.
 *  - past    : completed task whose date is before today.
 *  - today   : due today and not (yet) overdue.
 *  - upcoming: due within the next UPCOMING_DAYS days after today.
 */
export function dueBucket(
  task: { due_date: string | null; due_time: string | null; completed_at: string | null },
  now: Date,
): DueBucket {
  if (!task.due_date || !isValidDate(task.due_date)) return 'none'
  const today = todayLocal(now)
  const completed = task.completed_at != null
  if (task.due_date < today) return completed ? 'past' : 'overdue'
  if (task.due_date === today) {
    if (!completed && task.due_time && isValidTime(task.due_time)) {
      return now.getTime() >= dueInstant(task.due_date, task.due_time).getTime() ? 'overdue' : 'today'
    }
    return 'today'
  }
  return diffDays(today, task.due_date) <= UPCOMING_DAYS ? 'upcoming' : 'later'
}
