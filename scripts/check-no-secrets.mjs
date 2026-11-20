#!/usr/bin/env node
// Fails (exit 1) if a Supabase secret key appears in the build output.
// Usage: node scripts/check-no-secrets.mjs [dir=dist]
//
// It looks for real keys, not for the bare text "sb_secret_": supabase-js and
// the app's own guard contain that prefix as a string literal.
//   - new-format secret keys: sb_secret_ followed by the key body
//   - legacy JWT keys whose payload has "role": "service_role"
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'dist'
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

const findings = []
for (const path of files(root)) {
  const text = readFileSync(path, 'latin1')
  if (SECRET_KEY.test(text)) findings.push(`${path}: secret API key (sb_secret_…)`)
  for (const match of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') findings.push(`${path}: service_role JWT`)
    } catch {
      // Not a decodable JWT payload; ignore.
    }
  }
}

if (findings.length > 0) {
  for (const f of findings) console.error(`::error::${f}. Use the anon / publishable key and rotate the leaked key.`)
  process.exit(1)
}
console.log(`No secret keys found in ${root}/.`)
