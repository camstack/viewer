import { describe, expect, it } from 'vitest'
import { parsePlateInfo, mediaIdFromCropUrl } from '../use-track-plate.js'

describe('mediaIdFromCropUrl — parse the row id back off a /m/<id> URL (D482)', () => {
  it('parses the id from a hub-stamped crop URL', () => {
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/m/1')).toBe(1)
  })

  it('strips a query string before parsing', () => {
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/m/7?variant=thumb')).toBe(7)
  })

  it('is undefined for a legacy pre-D482 URL (no /m/ segment)', () => {
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/plate:1:crop')).toBeUndefined()
  })

  it('is undefined for an owner-form URL — it names no row', () => {
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/o/track/t1')).toBeUndefined()
  })

  it('is undefined for a non-numeric remainder, never 0', () => {
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/m/')).toBeUndefined()
    expect(mediaIdFromCropUrl('/addon/pipeline-analytics/event-media/m/abc')).toBeUndefined()
  })
})

describe('parsePlateInfo — plateGallery.getPlateByTrack row narrowing', () => {
  it('accepts a cropUrl without inline bytes', () => {
    const p = parsePlateInfo({
      plateId: 'plate-t1',
      timestamp: 9,
      text: 'AB123CD',
      cropUrl: '/addon/pipeline-analytics/event-media/m/1',
    })
    expect(p).toEqual({
      plateId: 'plate-t1',
      timestamp: 9,
      text: 'AB123CD',
      cropUrl: '/addon/pipeline-analytics/event-media/m/1',
      mediaId: 1,
      base64: undefined,
    })
  })

  it('still parses a legacy inline crop', () => {
    const p = parsePlateInfo({
      plateId: 'plate-t1',
      timestamp: 9,
      text: 'AB123CD',
      base64: 'PLATEB64',
    })
    expect(p?.base64).toBe('PLATEB64')
    expect(p?.cropUrl).toBeUndefined()
    expect(p?.mediaId).toBeUndefined()
  })

  it('rejects a row with neither cropUrl nor bytes', () => {
    expect(parsePlateInfo({ plateId: 'plate-t1', timestamp: 9, text: 'X' })).toBeNull()
  })
})
