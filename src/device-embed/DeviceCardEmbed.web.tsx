/**
 * DeviceCardEmbed (web) — the hub's device card (`/embed/device/<id>`) in an
 * `<iframe>` that fills the space it is given. The native twin is
 * `DeviceCardEmbed.tsx`; the auth path is in `device-embed-url.ts`.
 *
 * The hub refuses to be framed by another origin (`frame-ancestors 'self'`),
 * so the card is framed only when this web build is served BY the hub (its
 * `/viewer/` mount). Anywhere else the card opens on the hub in a new tab.
 *
 * Framed on the hub's origin, the page shares this origin's localStorage with
 * the admin UI. A session the admin already keeps there is left alone — it is
 * this browser's own sign-in and owns its refresh; only when there is none is
 * the viewer's access token seeded, without a refresh token. The viewer's
 * sign-out removes what it seeded (`seeded-session.ts`).
 */
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useServer } from '../app/ServerProvider.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { SlidersHorizontal } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { buildDeviceEmbedUrl, deviceEmbedLang, isDeviceEmbedPath } from './device-embed-url.js'
import type { DeviceCardEmbedProps } from './DeviceCardEmbed.js'
import { browserStorage, seedSessionIfAbsent } from './seeded-session.js'

/** How often the framed path is checked for a navigation off the card. */
const LEFT_CARD_POLL_MS = 1000

function pageOrigin(): string | null {
  return typeof window !== 'undefined' ? window.location.origin : null
}

/** Seed the admin session on this origin when it holds none. */
function seedSession(token: string | null): void {
  const storage = browserStorage()
  if (storage === null) return
  try {
    seedSessionIfAbsent(storage, token)
  } catch {
    // Storage blocked: the card shows its own sign-in failure below.
  }
}

/** The path the framed document is on, or null when it cannot be read. */
function framedPath(frame: HTMLIFrameElement): string | null {
  try {
    return frame.contentWindow?.location.href ?? null
  } catch {
    return null
  }
}

export function DeviceCardEmbed({ deviceId }: DeviceCardEmbedProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors, mode } = useTheme()
  const { token } = useServer()
  const serverUrl = useLiveHubUrl()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  // The admin's sign-in guard leaves the card with a client-side navigation
  // (`/login`), which fires no load event: look at the framed path while the
  // card is up, and show a failure rather than a login form in the viewer.
  useEffect(() => {
    if (!loaded || failed) return
    const timer = setInterval(() => {
      const href = frameRef.current === null ? null : framedPath(frameRef.current)
      if (href !== null && !isDeviceEmbedPath(href)) setFailed(true)
    }, LEFT_CARD_POLL_MS)
    return () => clearInterval(timer)
  }, [loaded, failed])

  if (serverUrl === null) {
    return <EmptyState icon={SlidersHorizontal} tone="danger" title={t('v2.deviceDetail.unavailable')} testID="device-card-error" />
  }
  const src = buildDeviceEmbedUrl({ serverUrl, deviceId, theme: mode, lang: deviceEmbedLang(i18n.language) })
  const sameOrigin = pageOrigin() === new URL(serverUrl).origin

  if (!sameOrigin) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title={t('v2.deviceDetail.openOnHub')}
        action={{
          label: t('v2.deviceDetail.openOnHubAction'),
          onPress: () => {
            window.open(src, '_blank', 'noopener')
          },
          testID: 'device-card-open-hub',
        }}
        testID="device-card-elsewhere"
      />
    )
  }
  if (failed) {
    return <EmptyState icon={SlidersHorizontal} tone="danger" title={t('v2.deviceDetail.unavailable')} testID="device-card-error" />
  }

  seedSession(token)
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <iframe
        key={src}
        ref={frameRef}
        src={src}
        title="device-card"
        data-testid="device-card-iframe"
        onLoad={(e) => {
          const href = framedPath(e.currentTarget)
          if (href !== null && !isDeviceEmbedPath(href)) setFailed(true)
          else setLoaded(true)
        }}
        style={{ width: '100%', height: '100%', border: 'none', background: colors.background }}
      />
      {!loaded ? (
        <View style={styles.overlay} pointerEvents="none">
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
