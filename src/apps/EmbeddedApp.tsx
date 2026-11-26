/**
 * EmbeddedApp — an app the hub offered (`apps.listApps`), framed inside the viewer.
 *
 * Loaded from the base URL the endpoint race already won. On a phone the page is
 * signed in by a one-time browser handoff (`auth.createBrowserHandoff`): the URL
 * carries a code, never a token. On the hub-served web viewer it is a
 * same-origin iframe sharing the browser session. When a faster (local) route
 * appears the user is OFFERED the switch; the page is never reloaded under them.
 *
 * The shell and the page talk over the `app-bridge` envelope (`bridge-host.ts`):
 * the shell says `hello` when the page loads (and again when it says `ready`, so
 * an app that mounted late still hears it), replays the path a search result
 * asked for, and forwards the drawer's navigation. An unknown or malformed
 * message is ignored. The nav the drawer shows is the app's declaration
 * (`apps.listApps`), not something the page sends.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ConnectingIndicator } from '../components/ui/ConnectingIndicator.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { capMutateOrThrow, isCapClient } from '../data/cap-query.js'
import { useAppCatalog } from '../data/use-apps.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import {
  EMBEDDED_BY_VIEWER_SCRIPT,
  HANDOFF_LANDING,
  frameTargetOf,
  handoffUrl,
  parseHandoffPath,
  planAdminFrame,
  shouldOfferLocalSwitch,
} from './admin-frame.js'
import type { AppInfo } from '@camstack/types'

import { AppFrame } from './AppFrame.js'
import { AppTopStrip } from './AppTopStrip.js'
import { BRIDGE_FORWARDER_SCRIPT } from './app-frame-types.js'
import { useAppStore } from './app-store.js'
import { bridgeChannel } from './bridge-channel.js'
import { helloMessage, interpretAppMessage, navigateMessage, themeMessage } from './bridge-host.js'

const FRAME_SCRIPT = `${EMBEDDED_BY_VIEWER_SCRIPT} ${BRIDGE_FORWARDER_SCRIPT}`

export interface EmbeddedAppProps {
  readonly info: AppInfo
  /** The app's name as the viewer's language writes it. */
  readonly title: string
}

type Loaded =
  | { readonly status: 'minting' }
  | { readonly status: 'ready'; readonly uri: string; readonly base: string; readonly local: boolean }
  | { readonly status: 'failed' }

function pageOrigin(): string | null {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null
}

export function EmbeddedApp({ info, title }: EmbeddedAppProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors, mode } = useTheme()
  const { refetch: refetchApps } = useAppCatalog()
  const entry = useMemo(() => frameTargetOf(info.app.entry), [info.app.entry])
  const { controller } = useConnection()
  const liveBase = useLiveHubUrl()
  const channel = useRouteChannel()
  const nowLocal = isLocalRouteChannel(channel)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'minting' })
  const [note, setNote] = useState<string | null>(null)
  const generation = useRef(0)
  const openedPage = useRef(false)

  const frameInput = useCallback(
    (base: string): Parameters<typeof planAdminFrame>[0] => ({
      os: Platform.OS,
      baseUrl: base,
      pageOrigin: pageOrigin(),
      ...(entry !== null ? { path: entry.path, auth: entry.auth } : {}),
    }),
    [entry],
  )
  const plan = liveBase === null || entry === null ? null : planAdminFrame(frameInput(liveBase))

  const load = useCallback(
    async (base: string, local: boolean): Promise<void> => {
      const mine = ++generation.current
      setLoaded({ status: 'minting' })
      const framePlan = planAdminFrame(frameInput(base))
      if (framePlan.kind !== 'webview-handoff') {
        setLoaded({ status: 'ready', uri: framePlan.kind === 'iframe' ? framePlan.src : framePlan.href, base, local })
        return
      }
      try {
        const system = controller.getSystem()
        if (system === null) throw new Error('not connected')
        const client: unknown = system.trpcClient
        if (!isCapClient(client)) throw new Error('not connected')
        const raw = await capMutateOrThrow(client, 'auth', 'createBrowserHandoff', { destination: HANDOFF_LANDING })
        const path = parseHandoffPath(raw)
        if (path === null) throw new Error('no handoff path')
        if (mine === generation.current) setLoaded({ status: 'ready', uri: handoffUrl(base, path), base, local })
      } catch {
        if (mine === generation.current) setLoaded({ status: 'failed' })
      }
    },
    [controller, frameInput],
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

  // The bridge: hello on load and on `ready`, the entry path a search result asked for, the app's nav events.
  const hello = useCallback((): void => {
    bridgeChannel.send(helloMessage())
    bridgeChannel.send(themeMessage(mode))
  }, [mode])
  const onAppMessage = useCallback(
    (data: unknown): void => {
      const event = interpretAppMessage(data)
      if (event === null) return
      const store = useAppStore.getState()
      switch (event.kind) {
        case 'ready': {
          hello()
          // A handoff lands on the admin root: an addon page is reached by navigating once, after the first `ready`.
          const pageToOpen =
            !openedPage.current && plan?.kind === 'webview-handoff' && entry?.openAfterHandoff != null && event.path !== entry.openAfterHandoff
              ? entry.openAfterHandoff
              : null
          openedPage.current = true
          const wanted = store.entryPath ?? pageToOpen
          if (wanted !== null) {
            bridgeChannel.send(navigateMessage(wanted))
            store.clearEntryPath()
          }
          store.setFramePath(event.path)
          break
        }
        case 'path':
          store.setFramePath(event.path)
          break
        case 'invalidate':
          refetchApps()
          break
        case 'open-app':
          store.open({ appId: event.appId }, event.path)
          break
      }
    },
    [hello, refetchApps, plan, entry],
  )

  const offer = loaded.status === 'ready' && liveBase !== null && shouldOfferLocalSwitch(loaded.local, nowLocal, loaded.base, liveBase)

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="embedded-app">
      <AppTopStrip
        title={title}
        local={liveBase === null ? null : loaded.status === 'ready' ? loaded.local : nowLocal}
        onMenu={() => setDrawerOpen(true)}
        onReload={plan?.kind === 'new-tab' ? undefined : reload}
      />
      {offer && liveBase !== null ? (
        <Pressable
          testID="embedded-switch-local"
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
        {entry === null ? (
          <EmptyState title={t('v2.apps.unsupported', { name: title })} body={t('v2.apps.unsupportedBody')} />
        ) : plan === null || loaded.status === 'minting' ? (
          <ConnectingIndicator visible label={t('v2.apps.opening', { name: title })} dotColor={colors.primary} />
        ) : loaded.status === 'failed' ? (
          <EmptyState
            tone="danger"
            title={t('v2.apps.openFailed', { name: title })}
            action={{ label: t('v2.apps.reload'), onPress: reload }}
          />
        ) : plan.kind === 'new-tab' ? (
          <EmptyState
            title={t('v2.apps.newTab', { name: title })}
            body={t('v2.apps.newTabBody')}
            action={{ label: t('v2.apps.openInBrowser'), onPress: () => void Linking.openURL(loaded.uri) }}
          />
        ) : (
          <AppFrame
            uri={loaded.uri}
            reloadKey={reloadKey}
            injectedBefore={FRAME_SCRIPT}
            onAppMessage={onAppMessage}
            onFrameLoad={hello}
            onUnhandled={(what) => setNote(t(what === 'download' ? 'v2.apps.downloadInBrowser' : 'v2.apps.openedInBrowser'))}
            testID="embedded-frame"
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
