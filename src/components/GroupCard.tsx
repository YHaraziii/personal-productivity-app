import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo } from 'react'
import { useSession } from '../data/session'
import { matchesFilters, type FilterState } from '../lib/filters'
import { SORT_FIELD_LABEL, sortTasks } from '../lib/sorting'
import { LIMITS, SORT_FIELDS, type GroupRow, type SortField, type TaskRow } from '../lib/types'
import { labelIdsOf, primaryLabelOf, subtasksOf, type AppData } from '../lib/view'
import { readableOn } from '../lib/theme'
import { errorMessage, useFeedback } from './Feedback'
import { Icon } from './Icon'
import { ActionMenu } from './fields'
import { TaskItem } from './TaskItem'

interface Props {
  group: GroupRow
  data: AppData
  filters: FilterState
  filtering: boolean
  now: Date
  index: number
  count: number
  onEditGroup: (group: GroupRow) => void
  onNewTask: (groupId: string) => void
  onEditTask: (task: TaskRow) => void
}

export function GroupCard({ group, data, filters, filtering, now, index, count, onEditGroup, onNewTask, onEditTask }: Props) {
  const { repo } = useSession()
  const { confirm, toast } = useFeedback()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const all = data.tasksByGroup.get(group.id) ?? []
  const ctx = useMemo(
    () => ({
      labelIdsOf: (id: string) => labelIdsOf(data, id),
      subtasksOf: (id: string) => subtasksOf(data, id),
      primaryLabel: (id: string) => primaryLabelOf(data, id),
    }),
    [data],
  )
  const sorted = useMemo(() => sortTasks(all, group.sort_field, group.sort_dir, ctx), [all, group.sort_field, group.sort_dir, ctx])
  const visible = filtering ? sorted.filter((t) => matchesFilters(t, filters, ctx, now)) : sorted
  const manual = group.sort_field === 'manual'
  const openCount = all.filter((t) => !t.completed_at).length

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const remove = async () => {
    const taskCount = all.length
    const ok = await confirm({
      title: `Delete the group “${group.name}”?`,
      message: (
        <>
          <p>
            <strong>
              This also deletes all {taskCount} task{taskCount === 1 ? '' : 's'} in this group
            </strong>
            , including completed tasks, every checklist item, label assignment and repeating schedule that belongs to them.
          </p>
          <p>This cannot be undone, except by importing a backup that you exported earlier.</p>
        </>
      ),
      confirmLabel: 'Delete group and its tasks',
      danger: true,
      acknowledge: taskCount > 0 ? `I understand that ${taskCount} task${taskCount === 1 ? '' : 's'} will be deleted` : undefined,
    })
    if (ok) await run(() => repo.deleteGroup(group.id))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = visible.map((t) => t.id)
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    void run(() => repo.reorderTasks(group.id, next))
  }

  const resize = (dw: number, dh: number) =>
    void run(() =>
      repo.setGroupLayouts([
        {
          id: group.id,
          grid_w: Math.max(LIMITS.gridMinW, Math.min(LIMITS.gridMaxW, group.grid_w + dw)),
          grid_h: Math.max(LIMITS.gridMinH, Math.min(LIMITS.gridMaxH, group.grid_h + dh)),
        },
      ]),
    )

  const headerStyle = { '--group': group.color, '--on-group': readableOn(group.color) } as React.CSSProperties
  const regionId = `group-${group.id}-tasks`

  return (
    <section className={`group-card ${group.collapsed ? 'group-collapsed' : ''}`} style={headerStyle} aria-label={group.name} data-testid="group-card">
      <header className="group-header">
        <button type="button" className="card-drag-handle" aria-label={`Drag to move ${group.name}`} title="Drag to move or rearrange">
          <Icon name="grip" />
        </button>
        <button
          type="button"
          className="group-toggle"
          aria-expanded={!group.collapsed}
          aria-controls={regionId}
          onClick={() => void run(() => repo.setGroupCollapsed(group.id, !group.collapsed))}
        >
          <Icon name={group.collapsed ? 'chevronRight' : 'chevronDown'} />
          <span className="group-icon" aria-hidden="true">
            {group.icon}
          </span>
          <span className="group-name">{group.name}</span>
          <span className="group-count">
            {openCount} open{all.length !== openCount ? ` · ${all.length - openCount} done` : ''}
          </span>
          {data.unsyncedGroupIds.has(group.id) && (
            <span className="unsynced-dot" title="Changes not yet confirmed by the server">
              <Icon name="cloudOff" size={13} />
              <span className="sr-only">Not synced yet</span>
            </span>
          )}
        </button>
        <div className="group-tools">
          <button type="button" className="icon-button on-group" aria-label={`Add task to ${group.name}`} title="Add task" onClick={() => onNewTask(group.id)}>
            <Icon name="plus" />
          </button>
          <ActionMenu label={`${group.name} options`}>
            {(close) => (
              <>
                <button type="button" role="menuitem" onClick={() => (close(), onEditGroup(group))}>
                  <Icon name="edit" /> Edit group
                </button>
                <button type="button" role="menuitem" disabled={index === 0} onClick={() => (close(), void run(() => repo.moveGroup(group.id, -1)))}>
                  <Icon name="up" /> Move up
                </button>
                <button type="button" role="menuitem" disabled={index === count - 1} onClick={() => (close(), void run(() => repo.moveGroup(group.id, 1)))}>
                  <Icon name="down" /> Move down
                </button>
                <div className="menu-sep" role="separator" />
                <button type="button" role="menuitem" disabled={group.grid_w >= LIMITS.gridMaxW} onClick={() => resize(1, 0)}>
                  <Icon name="right" /> Wider
                </button>
                <button type="button" role="menuitem" disabled={group.grid_w <= LIMITS.gridMinW} onClick={() => resize(-1, 0)}>
                  <Icon name="left" /> Narrower
                </button>
                <button type="button" role="menuitem" disabled={group.grid_h >= LIMITS.gridMaxH} onClick={() => resize(0, 2)}>
                  <Icon name="expand" /> Taller
                </button>
                <button type="button" role="menuitem" disabled={group.grid_h <= LIMITS.gridMinH} onClick={() => resize(0, -2)}>
                  <Icon name="collapse" /> Shorter
                </button>
                <div className="menu-sep" role="separator" />
                <button type="button" role="menuitem" className="danger" onClick={() => (close(), void remove())}>
                  <Icon name="trash" /> Delete group…
                </button>
              </>
            )}
          </ActionMenu>
        </div>
      </header>
      {!group.collapsed && (
        <div className="group-content" id={regionId}>
          {group.description && <p className="group-description">{group.description}</p>}
          <div className="sort-bar">
            <label className="sort-label">
              <span>Sort</span>
              <select
                className="input input-small"
                value={group.sort_field}
                aria-label={`Sort tasks in ${group.name}`}
                onChange={(e) => void run(() => repo.setGroupSort(group.id, e.target.value as SortField, group.sort_dir))}
              >
                {SORT_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {SORT_FIELD_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            {!manual && (
              <button
                type="button"
                className="button button-small"
                aria-label={`Sort direction: ${group.sort_dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`}
                onClick={() => void run(() => repo.setGroupSort(group.id, group.sort_field, group.sort_dir === 'asc' ? 'desc' : 'asc'))}
              >
                <Icon name={group.sort_dir === 'asc' ? 'up' : 'down'} />
                {group.sort_dir === 'asc' ? 'Ascending' : 'Descending'}
              </button>
            )}
          </div>
          {all.length === 0 ? (
            <div className="empty empty-small">
              <p>No tasks yet.</p>
              <button type="button" className="button button-small button-primary" onClick={() => onNewTask(group.id)}>
                <Icon name="plus" /> Add the first task
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="empty empty-small muted">No tasks in this group match the current search or filters.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={visible.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ul className="task-list">
                  {visible.map((task, i) => (
                    <TaskItem key={task.id} task={task} data={data} now={now} manual={manual} index={i} count={visible.length} onEdit={onEditTask} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </section>
  )
}
