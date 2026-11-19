import { useEffect, useId, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

/** E-mail and password sign-in. There is intentionally no sign-up link and
 *  no password reset: the account is provisioned by the owner. */
export function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const emailId = useId()
  const passwordId = useId()

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError('Enter your e-mail and password.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await signIn(email.trim(), password)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      setPassword('')
    }
  }

  return (
    <main className="signin-page" id="main">
      <form className="signin-card" onSubmit={submit} noValidate aria-labelledby="signin-title">
        <div className="signin-logo" aria-hidden="true">
          ✓
        </div>
        <h1 id="signin-title">Personal Dashboard</h1>
        <p className="muted">Sign in to your private task dashboard.</p>
        {notice && (
          <p className="notice notice-info" role="status">
            {notice}
          </p>
        )}
        {!online && (
          <p className="notice notice-warning" role="status">
            You are offline. Signing in needs a connection. If you signed in on this device before, your data opens automatically when you are signed in.
          </p>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor={emailId}>E-mail</label>
          <input id={emailId} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <input id={passwordId} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">This is a private site. Accounts are created by the owner only.</p>
      </form>
    </main>
  )
}
