import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages cannot send security headers, so production builds carry a
 * Content-Security-Policy <meta> tag. Scripts may only come from this site,
 * and network requests may only go to this site and the configured Supabase
 * project. (Test builds skip it: the e2e backend runs PostgreSQL as WebAssembly.)
 */
function contentSecurityPolicy(mode: string): Plugin {
  return {
    name: 'ppd-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const env = loadEnv(mode, process.cwd(), 'VITE_')
      if ((process.env.VITE_E2E ?? env.VITE_E2E) === 'true') return html
      const raw = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
      let supabaseOrigin = ''
      try {
        supabaseOrigin = new URL(raw).origin
      } catch {
        // Missing URL: the app shows a configuration error and makes no requests.
      }
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        // Inline style attributes are used for user-chosen colors.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ')
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

// `base: './'` keeps every asset URL relative, so the same build works at
// https://<user>.github.io/<repo>/ and at a custom domain without changes.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    contentSecurityPolicy(mode),
    VitePWA({
      // 'prompt' never reloads the page on its own: a forced reload could
      // discard a half-written task form. The UI offers an explicit "Reload".
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Personal Productivity Dashboard',
        short_name: 'Dashboard',
        description: 'Private task dashboard with offline support',
        theme_color: '#4f46e5',
        background_color: '#f6f7fb',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Precache the application shell only. API traffic is never cached by
        // the service worker; offline data lives in IndexedDB.
        // The e2e build also precaches PGlite's WebAssembly so offline reloads work in tests.
        globPatterns: process.env.VITE_E2E === 'true' ? ['**/*.{js,css,html,svg,woff2,wasm,data}'] : ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: process.env.VITE_E2E === 'true' ? 64 * 1024 * 1024 : 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { sourcemap: true, target: 'es2022', chunkSizeWarningLimit: 1600 },
  // PGlite ships WebAssembly; it is only used by tests and the e2e build.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/helpers/setup-dom.ts'],
          env: { TZ: 'America/New_York' },
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts', 'tests/data/**/*.test.ts'],
          setupFiles: ['tests/helpers/setup-node.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
          env: { TZ: 'America/New_York' },
        },
      },
    ],
  },
}))
