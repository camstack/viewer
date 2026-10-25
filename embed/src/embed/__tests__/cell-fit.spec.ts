/**
 * A cell that is no longer 16:9 must still show a 16:9 picture — WHOLE.
 *
 * Until spans existed the wall guaranteed `cellH === cellW / ASPECT`, so the
 * video filled its cell exactly and nothing had to decide what "fit" meant. A
 * spanned cell breaks that invariant by construction: 2×1 tracks is 32:9, 1×2 is
 * 16:18. The operator settled what happens then — the cell is free, the picture
 * keeps its own proportions inside it, bands where the space is left over, and
 * NOTHING is cut.
 *
 * "Nothing is cut" is the claim with teeth: `object-fit: cover` also fills the
 * cell and looks plausible, and it silently crops the sides of every wide cell.
 * So the assertions are on the fitted box's ASPECT and on it never exceeding the
 * cell, not on it covering the cell.
 */
import { describe, expect, it } from 'vitest'
import { fitInside, VIDEO_ASPECT } from '../cell-fit'

const A = VIDEO_ASPECT

describe('a cell the video already fills', () => {
  it('is used whole — the default wall must be pixel-identical to today', () => {
    // Exactly what `computeGridLayout` produces: cellH = cellW / ASPECT.
    const box = fitInside(640, 640 / A, A)
    expect(box).toEqual({ left: 0, top: 0, width: 640, height: 640 / A })
  })

  it('treats a sub-pixel difference as rounding, not as a band', () => {
    // Float division does not round-trip: `(w / A) * A` misses `w` by ~1e-13,
    // and a band nobody can see is still a compositing layer and an offset that
    // makes the default path differ from the one it must reproduce.
    const box = fitInside(640, 640 / A + 1e-9, A)
    expect(box.left).toBe(0)
    expect(box.top).toBe(0)
    expect(box.width).toBe(640)
  })
})

describe('a cell WIDER than the picture (a 2×1 span, 32:9)', () => {
  const cellW = 1280
  const cellH = 640 / A
  const box = fitInside(cellW, cellH, A)

  it('keeps the picture at 16:9', () => {
    expect(box.width / box.height).toBeCloseTo(A, 9)
  })

  it('fills the HEIGHT and leaves the leftover as two side bands', () => {
    expect(box.height).toBeCloseTo(cellH, 9)
    expect(box.width).toBeCloseTo(cellH * A, 9)
    expect(box.left).toBeCloseTo((cellW - box.width) / 2, 9)
    expect(box.top).toBe(0)
  })

  it('never spills outside the cell — no crop, in either direction', () => {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.left + box.width).toBeLessThanOrEqual(cellW + 1e-9)
    expect(box.top + box.height).toBeLessThanOrEqual(cellH + 1e-9)
  })
})

describe('a cell TALLER than the picture (a 1×2 span)', () => {
  const cellW = 640
  const cellH = (640 / A) * 2
  const box = fitInside(cellW, cellH, A)

  it('keeps the picture at 16:9 and bands it top and bottom', () => {
    expect(box.width / box.height).toBeCloseTo(A, 9)
    expect(box.width).toBeCloseTo(cellW, 9)
    expect(box.left).toBe(0)
    expect(box.top).toBeCloseTo((cellH - box.height) / 2, 9)
  })

  it('never spills outside the cell', () => {
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.top + box.height).toBeLessThanOrEqual(cellH + 1e-9)
  })
})

describe('degenerate cells', () => {
  it('an unmeasured cell fits nothing rather than a negative box', () => {
    expect(fitInside(0, 0, A)).toEqual({ left: 0, top: 0, width: 0, height: 0 })
    expect(fitInside(-10, 100, A)).toEqual({ left: 0, top: 0, width: 0, height: 0 })
  })

  it('a nonsense aspect falls back to filling the cell rather than vanishing', () => {
    expect(fitInside(100, 50, 0)).toEqual({ left: 0, top: 0, width: 100, height: 50 })
  })
})
