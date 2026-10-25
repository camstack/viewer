/**
 * The full picture a face was cut from: the track's native key frame, or
 * nothing — never another frame of the track with the box drawn in the wrong
 * place. And the wire narrowing that feeds it.
 */
import { describe, expect, it } from 'vitest'
import { faceFullPicture } from '../face-full-picture.js'
import { toFaceBox, toFaceInfo } from '../use-face-gallery.js'

const HUB = 'http://hub.test:8080'

describe('faceFullPicture', () => {
  it('is the key frame by its own media id, with the face box', () => {
    const box = { x: 10, y: 20, w: 30, h: 40 }
    expect(faceFullPicture({ keyFrameMediaId: 77, faceBbox: box }, HUB)).toEqual({
      uri: `${HUB}/addon/pipeline-analytics/event-media/m/77`,
      box,
    })
  })

  it('keeps the frame when the row predates the box', () => {
    expect(faceFullPicture({ keyFrameMediaId: 77 }, HUB)?.box).toBeUndefined()
  })

  it('is nothing when the hub kept no key frame', () => {
    expect(faceFullPicture({ faceBbox: { x: 1, y: 1, w: 1, h: 1 } }, HUB)).toBeNull()
  })

  it('is nothing without a hub address', () => {
    expect(faceFullPicture({ keyFrameMediaId: 77 }, null)).toBeNull()
  })
})

describe('the face row carries the key frame and the box off the wire', () => {
  const base = { faceId: 'f1', deviceId: 3, trackId: 't1', timestamp: 1, assigned: false }

  it('reads both when present', () => {
    const face = toFaceInfo({ ...base, keyFrameMediaId: 9, faceBbox: { x: 1, y: 2, w: 3, h: 4 } })
    expect(face?.keyFrameMediaId).toBe(9)
    expect(face?.faceBbox).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })

  it('drops a malformed or empty box and a non-numeric id', () => {
    const face = toFaceInfo({ ...base, keyFrameMediaId: '9', faceBbox: { x: 1, y: 2, w: 0, h: 4 } })
    expect(face?.keyFrameMediaId).toBeUndefined()
    expect(face?.faceBbox).toBeUndefined()
    expect(toFaceBox({ x: 1, y: 2, w: Number.NaN, h: 4 })).toBeUndefined()
    expect(toFaceBox(null)).toBeUndefined()
  })
})
