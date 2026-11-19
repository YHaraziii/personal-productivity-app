import { useId, useState } from 'react'
import { useSession } from '../data/session'
import { LIMITS, type GroupRow } from '../lib/types'
import { errorMessage, useFeedback } from './Feedback'
import { Modal } from './Modal'
import { ColorField, IconField } from './fields'

export function GroupForm({ group, onClose, onCreated }: { group?: GroupRow; onClose: () => void; onCreated?: (id: string) => void }) {
  const { repo } = useSession()
  const { toast } = useFeedback()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [color, setColor] = useState(group?.color ?? '#6366f1')
  const [icon, setIcon] = useState(group?.icon ?? '📁')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameId = useId()
  const descId = useId()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) {
      setError('Enter a name for the group.')
      return
    }
    setSaving(true)
    try {
      if (group) await repo.updateGroup(group.id, { name, description, color, icon })
      else {
        const id = await repo.createGroup({ name, description, color, icon })
        onCreated?.(id)
      }
      toast('success', group ? 'Group updated.' : 'Group created.')
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={group ? 'Edit group' : 'New group'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="group-form" className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : group ? 'Save group' : 'Create group'}
          </button>
        </>
      }
    >
      <form id="group-form" className="form" onSubmit={submit} noValidate>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor={nameId}>
            Name <span className="required">(required)</span>
          </label>
          <input id={nameId} data-autofocus className="input" value={name} maxLength={LIMITS.groupName} onChange={(e) => setName(e.target.value)} placeholder="e.g. School, Research, Podcast" />
        </div>
        <div className="field">
          <label htmlFor={descId}>
            Description <span className="muted">(optional)</span>
          </label>
          <textarea id={descId} className="input" rows={2} maxLength={LIMITS.groupDescription} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <ColorField label="Card color" value={color} onChange={setColor} />
        <IconField value={icon} onChange={setIcon} />
        <div className="group-preview" style={{ '--group': color } as React.CSSProperties} aria-hidden="true">
          <span className="group-icon">{icon}</span> {name || 'Group name'}
        </div>
      </form>
    </Modal>
  )
}
