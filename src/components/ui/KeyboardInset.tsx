/**
 * KeyboardInset — the ONE mechanism that keeps a text field, and the buttons
 * next to it, above the software keyboard. Every input surface of the app goes
 * through it: `SheetModal` (so every sheet, picker and dialog built on it),
 * the prompt dialog, and every scroll that holds a field.
 *
 * Why not `KeyboardAvoidingView`: it measures the keyboard against the
 * view's frame only on iOS (`behavior` is `undefined` on Android here, which
 * is a no-op), and it relied on Android resizing the window — which an
 * edge-to-edge window, and every `Modal`'s dialog window, does not do. A
 * field in a sheet ended up entirely under the keyboard (Library → Plates,
 * "assign plate", 2026-10-21).
 *
 * Three pieces, one arithmetic (`keyboard-inset.ts`):
 *
 *  - `useKeyboardOverlap()` — attach to a view that does not move; it reports
 *    how much of that view the keyboard covers, measured in window
 *    coordinates (so a window the system DID resize reports 0).
 *  - `KeyboardInsetView` — a `View` padded by its own overlap: a bottom-aligned
 *    child (a sheet's card) rides up above the keyboard. Drop-in where a
 *    `KeyboardAvoidingView` was.
 *  - `KeyboardAwareScrollView` / `useKeyboardReveal` — a scroll that pads its
 *    content by the overlap and scrolls the FOCUSED field into the visible
 *    strip, so a tall form still shows the field being typed into.
 *
 * All of it is a no-op on the web, which has no software-keyboard events.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type HostInstance,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ViewProps,
} from 'react-native'

import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

import { timingTo, useReducedMotion } from '../../theme/motion.js'
import { basePaddingBottom, basePaddingTop, keyboardOverlap, keyboardPaddingStyle, revealDelta } from './keyboard-inset.js'
import { useKeyboardFrame, type KeyboardFrame } from './use-keyboard-frame.js'

/** Anything measurable in window coordinates (a `View`, a `ScrollView`). */
export interface WindowMeasurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void
}

export interface KeyboardOverlap {
  /** px of the measured view the keyboard covers; 0 when hidden or unmeasured. */
  readonly overlap: number
  /** The keyboard, or `null` when none covers anything. */
  readonly keyboard: KeyboardFrame | null
  /** Attach to the measured view (`onLayout`). */
  readonly onLayout: (event: LayoutChangeEvent) => void
  /** Re-measure now (after an external move). */
  readonly measure: () => void
}

/**
 * How much of `target` the keyboard covers. `target` must be a view whose
 * frame does not move with the lift itself — a padded container, a scroll
 * view's own frame — or the measurement would chase its own correction.
 */
export function useKeyboardOverlap(target: React.RefObject<WindowMeasurable | null>): KeyboardOverlap {
  const keyboard = useKeyboardFrame()
  const [bottom, setBottom] = useState<number | null>(null)

  const measure = useCallback(() => {
    target.current?.measureInWindow((_x, y, _w, height) => {
      // An unmounted / not-yet-laid-out host reports zeros: not a bottom edge.
      if (height > 0) setBottom(y + height)
    })
  }, [target])

  // The keyboard moving can change what the window is (a resize on Android) without
  // a layout of THIS view being reported first, so measure on every frame change.
  useEffect(() => {
    if (keyboard !== null) measure()
  }, [keyboard, measure])

  const onLayout = useCallback((_event: LayoutChangeEvent) => measure(), [measure])

  return { overlap: keyboardOverlap(bottom, keyboard?.top ?? null), keyboard, onLayout, measure }
}

export interface KeyboardInsetViewProps extends ViewProps {
  /**
   * Extra top padding while the keyboard is up — the safe-area top, so a
   * bottom sheet lifted toward the top edge stops below the status bar.
   */
  readonly safeTopWhenLifted?: number
}

/**
 * A `View` that pads its bottom by the keyboard's overlap with it. The lift
 * rides the keyboard's own animation on iOS (its event says how long);
 * Android reports after the keyboard has moved, so the layout lands at once.
 */
