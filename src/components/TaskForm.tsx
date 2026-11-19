/** Full task creation / editing form. */
import { useId, useMemo, useRef, useState } from 'react'
import { useSession } from '../data/session'
import type { EditScope, SubtaskDraft, TaskDraft } from '../data/repo'
import { describeRule, presetOf, type RecurrencePreset } from '../lib/recurrence'
import { formatTimestamp, isValidDate } from '../lib/dates'
import { deepEqual } from '../lib/text'
import { newId } from '../lib/ids'
import { LIMITS, PRIORITIES, PRIORITY_LABEL, RECURRENCE_UNITS, type RecurrenceUnit, type TaskRow } from '../lib/types'
import { labelIdsOf, subtasksOf, type AppData } from '../lib/view'
import { isSeriesActive } from '../data/repo'
import { clearDraft, useDraft } from '../hooks/useDraft'
import { errorMessage, useFeedback } from './Feedback'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { RichTextEditor } from './RichTextEditor'
import { COLOR_SWATCHES } from './fields'

interface FormSubtask extends SubtaskDraft {
  key: string
}

interface FormState {
  title: string
  description: string
  priority: TaskDraft['priority']
  due_date: string
  due_time: string
  label_ids: string[]
  subtasks: FormSubtask[]
  preset: RecurrencePreset
  custom_unit: RecurrenceUnit
  custom_interval: string
}

const UNIT_LABEL: Record<RecurrenceUnit, string> = { day: 'days', week: 'weeks', month: 'months' }

function initialState(data: AppData, task: TaskRow | undefined): FormState {
  if (!task) {
    return {
      title: '',
      description: '',
      priority: 'medium',
      due_date: '',
      due_time: '',
      label_ids: [],
      subtasks: [],
      preset: 'none',
      custom_unit: 'week',
      custom_interval: '2',
    }
  }
  const series = task.series_id ? data.seriesById.get(task.series_id) : undefined
  const active = isSeriesActive(series) ? series : null
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    due_date: task.due_date ?? '',
    due_time: task.due_time ? task.due_time.slice(0, 5) : '',
    label_ids: [...labelIdsOf(data, task.id)],
    subtasks: subtasksOf(data, task.id).map((s) => ({ id: s.id, key: s.id, text: s.text, completed: s.completed })),
    preset: presetOf(active),
    custom_unit: active?.unit ?? 'week',
    custom_interval: String(active && active.interval_count !== 1 ? active.interval_count : 2),
  }
}

function recurrenceOf(s: FormState): TaskDraft['recurrence'] | 'invalid' {
  switch (s.preset) {
    case 'none':
      return null
    case 'daily':
      return { unit: 'day', interval_count: 1 }
    case 'weekly':
      return { unit: 'week', interval_count: 1 }
    case 'monthly':
      return { unit: 'month', interval_count: 1 }
    case 'custom': {
      const n = Number(s.custom_interval)
      return Number.isInteger(n) && n >= 1 && n <= LIMITS.intervalMax ? { unit: s.custom_unit, interval_count: n } : 'invalid'
    }
  }
}

interface Errors {
  title?: string
  due_date?: string
  due_time?: string
  recurrence?: string
  form?: string
}

function validate(s: FormState): Errors {
  const errors: Errors = {}
  if (!s.title.trim()) errors.title = 'Enter a title for the task.'
  else if (s.title.trim().length > LIMITS.taskTitle) errors.title = `Titles can be at most ${LIMITS.taskTitle} characters.`
  if (s.due_date && !isValidDate(s.due_date)) errors.due_date = 'Enter a valid date.'
  if (s.due_time && !s.due_date) errors.due_time = 'Add a due date, or clear the time.'
  const rec = recurrenceOf(s)
  if (rec === 'invalid') errors.recurrence = `Enter a whole number from 1 to ${LIMITS.intervalMax}.`
  else if (rec && !s.due_date) errors.recurrence = 'A repeating task needs a due date for its first occurrence.'
  return errors
}

