/** Confirmation dialogs, choice dialogs and toast notifications. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  /** When set, a checkbox with this label must be ticked before confirming. */
  acknowledge?: string
}

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  description: string
  danger?: boolean
}

export interface ChoiceOptions<T extends string> {
  title: string
  message: ReactNode
  options: ChoiceOption<T>[]
}

export type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface FeedbackValue {
  confirm(options: ConfirmOptions): Promise<boolean>
  choose<T extends string>(options: ChoiceOptions<T>): Promise<T | null>
  toast(kind: ToastKind, message: string): void
}

const FeedbackContext = createContext<FeedbackValue | null>(null)

type Pending =
  | { type: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { type: 'choice'; options: ChoiceOptions<string>; resolve: (value: string | null) => void }

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const confirm = useCallback((options: ConfirmOptions) => {
    setAcknowledged(false)
    return new Promise<boolean>((resolve) => setPending({ type: 'confirm', options, resolve }))
  }, [])

  const choose = useCallback(<T extends string>(options: ChoiceOptions<T>) => {
    return new Promise<T | null>((resolve) =>
      setPending({ type: 'choice', options: options as ChoiceOptions<string>, resolve: resolve as (v: string | null) => void }),
    )
  }, [])

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, kind, message }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 5000)
  }, [])

  const value = useMemo(() => ({ confirm, choose, toast }), [confirm, choose, toast])

  const settle = (result: boolean | string | null) => {
    if (!pending) return
    if (pending.type === 'confirm') pending.resolve(result === true)
    else pending.resolve(typeof result === 'string' ? result : null)
    setPending(null)
  }

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {pending?.type === 'confirm' && (
        <Modal
          title={pending.options.title}
          role="alertdialog"
          size="sm"
          onClose={() => settle(false)}
          footer={
            <>
              <button type="button" className="button" data-autofocus onClick={() => settle(false)}>
                {pending.options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={pending.options.danger ? 'button button-danger' : 'button button-primary'}
                disabled={!!pending.options.acknowledge && !acknowledged}
                onClick={() => settle(true)}
              >
                {pending.options.confirmLabel}
              </button>
            </>
          }
        >
          <div className="confirm-message">{pending.options.message}</div>
          {pending.options.acknowledge && (
            <label className="check-row confirm-ack">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              <span>{pending.options.acknowledge}</span>
            </label>
          )}
        </Modal>
      )}
      {pending?.type === 'choice' && (
        <Modal
          title={pending.options.title}
          size="sm"
          onClose={() => settle(null)}
          footer={
            <button type="button" className="button" onClick={() => settle(null)}>
              Cancel
            </button>
          }
        >
          <div className="confirm-message">{pending.options.message}</div>
          <div className="choice-list">
            {pending.options.options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                className={`choice ${option.danger ? 'choice-danger' : ''}`}
                data-autofocus={i === 0 ? true : undefined}
                onClick={() => settle(option.value)}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider')
  return value
}

/** Turn any thrown value into a message that is safe and useful to show. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'ImportBlockedError')) return error.message
  if (error instanceof Error && error.name === 'RemoteError') return `The server could not complete the request: ${error.message}`
  console.error('[app] unexpected error:', error instanceof Error ? error.name : typeof error)
  return 'Something went wrong and the change was not made. Please try again.'
}
