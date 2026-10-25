/**
 * The review tile's rules (People, Plates): which pieces render for a display
 * choice, what each page's row says, the defaults, and the settings writes the
 * eye makes. Pure — the mount spec beside it checks the drawing.
 */
import { describe, expect, it } from 'vitest'
import type { FaceReviewRow } from '../../../data/face-cluster-review.js'
import type { PlateReviewRow } from '../../../data/plate-review.js'
import { DEFAULTS } from '../../../store/settings-store.js'
import {
  DEFAULT_REVIEW_TILE_DISPLAY,
  faceReviewTileContent,
  plateReviewTileContent,
  reviewDisplayWrites,
  reviewTileDisplayFor,
  reviewTilePieces,
  sameReviewTileContent,
  setReviewTileDetail,
} from '../review-tile.js'

function face(over: Partial<FaceReviewRow> = {}): FaceReviewRow {
  return {
    faceId: 'f1',
    deviceId: 101,
    cameraName: 'MARK-front-door',
    trackId: 't1',
    timestamp: 1_789_936_000_000,
    cropUrl: undefined,
    base64: undefined,
    status: 'unassigned',
    assignedIdentityName: undefined,
    suggestedIdentityId: undefined,
    suggestedIdentityName: undefined,
    suggestedMatchScore: undefined,
    certainty: undefined,
    ...over,
  }
}

function plate(over: Partial<PlateReviewRow> = {}): PlateReviewRow {
  return {
    plateId: 'p1',
    deviceId: 102,
    cameraName: 'MARK-Cancello',
    trackId: 't2',
    timestamp: 1_789_936_000_000,
    text: 'AB123CD',
    score: 0.92,
    corrected: false,
    cropUrl: undefined,
    base64: undefined,
    status: 'unassigned',
    vehicleId: undefined,
    vehicleName: undefined,
    ...over,
  }
}

describe('display defaults', () => {
  it('shows the time and not the camera, on both pages', () => {
    expect(DEFAULT_REVIEW_TILE_DISPLAY).toEqual({ showDate: true, showCamera: false })
    expect(reviewTileDisplayFor('faces', DEFAULTS.review)).toEqual(DEFAULT_REVIEW_TILE_DISPLAY)
    expect(reviewTileDisplayFor('plates', DEFAULTS.review)).toEqual(DEFAULT_REVIEW_TILE_DISPLAY)
  })
})

describe('reviewTilePieces — what renders', () => {
  const content = { title: 'MARK-Alice', camera: 'MARK-front-door' }
  it.each([
    [{ showDate: true, showCamera: false }, '10:22', undefined],
    [{ showDate: false, showCamera: true }, undefined, 'MARK-front-door'],
    [{ showDate: true, showCamera: true }, '10:22', 'MARK-front-door'],
    [{ showDate: false, showCamera: false }, undefined, undefined],
  ])('%o → chip %s, where %s', (display, chip, where) => {
    const pieces = reviewTilePieces(display, content, '10:22')
    expect(pieces.timeChip).toBe(chip)
    expect(pieces.where).toBe(where)
  })
  it('the accessible name keeps everything, whatever is hidden', () => {
    expect(reviewTilePieces({ showDate: false, showCamera: false }, content, '10:22').accessibilityLabel).toBe(
      'MARK-Alice · MARK-front-door · 10:22',
    )
  })
})

