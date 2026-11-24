/**
 * @vitest-environment jsdom
 *
 * After a rotation the player's wrapper has the NEW window's size in the same
 * commit — no touch needed (#700).
 *
 * The wrapper used to be sized by a Reanimated worklet capturing the window:
 * React held the new size, the worklet's write sat deferred, and the live
 * stream stayed half black until a tap flushed it. The size now comes from
 * React on a plain `View`.
 *
 * HONEST LIMIT: the test harness evaluates the worklet synchronously, so this
 * mount passes on the old code too — it pins the SIZES, not the defect. The
 * defect is pinned by source in `zoom-box-geometry.spec.ts` (no animated style
 * sizes the wrapper); only a device shows the deferred write itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPHONE_LANDSCAPE,
  IPHONE_PORTRAIT,
} from '../../../testing/viewport-control.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

/** The elements whose inline style is exactly this absolute box at the origin. */
function boxes(root: HTMLElement, w: number, h: number): readonly Element[] {
  return [...root.querySelectorAll('div')].filter((el) => {
    const s = (el as HTMLElement).style
    return s.position === 'absolute' && s.width === `${w}px` && s.height === `${h}px` && s.top === '0px'
  })
}

describe('the player wrapper follows the window on rotation', () => {
  it('portrait: 16:9 of the width; landscape: the whole window — in the same commit', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    const { container } = mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), {
      hub: { 'deviceManager.listAll': [{ id: 1, name: 'Front door', isCamera: true, online: true }] },
    })
    await act(async () => undefined)
    expect(boxes(container, 430, Math.round((430 * 9) / 16)).length + boxes(container, 430, (430 * 9) / 16).length)
      .toBeGreaterThan(0)

    act(() => {
      setTestViewport(IPHONE_LANDSCAPE)
    })

    expect(boxes(container, 932, 430).length).toBeGreaterThan(0)
  })
})
