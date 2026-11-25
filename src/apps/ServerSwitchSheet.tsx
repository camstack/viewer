/**
 * ServerSwitchSheet — the saved servers, the current one first and ticked; a tap
 * on another switches to it (or sends you to sign in when that server needs it).
 * Opened from the drawer's bottom block, the one place a server is switched; the
 * drawer closes with the tap, whatever the outcome.
 */
import React from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { useServer } from '../app/ServerProvider.js'
import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { serverLabelOf } from '../connection/server-name.js'
import { Check, Server, X } from '../lib/icons.js'
import { orderServers } from '../navigation/user-menu.js'
import { useTheme } from '../theme/theme-provider.js'
import { useAppStore } from './app-store.js'

export interface ServerSwitchSheetProps {
  readonly onClose: () => void
}

export function ServerSwitchSheet({ onClose }: ServerSwitchSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { servers, server, switchServer } = useServer()
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)

  const labelOf = (saved: (typeof servers)[number]): string =>
    saved.name !== undefined ? serverLabelOf(saved) : saved.label !== '' ? saved.label : serverDisplayName(saved.serverUrl)

  const switchTo = (id: string, serverUrl: string): void => {
    onClose()
    setDrawerOpen(false)
    if (id === server?.id) return
    void switchServer(id).then((outcome) => {
      if (outcome.status === 'needs-login') router.push({ pathname: '/add-server', params: { url: serverUrl } })
      else if (outcome.status === 'switched') router.replace('/cameras')
    })
  }

  return (
    <PickerSheet
      title={t('v2.userMenu.servers')}
      onClose={onClose}
      testID="server-switch-sheet"
      headerRight={
        <PickerSheetButton label={t('v2.common.close')} onPress={onClose}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
    >
      {orderServers(servers, server?.id ?? null).map((saved) => {
        const current = saved.id === server?.id
        return (
          <MenuRow
            key={saved.id}
            testID={`server-switch-${saved.id}`}
            icon={Server}
            label={labelOf(saved)}
            selected={current}
            onPress={() => switchTo(saved.id, saved.serverUrl)}
            trailing={current ? <Check size={16} color={colors.primary} /> : null}
          />
        )
      })}
    </PickerSheet>
  )
}
