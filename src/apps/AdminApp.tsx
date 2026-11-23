/**
 * AdminApp — the hub's Admin UI inside the viewer.
 *
 * Loaded from the base URL the endpoint race already won. On a phone the page is
 * signed in by a one-time browser handoff (`auth.createBrowserHandoff`, landing
 * on the Admin): the URL carries a code, never a token. On the hub-served web
 * viewer the Admin is a same-origin iframe sharing the browser session. When a
 * faster (local) route appears the user is OFFERED the switch; the page is never
 * reloaded under them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ConnectingIndicator } from '../components/ui/ConnectingIndicator.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { capMutateOrThrow } from '../data/cap-query.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import {
  EMBEDDED_BY_VIEWER_SCRIPT,
  handoffUrl,
  parseHandoffPath,
  planAdminFrame,
  shouldOfferLocalSwitch,
} from './admin-frame.js'
import { AppFrame } from './AppFrame.js'
import { AppTopStrip } from './AppTopStrip.js'
import { useAppStore } from './app-store.js'

type Loaded =
  | { readonly status: 'minting' }
  | { readonly status: 'ready'; readonly uri: string; readonly base: string; readonly local: boolean }
  | { readonly status: 'failed' }

function pageOrigin(): string | null {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null
}

export function AdminApp(): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { controller } = useConnection()
  const liveBase = useLiveHubUrl()
  const channel = useRouteChannel()
  const nowLocal = isLocalRouteChannel(channel)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'minting' })
  const [note, setNote] = useState<string | null>(null)
  const generation = useRef(0)

  const plan = liveBase === null ? null : planAdminFrame({ os: Platform.OS, baseUrl: liveBase, pageOrigin: pageOrigin() })

  const load = useCallback(
    async (base: string, local: boolean): Promise<void> => {
      const mine = ++generation.current
      setLoaded({ status: 'minting' })
      const framePlan = planAdminFrame({ os: Platform.OS, baseUrl: base, pageOrigin: pageOrigin() })
      if (framePlan.kind !== 'webview-handoff') {
        setLoaded({ status: 'ready', uri: framePlan.kind === 'iframe' ? framePlan.src : framePlan.href, base, local })
        return
      }
      try {
        const system = controller.getSystem()
        if (system === null) throw new Error('not connected')
        const raw = await capMutateOrThrow(system.trpcClient as unknown as Record<string, unknown>, 'auth', 'createBrowserHandoff', {
          destination: 'admin',
        })
        const path = parseHandoffPath(raw)
        if (path === null) throw new Error('no handoff path')
        if (mine === generation.current) setLoaded({ status: 'ready', uri: handoffUrl(base, path), base, local })
      } catch {
        if (mine === generation.current) setLoaded({ status: 'failed' })
      }
    },
    [controller],
  )

  // First load, once the race has named a base. A later route change does NOT reload.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || liveBase === null) return
    started.current = true
    void load(liveBase, nowLocal)
  }, [liveBase, nowLocal, load])

  const reload = (): void => {
    if (liveBase === null) return
    setNote(null)
    setReloadKey((k) => k + 1)
    // A handoff code is single-use: a reload mints a fresh one on the current route.
    void load(liveBase, nowLocal)
  }

  const offer = loaded.status === 'ready' && liveBase !== null && shouldOfferLocalSwitch(loaded.local, nowLocal, loaded.base, liveBase)

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="admin-app">
      <AppTopStrip
        title={t('v2.apps.admin')}
        local={liveBase === null ? null : loaded.status === 'ready' ? loaded.local : nowLocal}
        onMenu={() => setDrawerOpen(true)}
        onReload={plan?.kind === 'new-tab' ? undefined : reload}
      />
      {offer && liveBase !== null ? (
        <Pressable
          testID="admin-switch-local"
          onPress={() => {
            setReloadKey((k) => k + 1)
            void load(liveBase, nowLocal)
          }}
          accessibilityRole="button"
          style={[styles.banner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
        >
          <Text style={[styles.bannerText, { color: colors.foreground }]}>{t('v2.apps.switchLocal')}</Text>
          <Text style={[styles.bannerAction, { color: colors.primary }]}>{t('v2.apps.switchLocalAction')}</Text>
        </Pressable>
      ) : null}
      {note !== null ? (
        <View style={[styles.banner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.bannerText, { color: colors.foregroundMuted }]}>{note}</Text>
        </View>
      ) : null}
      <View style={styles.fill}>
        {plan === null || loaded.status === 'minting' ? (
          <ConnectingIndicator visible label={t('v2.apps.adminOpening')} dotColor={colors.primary} />
        ) : loaded.status === 'failed' ? (
          <EmptyState
            tone="danger"
            title={t('v2.apps.adminFailed')}
            action={{ label: t('v2.apps.reload'), onPress: reload }}
          />
        ) : plan.kind === 'new-tab' ? (
          <EmptyState
            title={t('v2.apps.adminNewTab')}
            body={t('v2.apps.adminNewTabBody')}
            action={{ label: t('v2.apps.openInBrowser'), onPress: () => void Linking.openURL(loaded.uri) }}
          />
        ) : (
          <AppFrame
            uri={loaded.uri}
            reloadKey={reloadKey}
            injectedBefore={EMBEDDED_BY_VIEWER_SCRIPT}
            onUnhandled={(what) => setNote(t(what === 'download' ? 'v2.apps.downloadInBrowser' : 'v2.apps.openedInBrowser'))}
            testID="admin-frame"
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { fontSize: 13, flexShrink: 1 },
  bannerAction: { fontSize: 13, fontWeight: '700' },
})
