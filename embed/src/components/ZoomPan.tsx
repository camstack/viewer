/**
 * ZoomPan — pinch-to-zoom + pan for a SINGLE grid tile (the camera inside it,
 * not the whole grid). Pointer-event based so it works for touch in the iOS
 * WKWebView. One-finger drag pans only while zoomed; two fingers pinch; a clean
 * single tap calls `onTap` (the tile uses it to toggle its control overlay); a
 * double tap from the whole picture zooms in until the video fills the tile
 * (no bars), anchored on the tap, and from any zoom returns to the whole
 * picture — the same rule as the app's player (`shared/zoom/double-tap-zoom.ts`).
 *
 * Transform is written straight to the inner element's style (via a ref) so a
 * drag doesn't re-render React on every move.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampPan, containBox } from './zoom-clamp'
import { coverScale, doubleTapTarget } from '../../../shared/zoom/double-tap-zoom'

const MAX_SCALE = 4
/** The double tap's step when the picture already fills the tile. Same as the app's first step. */
const DOUBLE_TAP_FALLBACK_STEP = 2
const TAP_MOVE_TOL = 8
const DOUBLE_TAP_MS = 300

interface Pt {
  x: number
  y: number
}
function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Whether this tile owns the touch gesture, given how far it is zoomed in.
 *
 * At rest it does NOT, and that is the fix: the container used to declare
 * `touch-action: none` unconditionally and capture every pointer, so one finger
 * anywhere on a tile belonged to it — and on a phone a tile is the whole
 * surface. It then did nothing with that finger, because the single-pointer
 * branch pans only while zoomed. A component that claims a gesture it has
 * already decided to ignore is just a page that will not scroll, which is how
 * the operator met it inside the Home Assistant card (2026-09-16).
 *
 * `pan-y` rather than `manipulation`: it hands vertical scrolling back to the
 * browser AND, by omission, keeps the browser's own pinch-zoom off — we build
 * pinch ourselves out of the pointer stream, and the embed's viewport is
 * user-scalable, so anything permitting `pinch-zoom` would zoom the page
 * instead of the camera.
 *
 * Once zoomed the claim is honest: there, one finger really is the pan.
 */
export function touchActionForScale(scale: number): 'none' | 'pan-y' {
  return scale > 1 ? 'none' : 'pan-y'
}

export function ZoomPan({ children, onTap }: { children: ReactNode; onTap: () => void }) {
  const outerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const pointers = useRef<Map<number, Pt>>(new Map())
  const scale = useRef(1)
  const tx = useRef(0)
  const ty = useRef(0)
  const pinch = useRef<{
    dist: number
    scale: number
    cx: number
    cy: number
    tx: number
    ty: number
  } | null>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)

  const apply = (): void => {
    const el = innerRef.current
    if (el)
      el.style.transform = `translate(${tx.current}px, ${ty.current}px) scale(${scale.current})`
    // Written here and not through a re-render: `scale` is a ref, so React
    // never sees it change. The style IS the claim, so it has to move with it.
    const outer = outerRef.current
    if (outer) outer.style.touchAction = touchActionForScale(scale.current)
  }
  /** The picture's intrinsic size; 0×0 until the media has reported it. */
  const mediaSize = (): { iw: number; ih: number } => {
    const video = innerRef.current?.querySelector('video') ?? null
    const img = video ? null : (innerRef.current?.querySelector('img') ?? null)
    return { iw: video?.videoWidth ?? img?.naturalWidth ?? 0, ih: video?.videoHeight ?? img?.naturalHeight ?? 0 }
  }
  const clamp = (): void => {
    const r = outerRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return
    // Clamp against the video's RENDERED content box (object-fit: contain
    // letterbox), NOT the element box — otherwise pan drifts into the letterbox
    // gutter (black border) instead of pinning to the real frame edge. Fall back
    // to the container box (fills exactly) when the media size isn't known yet.
    const { iw, ih } = mediaSize()
    const box = containBox(r.width, r.height, iw, ih)
    tx.current = clampPan(tx.current, r.width, box.width, scale.current)
    ty.current = clampPan(ty.current, r.height, box.height, scale.current)
  }
  const reset = (): void => {
    scale.current = 1
    tx.current = 0
    ty.current = 0
    apply()
  }
  /**
   * The double tap at viewport point (`clientX`, `clientY`). From the whole
   * picture: in to the scale that fills the tile, the tapped point held still
   * (`translate = (tap - centre) * (1 - scale)` from an untranslated 1x).
   * From any zoom: back to the whole picture.
   */
  const doubleTapAt = (clientX: number, clientY: number): void => {
    const r = outerRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return
    const { iw, ih } = mediaSize()
    const target = doubleTapTarget({
      current: scale.current,
      minScale: 1,
      maxScale: MAX_SCALE,
      cover: coverScale({
        viewportWidth: r.width,
        viewportHeight: r.height,
        contentAspect: iw > 0 && ih > 0 ? iw / ih : Number.NaN,
        fit: 'contain',
      }),
      fallbackStep: DOUBLE_TAP_FALLBACK_STEP,
    })
    if (target.kind === 'fit') {
      reset()
      return
    }
    const s = target.scale
    scale.current = s
    tx.current = (clientX - r.left - r.width / 2) * (1 - s)
    ty.current = (clientY - r.top - r.height / 2) * (1 - s)
    clamp()
    apply()
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()]
      const a = pts[0]
      const b = pts[1]
      if (a && b) {
        pinch.current = {
          dist: dist(a, b),
          scale: scale.current,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          tx: tx.current,
          ty: ty.current,
        }
      }
      drag.current = null
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, tx: tx.current, ty: ty.current, moved: false }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinch.current) {
      const pts = [...pointers.current.values()]
      const a = pts[0]
      const b = pts[1]
      if (!a || !b) return
      const d = dist(a, b)
      if (pinch.current.dist > 0) {
        scale.current = Math.max(
          1,
          Math.min(MAX_SCALE, pinch.current.scale * (d / pinch.current.dist)),
        )
      }
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      tx.current = pinch.current.tx + (cx - pinch.current.cx)
      ty.current = pinch.current.ty + (cy - pinch.current.cy)
      clamp()
      apply()
      return
    }

    const d = drag.current
    if (pointers.current.size === 1 && d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) > TAP_MOVE_TOL || Math.abs(dy) > TAP_MOVE_TOL) d.moved = true
      if (scale.current > 1) {
        tx.current = d.tx + dx
        ty.current = d.ty + dy
        clamp()
        apply()
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const wasSingle = pointers.current.size === 1
    const d = drag.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      drag.current = null
      if (wasSingle && d && !d.moved) {
        const now = Date.now()
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0
          doubleTapAt(e.clientX, e.clientY)
        } else {
          lastTap.current = now
          onTap()
        }
      }
    }
  }

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: touchActionForScale(1),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={innerRef}
        style={{
          width: '100%',
          height: '100%',
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  )
}
