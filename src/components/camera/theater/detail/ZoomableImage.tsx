/**
 * ZoomableImage — a universal pinch / wheel zoomable container for the detail
 * gallery hero. Whatever it wraps (a full-frame Image + BoundingBoxOverlay, or a
 * stand-alone crop Image) is transformed as ONE node, so bounding boxes scale and
 * pan together with the image for free — no per-zoom re-projection.
 *
 * Interaction, per platform:
 *   • mobile — pinch to zoom (focal-point), one-finger pan once zoomed, double-tap
 *     to toggle 1× ⇄ 2× / reset.
 *   • web    — mouse-wheel to zoom, drag to pan, double-click to toggle / reset
 *     (the pan gesture + double-tap gesture both fire for mouse on web; the wheel
 *     is bridged from the host node).
 *
 * The zoom/pan MATH lives in the pure, unit-tested `zoom-math` module; this file
 * is the reanimated + gesture-handler wiring. It mirrors the live-view
 * `useStreamZoom` focal/clamp model rather than forking a new one.
 *
 * Every gesture callback is a worklet and the only output is a transform on
 * ONE Animated.View — nothing here touches React state or layout per frame.
 * What used to make the gesture jerky was outside the callbacks: the picture
 * lives inside a vertical ScrollView, and on iOS the UIScrollView's own pan
 * recognizer accepts the same touches (two fingers included). No relation was
 * declared between the two, so whichever recognizer began first won the touch
 * — a pinch whose fingers landed a few ms apart scrolled the page instead, and
 * a pinch that did win was fighting a scroll view that had already moved the
 * content. `hostScroll` is that relation: the host wraps its ScrollView in a
 * `Gesture.Native()` and hands it here, and the pinch/pan block it.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler'
import { ImageOff } from '../../../../lib/icons.js'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { RenderErrorBoundary } from '../../../ui/RenderErrorBoundary.js'
import { focalPan, nextZoomStep } from '../../../../live/zoom-steps.js'
import {
  clampPanContent,
  clampZoom,
  containBox,
  MIN_ZOOM,
  resolvePanActivation,
  zoomBy,
} from './zoom-math.js'

/** A host node that can receive DOM wheel events (web only). Typed loosely so the
 *  file compiles without the DOM lib. */
interface WheelTarget {
  addEventListener(type: 'wheel', listener: (ev: { deltaY: number; preventDefault: () => void }) => void, opts?: { passive?: boolean }): void
  removeEventListener(type: 'wheel', listener: (ev: { deltaY: number; preventDefault: () => void }) => void): void
}

export interface ZoomableImageProps {
  readonly width: number
  readonly height: number
  /** Changing this resets the zoom (e.g. when the active gallery item changes). */
  readonly resetKey: string
  /**
   * Aspect ratio (width / height) of the RENDERED content, so the pan clamp
   * references the letterboxed content box (the wrapped image uses
   * `contentFit="contain"`) rather than the element box — pan then reaches the
   * image edges with no over-pan into the letterbox gutter. Omit when the
   * content fills the box exactly (e.g. a 16:9 `cover` thumbnail in a 16:9 box);
   * the clamp then degrades to the plain element-box bound.
   */
  readonly contentAspect?: number
  /**
   * The `Gesture.Native()` the host wrapped its scrolling ancestor in, when the
   * picture sits inside a ScrollView. The pinch and the zoomed pan BLOCK it
   * (`blocksExternalGesture`): the scroll view waits for them to fail before
   * it may begin, so a pinch never has the page moving underneath it. At 1×
   * the pan fails on the first move and the page scrolls as before. Omit when
   * nothing scrolls around the picture.
   */
  readonly hostScroll?: GestureType
  readonly children: React.ReactNode
}

