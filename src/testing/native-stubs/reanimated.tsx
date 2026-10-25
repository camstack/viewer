/**
 * Reanimated under jsdom. Shared values are plain boxes and the animation
 * helpers return their target immediately: nothing here animates, but every
 * hook is real enough that a component's render and effects run to completion.
 */
import React from 'react'
import { ScrollView, Text, View } from 'react-native'
import { makeStubView } from './passthrough.js'

export interface SharedValue<T> {
  value: T
  /** The accessor pair Reanimated added for the React Compiler; `DriveJoystick` uses only these. */
  get(): T
  set(next: T | ((current: T) => T)): void
}

function sharedValue<T>(initial: T): SharedValue<T> {
  const box = {
    value: initial,
    get(): T {
      return box.value
    },
    set(next: T | ((current: T) => T)): void {
      box.value = typeof next === 'function' ? (next as (current: T) => T)(box.value) : next
    },
  }
  return box
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  const ref = React.useRef<SharedValue<T>>(sharedValue(initial))
  return ref.current
}

/**
 * The real hook returns ONE handle for the life of the component — values flow
 * to the UI thread through it, the object never changes identity — and a hook
 * that memoises its result on that handle is stable in the app. Here the
 * factory is evaluated at render so a mount test sees the initial style, and
 * the previous object is handed back whenever the style has not changed, so
 * identity under the stub means what it means on the device.
 */
export function useAnimatedStyle(factory: () => Record<string, unknown>): Record<string, unknown> {
  const style = factory()
  const key = JSON.stringify(style)
  // React's own "store information from previous renders" shape: a set during
  // render re-runs this component at once, and a ref would be read in render.
  const [kept, keep] = React.useState({ style, key })
  if (kept.key !== key) {
    keep({ style, key })
    return style
  }
  return kept.style
}

export function useDerivedValue<T>(factory: () => T): SharedValue<T> {
  return { value: factory() }
}

export function useAnimatedRef<T>(): React.RefObject<T | null> {
  return React.useRef<T | null>(null)
}

export const useReducedMotion = (): boolean => false
export const withTiming = <T,>(to: T): T => to
export const withSpring = <T,>(to: T): T => to
export const withDelay = <T,>(_ms: number, to: T): T => to
export const withRepeat = <T,>(to: T): T => to
export const withSequence = <T,>(...steps: readonly T[]): T => steps[steps.length - 1]
export const cancelAnimation = (): void => undefined
export const runOnJS = <A extends readonly unknown[], R>(fn: (...args: A) => R) => fn
export const runOnUI = <A extends readonly unknown[], R>(fn: (...args: A) => R) => fn
export const interpolate = (value: number): number => value
export const interpolateColor = (): string => 'transparent'
export const useAnimatedReaction = (): void => undefined
export const useAnimatedScrollHandler = (): (() => void) => () => undefined
export const scrollTo = (): void => undefined
export const measure = (): null => null
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' } as const
export const Easing = {
  linear: (t: number): number => t,
  ease: (t: number): number => t,
  inOut: (fn: (t: number) => number) => fn,
  out: (fn: (t: number) => number) => fn,
  in: (fn: (t: number) => number) => fn,
  quad: (t: number): number => t,
  cubic: (t: number): number => t,
  bezier: () => (t: number): number => t,
}
export type AnimatedStyle<T> = T
export type AnimatedRef<T> = React.RefObject<T | null>

const Animated = {
  View,
  Text,
  ScrollView,
  Image: makeStubView('Animated.Image'),
  FlatList: makeStubView('Animated.FlatList'),
  createAnimatedComponent: <P,>(component: React.ComponentType<P>): React.ComponentType<P> =>
    component,
}

export default Animated
