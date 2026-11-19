/** Lists unresolved conflicts and rejected changes, and resolves them. */
import { useState } from 'react'
import type { OutboxEntry } from '../data/db'
import { useSession } from '../data/session'
import { formatDue, formatTimestamp } from '../lib/dates'
import { SETTING_LABEL, isSettingKey } from '../lib/settings'
import { htmlToPlainText } from '../lib/text'
import { PRIORITY_LABEL, type Priority, type TableName } from '../lib/types'
import type { AppData } from '../lib/view'
import type { Resolution } from '../sync/engine'
import { errorMessage, useFeedback } from './Feedback'
import { Modal } from './Modal'

const TABLE_NOUN: Record<TableName, string> = {
  groups: 'Group',
  labels: 'Label',
  recurrence_series: 'Repeat schedule',
  tasks: 'Task',
  subtasks: 'Checklist item',
  task_labels: 'Label assignment',
  user_settings: 'Setting',
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  name: 'Name',
  description: 'Description',
  priority: 'Priority',
  due_date: 'Due date',
  due_time: 'Due time',
  completed_at: 'Completion',
  completed: 'Checked',
  deleted_at: 'Exists',
  color: 'Color',
  icon: 'Icon',
  text: 'Text',
  manual_index: 'Manual position',
  sort_index: 'Position',
  collapsed: 'Collapsed',
  grid_x: 'Column',
  grid_y: 'Row',
  grid_w: 'Width',
  grid_h: 'Height',
  sort_field: 'Sort by',
  sort_dir: 'Sort direction',
  value: 'Value',
  unit: 'Repeat unit',
  interval_count: 'Repeat interval',
  anchor_date: 'Schedule start',
  ended_at: 'Schedule',
  label_ids: 'Labels',
  subtasks: 'Checklist template',
}

function show(field: string, value: unknown): string {
  if (field === 'deleted_at') return value ? 'Deleted' : 'Exists'
  if (field === 'completed_at') return value ? `Completed ${formatTimestamp(String(value))}` : 'Not completed'
  if (field === 'ended_at') return value ? 'Stopped' : 'Active'
  if (value === null || value === undefined || value === '') return '(empty)'
  if (field === 'description') return htmlToPlainText(String(value)).slice(0, 300) || '(empty)'
  if (field === 'priority') return PRIORITY_LABEL[value as Priority] ?? String(value)
  if (field === 'due_date') return formatDue(String(value), null)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 200)
  return String(value).slice(0, 300)
}

function describeEntity(entry: OutboxEntry, data: AppData): string {
  const local = (data.raw[tableKey(entry.table)] as unknown as Array<Record<string, unknown>>).find((r) => r.id === entry.row_id)
  const row = local ?? entry.server_row ?? {}
  if (entry.table === 'user_settings') {
    const key = String(row.key ?? '')
    return `Setting: ${isSettingKey(key) ? SETTING_LABEL[key] : key}`
  }
  const name = (row.title ?? row.name ?? row.text ?? '') as string
  if (entry.table === 'subtasks') {
    const task = data.raw.tasks.find((t) => t.id === row.task_id)
    return `Checklist item “${name}”${task ? ` in “${task.title}”` : ''}`
  }
  return `${TABLE_NOUN[entry.table]}${name ? ` “${name}”` : ''}`
}

function tableKey(table: TableName): keyof AppData['raw'] {
  return ({ groups: 'groups', labels: 'labels', recurrence_series: 'series', tasks: 'tasks', subtasks: 'subtasks', task_labels: 'taskLabels', user_settings: 'settings' } as const)[table]
}

