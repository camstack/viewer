/**
 * CustomZoneDrawOverlay — the personal-rule custom-zone DRAWING surface (task
 * B6). It renders a camera snapshot (server-owned `useSnapshot` bucketed URL)
 * letterboxed inside a full-screen stage and lets the operator author a polygon
 * zone with the same UX as the admin zone editor:
 *
 *   • tap empty space → add a vertex,
 *   • drag a vertex   → move it,
 *   • tap the first vertex (or "Chiudi") once there are ≥3 → close the loop,
 *   • "Cancella"      → clear, "Conferma" → emit the polygon.
 *
 * Vertices are authored in the pixels of the letterboxed IMAGE box (the touch
 * surface is positioned exactly over it via {@link fitContain}, so a touch's
 * `locationX/Y` are already image-local); {@link toNormalizedPolygon} normalises
 * them 0..1 against the FRAME (not the stage) — correct on both orientations.
 *
 * Presentational + controlled: the parent ({@link CustomZoneField}) owns the
 * stored polygons and the open/closed modal flag; this component owns only the
 * in-progress draft. It uses the plain RN responder system (like
 * `ZoneDrawOverlay`), NOT reanimated worklets, so there are no worklet pitfalls.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native'
import type { ImageLoadEventData } from 'expo-image'
import { SnapshotImage } from './SnapshotImage.js'
import Svg, { Polygon, Polyline, Circle } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useSnapshot } from '../../data/use-snapshot.js'
import type { NcMaskPolygonShape } from '../../data/notification-center.js'
import {
  addVertex,
  fitContain,
  fromNormalizedPolygon,
  hitVertex,
  isClosable,
  moveVertex,
  toNormalizedPolygon,
  type Box,
  type Point,
} from './polygon-draw.js'

/** Fixed light content over the (dark) stage, independent of theme. */
const OVERLAY_FG = '#ffffff'
const OVERLAY_BACKDROP = 'rgba(0, 0, 0, 0.92)'
const OVERLAY_PILL_BG = 'rgba(0, 0, 0, 0.55)'
/** Touch radius (px) for grabbing an existing vertex / hitting vertex 0. */
const VERTEX_HIT_RADIUS = 22
/** Default frame aspect used before the snapshot reports its natural size. */
const DEFAULT_FRAME = { w: 16, h: 9 } as const

export interface CustomZoneDrawOverlayProps {
  /** The camera whose snapshot is the drawing backdrop. */
  readonly deviceId: number
  /** Camera display name (overlay title). */
  readonly deviceName: string
  /** An existing polygon to re-edit, or null for a fresh draw. */
  readonly initial: NcMaskPolygonShape | null
  /** Emit the authored polygon (normalised 0..1). Parent closes the overlay. */
  readonly onConfirm: (poly: NcMaskPolygonShape) => void
  /** Leave without changing anything. */
  readonly onCancel: () => void
}

interface FrameSize {
  readonly w: number
  readonly h: number
}

/** Top ladder rung — a full-screen zone editor never benefits from more. */
const ZONE_SNAPSHOT_WIDTH = 960

