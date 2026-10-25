/**
 * Settings → Servers: every hub this device knows, one tap to switch.
 *
 * A switch is `ServerProvider.switchServer` — the other server's OWN token, no
 * sign-out, no restart (the connected subtree is re-keyed by server id). A
 * saved server with no usable token opens the login for it instead. "Add
 * server" opens the login for a new URL while the current one stays signed in.
 * Removing a server deletes its sign-in from this device only.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { useServer } from '../../app/ServerProvider.js'
import type { SavedServer } from '../../connection/server-switch.js'
import { serverLabelOf } from '../../connection/server-name.js'
import { useConfirm, useNotice } from '../../components/ui/confirm.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { Check, KeyRound, LogOut, Plus, Server, Trash2, User } from '../../lib/icons.js'

export interface ServersSectionProps {
  /** The "Signed in as" value, computed by the caller (it owns `useMe`). */
  readonly accountValue: string
  readonly onSignOut: () => void
  /** Opens Sign-in methods; the row is drawn only when this is set. */
  readonly onOpenSignInMethods?: () => void
}

export function ServersSection({ accountValue, onSignOut, onOpenSignInMethods }: ServersSectionProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const { servers, server: active, token, switchServer, removeServer } = useServer()

  const openLogin = (serverUrl?: string): void => {
    router.push(serverUrl !== undefined ? { pathname: '/add-server', params: { url: serverUrl } } : '/add-server')
  }

  const handleSwitch = (target: SavedServer): void => {
    if (target.id === active?.id && token !== null) return
    void switchServer(target.id)
      .then((outcome) => {
        if (outcome.status === 'needs-login') openLogin(outcome.serverUrl)
        else if (outcome.status === 'switched') router.replace('/cameras')
      })
      .catch((err: unknown) => {
        notice({
          title: t('v2.servers.switchFailed'),
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }

  const handleRemove = (target: SavedServer): void => {
    const isActive = target.id === active?.id
    void confirm({
      title: t('v2.servers.removeConfirmTitle', { name: serverLabelOf(target) }),
      message: isActive ? t('v2.servers.removeActiveConfirmBody') : t('v2.servers.removeConfirmBody'),
      confirmLabel: t('v2.servers.remove_cta'),
      destructive: true,
    }).then((ok) => {
      if (ok) void removeServer(target.id)
    })
  }

  // Most recently used first; the active one on top regardless.
  const ordered = [...servers].sort((a, b) => {
    if (a.id === active?.id) return -1
    if (b.id === active?.id) return 1
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  })

  return (
    <Section title={t('v2.servers.title')}>
      <Row icon={User} label={t('v2.settings.account')} value={accountValue} />
      {onOpenSignInMethods !== undefined ? (
        <Row icon={KeyRound} label={t('v2.signIn.title')} onPress={onOpenSignInMethods} />
      ) : null}
      {ordered.map((saved) => (
        <ServerRow
          key={saved.id}
          server={saved}
          active={saved.id === active?.id}
          onPress={() => handleSwitch(saved)}
          onRemove={() => handleRemove(saved)}
        />
      ))}
      <Row icon={Plus} label={t('v2.servers.add')} onPress={() => openLogin()} />
      <Row icon={LogOut} label={t('v2.settings.signOut')} danger onPress={onSignOut} last />
    </Section>
  )
}

interface ServerRowProps {
  readonly server: SavedServer
  readonly active: boolean
  readonly onPress: () => void
  readonly onRemove: () => void
}

function ServerRow({ server, active, onPress, onRemove }: ServerRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const status = active
    ? t('v2.servers.active')
    : !server.signedIn
      ? t('v2.servers.signedOut')
      : server.lastUsedAt !== undefined
        ? t('v2.servers.lastUsed', {
            date: new Date(server.lastUsedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
          })
        : ''

  return (
    <Row
      icon={active ? Check : Server}
      label={serverLabelOf(server)}
      onPress={onPress}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.lg }}>
          {status.length > 0 && (
            <Text
              style={{ color: active ? colors.primary : colors.foregroundMuted, fontSize: 13 }}
              numberOfLines={1}
            >
              {status}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.servers.remove')}
            hitSlop={8}
            onPress={onRemove}
          >
            <Trash2 size={16} color={colors.foregroundSubtle} />
          </Pressable>
        </View>
      }
    />
  )
}