export function KeyboardInsetView({
  style,
  safeTopWhenLifted = 0,
  children,
  ...rest
}: KeyboardInsetViewProps): React.JSX.Element {
  // Measured: a marker filling this view's box. The padding below changes
  // what is inside the box, never the box, so the measurement stays put.
  const marker = useRef<View>(null)
  const { overlap, keyboard, onLayout } = useKeyboardOverlap(marker)
  const reduced = useReducedMotion()
  const lift = useSharedValue(0)
  const top = useSharedValue(0)
  const baseBottom = basePaddingBottom(style)
  const baseTop = basePaddingTop(style)
  const liftTop = safeTopWhenLifted > 0

  useEffect(() => {
    const ms = keyboard?.duration ?? 0
    const instant = reduced || ms <= 0
    lift.value = timingTo(overlap, ms, instant)
    top.value = timingTo(overlap > 0 ? safeTopWhenLifted : 0, ms, instant)
  }, [overlap, keyboard, reduced, safeTopWhenLifted, lift, top])

  const padded = useAnimatedStyle(() =>
    liftTop
      ? { paddingBottom: baseBottom + lift.value, paddingTop: baseTop + top.value }
      : { paddingBottom: baseBottom + lift.value },
  )

  return (
    <Animated.View {...rest} style={[style, padded]}>
      <View ref={marker} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout} />
      {children}
    </Animated.View>
  )
}

/** The scroll a reveal acts on: a `ScrollView` or a list. */
export interface RevealScroller {
  /** The native scroll view: measured for the overlap, and the field must be inside it. */
  readonly node: HostInstance | null
  /** Scroll the content to an absolute offset. */
  readonly scrollToY: (y: number) => void
}

function hasMethod<K extends string>(value: unknown, key: K): value is Record<K, (...args: never[]) => unknown> {
  return typeof value === 'object' && value !== null && key in value && typeof Reflect.get(value, key) === 'function'
}

/** A host view: what `measureLayout` / `measureInWindow` run on. */
function isHostInstance(value: unknown): value is HostInstance {
  return hasMethod(value, 'measureLayout') && hasMethod(value, 'measureInWindow')
}

interface OffsetList {
  scrollToOffset(params: { offset: number; animated?: boolean }): void
  getNativeScrollRef(): unknown
}
interface PositionScroll {
  scrollTo(params: { y: number; animated?: boolean }): void
  getNativeScrollRef(): unknown
}

function isOffsetList(value: unknown): value is OffsetList {
  return hasMethod(value, 'scrollToOffset') && hasMethod(value, 'getNativeScrollRef')
}
function isPositionScroll(value: unknown): value is PositionScroll {
  return hasMethod(value, 'scrollTo') && hasMethod(value, 'getNativeScrollRef')
}

/**
 * The reveal adapter for a mounted list or scroll view instance — a
 * `FlatList` (and anything built on it, `DraggableFlatList` included, whose
 * ref is typed as a component rather than an instance) scrolls by offset, a
 * `ScrollView` by position. `null` for anything else, or before it mounts.
 */
export function revealScrollerOf(instance: unknown): RevealScroller | null {
  if (isOffsetList(instance)) {
    const native = instance.getNativeScrollRef()
    return {
      node: isHostInstance(native) ? native : null,
      scrollToY: (y) => instance.scrollToOffset({ offset: y, animated: true }),
    }
  }
  if (isPositionScroll(instance)) {
    const native = instance.getNativeScrollRef()
    return {
      node: isHostInstance(native) ? native : null,
      scrollToY: (y) => instance.scrollTo({ y, animated: true }),
    }
  }
  return null
}

export interface KeyboardReveal {
  /** px to add below the content so its last field can scroll above the keyboard. */
  readonly overlap: number
  /** Attach to the scroll view. */
  readonly onLayout: (event: LayoutChangeEvent) => void
  /** Attach to the scroll view (tracks the offset a reveal starts from). */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** The same, for a list that reports its offset as a number. */
  readonly onScrollOffset: (y: number) => void
}

