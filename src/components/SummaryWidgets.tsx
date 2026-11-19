import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { WIDGET_LABEL, type WidgetKey } from '../lib/filters'
import { Icon, type IconName } from './Icon'

const WIDGET_ICON: Record<WidgetKey, IconName> = { today: 'clock', overdue: 'alert', upcoming: 'calendar' }
const WIDGET_HINT: Record<WidgetKey, string> = {
  today: 'Open tasks due today',
  overdue: 'Open tasks past their deadline',
  upcoming: 'Open tasks due in the next 7 days',
}

interface Props {
  order: WidgetKey[]
  counts: Record<WidgetKey, number>
  active: WidgetKey | null
  onSelect: (key: WidgetKey) => void
  onReorder: (order: WidgetKey[]) => void
}

function Widget({ k, count, active, onSelect, index, total, onMove }: { k: WidgetKey; count: number; active: boolean; onSelect: () => void; index: number; total: number; onMove: (delta: number) => void }) {
  const sortable = useSortable({ id: k })
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={`widget widget-${k} ${active ? 'widget-active' : ''}`}
      data-testid={`widget-${k}`}
    >
      <button type="button" className="widget-main" aria-pressed={active} onClick={onSelect} title={active ? 'Click to clear this filter' : `Show ${WIDGET_HINT[k].toLowerCase()}`}>
        <span className="widget-icon">
          <Icon name={WIDGET_ICON[k]} size={20} />
        </span>
        <span className="widget-text">
          <span className="widget-label">{WIDGET_LABEL[k]}</span>
          <span className="widget-hint">{active ? 'Showing these tasks · click to clear' : WIDGET_HINT[k]}</span>
        </span>
        <span className="widget-count" aria-label={`${count} tasks`}>
          {count}
        </span>
      </button>
      <div className="widget-tools">
        <button type="button" className="drag-handle" aria-label={`Drag to rearrange ${WIDGET_LABEL[k]}`} {...sortable.attributes} {...sortable.listeners}>
          <Icon name="grip" />
        </button>
        <button type="button" className="icon-button" aria-label={`Move ${WIDGET_LABEL[k]} left`} disabled={index === 0} onClick={() => onMove(-1)}>
          <Icon name="left" size={14} />
        </button>
        <button type="button" className="icon-button" aria-label={`Move ${WIDGET_LABEL[k]} right`} disabled={index === total - 1} onClick={() => onMove(1)}>
          <Icon name="right" size={14} />
        </button>
      </div>
    </div>
  )
}

export function SummaryWidgets({ order, counts, active, onSelect, onReorder }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (event: DragEndEvent) => {
    const { active: a, over } = event
    if (!over || a.id === over.id) return
    onReorder(arrayMove(order, order.indexOf(a.id as WidgetKey), order.indexOf(over.id as WidgetKey)))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        <div className="widgets" role="group" aria-label="Summary">
          {order.map((k, i) => (
            <Widget
              key={k}
              k={k}
              index={i}
              total={order.length}
              count={counts[k]}
              active={active === k}
              onSelect={() => onSelect(k)}
              onMove={(delta) => onReorder(arrayMove(order, i, i + delta))}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
