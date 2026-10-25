/**
 * LibraryTile — THE grid tile of every Library page: Media, People, Plates and
 * Retrain. Agreed with the operator on 2026-10-21, replacing four shapes (a
 * square face crop, a 2:1 plate strip, a 16:9 retrain frame with three text
 * lines, a full-width media row) that made one tab look like four apps.
 *
 *   ┌──────────────────────────┐
 *   │        image 16:9        │  subject centred, `cover` (`shape="square"`: 1:1)
 *   │ FrontDoor                 │  ← where, then when: TWO lines on the image,
 *   │ 10:22 · 21/10            │    each the tile's full width (never one line
 *   ├▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬───────────┤    where the time squeezes the camera out)
 *                                ← confidence / progress, when the page has one
 *   │ Name / plate  [badge] (✓)│  ← ONE row
 *   └──────────────────────────┘
 *
 * `rows="two"` (the People tile, operator 2026-10-22): the name gets its own
 * full-width row and the badge + actions the row under it — a square tile is
 * too narrow for a name, a certainty word and Confirm on one line. The second
 * row is drawn even when empty, so every tile of the grid is the same height.
 *
 * The page decides WHAT each slot says; the tile owns how it looks. An image
 * that is absent or failed is a placeholder (icon + "No image"), never an
 * empty box — `libraryTileImageState` is the rule. Geometry (width, columns)
 * comes from `library-grid.ts`, so every page has the same grid too.
 *
 * Gestures: tap runs `onPress`; long-press runs `onLongPress` (a page that has a
 * selection mode starts it there), else `onPress`. In selection mode every
 * gesture toggles membership and the tile's actions disappear: a mode where
 * some taps select and others write is how an operator assigns the wrong
 * person. `libraryTileLongPress` is the rule.
 */
import React, { memo, useCallback, useState, type ComponentType, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image, type ImageSource } from 'expo-image'
import { Check, CheckSquare, ImageOff, Square } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR, TYPOGRAPHY, mediaScrim, withAlpha } from '../../theme/tokens.js'
import { libraryTileAspect, libraryTileImageState, type LibraryTileShape } from './library-grid.js'
import { SkeletonBox } from './SkeletonBox.js'

/** The shape every glyph a tile draws satisfies (lucide, a kind icon). */
export type LibraryTileIcon = ComponentType<{ size: number; color: string }>

/** An icon button on the tile's row (Confirm, Download, Cancel). */
export interface LibraryTileAction {
  readonly id: string
  readonly icon: LibraryTileIcon
  /** Accessible name — the action. */
  readonly label: string
  readonly onPress: () => void
  /** `primary` = the filled disc of the page's one-tap decision (✓). */
  readonly tone?: 'primary' | 'danger' | 'muted'
}

export interface LibraryTileProps {
  /** Fixed tile width (pt) from `useLibraryGrid` — identical in every row. */
  readonly width: number
  /** The image's shape: `frame` (16:9, the default) or `square` (the events tile). */
  readonly shape?: LibraryTileShape
  /** What to draw; `null` = there is no image. Memoise it: a new object blanks the image. */
  readonly source: ImageSource | null
  /** `source` is null only because it is still being fetched. */
  readonly loading?: boolean
  /** The placeholder's glyph (a media kind); defaults to "image off". */
  readonly placeholderIcon?: LibraryTileIcon
  /** WHEN, as a line on the image (`HH:MM · DD/MM`). Absent: the page draws it as a corner chip (`imageBadges`). */
  readonly when?: string
  /** WHERE, on the image (the camera). */
  readonly where?: string
  /** A bar on the image's bottom edge (confidence, progress). */
  readonly bar?: ReactNode
  /** Small marks on the image's top-right corner (a play glyph, class chips). */
  readonly imageBadges?: ReactNode
  /** The row's headline: a name, a plate, a title. */
  readonly title: string
  /** Quieter headline (nothing assigned yet). */
  readonly titleMuted?: boolean
  /** Monospaced, tracked headline (a plate). */
  readonly titleMono?: boolean
  /** The state badge after the title. */
  readonly badge?: ReactNode
  readonly actions?: readonly LibraryTileAction[]
  /** `one` (default): title, badge and actions on one row; `two`: the title alone, then badge + actions. */
  readonly rows?: 'one' | 'two'
  /** Draw the title/badge/actions block under the image. Default true; a page turns it off for a whole row that has nothing to say. */
  readonly info?: boolean
  /** A check on the image corner: this one is settled. */
  readonly settled?: boolean
  readonly selectionMode?: boolean
  readonly selected?: boolean
  /** A write on this tile is queued or running: dimmed, not pressable. */
  readonly pending?: boolean
  /** Past its retention window. */
  readonly faded?: boolean
  readonly onPress: () => void
  readonly onLongPress?: () => void
  readonly accessibilityLabel: string
  readonly testID?: string
}

const ACTION_SIZE = 24

