/** Backup (JSON), CSV export and import. */
import { useRef, useState } from 'react'
import { exportBackup, exportCsv, importBackup } from '../data/backupIO'
import { useSession } from '../data/session'
import { describeImportSummary, parseBackupText, type Backup, type ImportMode } from '../lib/backup'
import { formatTimestamp, todayLocal } from '../lib/dates'
import { errorMessage, useFeedback } from './Feedback'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Loaded {
  fileName: string
  backup: Backup
  warnings: string[]
}

export function DataDialog({ onClose, pending }: { onClose: () => void; pending: number }) {
  const session = useSession()
  const { confirm, toast } = useFeedback()
  const fileRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [mode, setMode] = useState<ImportMode>('merge')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)

  const doExportJson = async () => {
    try {
      const backup = await exportBackup(session.db)
      downloadFile(`dashboard-backup-${todayLocal()}.json`, JSON.stringify(backup, null, 2), 'application/json')
      toast('success', pending > 0 ? 'Backup downloaded. It includes changes not yet synced from this device.' : 'Backup downloaded.')
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const doExportCsv = async () => {
    try {
      downloadFile(`dashboard-tasks-${todayLocal()}.csv`, await exportCsv(session.db), 'text/csv;charset=utf-8')
      toast('success', 'CSV downloaded.')
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const onFile = async (file: File | undefined) => {
    setLoaded(null)
    setErrors([])
    setResult(null)
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setErrors(['The file could not be read.'])
      return
    }
    const parsed = parseBackupText(text)
    if (!parsed.ok) setErrors(parsed.errors)
    else setLoaded({ fileName: file.name, backup: parsed.backup, warnings: parsed.warnings })
  }

  const doImport = async () => {
    if (!loaded || busy) return
    const d = loaded.backup.data
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Replace all current data?',
        message: (
          <>
            <p>
              Everything currently in your dashboard will be replaced by the contents of <strong>{loaded.fileName}</strong>: {d.groups.length} groups and {d.tasks.length} tasks.
            </p>
            <p>Groups, tasks and labels that are not in the backup will be deleted. Consider exporting a backup of your current data first.</p>
          </>
        ),
        confirmLabel: 'Replace my data',
        danger: true,
        acknowledge: 'I understand that my current data will be replaced',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const outcome = await importBackup(
        { db: session.db, engine: session.engine, remote: session.remote, userId: session.userId },
        loaded.backup,
        mode,
      )
      setResult([...describeImportSummary(outcome.summary), ...outcome.notes, ...loaded.warnings])
      setLoaded(null)
      if (fileRef.current) fileRef.current.value = ''
      toast('success', 'Import complete.')
    } catch (error) {
      setErrors([errorMessage(error), 'Your existing data was not changed.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Backup, export and import" size="lg" onClose={busy ? () => {} : onClose}>
      <section className="stack">
        <h3 className="section-title">Export</h3>
        <div className="export-grid">
          <div className="export-option">
            <h4>Full backup (JSON)</h4>
            <p className="muted small">Everything needed to restore your dashboard: groups, tasks, checklists, labels, repeat schedules and history, layout and appearance. No passwords or session data.</p>
            <button type="button" className="button button-primary" onClick={() => void doExportJson()}>
              <Icon name="download" /> Download backup
            </button>
          </div>
          <div className="export-option">
            <h4>All tasks (CSV)</h4>
            <p className="muted small">Every task from every group in one spreadsheet file, regardless of filters. Formatting is reduced to plain text; use JSON for a full backup.</p>
            <button type="button" className="button" onClick={() => void doExportCsv()}>
              <Icon name="download" /> Download CSV
            </button>
          </div>
        </div>
      </section>

      <section className="stack">
        <h3 className="section-title">Import a backup</h3>
        <div className="field">
          <label htmlFor="import-file">Backup file (.json)</label>
          <input id="import-file" ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {errors.length > 0 && (
          <div className="notice notice-error" role="alert">
            <p>
              <strong>This file cannot be imported.</strong> Nothing was changed.
            </p>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {loaded && (
          <div className="stack">
            <p className="notice notice-info">
              <strong>{loaded.fileName}</strong> is a valid backup from {formatTimestamp(loaded.backup.exported_at)} with {loaded.backup.data.groups.length} groups, {loaded.backup.data.tasks.length} tasks and {loaded.backup.data.labels.length} labels.
            </p>
            {loaded.warnings.length > 0 && (
              <ul className="muted small">
                {loaded.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <fieldset className="fieldset">
              <legend>How should it be imported?</legend>
              <label className="radio-card">
                <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  <strong>Merge</strong> — add what is missing. Groups, tasks and labels you already have stay exactly as they are (yours win); items you deleted that are in the backup are restored; labels with the same name are combined.
                </span>
              </label>
              <label className="radio-card">
                <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <strong>Replace</strong> — make the dashboard match the backup exactly. Anything not in the backup is deleted.
                </span>
              </label>
            </fieldset>
            <p className="muted small">The import runs on the server in a single step: it either completes fully or changes nothing. It needs a connection and no unsynced changes on this device.</p>
            <div>
              <button type="button" className={`button ${mode === 'replace' ? 'button-danger' : 'button-primary'}`} disabled={busy} onClick={() => void doImport()}>
                <Icon name="upload" /> {busy ? 'Importing…' : mode === 'replace' ? 'Replace with backup…' : 'Merge backup'}
              </button>
            </div>
          </div>
        )}
        {result && (
          <div className="notice notice-success" role="status">
            <p>
              <strong>Import finished.</strong>
            </p>
            <ul>
              {result.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Modal>
  )
}
