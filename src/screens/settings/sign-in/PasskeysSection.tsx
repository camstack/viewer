/**
 * Sign-in methods → Passkeys: the enrolled ones (remove), the second-factor
 * switch, and the way to add one.
 *
 * A passkey is created by the BROWSER's WebAuthn ceremony for the hub's origin
 * (the relying party). The viewer itself never runs it: adding one opens the
 * hub's own account page, signed in — see `use-passkey-enrolment.ts`.
 */
import React from 'react'
import { Text, View, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { KeyRound, Plus, ShieldCheck } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { ToggleRow } from '../../../components/ui/ToggleRow.js'
import { useConfirm, useNotice } from '../../../components/ui/confirm.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import {
  usePasskeySecondFactor,
  usePasskeys,
  useRemovePasskey,
  useSetPasskeySecondFactor,
} from '../../../data/use-sign-in-methods.js'
import type { PasskeyEntry } from '../../../data/sign-in-methods.js'
import { usePasskeyEnrolment } from './use-passkey-enrolment.js'
import { useReauth } from './ReauthSheet.js'
import { EmptyState, ErrorState } from '../../../components/ui/EmptyState.js'

export function PasskeysSection() {
  const { t } = useTranslation()
  const notice = useNotice()
  const passkeys = usePasskeys()
  const secondFactor = usePasskeySecondFactor()
  const setSecondFactor = useSetPasskeySecondFactor()
  const enrol = usePasskeyEnrolment((message) => notice({ title: t('v2.signIn.passkeys.addFailed'), message }))
  const list = passkeys.data ?? []
  const secondFactorOn = secondFactor.data === true

  return (
    <Section title={t('v2.signIn.passkeys.title')}>
      {passkeys.isPending ? (
        <Row icon={KeyRound} label={t('v2.signIn.loading')} />
      ) : list.length === 0 ? (
        <EmptyState fill={false} icon={KeyRound} title={t('v2.signIn.passkeys.none')} />
      ) : (
        list.map((p) => <PasskeyRow key={p.credentialId} passkey={p} />)
      )}
      {/* Off with no passkey would be a switch that demands a key the account
          does not have; ON is still shown so it can be turned off. */}
      {list.length > 0 || secondFactorOn ? (
        <ToggleRow
          icon={ShieldCheck}
          label={t('v2.signIn.passkeys.secondFactor')}
          description={t('v2.signIn.passkeys.secondFactorHint')}
          value={secondFactorOn}
          onValueChange={(enabled) => {
            setSecondFactor.mutate(enabled, {
              onError: (err) => notice({ title: t('v2.signIn.saveFailed'), message: err.message }),
            })
          }}
          last={enrol === null}
        />
      ) : null}
      {enrol !== null ? (
        <Row
          icon={Plus}
          label={enrol.opening ? t('v2.signIn.working') : t('v2.signIn.passkeys.add')}
          onPress={enrol.open}
          last
        />
      ) : (
        <Row label={t('v2.signIn.passkeys.addElsewhere')} last />
      )}
    </Section>
  )
}

function PasskeyRow({ passkey }: { readonly passkey: PasskeyEntry }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const notice = useNotice()
  const locale = useDateLocale()
  const remove = useRemovePasskey()
  const reauth = useReauth()
  const day = (ms: number): string => new Date(ms).toLocaleDateString(locale)
  const label = passkey.label.length > 0 ? passkey.label : t('v2.signIn.passkeys.unnamed')
  const detail = [
    t('v2.signIn.passkeys.added', { date: day(passkey.createdAt) }),
    passkey.lastUsedAt !== null
      ? t('v2.signIn.passkeys.lastUsed', { date: day(passkey.lastUsedAt) })
      : t('v2.signIn.passkeys.neverUsed'),
  ].join(' · ')

  const handleRemove = (): void => {
    void confirm({
      title: t('v2.signIn.passkeys.removeTitle', { label }),
      message: t('v2.signIn.passkeys.removeBody'),
      confirmLabel: t('v2.signIn.remove'),
      destructive: true,
    })
      .then((ok) => (ok ? reauth(t('v2.signIn.reauth.actionRemovePasskey')) : null))
      .then((proof) => {
        if (proof === null) return
        remove.mutate(
          { credentialId: passkey.credentialId, reauthToken: proof.reauthToken },
          { onError: (err) => notice({ title: t('v2.signIn.passkeys.removeFailed'), message: err.message }) },
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
      }}
    >
      <KeyRound size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Pressable accessibilityRole="button" hitSlop={8} disabled={remove.isPending} onPress={handleRemove}>
        <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '600' }}>{t('v2.signIn.remove')}</Text>
      </Pressable>
    </View>
  )
}
