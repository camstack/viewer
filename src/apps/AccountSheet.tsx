/**
 * AccountSheet — what the avatar opens: who is signed in and on which server
 * (with where the route runs), the saved servers, "open at launch" and sign-out.
 * The apps, their nav and Settings live in the drawer (`AppDrawer`), not here.
 */
import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { AppLabel } from '@camstack/types'

import { useServer } from '../app/ServerProvider.js'
import { Badge } from '../components/ui/Badge.js'
import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { serverLabelOf } from '../connection/server-name.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { useMe } from '../data/use-me.js'
import { useAppCatalog } from '../data/use-apps.js'
import { hapticTap } from '../lib/haptics.js'
import { Check, ChevronRight, LogOut, Server, Settings, X } from '../lib/icons.js'
import { orderServers, showServerList } from '../navigation/user-menu.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import { useAppStore } from './app-store.js'
import { launchChoices, launchValueLabel } from './launch-choices.js'

export function AccountSheet(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { servers, server, signOut, switchServer } = useServer()
  const { data: me } = useMe()
  const { catalog } = useAppCatalog()
  const local = isLocalRouteChannel(useRouteChannel())
  const open = useAppStore((s) => s.accountOpen)
  const preference = useAppStore((s) => s.launchPreference)
  const setOpen = useAppStore((s) => s.setAccountOpen)
  const setPreference = useAppStore((s) => s.setLaunchPreference)
  const [picking, setPicking] = useState(false)

  if (!open) return null

  const translate = (label: AppLabel): string => t(label.key, { defaultValue: label.fallback })
  const labelOfServer = (saved: (typeof servers)[number]): string =>
    saved.name !== undefined ? serverLabelOf(saved) : saved.label !== '' ? saved.label : serverDisplayName(saved.serverUrl)
  const serverName =
    server === null ? '' : server.name !== undefined ? serverLabelOf(server) : server.label !== '' ? server.label : serverDisplayName(server.serverUrl)
  const close = (): void => setOpen(false)
  const value = launchValueLabel(preference, catalog, translate)

  const switchTo = (id: string, serverUrl: string): void => {
    close()
    if (id === server?.id) return
    void switchServer(id).then((outcome) => {
      if (outcome.status === 'needs-login') router.push({ pathname: '/add-server', params: { url: serverUrl } })
      else if (outcome.status === 'switched') router.replace('/cameras')
    })
  }

  if (picking) {
    return (
      <PickerSheet
        title={t('v2.apps.openAtLaunch')}
        onClose={() => setPicking(false)}
        headerRight={
          <PickerSheetButton label={t('v2.common.close')} onPress={() => setPicking(false)}>
            <X size={18} color={colors.foreground} />
          </PickerSheetButton>
        }
      >
        {launchChoices(catalog, translate).map((choice) => (
          <MenuRow
            key={choice.preference}
            testID={`launch-option-${choice.preference}`}
            icon={Settings}
            label={choice.label ?? t('v2.apps.launchLast')}
            selected={choice.preference === preference}
            onPress={() => {
              hapticTap()
              setPreference(choice.preference)
              setPicking(false)
            }}
            trailing={choice.preference === preference ? <Check size={16} color={colors.primary} /> : null}
          />
        ))}
      </PickerSheet>
    )
  }

  return (
    <PickerSheet
      title={me?.username ?? t('v2.settings.accountUnknown')}
      subtitle={serverName === '' ? undefined : serverName}
      onClose={close}
      headerRight={
        <View style={styles.headerRight}>
          <Badge size="sm" tone={local ? 'success' : 'warning'} label={t(local ? 'v2.apps.routeLocal' : 'v2.apps.routeRemote')} />
          <PickerSheetButton label={t('v2.common.close')} onPress={close}>
            <X size={18} color={colors.foreground} />
          </PickerSheetButton>
        </View>
      }
      testID="account-sheet"
    >
      <MenuRow
        testID="account-open-at-launch"
        icon={Settings}
        label={t('v2.apps.openAtLaunch')}
        onPress={() => setPicking(true)}
        trailing={
          <View style={styles.valueRow}>
            <Text style={[styles.value, { color: colors.foregroundMuted }]}>{value ?? t('v2.apps.launchLast')}</Text>
            <ChevronRight size={16} color={colors.foregroundMuted} />
          </View>
        }
      />
      {showServerList(servers.length) ? (
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
      <MenuRow
        testID="account-sign-out"
        icon={LogOut}
        label={t('v2.userMenu.signOut')}
        destructive
        onPress={() => {
          close()
          void signOut()
        }}
      />
    </PickerSheet>
  )
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  section: { fontSize: 11, fontWeight: '600', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  value: { fontSize: 13 },
})
