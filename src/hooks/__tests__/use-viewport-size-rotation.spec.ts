/**
 * @vitest-environment jsdom
 *
 * planning#748 through the hook: settled landscape -> the half-way frame of a
 * rotation back to portrait (new width, old height) -> a coherent pair.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useViewportSize } from '../use-viewport-size.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { setTestViewport } from '../../testing/viewport-control.js'

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

describe('useViewportSize through a rotation', () => {
  it('holds the settled viewport on a half-way frame, then follows the coherent pair', () => {
    setTestPlatform('ios')
    setTestViewport({ width: 932, height: 430 })
    const { result } = renderHook(() => useViewportSize())
    expect(result.current).toMatchObject({ width: 932, height: 430 })

    // Back to portrait: the window is a mid-update 430x700, the frame has the new
    // width and the old height.
    act(() => setTestViewport({ width: 430, height: 700, frameWidth: 430, frameHeight: 430 }))
    expect(result.current).toMatchObject({ width: 932, height: 430, source: 'held' })

    act(() => setTestViewport({ width: 430, height: 932 }))
    expect(result.current).toMatchObject({ width: 430, height: 932, source: 'frame' })
  })
})
