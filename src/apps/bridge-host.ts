/**
 * bridge-host — the shell's end of the `app-bridge` postMessage envelope (D1096).
 *
 * The schema and the parser live in `@dominevo/types` (`app-bridge`); this file
 * only builds what the shell SENDS and narrows what it RECEIVES. Anything that
 * is not an app-to-shell message — unknown, malformed, another protocol, or the
 * shell's own message echoed back by a webview — is `null` and is ignored.
 */
import { parseAppBridgeMessage, type AppToShellMessage, type ShellToAppMessage } from '@dominevo/types/client'

const ENVELOPE = { camstack: 'app-bridge', v: 1 } as const

export function helloMessage(): ShellToAppMessage {
  return { ...ENVELOPE, type: 'hello' }
}

export function navigateMessage(path: string): ShellToAppMessage {
  return { ...ENVELOPE, type: 'navigate', path }
}

export function searchMessage(query: string): ShellToAppMessage {
  return { ...ENVELOPE, type: 'search', query }
}

export function themeMessage(mode: 'light' | 'dark'): ShellToAppMessage {
  return { ...ENVELOPE, type: 'theme', mode }
}

/** What the drawer acts on. */
export type AppEvent =
  | { readonly kind: 'ready'; readonly path: string }
  | { readonly kind: 'path'; readonly path: string; readonly title: string }
  | { readonly kind: 'invalidate'; readonly what: 'badges' | 'nav' }
  | { readonly kind: 'open-app'; readonly appId: string; readonly path?: string }

function isAppToShell(message: ReturnType<typeof parseAppBridgeMessage>): message is AppToShellMessage {
  return message !== null && (message.type === 'ready' || message.type === 'path' || message.type === 'invalidate' || message.type === 'open-app')
}

function decode(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** One received `postMessage` payload (an object on the web, JSON text from a native webview), or `null` to ignore it. */
export function interpretAppMessage(raw: unknown): AppEvent | null {
  const message = parseAppBridgeMessage(decode(raw))
  if (!isAppToShell(message)) return null
  switch (message.type) {
    case 'ready':
      return { kind: 'ready', path: message.path }
    case 'path':
      return { kind: 'path', path: message.path, title: message.title }
    case 'invalidate':
      return { kind: 'invalidate', what: message.what }
    case 'open-app':
      return message.path === undefined ? { kind: 'open-app', appId: message.appId } : { kind: 'open-app', appId: message.appId, path: message.path }
  }
}
