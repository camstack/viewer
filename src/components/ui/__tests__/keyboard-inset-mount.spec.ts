/**
 * @vitest-environment jsdom
 *
 * The keyboard lift, mounted: `KeyboardInsetView` and the `SheetModal` built
 * on it pad by the keyboard's overlap with their measured frame, per platform.
 *
 * react-native-web has no software keyboard, so the `Keyboard` events are
 * driven by hand (the listeners are captured from `Keyboard.addListener`), and
 * the measured frame comes from `getBoundingClientRect`, which is what
 * react-native-web's `measureInWindow` reads.
 *
 * The reanimated stub evaluates an animated style at render only (the lift is
 * a shared value set in an effect), so each step re-renders before reading.
 *
 * The regression this pins: Library -> Plates opened its "assign plate" sheet
 * entirely under the keyboard (2026-10-21) — the sheet had no avoidance, and
 * the avoidance other sheets had was `KeyboardAvoidingView` with no Android
 * behaviour at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { cloneElement, createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Dimensions, Keyboard, Text, type KeyboardEvent } from 'react-native'

import { setTestPlatform } from '../../../testing/platform-control.js'
import { TEST_INSETS } from '../../../testing/native-stubs/safe-area-context.js'
import { KeyboardInsetView, revealScrollerOf } from '../KeyboardInset.js'
import { SheetModal } from '../SheetModal.js'

type Listener = (event: KeyboardEvent) => void

let listeners: Map<string, Listener[]>
let frameBottom = 800

function keyboardEvent(screenY: number, height: number): KeyboardEvent {
  return {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY, width: 390, height },
    startCoordinates: { screenX: 0, screenY: 800, width: 390, height: 0 },
    isEventFromThisApp: true,
  }
}

async function emit(name: string, event: KeyboardEvent): Promise<void> {
  const subscribed = listeners.get(name) ?? []
  if (subscribed.length === 0) throw new Error(`no ${name} listener`)
  act(() => {
    for (const listener of subscribed) listener(event)
  })
  // The re-measure runs in the effect that commit scheduled, and
  // react-native-web's measureInWindow answers on a timer after it.
  await settle()
}

let rerenderMounted: () => void = () => undefined

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
  act(() => rerenderMounted())
}

beforeEach(() => {
  listeners = new Map()
  frameBottom = 800
  // react-native-web's own (inert) subscription, typed as the real one.
  const subscription = Keyboard.addListener('keyboardDidShow', () => undefined)
  vi.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener])
    return subscription
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ x: 0, y: 0, top: 0, left: 0, width: 390, height: frameBottom, right: 390, bottom: frameBottom, toJSON: () => ({}) }),
  )
  // jsdom has no viewport height (react-native-web reads 0); a 900 tall phone window.
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 900, scale: 3, fontScale: 1 })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setTestPlatform('ios')
})

function mount(element: React.ReactElement): void {
  const { rerender } = render(element)
  // A fresh element: React bails out of re-rendering the identical one.
  rerenderMounted = () => rerender(cloneElement(element))
}

function mountInset(): HTMLElement {
  mount(createElement(KeyboardInsetView, { testID: 'inset', style: { paddingBottom: 10 } }, createElement(Text, null, 'x')))
  return screen.getByTestId('inset')
}

describe('KeyboardInsetView', () => {
  it('iOS: pads by the part of its frame the keyboard covers, and drops it on hide', async () => {
    setTestPlatform('ios')
    const view = mountInset()
    await settle()
    expect(getComputedStyle(view).paddingBottom).toBe('10px')
    await emit('keyboardWillChangeFrame', keyboardEvent(500, 300))
    expect(getComputedStyle(view).paddingBottom).toBe(`${String(10 + 800 - 500)}px`)
    await emit('keyboardWillHide', keyboardEvent(900, 300))
    expect(getComputedStyle(view).paddingBottom).toBe('10px')
  })

  it('Android: the same lift, from the events Android sends', async () => {
    setTestPlatform('android')
    const view = mountInset()
    await settle()
    await emit('keyboardDidShow', keyboardEvent(560, 340))
    expect(getComputedStyle(view).paddingBottom).toBe(`${String(10 + 800 - 560)}px`)
    await emit('keyboardDidHide', keyboardEvent(900, 0))
    expect(getComputedStyle(view).paddingBottom).toBe('10px')
  })

  it('a window already resized above the keyboard is not padded twice', async () => {
    setTestPlatform('android')
    frameBottom = 560
    const view = mountInset()
    await settle()
    await emit('keyboardDidShow', keyboardEvent(560, 340))
    expect(getComputedStyle(view).paddingBottom).toBe('10px')
  })

  it('the web subscribes to nothing and never pads', async () => {
    setTestPlatform('web')
    const view = mountInset()
    await settle()
    expect(listeners.size).toBe(0)
    expect(getComputedStyle(view).paddingBottom).toBe('10px')
  })
})

describe('SheetModal on a phone keeps its card above the keyboard — no opt-in', () => {
  it('lifts the card by the overlap and stops it below the status bar', async () => {
    setTestPlatform('ios')
    mount(
      createElement(SheetModal, {
        visible: true,
        onClose: vi.fn(),
        testID: 'sheet-card',
        sheetStyle: { maxHeight: '92%' },
        children: createElement(Text, null, 'assign plate'),
      }),
    )
    await settle()
    const backdrop = screen.getByTestId('sheet-card-backdrop')
    expect(backdrop.contains(screen.getByTestId('sheet-card'))).toBe(true)
    expect(getComputedStyle(backdrop).paddingBottom).toBe('0px')
    await emit('keyboardWillChangeFrame', keyboardEvent(500, 300))
    expect(getComputedStyle(backdrop).paddingBottom).toBe('300px')
    expect(getComputedStyle(backdrop).paddingTop).toBe(`${String(TEST_INSETS.top)}px`)
  })
})

describe('revealScrollerOf — one reveal for a scroll view and a list', () => {
  const host = { measureLayout: () => undefined, measureInWindow: () => undefined }

  it('scrolls a list (FlatList, DraggableFlatList) by offset', () => {
    const scrollToOffset = vi.fn()
    const scroller = revealScrollerOf({ scrollToOffset, getNativeScrollRef: () => host })
    expect(scroller?.node).toBe(host)
    scroller?.scrollToY(120)
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 120, animated: true })
  })

  it('scrolls a ScrollView by position', () => {
    const scrollTo = vi.fn()
    const scroller = revealScrollerOf({ scrollTo, getNativeScrollRef: () => host })
    scroller?.scrollToY(80)
    expect(scrollTo).toHaveBeenCalledWith({ y: 80, animated: true })
  })

  it('has no node to measure until the native scroll view is mounted, and no scroller for anything else', () => {
    expect(revealScrollerOf({ scrollTo: vi.fn(), getNativeScrollRef: () => null })?.node).toBeNull()
    expect(revealScrollerOf(null)).toBeNull()
    expect(revealScrollerOf({ measureInWindow: vi.fn() })).toBeNull()
  })
})