/**
 * Scroll the focused field into the strip above the keyboard whenever the
 * keyboard appears or changes, or the scroll view's frame changes under it (a
 * sheet lifted). A field outside this scroll is left alone — the screen
 * behind an open sheet must not scroll for the sheet's field.
 */
export function useKeyboardReveal(scroller: () => RevealScroller | null): KeyboardReveal {
  // The scroll view's own frame: padding its CONTENT never moves it.
  const frame = useMemo<React.RefObject<WindowMeasurable | null>>(
    () => ({
      get current(): WindowMeasurable | null {
        return scroller()?.node ?? null
      },
    }),
    [scroller],
  )
  const { overlap, keyboard, onLayout: measureOnLayout } = useKeyboardOverlap(frame)
  const offset = useRef(0)
  const keyboardRef = useRef(keyboard)
  keyboardRef.current = keyboard

  const reveal = useCallback(() => {
    const kb = keyboardRef.current
    const target = scroller()
    // Typed non-null, but `null` whenever no field has focus.
    const field: HostInstance | null = TextInput.State.currentlyFocusedInput()
    if (kb === null || target === null || target.node === null || field === null) return
    const node = target.node
    field.measureLayout(
      node,
      () => {
        field.measureInWindow((_fx, fieldTop, _fw, fieldHeight) => {
          node.measureInWindow((_sx, viewTop, _sw, viewHeight) => {
            const delta = revealDelta({
              fieldTop,
              fieldBottom: fieldTop + fieldHeight,
              visibleTop: viewTop,
              visibleBottom: Math.min(viewTop + viewHeight, kb.top),
            })
            if (delta !== 0) target.scrollToY(Math.max(0, offset.current + delta))
          })
        })
      },
      // Not a descendant of this scroll: someone else's field.
      () => undefined,
    )
  }, [scroller])

  useEffect(() => {
    if (keyboard === null) return undefined
    // After the commit that applied the lift / content padding.
    const handle = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(handle)
  }, [keyboard, overlap, reveal])

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      measureOnLayout(event)
      if (keyboardRef.current !== null) requestAnimationFrame(reveal)
    },
    [measureOnLayout, reveal],
  )

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y
  }, [])
  const onScrollOffset = useCallback((y: number) => {
    offset.current = y
  }, [])

  return { overlap, onLayout, onScroll, onScrollOffset }
}

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  readonly ref?: React.Ref<ScrollView>
}

/**
 * A `ScrollView` that keeps its focused field above the keyboard: its content
 * gains the keyboard's overlap as bottom padding, and the field is scrolled
 * into view. `keyboardShouldPersistTaps` defaults to `handled`, so a button
 * next to a field takes the FIRST tap instead of spending it on a dismiss.
 */
export function KeyboardAwareScrollView({
  ref,
  contentContainerStyle,
  onLayout,
  onScroll,
  scrollEventThrottle = 16,
  keyboardShouldPersistTaps = 'handled',
  children,
  ...rest
}: KeyboardAwareScrollViewProps): React.JSX.Element {
  const scrollRef = useRef<ScrollView>(null)
  const scroller = useCallback((): RevealScroller | null => revealScrollerOf(scrollRef.current), [])
  const reveal = useKeyboardReveal(scroller)
  const setRef = useCallback(
    (view: ScrollView | null) => {
      scrollRef.current = view
      if (typeof ref === 'function') ref(view)
      else if (ref !== null && ref !== undefined) ref.current = view
    },
    [ref],
  )
  return (
    <ScrollView
      {...rest}
      ref={setRef}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      scrollEventThrottle={scrollEventThrottle}
      contentContainerStyle={[contentContainerStyle, keyboardPaddingStyle(contentContainerStyle, reveal.overlap)]}
      onLayout={(event) => {
        reveal.onLayout(event)
        onLayout?.(event)
      }}
      onScroll={(event) => {
        reveal.onScroll(event)
        onScroll?.(event)
      }}
    >
      {children}
    </ScrollView>
  )
}
