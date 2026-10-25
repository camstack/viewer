/**
 * UserMenuButton — the account avatar at the right of the navigation, and the
 * menu it opens: who is signed in, on which server, and the three things you
 * do about it (switch server, Settings, sign out).
 */
import React, { memo, useRef, useState, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { useServer } from '../app/ServerProvider.js'
import { AnchoredMenu } from '../components/ui/AnchoredMenu.js'
import { MenuRow } from '../components/ui/MenuRow.js'
import type { AnchorRect } from '../components/ui/dropdown-placement.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { serverLabelOf } from '../connection/server-name.js'
import { useMe } from '../data/use-me.js'
import { hapticTap } from '../lib/haptics.js'
import { Check, LogOut, Server, Settings, type LucideIcon } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import type { NavItemWrapper } from './BottomNavBar.js'
import { settingsTab } from './nav-items.js'
import { userMenuWidth } from './user-menu-width.js'
import {
  orderServers,
  settingsRoute,
  showServerList,
  userInitial,
  userMenuEntries,
  type UserMenuEntry,
} from './user-menu.js'

export const USER_MENU_TEST_ID = 'user-menu-button'

const AVATAR = 34
const SETTINGS_HREF = '/settings'

export interface UserMenuButtonProps {
  /** Show the name beside the avatar (a roomy bar); icon-only otherwise. */
  readonly showName?: boolean
  /** Where the menu opens relative to the avatar. */
  readonly menuAlign?: 'start' | 'end'
  readonly menuPlacement?: 'above' | 'below'
  /** The block both popovers hang from; the avatar itself when absent. */
  readonly anchorRef?: RefObject<View | null>
  /** Inside `<Tabs>`: the `TabTrigger` wrapper that switches to Settings (see `settingsRoute`). */
  readonly wrapSettings?: NavItemWrapper
}

const ENTRY_ICON: Readonly<Record<UserMenuEntry, LucideIcon>> = {
  settings: Settings,
  signOut: LogOut,
}

/** Rows as drawn (px): header 54, servers block 30 + 38 per server, entries 38 each.
 *  The menu is positioned from this estimate, so it must be the real height or the
 *  menu floats away from the block it opens over. */
export function estimateMenuHeight(entryCount: number, serverCount: number): number {
  return 58 + entryCount * 38 + (serverCount > 0 ? 30 + serverCount * 38 : 0)
}

export const UserMenuButton = memo(function UserMenuButton({
  showName = false,
  menuAlign = 'end',
  menuPlacement = 'above',
  anchorRef: blockRef,
  wrapSettings,
}: UserMenuButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { servers, server, signOut, switchServer } = useServer()
  const { data: me } = useMe()
  const anchorRef = useRef<View>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [open, setOpen] = useState(false)

  const name = me?.username ?? null
  const serverName = server === null ? '' : server.name !== undefined ? serverLabelOf(server) : server.label !== '' ? server.label : serverDisplayName(server.serverUrl)
  const entries = userMenuEntries()
  const listServers = showServerList(servers.length)
  const orderedServers = orderServers(servers, server?.id ?? null)
  const labelOfServer = (saved: (typeof servers)[number]): string =>
    saved.name !== undefined ? serverLabelOf(saved) : saved.label !== '' ? saved.label : serverDisplayName(saved.serverUrl)
  const headerName = name ?? t('v2.settings.accountUnknown')
  const serverLabels = listServers ? orderedServers.map(labelOfServer) : []
  const entryLabels = entries.map((entry) => t(`v2.userMenu.${entry}`))
  // Sized to the widest row, not to the account block it opens from.
  const menuWidth = userMenuWidth({ headerName, headerServer: serverName, entryLabels, serverLabels })

  // The existing switch (`ServerProvider.switchServer`), as Settings does it.
  const switchTo = (id: string, serverUrl: string): void => {
    setOpen(false)
    if (id === server?.id) return
    void switchServer(id).then((outcome) => {
      if (outcome.status === 'needs-login') {
        router.push({ pathname: '/add-server', params: { url: serverUrl } })
      } else if (outcome.status === 'switched') {
        router.replace('/cameras')
      }
    })
  }

  const openMenu = (): void => {
    hapticTap()
    const target = blockRef ?? anchorRef
    target.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setOpen(true)
    })
  }

  const run = (entry: UserMenuEntry): void => {
    setOpen(false)
    if (entry === 'signOut') {
      void signOut()
      return
    }
    // In `<Tabs>` the TabTrigger around the row has already switched tab.
    if (settingsRoute(wrapSettings !== undefined) === 'router') router.dismissTo(SETTINGS_HREF)
  }

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          testID={USER_MENU_TEST_ID}
          onPress={openMenu}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t('v2.userMenu.open', { name: name ?? '' })}
          style={styles.hit}
        >
          <View style={[styles.avatar, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
            <Text style={[styles.initial, { color: colors.foreground }]}>{userInitial(name)}</Text>
          </View>
          {showName && name !== null ? (
            <Text style={[styles.name, { color: colors.foregroundMuted }]} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </Pressable>
      </View>
      <AnchoredMenu
        visible={open}
        onRequestClose={() => setOpen(false)}
        anchor={anchor}
        align={menuAlign}
        width={menuWidth}
        estimatedHeight={estimateMenuHeight(entries.length, listServers ? servers.length : 0)}
        preferredPlacement={menuPlacement}
      >
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <Text style={[styles.headerName, { color: colors.foreground }]} numberOfLines={1}>
            {headerName}
          </Text>
          {serverName !== '' ? (
            <Text style={[styles.headerServer, { color: colors.foregroundMuted }]} numberOfLines={1}>
              {serverName}
            </Text>
          ) : null}
        </View>
        {listServers ? (
          <View style={[styles.servers, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.serversTitle, { color: colors.foregroundSubtle }]}>{t('v2.userMenu.servers')}</Text>
            {orderedServers.map((saved) => {
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
        {entries.map((entry) => {
          const row = (
            <MenuRow
              icon={ENTRY_ICON[entry]}
              label={t(`v2.userMenu.${entry}`)}
              destructive={entry === 'signOut'}
              onPress={() => run(entry)}
            />
          )
          const Wrap = entry === 'settings' ? wrapSettings : undefined
          return Wrap ? (
            <Wrap key={entry} item={settingsTab}>
              {row}
            </Wrap>
          ) : (
            <React.Fragment key={entry}>{row}</React.Fragment>
          )
        })}
      </AnchoredMenu>
    </>
  )
})

const styles = StyleSheet.create({
  hit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 14, fontWeight: '700' },
  name: { fontSize: 13, fontWeight: '500', maxWidth: 110 },
  header: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  headerName: { fontSize: 15, fontWeight: '700' },
  headerServer: { fontSize: 12 },
  servers: { paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  serversTitle: { fontSize: 11, fontWeight: '600', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
})
