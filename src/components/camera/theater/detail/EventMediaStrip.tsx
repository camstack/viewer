/**
 * EventMediaStrip — horizontal strip of additional media tiles for the active
 * event: crop, face-crop, plate-crop.  The full-frame is already shown by the
 * pager above; this component complements it.
 *
 * Renders nothing when no strip-kind media is available.
 */

import React, { memo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { ImageOff } from '../../../../lib/icons.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { useServer } from '../../../../app/ServerProvider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import type { ColorTokens } from '../../../../theme/tokens.js'
import { useEventMediaStrip, type MediaStripItem } from './use-event-media-strip.js'
import { useTranslation } from 'react-i18next'
import { SectionLabel } from '../../../ui/SectionLabel.js'

const TILE_SIZE = 80

export interface EventMediaStripProps {
  /** The detection/event id whose media we want to show. */
  readonly eventId: string | undefined
  /** Owning device — the authorization subject of the media read. */
  readonly deviceId: number
}

export const EventMediaStrip = memo(function EventMediaStrip({ eventId, deviceId }: EventMediaStripProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { items, loading } = useEventMediaStrip(eventId, deviceId)

  if (!loading && items.length === 0) return null

  return (
    <View style={styles.wrapper}>
      <SectionLabel style={styles.sectionLabel}>{t('v2.tracks.media')}</SectionLabel>
      {loading ? (
        <ActivityIndicator size="small" color={colors.foregroundMuted} style={styles.spinner} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {items.map((item) => (
            <MediaTile key={item.kind} item={item} colors={colors} />
          ))}
        </ScrollView>
      )}
    </View>
  )
})

interface MediaTileProps {
  readonly item: MediaStripItem
  readonly colors: ColorTokens
}

/**
 * A single strip tile. Owns its own `failed` state so the ImageOff fallback is
 * shown ONLY when THIS tile's image errors — a correctly-loaded crop/face tile
 * never gets the error icon painted over it.
 */
function MediaTile({ item, colors }: MediaTileProps) {
  const { token } = useServer()
  const [failed, setFailed] = useState(false)
  const headers: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {failed ? (
        <View style={[styles.tileImage, styles.tileFallback]} pointerEvents="none">
          <ImageOff size={20} color={colors.foregroundSubtle} />
        </View>
      ) : (
        <Image
          source={headers ? { uri: item.uri, headers } : { uri: item.uri }}
          style={styles.tileImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      )}
      <Text style={[styles.tileLabel, { color: colors.foregroundMuted }]}>{item.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: SPACING.sm },
  sectionLabel: { marginBottom: SPACING.xs, marginHorizontal: SPACING.xs },
  spinner: { alignSelf: 'flex-start', marginLeft: SPACING.md },
  row: { gap: SPACING.sm, paddingVertical: SPACING.xs, paddingHorizontal: SPACING.xs },
  tile: { width: TILE_SIZE, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  tileImage: { width: TILE_SIZE, height: TILE_SIZE },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 10, fontWeight: '600', paddingVertical: 3, textAlign: 'center' },
})
