/**
 * TileHero — the picture of a track and what is drawn ON it that is not
 * tappable: the thumbnail, the time chip, the flag pills and the
 * active dot. `TileLabels` is its sibling overlay for the bottom row (the label
 * capsule and the "?" face chip). Shared by the gallery tile and the reel card,
 * so the two surfaces cannot drift on what a track looks like.
 *
 * ## Why the label row is a SIBLING, not a child
 *
 * The "?" chip is a button of its own. Inside the tile's `Pressable` it would be
 * a button nested in a button — invalid HTML on the web build (react-native-web
 * renders both as `<button>`) and a tap that fires both handlers. So the tile is
 * the picture's `Pressable` and the label row floats above it as a sibling.
 *
 * ## Why the chips are NOT glass
 *
 * A glass chip is a native effect view (a UIVisualEffectView / UIGlassEffect on
 * iOS), and a gallery keeps ~60 tiles alive at once with two to three chips
 * each: over a hundred live effect views, every one re-composited while the
 * grid scrolls. That, not the list, is what made scrolling janky. A chip on a
 * picture is a plain translucent wash (`ChipSurface`); real glass stays on the
 * chrome that floats OVER content (the tab bar, the toolbar), where there is one.
 */
import React, { memo, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'

import { ImageOff, ScanFace, Star } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { GLASS, RADIUS, SPACING, TABULAR, TYPOGRAPHY, withAlpha } from '../../../theme/tokens.js'
import { colorForEventType } from '../../camera/theater/event-highlights.js'
import { resolveEventKindIcon } from '../event-kind-icons.js'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import type { TileChips } from './tile-model.js'

export interface TileHeroProps {
  readonly row: EventsTrackRow
  readonly chips: TileChips
  /** Square edge, in points. */
  readonly edge: number
  /** The thumbnail URL, already sized. Null = no hub address yet. */
  readonly imageUri: string | null
  /** The token to send as a Bearer header, or null when the surface is
   *  authenticated another way (the web page's own session cookie). Primitives
   *  rather than a source object so the memo below is not defeated per render. */
  readonly bearer: string | null
  /** The clock chip (`HH:MM`). The gallery draws it; the reel's strip has its own time line. */
  readonly showTime: boolean
}

const CHIP_RADIUS = 6

export const TileHero = memo(function TileHero({
  row, chips, edge, imageUri, bearer, showTime,
}: TileHeroProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The URI that failed, not a boolean: the list recycles this component for
  // another track, and a flag would leave every later picture on the fallback.
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const accent = colorForEventType(row.className)
  const source = useMemo(
    () =>
      imageUri === null
        ? null
        : bearer === null
          ? { uri: imageUri }
          : { uri: imageUri, headers: { Authorization: `Bearer ${bearer}` } },
    [imageUri, bearer],
  )
  const showFallback = source === null || failedUri === imageUri

  return (
    <View style={{ width: edge, height: edge, backgroundColor: withAlpha(accent, 0.18), overflow: 'hidden' }}>
      {showFallback ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ImageOff size={Math.max(14, Math.round(edge / 5))} color={colors.foregroundSubtle} />
        </View>
      ) : (
        <Image
          source={source}
          recyclingKey={row.trackId}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setFailedUri(imageUri)}
        />
      )}

      <View pointerEvents="none" style={styles.topLeft}>
        {chips.favourited ? (
          <View accessibilityLabel={t('v2.eventsCard.favourite')}>
            <Star size={12} color={colors.warning} fill={colors.warning} />
          </View>
        ) : null}
        {chips.debug ? <FlagPill text="D" label={t('v2.eventsCard.debug')} /> : null}
        {chips.train ? <FlagPill text="T" label={t('v2.eventsCard.train')} /> : null}
        {chips.trained ? <FlagPill text="✓" label={t('v2.eventsCard.trained')} /> : null}
      </View>

      <View pointerEvents="none" style={styles.topRight}>
        {showTime ? (
          <EventTimeChip text={chips.time} />
        ) : null}
        {chips.active ? (
          <View
            accessibilityLabel={t('v2.eventsCard.active')}
            style={[styles.activeDot, { backgroundColor: colors.success }]}
          />
        ) : null}
      </View>

    </View>
  )
})

export interface TileLabelsProps {
  readonly row: EventsTrackRow
  readonly chips: TileChips
  readonly edge: number
  /** The "?" chip: the same open, carrying WHY. Absent = the chip is not drawn. */
  readonly onAssignFace?: (row: EventsTrackRow) => void
  /** Draw the label capsule at all. The gallery always does (a glyph at least);
   *  the reel is "the crop" until labels are switched on. */
  readonly showCapsule?: boolean
}

