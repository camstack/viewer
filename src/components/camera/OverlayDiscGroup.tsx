/**
 * OverlayDiscGroup — the single on-video disc cluster.
 *
 * Every stream chrome disc (mute, talk, history, play/pause, PiP, fullscreen)
 * is an item in `items`. The group owns visibility, auto-hide, press re-arm,
 * safe-area padding and the 40pt disc chrome. A disc that lives outside this
 * group cannot hide with the others — that is how the landscape History
 * trigger stayed on screen after tap-to-hide (operator, 2026-08-23).
 *
 * Which discs exist is the caller's job. This file does not know about
 * mute, talk or timeline: it paints whatever `items` it is given, in the
 * cluster each item names.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { type LucideIcon } from '../../lib/icons.js'
import { SPACING } from '../../theme/tokens.js'
import { useTheme } from '../../theme/theme-provider.js'
import Animated from 'react-native-reanimated'
import { useControlsTransitions } from '../../theme/motion.js'
import { GlassButton } from '../ui/GlassButton.js'
import { GlassGroup } from '../ui/GlassSurface.js'

import { CONTROLS_AUTO_HIDE_MS } from './controls-auto-hide.js'

export type OverlayDiscCluster = 'left' | 'right'

export interface OverlayDisc {
  readonly id: string
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  readonly active?: boolean
  readonly badge?: string
  readonly cluster: OverlayDiscCluster
}

export interface OverlayEdgePad {
  readonly left: number
  readonly right: number
  readonly bottom: number
}

export interface OverlayDiscGroupProps {
  /** Parent-owned visibility (the stage's single-tap gesture toggles it). */
  readonly visible: boolean
  /** Inactivity auto-hide callback — the parent owns `visible`. */
  readonly onRequestHide: () => void
  /** Hold the group up (e.g. while paused, so play stays reachable). */
  readonly holdOpen?: boolean
  readonly items: readonly OverlayDisc[]
  /**
   * Extra left/right/bottom inset for both clusters. Fill / landscape MUST
   * pass the window safe-area so the discs clear the notch and home
   * indicator. Portrait omits this: the video box is already below the
   * status bar.
   */
  readonly edgePad?: OverlayEdgePad
  /**
   * Disc diameter. Defaults to {@link OVERLAY_DISC_SIZE}.
   *
   * The on-demand overlay is a 256–360pt WINDOW, not a screen: four 40pt discs
   * plus their gaps do not fit across its picture, and a picture 144pt tall
   * cannot spend 48 of them on a control row. It asks for a smaller disc rather
   * than growing a second cluster component — the chrome, the auto-hide and the
   * press re-arm are the same ones, at a size the window can carry.
   */
  readonly discSize?: number
  /**
   * Restarts the auto-hide countdown whenever it changes. For a surface that
   * hides WITH the group but is not one of its discs (the fullscreen PTZ pad):
   * a press there is as much "the operator is using the chrome" as a disc press.
   */
  readonly activity?: number
}

/** Disc diameter, points. Exported so a sibling cluster can sit above the row. */
export const OVERLAY_DISC_SIZE = 40

export interface OverlayDiscButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  readonly active?: boolean
  readonly badge?: string
  /** Diameter; the drive overlay shrinks its discs next to the open drawer. */
  readonly size?: number
}

/**
 * One round glass button (`GlassButton`: glyph on a glass disc; an active one is
 * washed with the `primary` tint and its glyph takes `primaryFill`). Exported
 * for the robot's `DriveOverlay`, whose four buttons are this chrome and not
 * a second one — but which cannot be `items` of the group: they must outlive
 * auto-hide while the joystick beside them is held (2026-09-06).
 */
export function OverlayDiscButton({
  icon: Icon,
  label,
  onPress,
  active = false,
  badge,
  size = OVERLAY_DISC_SIZE,
}: OverlayDiscButtonProps) {
  const { colors } = useTheme()
  const glyph = active ? colors.primaryFill : colors.foreground
  return (
    // `dense`: every disc mounts under TWO fades (the group's `entering` and its
    // own `pop`), inside a `GlassGroup`; iOS does not always draw a native glass
    // that appears under an ancestor at opacity 0, and the mute and PiP discs
    // were left as bare glyphs on the picture (operator, 2026-10-23). The wash
    // inside the surface is drawn either way, so every disc, in every state, is a disc.
    <GlassButton label={label} onPress={onPress} active={active} size={size} pop dense>
      <Icon size={Math.round(size * 0.45)} color={glyph} />
      {badge ? <Text style={[styles.badge, { color: glyph }]}>{badge}</Text> : null}
    </GlassButton>
  )
}

export function OverlayDiscGroup({
  visible,
  onRequestHide,
  holdOpen = false,
  items,
  edgePad,
  discSize = OVERLAY_DISC_SIZE,
  activity = 0,
}: OverlayDiscGroupProps) {
  const fade = useControlsTransitions()
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (visible && !holdOpen) {
      hideTimer.current = setTimeout(onRequestHide, CONTROLS_AUTO_HIDE_MS)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    // `activity` is read only as a dependency: its change IS the re-arm.
  }, [visible, holdOpen, onRequestHide, activity])

  const press = useCallback(
    (fn: () => void) => (): void => {
      fn()
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (!holdOpen) hideTimer.current = setTimeout(onRequestHide, CONTROLS_AUTO_HIDE_MS)
    },
    [holdOpen, onRequestHide],
  )

  const leftItems = useMemo(
    () => items.filter((item) => item.cluster === 'left'),
    [items],
  )
  const rightItems = useMemo(
    () => items.filter((item) => item.cluster === 'right'),
    [items],
  )

  if (!visible) return null

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="box-none" entering={fade.entering} exiting={fade.exiting}>
      {leftItems.length > 0 ? (
        <GlassGroup
          style={[
            styles.bottomLeft,
            {
              gap: clusterGap(discSize),
              left: (edgePad?.left ?? 0) + SPACING.md,
              bottom: (edgePad?.bottom ?? 0) + SPACING.md,
            },
          ]}
          pointerEvents="box-none"
        >
          {leftItems.map((item) => (
            <OverlayDiscButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={item.active}
              badge={item.badge}
              size={discSize}
              onPress={press(item.onPress)}
            />
          ))}
        </GlassGroup>
      ) : null}
      {rightItems.length > 0 ? (
        <GlassGroup
          style={[
            styles.bottomRight,
            {
              gap: clusterGap(discSize),
              right: (edgePad?.right ?? 0) + SPACING.md,
              bottom: (edgePad?.bottom ?? 0) + SPACING.md,
            },
          ]}
          pointerEvents="box-none"
        >
          {rightItems.map((item) => (
            <OverlayDiscButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={item.active}
              badge={item.badge}
              size={discSize}
              onPress={press(item.onPress)}
            />
          ))}
        </GlassGroup>
      ) : null}
    </Animated.View>
  )
}

/** Space between discs. Scales with the disc so a shrunken cluster keeps its
 *  proportions instead of a 40pt rhythm around 28pt buttons. */
function clusterGap(discSize: number): number {
  return Math.max(SPACING.sm, Math.round((discSize / OVERLAY_DISC_SIZE) * SPACING.md))
}

const styles = StyleSheet.create({
  bottomLeft: {
    position: 'absolute',
    flexDirection: 'row',
    gap: SPACING.md,
  },
  bottomRight: {
    position: 'absolute',
    flexDirection: 'row',
    gap: SPACING.md,
  },
  badge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    fontSize: 9,
    fontWeight: '700',
  },
})
