/**
 * A just-minted token's secret, shown ONCE: the hub never lists it again, so
 * this is the only moment it can be copied.
 */
import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { copyText } from '../../lib/copy-text.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { Button } from '../ui/Button.js'

export function TokenReveal({ token }: { readonly token: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [copied, setCopied] = useState(false)
  return (
    <View style={{ gap: SPACING.sm }} testID="token-reveal">
      <PanelText>{t('v2.tokens.shownOnce')}</PanelText>
      <Text
        selectable
        testID="token-secret"
        style={{
          color: colors.foreground,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          padding: SPACING.md,
          fontSize: 12,
          fontFamily: 'monospace',
        }}
      >
        {token}
      </Text>
      <Button
        label={copied ? t('v2.tokens.copied') : t('v2.tokens.copy')}
        kind="secondary"
        onPress={() => {
          void copyText(token).then((ok) => setCopied(ok))
        }}
        testID="token-copy"
      />
    </View>
  )
}
