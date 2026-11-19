import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { isSeriesActive, type DeleteScope } from '../data/repo'
import { useSession } from '../data/session'
import { dueBucket, formatDue } from '../lib/dates'
import { describeRule } from '../lib/recurrence'
import type { TaskRow } from '../lib/types'
import { labelIdsOf, subtasksOf, type AppData } from '../lib/view'
import { errorMessage, useFeedback } from './Feedback'
import { OptimisticCheckbox } from './Checkbox'
import { Icon } from './Icon'
import { RichText } from './RichTextEditor'
import { LabelChip, PriorityBadge } from './fields'

const STATUS_TEXT = {
  overdue: 'Overdue',
  today: 'Due today',
  upcoming: 'Upcoming',
} as const

interface Props {
  task: TaskRow
  data: AppData
  now: Date
  manual: boolean
  index: number
  count: number
  onEdit: (task: TaskRow) => void
}

export function TaskItem({ task, data, now, manual, index, count, onEdit }: Props) {
  const { repo } = useSession()
  const { confirm, choose, toast } = useFeedback()
  const [expanded, setExpanded] = useState(false)
  const sortable = useSortable({ id: task.id, disabled: !manual })
  const subtasks = subtasksOf(data, task.id)
  const labels = labelIdsOf(data, task.id)
    .map((id) => data.labelsById.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name))
  const series = task.series_id ? data.seriesById.get(task.series_id) : undefined
  const recurring = isSeriesActive(series)
  const completed = !!task.completed_at
  const bucket = dueBucket(task, now)
  const status = completed ? 'completed' : bucket === 'overdue' || bucket === 'today' || bucket === 'upcoming' ? bucket : 'active'
  const done = subtasks.filter((s) => s.completed).length
  const unsynced = data.unsyncedTaskIds.has(task.id)
  const hasDetails = subtasks.length > 0 || !!task.description

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (error) {
      toast('error', errorMessage(error))
      throw error
    }
  }

  const remove = async () => {
    if (series && !series.deleted_at && (recurring || !completed)) {
      const scope = await choose<DeleteScope>({
        title: `Delete “${task.title}”?`,
        message: recurring
          ? 'This is a repeating task. Choose what to delete.'
          : 'This task belonged to a repeating series that has ended.',
        options: [
          {
            value: 'this',
            label: 'Only this occurrence',
            description: recurring && !completed
              ? 'Deletes this occurrence and its checklist. The series continues with the next date.'
              : 'Deletes only this task and its checklist.',
            danger: true,
          },
          {
            value: 'series',
            label: 'This and all open occurrences',
            description: 'Stops the repeat schedule and deletes every open occurrence. Completed occurrences are kept as history.',
            danger: true,
          },
        ],
      })
      if (scope) await run(() => repo.deleteTask(task.id, scope)).catch(() => undefined)
      return
    }
    const ok = await confirm({
      title: `Delete “${task.title}”?`,
      message: 'The task and its checklist will be deleted. This cannot be undone (except by restoring a backup).',
      confirmLabel: 'Delete task',
      danger: true,
    })
    if (ok) await run(() => repo.deleteTask(task.id, 'this')).catch(() => undefined)
  }

  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={`task task-${status} ${sortable.isDragging ? 'task-dragging' : ''}`}
      data-testid="task"
      data-task-id={task.id}
    >
      <div className="task-main">
        {manual && (
          <button
            type="button"
            className="drag-handle"
            aria-label={`Drag to reorder ${task.title}`}
            title="Drag to reorder"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <Icon name="grip" />
          </button>
        )}
        <OptimisticCheckbox
          className="task-check"
          checked={completed}
          aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onCheckedChange={(next) => run(() => repo.setTaskCompleted(task.id, next))}
        />
        <div className="task-body">
          <div className="task-title-row">
            <button type="button" className="task-title" onClick={() => onEdit(task)} title="Open task">
              {task.title}
            </button>
            {status !== 'active' && <span className={`status status-${status}`}>{status === 'completed' ? 'Completed' : STATUS_TEXT[status]}</span>}
          </div>
          <div className="task-meta">
            {task.due_date && (
              <span className="meta">
                <Icon name="calendar" size={13} /> {formatDue(task.due_date, task.due_time)}
              </span>
            )}
            <PriorityBadge priority={task.priority} color={data.settings.priority_colors[task.priority]} />
            {recurring && (
              <span className="meta" title={describeRule(series!)}>
                <Icon name="repeat" size={13} /> {describeRule(series!)}
              </span>
            )}
            {subtasks.length > 0 && (
              <span className="meta" aria-label={`${done} of ${subtasks.length} checklist items done`}>
                <Icon name="check" size={13} /> {done}/{subtasks.length}
              </span>
            )}
            {labels.map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
            {unsynced && (
              <span className="meta unsynced" title="Saved on this device; not yet confirmed by the server">
                <Icon name="cloudOff" size={13} /> Not synced yet
              </span>
            )}
          </div>
        </div>
        <div className="task-actions">
          {hasDetails && (
            <button
              type="button"
              className="icon-button"
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide details' : 'Show details'}
              title={expanded ? 'Hide details' : 'Show details'}
              onClick={() => setExpanded((v) => !v)}
            >
              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
            </button>
          )}
          {manual && (
            <>
              <button type="button" className="icon-button" aria-label={`Move ${task.title} up`} title="Move up" disabled={index === 0} onClick={() => void run(() => repo.moveTask(task.id, -1)).catch(() => undefined)}>
                <Icon name="up" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${task.title} down`}
                title="Move down"
                disabled={index === count - 1}
                onClick={() => void run(() => repo.moveTask(task.id, 1)).catch(() => undefined)}
              >
                <Icon name="down" />
              </button>
            </>
          )}
          <button type="button" className="icon-button" aria-label={`Edit ${task.title}`} title="Edit" onClick={() => onEdit(task)}>
            <Icon name="edit" />
          </button>
          <button type="button" className="icon-button icon-danger" aria-label={`Delete ${task.title}`} title="Delete" onClick={() => void remove()}>
            <Icon name="trash" />
          </button>
        </div>
      </div>
      {expanded && hasDetails && (
        <div className="task-details">
          <RichText html={task.description} />
          {subtasks.length > 0 && (
            <ul className="subtasks">
              {subtasks.map((s) => (
                <li key={s.id} className={s.completed ? 'subtask-done' : ''}>
                  <label className="check-row">
                    <OptimisticCheckbox checked={s.completed} onCheckedChange={(next) => run(() => repo.setSubtaskCompleted(s.id, next))} />
                    <span>{s.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