export const CustomZoneDrawOverlay = memo(function CustomZoneDrawOverlay({
  deviceId,
  deviceName,
  initial,
  onConfirm,
  onCancel,
}: CustomZoneDrawOverlayProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  // A full-screen drawing surface, so the top ladder rung — not the 4 K
  // capture. The zone polygon is stored NORMALISED (0-1) against the frame's
  // reported intrinsic size, so a proportionally-scaled frame yields identical
  // coordinates; the server preserves aspect ratio (`scale=W:-2`).
  const snapshot = useSnapshot(deviceId, true, ZONE_SNAPSHOT_WIDTH)

  const [stage, setStage] = useState<Box>({ width: 0, height: 0 })
  const [frame, setFrame] = useState<FrameSize | null>(null)
  const [verts, setVerts] = useState<readonly Point[]>([])
  const [closed, setClosed] = useState(false)
  const activeVertexRef = useRef<number | null>(null)
  const seededRef = useRef(false)

  // The letterboxed image sub-rect the touch surface + snapshot align to.
  const displayBox = useMemo(
    () => fitContain(stage, frame?.w ?? DEFAULT_FRAME.w, frame?.h ?? DEFAULT_FRAME.h),
    [stage, frame],
  )
  const boxSize = useMemo<Box>(
    () => ({ width: displayBox.width, height: displayBox.height }),
    [displayBox.width, displayBox.height],
  )

  // Seed the draft from an existing polygon ONCE the image box is measured (its
  // normalised points de-normalise against the stable letterboxed box).
  useEffect(() => {
    if (seededRef.current) return
    if (initial === null || initial.points.length === 0) return
    if (boxSize.width <= 0 || boxSize.height <= 0) return
    setVerts(fromNormalizedPolygon(initial, boxSize))
    setClosed(true)
    seededRef.current = true
  }, [initial, boxSize])

  const onLayout = useCallback((e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setStage({ width, height })
  }, [])

  const onImageLoad = useCallback((e: ImageLoadEventData): void => {
    const { width, height } = e.source
    if (width > 0 && height > 0) setFrame({ w: width, h: height })
  }, [])

  const onGrant = useCallback(
    (e: GestureResponderEvent): void => {
      const point: Point = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
      const hit = hitVertex(verts, point, VERTEX_HIT_RADIUS)
      if (hit >= 0) {
        // Tapping the first vertex closes the loop; otherwise start a drag.
        if (hit === 0 && !closed && isClosable(verts)) {
          setClosed(true)
          activeVertexRef.current = null
          return
        }
        activeVertexRef.current = hit
        return
      }
      if (closed) return // loop closed: no new vertices until cleared
      activeVertexRef.current = null
      setVerts((prev) => addVertex(prev, point))
    },
    [verts, closed],
  )

  const onMove = useCallback((e: GestureResponderEvent): void => {
    const index = activeVertexRef.current
    if (index === null) return
    const point: Point = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
    setVerts((prev) => moveVertex(prev, index, point))
  }, [])

  const onRelease = useCallback((): void => {
    activeVertexRef.current = null
  }, [])

  const clear = useCallback((): void => {
    setVerts([])
    setClosed(false)
    activeVertexRef.current = null
  }, [])

  const closeLoop = useCallback((): void => {
    if (isClosable(verts)) setClosed(true)
  }, [verts])

  const confirmEnabled = isClosable(verts)
  const handleConfirm = useCallback((): void => {
    if (!isClosable(verts)) return
    onConfirm(toNormalizedPolygon(verts, boxSize))
  }, [verts, boxSize, onConfirm])

  const pointsAttr = verts.map((v) => `${v.x},${v.y}`).join(' ')
  const boxReady = displayBox.width > 0 && displayBox.height > 0
  const imageStyle = {
    position: 'absolute' as const,
    left: displayBox.offsetX,
    top: displayBox.offsetY,
    width: displayBox.width,
    height: displayBox.height,
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]} onLayout={onLayout}>
      {/* Snapshot backdrop, letterboxed. */}
      {boxReady ? (
        <SnapshotImage
          source={snapshot}
          deviceId={deviceId}
          style={imageStyle}
          contentFit="fill"
          // No cross-fade here: the overlay derives its letterbox geometry from
          // the loaded frame, and animating between two intrinsic sizes would
          // move the drawing surface under the operator's finger.
          transition={0}
          onLoad={onImageLoad}
        />
      ) : null}

      {/* Loading affordance while the frame has not painted yet. */}
      {snapshot.isLoading || !boxReady ? (
        <View style={styles.loadingWrap} pointerEvents="none">
          <ActivityIndicator size="small" color={OVERLAY_FG} />
          <Text style={styles.loadingText}>{t('v2.nc.rules.editor.customZones.loading')}</Text>
        </View>
      ) : null}

      {/* SVG polygon layer, aligned to the image box (pointer-inert; the
          responder View above owns touches). */}
      {boxReady ? (
        <View style={imageStyle} pointerEvents="none">
          <Svg width={displayBox.width} height={displayBox.height}>
            {closed && verts.length >= 3 ? (
              <Polygon points={pointsAttr} fill={`${colors.warning}33`} stroke={colors.warning} strokeWidth={2} />
            ) : verts.length >= 2 ? (
              <Polyline points={pointsAttr} fill="none" stroke={colors.warning} strokeWidth={2} />
            ) : null}
            {verts.map((v, i) => (
              <Circle
                key={i}
                cx={v.x}
                cy={v.y}
                r={i === 0 && !closed && isClosable(verts) ? 9 : 6}
                fill={i === 0 ? colors.primary : OVERLAY_FG}
                stroke={colors.warning}
                strokeWidth={2}
              />
            ))}
          </Svg>
        </View>
      ) : null}

      {/* Touch surface — exactly over the letterboxed image so locationX/Y are
          image-local pixels. Claims the whole gesture stream while drawing. */}
      {boxReady ? (
        <View
          style={imageStyle}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onRelease}
          onResponderTerminate={onRelease}
        />
      ) : null}

      {/* Title + hint — top center, pointer-inert. */}
      {/* This overlay fills a transparent full-screen <Modal>, so it paints
          under the notch and the home indicator — the screen's ScreenHeader,
          which is where the app normally applies insets.top, is not in this
          tree. Both edges therefore add the inset themselves. */}
      <View style={[styles.hintWrap, { top: insets.top + SPACING.xl }]} pointerEvents="none">
        <View style={styles.hintPill}>
          <Text style={styles.titleText}>{t('v2.nc.rules.editor.customZones.title', { name: deviceName })}</Text>
          <Text style={styles.hintText}>{t('v2.nc.rules.editor.customZones.hint')}</Text>
        </View>
      </View>

      {/* Floating actions — bottom. `box-none` so drags between buttons still
          reach the drawing surface. */}
      <View style={[styles.actions, { bottom: insets.bottom + SPACING.xl }]} pointerEvents="box-none">
        <Pressable style={styles.button} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('v2.nc.rules.editor.customZones.cancel')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, verts.length === 0 && styles.buttonDisabled]}
          onPress={clear}
          disabled={verts.length === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: verts.length === 0 }}
        >
          <Text style={styles.buttonText}>{t('v2.nc.rules.editor.customZones.clear')}</Text>
        </Pressable>
        {!closed ? (
          <Pressable
            style={[styles.button, !confirmEnabled && styles.buttonDisabled]}
            onPress={closeLoop}
            disabled={!confirmEnabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !confirmEnabled }}
          >
            <Text style={styles.buttonText}>{t('v2.nc.rules.editor.customZones.close')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[
            styles.button,
            confirmEnabled && { backgroundColor: colors.primary, borderColor: colors.primary },
            !confirmEnabled && styles.buttonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!confirmEnabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !confirmEnabled }}
        >
          <Text style={[styles.buttonText, confirmEnabled && { color: colors.primaryForeground }]}>
            {t('v2.nc.rules.editor.customZones.confirm')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    zIndex: 60,
    backgroundColor: OVERLAY_BACKDROP,
  },
  loadingWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: {
    color: OVERLAY_FG,
    fontSize: 12,
    fontWeight: '600',
  },
  hintWrap: {
    position: 'absolute',
    top: SPACING.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintPill: {
    backgroundColor: OVERLAY_PILL_BG,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.lg,
    maxWidth: '92%',
    gap: 2,
  },
  titleText: {
    color: OVERLAY_FG,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  hintText: {
    color: OVERLAY_FG,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    opacity: 0.85,
  },
  actions: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  button: {
    backgroundColor: OVERLAY_PILL_BG,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: OVERLAY_FG,
    fontSize: 12,
    fontWeight: '700',
  },
})
