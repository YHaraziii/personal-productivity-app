import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import type { AuthApi, AuthUser } from '../../src/auth/authApi'
import { FeedbackProvider, useFeedback } from '../../src/components/Feedback'
import { SaveIndicator } from '../../src/components/SaveIndicator'
import { newId } from '../../src/lib/ids'
import { deriveSaveStatus } from '../../src/lib/saveStatus'
import type { PullResult, PushMutation, PushResult, Remote } from '../../src/sync/engine'

/** In-memory stand-in for the server: applies inserts/updates and returns rows. */
function memoryRemote(): Remote & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    async push(mutations: PushMutation[]): Promise<PushResult[]> {
      return mutations.map((m) => {
        const key = `${m.table}:${m.row_id}`
        const now = new Date().toISOString()
        const current = rows.get(key)
        if (m.op === 'insert') {
          const row = { ...m.payload, id: m.row_id, user_id: 'u', version: 1, updated_at: now, deleted_at: null, table: m.table }
          rows.set(key, row)
          return { mutation_id: m.mutation_id, status: 'applied', row }
        }
        if (!current) return { mutation_id: m.mutation_id, status: 'missing' }
        const next = { ...current, ...(m.op === 'delete' ? { deleted_at: now } : m.payload), version: (current.version as number) + 1, updated_at: now }
        rows.set(key, next)
        return { mutation_id: m.mutation_id, status: 'applied', row: next }
      })
    },
    async pull(): Promise<PullResult> {
      const tables: PullResult['tables'] = {}
      for (const row of rows.values()) {
        const t = row.table as keyof PullResult['tables']
        ;(tables[t] ??= []).push(row)
      }
      return { next_since: new Date().toISOString(), tables }
    },
    async importBackup() {
      throw new Error('not used')
    },
  }
}

function fakeAuth(initial: AuthUser | null): AuthApi & { signIn: ReturnType<typeof vi.fn> } {
  let user = initial
  return {
    getSession: async () => (user ? { kind: 'signed_in', user } : { kind: 'signed_out' }),
    signIn: vi.fn(async (email: string, password: string) => {
      if (password !== 'correct-horse') return { ok: false as const, message: 'The e-mail or password is incorrect.' }
      user = { userId: newId(), email }
      return { ok: true as const, user }
    }),
    signOut: async () => {
      user = null
    },
    onChange: () => () => {},
  }
}

describe('app shell', () => {
  it('shows only the sign-in form when signed out, with no registration or reset links', async () => {
    const remote = memoryRemote()
    const pull = vi.spyOn(remote, 'pull')
    render(<App auth={fakeAuth(null)} remote={remote} />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText(/sign up|register|forgot|reset/i)).toBeNull()
    expect(screen.queryByTestId('save-status')).toBeNull()
    expect(pull).not.toHaveBeenCalled() // no data request without a session
  })

  it('signs in, shows the empty dashboard, and creates a group', async () => {
    const user = userEvent.setup()
    const auth = fakeAuth(null)
    const remote = memoryRemote()
    render(<App auth={auth} remote={remote} />)
    await user.type(await screen.findByLabelText('E-mail'), 'me@example.test')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The e-mail or password is incorrect.')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Your dashboard is empty' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveAttribute('data-kind', 'saved'))

    await user.click(screen.getByRole('button', { name: 'Create your first group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name for the group.')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Research')
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your dashboard is empty' })).toBeNull())
    await waitFor(() => expect([...remote.rows.values()].some((r) => r.table === 'groups' && r.name === 'Research')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveAttribute('data-kind', 'saved'))
  })
})

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const { confirm } = useFeedback()
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: 'Delete?', message: 'Gone forever', confirmLabel: 'Delete', danger: true, acknowledge: 'I understand' }))}>
      open
    </button>
  )
}

describe('destructive confirmations', () => {
  it('cannot be confirmed until the warning is acknowledged; cancel and Escape decline', async () => {
    const user = userEvent.setup()
    const results: boolean[] = []
    render(
      <FeedbackProvider>
        <ConfirmHarness onResult={(v) => results.push(v)} />
      </FeedbackProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'open' }))
    let dialog = screen.getByRole('alertdialog', { name: 'Delete?' })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus() // safe default
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'open' }))
    dialog = screen.getByRole('alertdialog', { name: 'Delete?' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'I understand' }))
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(results).toEqual([false, false, true])
  })
})

describe('save indicator', () => {
  it('distinguishes server-confirmed from local-only changes', () => {
    const base = { online: true, phase: 'idle' as const, pending: 0, failed: 0, conflicts: 0, lastError: null }
    const { rerender } = render(<SaveIndicator status={deriveSaveStatus(base)} onOpenIssues={() => {}} onRetry={() => {}} />)
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saved')
    rerender(<SaveIndicator status={deriveSaveStatus({ ...base, online: false, pending: 2 })} onOpenIssues={() => {}} onRetry={() => {}} />)
    expect(screen.getByTestId('save-status')).toHaveTextContent('Offline · pending sync')
    expect(screen.getByTestId('save-status')).toHaveTextContent('2 changes saved on this device only')
    rerender(<SaveIndicator status={deriveSaveStatus({ ...base, conflicts: 1 })} onOpenIssues={() => {}} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })
})
