import type { SaveStatus } from '../lib/saveStatus'
import { Icon, type IconName } from './Icon'

const ICON: Record<SaveStatus['kind'], IconName> = {
  saved: 'cloud',
  saving: 'sync',
  pending: 'sync',
  offline: 'cloudOff',
  failed: 'alert',
  conflict: 'alert',
}

/** Server-confirmed state only shows as "Saved"; everything else says plainly
 *  that changes exist on this device only. */
export function SaveIndicator({ status, onOpenIssues, onRetry }: { status: SaveStatus; onOpenIssues: () => void; onRetry: () => void }) {
  const actionable = status.kind === 'failed' || status.kind === 'conflict'
  return (
    <div className={`save-status save-${status.kind}`} data-testid="save-status" data-kind={status.kind}>
      <span role="status" aria-live="polite" title={status.detail} className="save-label">
        <Icon name={ICON[status.kind]} />
        <span>{status.label}</span>
        <span className="sr-only">. {status.detail}</span>
      </span>
      {actionable && (
        <button type="button" className="button button-small" onClick={onOpenIssues}>
          Review
        </button>
      )}
      {status.kind === 'failed' && (
        <button type="button" className="button button-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
