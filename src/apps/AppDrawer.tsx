/**
 * AppDrawer — the pull-out drawer that replaces the account popover: who is
 * signed in and on which server (with where the route runs), the apps, the
 * nodes, the saved servers, Settings and sign-out.
 *
 * Drawn as an absolute overlay over the whole app (not a Modal), so the viewer
 * underneath keeps running. Admin and Nodes are offered only once `auth.me`
 * ANSWERED that the session is an admin (`drawerBlocks`).
 */
import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useServer } from '../app/ServerProvider.js'
import { Badge } from '../components/ui/Badge.js'
import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { serverLabelOf } from '../connection/server-name.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { useNodeDirectory } from '../data/use-node-directory.js'
import { useAdminVerdict, useMe } from '../data/use-me.js'
import { hapticTap } from '../lib/haptics.js'
import { Check, ChevronRight, Cpu, LogOut, Monitor, Server, Settings, Video, X } from '../lib/icons.js'
import { orderServers } from '../navigation/user-menu.js'
import { useTheme } from '../theme/theme-provider.js'
import { BACKDROP_ALPHA, SPACING, withAlpha } from '../theme/tokens.js'
import { offeredLaunchPreferences } from './app-launch.js'
import { useAppStore } from './app-store.js'
import { drawerBlocks, isAppSelected, launchLabelKey } from './drawer-model.js'
import { nodeHasOwnUi, nodeListState } from './node-agent.js'

const PANEL_MAX_WIDTH = 320
const PANEL_FRACTION = 0.85
const SWIPE_CLOSE_PX = 48

