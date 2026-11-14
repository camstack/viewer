/**
 * DeviceCardEmbed (native) — the hub's device card (`/embed/device/<id>`) in a
 * WebView that fills the space it is given. See `device-embed-url.ts` for the
 * auth path; the web build has its own `<iframe>` twin (`.web.tsx`).
 *
 * One document. A later device or a renewed access token is a message
 * (`use-device-card-document.ts`), not a new page. The spinner stays until
 * that device's card posts `card-ready`. Leaving the detail screen parks the
 * document in `DeviceCardSheetHost`; this component does not keep it.
 *
 * The WebView takes the remaining height and scrolls inside: the card opens
 * its own dialogs (power confirm, timed run, consumable reset) as fixed
 * overlays centred in the page's viewport, which is only the visible area when
 * the WebView is the visible area.
 *
 * The page renders behind the admin's sign-in guard; a load that lands
 * anywhere but the card (the guard's `/login`, a link off the hub) is shown as
 * the card being unavailable, never followed.
 */
import React, { useCallback, useEffect, useRef } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { useServer } from '../app/ServerProvider.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { SlidersHorizontal } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import {
  buildDeviceEmbedUrl,
  buildSessionSeedScript,
  deviceEmbedLang,
  isDeviceEmbedPath,
  isSameHubOrigin,
} from './device-embed-url.js'
import { markDeviceEmbed } from './device-embed-timing.js'
import {
  deviceCardCommandScript,
  useDeviceCardDocument,
  type DeviceCardHostCommand,
} from './use-device-card-document.js'

export interface DeviceCardEmbedProps {
  readonly deviceId: number
  /** Bottom safe-area padding the card keeps clear of (home indicator). */
  readonly bottomInset: number
  /** False while the sheet is parked. A parked card does not count as shown. */
  readonly active?: boolean
}

interface NavigationLike {
  readonly url: string
}

export function DeviceCardEmbed({
  deviceId,
  bottomInset,
  active = true,
}: DeviceCardEmbedProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors, mode } = useTheme()
  const { token } = useServer()
  const serverUrl = useLiveHubUrl()
  const webRef = useRef<React.ComponentRef<typeof WebView>>(null)
  const uri =
    serverUrl === null
      ? null
      : buildDeviceEmbedUrl({ serverUrl, deviceId, theme: mode, lang: deviceEmbedLang(i18n.language) })
  const deliver = useCallback((command: DeviceCardHostCommand): void => {
    webRef.current?.injectJavaScript(deviceCardCommandScript(command))
  }, [])
  const doc = useDeviceCardDocument({
    deviceId,
    uri,
    token,
    theme: mode,
    lang: deviceEmbedLang(i18n.language),
    deliver,
  })

  const onNavigation = useCallback(
    (nav: NavigationLike) => {
      if (!isDeviceEmbedPath(nav.url)) doc.fail()
    },
    [doc.fail],
  )

  const allowLoad = useCallback(
    (nav: NavigationLike): boolean => serverUrl !== null && isSameHubOrigin(nav.url, serverUrl),
    [serverUrl],
  )

  useEffect(() => {
    if (active && doc.state === 'ready') markDeviceEmbed('visible', deviceId)
  }, [active, deviceId, doc.state])

  if (uri === null || doc.state === 'failed' || doc.documentUri === null) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        tone="danger"
        title={t('v2.deviceDetail.unavailable')}
        action={
          uri === null
            ? undefined
            : {
                label: t('v2.live.retry'),
                onPress: () => doc.retry(),
                testID: 'device-card-retry',
              }
        }
        testID="device-card-error"
      />
    )
  }

  return (
    // Transparent: the page is too (`?host=viewer`), so the sheet is the background.
    <View style={[styles.fill, styles.clear, { paddingBottom: bottomInset }]}>
      <WebView
        key={doc.webViewKey}
        ref={webRef}
        testID="device-card-webview"
        source={{ uri: doc.documentUri }}
        injectedJavaScriptBeforeContentLoaded={buildSessionSeedScript(token)}
        onShouldStartLoadWithRequest={allowLoad}
        onNavigationStateChange={onNavigation}
        onLoadStart={doc.onLoadStart}
        onLoadEnd={doc.onLoadEnd}
        onMessage={(event) => doc.onPageMessage(event.nativeEvent.data)}
        onError={doc.fail}
        onHttpError={doc.fail}
        style={[styles.fill, styles.clear]}
        originWhitelist={['http://*', 'https://*']}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
      {doc.state === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none" testID="device-card-loading">
          <ActivityIndicator color={colors.foregroundMuted} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clear: { backgroundColor: 'transparent' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
