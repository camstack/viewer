import React, { memo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Activity, Heart } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import {
  FAVOURITES_BUCKET,
  locationBucket,
  zoneBucket,
  type LocationBucket,
} from './camera-locations.js'
import { CatalogIcon } from '../CatalogIcon.js'
import { locationIconFor, type DrawableLocationIcon } from './location-icons.js'

/**
 * The location picker that sits BETWEEN the reel and the camera list.
 *
 * Favourites first, then every location the cameras actually have. It scrolls
 * horizontally because the number of locations is the operator's, not ours —
 * a home with nine rooms must not push the camera list off the screen.
 *
 * "All" is the resting state and is always the first thing after Favourites,
 * so getting back to everything is one press from anywhere in the strip.
 */
export interface CameraLocationBarProps {
  readonly locations: readonly string[]
  readonly bucket: LocationBucket
  readonly onSelect: (bucket: LocationBucket) => void
  /** How many cameras are starred — the Favourites chip shows it, because an
   *  empty shortlist is worth knowing BEFORE pressing into an empty list. */
  readonly favouriteCount: number
  /** The icon each location carries, keyed by its folded name. A location
   *  missing from it draws no glyph at all — that is "nobody chose one", and
   *  it must not look like a choice. An empty map is the whole feature off,
   *  which is what an older hub gives us. */
  readonly icons?: ReadonlyMap<string, DrawableLocationIcon>
  /** The SITE ZONES, drawn BEFORE the locations: a zone is the coarser
   *  question ("upstairs"), and an operator asking it should not have to press
   *  four rooms to get there. Empty on a hub that has none, which renders the
   *  strip exactly as it was before zones existed. */
  readonly zones?: readonly ZoneChip[]
  /** The Motion ORDER toggle. Independent of the bucket: it orders whatever
   *  the selected chip shows ("Esterno" + Motion = the outdoor cameras, most
   *  recent motion first), so pressing it never clears the selection. */
  readonly motionOrder: boolean
  readonly onToggleMotionOrder: () => void
}

/** One zone, reduced to what the strip draws. */
export interface ZoneChip {
  readonly zoneKey: string
  readonly label: string
  readonly icon: DrawableLocationIcon | null
}

export const CameraLocationBar = memo(function CameraLocationBar({
  locations,
  bucket,
  onSelect,
  favouriteCount,
  icons,
  zones = [],
  motionOrder,
  onToggleMotionOrder,
}: CameraLocationBarProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const chip = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    icon?: React.JSX.Element,
  ): React.JSX.Element => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        { backgroundColor: selected ? colors.primary : colors.surface },
      ]}
    >
      {icon}
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.primaryForeground : colors.foregroundMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The bar is CHROME: it takes the height of its chips and no more.
      // Without `flexGrow: 0` a horizontal ScrollView is a flex item like any
      // other and swallows the free space its column parent has left, and the
      // chips — which carry no height of their own — then stretch to fill it.
      // Shipped that way for one release: pills the height of half the screen.
      style={styles.bar}
      contentContainerStyle={styles.row}
      accessibilityLabel={t('v2.cameras.locationFilter', 'Filter by location')}
    >
      {chip(
        'favourites',
        favouriteCount > 0
          ? `${t('v2.cameras.favourites', 'Favourites')} · ${String(favouriteCount)}`
          : t('v2.cameras.favourites', 'Favourites'),
        bucket === FAVOURITES_BUCKET,
        () => { onSelect(bucket === FAVOURITES_BUCKET ? null : FAVOURITES_BUCKET) },
        <Heart
          size={13}
          color={bucket === FAVOURITES_BUCKET ? colors.primaryForeground : colors.foregroundMuted}
          fill={bucket === FAVOURITES_BUCKET ? colors.primaryForeground : 'transparent'}
        />,
      )}
      {chip('all', t('v2.events.all', 'All'), bucket === null, () => { onSelect(null) })}
      {/* An ORDER, not a bucket: toggles on and off by itself and leaves the
          selected zone / location alone. */}
      {chip(
        'motion',
        t('v2.cameras.motionOrder', 'Motion'),
        motionOrder,
        onToggleMotionOrder,
        <Activity
          size={13}
          color={motionOrder ? colors.primaryForeground : colors.foregroundMuted}
        />,
      )}
      {/* ZONES, before the locations. Same chip, same press-to-clear, so the
          two rows of the strip behave identically — a zone is not a mode. */}
      {zones.map((zone) => {
        const key = zoneBucket(zone.zoneKey)
        const selected = bucket === key
        return chip(
          `zone:${zone.zoneKey}`,
          zone.label,
          selected,
          () => { onSelect(selected ? null : key) },
          zone.icon === null ? undefined : (
            <CatalogIcon
              iconKey={zone.icon}
              size={13}
              color={selected ? colors.primaryForeground : colors.foregroundMuted}
            />
          ),
        )
      })}
      {locations.map((name) => {
        const iconKey = icons === undefined ? null : locationIconFor(icons, name)
        const key = locationBucket(name)
        const selected = bucket === key
        return chip(
          name,
          name,
          selected,
          () => {
            // Pressing the SELECTED bucket clears it — the same gesture that
            // chose it takes it back, so there is no dead end on a location
            // whose cameras are all offline.
            onSelect(selected ? null : key)
          },
          iconKey === null ? undefined : (
            <CatalogIcon
              iconKey={iconKey}
              size={13}
              color={selected ? colors.primaryForeground : colors.foregroundMuted}
            />
          ),
        )
      })}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  bar: { flexGrow: 0, flexShrink: 0 },
  row: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.xs,
    // The second half of the same fix: a content container defaults to
    // `stretch`, so even a bar of the right height would hand every chip that
    // whole height. Centred, each chip is as tall as its own text.
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
})
