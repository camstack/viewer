/**
 * CameraActionBar — the per-camera control bar, in the two chromes the app has.
 *
 * The grid's tap-to-reveal disc row was the only per-camera bar in the app, and
 * it is written for one surface: translucent discs over live video. Promoting
 * it means the same CONTENT with a frame per surface, not a second bar — the
 * items come from `grid/camera-action-bar.ts` and nothing here decides which
 * controls exist.
 *
 *   `overlay` — the wall's language: 34pt translucent discs, light glyphs.
 *               Unchanged from what `GridTile` drew, on purpose: nothing about
 *               the wall is meant to move in this change.
 *   `surface`  — the app's language: themed pills on an elevated background,
 *               with the theme's radius and spacing tokens. This is the one the
 *               tablet snapshot shelf wears.
 */
import React, { useMemo } from 'react'
import { View, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Lightbulb,
  Move,
  MoreHorizontal,
  PictureInPicture2,
  Plus,
  SlidersHorizontal,
  type LucideIcon,
} from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, type ColorTokens } from '../../theme/tokens.js'
import type { CameraActionItem, CameraActionKind } from '../../grid/camera-action-bar.js'

/** Glyph per intent. One map, both variants — a bar that looked different in
 *  the two places would be the fork this component exists to prevent. */
const ICONS: Readonly<Record<CameraActionKind, LucideIcon>> = {
  goTo: ChevronRight,
  addToView: Plus,
  // A second picture floating over the current one — which is literally what
  // the on-demand overlay is. Not a play glyph: `playback` does not start
  // anything, it opens a player already positioned at the instant on screen.
  playback: PictureInPicture2,
  ptz: Move,
  devices: Lightbulb,
  viewOptions: SlidersHorizontal,
  actions: MoreHorizontal,
}

/** i18n key per intent — the keys the grid already ships, reused verbatim. */
const LABELS: Readonly<Record<CameraActionKind, string>> = {
  goTo: 'v2.cameraShelf.goTo',
  addToView: 'v2.cameraShelf.addToView',
  playback: 'v2.onDemandPlayer.openA11y',
  ptz: 'v2.cameraDetail.ptz',
  devices: 'v2.gridView.cellDevicesA11y',
  viewOptions: 'v2.gridView.cellMenuA11y',
  actions: 'v2.gridView.cellActionsA11y',
}

export type CameraActionBarVariant = 'overlay' | 'surface'

export interface CameraActionBarProps {
  readonly items: readonly CameraActionItem[]
  readonly onAction: (kind: CameraActionKind) => void
  readonly variant: CameraActionBarVariant
}

export function CameraActionBar({
  items,
  onAction,
  variant,
}: CameraActionBarProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (items.length === 0) return null
  const overlay = variant === 'overlay'
  return (
    <View style={overlay ? styles.rowOverlay : styles.rowSurface} pointerEvents="box-none">
      {items.map((item) => {
        const Icon = ICONS[item.kind]
        return (
          <Pressable
            key={item.kind}
            onPress={() => onAction(item.kind)}
            hitSlop={6}
            disabled={item.disabled === true}
            accessibilityRole="button"
            accessibilityState={{ disabled: item.disabled === true }}
            accessibilityLabel={t(LABELS[item.kind])}
            style={({ pressed }) => [
              overlay ? styles.btnOverlay : styles.btnSurface,
              { opacity: item.disabled === true ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Icon size={18} color={overlay ? '#fafaf9' : colors.foreground} />
          </Pressable>
        )
      })}
    </View>
  )
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    /** The wall's row: it is positioned by the tile, so no placement here. */
    rowOverlay: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    rowSurface: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    /** The wall's disc, to the point: same 40pt, same radius, same scrim as
     *  `GridTile` drew before the bar was extracted. Nothing about the live
     *  wall is meant to move in this change. */
    btnOverlay: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    btnSurface: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  })
}
