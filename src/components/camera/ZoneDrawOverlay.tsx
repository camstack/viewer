/**
 * ZoneDrawOverlay — the timeline zone filter's DRAWING MODE, rendered directly
 * over the live/playback video box (the stream keeps playing underneath; the
 * overlay never touches the player state). While mounted it claims the whole
 * touch stream over the stage — the video tap/pinch gestures are intentionally
 * swallowed for the duration of drawing mode only.
 *
 * The user drags ONE rectangle; the rect is normalised 0..1 against the
 * DISPLAYED video box (16:9, same aspect as the detection frames — see
 * theater/zone-filter.ts). Drawing while pinch-zoomed is not compensated (v0):
 * the rect maps to the un-transformed box. Conferma / Annulla float over the
 * video; confirming hands the rect to the parent and exits drawing mode.
 *
 * Presentational + controlled: the active zone and the drawing flag live in
 * `CameraDetailScreen`; this component owns only the in-progress draft.
 */
import React, { memo, useCallback, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'

import Svg, { Circle, Polygon, Polyline } from 'react-native-svg'
import { Pentagon, Square, Undo2 } from '../../lib/icons.js'

import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import {
  dragToRect,
  type ZoneRect,
  isShapeUsable,
  rectShape,
  type ZoneShape,
  type ZonePoint,
} from './theater/zone-filter.js'

/** Which shape the operator is drawing. */
export type ZoneDrawMode = 'rect' | 'polygon'

/** Fixed light content over the (dimmed) video, independent of theme. */
const OVERLAY_FG = '#ffffff'
const OVERLAY_BACKDROP = 'rgba(0, 0, 0, 0.25)'
const OVERLAY_PILL_BG = 'rgba(0, 0, 0, 0.55)'

export interface ZoneDrawOverlayProps {
  /** The currently-active zone — pre-filled so re-entering drawing mode shows
   *  it (Conferma without a new drag keeps it). */
  readonly zone: ZoneShape | null
  /** Confirm the drawn shape as the active zone (parent exits drawing mode). */
  readonly onConfirm: (zone: ZoneShape) => void
  /** Leave drawing mode without changing the active zone. */
  readonly onCancel: () => void
}

interface BoxSize {
  readonly width: number
  readonly height: number
}

export const ZoneDrawOverlay = memo(function ZoneDrawOverlay({
  zone,
  onConfirm,
  onCancel,
}: ZoneDrawOverlayProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const [boxSize, setBoxSize] = useState<BoxSize>({ width: 0, height: 0 })
  // Two drafts, not one polymorphic draft. Switching mode must not silently
  // reinterpret a rect as three-quarters of a polygon, and coming BACK to a
  // mode should find what was left there.
  const [rectDraft, setRectDraft] = useState<ZoneRect | null>(
    zone?.kind === 'rect' ? zone.rect : null,
  )
  const [points, setPoints] = useState<readonly ZonePoint[]>(
    zone?.kind === 'polygon' ? zone.points : [],
  )
  const [mode, setMode] = useState<ZoneDrawMode>(zone?.kind === 'polygon' ? 'polygon' : 'rect')
  const startRef = useRef({ x: 0, y: 0 })
  // A polygon tap must not be swallowed by the drag handler, and a drag must
  // not drop a vertex. This records whether the finger actually travelled.
  const movedRef = useRef(false)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBoxSize({ width, height })
  }, [])

  const onGrant = useCallback((e: GestureResponderEvent): void => {
    startRef.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
    movedRef.current = false
  }, [])

  const onMove = useCallback(
    (e: GestureResponderEvent): void => {
      movedRef.current = true
      if (mode !== 'rect') return
      const rect = dragToRect(
        startRef.current.x,
        startRef.current.y,
        e.nativeEvent.locationX,
        e.nativeEvent.locationY,
        boxSize.width,
        boxSize.height,
      )
      if (rect !== null) setRectDraft(rect)
    },
    [boxSize, mode],
  )

  // A vertex lands on RELEASE, and only when the finger did not travel — so a
  // drag across the picture in polygon mode does nothing rather than scattering
  // points along its path.
  const onRelease = useCallback((): void => {
    if (mode !== 'polygon' || movedRef.current) return
    if (boxSize.width <= 0 || boxSize.height <= 0) return
    const p: ZonePoint = {
      x: Math.min(1, Math.max(0, startRef.current.x / boxSize.width)),
      y: Math.min(1, Math.max(0, startRef.current.y / boxSize.height)),
    }
    setPoints((prev) => [...prev, p])
  }, [mode, boxSize])

  const undoPoint = useCallback(() => setPoints((prev) => prev.slice(0, -1)), [])
  const clearPoints = useCallback(() => setPoints([]), [])

  const draftShape: ZoneShape | null =
    mode === 'rect'
      ? rectDraft === null
        ? null
        : rectShape(rectDraft)
      : points.length >= 3
        ? { kind: 'polygon', points }
        : null

  const confirmEnabled = draftShape !== null && isShapeUsable(draftShape)
  const handleConfirm = useCallback((): void => {
    if (draftShape !== null && isShapeUsable(draftShape)) onConfirm(draftShape)
  }, [draftShape, onConfirm])

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.container]}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
    >
      {/* Top column: the hint on its own row (pointer-inert), the shape picker
          right-aligned on the row below — never side by side, so a long hint
          cannot run under the chips at ~390pt. */}
      <View style={styles.topColumn} pointerEvents="box-none">
        <View style={styles.hintPill} pointerEvents="none">
          <Text style={styles.hintText} numberOfLines={2}>
            {mode === 'polygon' ? t('v2.theater.zoneHintPolygon') : t('v2.theater.zoneHint')}
          </Text>
        </View>
        {/* Switching mode keeps both drafts (see the two useStates), so a
            mistaken tap costs nothing. */}
        <View style={styles.modeWrap} pointerEvents="box-none">
        <Pressable
          style={[styles.modeChip, mode === 'rect' && { backgroundColor: colors.primary }]}
          onPress={() => setMode('rect')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'rect' }}
        >
          <Square size={14} color={OVERLAY_FG} />
          <Text style={styles.modeText}>{t('v2.theater.zoneModeRect')}</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, mode === 'polygon' && { backgroundColor: colors.primary }]}
          onPress={() => setMode('polygon')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'polygon' }}
        >
          <Pentagon size={14} color={OVERLAY_FG} />
          <Text style={styles.modeText}>{t('v2.theater.zoneModePolygon')}</Text>
        </Pressable>
        </View>
      </View>


      {/* Live outline while drawing / the pre-filled active zone. */}
      {mode === 'rect' && rectDraft !== null && boxSize.width > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.zoneRect,
            {
              borderColor: colors.warning,
              backgroundColor: `${colors.warning}26`,
              left: rectDraft.x * boxSize.width,
              top: rectDraft.y * boxSize.height,
              width: rectDraft.w * boxSize.width,
              height: rectDraft.h * boxSize.height,
            },
          ]}
        />
      ) : null}

      {/* The polygon in progress. Below three points it is an open Polyline —
          drawing it closed would show the operator a shape they have not made
          yet, and the vertex dots are what tell them the taps registered. */}
      {mode === 'polygon' && points.length > 0 && boxSize.width > 0 ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {points.length >= 3 ? (
            <Polygon
              points={points.map((p) => `${p.x * boxSize.width},${p.y * boxSize.height}`).join(' ')}
              fill={`${colors.warning}26`}
              stroke={colors.warning}
              strokeWidth={1.5}
            />
          ) : (
            <Polyline
              points={points.map((p) => `${p.x * boxSize.width},${p.y * boxSize.height}`).join(' ')}
              fill="none"
              stroke={colors.warning}
              strokeWidth={1.5}
            />
          )}
          {points.map((p, i) => (
            <Circle
              key={`${p.x}:${p.y}:${i}`}
              cx={p.x * boxSize.width}
              cy={p.y * boxSize.height}
              r={5}
              fill={colors.warning}
            />
          ))}
        </Svg>
      ) : null}

      {/* Floating actions — bottom right, standalone pills. `box-none` so drags between the
          buttons still reach the drawing surface. */}
      <View style={styles.actions} pointerEvents="box-none">
        {mode === 'polygon' && points.length > 0 ? (
          <>
            <Pressable style={styles.button} onPress={undoPoint} accessibilityRole="button">
              <Undo2 size={14} color={OVERLAY_FG} />
            </Pressable>
            <Pressable style={styles.button} onPress={clearPoints} accessibilityRole="button">
              <Text style={styles.buttonText}>{t('v2.theater.zoneClearPoints')}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable
          style={styles.button}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{t('v2.theater.zoneCancel')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            confirmEnabled && { backgroundColor: colors.primary },
            !confirmEnabled && styles.buttonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!confirmEnabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !confirmEnabled }}
        >
          <Text
            style={[
              styles.buttonText,
              confirmEnabled && { color: colors.primaryForeground },
            ]}
          >
            {t('v2.theater.zoneConfirm')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  modeWrap: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 6,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: OVERLAY_PILL_BG,
  },
  modeText: { color: OVERLAY_FG, fontSize: 11, fontWeight: '600' },
  container: {
    zIndex: 60,
    backgroundColor: OVERLAY_BACKDROP,
  },
  topColumn: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    gap: SPACING.sm,
  },
  hintPill: {
    alignSelf: 'center',
    backgroundColor: OVERLAY_PILL_BG,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.lg,
    maxWidth: '90%',
  },
  hintText: {
    color: OVERLAY_FG,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  zoneRect: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 2,
  },
  // No shared container: each action is its own pill, styled like `modeChip`.
  actions: {
    position: 'absolute',
    right: SPACING.md,
    bottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: OVERLAY_PILL_BG,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: { color: OVERLAY_FG, fontSize: 11, fontWeight: '600' },
})
