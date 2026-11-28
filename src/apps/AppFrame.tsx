/**
 * AppFrame (native) — one page in a react-native-webview: the Admin UI inside
 * the viewer.
 *
 *  - the Android back button walks the page's own history first, and only then
 *    leaves the frame (the screen's back handling);
 *  - only the frame's own origin loads here; any other http(s) link, and an iOS
 *    file download, are handed to the system (`Linking`), and `javascript:` /
 *    `data:` are dropped; the injected script also checks the origin itself — the page cannot be told to save a file here;
 *  - the page talks to the shell over the `app-bridge` envelope (`bridge-host.ts`); this frame only carries the messages;
 *  - a page-load failure is shown by the caller's reload control, not swallowed.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { log } from '../lib/logger.js'
import { useTheme } from '../theme/theme-provider.js'
import { deliverToPageScript, frameOriginOf, navigationDecision, originGuardedScript, type AppFrameProps } from './app-frame-types.js'
import { bridgeChannel } from './bridge-channel.js'

export function AppFrame({ uri, injectedBefore, reloadKey, testID, onUnhandled, onAppMessage, onFrameLoad }: AppFrameProps): React.JSX.Element {
  const { colors } = useTheme()
  const ref = useRef<React.ComponentRef<typeof WebView>>(null)
  const canGoBack = useRef(false)
  const frameOrigin = useMemo(() => frameOriginOf(uri), [uri])
  const guardedInjection = useMemo(() => originGuardedScript(injectedBefore, frameOrigin), [injectedBefore, frameOrigin])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false
      ref.current?.goBack()
      return true
    })
    return () => sub.remove()
  }, [])

  // The drawer reaches the page through the channel while this frame is mounted.
  useEffect(
    () => bridgeChannel.attach((message) => ref.current?.injectJavaScript(deliverToPageScript(message))),
    [],
  )

  const external = useCallback(
    (url: string, what: 'download' | 'external'): void => {
      onUnhandled?.(what)
      Linking.openURL(url).catch((e: unknown) => {
        log.warn('apps', 'app frame could not hand a link to the system', { error: e instanceof Error ? e.message : String(e) })
      })
    },
    [onUnhandled],
  )

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID={testID}>
      <WebView
        key={reloadKey}
        ref={ref}
        source={{ uri }}
        style={[styles.fill, { backgroundColor: colors.background }]}
        originWhitelist={frameOrigin === null ? [] : [frameOrigin]}
        injectedJavaScriptBeforeContentLoaded={guardedInjection}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
        onNavigationStateChange={(nav: WebViewNavigation) => {
          canGoBack.current = nav.canGoBack
        }}
        onShouldStartLoadWithRequest={(request) => {
          const decision = navigationDecision(request.url, frameOrigin)
          if (decision === 'stay') return true
          if (decision === 'external') external(request.url, 'external')
          return false
        }}
        onMessage={(e) => onAppMessage?.(e.nativeEvent.data)}
        onLoadEnd={() => onFrameLoad?.()}
        onFileDownload={({ nativeEvent }) => external(nativeEvent.downloadUrl, 'download')}
        onError={(e) => log.warn('apps', 'app frame failed to load', { description: e.nativeEvent.description })}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
