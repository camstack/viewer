/**
 * Sign-in methods → Active sessions (D812): every device signed in to this
 * account — which one, from where, when last used — with "Sign out" for any
 * other, and "Sign out everywhere".
 *
 * Sign out everywhere is `auth.logout({ everywhere: true })`: it ends every
 * session of the account, this app's too, so it signs out here only once the
 * hub has done it. A hub without login sessions answers NOT_FOUND to the list;
 * the section is then not drawn at all.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { LogOut, Monitor, Smartphone } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { useConfirm, useNotice } from '../../../components/ui/confirm.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useServer } from '../../../app/ServerProvider.js'
import { useOwnSessions, useRevokeSession } from '../../../data/use-sign-in-methods.js'
import { describeClient, type LoginSession } from '../../../data/login-sessions.js'

interface ActiveSessionsSectionProps {
  /** Settings → Account folds it under its title; Sign-in methods does not. */
  readonly collapsible?: boolean
}

export function ActiveSessionsSection({ collapsible }: ActiveSessionsSectionProps = {}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const { signOut } = useServer()
  const sessions = useOwnSessions()
  if (sessions.data === null) return null
  const list = sessions.data ?? []

  const handleEverywhere = (): void => {
    void confirm({
      title: t('v2.signIn.sessions.everywhereTitle'),
      message: t('v2.signIn.sessions.everywhereBody'),
      confirmLabel: t('v2.signIn.sessions.everywhere'),
      destructive: true,
    })
      .then((ok) => (ok ? signOut({ everywhere: true }) : null))
      .then((outcome) => {
        if (outcome === 'unsupported') notice({ title: t('v2.signIn.sessions.everywhereUnsupported') })
        if (outcome === 'failed') notice({ title: t('v2.signIn.sessions.everywhereFailed') })
      })
  }

  return (
    <Section
      title={t('v2.signIn.sessions.title')}
      collapsible={collapsible}
      defaultCollapsed={collapsible}
      titleValue={collapsible === true && list.length > 0 ? String(list.length) : undefined}
    >
      {sessions.isPending ? (
        <Row icon={Monitor} label={t('v2.signIn.loading')} last />
      ) : sessions.isError ? (
        <Row icon={Monitor} label={t('v2.signIn.loadFailed')} last />
      ) : (
        <>
          {list.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
          <Row icon={LogOut} label={t('v2.signIn.sessions.everywhere')} danger onPress={handleEverywhere} last />
        </>
      )}
    </Section>
  )
}

function clientLabel(t: TFunction, client: string | null): string {
  const described = describeClient(client)
  switch (described.kind) {
    case 'app':
      return t('v2.signIn.sessions.app', { os: described.os })
    case 'browser':
      return described.os === null
        ? described.browser
        : t('v2.signIn.sessions.browserOn', { browser: described.browser, os: described.os })
    case 'other':
      return described.label
    case 'unknown':
      return t('v2.signIn.sessions.unknownDevice')
  }
}

function SessionRow({ session }: { readonly session: LoginSession }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const notice = useNotice()
  const locale = useDateLocale()
  const revoke = useRevokeSession()
  const described = describeClient(session.client)
  const Icon = described.kind === 'app' ? Smartphone : Monitor
  const label = clientLabel(t, session.client)
  const detail = [
    session.current ? t('v2.signIn.sessions.thisDevice') : null,
    session.ip,
    t('v2.signIn.sessions.lastActive', { date: new Date(session.lastUsedAt).toLocaleString(locale) }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const handleRevoke = (): void => {
    void confirm({
      title: t('v2.signIn.sessions.revokeTitle', { device: label }),
      message: t('v2.signIn.sessions.revokeBody'),
      confirmLabel: t('v2.signIn.sessions.revoke'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      revoke.mutate(session.id, {
        onError: (err) => notice({ title: t('v2.signIn.sessions.revokeFailed'), message: err.message }),
      })
    })
  }

  return (
    <View
      testID={`session-${session.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      <Icon size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      {/* This app's own session ends with Sign out, not from a list row. */}
      {session.current ? null : (
        <Pressable accessibilityRole="button" hitSlop={8} disabled={revoke.isPending} onPress={handleRevoke}>
          <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '600' }}>{t('v2.signIn.sessions.revoke')}</Text>
        </Pressable>
      )}
    </View>
  )
}
