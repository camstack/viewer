/**
 * The two downward flings on the stream, told apart by how many fingers.
 *
 *  - ONE finger  → leave the screen. Nothing else.
 *  - TWO fingers → open this camera in the on-demand overlay AND leave.
 *
 * ## What used to be here
 *
 * A one-finger fling started system PiP. The operator removed it on
 * 2026-09-13: PiP is no longer something a finger asks for, it is what happens
 * automatically when the app is closed on a single camera, behind a global
 * setting. A gesture and an automatism competing for the same outcome is two
 * authorities over one behaviour, and the automatism is the one that fires when
 * the operator's hands are busy pressing Home.
 *
 * The file is named for what it does now. It was `swipe-to-pip.ts`, and a name
 * that describes a removed behaviour reads as verification that the behaviour
 * is still there.
 *
 * ## Why the counts are constants with a test
 *
 * Both flings share the same travel, velocity and zoom floor — one muscle
 * memory, two outcomes — so the pointer count is the ONLY thing that decides
 * which fires. If the two ever became equal, one gesture would silently swallow
 * the other and the operator would get whichever the composer resolved first.
 */

/** Fingers that mean "go back". */
export const BACK_SWIPE_POINTERS = 1
/** Fingers that mean "on-demand overlay, then go back". */
export const OVERLAY_SWIPE_POINTERS = 2

/** Downward travel (pt) that must be crossed, with positive velocity. */
export const SWIPE_DISTANCE = 80
/** Downward velocity (pt/s) that must be crossed with the travel. */
export const SWIPE_VELOCITY = 400
/**
 * Scale above this is "zoomed" — neither fling may fire.
 *
 * While the picture is zoomed that pan belongs to the frame, and firing either
 * outcome from it would steal the zoom gesture. The epsilon is the same "is
 * this still 1×" floor the zoom hook uses before pan engages.
 */
export const ZOOM_IDLE_SCALE = 1.02

export interface StreamSwipeInput {
  readonly translationY: number
  readonly velocityY: number
  readonly zoomScale: number
}

/** The shared shape of a downward fling. Both outcomes ask exactly this. */
function isDownwardFling(args: StreamSwipeInput): boolean {
  'worklet'
  if (args.zoomScale > ZOOM_IDLE_SCALE) return false
  return args.translationY > SWIPE_DISTANCE && args.velocityY > SWIPE_VELOCITY
}

export function shouldGoBackOnSwipe(args: StreamSwipeInput): boolean {
  'worklet'
  return isDownwardFling(args)
}

export function shouldOpenOverlayOnSwipe(args: StreamSwipeInput): boolean {
  'worklet'
  return isDownwardFling(args)
}