export const LibraryTile = memo(function LibraryTile({
  width,
  shape = 'frame',
  source,
  loading = false,
  placeholderIcon: PlaceholderIcon = ImageOff,
  when,
  where,
  bar,
  imageBadges,
  title,
  titleMuted = false,
  titleMono = false,
  badge,
  actions = [],
  rows = 'one',
  info = true,
  settled = false,
  selectionMode = false,
  selected = false,
  pending = false,
  faded = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
}: LibraryTileProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [brokenUri, setBrokenUri] = useState<string | null>(null)
  const uri = source?.uri ?? null
  const onError = useCallback(() => setBrokenUri(uri), [uri])
  const imageState = libraryTileImageState({
    hasSource: source !== null && (uri === null || uri.length > 0),
    loading,
    broken: brokenUri !== null && brokenUri === uri,
  })
  const scrim = mediaScrim(colors)
  const shownActions = selectionMode ? [] : actions
  const titleText = (
    <Text
      numberOfLines={1}
      testID={testID === undefined ? undefined : `${testID}-title`}
      style={[
        styles.title,
        titleMono ? styles.titleMono : null,
        titleMono ? TABULAR : null,
        { color: titleMuted ? colors.foregroundMuted : colors.foreground },
      ]}
    >
      {title}
    </Text>
  )

  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        {
          width,
          backgroundColor: colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          borderWidth: selected ? 1 : StyleSheet.hairlineWidth,
          opacity: faded ? 0.55 : 1,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress ?? onPress}
        disabled={pending}
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        accessibilityLabel={accessibilityLabel}
        style={[styles.imageWrap, { aspectRatio: libraryTileAspect(shape), backgroundColor: colors.surfaceHover }]}
      >
        {imageState === 'image' && source !== null ? (
          <Image source={source} style={styles.image} contentFit="cover" contentPosition="center" cachePolicy="memory-disk" onError={onError} />
        ) : imageState === 'loading' ? (
          <SkeletonBox style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.placeholder} testID={testID === undefined ? undefined : `${testID}-placeholder`}>
            <PlaceholderIcon size={22} color={colors.foregroundSubtle} />
            <Text style={[styles.placeholderText, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              {t('v2.library.noImage')}
            </Text>
          </View>
        )}

        {imageBadges !== undefined ? <View style={styles.imageBadges}>{imageBadges}</View> : null}

        <View style={styles.bottom} pointerEvents="none">
          {/* No line to draw ⇒ no scrim: an empty band would dim the picture for nothing. */}
          {where !== undefined || when !== undefined ? (
            <View style={[styles.meta, { backgroundColor: scrim }]}>
              {where !== undefined ? (
                <Text
                  numberOfLines={1}
                  testID={testID === undefined ? undefined : `${testID}-where`}
                  style={[styles.where, { color: colors.foreground }]}
                >
                  {where}
                </Text>
              ) : null}
              {when !== undefined ? (
                <Text
                  numberOfLines={1}
                  testID={testID === undefined ? undefined : `${testID}-when`}
                  style={[styles.when, TABULAR, { color: colors.foregroundMuted }]}
                >
                  {when}
                </Text>
              ) : null}
            </View>
          ) : null}
          {bar}
        </View>

        {selectionMode ? (
          <View style={[styles.corner, { backgroundColor: scrim }]}>
            {selected ? <CheckSquare size={13} color={colors.primary} /> : <Square size={13} color={colors.foregroundMuted} />}
          </View>
        ) : settled ? (
          <View style={[styles.corner, { backgroundColor: colors.success }]}>
            <Check size={12} color={colors.background} />
          </View>
        ) : null}

        {pending ? (
          <View style={[styles.pending, { backgroundColor: withAlpha(colors.background, 0.6) }]}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </Pressable>

      {info && rows === 'two' ? (
        <View style={styles.titleRow}>{titleText}</View>
      ) : null}
      {info ? (
      <View style={styles.row} testID={testID === undefined ? undefined : `${testID}-row`}>
        {rows === 'one' ? titleText : null}
        {badge !== undefined ? <View style={rows === 'two' ? styles.badgeWide : styles.badge}>{badge}</View> : null}
        {rows === 'two' ? <View style={styles.spacer} /> : null}
        {shownActions.map((action) => {
          const Icon = action.icon
          const filled = action.tone === 'primary'
          const tint =
            action.tone === 'danger' ? colors.danger : action.tone === 'muted' ? colors.foregroundMuted : colors.primary
          return (
            <Pressable
              key={action.id}
              onPress={action.onPress}
              disabled={pending}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={[
                styles.action,
                filled ? { backgroundColor: colors.primary } : null,
                { opacity: pending ? 0.5 : 1 },
              ]}
            >
              <Icon size={filled ? 13 : 16} color={filled ? colors.primaryForeground : tint} />
            </Pressable>
          )
        })}
      </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  tile: { borderRadius: RADIUS.md, overflow: 'hidden' },
  imageWrap: { overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  placeholder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  placeholderText: { fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.medium },
  imageBadges: { position: 'absolute', top: SPACING.sm, right: SPACING.sm, flexDirection: 'row', gap: SPACING.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // Two stacked lines, each the tile's full width: nothing competes for a line.
  meta: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm },
  where: { fontSize: 11, fontWeight: TYPOGRAPHY.weight.medium },
  when: { fontSize: 10, fontWeight: TYPOGRAPHY.weight.regular },
  corner: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    width: 18,
    height: 18,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: ACTION_SIZE + SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  titleRow: { flexDirection: 'row', paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm },
  title: { flex: 1, fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  spacer: { flex: 1 },
  // The state word never ellipsizes: the title row above it is what gives way.
  badgeWide: { flexShrink: 0 },
  titleMono: { fontWeight: TYPOGRAPHY.weight.bold, letterSpacing: 0.5 },
  badge: { flexShrink: 1, maxWidth: '55%' },
  action: { width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
})
