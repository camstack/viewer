/** Props of {@link AppFrame}, shared by its native and web implementations. */
export interface AppFrameProps {
  /** The page to load. */
  readonly uri: string
  /** Script run before the page's own (native only; a web iframe cannot be injected into). */
  readonly injectedBefore?: string
  /** Changing it reloads the frame from scratch. */
  readonly reloadKey: number
  readonly testID?: string
  /** The page asked for something a frame cannot do (a download, an upload): the caller says so. */
  readonly onUnhandled?: (what: 'download' | 'external') => void
  /** The page posted a message to the shell (JSON text on a native webview, an object on the web). The caller filters it (`interpretAppMessage`). */
  readonly onAppMessage?: (data: unknown) => void
  /** The page finished loading: the moment to say `hello`. */
  readonly onFrameLoad?: () => void
}

/** What the frame does with a navigation request. */
export type NavigationDecision = 'stay' | 'external' | 'block'

/** The origin (scheme + host + port) of the page a frame loads, or `null` when it does not parse. */
export function frameOriginOf(uri: string): string | null {
  try {
    const origin = new URL(uri).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/**
 * Where a navigation goes. ONLY the frame's own origin stays inside: a hub
 * page must not be able to carry the frame (and the session injected into it)
 * to a foreign page. Another http(s) origin, scheme or port leaves through the
 * system browser; `javascript:`, `data:` and anything else unknown is dropped.
 */
export function navigationDecision(url: string, frameOrigin: string | null): NavigationDecision {
  if (url === 'about:blank') return 'stay'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'block'
  return frameOrigin !== null && parsed.origin === frameOrigin ? 'stay' : 'external'
}

/** Whether the request stays inside the frame. */
export function staysInFrame(url: string, frameOrigin: string | null): boolean {
  return navigationDecision(url, frameOrigin) === 'stay'
}

/**
 * Wrap a before-load script so it runs only on the frame's own origin: a page
 * that somehow ends up elsewhere never sees what the script writes.
 */
export function originGuardedScript(script: string | undefined, frameOrigin: string | null): string | undefined {
  if (script === undefined || frameOrigin === null) return undefined
  return `if (window.location.origin === ${JSON.stringify(frameOrigin)}) { ${script.replace(/\s*true;\s*$/, '')} } true;`
}

/**
 * The script that carries the page's own `postMessage` to the shell on a native
 * webview (`window.parent` is the window itself there): only the bridge envelope
 * is forwarded, and the shell ignores anything that is not an app-to-shell message.
 */
export const BRIDGE_FORWARDER_SCRIPT =
  "window.addEventListener('message', function (e) { var d = e.data; if (d && d.camstack === 'app-bridge' && window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify(d)); } }); true;"

/** The script a native frame runs to hand one shell message to the page. */
export function deliverToPageScript(message: unknown): string {
  return `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(message)} })); true;`
}
