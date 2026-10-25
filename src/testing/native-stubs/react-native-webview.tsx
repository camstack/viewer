/**
 * `react-native-webview` under test.
 *
 * Renders as `stub-WebView` like every other native surface, and additionally
 * wires the two channels an embed host is judged on: the page's `onMessage`
 * reports and the host's `injectJavaScript` commands. See
 * `../webview-control.ts` for why those live in their own module.
 */
import React from 'react'
import { View } from 'react-native'
import { recordBootConfig, recordInjectedScript, registerTestWebView } from '../webview-control.js'
import type { StubViewProps } from './passthrough.js'

export interface WebViewMessageEvent {
  readonly nativeEvent: { readonly data: string }
}
export interface WebViewNavigation {
  readonly url: string
}

export interface WebViewHandle {
  injectJavaScript: (script: string) => void
  reload: () => void
  stopLoading: () => void
}

export const WebView = React.forwardRef<WebViewHandle, StubViewProps>((props, ref) => {
  const { children, style, onMessage, injectedJavaScriptBeforeContentLoaded: boot } =
    props as StubViewProps & {
      onMessage?: (event: WebViewMessageEvent) => void
      injectedJavaScriptBeforeContentLoaded?: string
    }

  // The boot config, recorded ONCE PER DOCUMENT. A real WKWebView evaluates
  // `injectedJavaScriptBeforeContentLoaded` when the document loads and never
  // again, and every host in this app re-keys this element when it needs a
  // reload (`GridLiveEmbed`'s `reloadNonce`) — so one mount here is exactly one
  // document there.
  //
  // The dependency was `[boot]` until 2026-09-02, which recorded again whenever
  // the string CHANGED — a prop change on a live page, which a real WKWebView
  // does not see at all. That made the boot channel unusable for the question it
  // exists to answer: a rotation restyles the wall's box and rewrites the config
  // without reloading anything, and the stub reported it as three fresh
  // documents. Latched on the first string rather than on mount, because a host
  // may build its config after a measurement lands and `undefined` is not a
  // document.
  const bootRecorded = React.useRef(false)
  React.useEffect(() => {
    if (bootRecorded.current || typeof boot !== 'string') return
    bootRecorded.current = true
    recordBootConfig(boot)
  }, [boot])

  React.useImperativeHandle(
    ref,
    () => ({
      injectJavaScript: (script: string) => recordInjectedScript(script),
      reload: () => undefined,
      stopLoading: () => undefined,
    }),
    [],
  )

  React.useEffect(() => {
    if (typeof onMessage !== 'function') return
    return registerTestWebView(onMessage)
  }, [onMessage])

  return (
    <View style={style} testID="stub-WebView">
      {children}
    </View>
  )
})
WebView.displayName = 'Stub(WebView)'

export default WebView
