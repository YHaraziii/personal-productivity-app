import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, buildBackup, parseBackupText, prepareImport, validateBackup } from '../../src/lib/backup'

const G = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const L = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'

function valid() {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: '2026-10-27T10:00:00.000Z',
    data: {
      groups: [{ id: G, name: 'School', color: '#112233', icon: '📚', sort_index: 1 }],
      labels: [{ id: L, name: 'Exam', color: '#445566' }],
      recurrence_series: [{ id: S, group_id: G, unit: 'week', interval_count: 1, anchor_date: '2026-10-27', title: 'Weekly' }],
      tasks: [{ id: T, group_id: G, title: 'Study', priority: 'high', due_date: '2026-10-27', due_time: '09:00', series_id: S, occurrence_date: '2026-10-27' }],
      subtasks: [{ id: '55555555-5555-4555-8555-555555555555', task_id: T, text: 'Chapter 1' }],
      task_labels: [{ task_id: T, label_id: L }],
      settings: { layout_mode: 'free', theme: { mode: 'dark', preset: 'forest' } },
    },
  }
}

describe('backup validation', () => {
  it('accepts a valid backup and fills defaults for optional fields', () => {
    const result = validateBackup(valid())
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(result.backup.data.groups[0]).toMatchObject({ grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc', collapsed: false })
    expect(result.backup.data.tasks[0]).toMatchObject({ due_time: '09:00:00', completed_at: null })
    expect(result.backup.data.settings).toMatchObject({ layout_mode: 'free' })
  })

  it('rejects malformed JSON, foreign files and unsupported versions with clear messages', () => {
    expect(parseBackupText('{not json')).toEqual({ ok: false, errors: [expect.stringMatching(/not valid JSON/)] })
    expect(parseBackupText('[]')).toEqual({ ok: false, errors: [expect.stringMatching(/not a Personal Productivity Dashboard backup/)] })
    expect(validateBackup({ ...valid(), version: 2 })).toEqual({ ok: false, errors: [expect.stringMatching(/format version 2/)] })
    expect(validateBackup({ ...valid(), version: 'one' })).toEqual({ ok: false, errors: [expect.stringMatching(/no valid format version/)] })
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1 })).toEqual({ ok: false, errors: ['The backup has no data section.'] })
  })

  it.each([
    ['missing required title', (b: ReturnType<typeof valid>) => delete (b.data.tasks[0] as Record<string, unknown>).title, /tasks\[0\]\.title: must be text|is required/],
    ['invalid id', (b: ReturnType<typeof valid>) => (b.data.groups[0]!.id = 'nope'), /groups\[0\]\.id: must be a valid id/],
    ['duplicate ids', (b: ReturnType<typeof valid>) => b.data.groups.push({ ...b.data.groups[0]! }), /duplicate id/],
    ['task in unknown group', (b: ReturnType<typeof valid>) => (b.data.tasks[0]!.group_id = '99999999-9999-4999-8999-999999999999'), /group that is not in the backup/],
    ['subtask of unknown task', (b: ReturnType<typeof valid>) => (b.data.subtasks[0]!.task_id = '99999999-9999-4999-8999-999999999999'), /task that is not in the backup/],
    ['label link to unknown label', (b: ReturnType<typeof valid>) => (b.data.task_labels[0]!.label_id = '99999999-9999-4999-8999-999999999999'), /label that is not in the backup/],
    ['bad priority', (b: ReturnType<typeof valid>) => ((b.data.tasks[0] as Record<string, unknown>).priority = 'critical'), /priority: must be one of/],
    ['impossible date', (b: ReturnType<typeof valid>) => (b.data.tasks[0]!.due_date = '2026-02-30'), /due_date: must be a date/],
    ['time without date', (b: ReturnType<typeof valid>) => ((b.data.tasks[0] as Record<string, unknown>).due_date = null), /needs a due date/],
    ['bad color', (b: ReturnType<typeof valid>) => (b.data.groups[0]!.color = 'red'), /color/],
    ['oversized card', (b: ReturnType<typeof valid>) => ((b.data.groups[0] as Record<string, unknown>).grid_w = 50), /grid_w/],
    ['section not a list', (b: ReturnType<typeof valid>) => ((b.data as Record<string, unknown>).tasks = { a: 1 }), /data\.tasks: must be a list/],
    ['recurring task without occurrence date', (b: ReturnType<typeof valid>) => ((b.data.tasks[0] as Record<string, unknown>).occurrence_date = null), /occurrence_date/],
  ])('rejects: %s', (_name, mutate, message) => {
    const b = valid()
    mutate(b)
    const result = validateBackup(b)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(message)
  })

  it('sanitizes rich text and ignores unknown or invalid settings, with warnings', () => {
    const b = valid()
    ;(b.data.tasks[0] as Record<string, unknown>).description = '<p>ok<script>alert(1)</script></p>'
    ;(b.data.settings as Record<string, unknown>).evil = 'x'
    ;(b.data.settings as Record<string, unknown>).widget_order = 'nope'
    const result = validateBackup(b)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(result.backup.data.tasks[0]!.description).toBe('<p>ok</p>')
    expect(result.backup.data.settings).not.toHaveProperty('evil')
    expect(result.warnings.join(' ')).toMatch(/Unknown setting "evil"/)
    expect(result.warnings.join(' ')).toMatch(/widget_order/)
    expect(result.warnings.join(' ')).toMatch(/formatting that is not allowed/)
  })

  it('caps the number of reported errors', () => {
    const b = valid()
    b.data.tasks = Array.from({ length: 40 }, () => ({ id: 'bad' })) as never
    const result = validateBackup(b)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeLessThanOrEqual(13)
      expect(result.errors[result.errors.length - 1]).toMatch(/more problem/)
    }
  })

  it('a built backup never contains account information', () => {
    const backup = buildBackup({ groups: [], labels: [], series: [], tasks: [], subtasks: [], taskLabels: [], settings: [] }, new Date('2026-01-01T00:00:00Z'))
    expect(Object.keys(backup)).toEqual(['format', 'version', 'exported_at', 'app_version', 'data'])
    expect(JSON.stringify(backup)).not.toMatch(/user_id|email|token|password|key/)
  })

  it('merge preparation maps same-named labels onto existing ones', () => {
    const result = validateBackup(valid())
    if (!result.ok) throw new Error()
    const existing = '66666666-6666-4666-8666-666666666666'
    const prepared = prepareImport(result.backup, { userId: 'u1', mode: 'merge', existingLabels: [{ id: existing, name: 'exam' }] })
    expect(prepared.payload.data.labels).toHaveLength(0)
    expect(prepared.payload.data.task_labels[0]!.label_id).toBe(existing)
    const replace = prepareImport(result.backup, { userId: 'u1', mode: 'replace', existingLabels: [{ id: existing, name: 'exam' }] })
    expect(replace.payload.data.labels).toHaveLength(1)
  })
})
