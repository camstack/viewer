/**
 * Motion of the app — every spring and every duration, decided in ONE place.
 *
 * React Native's own `Animated` is gone from the app (guard
 * `scripts/check-no-rn-animated.mjs`); everything that moves runs on
 * Reanimated, and takes its numbers from here so the press, the tab pill, the
 * cross-fades and the sheets cannot drift into five different feels.
 *
 * The numbers are plain data (a spec pins them). The two helpers wrap them in
 * the Reanimated animation functions and honour the OS "Reduce Motion" switch:
 * a reduced animation does not run, the value simply lands on its target.
 */
import { Easing, useReducedMotion, withSpring, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated'

/** A Reanimated spring in physics terms. */
export interface SpringPreset {
  readonly damping: number
  readonly stiffness: number
  readonly mass: number
}

/** The curve every timed transition eases with (RN's former default). */
export const MOTION_EASE = Easing.inOut(Easing.ease)

export const MOTION = {
  /** A glass control under the finger: shrinks a little, springs back. */
  press: {
    rest: { scale: 1, opacity: 1 },
    pressed: { scale: 0.92, opacity: 0.85 },
    spring: { damping: 18, stiffness: 420, mass: 0.7 },
  },
  /** The active-tab pill sliding between destinations. */
  tabPill: {
    spring: { damping: 20, stiffness: 260, mass: 0.9 },
  },
  /** Muted ↔ lit face of a control (the tab glyph and label). */
  crossFade: { ms: 160 },
  /** Something that was not there fading in. */
  appear: { ms: 160 },
  /** Something that goes away fading out. */
  disappear: { ms: 160 },
  /** A drawer, a sheet or a menu sliding open or closed. */
  sheet: { ms: 220 },
  /** A glass pill or disc that joins or leaves a cluster: scale + fade on a spring. */
  pop: { spring: { damping: 16, stiffness: 380, mass: 0.7 }, fromScale: 0.8, fadeMs: 140 },
  /** A menu / popover opening FROM its anchor: scale out of the anchor point + fade. */
  menu: { spring: { damping: 22, stiffness: 420, mass: 0.8 }, fromScale: 0.9, fadeMs: 140 },
  /** Chrome over the video appearing / auto-hiding. */
  controls: { fadeInMs: 180, fadeOutMs: 220 },
  /** The playback bar's glass fading in as it docks over the video. */
  dock: { fadeMs: 200 },
} as const satisfies {
  readonly press: {
    readonly rest: { readonly scale: number; readonly opacity: number }
    readonly pressed: { readonly scale: number; readonly opacity: number }
    readonly spring: SpringPreset
  }
  readonly tabPill: { readonly spring: SpringPreset }
  readonly crossFade: { readonly ms: number }
  readonly appear: { readonly ms: number }
  readonly disappear: { readonly ms: number }
  readonly sheet: { readonly ms: number }
  readonly pop: { readonly spring: SpringPreset; readonly fromScale: number; readonly fadeMs: number }
  readonly menu: { readonly spring: SpringPreset; readonly fromScale: number; readonly fadeMs: number }
  readonly controls: { readonly fadeInMs: number; readonly fadeOutMs: number }
  readonly dock: { readonly fadeMs: number }
}

export { useReducedMotion }

/** Spring `value` toward `to` — or land on it at once when motion is reduced. */
export function springTo(to: number, reduced: boolean, spring: SpringPreset = MOTION.press.spring): number {
  return reduced ? to : withSpring(to, spring)
}

/** Ease `value` toward `to` over `ms` — or land on it at once when motion is reduced. */
export function timingTo(to: number, ms: number, reduced: boolean, easing: (t: number) => number = MOTION_EASE): number {
  return reduced ? to : withTiming(to, { duration: ms, easing })
}

/** What a component spreads onto an `Animated.View`; absent under Reduce Motion. */
export interface Transitions {
  readonly entering?: EntryExitAnimationFunction
  readonly exiting?: EntryExitAnimationFunction
}

const NONE: Transitions = {}

const popEntering: EntryExitAnimationFunction = () => {
  'worklet'
  return {
    initialValues: { opacity: 0, transform: [{ scale: MOTION.pop.fromScale }] },
    animations: {
      opacity: withTiming(1, { duration: MOTION.pop.fadeMs }),
      transform: [{ scale: withSpring(1, MOTION.pop.spring) }],
    },
  }
}

const popExiting: EntryExitAnimationFunction = () => {
  'worklet'
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: MOTION.pop.fadeMs }),
      transform: [{ scale: withTiming(MOTION.pop.fromScale, { duration: MOTION.pop.fadeMs }) }],
    },
  }
}

const POP: Transitions = { entering: popEntering, exiting: popExiting }

/** Scale + fade in / out on the pop spring (a pill or disc joining a cluster). */
export function popTransitions(reduced: boolean): Transitions {
  return reduced ? NONE : POP
}

function fadeFor(inMs: number, outMs: number): Transitions {
  const entering: EntryExitAnimationFunction = () => {
    'worklet'
    return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, { duration: inMs }) } }
  }
  const exiting: EntryExitAnimationFunction = () => {
    'worklet'
    return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, { duration: outMs }) } }
  }
  return { entering, exiting }
}

const CONTROLS_FADE = fadeFor(MOTION.controls.fadeInMs, MOTION.controls.fadeOutMs)
const DOCK_FADE = fadeFor(MOTION.dock.fadeMs, MOTION.dock.fadeMs)

/** Overlay controls auto-hiding / showing. */
export function controlsTransitions(reduced: boolean): Transitions {
  return reduced ? NONE : CONTROLS_FADE
}

/** The playback bar's glass fading in on dock. */
export function dockTransitions(reduced: boolean): Transitions {
  return reduced ? NONE : DOCK_FADE
}

/** Hook forms: read the OS switch once. */
export function usePopTransitions(): Transitions {
  return popTransitions(useReducedMotion())
}
export function useControlsTransitions(): Transitions {
  return controlsTransitions(useReducedMotion())
}
export function useDockTransitions(): Transitions {
  return dockTransitions(useReducedMotion())
}

/** Where a menu's scale starts from, in the menu's own box. */
export interface MenuOrigin {
  readonly x: number
  readonly y: '0%' | '100%'
}

/**
 * The point of the menu nearest its anchor: horizontally under/over the
 * anchor's centre (kept inside the menu), vertically on the edge that faces it.
 */
export function menuOrigin(
  anchor: { readonly x: number; readonly width: number },
  menu: { readonly left: number; readonly width: number },
  placement: 'below' | 'above',
): MenuOrigin {
  const centre = anchor.x + anchor.width / 2 - menu.left
  const x = Math.min(menu.width, Math.max(0, centre))
  return { x, y: placement === 'below' ? '0%' : '100%' }
}
