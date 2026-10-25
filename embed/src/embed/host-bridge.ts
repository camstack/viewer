/**
 * Host↔embed transport centraliser. The embed runs in two hosts:
 *  - an RN `WKWebView` (iOS): config injected as a `window.__CAMSTACK_*` global
 *    before load; commands arrive as injected JS calling `window.__camstack*`;
 *    events go out via `window.ReactNativeWebView.postMessage`.
 *  - a browser `<iframe>` (web): no global can be set before load (cross-origin),
 *    so config is fetched via an `embed-ready`→`embed-config` handshake; commands
 *    arrive as `message` events; events go out via `window.parent.postMessage`.
 *
 * Only the physical transport differs — the message vocabulary and the command
 * handlers (`window.__camstackGrid` / `window.__camstackEmbed`) are shared. Host
 * OUT messages carry NO secrets (state / tile events), so '*' targetOrigin is
 * acceptable; all data stays token-gated at the SDK/tRPC layer.
 */
import { useEffect, useRef, useState } from 'react'

const HANDSHAKE_TIMEOUT_MS = 10_000

export type EmbedMode = 'grid' | 'player' | 'recording' | 'events'

export type ConfigResult<T> =
  | { readonly ok: true; readonly config: T }
  | { readonly ok: false; readonly error: string }

/** True when running inside a browser iframe (a real parent frame exists). In an
 *  RN WebView the page is the TOP frame, so `window.parent === window` → false. */
export function isInIframe(): boolean {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

/** Camera identity stamped onto every outgoing `type:'log'` message so the
 *  hub-side client-log ingest can lift it into `tags.deviceId` — log lines
 *  then resolve at CAMERA level in winston/the admin logs query, not just at
 *  "some viewer session" level. Single-device pages (player / recording) set
 *  it once at mount; the grid page leaves it unset (multi-device). */
let logDeviceId: number | null = null

export function setLogDeviceTag(deviceId: number): void {
  logDeviceId = deviceId
}

function withLogDeviceTag(msg: unknown): unknown {
  if (logDeviceId === null || typeof msg !== 'object' || msg === null) return msg
  const o = msg as Record<string, unknown>
  if (o.type !== 'log') return msg
  const data = typeof o.data === 'object' && o.data !== null ? o.data : {}
  return { ...o, data: { deviceId: logDeviceId, ...data } }
}

/** Emit a host-bound message. RN WebView → `ReactNativeWebView.postMessage`;
 *  browser iframe → `parent.postMessage`. No-op outside both. */
export function emitHost(rawMsg: unknown): void {
  const msg = withLogDeviceTag(rawMsg)
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
    .ReactNativeWebView
  if (rn) {
    rn.postMessage(JSON.stringify(msg))
    return
  }
  if (isInIframe()) {
    window.parent.postMessage(msg, '*')
  }
}

/** Listen for host→embed commands (browser iframe path). Returns a cleanup fn.
 *  On native, commands arrive as injected JS calling `window.__camstack*`
 *  directly, so no `embed-command` messages are posted and this is dormant. */
export function onHostCommand(handler: (command: Record<string, unknown>) => void): () => void {
  const listener = (e: MessageEvent): void => {
    const data: unknown = e.data
    if (typeof data !== 'object' || data === null) return
    const obj = data as Record<string, unknown>
    if (obj.type !== 'embed-command' || typeof obj.command !== 'object' || obj.command === null)
      return
    handler(obj.command as Record<string, unknown>)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

/** Acquire the embed config. Native: the host-injected global (synchronous).
 *  Browser iframe: post `embed-ready{mode}` to the parent and await an
 *  `embed-config` reply, then parse.
 *  Standalone (top-level window, no global): the optional `readUrl` source —
 *  a share URL carries the config in its query params + `#t=` fragment. When
 *  `readUrl` is absent or returns null (not a share link), the classic
 *  "config global is not set" error stands. */
export interface AcquireConfigOptions {
  /**
   * Try the URL source BEFORE the iframe handshake.
   *
   * Default false — the grid/player/recording share links are only ever opened
   * as a TOP-level window, and inside an iframe the host is authoritative.
   * The events embed sets it: `<iframe src="…?mode=events&v=1…#t=…">` is the
   * whole integration for a page that has a token and no message plumbing, and
   * without this the frame would hang on a handshake nobody answers.
   */
  readonly urlFirst?: boolean
}

export function acquireConfig<T>(
  mode: EmbedMode,
  readGlobal: () => unknown,
  parse: (raw: unknown) => ConfigResult<T>,
  readUrl?: () => ConfigResult<T> | null,
  options?: AcquireConfigOptions,
): Promise<ConfigResult<T>> {
  const injected = readGlobal()
  if (injected !== undefined && injected !== null) {
    return Promise.resolve(parse(injected))
  }
  if (options?.urlFirst === true) {
    const fromUrl = readUrl !== undefined ? readUrl() : null
    if (fromUrl !== null) return Promise.resolve(fromUrl)
  }
  if (!isInIframe()) {
    const fromUrl = readUrl !== undefined ? readUrl() : null
    if (fromUrl !== null) return Promise.resolve(fromUrl)
    return Promise.resolve({ ok: false, error: `config global for mode "${mode}" is not set` })
  }
  return new Promise<ConfigResult<T>>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const listener = (e: MessageEvent): void => {
      const data: unknown = e.data
      if (typeof data !== 'object' || data === null) return
      const obj = data as Record<string, unknown>
      if (obj.type !== 'embed-config') return
      clearTimeout(timeoutId)
      window.removeEventListener('message', listener)
      resolve(parse(obj.config))
    }
    window.addEventListener('message', listener)
    timeoutId = setTimeout(() => {
      window.removeEventListener('message', listener)
      resolve({ ok: false, error: 'config handshake timed out' })
    }, HANDSHAKE_TIMEOUT_MS)
    window.parent.postMessage({ type: 'embed-ready', mode }, '*')
  })
}

/** React hook over `acquireConfig`. Returns null while loading (web handshake),
 *  then the parsed result. Native resolves on the first tick.
 *  `readGlobal`, `parse` and `readUrl` are stabilised via refs so the effect
 *  runs once per `mode` change, even when callers pass inline functions. */
export function useEmbedConfig<T>(
  mode: EmbedMode,
  readGlobal: () => unknown,
  parse: (raw: unknown) => ConfigResult<T>,
  readUrl?: () => ConfigResult<T> | null,
  options?: AcquireConfigOptions,
): ConfigResult<T> | null {
  const [result, setResult] = useState<ConfigResult<T> | null>(null)
  const readGlobalRef = useRef(readGlobal)
  readGlobalRef.current = readGlobal
  const parseRef = useRef(parse)
  parseRef.current = parse
  const readUrlRef = useRef(readUrl)
  readUrlRef.current = readUrl
  const urlFirst = options?.urlFirst === true
  useEffect(() => {
    let alive = true
    void acquireConfig(
      mode,
      () => readGlobalRef.current(),
      (raw) => parseRef.current(raw),
      () => (readUrlRef.current !== undefined ? readUrlRef.current() : null),
      { urlFirst },
    ).then((r) => {
      if (alive) setResult(r)
    })
    return () => {
      alive = false
    }
  }, [mode, urlFirst])
  return result
}
