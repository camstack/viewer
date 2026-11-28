/**
 * AppDrawer — THE drawer: one overlay, the same on a phone and on the web.
 * Left, the app rail (one icon per app the hub offered; a tap switches app). Beside
 * it, top to bottom: the active app's title with the route badge and close, the shared
 * search and the active app's NAV. The footer is the avatar row (who is signed in, the
 * server); it opens the account menu: Account, Switch server, the app's Settings (only
 * when declared), Open at launch and Sign out.
 *
 * Every row comes from the apps the hub listed (`apps.listApps`, `drawer-model`):
 * no app is named here. The Viewer's own tabs stay in its bar or rail, so the
 * hosted app's nav is empty. The avatar at the right of the bar opens the account sheet
 * ("open at launch"); the avatar at the left opens this drawer.
 *
 * Drawn as an absolute overlay over the whole app (not a Modal), so the viewer
 * underneath keeps running.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AppLabel } from '@dominevo/types'

import { useServer } from '../app/ServerProvider.js'
import { Badge } from '../components/ui/Badge.js'
import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSearchRow } from '../components/ui/PickerSheet.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { serverLabelOf } from '../connection/server-name.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { useAppCatalog } from '../data/use-apps.js'
import { useDrawerSearch } from '../data/use-drawer-search.js'
import { useMe } from '../data/use-me.js'
import { hapticTap } from '../lib/haptics.js'
import { ChevronsUpDown, Plug, Video, X } from '../lib/icons.js'
import { settingsNavigation, settingsTab } from '../navigation/nav-items.js'
import { UserAvatar } from '../navigation/UserAvatar.js'
import { useTheme } from '../theme/theme-provider.js'
import { BACKDROP_ALPHA, SPACING, TYPOGRAPHY, withAlpha } from '../theme/tokens.js'
import { navSearchEntries, searchAll, type NavSearchEntry } from './app-search.js'
import { appIconFor } from './app-icons.js'
import { useAppStore } from './app-store.js'
import { bridgeChannel } from './bridge-channel.js'
import { navigateMessage, searchMessage } from './bridge-host.js'
import { buildDrawerModel } from './drawer-model.js'
import { findApp, hostedAppOf } from './app-catalog.js'
import { LaunchPreferenceSheet } from './LaunchPreferenceSheet.js'
import { launchValueLabel } from './launch-choices.js'
import { ACCOUNT_PATH } from '../screens/account/AccountScreen.js'
import { AccountMenuSheet } from './AccountMenuSheet.js'
import { AppRail, APP_RAIL_WIDTH } from './AppRail.js'
import { ServerSwitchSheet } from './ServerSwitchSheet.js'

const PANEL_MAX_WIDTH = 320
const PANEL_FRACTION = 0.85
const SWIPE_CLOSE_PX = 48

export function AppDrawer(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { server, signOut } = useServer()
  const { data: me } = useMe()
  const { catalog } = useAppCatalog()
  const local = isLocalRouteChannel(useRouteChannel())
  const open = useAppStore((s) => s.drawerOpen)
  const launchPreference = useAppStore((s) => s.launchPreference)
  const active = useAppStore((s) => s.active)
  const framePath = useAppStore((s) => s.framePath)
  const searchFocus = useAppStore((s) => s.drawerSearchFocus)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const openApp = useAppStore((s) => s.open)
  const [query, setQuery] = useState('')
  const [switching, setSwitching] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [accountMenu, setAccountMenu] = useState(false)

  const translate = useMemo(() => (label: AppLabel): string => t(label.key, { defaultValue: label.fallback }), [t])
  const model = useMemo(
    () => buildDrawerModel({ catalog, activeAppId: active.appId, translate }),
    [catalog, active.appId, translate],
  )
  const navEntries = useMemo(() => navSearchEntries(catalog, translate), [catalog, translate])
  const data = useDrawerSearch(query, open)
  const results = useMemo(
    () => searchAll({ query, navEntries, devices: data.devices, integrations: data.integrations }),
    [query, navEntries, data.devices, data.integrations],
  )
  const searching = query.trim() !== ''
  const launchValue = launchValueLabel(launchPreference, catalog, translate)

  const hosted = hostedAppOf(catalog)
  const activeInfo = model.activeId === null ? null : findApp(catalog, model.activeId)
  const activeIsEmbedded = activeInfo !== null && hosted?.app.id !== activeInfo.app.id

  // A closed drawer forgets the query.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSwitching(false)
      setLaunching(false)
      setAccountMenu(false)
    }
  }, [open])

  // The shared search reaches an embedded app that takes it, once the typing settles.
  useEffect(() => {
    if (open && activeIsEmbedded && activeInfo.app.takesSharedSearch) bridgeChannel.send(searchMessage(data.settledQuery))
  }, [open, activeIsEmbedded, activeInfo, data.settledQuery])

  if (!open) return null

  const serverName =
    server === null ? '' : server.name !== undefined ? serverLabelOf(server) : server.label !== '' ? server.label : serverDisplayName(server.serverUrl)
  const close = (): void => setDrawerOpen(false)

  const goApp = (id: string): void => {
    hapticTap()
    if (id === model.activeId) {
      close()
      return
    }
    openApp({ appId: hosted?.app.id === id ? null : id })
  }
  const goNav = (path: string): void => {
    hapticTap()
    bridgeChannel.send(navigateMessage(path))
    close()
  }
  const goNavResult = (entry: NavSearchEntry): void => {
    hapticTap()
    if (entry.appId === model.activeId && activeIsEmbedded) goNav(entry.path)
    else openApp({ appId: hosted?.app.id === entry.appId ? null : entry.appId }, entry.path)
  }
  const goSettings = (path: string): void => {
    close()
    if (activeIsEmbedded) {
      bridgeChannel.send(navigateMessage(path))
      return
    }
    const how = settingsNavigation(pathname)
    if (how === 'replace') router.replace(settingsTab.href)
    else if (how === 'dismiss') router.dismissTo(settingsTab.href)
  }
  const goAccount = (): void => {
    hapticTap()
    setAccountMenu(false)
    close()
    // The Account is the shell's own screen: it opens over whatever is framed.
    openApp({ appId: null })
    router.push(ACCOUNT_PATH)
  }
  const goDevice = (id: number): void => {
    hapticTap()
    close()
    // The hosted app is the viewer: a device opens in it, over whatever is framed.
    openApp({ appId: null })
    router.push({ pathname: '/device/[id]', params: { id: String(id) } })
  }

  const panelWidth = Math.min(PANEL_MAX_WIDTH + APP_RAIL_WIDTH, Math.round(width * PANEL_FRACTION))
  const swipeStart = { x: 0 }

  return (
    <View style={styles.root} pointerEvents="box-none" testID="app-drawer">
      <Pressable
        style={[styles.scrim, { backgroundColor: withAlpha(colors.background, BACKDROP_ALPHA) }]}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('v2.apps.closeMenu')}
        testID="app-drawer-scrim"
      />
      <View
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: colors.background,
            borderRightColor: colors.border,
          },
        ]}
        onTouchStart={(e) => {
          swipeStart.x = e.nativeEvent.pageX
        }}
        onTouchEnd={(e) => {
          if (swipeStart.x - e.nativeEvent.pageX > SWIPE_CLOSE_PX) close()
        }}
      >
        <AppRail state={model.railState} apps={model.apps} onPick={goApp} />
        <View style={styles.content}>
          <View style={[styles.top, { paddingTop: insets.top, backgroundColor: colors.backgroundElevated, borderBottomColor: colors.border }]} testID="drawer-section-top">
            <View style={styles.header}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]} testID="drawer-app-title">
                {model.heading ?? t(model.railState === 'pending' ? 'v2.apps.loading' : model.railState === 'unknown' ? 'v2.apps.unavailable' : 'v2.apps.apps')}
              </Text>
              <Badge size="sm" tone={local ? 'success' : 'warning'} label={t(local ? 'v2.apps.routeLocal' : 'v2.apps.routeRemote')} />
              <View style={styles.spacer} />
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.apps.closeMenu')}>
                <X size={18} color={colors.foregroundMuted} />
              </Pressable>
            </View>
            <PickerSearchRow testID="drawer-search" search={{ value: query, onChange: setQuery, placeholder: t('v2.apps.searchPlaceholder'), autoFocus: searchFocus }} />
          </View>

          <ScrollView
            style={{ backgroundColor: colors.background }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            testID="drawer-section-nav"
          >
            {searching ? (
              <SearchResults
                results={results}
                pending={data.pending}
                failed={data.failed}
                onNav={goNavResult}
                onDevice={goDevice}
                onIntegration={setQuery}
              />
            ) : (
              <>
                {model.nav.map((section) => (
                  <View key={section.id}>
                    {section.label !== null ? (
                      <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{section.label}</Text>
                    ) : null}
                    {section.items.map((item) => (
                      <MenuRow
                        key={item.id}
                        testID={`drawer-nav-${item.id}`}
                        icon={appIconFor(item.icon)}
                        label={item.label}
                        selected={framePath === item.path}
                        onPress={() => goNav(item.path)}
                      />
                    ))}
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom, backgroundColor: colors.surface, borderTopColor: colors.border }]} testID="drawer-section-footer">
            <Pressable
              style={styles.account}
              testID="drawer-user-block"
              onPress={() => {
                hapticTap()
                setAccountMenu(true)
              }}
              accessibilityRole="button"
              accessibilityLabel={t('v2.apps.account')}
            >
              <View style={styles.account} testID="drawer-account">
                <UserAvatar name={me?.username ?? null} />
                <View style={styles.headerText}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1} testID="drawer-account-name">
                    {me == null
                      ? t('v2.settings.accountUnknown')
                      : `${me.username} · ${me.isAdmin ? t('v2.settings.roleAdmin') : t('v2.settings.roleViewer')}`}
                  </Text>
                  {serverName !== '' ? (
                    <Text style={[styles.sub, { color: colors.foregroundMuted }]} numberOfLines={1} testID="drawer-account-server">
                      {serverName}
                    </Text>
                  ) : null}
                </View>
                <ChevronsUpDown size={16} color={colors.foregroundSubtle} />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
      {switching ? <ServerSwitchSheet onClose={() => setSwitching(false)} /> : null}
      {accountMenu ? (
        <AccountMenuSheet
          settings={model.settings}
          launchValue={launchValue ?? t('v2.apps.launchLast')}
          onAccount={goAccount}
          onSwitchServer={() => {
            setAccountMenu(false)
            setSwitching(true)
          }}
          onSettings={(path) => {
            setAccountMenu(false)
            goSettings(path)
          }}
          onLaunch={() => {
            setAccountMenu(false)
            setLaunching(true)
          }}
          onSignOut={() => {
            setAccountMenu(false)
            close()
            void signOut()
          }}
          onClose={() => setAccountMenu(false)}
        />
      ) : null}
      {launching ? <LaunchPreferenceSheet onClose={() => setLaunching(false)} /> : null}
    </View>
  )
}

interface SearchResultsProps {
  readonly results: ReturnType<typeof searchAll>
  readonly pending: boolean
  readonly failed: boolean
  readonly onNav: (entry: NavSearchEntry) => void
  readonly onDevice: (id: number) => void
  readonly onIntegration: (label: string) => void
}

function SearchResults({ results, pending, failed, onNav, onDevice, onIntegration }: SearchResultsProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View testID="drawer-search-results">
      {results.nav.length > 0 ? <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.apps.searchPages')}</Text> : null}
      {results.nav.map((entry) => (
        <MenuRow
          key={`${entry.appId}:${entry.itemId}`}
          testID={`drawer-result-${entry.appId}-${entry.itemId}`}
          icon={appIconFor(entry.icon)}
          label={`${entry.label} · ${entry.appLabel}`}
          onPress={() => onNav(entry)}
        />
      ))}
      {results.devices.length > 0 ? <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.apps.searchDevices')}</Text> : null}
      {results.devices.map((device) => (
        <MenuRow key={`d${device.id}`} testID={`drawer-result-device-${device.id}`} icon={Video} label={device.name} onPress={() => onDevice(device.id)} />
      ))}
      {results.integrations.length > 0 ? (
        <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.apps.searchIntegrations')}</Text>
      ) : null}
      {results.integrations.map((integration) => (
        <MenuRow
          key={`i${integration.id}`}
          testID={`drawer-result-integration-${integration.id}`}
          icon={Plug}
          label={integration.label}
          onPress={() => onIntegration(integration.label)}
          trailing={<Text style={[styles.value, { color: colors.foregroundMuted }]}>{integration.count}</Text>}
        />
      ))}
      {results.empty ? (
        <Text style={[styles.note, { color: colors.foregroundMuted }]}>
          {failed ? t('v2.apps.searchFailed') : pending ? t('v2.apps.searching') : t('v2.apps.searchNothing')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, flexDirection: 'row', zIndex: 50 },
  scrim: { ...StyleSheet.absoluteFill },
  panel: { height: '100%', flexDirection: 'row', borderRightWidth: StyleSheet.hairlineWidth },
  content: { flex: 1 },
  title: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold, flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  top: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1, gap: 2 },
  spacer: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12 },
  body: { paddingVertical: SPACING.sm },
  section: { fontSize: 11, fontWeight: '600', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  note: { fontSize: 13, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  value: { fontSize: 13 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: SPACING.sm },
  account: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
})
