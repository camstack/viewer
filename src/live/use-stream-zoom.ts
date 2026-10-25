/**
 * useStreamZoom — progressive focal-point pinch + clamped pan for the live
 * stream (iPhone/iPad progressive path; the Mac-Catalyst discrete-step branch
 * of V1's `use-stream-zoom-native` was dropped to stay lean).
 *
 * Transform: screen_x = s*(x - w/2) + w/2 + panX, with the content edges pinned
 * inside the viewport (`stream-zoom-clamp`). pan only engages once zoomed in.
 *
 * The hook OWNS the pinch + pan gesture and the `scale`/`tx`/`ty` shared
 * values. It does NOT own a viewport: the screen hands it one, as a width and a
 * `heightFor(scale)` rule, because the screen is the one thing that decides how
 * tall the picture box is (`pinchExpandsHeight`). One size, one source — the
 * hook never measures a box of its own.
 *
 * On iOS the picture is a WKWebView, and that decides the shape of this file:
 *
 *   - A `transform` on the wrapper is composited on the GPU. A change to the
 *     wrapper's FRAME is a WebKit re-layout, an IPC to the content process and
 *     a `fit()` into the page. So the wrapper stays at its REST size and the
 *     box's growth is folded into the transform (`zoom-render.ts`): the box
 *     grows under the fingers, the player's frame never changes, and the
 *     clamp and the anchor are those of the box of THIS frame. Two earlier
 *     designs failed on exactly this axis — a box that grew per frame and was
 *     measured back through `onLayout` (the WebView re-laid-out every frame,
 *     then a "frozen viewport" and a "settle" were bolted on to hide the
 *     loop), and a box that grew AFTER the release, animated on the committed
 *     scale (the picture kept going once the fingers had lifted — "continua a
 *     ritornare in avanti", 1.0.478).
 *   - Everything a gesture needs is on the UI thread, so it stays there. The
 *     double tap is a worklet; a shared value written from JS is
 *     `scheduleOnUI` while a read is synchronous, so no JS-side "write then
 *     read back" pair exists here.
 *
 * The screen consumes:
 *   - `videoStyle`      — the animated RENDER transform for the wrapper
 *                         `Animated.View` (growth folded in);
 *   - `scale`           — the live pinch progress; the screen derives the box
 *                         height from it with the SAME `heightFor` rule;
 *   - `committedScale`  — the scale a gesture LEFT behind (pinch start, trace);
 *   - `composeWith`     — wraps pinch+pan in a `Simultaneous` with the screen's
 *                         own tap / double-tap / fling gestures;
 *   - `doubleTapZoomAt` — the double tap, a worklet (call it from the tap's
 *                         `onEnd` directly): whole picture → fill the player,
 *                         anything else → whole picture;
 *   - `resetZoom`       — animate back to 1× (fill transitions);
 *   - `snapZoom`        — drop the transform instantly (window changes — the
 *                         hook cannot see one, the screen drives it);
 *   - `traceBox`        — the height the screen actually drew, into the trace.
 *
 * The result is ONE object for the life of the component. The screen keys its
 * gesture tree on it, and a fresh object per render rebuilt five gestures per
 * render: Gesture Handler then reconfigured five native handlers and re-shipped
 * every worklet to the UI thread on every re-render. Neither this hook nor the
 * screen is compiled by the React Compiler (both bail out on shared-value
 * writes), so the `useMemo` at the bottom is the only memo there is.
 */
