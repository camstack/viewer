import { describe, it, expect, vi } from 'vitest'

import {
  SNAPSHOT_MAX_EDGE,
  dataUrlBody,
  snapshotSize,
  takeSnapshot,
} from '../frame-snapshot.js'

describe('snapshotSize', () => {
  it('keeps a frame at or under the cap as it is', () => {
    expect(snapshotSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  it('scales a 4K frame DOWN to the cap, keeping the aspect', () => {
    const size = snapshotSize(3840, 2160)
    expect(size.width).toBe(SNAPSHOT_MAX_EDGE)
    expect(size.height).toBe(Math.round((2160 * SNAPSHOT_MAX_EDGE) / 3840))
  })

  it('caps the long edge of a portrait frame too', () => {
    expect(snapshotSize(2160, 3840).height).toBe(SNAPSHOT_MAX_EDGE)
  })
})

describe('dataUrlBody', () => {
  it('takes the base64 after the comma, and nothing else', () => {
    expect(dataUrlBody('data:image/jpeg;base64,QUJD')).toBe('QUJD')
    expect(dataUrlBody('QUJD')).toBeNull()
    expect(dataUrlBody('http://x/y,z')).toBeNull()
  })
})

describe('takeSnapshot', () => {
  it('answers an error, with the request id, when there is no video', () => {
    const emit = vi.fn()
    takeSnapshot({ emit, getVideo: () => null }, 's1')
    expect(emit).toHaveBeenCalledWith({ type: 'snapshotError', id: 's1', message: 'no frame' })
  })

  it('answers an error for a video with no picture yet', () => {
    const emit = vi.fn()
    const video = { videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement
    takeSnapshot({ emit, getVideo: () => video }, 's2')
    expect(emit).toHaveBeenCalledWith({ type: 'snapshotError', id: 's2', message: 'no frame' })
  })
})
