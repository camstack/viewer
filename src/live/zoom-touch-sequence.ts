/**
 * What the fingers did during ONE touch sequence (first finger down → every
 * finger up), as a small value the gesture worklets share.
 *
 * ## Why it exists
 *
 * Pinch, pan, the tap pair and the two downward flings all run
 * `Gesture.Simultaneous`, so none of them can see what the others did. That
 * produced two reports of "pinch snaps back / navigates away":
 *
 *  - a pinch ending near 1x with a little downward drift of the remaining
 *    finger satisfied the one-finger back fling (zoom <= 1.02);
 *  - an accidental two-finger or panning touch registered as a double tap and
 *    reset the zoom to 1x.
 *
 * The record answers one question for each of them: "did a pinch, a pan or a
 * second finger take part in THIS touch?".
 *
 * ## Reset rule
 *
 * Not "when the last finger lifts": Gesture Handler does not promise the order
 * of the touch event and the `onEnd` of a recogniser, and a reset that lands
 * first would blind the very check that reads the record in `onEnd`. A
 * sequence ends when a NEW single touch lands more than `SEQUENCE_GAP_MS`
 * after the last touch event. A bounce right after a pinch is therefore still
 * part of the pinch's sequence, which is what both checks want.
 *
 * Pure and worklet-safe: values in, values out.
 */

/** A single touch landing this long after the last touch event is a new sequence. */
export const SEQUENCE_GAP_MS = 250

export interface TouchSequence {
  readonly pinchSeen: boolean
  readonly panSeen: boolean
  /** Most fingers down at once during the sequence. */
  readonly maxTouches: number
  readonly lastTouchMs: number
}

export const EMPTY_TOUCH_SEQUENCE: TouchSequence = {
  pinchSeen: false,
  panSeen: false,
  maxTouches: 0,
  lastTouchMs: 0,
}

/** A finger landed; `touches` is how many are down now. */
export function touchDown(seq: TouchSequence, touches: number, nowMs: number): TouchSequence {
  'worklet'
  const fresh = touches <= 1 && nowMs - seq.lastTouchMs > SEQUENCE_GAP_MS
  const base = fresh ? EMPTY_TOUCH_SEQUENCE : seq
  return {
    pinchSeen: base.pinchSeen,
    panSeen: base.panSeen,
    maxTouches: Math.max(base.maxTouches, touches),
    lastTouchMs: nowMs,
  }
}

/** A finger lifted or the touch was cancelled. Keeps the sequence alive. */
export function touchUp(seq: TouchSequence, nowMs: number): TouchSequence {
  'worklet'
  return {
    pinchSeen: seq.pinchSeen,
    panSeen: seq.panSeen,
    maxTouches: seq.maxTouches,
    lastTouchMs: nowMs,
  }
}

export function markPinch(seq: TouchSequence, nowMs: number): TouchSequence {
  'worklet'
  return {
    pinchSeen: true,
    panSeen: seq.panSeen,
    maxTouches: Math.max(seq.maxTouches, 2),
    lastTouchMs: nowMs,
  }
}

export function markPan(seq: TouchSequence): TouchSequence {
  'worklet'
  return {
    pinchSeen: seq.pinchSeen,
    panSeen: true,
    maxTouches: seq.maxTouches,
    lastTouchMs: seq.lastTouchMs,
  }
}

/** Travel (pt) of a one-finger pan past which it counts as a pan, not a tap's jitter. */
export const PAN_SEEN_DISTANCE = 12
