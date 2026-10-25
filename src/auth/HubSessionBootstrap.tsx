/**
 * Web boot gate for hub-served deployments (viewer auth forwarding,
 * Phase 1). Rendered by the root auth gate INSTEAD of the login screen
 * when `canReuseHubSession` says the unconfigured viewer is being
 * served by a hub: it exchanges the browser's httpOnly admin session
 * cookie for a bearer via `auth.exchangeSession` and auto-provisions
 * the server entry (serverUrl = the serving origin).
 *
 *   • exchange OK        → save server + token → the gate re-renders
 *                          into the app;
 *   • 401 (not logged in)→ ONE full-page bounce to the admin-ui login
 *                          (`/login?redirect=<this page>`); a session-
 *                          scoped flag prevents a redirect loop if the
 *                          user comes back still unauthenticated —
 *                          never from an INSTALLED web app, whose own
 *                          cookie jar the admin login cannot fill;
 *   • anything else      → fall back to the manual login screen.
 */
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { log } from '../lib/logger.js'
import {
  buildHubLoginUrl,
  exchangeHubSession,
  shouldAttemptHubSessionExchange,
  shouldBounceToHubLogin,
} from './hub-session-exchange.js'

/** Session-scoped "we already bounced to login once" guard. */
const BOUNCE_FLAG_KEY = 'v2.hubLoginBounced'

function hasBounced(): boolean {
  try {
    return window.sessionStorage.getItem(BOUNCE_FLAG_KEY) === '1'
  } catch {
    return true // storage blocked → never auto-redirect
  }
}

function setBounced(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(BOUNCE_FLAG_KEY, '1')
    else window.sessionStorage.removeItem(BOUNCE_FLAG_KEY)
  } catch {
    /* best-effort */
  }
}

/**
 * Whether the page runs as an INSTALLED web app. Both signals, because each
 * alone misses a platform: `display-mode: standalone` is the standard (Android
 * Chrome, iOS 16.4+), `navigator.standalone` is iOS on every version. Never
 * throws — a stubbed `matchMedia` reads as "not standalone".
 */
export function readStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true
    }
  } catch {
    /* a stub matchMedia — fall through to the iOS flag */
  }
  const nav = window.navigator
  return 'standalone' in nav && nav.standalone === true
}

/**
 * Whether the root gate should try the hub session exchange instead of
 * showing the login screen: web platform, no server configured yet, and
 * the page lives under the hub's viewer mount (built base path, or the
 * well-known `/viewer/` prefix).
 */
export function canReuseHubSession(hasServerConfigured: boolean): boolean {
  return shouldAttemptHubSessionExchange({
    platform: Platform.OS,
    pathname:
      typeof window !== 'undefined' && typeof window.location !== 'undefined'
        ? window.location.pathname
        : null,
    webBasePath: process.env.EXPO_PUBLIC_WEB_BASE_PATH ?? null,
    hasServerConfigured,
    standalone: readStandalone(),
  })
}

export interface HubSessionBootstrapProps {
  /** Rendered when the exchange definitively fails (manual login). */
  readonly fallback: React.ReactElement
}

export function HubSessionBootstrap({ fallback }: HubSessionBootstrapProps) {
  const { save } = useServer()
  const { colors } = useTheme()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const origin = window.location.origin
      const outcome = await exchangeHubSession(origin)
      if (cancelled) return
      if (outcome.status === 'ok') {
        setBounced(false)
        log.info('hub-session', 'Provisioned from hub session', { username: outcome.username })
        await save(
          { id: origin, label: origin, serverUrl: origin },
          { token: outcome.token, refreshToken: outcome.refreshToken },
        )
        return
      }
      const standalone = readStandalone()
      if (
        outcome.status === 'unauthorized' &&
        shouldBounceToHubLogin({ standalone }) &&
        !hasBounced()
      ) {
        // Not logged into the hub — bounce through the admin-ui login,
        // which returns here via its `redirect` param. One attempt per
        // browser session so a still-unauthenticated return doesn't loop.
        // Never from an installed web app: its cookie jar is its own and
        // `/login` is outside the PWA scope — see `shouldBounceToHubLogin`.
        setBounced(true)
        log.info('hub-session', 'No hub session — redirecting to hub login')
        window.location.assign(buildHubLoginUrl(origin, window.location.pathname))
        return
      }
      log.warn('hub-session', 'Hub session exchange failed — manual login', {
        status: outcome.status,
        standalone,
      })
      setFailed(true)
    })()
    return () => {
      cancelled = true
    }
  }, [save])

  if (failed) return fallback

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  )
}