describe('the eye writes only what changed, to its own page', () => {
  it('sets one detail and leaves the other', () => {
    expect(setReviewTileDetail({ showDate: true, showCamera: false }, 'camera', true)).toEqual({ showDate: true, showCamera: true })
    expect(setReviewTileDetail({ showDate: true, showCamera: false }, 'date', false)).toEqual({ showDate: false, showCamera: false })
  })
  it('maps a change to the page\'s own keys', () => {
    const prev = DEFAULT_REVIEW_TILE_DISPLAY
    expect(reviewDisplayWrites('faces', prev, { showDate: true, showCamera: true })).toEqual([{ key: 'facesShowCamera', value: true }])
    expect(reviewDisplayWrites('plates', prev, { showDate: false, showCamera: false })).toEqual([{ key: 'platesShowDate', value: false }])
    expect(reviewDisplayWrites('plates', prev, prev)).toEqual([])
  })
  it('reads each page from its own keys', () => {
    const prefs = { ...DEFAULTS.review, platesShowCamera: true }
    expect(reviewTileDisplayFor('plates', prefs).showCamera).toBe(true)
    expect(reviewTileDisplayFor('faces', prefs).showCamera).toBe(false)
  })
})

describe('faceReviewTileContent', () => {
  it('a suggestion: square, two rows, its name, certainty badge, bar and Confirm', () => {
    const c = faceReviewTileContent(
      face({ status: 'suggested', suggestedIdentityName: 'MARK-Alice', suggestedMatchScore: 0.8, certainty: 'probable' }),
      'Unassigned',
    )
    expect(c).toMatchObject({
      shape: 'square',
      rows: 'two',
      title: 'MARK-Alice',
      titleMuted: false,
      titleMono: false,
      badge: { kind: 'certainty', certainty: 'probable' },
      confidence: { score: 0.8, certainty: 'probable' },
      confirm: true,
      settled: false,
    })
  })
  it('assigned: muted name, no badge, no Confirm, settled', () => {
    const c = faceReviewTileContent(face({ status: 'assigned', assignedIdentityName: 'MARK-Anna' }), 'Unassigned')
    expect(c).toMatchObject({ title: 'MARK-Anna', titleMuted: true, badge: undefined, confirm: false, settled: true })
  })
  it('unassigned: the page\'s word, nothing to confirm; the camera falls back to the device id', () => {
    const c = faceReviewTileContent(face({ cameraName: undefined }), 'MARK-Unassigned')
    expect(c).toMatchObject({ title: 'MARK-Unassigned', confirm: false, confidence: undefined, camera: '#101' })
  })
})

describe('plateReviewTileContent', () => {
  it('a 16:9 frame, one row, the text monospaced, always a confidence bar', () => {
    const c = plateReviewTileContent(plate())
    expect(c).toMatchObject({ shape: 'frame', rows: 'one', title: 'AB123CD', titleMono: true, badge: undefined, confirm: false })
    expect(c.confidence?.score).toBe(0.92)
  })
  it('an empty read is a dash, never a blank title', () => {
    expect(plateReviewTileContent(plate({ text: '' })).title).toBe('—')
  })
  it('the vehicle is the badge: outlined when suggested (with Confirm), settled when assigned', () => {
    expect(plateReviewTileContent(plate({ status: 'suggested', vehicleName: 'MARK-Panda' }))).toMatchObject({
      badge: { kind: 'label', label: 'MARK-Panda', settled: false },
      confirm: true,
    })
    expect(plateReviewTileContent(plate({ status: 'assigned', vehicleName: 'MARK-Panda' }))).toMatchObject({
      badge: { kind: 'label', label: 'MARK-Panda', settled: true },
      settled: true,
    })
  })
})

describe('sameReviewTileContent', () => {
  it('equal when rebuilt from the same row, different when a piece moved', () => {
    const row = face({ status: 'suggested', suggestedIdentityName: 'A', suggestedMatchScore: 0.8, certainty: 'probable' })
    expect(sameReviewTileContent(faceReviewTileContent(row, 'U'), faceReviewTileContent(row, 'U'))).toBe(true)
    expect(
      sameReviewTileContent(faceReviewTileContent(row, 'U'), faceReviewTileContent({ ...row, certainty: 'certain' }, 'U')),
    ).toBe(false)
    expect(sameReviewTileContent(plateReviewTileContent(plate()), plateReviewTileContent(plate({ score: 0.5 })))).toBe(false)
  })
})