export const ZoomableImage = memo(function ZoomableImage({
  width,
  height,
  resetKey,
  contentAspect,
  hostScroll,
  children,
}: ZoomableImageProps) {
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  const pinchStart = useSharedValue(1)
  /** Focal point where the pinch STARTED — the anchor the picture is held by.
   *  See `focalPan`: re-reading the live focal as the anchor re-anchors the
   *  gesture every frame and the picture drifts off the grabbed point. */
  const pinchFocalX = useSharedValue(0)
  const pinchFocalY = useSharedValue(0)
  const w = useSharedValue(0)
  const h = useSharedValue(0)
  // Rendered content aspect (w/h); 0 → unknown → clamp falls back to the box.
  const aspect = useSharedValue(0)
  /** Where the one-finger touch went down, and whether the pan has already
   *  decided (activated or failed) for this touch — the decision is made once. */
  const panDownX = useSharedValue(0)
  const panDownY = useSharedValue(0)
  const panDecided = useSharedValue(false)

  const containerRef = useRef<View>(null)

  // The scroll view the gestures below must hold still, as a relation list
  // (`blocksExternalGesture` is variadic; no host → nothing to block).
  const blocked = useMemo<readonly GestureType[]>(
    () => (hostScroll === undefined ? [] : [hostScroll]),
    [hostScroll],
  )

  useEffect(() => {
    aspect.value = typeof contentAspect === 'number' && contentAspect > 0 ? contentAspect : 0
  }, [contentAspect, aspect])

  // Reset when the shown item changes — a fresh image always starts at 1×.
  useEffect(() => {
    scale.value = 1
    savedScale.value = 1
    tx.value = 0
    ty.value = 0
    savedTx.value = 0
    savedTy.value = 0
  }, [resetKey, scale, savedScale, tx, ty, savedTx, savedTy])

  const onLayout = useCallback(
    (e: LayoutChangeEvent): void => {
      w.value = e.nativeEvent.layout.width
      h.value = e.nativeEvent.layout.height
    },
    [w, h],
  )

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          pinchStart.value = savedScale.value
          pinchFocalX.value = e.focalX
          pinchFocalY.value = e.focalY
        })
        .onUpdate((e) => {
          const vw = w.value
          const vh = h.value
          if (vw <= 0 || vh <= 0) return
          // Guard against a NaN focal point — a non-finite transform faults Fabric.
          if (!Number.isFinite(e.focalX) || !Number.isFinite(e.focalY) || !Number.isFinite(e.scale)) return
          const s0 = pinchStart.value
          const s1 = clampZoom(s0 * e.scale)
          scale.value = s1
          if (s1 <= MIN_ZOOM) {
            tx.value = 0
            ty.value = 0
            return
          }
          // Focal zoom: the point grabbed where the pinch STARTED stays under
          // the finger midpoint as it travels. The SAME `focalPan` the live
          // player uses — this file re-derived it with the LIVE focal on both
          // sides, which re-anchors every frame and leaves the picture off the
          // point that was grabbed.
          // Clamp against the letterbox-aware content box (matches embed
          // zoom-clamp / zoom-math): |pan| <= (scale*contentDim - boxDim)/2.
          const cw = aspect.value > 0 ? Math.min(vw, vh * aspect.value) : vw
          const ch = aspect.value > 0 ? Math.min(vh, vw / aspect.value) : vh
          const limX = Math.max(0, (s1 * cw - vw) / 2)
          const limY = Math.max(0, (s1 * ch - vh) / 2)
          const ptx = focalPan({
            focalNow: e.focalX,
            focalStart: pinchFocalX.value,
            center: vw / 2,
            panStart: savedTx.value,
            scaleStart: s0,
            scaleAfter: s1,
          })
          const pty = focalPan({
            focalNow: e.focalY,
            focalStart: pinchFocalY.value,
            center: vh / 2,
            panStart: savedTy.value,
            scaleStart: s0,
            scaleAfter: s1,
          })
          tx.value = Math.max(-limX, Math.min(limX, ptx))
          ty.value = Math.max(-limY, Math.min(limY, pty))
        })
        .onEnd(() => {
          savedScale.value = scale.value
          savedTx.value = tx.value
          savedTy.value = ty.value
        })
        // The host scroll view waits for this pinch to fail before it may
        // scroll: two fingers on the picture are a zoom, never a page scroll.
        .blocksExternalGesture(...blocked),
    [pinchStart, pinchFocalX, pinchFocalY, savedScale, w, h, aspect, scale, tx, ty, savedTx, savedTy, blocked],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        // Activation is DECIDED, not automatic: `resolvePanActivation` fails
        // the pan at 1× (the page scrolls) and activates it once zoomed after
        // PAN_MIN_DISTANCE. An auto-activating pan claimed every drag at any
        // scale, which blocked the host scroll on the picture and left it
        // competing with the pinch.
        .manualActivation(true)
        .onTouchesDown((e) => {
          const t = e.allTouches[0]
          if (t === undefined) return
          panDownX.value = t.x
          panDownY.value = t.y
          panDecided.value = false
        })
        .onTouchesMove((e, state) => {
          if (panDecided.value) return
          const t = e.allTouches[0]
          if (t === undefined) return
          const decision = resolvePanActivation({
            scale: scale.value,
            dx: t.x - panDownX.value,
            dy: t.y - panDownY.value,
          })
          if (decision === 'wait') return
          panDecided.value = true
          if (decision === 'activate') state.activate()
          else state.fail()
        })
        .onUpdate((e) => {
          if (scale.value <= MIN_ZOOM) return
          if (!Number.isFinite(e.translationX) || !Number.isFinite(e.translationY)) return
          const s = scale.value
          const vw = w.value
          const vh = h.value
          const cw = aspect.value > 0 ? Math.min(vw, vh * aspect.value) : vw
          const ch = aspect.value > 0 ? Math.min(vh, vw / aspect.value) : vh
          const limX = Math.max(0, (s * cw - vw) / 2)
          const limY = Math.max(0, (s * ch - vh) / 2)
          tx.value = Math.max(-limX, Math.min(limX, savedTx.value + e.translationX))
          ty.value = Math.max(-limY, Math.min(limY, savedTy.value + e.translationY))
        })
        .onEnd(() => {
          savedTx.value = tx.value
          savedTy.value = ty.value
        })
        // Zoomed: the picture pans and the page holds still. At 1× the pan
        // has failed by now, so the scroll view is free to take the drag.
        .blocksExternalGesture(...blocked),
    [scale, w, h, aspect, tx, ty, savedTx, savedTy, panDownX, panDownY, panDecided, blocked],
  )

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(300)
        .onEnd((e) => {
          // The SAME ladder the live player climbs (1x -> 2x -> 3x -> 4x -> 1x),
          // anchored ON THE TAP. It used to be a 1x/2x toggle that zoomed about
          // the CENTRE, so the detail an operator double-tapped was pushed off
          // screen by the very gesture meant to inspect it.
          const next = nextZoomStep(scale.value)
          if (next <= MIN_ZOOM) {
            scale.value = withTiming(MIN_ZOOM)
            tx.value = withTiming(0)
            ty.value = withTiming(0)
            savedScale.value = MIN_ZOOM
            savedTx.value = 0
            savedTy.value = 0
            return
          }
          const vw = w.value
          const vh = h.value
          const box = containBox(vw, vh, aspect.value)
          const nx = clampPanContent(
            focalPan({
              focalNow: e.x,
              focalStart: e.x,
              center: vw / 2,
              panStart: tx.value,
              scaleStart: scale.value,
              scaleAfter: next,
            }),
            vw,
            box.width,
            next,
          )
          const ny = clampPanContent(
            focalPan({
              focalNow: e.y,
              focalStart: e.y,
              center: vh / 2,
              panStart: ty.value,
              scaleStart: scale.value,
              scaleAfter: next,
            }),
            vh,
            box.height,
            next,
          )
          scale.value = withTiming(next)
          savedScale.value = next
          tx.value = withTiming(nx)
          savedTx.value = nx
          ty.value = withTiming(ny)
          savedTy.value = ny
        }),
    [scale, tx, ty, savedScale, savedTx, savedTy, w, h, aspect],
  )

  const gesture = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [pinch, pan, doubleTap],
  )

  // Web-only: bridge the mouse wheel to a zoom around the content center, then
  // re-clamp the pan so the edges stay pinned at the new scale.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const node = containerRef.current as unknown as WheelTarget | null
    if (node === null || typeof node.addEventListener !== 'function') return
    const onWheel = (ev: { deltaY: number; preventDefault: () => void }): void => {
      ev.preventDefault()
      const next = zoomBy(scale.value, ev.deltaY < 0 ? 1.12 : 1 / 1.12)
      scale.value = next
      savedScale.value = next
      const box = containBox(w.value, h.value, aspect.value)
      tx.value = clampPanContent(tx.value, w.value, box.width, next)
      ty.value = clampPanContent(ty.value, h.value, box.height, next)
      savedTx.value = tx.value
      savedTy.value = ty.value
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [scale, savedScale, tx, ty, savedTx, savedTy, w, h, aspect])

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  // A render failure in the wrapped image (e.g. an oversized/corrupt frame the
  // decoder rejects) falls back to a placeholder instead of crashing the app.
  const fallback = (
    <View style={[styles.fallback, { width, height }]}>
      <ImageOff size={40} color="#6b7280" />
    </View>
  )

  return (
    <View ref={containerRef} onLayout={onLayout} style={[styles.container, { width, height }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, contentStyle]}>
          <RenderErrorBoundary resetKey={resetKey} fallback={fallback}>
            {children}
          </RenderErrorBoundary>
        </Animated.View>
      </GestureDetector>
    </View>
  )
})

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#000' },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
})
