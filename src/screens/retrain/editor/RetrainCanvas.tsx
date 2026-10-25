/**
 * RetrainCanvas — the frame, its boxes, and every touch that edits them.
 *
 * Layers, bottom to top:
 *  1. the frame (`contain`) inside a View scaled / translated by the viewport;
 *  2. an SVG overlay in SCREEN pixels (strokes and corner handles keep their
 *     size at every zoom) — boxes, removed ghosts, the "was here" ghost;
 *  3. label chips (class, source glyph), pointer-transparent.
 * A single GestureDetector owns the touches: two fingers zoom and pan, a
 * one-finger pan edits the selected box (corner = resize, body = move), draws a
 * new one in "add box" mode, or pans the picture once zoomed; a tap selects the
 * smallest box under it at once (a double tap also zooms, so a tap never waits
 * for it). Which of those a drag is, and what each finger position makes of it,
 * is the pure `retrain/canvas-gesture.ts`; the geometry is `retrain/viewport.ts`.
 *
 * Every callback runs on the JS thread (`runOnJS`), so the pan activates on its
 * own `minDistance` and never through the touch-event state manager: on native
 * that manager is Reanimated's `setGestureState`, which only works inside a UI
 * worklet and is a logged no-op from the JS runtime — the pan never activated on
 * a phone, so no box could be drawn, moved or resized there (the web build has
 * its own manager, which is why a browser never showed it).
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Image } from 'expo-image'
import Svg, { Circle, Rect } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import type { HubImageSource } from '../../../components/camera/theater/hub-image-source.js'
import { displayedImageRect, type NormBox } from '../../../retrain/boxes.js'
import {
  committedDraw,
  decideCanvasDrag,
  dragStep,
  NO_DRAG,
  tapTarget,
  type CanvasBox,
  type CanvasDrag,
} from '../../../retrain/canvas-gesture.js'
import { boxLook, DIMMED_OPACITY, EMPHASIS_EXTRA, ORIGIN_GHOST_OPACITY } from '../../../retrain/box-look.js'
import type { SubjectRow } from '../../../retrain/rows.js'
import {
  boxToScreen,
  clampViewport,
  cornerPoint,
  CORNERS,
  normToScreen,
  pinchViewport,
  zoomAt,
  type Point,
  type Size,
  type Viewport,
} from '../../../retrain/viewport.js'
import { RetrainSourceIcon } from './RetrainSourceIcon.js'

const HANDLE_RADIUS = 7
const DOUBLE_TAP_SCALE = 2.5
/** A one-finger drag must travel this far before it is a drag and not a tap. */
const PAN_ACTIVATE_PX = 6

export interface RetrainCanvasProps {
  readonly source: HubImageSource | null
  /** The frame's pixel size — the aspect the picture is fitted by. */
  readonly imageSize: Size
  readonly rows: readonly SubjectRow[]
  readonly selectedKey: string | null
  /** A list row under the pointer: its box is emphasised, the others dimmed. */
  readonly hoverKey: string | null
  readonly drawMode: boolean
  readonly viewport: Viewport
  readonly onViewportChange: (next: Viewport) => void
  readonly onContainerSize: (size: Size) => void
  readonly onSelect: (key: string | null) => void
  /** A gesture on a box starts / moves / ends: one undo step. */
  readonly onEditStart: () => void
  readonly onEdit: (key: string, bbox: NormBox) => void
  readonly onEditEnd: () => void
  readonly onDraw: (bbox: NormBox) => void
  readonly onImageError?: () => void
}

