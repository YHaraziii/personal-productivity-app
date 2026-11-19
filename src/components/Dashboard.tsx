import { useMemo, useRef, useState } from 'react'
import ReactGridLayout, { useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout'
import { verticalCompactor } from 'react-grid-layout/core'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useSession } from '../data/session'
import type { GroupLayoutPatch } from '../data/repo'
import { EMPTY_FILTERS, activeWidget, isFilterActive, matchesFilters, widgetCounts, widgetFilter, type FilterState } from '../lib/filters'
import { buildLayout, orderFromLayout } from '../lib/layout'
import type { GroupRow, TaskRow } from '../lib/types'
import { labelIdsOf, subtasksOf, type AppData } from '../lib/view'
import { useNow } from '../hooks/useNow'
import { errorMessage, useFeedback } from './Feedback'
import { FilterBar } from './FilterBar'
import { GroupCard } from './GroupCard'
import { GroupForm } from './GroupForm'
import { Icon } from './Icon'
import { SummaryWidgets } from './SummaryWidgets'
import { TaskForm } from './TaskForm'

type Editor = { kind: 'group'; group?: GroupRow } | { kind: 'task'; groupId: string; task?: TaskRow } | null

export function Dashboard({ data }: { data: AppData }) {
  const { repo } = useSession()
  const { toast } = useFeedback()
  const now = useNow()
  // Search and filters live in memory only: every visit starts unfiltered.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [editor, setEditor] = useState<Editor>(null)
  const { width, containerRef, mounted } = useContainerWidth()
  const resultsRef = useRef<HTMLDivElement>(null)

  const filtering = isFilterActive(filters)
  const mode = data.settings.layout_mode
  const ctx = useMemo(() => ({ labelIdsOf: (id: string) => labelIdsOf(data, id), subtasksOf: (id: string) => subtasksOf(data, id) }), [data])
  const counts = useMemo(() => widgetCounts(data.tasks, now), [data.tasks, now])
  const matching = useMemo(() => (filtering ? data.tasks.filter((t) => matchesFilters(t, filters, ctx, now)) : data.tasks), [data.tasks, filters, ctx, now, filtering])

  // While filtering, only groups that contain a match are shown (expanded),
  // and the layout is not editable, so the saved layout is never changed by a
  // temporary view.
  const shownGroups = useMemo(() => {
    if (!filtering) return data.groups
    const withMatches = new Set(matching.map((t) => t.group_id))
    return data.groups.filter((g) => withMatches.has(g.id)).map((g) => ({ ...g, collapsed: false }))
  }, [data.groups, filtering, matching])

  const layout = useMemo(() => buildLayout(shownGroups, filtering ? 'auto' : mode), [shownGroups, mode, filtering])

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const persistLayout = (next: Layout, resized: LayoutItem | null) => {
    if (filtering) return
    const patches: GroupLayoutPatch[] = []
    if (resized) {
      const group = data.groupsById.get(resized.i)
      if (group && !group.collapsed && (group.grid_w !== resized.w || group.grid_h !== resized.h)) {
        patches.push({ id: group.id, grid_w: resized.w, grid_h: resized.h })
      }
    }
    if (mode === 'free') {
      for (const item of next) {
        const group = data.groupsById.get(item.i)
        if (group && (group.grid_x !== item.x || group.grid_y !== item.y)) {
          const existing = patches.find((p) => p.id === item.i)
          if (existing) Object.assign(existing, { grid_x: item.x, grid_y: item.y })
          else patches.push({ id: item.i, grid_x: item.x, grid_y: item.y })
        }
      }
    }
    if (patches.length > 0) void run(() => repo.setGroupLayouts(patches))
  }

  const onDragStop = (next: Layout) => {
    if (filtering) return
    if (mode === 'auto') void run(() => repo.reorderGroups(orderFromLayout(next)))
    else persistLayout(next, null)
  }

  const selectWidget = (key: Parameters<typeof widgetFilter>[1]) => {
    setFilters((f) => widgetFilter(f, key))
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const anyCollapsed = data.groups.some((g) => g.collapsed)
  const anyExpanded = data.groups.some((g) => !g.collapsed)

  return (
    <main className="dashboard" id="main">
      <SummaryWidgets
        order={data.settings.widget_order}
        counts={counts}
        active={activeWidget(filters)}
        onSelect={selectWidget}
        onReorder={(order) => void run(() => repo.setSetting('widget_order', order))}
      />

      {data.groups.length > 0 && <FilterBar data={data} filters={filters} onChange={setFilters} matches={matching.length} />}

      <div className="toolbar" ref={resultsRef}>
        <h1 className="toolbar-title">{filtering ? 'Search results' : 'Groups'}</h1>
        <div className="toolbar-actions">
          {data.groups.length > 0 && !filtering && (
            <>
              <button type="button" className="button button-small" disabled={!anyCollapsed} onClick={() => void run(() => repo.setAllCollapsed(false))}>
                <Icon name="expand" /> Expand all
              </button>
              <button type="button" className="button button-small" disabled={!anyExpanded} onClick={() => void run(() => repo.setAllCollapsed(true))}>
                <Icon name="collapse" /> Collapse all
              </button>
            </>
          )}
          <button type="button" className="button button-primary" onClick={() => setEditor({ kind: 'group' })}>
            <Icon name="plus" /> New group
          </button>
        </div>
      </div>

      {data.groups.length === 0 ? (
        <div className="empty empty-hero">
          <div className="empty-art" aria-hidden="true">
            🗂️
          </div>
          <h2>Your dashboard is empty</h2>
          <p>
            Start by creating a <strong>group</strong> for an area of your life or work, such as School, Research or Podcast. Each group becomes a card that holds its own tasks.
          </p>
          <button type="button" className="button button-primary button-large" onClick={() => setEditor({ kind: 'group' })}>
            <Icon name="plus" /> Create your first group
          </button>
        </div>
      ) : filtering && shownGroups.length === 0 ? (
        <div className="empty">
          <h2>No tasks match</h2>
          <p>Nothing matches the current search and filters.</p>
          <button type="button" className="button" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </button>
        </div>
      ) : (
        <>
          {filtering && (
            <p className="muted small filter-note">
              Showing {matching.length} matching task{matching.length === 1 ? '' : 's'} in {shownGroups.length} group{shownGroups.length === 1 ? '' : 's'}. Card layout editing is paused while filtering.
            </p>
          )}
          <div ref={containerRef} className="grid-container">
            {mounted && (
              <ReactGridLayout
                layout={layout}
                width={width}
                gridConfig={{ cols: 12, rowHeight: 30, margin: [14, 14], containerPadding: [0, 0] }}
                dragConfig={{ enabled: !filtering, handle: '.card-drag-handle', bounded: false, threshold: 3 }}
                resizeConfig={{ enabled: !filtering, handles: ['se'] }}
                compactor={verticalCompactor}
                onDragStop={(next) => onDragStop(next)}
                onResizeStop={(next, _old, item) => persistLayout(next, item)}
              >
                {shownGroups.map((group, i) => (
                  <div key={group.id} className="grid-item">
                    <GroupCard
                      group={group}
                      data={data}
                      filters={filters}
                      filtering={filtering}
                      now={now}
                      index={filtering ? data.groups.findIndex((g) => g.id === group.id) : i}
                      count={data.groups.length}
                      onEditGroup={(g) => setEditor({ kind: 'group', group: data.groupsById.get(g.id) })}
                      onNewTask={(groupId) => setEditor({ kind: 'task', groupId })}
                      onEditTask={(task) => setEditor({ kind: 'task', groupId: task.group_id, task })}
                    />
                  </div>
                ))}
              </ReactGridLayout>
            )}
          </div>
        </>
      )}

      {editor?.kind === 'group' && <GroupForm group={editor.group} onClose={() => setEditor(null)} />}
      {editor?.kind === 'task' && <TaskForm data={data} groupId={editor.groupId} task={editor.task} onClose={() => setEditor(null)} />}
    </main>
  )
}
