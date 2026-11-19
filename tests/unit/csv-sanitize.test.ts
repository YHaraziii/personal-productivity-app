import { describe, expect, it } from 'vitest'
import { buildTasksCsv, csvCell, neutralizeFormula, toCsv } from '../../src/lib/csv'
import { isSafeUrl, normalizeUrl, sanitizeHtml } from '../../src/lib/sanitize'
import { htmlToPlainText } from '../../src/lib/text'
import type { GroupRow, LabelRow, SeriesRow, SubtaskRow, TaskRow } from '../../src/lib/types'

describe('CSV escaping', () => {
  it('quotes every cell and doubles quotes', () => {
    expect(csvCell('plain')).toBe('"plain"')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(csvCell(null)).toBe('""')
    expect(csvCell(3)).toBe('"3"')
  })

  it('neutralizes spreadsheet formulas', () => {
    for (const evil of ['=1+1', '+1', '-1+2', '@SUM(A1)', '\t=cmd', '\r=cmd', ' =HYPERLINK("x")']) {
      expect(neutralizeFormula(evil).startsWith("'")).toBe(true)
    }
    expect(neutralizeFormula('normal text')).toBe('normal text')
    expect(neutralizeFormula('2026-10-27')).toBe('2026-10-27')
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
  })

  it('uses a BOM, CRLF row endings and survives a round trip through a parser', () => {
    const csv = toCsv([['a', 'b'], ['x,y', 'he said "no"\nthen left']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'he said "no"\nthen left']])
  })
})

describe('task CSV', () => {
  const base = { user_id: 'u', version: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '', deleted_at: null }
  const groups = [
    { ...base, id: 'g2', name: 'Second', sort_index: 2 },
    { ...base, id: 'g1', name: 'First', sort_index: 1 },
  ] as GroupRow[]
  const labels = [{ ...base, id: 'l1', name: 'Zed', color: '#000000' }, { ...base, id: 'l2', name: 'Alpha', color: '#000000' }] as LabelRow[]
  const series = [{ ...base, id: 's1', group_id: 'g1', unit: 'week', interval_count: 2, anchor_date: '2026-10-27', ended_at: null }] as SeriesRow[]
  const tasks = [
    { ...base, id: 't1', group_id: 'g2', title: 'In second', description: '', priority: 'low', due_date: null, due_time: null, completed_at: null, manual_index: 1, series_id: null, occurrence_date: null },
    { ...base, id: 't2', group_id: 'g1', title: '=danger', description: '<p>Line <strong>one</strong></p><ul><li>a</li></ul>', priority: 'urgent', due_date: '2026-10-27', due_time: '14:30:00', completed_at: '2026-10-27T18:00:00.000Z', manual_index: 1, series_id: 's1', occurrence_date: '2026-10-27' },
  ] as TaskRow[]
  const subtasks = [
    { ...base, id: 'st2', task_id: 't2', text: 'second', completed: false, sort_index: 2 },
    { ...base, id: 'st1', task_id: 't2', text: 'first', completed: true, sort_index: 1 },
  ] as SubtaskRow[]
  const rows = parseCsv(buildTasksCsv({ groups, tasks, subtasks, labels, taskLabels: [{ task_id: 't2', label_id: 'l1' }, { task_id: 't2', label_id: 'l2' }], series }))

  it('contains every task of every group, ordered by group order', () => {
    expect(rows).toHaveLength(3)
    expect(rows[1]![2]).toBe('First')
    expect(rows[2]![2]).toBe('Second')
  })

  it('represents all required fields', () => {
    const header = rows[0]!
    const row = Object.fromEntries(header.map((h, i) => [h, rows[1]![i]]))
    expect(row).toMatchObject({
      'Task ID': 't2',
      Title: "'=danger",
      Description: 'Line one\n• a',
      Status: 'Completed',
      'Due Date': '2026-10-27',
      'Due Time': '14:30',
      Priority: 'Urgent',
      Labels: 'Alpha; Zed',
      'Created At': '2026-01-01T00:00:00.000Z',
      'Completed At': '2026-10-27T18:00:00.000Z',
      Recurrence: 'Every 2 weeks on Tuesday',
      'Recurrence Series ID': 's1',
      Subtasks: '[x] first\n[ ] second',
      'Subtasks Completed': '1',
      'Subtasks Total': '2',
    })
  })
})

describe('rich text safety', () => {
  it('removes scripts, event handlers, styles and disallowed tags', () => {
    expect(sanitizeHtml('<p onclick="x()">Hi<script>alert(1)</script></p>')).toBe('<p>Hi</p>')
    expect(sanitizeHtml('<img src=x onerror=alert(1)><b>b</b>')).toBe('<b>b</b>')
    expect(sanitizeHtml('<p style="color:red"><iframe src="https://e.com"></iframe>t</p>')).toBe('<p>t</p>')
    expect(sanitizeHtml('<p></p>')).toBe('')
    expect(sanitizeHtml(42)).toBe('')
  })

  it('keeps only safe links and hardens them', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="data:text/html,hi">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>')
    const safe = sanitizeHtml('<a href="https://example.com/a?b=1" target="_self">x</a>')
    expect(safe).toContain('href="https://example.com/a?b=1"')
    expect(safe).toContain('target="_blank"')
    expect(safe).toContain('rel="noopener noreferrer nofollow"')
    expect(sanitizeHtml('<a href="mailto:me@example.com">m</a>')).toContain('mailto:me@example.com')
  })

  it('validates and normalizes URLs typed by the user', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('ftp://example.com')).toBe(false)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path')
    expect(normalizeUrl('me@example.com')).toBe('mailto:me@example.com')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
  })

  it('converts sanitized HTML to plain text', () => {
    expect(htmlToPlainText('<p>a &amp; b</p><ul><li>x</li><li>y</li></ul>')).toBe('a & b\n• x\n• y')
  })
})

/** Minimal RFC 4180 parser used to prove the output is well formed. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && src[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += ch
  }
  return rows
}
