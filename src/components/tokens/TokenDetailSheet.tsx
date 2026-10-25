/**
 * One token, opened from Settings → Account → Tokens: what it may do, its
 * dates, and the two things to do with it — Extend (a new lifetime from now,
 * the same secret keeps working) and Revoke (asked first; it stops working at
 * once). The secret itself is never shown again.
 */
import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SheetModal } from '../ui/SheetModal.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { useConfirm, useNotice } from '../ui/confirm.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { useExtendToken, useRevokeToken } from '../../data/use-sign-in-methods.js'
import {
  durationToExpiresIn,
  extendDurationsFor,
  tokenExpiry,
  type AccountToken,
  type TokenDuration,
} from '../../data/account-tokens.js'
import { useTokenText } from './token-text.js'
import { Button } from '../ui/Button.js'

interface TokenDetailSheetProps {
  readonly token: AccountToken | null
  readonly onClose: () => void
}

export function TokenDetailSheet({ token, onClose }: TokenDetailSheetProps) {
  const { colors } = useTheme()
  return (
    <SheetModal
      visible={token !== null}
      onClose={onClose}
      testID="token-detail-sheet"
      sheetStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        padding: SPACING.xl,
        paddingBottom: SPACING['3xl'],
        gap: SPACING.md,
      }}
    >
      {token !== null ? <TokenDetailBody key={token.id} token={token} onClose={onClose} /> : null}
    </SheetModal>
  )
}

function TokenDetailBody({ token, onClose }: { readonly token: AccountToken; readonly onClose: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const notice = useNotice()
  const text = useTokenText()
  const extend = useExtendToken()
  const revoke = useRevokeToken()
  const [now] = useState(Date.now)
  const durations = extendDurationsFor(token)
  const [duration, setDuration] = useState<TokenDuration>(durations.includes('30d') ? '30d' : (durations[0] ?? '30d'))
  const expiry = tokenExpiry(token, now)
  const options: readonly SegmentOption<TokenDuration>[] = durations.map((d) => ({
    value: d,
    label: t(`v2.tokens.duration.${d}`),
  }))

  const handleExtend = (): void => {
    extend.mutate(
      { id: token.id, expiresIn: durationToExpiresIn(duration) },
      {
        onSuccess: onClose,
        onError: (err) => notice({ title: t('v2.tokens.extendFailed'), message: err.message }),
      },
    )
  }
  const handleRevoke = (): void => {
    void confirm({
      title: t('v2.tokens.revokeTitle', { label: token.label }),
      message: t('v2.tokens.revokeBody'),
      confirmLabel: t('v2.tokens.revoke'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      revoke.mutate(token.id, {
        onSuccess: onClose,
        onError: (err) => notice({ title: t('v2.tokens.revokeFailed'), message: err.message }),
      })
    })
  }

  return (
    <>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '600' }} numberOfLines={2}>
        {token.label}
      </Text>
      <PanelText>{text.scopes(token)}</PanelText>
      <Text style={{ color: expiry === 'soon' || expiry === 'expired' ? colors.warning : colors.foregroundSubtle, fontSize: 13 }}>
        {text.dates(token, now)}
      </Text>
      {expiry === 'expired' ? null : (
        <View style={{ gap: SPACING.sm }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: '600' }}>{t('v2.tokens.extendTitle')}</Text>
          <SegmentedControl options={options} value={duration} onChange={setDuration} />
          <Button
            label={extend.isPending ? t('v2.tokens.extending') : t('v2.tokens.extend')}
            kind="secondary"
            onPress={handleExtend}
            disabled={extend.isPending}
            testID="token-extend"
          />
        </View>
      )}
      <Button
        label={revoke.isPending ? t('v2.tokens.revoking') : t('v2.tokens.revoke')}
        kind="danger"
        onPress={handleRevoke}
        disabled={revoke.isPending}
        testID="token-revoke"
      />
    </>
  )
}
