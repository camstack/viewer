/**
 * The confirmation in front of every enrollment: which hub this device is about
 * to be linked to, said before anything is generated or sent.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { EnrollTarget } from '../device-cert/enroll-target.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import type { ColorTokens } from '../theme/tokens.js'

export function ConfirmTarget({
  colors,
  target,
  loading,
  onConfirm,
}: {
  colors: ColorTokens
  target: EnrollTarget
  loading: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  if (target.status === 'unresolved') {
    return (
      <Text style={{ color: colors.danger, fontSize: 13 }}>
        {t(target.reason === 'no-hub' ? 'v2.device.enroll.noHub' : 'v2.device.enroll.invalidHub')}
      </Text>
    )
  }
  return (
    <View style={{ gap: SPACING.lg }}>
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
        {t('v2.device.enroll.confirmTitle', { name: target.name })}
      </Text>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }} selectable>
        {target.origin}
      </Text>
      {target.isNewHub && (
        <View
          style={{
            backgroundColor: colors.danger + '1a',
            borderColor: colors.danger + '40',
            borderWidth: 1,
            borderRadius: RADIUS.md,
            padding: SPACING.lg,
          }}
        >
          <Text style={{ color: colors.danger, fontSize: 13 }}>{t('v2.device.enroll.newHubWarning')}</Text>
        </View>
      )}
      {target.replacesSignInTo !== null && (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>
          {t('v2.device.enroll.replaceBody', { current: target.replacesSignInTo })}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={onConfirm}
        style={{
          backgroundColor: colors.primary,
          opacity: loading ? 0.5 : 1,
          borderRadius: RADIUS.md,
          paddingVertical: SPACING.lg,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>
          {t('v2.device.enroll.replaceConfirm')}
        </Text>
      </Pressable>
    </View>
  )
}
