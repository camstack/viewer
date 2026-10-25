/**
 * Sign-in methods → Linked accounts (D782): the external identities that may
 * sign this user in, with Unlink — INCLUDING a link whose provider is gone or
 * switched off, so an identity nobody can see never lingers — and a Link
 * button per linkable provider not yet linked (popup on the web, the system
 * browser with an app return on a phone — `use-link-flow.ts`).
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, Plus } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { useConfirm, useNotice } from '../../../components/ui/confirm.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useServer } from '../../../app/ServerProvider.js'
import { authSelfKey, useLinkedAccounts, useUnlinkAccount } from '../../../data/use-sign-in-methods.js'
import { providersToLink, type LinkedAccount } from '../../../data/sign-in-methods.js'
import type { LinkOutcome } from '../../../auth/web-link-popup.js'
import { useLinkFlow } from './use-link-flow.js'
import { useReauth } from './ReauthSheet.js'
import { EmptyState, ErrorState } from '../../../components/ui/EmptyState.js'

export function LinkedAccountsSection() {
  const { t } = useTranslation()
  const notice = useNotice()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  const accounts = useLinkedAccounts()
  const flow = useLinkFlow()
  const reauth = useReauth()
  const linked = accounts.data?.linked ?? []
  const toLink = accounts.data !== undefined ? providersToLink(accounts.data.linkable, linked) : []

  const report = (outcome: LinkOutcome): void => {
    void queryClient.invalidateQueries({ queryKey: authSelfKey(server?.serverUrl ?? null, sessionToken, 'linked') })
    if (outcome.kind === 'linked') notice({ title: t('v2.signIn.linked.done') })
    if (outcome.kind === 'error') {
      notice({ title: t('v2.signIn.linked.failed'), message: t(`v2.signIn.linked.refused.${outcome.reason}`, { defaultValue: outcome.reason }) })
    }
  }

  const handleLink = (provider: string): void => {
    if (flow === null) return
    reauth(t('v2.signIn.reauth.actionLink'))
      .then((proof) => (proof === null ? null : flow.start(provider, proof.reauthToken)))
      .then(
        (outcome) => {
          if (outcome !== null) report(outcome)
        },
        (err: unknown) => {
          notice({ title: t('v2.signIn.linked.failed'), message: err instanceof Error ? err.message : String(err) })
        },
      )
  }

  const rows: React.ReactNode[] = [
    ...linked.map((account) => <LinkedRow key={`${account.provider}|${account.subject}`} account={account} />),
    ...(flow !== null
      ? toLink.map((p) => (
          <Row
            key={`link:${p.provider}`}
            icon={Plus}
            label={flow.pending === p.provider ? t('v2.signIn.working') : t('v2.signIn.linked.link', { provider: p.label })}
            onPress={() => handleLink(p.provider)}
          />
        ))
      : []),
  ]

  return (
    <Section title={t('v2.signIn.linked.title')}>
      {accounts.isPending ? (
        <Row icon={Link2} label={t('v2.signIn.loading')} last />
      ) : accounts.isError ? (
        <ErrorState fill={false} title={t('v2.signIn.loadFailed')} onRetry={() => { void accounts.refetch() }} />
      ) : (
        <>
          {linked.length === 0 ? <EmptyState fill={false} icon={Link2} title={t('v2.signIn.linked.none')} /> : null}
          {rows}
          {flow === null && toLink.length > 0 ? (
            <Row label={t('v2.signIn.linked.linkElsewhere')} last />
          ) : (
            <Row label={t('v2.signIn.linked.hint')} last />
          )}
        </>
      )}
    </Section>
  )
}

function LinkedRow({ account }: { readonly account: LinkedAccount }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const notice = useNotice()
  const locale = useDateLocale()
  const unlink = useUnlinkAccount()
  const provider = account.providerLabel ?? account.provider
  const detail = [
    account.accountLabel,
    t('v2.signIn.linked.since', { date: new Date(account.linkedAt).toLocaleDateString(locale) }),
    account.available ? null : t('v2.signIn.linked.unavailable'),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const handleUnlink = (): void => {
    void confirm({
      title: t('v2.signIn.linked.unlinkTitle', { provider }),
      message: t('v2.signIn.linked.unlinkBody'),
      confirmLabel: t('v2.signIn.linked.unlink'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      unlink.mutate(
        { provider: account.provider, subject: account.subject },
        { onError: (err) => notice({ title: t('v2.signIn.linked.unlinkFailed'), message: err.message }) },
      )
    })
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
        opacity: account.available ? 1 : 0.6,
      }}
    >
      <Link2 size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
          {provider}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Pressable accessibilityRole="button" hitSlop={8} disabled={unlink.isPending} onPress={handleUnlink}>
        <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '600' }}>{t('v2.signIn.linked.unlink')}</Text>
      </Pressable>
    </View>
  )
}
