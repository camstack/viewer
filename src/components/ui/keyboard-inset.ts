/**
 * The keyboard arithmetic every input surface shares, pure.
 *
 * One question is asked everywhere a text field can sit low on the screen:
 * how much of THIS view does the software keyboard cover? It is answered from
 * two numbers in window coordinates — the view's measured bottom edge and the
 * keyboard's top edge — never from the keyboard's height alone. That is what
 * keeps one mechanism correct on both kinds of window:
 *
 *  - a window the keyboard draws OVER (iOS; Android edge-to-edge, which this
 *    app runs, including every `Modal`'s dialog window): the view still ends at
 *    the screen's bottom, so the overlap is the keyboard's height;
 *  - a window the system RESIZES (Android with adjustResize honoured): the
 *    view's bottom already moved up to the keyboard's top, so the overlap is 0
 *    and nothing is padded twice.
 *
 * Wiring: `use-keyboard-frame.ts` (events), `KeyboardInset.tsx` (the view, the
 * scroll view and the scroll hook).
 */
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native'

/** The platforms the keyboard events differ on (`Platform.OS`'s values). */
export type KeyboardPlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos'

/** The two `Keyboard` events a platform reports a frame change and a hide with. */
export interface KeyboardEventNames {
  readonly change: 'keyboardWillChangeFrame' | 'keyboardDidShow'
  readonly hide: 'keyboardWillHide' | 'keyboardDidHide'
}

/**
 * iOS announces the frame BEFORE it animates (`Will…`, so the lift can ride
 * the same animation, and `ChangeFrame` also covers the suggestion bar growing
 * or shrinking); Android only reports after the fact (`Did…`, re-emitted on a
 * height change). The web has no software-keyboard events at all — `null`, and
 * every consumer is a no-op there.
 */
export function keyboardEventNames(os: KeyboardPlatformOS): KeyboardEventNames | null {
  if (os === 'ios') return { change: 'keyboardWillChangeFrame', hide: 'keyboardWillHide' }
  if (os === 'android') return { change: 'keyboardDidShow', hide: 'keyboardDidHide' }
  return null
}

/** What a keyboard event says about where the keyboard is. */
export interface KeyboardFrameInput {
  readonly screenY: number
  readonly height: number
}

/**
 * The keyboard's top edge in window coordinates, or `null` when no keyboard
 * covers anything: hidden, or an undocked / floating iPad keyboard, which
 * reports a zero height and must not lift a sheet halfway up the screen.
 */
export function keyboardTopFromFrame(frame: KeyboardFrameInput, windowHeight: number): number | null {
  if (!(frame.height > 0)) return null
  if (!(frame.screenY < windowHeight)) return null
  return frame.screenY
}

/**
 * How much of a view the keyboard covers, px: the view's bottom edge minus the
 * keyboard's top, never negative. `null` either way (keyboard hidden, view not
 * measured yet) is 0 — an unmeasured view is not lifted on a guess.
 */
export function keyboardOverlap(viewBottom: number | null, keyboardTop: number | null): number {
  if (viewBottom === null || keyboardTop === null) return 0
  return Math.max(0, Math.round(viewBottom - keyboardTop))
}

/** Breathing room kept between a revealed field and the keyboard (or the scroll edge), px. */
export const REVEAL_MARGIN = 16

/** A focused field and the part of its scroll view the operator can see, window coordinates. */
export interface RevealInput {
  readonly fieldTop: number
  readonly fieldBottom: number
  /** Top of the scroll view's frame. */
  readonly visibleTop: number
  /** The lower of the scroll view's bottom and the keyboard's top. */
  readonly visibleBottom: number
  readonly margin?: number
}

/**
 * How far to scroll so the focused field is fully visible, px: positive scrolls
 * the content up (the field is under the keyboard), negative down (the field is
 * above the visible top), 0 when it already shows. A field taller than the
 * visible strip is aligned by its top — where the caret of a fresh field is.
 */
export function revealDelta({
  fieldTop,
  fieldBottom,
  visibleTop,
  visibleBottom,
  margin = REVEAL_MARGIN,
}: RevealInput): number {
  const top = visibleTop + margin
  const bottom = visibleBottom - margin
  if (bottom <= top) return 0
  if (fieldTop < top) return Math.round(fieldTop - top)
  if (fieldBottom > bottom) {
    const delta = fieldBottom - bottom
    // Never push the field's own top out of view to show its bottom.
    return Math.round(Math.min(delta, fieldTop - top))
  }
  return 0
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * The bottom padding a style already gives its content, px — the most
 * specific of `paddingBottom`, `paddingVertical`, `padding` that is a number.
 * A percentage cannot be added to, so it counts as none.
 */
export function basePaddingBottom(style: StyleProp<ViewStyle>): number {
  const flat = StyleSheet.flatten(style) ?? {}
  return numeric(flat.paddingBottom) ?? numeric(flat.paddingVertical) ?? numeric(flat.padding) ?? 0
}

/** The same for the top edge. */
export function basePaddingTop(style: StyleProp<ViewStyle>): number {
  const flat = StyleSheet.flatten(style) ?? {}
  return numeric(flat.paddingTop) ?? numeric(flat.paddingVertical) ?? numeric(flat.padding) ?? 0
}

/**
 * The style that keeps a view's content above the keyboard: its own bottom
 * padding plus the overlap, and — only while the keyboard is up — its top
 * padding plus `safeTop`, so a sheet lifted toward the top edge stops below the
 * status bar instead of sliding under it. With no keyboard it adds nothing, so
 * a closed keyboard leaves every layout exactly as it was.
 */
export function keyboardPaddingStyle(
  style: StyleProp<ViewStyle>,
  overlap: number,
  safeTop = 0,
): ViewStyle | null {
  if (overlap <= 0) return null
  const lifted: ViewStyle = { paddingBottom: basePaddingBottom(style) + overlap }
  return safeTop > 0 ? { ...lifted, paddingTop: basePaddingTop(style) + safeTop } : lifted
}