export const RetrainCanvas = memo(function RetrainCanvas(props: RetrainCanvasProps) {
  const {
    source,
    imageSize,
    rows,
    selectedKey,
    hoverKey,
    drawMode,
    viewport,
    onViewportChange,
    onContainerSize,
    onSelect,
    onEditStart,
    onEdit,
    onEditEnd,
    onDraw,
    onImageError,
  } = props
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [container, setContainer] = useState<Size>({ w: 0, h: 0 })
  const [draft, setDraft] = useState<NormBox | null>(null)
  /** The rectangle being drawn, readable by the release without a state updater. */
  const draftRef = useRef<NormBox | null>(null)

  const img = useMemo(
    () => displayedImageRect(container.w, container.h, imageSize.w, imageSize.h),
    [container, imageSize],
  )

  // The gesture callbacks read the latest props through one ref, so the
  // gesture objects are stable across the re-renders a drag causes.
  const live = useRef({ rows, selectedKey, drawMode, viewport, img, container })
  live.current = { rows, selectedKey, drawMode, viewport, img, container }
  const drag = useRef<CanvasDrag>(NO_DRAG)
  /** Whether the current one-finger drag has activated (passed `minDistance`). */
  const dragActive = useRef(false)
  const down = useRef<Point>({ x: 0, y: 0 })
  const pinchStart = useRef<{ readonly viewport: Viewport; readonly focal: Point }>({
    viewport,
    focal: { x: 0, y: 0 },
  })

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }
      setContainer(next)
      onContainerSize(next)
    },
    [onContainerSize],
  )

  // Keep the viewport legal when the container or the picture changes size.
  useEffect(() => {
    if (img === null) return
    const clamped = clampViewport(viewport, container, img)
    if (clamped.tx !== viewport.tx || clamped.ty !== viewport.ty || clamped.scale !== viewport.scale) {
      onViewportChange(clamped)
    }
  }, [container, img, viewport, onViewportChange])

  /** Ends whatever a one-finger drag was doing; a draw is committed only when `commit`. */
  const finishDrag = useCallback(
    (commit: boolean) => {
      const d = drag.current
      const wasActive = dragActive.current
      drag.current = NO_DRAG
      dragActive.current = false
      // An edit opened an undo step only if the pan activated (`onStart`).
      if (d.kind === 'edit' && wasActive) onEditEnd()
      if (d.kind === 'draw') {
        const box = commit ? committedDraw(draftRef.current) : null
        draftRef.current = null
        setDraft(null)
        if (box !== null) onDraw(box)
      }
    },
    [onEditEnd, onDraw],
  )

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart((e) => {
          // A second finger takes over: the one-finger edit ends where it is,
          // a half-drawn box is dropped, a pan stops.
          finishDrag(false)
          pinchStart.current = { viewport: live.current.viewport, focal: { x: e.focalX, y: e.focalY } }
        })
        .onUpdate((e) => {
          const { img: rect, container: c } = live.current
          if (rect === null || !Number.isFinite(e.scale)) return
          const { viewport: base, focal } = pinchStart.current
          onViewportChange(pinchViewport(base, e.scale, focal, { x: e.focalX, y: e.focalY }, c, rect))
        }),
    [finishDrag, onViewportChange],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .maxPointers(1)
        .minDistance(PAN_ACTIVATE_PX)
        .onBegin((e) => {
          // Decided at touch-down, from what was under the finger then.
          const { rows: rs, selectedKey: sel, drawMode: draw, viewport: vp, img: rect, container: c } =
            live.current
          down.current = { x: e.x, y: e.y }
          dragActive.current = false
          drag.current = decideCanvasDrag({
            touch: down.current,
            drawMode: draw,
            selected: liveBoxesOf(rs).find((b) => b.key === sel) ?? null,
            viewport: vp,
            container: c,
            img: rect,
          })
        })
        .onStart(() => {
          dragActive.current = true
          if (drag.current.kind === 'edit') onEditStart()
        })
        .onUpdate((e) => {
          const { viewport: vp, img: rect, container: c } = live.current
          const step = dragStep(drag.current, down.current, { x: e.x, y: e.y }, vp, c, rect)
          if (step.kind === 'edit') onEdit(step.key, step.bbox)
          else if (step.kind === 'draw') {
            draftRef.current = step.box
            setDraft(step.box)
          } else if (step.kind === 'view') onViewportChange(step.viewport)
        })
        // A cancelled pan (`success` false) never commits a half-drawn box.
        .onEnd((_e, success) => finishDrag(success))
        .onFinalize(() => finishDrag(false)),
    [finishDrag, onViewportChange, onEditStart, onEdit],
  )

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDuration(300)
        // A finger that travelled as far as a drag activates is not a tap.
        .maxDistance(PAN_ACTIVATE_PX)
        .onEnd((e, success) => {
          if (!success) return
          const { rows: rs, viewport: vp, img: rect, container: c } = live.current
          if (rect === null) return
          onSelect(tapTarget(liveBoxesOf(rs), { x: e.x, y: e.y }, vp, c, rect))
        }),
    [onSelect],
  )

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .numberOfTaps(2)
        .maxDuration(300)
        .maxDistance(PAN_ACTIVATE_PX)
        .onEnd((e, success) => {
          if (!success) return
          const { viewport: vp, img: rect, container: c } = live.current
          if (rect === null) return
          const next = vp.scale > 1 ? 1 : DOUBLE_TAP_SCALE
          onViewportChange(zoomAt(vp, next, { x: e.x, y: e.y }, c, rect))
        }),
    [onViewportChange],
  )

  const gesture = useMemo(
    () => Gesture.Simultaneous(pinch, Gesture.Race(pan, Gesture.Simultaneous(tap, doubleTap))),
    [pinch, pan, doubleTap, tap],
  )

  // Web: the wheel zooms about the pointer.
  const wheelRef = useRef<View>(null)
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined
    const node = wheelRef.current as unknown as {
      addEventListener?: (t: 'wheel', l: (ev: WheelLike) => void, o?: { passive: boolean }) => void
      removeEventListener?: (t: 'wheel', l: (ev: WheelLike) => void) => void
      getBoundingClientRect?: () => { left: number; top: number }
    } | null
    if (node === null || typeof node.addEventListener !== 'function') return undefined
    const onWheel = (ev: WheelLike): void => {
      const { viewport: vp, img: rect, container: c } = live.current
      if (rect === null) return
      ev.preventDefault()
      const origin = node.getBoundingClientRect?.() ?? { left: 0, top: 0 }
      const focal = { x: ev.clientX - origin.left, y: ev.clientY - origin.top }
      onViewportChange(zoomAt(vp, vp.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), focal, c, rect))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener?.('wheel', onWheel)
  }, [onViewportChange])

  const emphasised = hoverKey ?? selectedKey
  const transform = [
    { translateX: viewport.tx },
    { translateY: viewport.ty },
    { scale: viewport.scale },
  ]

  return (
    <View
      ref={wheelRef}
      onLayout={onLayout}
      style={[styles.root, { backgroundColor: colors.background }]}
      testID="retrain-canvas"
    >
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { transform }]} pointerEvents="none">
            {source !== null ? (
              <Image
                source={source}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory-disk"
                onError={onImageError}
              />
            ) : null}
          </View>
          {img !== null ? (
            <Svg
              width={container.w}
              height={container.h}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            >
              {rows.map((row) => {
                const kind = row.type === 'removed' ? 'removed' : row.diff.kind
                const look = boxLook(kind)
                const bbox = row.type === 'removed' ? row.ghost.bbox : row.box.bbox
                const r = boxToScreen(bbox, viewport, container, img)
                const isSel = row.type === 'box' && row.key === selectedKey
                const isEmph = row.key === emphasised
                const dim = emphasised !== null && !isEmph
                const dash = look.strokeStyle === 'dashed' ? '8 5' : look.strokeStyle === 'dotted' ? '2 5' : undefined
                const origin =
                  row.type === 'box' && row.diff.originBbox !== undefined && row.diff.kind !== 'unchanged'
                    ? boxToScreen(row.diff.originBbox, viewport, container, img)
                    : null
                return (
                  <React.Fragment key={row.key}>
                    {origin !== null ? (
                      <Rect
                        x={origin.left}
                        y={origin.top}
                        width={origin.width}
                        height={origin.height}
                        fill="none"
                        stroke={colors[look.stroke]}
                        strokeWidth={1}
                        strokeDasharray="3 4"
                        opacity={ORIGIN_GHOST_OPACITY * (dim ? DIMMED_OPACITY : 1)}
                      />
                    ) : null}
                    <Rect
                      x={r.left}
                      y={r.top}
                      width={r.width}
                      height={r.height}
                      fill={isSel ? `${colors[look.stroke]}22` : 'none'}
                      stroke={colors[look.stroke]}
                      strokeWidth={look.strokeWidth + (isEmph ? EMPHASIS_EXTRA : 0)}
                      strokeDasharray={dash}
                      opacity={dim ? DIMMED_OPACITY : 1}
                    />
                  </React.Fragment>
                )
              })}
              {draft !== null
                ? (() => {
                    const r = boxToScreen(draft, viewport, container, img)
                    return (
                      <Rect
                        x={r.left}
                        y={r.top}
                        width={r.width}
                        height={r.height}
                        fill={`${colors.primary}22`}
                        stroke={colors.primary}
                        strokeWidth={2}
                        strokeDasharray="8 5"
                      />
                    )
                  })()
                : null}
              {rows.map((row) => {
                if (row.type !== 'box' || row.key !== selectedKey) return null
                const look = boxLook(row.diff.kind)
                return CORNERS.map((corner) => {
                  const p = normToScreen(cornerPoint(row.box.bbox, corner), viewport, container, img)
                  return (
                    <Circle
                      key={`${row.key}:${corner}`}
                      cx={p.x}
                      cy={p.y}
                      r={HANDLE_RADIUS}
                      fill={colors.background}
                      stroke={colors[look.stroke]}
                      strokeWidth={2}
                    />
                  )
                })
              })}
            </Svg>
          ) : null}
          {img !== null ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {rows.map((row) => {
                const kind = row.type === 'removed' ? 'removed' : row.diff.kind
                const look = boxLook(kind)
                const bbox = row.type === 'removed' ? row.ghost.bbox : row.box.bbox
                const source2 = row.type === 'removed' ? row.ghost.source : row.box.source
                const text =
                  row.type === 'removed'
                    ? row.ghost.label
                    : (row.box.label ?? t(`v2.retrain.class.${row.box.macroClass}`, row.box.macroClass))
                const r = boxToScreen(bbox, viewport, container, img)
                if (r.width < 28 || r.height < 18) return null
                const outline = look.badgeLook === 'outline'
                const bg = outline ? colors.background : colors[`${look.tone}Fill`]
                const fg = outline ? colors[look.stroke] : colors[`${look.tone}On`]
                return (
                  <View
                    key={`tag:${row.key}`}
                    style={[
                      styles.tag,
                      {
                        left: r.left,
                        top: Math.max(0, r.top - TAG_HEIGHT),
                        backgroundColor: bg,
                        borderColor: colors[look.stroke],
                        opacity: emphasised !== null && row.key !== emphasised ? DIMMED_OPACITY : 1,
                      },
                    ]}
                  >
                    <RetrainSourceIcon source={source2} size={10} color={fg} />
                    <Text style={[styles.tagText, { color: fg }]} numberOfLines={1}>
                      {text}
                    </Text>
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  )
})

/** The live (non-ghost) boxes a touch can hit. */
function liveBoxesOf(rows: readonly SubjectRow[]): readonly CanvasBox[] {
  return rows.flatMap((r) => (r.type === 'box' ? [{ key: r.key, bbox: r.box.bbox }] : []))
}

interface WheelLike {
  readonly deltaY: number
  readonly clientX: number
  readonly clientY: number
  preventDefault(): void
}

const TAG_HEIGHT = 18

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  tag: {
    position: 'absolute',
    height: TAG_HEIGHT,
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
  },
  tagText: { fontSize: TYPOGRAPHY.size.xs - 1, fontWeight: TYPOGRAPHY.weight.bold },
})
