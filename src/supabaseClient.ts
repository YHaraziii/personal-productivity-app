import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** True when `key` is a privileged key that must never reach a browser. */
export function isSecretKey(candidate: string): boolean {
  if (candidate.startsWith('sb_secret_')) return true
  const payload = candidate.split('.')[1]
  if (!payload) return false
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return json?.role === 'service_role'
  } catch {
    return false
  }
}

function validateConfig(): string | null {
  if (!url || !key) {
    return 'The app is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. See the README, section "Environment variables".'
  }
  if (!/^https?:\/\//.test(url)) return 'VITE_SUPABASE_URL must be a full URL such as https://your-project.supabase.co.'
  if (isSecretKey(key)) {
    return 'Refusing to start: VITE_SUPABASE_ANON_KEY contains a secret (service_role) key. Use the public anon / publishable key and rotate the secret key immediately.'
  }
  return null
}

export const supabaseConfigError = validateConfig()

export const supabase: SupabaseClient | null = supabaseConfigError
  ? null
  : createClient(url!, key!, {
      auth: {
        // The session is kept in this browser until the user signs out.
        persistSession: true,
        autoRefreshToken: true,
        // E-mail + password only: there are no redirect callbacks to parse.
        detectSessionInUrl: false,
        storageKey: 'ppd-auth',
      },
    })
