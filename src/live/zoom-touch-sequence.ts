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
 * second finger take part in THIS touch?". For the double tap it answers a
 * second one, because the recogniser cannot: Gesture Handler's iOS tap handler
 * counts touches-began EVENTS, not taps — two fingers landing a few ms apart
 * are its "two taps" — and it knows nothing of the pinch or the pan beside it.
 * `downs` is the hook's own count, and a double tap is two single-finger
 * touches in one sequence, never fewer, never more.
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
 * The gap is the double tap's own window plus a margin, never a number of its
 * own. It was 250 ms against the recogniser's 300 ms: a touch landing in
 * between started a clean record while the recogniser still paired it with the
 * pinch or the drag before it, and the zoom went back to 1x.
 *
 * Pure and worklet-safe: values in, values out.
 */

/** A double tap's second touch lands within this long of the first one's lift. */
export const DOUBLE_TAP_MAX_DELAY_MS = 300

/** A double tap's two taps stay within this travel (pt). */
export const DOUBLE_TAP_MAX_DISTANCE = 24

/**
 * A single touch landing this long after the last touch event is a new
 * sequence. Longer than the double tap's window, so both touches of anything
 * the recogniser can call a double tap are always in ONE record.
 */
export const SEQUENCE_GAP_MS = DOUBLE_TAP_MAX_DELAY_MS + 50

export interface TouchSequence {
  readonly pinchSeen: boolean
  readonly panSeen: boolean
  /** Most fingers down at once during the sequence. */
  readonly maxTouches: number
  /** Touch-down events in the sequence: a clean double tap has exactly two. */
  readonly downs: number
  readonly lastTouchMs: number
}

export const EMPTY_TOUCH_SEQUENCE: TouchSequence = {
  pinchSeen: false,
  panSeen: false,
  maxTouches: 0,
  downs: 0,
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
    downs: base.downs + 1,
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
    downs: seq.downs,
    lastTouchMs: nowMs,
  }
}

export function markPinch(seq: TouchSequence, nowMs: number): TouchSequence {
  'worklet'
  return {
    pinchSeen: true,
    panSeen: seq.panSeen,
    maxTouches: Math.max(seq.maxTouches, 2),
    downs: seq.downs,
    lastTouchMs: nowMs,
  }
}

export function markPan(seq: TouchSequence): TouchSequence {
  'worklet'
  return {
    pinchSeen: seq.pinchSeen,
    panSeen: true,
    maxTouches: seq.maxTouches,
    downs: seq.downs,
    lastTouchMs: seq.lastTouchMs,
  }
}
