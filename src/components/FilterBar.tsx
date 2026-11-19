import { EMPTY_FILTERS, isFilterActive, type DueFilter, type FilterState, type StatusFilter } from '../lib/filters'
import { PRIORITIES, PRIORITY_LABEL } from '../lib/types'
import type { AppData } from '../lib/view'
import { Icon } from './Icon'
import { MultiSelectMenu } from './fields'

export function FilterBar({ data, filters, onChange, matches }: { data: AppData; filters: FilterState; onChange: (f: FilterState) => void; matches: number }) {
  const active = isFilterActive(filters)
  return (
    <div className="filter-bar" role="search">
      <div className="search-box">
        <Icon name="search" />
        <input
          type="search"
          className="input"
          placeholder="Search titles, descriptions and checklists"
          aria-label="Search tasks"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
      <MultiSelectMenu
        label="Priority"
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], color: data.settings.priority_colors[p] }))}
        selected={filters.priorities}
        onChange={(v) => onChange({ ...filters, priorities: v as FilterState['priorities'] })}
      />
      <MultiSelectMenu
        label="Label"
        options={data.labels.map((l) => ({ value: l.id, label: l.name, color: l.color }))}
        selected={filters.labelIds}
        onChange={(v) => onChange({ ...filters, labelIds: v })}
        emptyText="No labels yet"
      />
      <MultiSelectMenu
        label="Group"
        options={data.groups.map((g) => ({ value: g.id, label: `${g.icon} ${g.name}` }))}
        selected={filters.groupIds}
        onChange={(v) => onChange({ ...filters, groupIds: v })}
        emptyText="No groups yet"
      />
      <label className="select-filter">
        <span className="sr-only">Due date</span>
        <select className={`input input-small ${filters.due !== 'any' ? 'input-active' : ''}`} aria-label="Due date filter" value={filters.due} onChange={(e) => onChange({ ...filters, due: e.target.value as DueFilter })}>
          <option value="any">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
      </label>
      <label className="select-filter">
        <span className="sr-only">Status</span>
        <select className={`input input-small ${filters.status !== 'all' ? 'input-active' : ''}`} aria-label="Completion status filter" value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value as StatusFilter })}>
          <option value="all">Active and completed</option>
          <option value="active">Active only</option>
          <option value="completed">Completed only</option>
        </select>
      </label>
      {active && (
        <>
          <span className="match-count" role="status">
            {matches} matching task{matches === 1 ? '' : 's'}
          </span>
          <button type="button" className="button button-small" onClick={() => onChange(EMPTY_FILTERS)}>
            <Icon name="x" /> Reset filters
          </button>
        </>
      )}
    </div>
  )
}
