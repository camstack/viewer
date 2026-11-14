/**
 * DeviceCardEmbed (web) — the hub's device card (`/embed/device/<id>`) in an
 * `<iframe>` that fills the space it is given. The native twin is
 * `DeviceCardEmbed.tsx`; the auth path is in `device-embed-url.ts`.
 *
 * Same document rule as the native card: a later device or token is a
 * `postMessage`, and the spinner waits for `card-ready`. The retained sheet
 * host keeps this frame mounted across opens; the frame is not keyed on the
 * device URL.
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
import React, { useCallback, useEffect, useRef } from 'react'
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
import { markDeviceEmbed } from './device-embed-timing.js'
import { useDeviceCardDocument, type DeviceCardHostCommand } from './use-device-card-document.js'

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

export function DeviceCardEmbed({ deviceId, active = true }: DeviceCardEmbedProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors, mode } = useTheme()
  const { token } = useServer()
  const serverUrl = useLiveHubUrl()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const uri =
    serverUrl === null
      ? null
      : buildDeviceEmbedUrl({ serverUrl, deviceId, theme: mode, lang: deviceEmbedLang(i18n.language) })
  const deliver = useCallback((command: DeviceCardHostCommand): void => {
    const frame = frameRef.current
    const origin = pageOrigin()
    if (frame?.contentWindow == null || origin === null) return
    frame.contentWindow.postMessage(command, origin)
  }, [])
  const doc = useDeviceCardDocument({
    deviceId,
    uri,
    token,
    theme: mode,
    lang: deviceEmbedLang(i18n.language),
    deliver,
  })

  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    if (serverUrl === null) return
    if (pageOrigin() !== new URL(serverUrl).origin) return
    if (startedFor.current === doc.webViewKey) return
    startedFor.current = doc.webViewKey
    markDeviceEmbed('load-start', deviceId)
  }, [deviceId, doc.webViewKey, serverUrl])

  useEffect(() => {
    if (active && doc.state === 'ready') markDeviceEmbed('visible', deviceId)
  }, [active, deviceId, doc.state])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (frameRef.current?.contentWindow !== event.source) return
      if (typeof event.data !== 'string') return
      doc.onPageMessage(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [doc.onPageMessage])

  useEffect(() => {
    if (doc.state !== 'ready') return
    const timer = setInterval(() => {
      const href = frameRef.current === null ? null : framedPath(frameRef.current)
      if (href !== null && !isDeviceEmbedPath(href)) doc.fail()
    }, LEFT_CARD_POLL_MS)
    return () => clearInterval(timer)
  }, [doc.fail, doc.state])

  if (serverUrl === null || doc.documentUri === null) {
    return (
      <EmptyState icon={SlidersHorizontal} tone="danger" title={t('v2.deviceDetail.unavailable')} testID="device-card-error" />
    )
  }
  const sameOrigin = pageOrigin() === new URL(serverUrl).origin

  if (!sameOrigin) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title={t('v2.deviceDetail.openOnHub')}
        action={{
          label: t('v2.deviceDetail.openOnHubAction'),
          onPress: () => {
            const href = uri ?? doc.documentUri
            if (href === null) return
            window.open(href, '_blank', 'noopener')
          },
          testID: 'device-card-open-hub',
        }}
        testID="device-card-elsewhere"
      />
    )
  }
  if (doc.state === 'failed') {
    return <EmptyState icon={SlidersHorizontal} tone="danger" title={t('v2.deviceDetail.unavailable')} testID="device-card-error" />
  }

  seedSession(token)
  return (
    // Transparent: the page is too (`?host=viewer`), so the dialog is the background.
    <View style={[styles.fill, styles.clear]}>
      <iframe
        key={doc.webViewKey}
        ref={frameRef}
        src={doc.documentUri}
        title="device-card"
        data-testid="device-card-iframe"
        onLoad={(e) => {
          const href = framedPath(e.currentTarget)
          if (href !== null && !isDeviceEmbedPath(href)) doc.fail()
          else doc.onLoadEnd()
        }}
        style={FRAME_STYLE}
      />
      {doc.state === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.foregroundMuted} />
        </View>
      ) : null}
    </View>
  )
}

const FRAME_STYLE: React.CSSProperties = { width: '100%', height: '100%', border: 'none', background: 'transparent' }

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
