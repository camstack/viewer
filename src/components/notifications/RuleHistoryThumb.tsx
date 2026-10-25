/**
 * RuleHistoryThumb — the picture on one delivery-history row.
 *
 * The URL is MINTED when the row mounts (`resolveArtifactUrl`, admin) and
 * forgotten when it unmounts: the list is virtualised, so only rows on screen
 * ever ask, and a signed link is never kept past the row that shows it.
 *
 * `url: null` has three causes (unknown id, expired artefact, no reachable base
 * URL) and one rendering: "No image right now". So does a failed mint, and so
 * does an image that fails to LOAD — a broken-image glyph is never drawn.
 */
import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useArtifactUrl } from '../../data/use-rule-history.js'

export interface RuleHistoryThumbProps {
  readonly artifactId: string
}

const THUMB_W = 96
const THUMB_H = 54

export function RuleHistoryThumb({ artifactId }: RuleHistoryThumbProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const query = useArtifactUrl(artifactId)
  // Keyed on the URL that failed, so a fresh mint gets its own chance.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const url = query.data?.url ?? null
  const frame = {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceHover,
    overflow: 'hidden' as const,
  }

  if (query.data === undefined && !query.isError) {
    return <View testID={`rule-history-thumb-pending-${artifactId}`} style={frame} />
  }
  if (url === null || url === brokenUrl) {
    return (
      <View style={[frame, styles.center]}>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 10, textAlign: 'center', paddingHorizontal: SPACING.xs }}>
          {t('v2.nc.rules.history.noImage')}
        </Text>
      </View>
    )
  }
  return (
    <View style={frame}>
      <Image
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="none"
        onError={() => setBrokenUrl(url)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})
