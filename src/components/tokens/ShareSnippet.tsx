/**
 * The snippet a share dialog hands out — a link or a Home Assistant card —
 * shown as it will be copied, with Copy and Share. A snippet still holding
 * the `{TOKEN}` placeholder copies as it is: the reader pastes their token
 * in its place.
 */
import React, { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { copyText } from '../../lib/copy-text.js'
import { shareOrCopy } from '../../data/grid-export.js'
import { Button } from '../ui/Button.js'


interface ShareSnippetProps {
  readonly snippet: string
  /** The share sheet's title. */
  readonly title: string
  /** Share is offered only where an OS share sheet exists to hand it to. */
  readonly canShare: boolean
}

export function ShareSnippet({ snippet, title, canShare }: ShareSnippetProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <View style={{ gap: SPACING.sm }}>
      {/* A link is one unbreakable word: it scrolls sideways inside its box
          instead of pushing the dialog wider than the screen. */}
      <ScrollView
        horizontal
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
        }}
        contentContainerStyle={{ padding: SPACING.md }}
      >
        <Text
          selectable
          testID="share-snippet"
          style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: 'monospace' }}
        >
          {snippet}
        </Text>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={copied === snippet ? t('v2.tokens.copied') : t('v2.tokens.copy')}
            kind="secondary"
            onPress={() => {
              void copyText(snippet).then((ok) => setCopied(ok ? snippet : null))
            }}
            testID="share-snippet-copy"
          />
        </View>
        {canShare ? (
          <View style={{ flex: 1 }}>
            <Button
              label={t('v2.shareToken.share')}
              kind="secondary"
              onPress={() => void shareOrCopy(snippet, { title })}
              testID="share-snippet-share"
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}
