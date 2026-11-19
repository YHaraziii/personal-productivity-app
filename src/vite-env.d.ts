/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Test builds only. */
  readonly VITE_E2E?: string
  readonly VITE_E2E_PASSWORD?: string
}