/** The bottom row of the picture: the label capsule and the "?" face chip. A
 *  transparent overlay the size of the hero, so it can sit beside the tile's
 *  `Pressable` rather than inside it. */
export const TileLabels = memo(function TileLabels({ row, chips, edge, onAssignFace, showCapsule = true }: TileLabelsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accent = colorForEventType(row.className)
  return (
    <View pointerEvents="box-none" style={[styles.labelsLayer, { width: edge, height: edge }]}>
      <View style={styles.bottomRow}>
        {showCapsule ? (
          <View pointerEvents="none" style={styles.bottomCapsule}>
            <ChipSurface radius={CHIP_RADIUS} style={styles.capsulePad}>
              <View style={styles.capsule}>
                <KindGlyph iconId={chips.glyphId} size={12} color={accent} />
                {chips.text !== null ? (
                  <Text numberOfLines={1} style={[styles.capsuleText, { color: colors.foreground }]}>
                    {chips.text}
                  </Text>
                ) : null}
              </View>
            </ChipSurface>
          </View>
        ) : null}
        {chips.unassignedFace && onAssignFace !== undefined ? (
          <Pressable
            onPress={() => onAssignFace(row)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.events.unrecognizedFace')}
          >
            <ChipSurface radius={CHIP_RADIUS} style={styles.capsulePad}>
              <View style={styles.capsule}>
                <ScanFace size={12} color={colors.foreground} />
                <Text style={[styles.capsuleText, { color: colors.foreground }]}>?</Text>
              </View>
            </ChipSurface>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
})

/** A taxonomy glyph chosen by DATA (an icon id the hub sends). Built with
 *  `createElement` because the component is a lookup result, not a name. */
function KindGlyph({ iconId, size, color }: { readonly iconId: string; readonly size: number; readonly color: string }) {
  return React.createElement(resolveEventKindIcon(iconId), { size, color })
}

/** The wash of the tab bar's surface (`GlassSurface variant="bar"`): the same
 *  tone, opacity and hairline, so a label reads on a bright or a dark thumbnail
 *  exactly as the bar does over page content. A plain view — no blur. */
function useChipLook(radius: number): ViewStyle {
  const { colors, mode } = useTheme()
  return useMemo(
    () => ({
      borderRadius: radius,
      backgroundColor: withAlpha(colors[GLASS.bar.tone[mode]], GLASS.bar.alpha[mode]),
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: withAlpha(colors.foreground, GLASS.hairlineAlpha[mode]),
    }),
    [radius, colors, mode],
  )
}

/** The chip behind text on a picture: the tab bar's wash as a plain view (see
 *  the header for why it is not glass). */
function ChipSurface({ radius, style, children }: { readonly radius: number; readonly style: StyleProp<ViewStyle>; readonly children: React.ReactNode }) {
  const look = useChipLook(radius)
  return <View style={[look, style]}>{children}</View>
}

/** The clock chip on a picture's top-right corner — the events tile's, and the Library faces tile's. */
export function EventTimeChip({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <ChipSurface radius={CHIP_RADIUS - 1} style={styles.timePad}>
      <Text style={[styles.timeText, TABULAR, { color: colors.foreground }]}>{text}</Text>
    </ChipSurface>
  )
}

function FlagPill({ text, label }: { readonly text: string; readonly label?: string }) {
  const { colors } = useTheme()
  const look = useChipLook(RADIUS.sm)
  return (
    <View accessibilityLabel={label} style={[look, styles.flagPill]}>
      <Text style={[styles.flagText, { color: colors.foreground }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  topLeft: { position: 'absolute', top: SPACING.sm, left: SPACING.sm, flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  topRight: { position: 'absolute', top: SPACING.sm, right: SPACING.sm, flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  timePad: { paddingHorizontal: SPACING.sm, paddingVertical: 1 },
  timeText: { fontSize: 9, fontWeight: TYPOGRAPHY.weight.bold },
  activeDot: { width: 8, height: 8, borderRadius: RADIUS.pill },
  labelsLayer: { position: 'absolute', top: 0, left: 0, justifyContent: 'flex-end' },
  bottomRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', margin: SPACING.sm },
  bottomCapsule: { flexShrink: 1 },
  capsulePad: { paddingHorizontal: SPACING.sm + 1, paddingVertical: 2 },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  capsuleText: { fontSize: 10, fontWeight: TYPOGRAPHY.weight.bold, flexShrink: 1 },
  flagPill: { minWidth: 14, height: 14, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  flagText: { fontSize: 9, fontWeight: TYPOGRAPHY.weight.bold },
})