function ConflictCard({ entry, data }: { entry: OutboxEntry; data: AppData }) {
  const { engine } = useSession()
  const { toast } = useFeedback()
  const [choice, setChoice] = useState<Record<string, 'local' | 'server'>>({})
  const server = entry.server_row ?? {}
  const resolve = async (resolution: Resolution) => {
    try {
      await engine.resolveConflict(entry.seq!, resolution)
      toast('info', 'Conflict resolved. The chosen version is being saved.')
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }
  const title = describeEntity(entry, data)

  if (entry.op === 'delete') {
    return (
      <article className="conflict" data-testid="conflict">
        <h3>{title}</h3>
        <p>You deleted this on this device, but it was changed on another device (or in another tab) before your deletion reached the server.</p>
        <div className="conflict-actions">
          <button type="button" className="button button-danger" onClick={() => void resolve('local')}>
            Delete it anyway
          </button>
          <button type="button" className="button" onClick={() => void resolve('server')}>
            Keep it (with the other changes)
          </button>
        </div>
      </article>
    )
  }

  const serverDeleted = server.deleted_at != null
  const fields = entry.conflict_fields.filter((f) => f !== 'deleted_at')
  return (
    <article className="conflict" data-testid="conflict">
      <h3>{title}</h3>
      {serverDeleted ? (
        <p>This was deleted on another device while you were editing it here. Your edits are kept until you decide.</p>
      ) : (
        <p>This was changed on another device while you also changed it here. Choose which version to keep for each field.</p>
      )}
      {fields.length > 0 && (
        <div className="table-wrap">
          <table className="conflict-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Your version (this device)</th>
                <th scope="col">Server version</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field}>
                  <th scope="row">{FIELD_LABEL[field] ?? field}</th>
                  <td>
                    <label className="check-row">
                      <input type="radio" name={`${entry.seq}-${field}`} checked={(choice[field] ?? 'local') === 'local'} onChange={() => setChoice({ ...choice, [field]: 'local' })} />
                      <span>{show(field, entry.payload[field])}</span>
                    </label>
                  </td>
                  <td>
                    <label className="check-row">
                      <input type="radio" name={`${entry.seq}-${field}`} checked={choice[field] === 'server'} onChange={() => setChoice({ ...choice, [field]: 'server' })} />
                      <span>{show(field, server[field])}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="conflict-actions">
        {serverDeleted ? (
          <>
            <button type="button" className="button button-primary" onClick={() => void resolve({ ...choice, deleted_at: 'local' })}>
              Restore it with my changes
            </button>
            <button type="button" className="button" onClick={() => void resolve('server')}>
              Accept the deletion
            </button>
          </>
        ) : (
          <>
            {fields.length > 1 && (
              <button type="button" className="button button-primary" onClick={() => void resolve(choice)}>
                Apply my choices
              </button>
            )}
            <button type="button" className={`button ${fields.length > 1 ? '' : 'button-primary'}`} onClick={() => void resolve('local')}>
              Keep my version
            </button>
            <button type="button" className="button" onClick={() => void resolve('server')}>
              Keep server version
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function FailureCard({ entry, data }: { entry: OutboxEntry; data: AppData }) {
  const { engine } = useSession()
  const { confirm, toast } = useFeedback()
  const discard = async () => {
    const ok = await confirm({
      title: 'Discard this change?',
      message: 'This change will be removed from this device and the server version will be shown instead. This cannot be undone.',
      confirmLabel: 'Discard change',
      danger: true,
    })
    if (!ok) return
    try {
      await engine.discardFailed(entry.seq!)
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }
  return (
    <article className="conflict failure" data-testid="failure">
      <h3>{describeEntity(entry, data)}</h3>
      <p>{entry.last_error ?? 'The server did not accept this change.'}</p>
      <p className="muted small">
        Change type: {entry.op} · made {formatTimestamp(entry.created_at)} · attempts: {entry.attempts}
      </p>
      <div className="conflict-actions">
        <button type="button" className="button" onClick={() => void engine.retryFailed()}>
          Retry
        </button>
        <button type="button" className="button button-danger" onClick={() => void discard()}>
          Discard this change…
        </button>
      </div>
    </article>
  )
}

export function SyncPanel({ data, onClose }: { data: AppData; onClose: () => void }) {
  return (
    <Modal title="Sync issues" size="lg" onClose={onClose}>
      {data.conflicts.length === 0 && data.failures.length === 0 && <p>Everything is in sync. There is nothing to review.</p>}
      {data.conflicts.length > 0 && (
        <section className="stack">
          <h3 className="section-title">Conflicts ({data.conflicts.length})</h3>
          <p className="muted small">Nothing is overwritten until you decide. Both versions are kept until then.</p>
          {data.conflicts.map((entry) => (
            <ConflictCard key={entry.seq} entry={entry} data={data} />
          ))}
        </section>
      )}
      {data.failures.length > 0 && (
        <section className="stack">
          <h3 className="section-title">Changes the server rejected ({data.failures.length})</h3>
          <p className="muted small">These changes are kept on this device. They are not sent again automatically after repeated failures.</p>
          {data.failures.map((entry) => (
            <FailureCard key={entry.seq} entry={entry} data={data} />
          ))}
        </section>
      )}
    </Modal>
  )
}
