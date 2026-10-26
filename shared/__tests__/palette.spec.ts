import { describe, expect, it } from 'vitest'
import { bundledCamstack, paintHex } from '@camstack/types/client'
import {
  audioScaleColors,
  failureReason,
  paintKind,
  resolvePalettePaint,
} from '../palette.js'

describe('resolvePalettePaint', () => {
  it('keeps a ready hub swatch, and folds audio leaves onto the audio entry', () => {
    const base = bundledCamstack()
    const person = base.swatches.person
    if (person === undefined || person.form !== 'solid') throw new Error('bundled person swatch missing')
    const raw = { ...base, swatches: { ...base.swatches, person: { ...person, hex: '#112233' } } }
    const view = resolvePalettePaint(raw)
    expect(view.origin).toBe('hub')
    expect(view.reason).toBeNull()
    expect(paintKind(view, 'person')).toBe('#112233')
    expect(paintKind(view, 'audio-speech')).toBe(paintKind(view, 'audio'))
  })

  it('paints the bundled preset when the hub answers unknown, and keeps the reason', () => {
    const bundled = bundledCamstack()
    const view = resolvePalettePaint({ status: 'unknown', reason: 'no-provider' })
    expect(view.origin).toBe('unknown')
    expect(view.reason).toBe('no-provider')
    expect(paintKind(view, 'person')).toBe(paintHex(bundled.swatches, bundled.fallbacks, 'person'))
  })

  it('treats an unreadable payload as unknown', () => {
    const view = resolvePalettePaint({ status: 'ready' })
    expect(view.origin).toBe('unknown')
    expect(view.reason).toBe('unreadable')
  })
})

describe('audioScaleColors', () => {
  it('is six rising alphas on the audio hex', () => {
    const view = resolvePalettePaint(bundledCamstack())
    const scale = audioScaleColors(view)
    expect(scale).toHaveLength(6)
    const hex = paintKind(view, 'audio')
    const alphas = scale.map((color) => {
      expect(color.startsWith(hex)).toBe(true)
      return parseInt(color.slice(hex.length), 16)
    })
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas)
    expect(new Set(alphas).size).toBe(6)
  })
})

describe('failureReason', () => {
  it('keeps a short error message and collapses everything else', () => {
    expect(failureReason(new Error('nope'))).toBe('nope')
    expect(failureReason(new Error('x'.repeat(121)))).toBe('unreachable')
    expect(failureReason('x')).toBe('unreachable')
  })
})