export function TaskForm({
  data,
  groupId,
  task,
  onClose,
}: {
  data: AppData
  groupId: string
  task?: TaskRow
  onClose: () => void
}) {
  const { repo } = useSession()
  const { confirm, choose, toast } = useFeedback()
  const draftKey = task ? `task:${task.id}` : `task:new:${groupId}`
  const initial = useMemo(() => initialState(data, task), [])
  const [state, setState, restored] = useDraft<FormState>(draftKey, () => initial)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = { title: useId(), date: useId(), time: useId(), priority: useId(), preset: useId(), interval: useId(), unit: useId() }

  const group = data.groupsById.get(groupId)
  const series = task?.series_id ? data.seriesById.get(task.series_id) : undefined
  const recurring = isSeriesActive(series)
  const dirty = !deepEqual(state, initial)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((prev) => ({ ...prev, [key]: value }))

  const close = async () => {
    if (dirty) {
      const discard = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes in this task. They will be lost.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      if (!discard) return
    }
    clearDraft(draftKey)
    onClose()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return // no duplicate submissions
    const found = validate(state)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      if (found.title) titleRef.current?.focus()
      return
    }
    const recurrence = recurrenceOf(state) as TaskDraft['recurrence']
    const draft: TaskDraft = {
      group_id: groupId,
      title: state.title,
      description: state.description,
      priority: state.priority,
      due_date: state.due_date || null,
      due_time: state.due_time || null,
      label_ids: state.label_ids,
      subtasks: state.subtasks.map(({ id, text, completed }) => ({ id, text, completed })),
      recurrence,
    }
    let scope: EditScope = 'this'
    if (task && recurring) {
      const picked = await choose<EditScope>({
        title: 'Edit recurring task',
        message: 'This task repeats. Which occurrences should these changes apply to?',
        options: [
          {
            value: 'this',
            label: 'This occurrence only',
            description: 'Only this task changes. The schedule and future occurrences stay as they are.',
          },
          {
            value: 'future',
            label: 'This and future occurrences',
            description:
              'This task, the repeat schedule and the open future occurrences change. Completed occurrences are kept exactly as they were.',
          },
        ],
      })
      if (!picked) return
      scope = picked
    }
    setSaving(true)
    try {
      if (task) await repo.updateTask(task.id, draft, scope)
      else await repo.createTask(draft)
      clearDraft(draftKey)
      toast('success', task ? 'Task updated.' : 'Task created.')
      onClose()
    } catch (error) {
      // The form stays open with everything the user typed.
      setErrors({ form: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const addLabel = async () => {
    const name = newLabel.trim()
    if (!name) return
    try {
      const color = COLOR_SWATCHES[data.labels.length % COLOR_SWATCHES.length]!
      const id = await repo.createLabel({ name, color })
      set('label_ids', [...state.label_ids, id])
      setNewLabel('')
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const updateSubtask = (index: number, patch: Partial<FormSubtask>) =>
    set('subtasks', state.subtasks.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  const moveSubtask = (index: number, delta: number) => {
    const next = [...state.subtasks]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    set('subtasks', next)
  }

  const rec = recurrenceOf(state)
  const preview =
    rec && rec !== 'invalid' && isValidDate(state.due_date)
      ? describeRule({ ...rec, anchor_date: state.due_date })
      : null

  return (
    <Modal
      title={task ? 'Edit task' : `New task in ${group?.name ?? 'group'}`}
      size="lg"
      onClose={() => void close()}
      footer={
        <>
          {task && (
            <span className="muted small form-meta">
              Created {formatTimestamp(task.created_at)}
              {task.completed_at ? ` · Completed ${formatTimestamp(task.completed_at)}` : ''}
            </span>
          )}
          <button type="button" className="button" onClick={() => void close()}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </button>
        </>
      }
    >
      <form id="task-form" className="form" onSubmit={submit} noValidate>
        {restored && (
          <p className="notice notice-info" role="status">
            Your unsaved changes from earlier were restored.
          </p>
        )}
        {errors.form && (
          <p className="notice notice-error" role="alert">
            {errors.form}
          </p>
        )}
        <div className="field">
          <label htmlFor={ids.title}>
            Title <span className="required">(required)</span>
          </label>
          <input
            id={ids.title}
            ref={titleRef}
            data-autofocus
            className="input"
            value={state.title}
            maxLength={LIMITS.taskTitle}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? `${ids.title}-err` : undefined}
            onChange={(e) => set('title', e.target.value)}
          />
          {errors.title && (
            <p className="field-error" id={`${ids.title}-err`}>
              {errors.title}
            </p>
          )}
        </div>

        <RichTextEditor label="Description" value={state.description} onChange={(html) => set('description', html)} />

        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.date}>Due date</label>
            <input
              id={ids.date}
              type="date"
              className="input"
              value={state.due_date}
              aria-invalid={!!errors.due_date}
              onChange={(e) => set('due_date', e.target.value)}
            />
            {errors.due_date && <p className="field-error">{errors.due_date}</p>}
          </div>
          <div className="field">
            <label htmlFor={ids.time}>
              Due time <span className="muted">(optional)</span>
            </label>
            <div className="inline">
              <input
                id={ids.time}
                type="time"
                className="input"
                value={state.due_time}
                disabled={!state.due_date}
                aria-invalid={!!errors.due_time}
                onChange={(e) => set('due_time', e.target.value)}
              />
              {state.due_time && (
                <button type="button" className="button button-small" onClick={() => set('due_time', '')}>
                  Clear time
                </button>
              )}
            </div>
            <p className="hint">{state.due_date && !state.due_time ? 'No time: due any time that day.' : ' '}</p>
            {errors.due_time && <p className="field-error">{errors.due_time}</p>}
          </div>
          <div className="field">
            <label htmlFor={ids.priority}>Priority</label>
            <select id={ids.priority} className="input" value={state.priority} onChange={(e) => set('priority', e.target.value as FormState['priority'])}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="field fieldset">
          <legend>Labels</legend>
          {data.labels.length === 0 && <p className="muted small">No labels yet. Create one below.</p>}
          <div className="label-picker">
            {data.labels.map((label) => {
              const on = state.label_ids.includes(label.id)
              return (
                <label key={label.id} className={`label-option ${on ? 'label-option-on' : ''}`} style={{ '--tone': label.color } as React.CSSProperties}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => set('label_ids', on ? state.label_ids.filter((x) => x !== label.id) : [...state.label_ids, label.id])}
                  />
                  <span className="dot" aria-hidden="true" />
                  {label.name}
                </label>
              )
            })}
          </div>
          <div className="inline">
            <input
              className="input input-short"
              placeholder="New label name"
              aria-label="New label name"
              value={newLabel}
              maxLength={LIMITS.labelName}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addLabel()
                }
              }}
            />
            <button type="button" className="button button-small" onClick={() => void addLabel()} disabled={!newLabel.trim()}>
              <Icon name="plus" /> Add label
            </button>
          </div>
        </fieldset>

        <fieldset className="field fieldset">
          <legend>
            Checklist{' '}
            {state.subtasks.length > 0 && (
              <span className="muted">
                ({state.subtasks.filter((s) => s.completed).length}/{state.subtasks.length} done)
              </span>
            )}
          </legend>
          <ol className="subtask-editor">
            {state.subtasks.map((s, i) => (
              <li key={s.key}>
                <input
                  type="checkbox"
                  checked={s.completed}
                  aria-label={`Mark checklist item ${i + 1} done`}
                  onChange={(e) => updateSubtask(i, { completed: e.target.checked })}
                />
                <input
                  className="input"
                  value={s.text}
                  maxLength={LIMITS.subtaskText}
                  aria-label={`Checklist item ${i + 1}`}
                  onChange={(e) => updateSubtask(i, { text: e.target.value })}
                />
                <button type="button" className="icon-button" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => moveSubtask(i, -1)}>
                  <Icon name="up" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move item ${i + 1} down`}
                  disabled={i === state.subtasks.length - 1}
                  onClick={() => moveSubtask(i, 1)}
                >
                  <Icon name="down" />
                </button>
                <button
                  type="button"
                  className="icon-button icon-danger"
                  aria-label={`Delete checklist item ${i + 1}`}
                  onClick={() => set('subtasks', state.subtasks.filter((_, j) => j !== i))}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="button button-small"
            onClick={() => set('subtasks', [...state.subtasks, { key: newId(), text: '', completed: false }])}
          >
            <Icon name="plus" /> Add checklist item
          </button>
          <p className="hint">Empty items are ignored. Checking every item does not complete the task.</p>
        </fieldset>

        <fieldset className="field fieldset">
          <legend>Repeat</legend>
          <div className="field-row">
            <div className="field">
              <label htmlFor={ids.preset}>Repeats</label>
              <select id={ids.preset} className="input" value={state.preset} onChange={(e) => set('preset', e.target.value as RecurrencePreset)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom interval…</option>
              </select>
            </div>
            {state.preset === 'custom' && (
              <>
                <div className="field">
                  <label htmlFor={ids.interval}>Every</label>
                  <input
                    id={ids.interval}
                    type="number"
                    min={1}
                    max={LIMITS.intervalMax}
                    className="input input-number"
                    value={state.custom_interval}
                    aria-invalid={!!errors.recurrence}
                    onChange={(e) => set('custom_interval', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={ids.unit}>Unit</label>
                  <select id={ids.unit} className="input" value={state.custom_unit} onChange={(e) => set('custom_unit', e.target.value as RecurrenceUnit)}>
                    {RECURRENCE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
          {preview && (
            <p className="hint">
              <Icon name="repeat" /> {preview}, starting {state.due_date}. Completing an occurrence creates the next one;
              missed dates are skipped.
            </p>
          )}
          {errors.recurrence && <p className="field-error">{errors.recurrence}</p>}
          {task && recurring && <p className="hint">When you save, you will be asked whether to change only this occurrence or future ones too.</p>}
        </fieldset>
      </form>
    </Modal>
  )
}