export function AppDrawer(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { servers, server, signOut, switchServer } = useServer()
  const { data: me } = useMe()
  const verdict = useAdminVerdict()
  const local = isLocalRouteChannel(useRouteChannel())
  const open = useAppStore((s) => s.drawerOpen)
  const active = useAppStore((s) => s.active)
  const preference = useAppStore((s) => s.launchPreference)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const openApp = useAppStore((s) => s.open)
  const setPreference = useAppStore((s) => s.setLaunchPreference)
  const [picking, setPicking] = useState(false)

  const blocks = drawerBlocks(verdict, servers.length)
  const directory = useNodeDirectory(open && blocks.nodes)
  const nodes = nodeListState({ isPending: directory.isPending, isError: directory.isError, data: directory.data })

  if (!open) return null

  const labelOfServer = (saved: (typeof servers)[number]): string =>
    saved.name !== undefined ? serverLabelOf(saved) : saved.label !== '' ? saved.label : serverDisplayName(saved.serverUrl)
  const serverName =
    server === null ? '' : server.name !== undefined ? serverLabelOf(server) : server.label !== '' ? server.label : serverDisplayName(server.serverUrl)
  const close = (): void => setDrawerOpen(false)
  const goViewer = (): void => {
    openApp({ kind: 'viewer' })
  }

  const switchTo = (id: string, serverUrl: string): void => {
    close()
    if (id === server?.id) return
    void switchServer(id).then((outcome) => {
      if (outcome.status === 'needs-login') router.push({ pathname: '/add-server', params: { url: serverUrl } })
      else if (outcome.status === 'switched') router.replace('/cameras')
    })
  }

  const panelWidth = Math.min(PANEL_MAX_WIDTH, Math.round(width * PANEL_FRACTION))
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
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            backgroundColor: colors.backgroundElevated,
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
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {me?.username ?? t('v2.settings.accountUnknown')}
            </Text>
            {serverName !== '' ? (
              <Text style={[styles.sub, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {serverName}
              </Text>
            ) : null}
          </View>
          <Badge size="sm" tone={local ? 'success' : 'warning'} label={t(local ? 'v2.apps.routeLocal' : 'v2.apps.routeRemote')} />
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.apps.closeMenu')}>
            <X size={18} color={colors.foregroundMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.apps.apps')}</Text>
          <MenuRow
            testID="drawer-app-viewer"
            icon={Video}
            label={t('v2.apps.viewer')}
            selected={isAppSelected(active, 'viewer')}
            onPress={goViewer}
            trailing={isAppSelected(active, 'viewer') ? <Check size={16} color={colors.primary} /> : null}
          />
          {blocks.adminApp ? (
            <MenuRow
              testID="drawer-app-admin"
              icon={Monitor}
              label={t('v2.apps.admin')}
              selected={isAppSelected(active, 'admin')}
              onPress={() => openApp({ kind: 'admin' })}
              trailing={isAppSelected(active, 'admin') ? <Check size={16} color={colors.primary} /> : null}
            />
          ) : null}
          <MenuRow
            testID="drawer-open-at-launch"
            icon={Settings}
            label={t('v2.apps.openAtLaunch')}
            onPress={() => setPicking(true)}
            trailing={
              <View style={styles.valueRow}>
                <Text style={[styles.value, { color: colors.foregroundMuted }]}>{t(launchLabelKey(preference))}</Text>
                <ChevronRight size={16} color={colors.foregroundMuted} />
              </View>
            }
          />

          {blocks.nodes ? (
            <View testID="drawer-nodes">
              <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.apps.nodes')}</Text>
              {nodes.kind === 'loading' ? (
                <Text style={[styles.note, { color: colors.foregroundMuted }]}>{t('v2.apps.nodesLoading')}</Text>
              ) : nodes.kind === 'could-not-read' ? (
                <Text style={[styles.note, { color: colors.danger }]}>{t('v2.apps.nodesCouldNotRead')}</Text>
              ) : (
                <>
                  {nodes.nodes.map((node) => {
                    const own = nodeHasOwnUi(node)
                    const selected = active.kind === 'node' && active.nodeId === node.id
                    return (
                      <MenuRow
                        key={node.id}
                        testID={`drawer-node-${node.id}`}
                        icon={Cpu}
                        label={node.name}
                        selected={selected}
                        disabled={!own}
                        onPress={() => openApp({ kind: 'node', nodeId: node.id, nodeName: node.name })}
                        trailing={
                          <Badge
                            size="sm"
                            tone={node.isOnline ? 'success' : 'neutral'}
                            label={t(node.isOnline ? 'v2.apps.nodeOnline' : 'v2.apps.nodeOffline')}
                          />
                        }
                      />
                    )
                  })}
                  {nodes.complete ? null : (
                    <Text style={[styles.note, { color: colors.foregroundMuted }]}>{t('v2.apps.nodesIncomplete')}</Text>
                  )}
                </>
              )}
            </View>
          ) : null}

          {blocks.servers ? (
            <View>
              <Text style={[styles.section, { color: colors.foregroundSubtle }]}>{t('v2.userMenu.servers')}</Text>
              {orderServers(servers, server?.id ?? null).map((saved) => {
                const current = saved.id === server?.id
                return (
                  <MenuRow
                    key={saved.id}
                    icon={Server}
                    label={labelOfServer(saved)}
                    selected={current}
                    onPress={() => switchTo(saved.id, saved.serverUrl)}
                    trailing={current ? <Check size={16} color={colors.primary} /> : null}
                  />
                )
              })}
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.borderSubtle }]}>
          <MenuRow
            testID="drawer-settings"
            icon={Settings}
            label={t('v2.userMenu.settings')}
            onPress={() => {
              openApp({ kind: 'viewer' })
              router.dismissTo('/settings')
            }}
          />
          <MenuRow
            testID="drawer-sign-out"
            icon={LogOut}
            label={t('v2.userMenu.signOut')}
            destructive
            onPress={() => {
              close()
              void signOut()
            }}
          />
        </View>
      </View>

      {picking ? (
        <PickerSheet
          title={t('v2.apps.openAtLaunch')}
          onClose={() => setPicking(false)}
          headerRight={
            <PickerSheetButton label={t('v2.common.close')} onPress={() => setPicking(false)}>
              <X size={18} color={colors.foreground} />
            </PickerSheetButton>
          }
        >
          {offeredLaunchPreferences(verdict).map((option) => (
            <MenuRow
              key={option}
              testID={`launch-option-${option}`}
              icon={option === 'admin' ? Monitor : Video}
              label={t(launchLabelKey(option))}
              selected={option === preference}
              onPress={() => {
                hapticTap()
                setPreference(option)
                setPicking(false)
              }}
              trailing={option === preference ? <Check size={16} color={colors.primary} /> : null}
            />
          ))}
        </PickerSheet>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, flexDirection: 'row', zIndex: 50 },
  scrim: { ...StyleSheet.absoluteFill },
  panel: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12 },
  body: { paddingVertical: SPACING.sm },
  section: { fontSize: 11, fontWeight: '600', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  note: { fontSize: 12, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  value: { fontSize: 13 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: SPACING.sm },
})