import { useCallback, useMemo } from 'react'
import { clampPan, streamPanExtent, type StreamFit } from './stream-zoom-clamp.js'
import { focalPan, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS } from './zoom-steps.js'
import { coverScale, doubleTapTarget } from '../../shared/zoom/double-tap-zoom.js'
import { foldGrowth } from './zoom-render.js'
import { tapStepAccepted } from './zoom-tap-gate.js'
import {
  beginZoomTrace,
  formatZoomTrace,
  newZoomTraceBuffer,
  pushZoomSample,
  takeZoomTrace,
  zoomTraceElapsed,
  type ZoomTraceBuffer,
  type ZoomTracePhase,
  type ZoomTraceSample,
} from './zoom-trace.js'
import { log } from '../lib/logger.js'
import { guardWorklet } from '../lib/worklet-guard.js'
import type { ViewStyle } from 'react-native'
import {
  Gesture,
  type ComposedGesture,
  type GestureType,
  type SimultaneousGesture,
} from 'react-native-gesture-handler'
import {
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'

/** Pinch clamp bounds — the SAME range the double tap zooms within, so the
 *  two gestures cannot disagree about how far the picture goes. */
const MIN_SCALE = ZOOM_MIN
const MAX_SCALE = ZOOM_MAX
/** Below this viewport size the geometry is not settled; the gesture waits. */
const MIN_VIEWPORT = 10
/**
 * The video renders `object-fit: contain` (fill / wide) or is cover-cropped
 * (the stacked box); either way the pan clamps to the RENDERED content box,
 * which needs the content aspect. The hub's cameras are 16:9 unless told
 * otherwise.
 */
const DEFAULT_CONTENT_ASPECT = 16 / 9

/**
 * The box the picture is drawn in, as the SCREEN decides it.
 *
 * `heightFor` is a worklet: it is called inside the gesture handlers on the UI
 * thread, every frame, with the LIVE scale, and must be pure — the same number
 * for the same scale. With `pinchExpandsHeight` off it is a constant; with it
 * on it is the grow rule the box follows under the fingers. `heightFor(1)` is
 * the wrapper's fixed size, the box at rest.
 */
export interface StreamZoomViewport {
  readonly width: number
  readonly heightFor: (scale: number) => number
}

export interface StreamZoomOptions {
  readonly contentAspect?: number
  /**
   * Record every gesture as a trace (`live:zoom`, debug level) — see
   * `zoom-trace.ts`. Off by default: the screen passes the app's debug mode,
   * the same switch that lets `debug` lines reach the hub at all. When off the
   * gesture handlers take a dead branch and the buffer is never touched.
   */
  readonly trace?: boolean
  /**
   * How the WRAPPER renders the picture. The mobile stacked box uses
   * `videoCoverStyle` (the video overflows and is cropped); fill and wide use
   * an absolute-fill where it letterboxes. Clamping a cover layout against the
   * contain box limited the operator's vertical travel to 108pt where 424 was
   * reachable — measured from their own gesture log.
   */
  readonly fit: StreamFit
  readonly viewport: StreamZoomViewport
}

export interface StreamZoom {
  /** Live pinch scale (1..4). UI-thread readable. */
  readonly scale: SharedValue<number>
  /**
   * The scale the last gesture LEFT behind — set at a pinch end, by a
   * double tap, by reset/snap. A pinch starts from it; the trace reports
   * it beside the live one.
   */
  readonly committedScale: SharedValue<number>
  /** Animated RENDER transform for the video wrapper: the pinch plus the box's
   *  growth folded in, so the wrapper itself never changes size. */
  readonly videoStyle: AnimatedStyle<ViewStyle>
  /** Animate back to 1× and recenter. Callable from either thread. */
  readonly resetZoom: () => void
  /**
   * The double tap — a worklet, to be called from the tap gesture's `onEnd`
   * without `runOnJS` (`shared/zoom/double-tap-zoom.ts` decides).
   *
   * At the whole picture it zooms IN to the scale that fills the player (no
   * letterbox or pillarbox bars), or to the first fixed step when the picture
   * already fills it, anchored on the TAP: a zoom about the centre walks the
   * thing being inspected off screen — the operator taps the doorway and the
   * doorway is what must stay put. Above the whole picture, by any amount, it
   * goes back to it, pan reset. Coordinates are viewport-relative (a tap
   * gesture's `x`/`y`).
   */
  readonly doubleTapZoomAt: (x: number, y: number) => void
  /**
   * Drop the transform INSTANTLY (no animation).
   *
   * Call this when the viewport changes — a rotation, entering or leaving
   * fill. The retained pan was clamped against the OLD box and is meaningless
   * in the new one, and it corrupts any `measure()` taken beneath this
   * transform, which is how a rotation once told the embedded player to
   * become 1279pt wide on a 932pt screen. Driven from a React effect on the
   * window dimensions: the hook cannot see one.
   */
  readonly snapZoom: () => void
  /** Compose the zoom pinch+pan simultaneously with the caller's gestures. */
  readonly composeWith: (...others: (GestureType | ComposedGesture)[]) => SimultaneousGesture
  /**
   * Trace hook for the SCREEN, a worklet: the box height it actually applied,
   * whenever that changes. The box's follow-through after a release is the
   * part of the gesture the hook cannot see, and the operator's "torna in
   * avanti" lives there. A no-op when tracing is off.
   */
  readonly traceBox: (drawnHeight: number) => void
}

/**
 * Gesture diagnostics, JS side, at the END of each gesture — never per frame.
 * The clamp runs inside a WORKLET, so its numbers are otherwise invisible to
 * a developer reading `stream-zoom-clamp.ts` against an operator's "at full
 * zoom I cannot reach the edges". `viewportAspect` vs `contentAspect` is the
 * pair to read first.
 */
function reportZoom(kind: 'pinch' | 'pan', data: Record<string, number>): void {
  log.debug('live:zoom', `zoom ${kind} end`, data)
}

/**
 * How long after a release the trace stays open for the box's follow-through
 * before it is reported. Longer than the default `withTiming` (300 ms) the
 * screen animates the box with; a gesture that starts sooner reports the
 * previous trace itself, so nothing is lost either way.
 */
const TRACE_SETTLE_MS = 600

/** JS side, once per trace: one log entry, one line per sample. */
function reportZoomTrace(kind: string, samples: readonly ZoomTraceSample[]): void {
  if (samples.length === 0) return
  const last = samples[samples.length - 1]
  const span = last === undefined ? 0 : Math.round(last.t)
  log.debug(
    'live:zoom',
    `zoom trace — ${kind}, ${samples.length} samples over ${span} ms\n${formatZoomTrace(samples)}`,
  )
}

const f2 = (n: number): string => {
  'worklet'
  return n.toFixed(2)
}

export function useStreamZoom({
  contentAspect = DEFAULT_CONTENT_ASPECT,
  fit,
  viewport,
  trace = false,
}: StreamZoomOptions): StreamZoom {
  // Destructured so the OPTIONS object may be a fresh literal per render: the
  // gestures depend on the number and the rule, not on the wrapper's identity.
  const { width: viewportWidth, heightFor } = viewport
  const scale = useSharedValue(1)
  const committedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  /** Scale at the start of the active pinch (progressive focal zoom). */
  const pinchStartScale = useSharedValue(1)
  /** Focal point where the pinch STARTED — the anchor the picture is held by.
   *  Re-reading the LIVE focal as the anchor re-anchors the gesture on every
   *  frame: the picture creeps while the fingers drift and, on release, is not
   *  on the point that was grabbed. See `focalPan`. */
  const pinchFocalX = useSharedValue(0)
  const pinchFocalY = useSharedValue(0)

  // ── Trace (debug mode only) ─────────────────────────────────────────────
  // Samples accumulate on the UI thread; they cross to JS once, either when
  // the settle window after a release runs out or when the next gesture
  // begins — whichever comes first — so the box's follow-through after the
  // fingers lift is in the same trace as the pinch that caused it.
  const traceBuf = useSharedValue<ZoomTraceBuffer>(newZoomTraceBuffer())
  const traceKind = useSharedValue('')
  const flushTrace = useCallback((): void => {
    runOnUI((): void => {
      'worklet'
      const samples = takeZoomTrace(traceBuf.value)
      const kind = traceKind.value
      if (samples.length > 0) runOnJS(reportZoomTrace)(kind, samples)
    })()
  }, [traceBuf, traceKind])
  const armTraceFlush = useCallback((): void => {
    setTimeout(flushTrace, TRACE_SETTLE_MS)
  }, [flushTrace])
  /** Open a trace for a new gesture; a trace still open is reported first. */
  const traceBegin = useCallback(
    (kind: string): void => {
      'worklet'
      if (!trace) return
      const pending = takeZoomTrace(traceBuf.value)
      if (pending.length > 0) runOnJS(reportZoomTrace)(traceKind.value, pending)
      traceKind.set(kind)
      beginZoomTrace(traceBuf.value, Date.now())
    },
    [trace, traceBuf, traceKind],
  )
  const traceSample = useCallback(
    (phase: ZoomTracePhase, extra: Partial<ZoomTraceSample>): void => {
      'worklet'
      if (!trace) return
      const buf = traceBuf.value
      if (buf.startedAt === 0) return
      pushZoomSample(buf, {
        t: zoomTraceElapsed(buf, Date.now()),
        phase,
        live: scale.value,
        committed: committedScale.value,
        x: tx.value,
        y: ty.value,
        boxW: viewportWidth,
        boxH: heightFor(scale.value),
        ...extra,
      })
    },
    [trace, traceBuf, scale, committedScale, tx, ty, viewportWidth, heightFor],
  )
  /** Close the gesture's own part of the trace; the settle window reports it. */
  const traceRelease = useCallback((): void => {
    'worklet'
    if (!trace) return
    runOnJS(armTraceFlush)()
  }, [trace, armTraceFlush])
  const traceBox = useCallback(
    (drawnHeight: number): void => {
      'worklet'
      traceSample('box', { drawnH: drawnHeight })
    },
    [traceSample],
  )

  const snapToIdentity = useCallback((): void => {
    scale.set(1)
    committedScale.set(1)
    tx.set(0)
    ty.set(0)
    savedTx.set(0)
    savedTy.set(0)
  }, [scale, committedScale, tx, ty, savedTx, savedTy])

  const resetZoom = useCallback((): void => {
    'worklet'
    scale.set(withTiming(1))
    committedScale.set(1)
    tx.set(withTiming(0))
    ty.set(withTiming(0))
    savedTx.set(0)
    savedTy.set(0)
  }, [scale, committedScale, tx, ty, savedTx, savedTy])

  // When the last pinch released, on the UI thread's clock. Read by the
  // double tap so a finger bouncing off the glass cannot throw away the zoom
  // the operator had just set by hand (`zoom-tap-gate.ts`).
  const lastPinchEndMs = useSharedValue(0)

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(
          guardWorklet('zoom.pinch.start', (e) => {
            'worklet'
            pinchStartScale.set(committedScale.value)
            pinchFocalX.set(e.focalX)
            pinchFocalY.set(e.focalY)
            traceBegin('pinch')
            traceSample('start', { focalX: e.focalX, focalY: e.focalY, pointers: e.numberOfPointers })
          }),
        )
        .onUpdate(
          guardWorklet('zoom.pinch.update', (e) => {
            'worklet'
            // The focal point is the centroid of the fingers STILL down. When the
            // first finger lifts, a last update can arrive with the focal sitting
            // on the remaining finger — half a hand away from the midpoint the
            // picture was anchored to — and the frame jumps toward that finger.
            if (e.numberOfPointers < 2) return
            const w = viewportWidth
            const s0 = pinchStartScale.value
            const s1 = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s0 * e.scale))
            // The box at the start of the pinch and the box THIS frame asks for.
            // Analytic, not measured: the same rule the screen sizes the box
            // with, so the clamp cannot chase a layout.
            const h0 = heightFor(s0)
            const h = heightFor(s1)
            if (w < MIN_VIEWPORT || h < MIN_VIEWPORT) return
            scale.set(s1)
            // FOCAL zoom: the content point grabbed where the pinch STARTED stays
            // under the finger midpoint as it moves — so the pinch also drags the
            // picture, and a release leaves it on the point that was grabbed.
            // The picture scales about the box CENTRE, which moves when the box
            // grows, by the pinch TIMES the growth — hence the two centres and
            // the total scales.
            const ptx = focalPan({
              focalNow: e.focalX,
              focalStart: pinchFocalX.value,
              center: w / 2,
              panStart: savedTx.value,
              scaleStart: s0 * h0,
              scaleAfter: s1 * h,
            })
            const pty = focalPan({
              focalNow: e.focalY,
              focalStart: pinchFocalY.value,
              center: h0 / 2,
              centerAfter: h / 2,
              panStart: savedTy.value,
              scaleStart: s0 * h0,
              scaleAfter: s1 * h,
            })
            const { x: limX, y: limY } = streamPanExtent(w, h, contentAspect, s1, fit)
            const clamped = clampPan({ tx: ptx, ty: pty, w, h, aspect: contentAspect, scale: s1, fit })
            tx.set(clamped.x)
            ty.set(clamped.y)
            traceSample('update', {
              pointers: e.numberOfPointers,
              focalX: e.focalX,
              focalY: e.focalY,
              rawX: ptx,
              rawY: pty,
              limX,
              limY,
            })
          }),
        )
        .onEnd(
          guardWorklet('zoom.pinch.end', () => {
            'worklet'
            // Nothing moves at a release: the box, the clamp and the picture
            // were already those of the last frame. Only the commitment changes.
            const s = scale.value
            const boxBefore = heightFor(committedScale.value)
            committedScale.set(s)
            savedTx.set(tx.value)
            savedTy.set(ty.value)
            const w = viewportWidth
            const h = heightFor(s)
            const { x: limX, y: limY } = streamPanExtent(w, h, contentAspect, s, fit)
            traceSample('end', {
              rawX: tx.value,
              rawY: ty.value,
              limX,
              limY,
              note: boxBefore === h ? undefined : `box ${Math.round(boxBefore)}→${Math.round(h)}`,
            })
            lastPinchEndMs.set(Date.now())
            traceRelease()
            runOnJS(reportZoom)('pinch', {
              viewportW: Math.round(w),
              viewportH: Math.round(h),
              viewportAspect: h > 0 ? Math.round((w / h) * 100) / 100 : 0,
              contentAspect: Math.round(contentAspect * 100) / 100,
              fitCover: fit === 'cover' ? 1 : 0,
              scale: Math.round(s * 100) / 100,
              panExtentX: Math.round(limX),
              panExtentY: Math.round(limY),
              tx: Math.round(tx.value),
              ty: Math.round(ty.value),
            })
          }),
        ),
    [
      pinchStartScale,
      committedScale,
      lastPinchEndMs,
      viewportWidth,
      heightFor,
      scale,
      tx,
      ty,
      savedTx,
      savedTy,
      contentAspect,
      fit,
      pinchFocalX,
      pinchFocalY,
      traceBegin,
      traceSample,
      traceRelease,
    ],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(4)
        .onStart(
          guardWorklet('zoom.pan.start', () => {
            'worklet'
            if (scale.value <= MIN_SCALE) return
            traceBegin('pan')
            traceSample('start', {})
          }),
        )
        .onUpdate(
          guardWorklet('zoom.pan.update', (e) => {
            'worklet'
            if (scale.value <= MIN_SCALE) return
            const w = viewportWidth
            const s = scale.value
            const h = heightFor(s)
            const { x: limX, y: limY } = streamPanExtent(w, h, contentAspect, s, fit)
            const rawX = savedTx.value + e.translationX
            const rawY = savedTy.value + e.translationY
            const clamped = clampPan({ tx: rawX, ty: rawY, w, h, aspect: contentAspect, scale: s, fit })
            tx.set(clamped.x)
            ty.set(clamped.y)
            traceSample('update', { pointers: 1, rawX, rawY, limX, limY })
          }),
        )
        .onEnd(
          guardWorklet('zoom.pan.end', () => {
            'worklet'
            savedTx.set(tx.value)
            savedTy.set(ty.value)
            const w = viewportWidth
            const h = heightFor(scale.value)
            const { x: limX, y: limY } = streamPanExtent(w, h, contentAspect, scale.value, fit)
            traceSample('end', { rawX: tx.value, rawY: ty.value, limX, limY })
            traceRelease()
            runOnJS(reportZoom)('pan', {
              viewportW: Math.round(w),
              viewportH: Math.round(h),
              viewportAspect: h > 0 ? Math.round((w / h) * 100) / 100 : 0,
              contentAspect: Math.round(contentAspect * 100) / 100,
              fitCover: fit === 'cover' ? 1 : 0,
              scale: Math.round(scale.value * 100) / 100,
              panExtentX: Math.round(limX),
              panExtentY: Math.round(limY),
              tx: Math.round(tx.value),
              ty: Math.round(ty.value),
              // 1 = the pan is sitting exactly on its limit, i.e. the operator
              // has hit the wall the clamp drew.
              atLimitX: Math.abs(Math.abs(tx.value) - limX) < 1 ? 1 : 0,
              atLimitY: Math.abs(Math.abs(ty.value) - limY) < 1 ? 1 : 0,
            })
          }),
        ),
    [
      scale,
      viewportWidth,
      heightFor,
      tx,
      ty,
      savedTx,
      savedTy,
      contentAspect,
      fit,
      traceBegin,
      traceSample,
      traceRelease,
    ],
  )

  // The RENDER transform. The wrapper is the box at rest; the box the live
  // scale asks for is drawn by scaling the wrapper further and re-centring it
  // on the grown box — so the player's frame never changes, and what is drawn
  // is pixel for pixel the cover box of that height scaled by the pinch.
  const videoStyle = useAnimatedStyle(() => {
    const s = scale.value
    const r = foldGrowth({
      scale: s,
      tx: tx.value,
      ty: ty.value,
      boxHeight: heightFor(s),
      restHeight: heightFor(ZOOM_MIN),
    })
    return { transform: [{ translateX: r.tx }, { translateY: r.ty }, { scale: r.scale }] }
  })

  const doubleTapZoomAt = useCallback(
    (x: number, y: number): void => {
      'worklet'
      // A tap in the shadow of a pinch is the hand leaving the glass, not an
      // instruction. Reported 2026-09-21 as "sometimes a pinch ends a notch
      // further forward"; the double tap was acting on a bouncing finger.
      if (!tapStepAccepted({ nowMs: Date.now(), lastPinchEndMs: lastPinchEndMs.value })) return
      const s0 = scale.value
      const w = viewportWidth
      // The box the tap landed in, and the box the new scale asks for: the
      // anchor holds across the growth (two centres, total scales), and the
      // pan must be legal in the box the picture will be drawn in.
      const h0 = heightFor(s0)
      const target = doubleTapTarget({
        current: s0,
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
        cover: coverScale({ viewportWidth: w, viewportHeight: h0, contentAspect, fit }),
        fallbackStep: ZOOM_STEPS[0] ?? 2,
      })
      // Back to the whole picture is a reset, and reset already recentres.
      // Anchoring it on the tap would be meaningless: at 1x there is no pan to
      // hold anything with.
      if (target.kind === 'fit' || w < MIN_VIEWPORT || h0 < MIN_VIEWPORT) {
        traceBegin('double-tap')
        traceSample('step', { focalX: x, focalY: y, note: `${f2(s0)}→fit` })
        traceRelease()
        resetZoom()
        return
      }
      const s1 = target.scale
      const h1 = heightFor(s1)
      const ptx = focalPan({
        focalNow: x,
        focalStart: x,
        center: w / 2,
        panStart: tx.value,
        scaleStart: s0 * h0,
        scaleAfter: s1 * h1,
      })
      const pty = focalPan({
        focalNow: y,
        focalStart: y,
        center: h0 / 2,
        centerAfter: h1 / 2,
        panStart: ty.value,
        scaleStart: s0 * h0,
        scaleAfter: s1 * h1,
      })
      const { x: limX, y: limY } = streamPanExtent(w, h1, contentAspect, s1, fit)
      const { x: nx, y: ny } = clampPan({ tx: ptx, ty: pty, w, h: h1, aspect: contentAspect, scale: s1, fit })
      scale.set(withTiming(s1))
      committedScale.set(s1)
      tx.set(withTiming(nx))
      savedTx.set(nx)
      ty.set(withTiming(ny))
      savedTy.set(ny)
      traceBegin('double-tap')
      traceSample('step', {
        focalX: x,
        focalY: y,
        rawX: ptx,
        rawY: pty,
        x: nx,
        y: ny,
        limX,
        limY,
        boxH: h1,
        note: h0 === h1 ? `${f2(s0)}→${f2(s1)}` : `${f2(s0)}→${f2(s1)} box ${Math.round(h0)}→${Math.round(h1)}`,
      })
      traceRelease()
    },
    [
      scale,
      committedScale,
      lastPinchEndMs,
      viewportWidth,
      heightFor,
      tx,
      ty,
      savedTx,
      savedTy,
      contentAspect,
      fit,
      resetZoom,
      traceBegin,
      traceSample,
      traceRelease,
    ],
  )

  const composeWith = useCallback(
    (...others: (GestureType | ComposedGesture)[]): SimultaneousGesture =>
      Gesture.Simultaneous(pinch, pan, ...others),
    [pinch, pan],
  )

  return useMemo(
    () => ({
      scale,
      committedScale,
      videoStyle,
      resetZoom,
      doubleTapZoomAt,
      snapZoom: snapToIdentity,
      composeWith,
      traceBox,
    }),
    [scale, committedScale, videoStyle, resetZoom, doubleTapZoomAt, snapToIdentity, composeWith, traceBox],
  )
}
