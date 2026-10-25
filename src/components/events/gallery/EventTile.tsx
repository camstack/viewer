/**
 * EventTile — one track in the native gallery: the shared picture
 * (`TileHero`) plus, opt-in, a details block under it (camera name, zone).
 *
 * Everything the tile needs arrives as props from the gallery, resolved ONCE per
 * list rather than per tile: the image URL and its auth, the theme, the chip
 * options, the labels. The tile itself is a memo over `row` and those stable
 * values, so re-rendering the row or the list with the same props repaints
 * nothing (pinned in `events-gallery-scroll-cost.spec`).
 */
import React, { memo, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import { TileHero, TileLabels } from './TileHero.js'
import { tileAccessibilityLabel, tileChips, tileZone, type TileChipOptions } from './tile-model.js'
import { type TileDetails } from './events-gallery-layout.js'

export interface EventTileProps {
  readonly row: EventsTrackRow
  /** Square edge, in points. */
  readonly edge: number
  readonly imageUri: string | null
  readonly bearer: string | null
  readonly chipOptions: TileChipOptions
  readonly details: TileDetails
  /** The page's "now" — the spoken time names its day relative to it. */
  readonly anchorMs: number
  readonly onPress: (row: EventsTrackRow) => void
  /** The "?" chip: the same open, carrying WHY (assign a face). Absent ⇒ no chip. */
  readonly onAssignFace?: (row: EventsTrackRow) => void
}

export const EventTile = memo(function EventTile({
  row, edge, imageUri, bearer, chipOptions, details, anchorMs, onPress, onAssignFace,
}: EventTileProps) {
  const { colors } = useTheme()
  const zone = details.zone ? tileZone(row) : null
  const chips = useMemo(() => tileChips(row, chipOptions), [row, chipOptions])
  const spoken = useMemo(
    () => tileAccessibilityLabel(row, chipOptions.kindLabels, chips.time),
    [row, chipOptions.kindLabels, chips.time],
  )

  return (
    <View style={{ width: edge }}>
      <Pressable
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={spoken}
      >
        <TileHero row={row} chips={chips} edge={edge} imageUri={imageUri} bearer={bearer} showTime />
        {details.camera || zone !== null ? (
          <View style={styles.details}>
            {details.camera ? (
              <Text numberOfLines={1} style={[styles.detailCamera, { color: colors.foreground }]}>
                {row.cameraName}
              </Text>
            ) : null}
            {zone !== null ? (
              <View style={[styles.zoneChip, { backgroundColor: colors.surface }]}>
                <Text numberOfLines={1} style={[styles.zoneText, { color: colors.foregroundMuted }]}>{zone}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      <TileLabels
        row={row}
        chips={chips}
        edge={edge}
        onAssignFace={onAssignFace}
        showCapsule={chipOptions.labelMode !== 'off'}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  details: { paddingTop: 4, paddingBottom: 6, paddingHorizontal: 2 },
  detailCamera: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium, lineHeight: 16 },
  zoneChip: { alignSelf: 'flex-start', borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm + 1, height: 20, justifyContent: 'center' },
  zoneText: { fontSize: 10 },
})
