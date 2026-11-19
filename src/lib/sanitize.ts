/**
 * Rich-text sanitization and URL validation.
 *
 * Descriptions are stored as HTML restricted to a tiny allowlist. Content is
 * sanitized when it is saved, when it is imported, AND every time it is
 * rendered, so nothing that reaches the database by another route (a hand-
 * edited backup, a direct API call) can execute script in the page.
 */
import createDOMPurify, { type DOMPurify, type WindowLike } from 'dompurify'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a']
const ALLOWED_ATTR = ['href']
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

let purifier: DOMPurify | null = null

/** Tests running outside a browser provide a DOM window explicitly. */
export function setSanitizerWindow(win: WindowLike): void {
  purifier = configure(createDOMPurify(win))
}

function configure(instance: DOMPurify): DOMPurify {
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return
    const href = node.getAttribute('href') ?? ''
    if (!isSafeUrl(href)) {
      node.removeAttribute('href')
      return
    }
    // Links always open in a new tab without access to this window.
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  })
  return instance
}

function getPurifier(): DOMPurify {
  if (!purifier) {
    if (typeof window === 'undefined') throw new Error('No DOM available for sanitizing HTML')
    purifier = configure(createDOMPurify(window))
  }
  return purifier
}

/** Only absolute http(s) and mailto links are allowed. */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false
  try {
    const parsed = new URL(trimmed)
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return false
    return parsed.protocol === 'mailto:' ? parsed.pathname.includes('@') : parsed.hostname.length > 0
  } catch {
    return false
  }
}

/** Turn user input into a safe absolute URL, or null. "example.com" -> "https://example.com". */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (isSafeUrl(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null // some other scheme, e.g. javascript:
  const withScheme = trimmed.includes('@') && !trimmed.includes('/') ? `mailto:${trimmed}` : `https://${trimmed}`
  return isSafeUrl(withScheme) && /\.[a-z]{2,}/i.test(withScheme) ? withScheme : null
}

export function sanitizeHtml(html: unknown): string {
  if (typeof html !== 'string' || html === '') return ''
  const clean = getPurifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  })
  // An editor with no content still emits "<p></p>"; store that as empty.
  return /^(<p>(<br\s*\/?>)?<\/p>)*$/.test(clean) ? '' : clean
}
