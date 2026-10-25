/**
 * The two halves of the native WebView the host actually uses, kept OUT of the
 * stub: the `onMessage` channel the page reports through, and the
 * `injectJavaScript` channel the host commands through.
 *
 * Without them a mount test can only assert that a WebView is on screen. The
 * questions worth asking about an embed host are the other two: "did the page's
 * report reach it" and "did it push a command instead of reloading the
 * document" — and both are invisible in rendered output.
 *
 * Same split as `app-state-control.ts`: plain typed module here (a spec may
 * import it), adapter in `native-stubs/react-native-webview.tsx`.
 */

export type WebViewMessageHandler = (event: { nativeEvent: { data: string } }) => void

const handlers = new Set<WebViewMessageHandler>()
let injected: string[] = []

/** Wired by the stub for as long as a WebView is mounted; returns the remover. */
export function registerTestWebView(handler: WebViewMessageHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** Called by the stub's imperative handle, once per `injectJavaScript`. */
export function recordInjectedScript(script: string): void {
  injected.push(script)
}

/** Every `injectJavaScript` payload since the last reset, in order. */
export function injectedWebViewScripts(): readonly string[] {
  return injected
}

let booted: string[] = []

/**
 * The BOOT config a host injected before the document loaded
 * (`injectedJavaScriptBeforeContentLoaded`), newest last.
 *
 * Separate from the command scripts because it is a different channel with a
 * different failure mode: a command that never arrives leaves the page on its
 * last known value, whereas a field missing from the boot config means the page
 * never had it at all — which is how a wall would silently keep speaking
 * English, or keep the wrong cameras. Nothing could observe it until this
 * existed.
 */
export function bootedWebViewConfigs(): readonly string[] {
  return booted
}

/** Called by the stub on every (re)load, with the host's boot payload. */
export function recordBootConfig(script: string): void {
  booted = [...booted, script]
}

/**
 * Deliver a page→host message the way `RCTWebView` does — JSON on
 * `event.nativeEvent.data`. Wrap the call in `act()`.
 */
export function emitWebViewMessage(payload: unknown): void {
  const data = JSON.stringify(payload)
  for (const handler of [...handlers]) handler({ nativeEvent: { data } })
}

export function resetWebViewStub(): void {
  booted = []
  injected = []
}
