// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Platform, Text } from 'react-native'

import {
  beginControlDrag,
  CONTROL_DRAG_BRIDGE_SCRIPT,
  endControlDrag,
  isControlDragActive,
  parseControlDragMessage,
  useControlDragActive,
} from '../control-drag-lock.js'
import { SheetModal } from '../SheetModal.js'
import { SnapSheet } from '../SnapSheet.js'
import { mountScreen } from '../../../testing/mount.js'
import { detectedGestures } from '../../../testing/native-stubs/gesture-handler.js'

afterEach(() => {
  cleanup()
  while (isControlDragActive()) endControlDrag()
})

/** `enabled(...)` of the Pan inside the latest render's detected gestures. */
function lastPanEnabled(): unknown {
  const walk = (g: (typeof detectedGestures)[number]): unknown[] => [
    g.__args['enabled']?.[0],
    ...g.__children.flatMap(walk),
  ]
  const last = detectedGestures[detectedGestures.length - 1]
  return last === undefined ? undefined : walk(last).find((v) => v !== undefined)
}

describe('control drag lock', () => {
  it('is active from the first claim to the last release', () => {
    const { result } = renderHook(() => useControlDragActive())
    expect(result.current).toBe(false)
    act(() => beginControlDrag())
    act(() => beginControlDrag())
    expect(result.current).toBe(true)
    act(() => endControlDrag())
    expect(isControlDragActive()).toBe(true)
    act(() => endControlDrag())
    expect(result.current).toBe(false)
    act(() => endControlDrag())
    expect(isControlDragActive()).toBe(false)
  })

  it('parses only a well-formed control-drag message', () => {
    expect(parseControlDragMessage('{"type":"control-drag","active":true}')).toEqual({ active: true })
    expect(parseControlDragMessage('{"type":"card-ready","deviceId":3}')).toBeNull()
    expect(parseControlDragMessage('{"type":"control-drag"}')).toBeNull()
    expect(parseControlDragMessage('nope')).toBeNull()
  })

  it('the page bridge keys on touch-action: none and posts both edges', () => {
    expect(CONTROL_DRAG_BRIDGE_SCRIPT).toContain("touchAction==='none'")
    expect(CONTROL_DRAG_BRIDGE_SCRIPT).toContain('touchcancel')
  })

  it('the snap sheet pan stands down while a control drags', () => {
    const sheet = (): React.ReactElement =>
      React.createElement(SnapSheet, {
        snap: 'half',
        onSnapChange: () => undefined,
        heights: { collapsed: 80, half: 300, full: 600 },
        headerHeight: 40,
        children: React.createElement(Text, null, 'x'),
      })
    mountScreen(sheet())
    expect(lastPanEnabled()).toBe(true)
    act(() => beginControlDrag())
    expect(lastPanEnabled()).toBe(false)
    act(() => endControlDrag())
    expect(lastPanEnabled()).toBe(true)
  })

  it('the modal sheet close-drag stands down while a control drags', () => {
    const was = Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    try {
      mountScreen(
        React.createElement(SheetModal, {
          visible: true,
          onClose: () => undefined,
          backdropLabel: 'close',
          children: React.createElement(Text, null, 'x'),
        }),
      )
      expect(lastPanEnabled()).toBe(true)
      act(() => beginControlDrag())
      expect(lastPanEnabled()).toBe(false)
    } finally {
      Object.defineProperty(Platform, 'OS', { value: was, configurable: true })
    }
  })
})
