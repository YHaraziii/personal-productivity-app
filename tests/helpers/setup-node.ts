// Node test environment: an in-memory IndexedDB for Dexie, and a DOM window
// for the HTML sanitizer (which normally uses the browser's).
import 'fake-indexeddb/auto'
import { JSDOM } from 'jsdom'
import { setSanitizerWindow } from '../../src/lib/sanitize'

setSanitizerWindow(new JSDOM('').window as unknown as Parameters<typeof setSanitizerWindow>[0])
