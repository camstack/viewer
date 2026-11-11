/**
 * DeviceCardEmbed (native) — the hub's device card (`/embed/device/<id>`) in a
 * WebView that fills the space it is given. See `device-embed-url.ts` for the
 * auth path; the web build has its own `<iframe>` twin (`.web.tsx`).
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
import React, { useCallback, useState } from 'react'
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

export interface DeviceCardEmbedProps {
  readonly deviceId: number
  /** Bottom safe-area padding the card keeps clear of (home indicator). */
  readonly bottomInset: number
}

interface NavigationLike {
  readonly url: string
}

type CardState = 'loading' | 'ready' | 'failed'

export function DeviceCardEmbed({ deviceId, bottomInset }: DeviceCardEmbedProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors, mode } = useTheme()
  const { token } = useServer()
  const serverUrl = useLiveHubUrl()
  const [state, setState] = useState<CardState>('loading')
  const [nonce, setNonce] = useState(0)

  const uri =
    serverUrl === null
      ? null
      : buildDeviceEmbedUrl({ serverUrl, deviceId, theme: mode, lang: deviceEmbedLang(i18n.language) })

  const onNavigation = useCallback((nav: NavigationLike) => {
    if (!isDeviceEmbedPath(nav.url)) setState('failed')
  }, [])

  const allowLoad = useCallback(
    (nav: NavigationLike): boolean => serverUrl !== null && isSameHubOrigin(nav.url, serverUrl),
    [serverUrl],
  )

  if (uri === null || state === 'failed') {
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
                onPress: () => {
                  setState('loading')
                  setNonce((n) => n + 1)
                },
                testID: 'device-card-retry',
              }
        }
        testID="device-card-error"
      />
    )
  }

  return (
    <View style={[styles.fill, { paddingBottom: bottomInset, backgroundColor: colors.background }]}>
      <WebView
        // A new document per token: the page reads its session once, at boot,
        // and the viewer renews its token in place (about hourly).
        key={`${String(nonce)}:${token ?? ''}:${uri}`}
        testID="device-card-webview"
        source={{ uri }}
        injectedJavaScriptBeforeContentLoaded={buildSessionSeedScript(token)}
        onShouldStartLoadWithRequest={allowLoad}
        onNavigationStateChange={onNavigation}
        onLoadEnd={() => setState((s) => (s === 'loading' ? 'ready' : s))}
        onError={() => setState('failed')}
        onHttpError={() => setState('failed')}
        style={[styles.fill, { backgroundColor: colors.background }]}
        originWhitelist={['http://*', 'https://*']}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
      {state === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none" testID="device-card-loading">
          <ActivityIndicator color={colors.foregroundMuted} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
})
