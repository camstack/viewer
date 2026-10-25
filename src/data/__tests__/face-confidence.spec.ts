import { describe, it, expect } from 'vitest'
import {
  faceConfidenceTone,
  formatFaceConfidence,
  FACE_CONFIDENCE_GOOD_THRESHOLD,
  FACE_CONFIDENCE_MEDIUM_THRESHOLD,
} from '../face-confidence.js'

describe('faceConfidenceTone — quality band for an auto-match score', () => {
  it('bands a high score as good (>= 0.75)', () => {
    expect(faceConfidenceTone(0.75)).toBe('good')
    expect(faceConfidenceTone(0.9)).toBe('good')
    expect(faceConfidenceTone(1)).toBe('good')
  })

  it('bands a mid score as medium (0.62 .. <0.75)', () => {
    expect(faceConfidenceTone(0.62)).toBe('medium')
    expect(faceConfidenceTone(0.7)).toBe('medium')
    expect(faceConfidenceTone(0.7499)).toBe('medium')
  })

  it('bands a below-threshold score as low (< 0.62)', () => {
    expect(faceConfidenceTone(0.61)).toBe('low')
    expect(faceConfidenceTone(0)).toBe('low')
  })

  it('uses the exported thresholds as the band boundaries', () => {
    expect(faceConfidenceTone(FACE_CONFIDENCE_GOOD_THRESHOLD)).toBe('good')
    expect(faceConfidenceTone(FACE_CONFIDENCE_MEDIUM_THRESHOLD)).toBe('medium')
    expect(faceConfidenceTone(FACE_CONFIDENCE_MEDIUM_THRESHOLD - 0.001)).toBe('low')
  })
})

describe('formatFaceConfidence — compact badge label', () => {
  it('formats a score alone as a whole percentage', () => {
    expect(formatFaceConfidence(0.62, undefined)).toBe('62%')
    expect(formatFaceConfidence(0.8, undefined)).toBe('80%')
  })

  it('rounds the percentage to the nearest whole', () => {
    expect(formatFaceConfidence(0.625, undefined)).toBe('63%') // .5 rounds up
    expect(formatFaceConfidence(0.624, undefined)).toBe('62%')
  })

  it('appends the native face size when known, rounded to px', () => {
    expect(formatFaceConfidence(0.62, 54)).toBe('62% · 54px')
    expect(formatFaceConfidence(0.9, 128.4)).toBe('90% · 128px')
  })

  it('omits the size when it is absent, zero, or non-finite', () => {
    expect(formatFaceConfidence(0.7, undefined)).toBe('70%')
    expect(formatFaceConfidence(0.7, 0)).toBe('70%')
    expect(formatFaceConfidence(0.7, Number.NaN)).toBe('70%')
  })

  it('returns null when there is no usable score (legacy rows / manual assignments)', () => {
    expect(formatFaceConfidence(undefined, 54)).toBeNull()
    expect(formatFaceConfidence(undefined, undefined)).toBeNull()
    expect(formatFaceConfidence(Number.NaN, 54)).toBeNull()
  })
})
