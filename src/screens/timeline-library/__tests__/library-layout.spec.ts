import { describe, expect, it } from 'vitest'

import {
  COLUMN_MIN_WIDTH,
  STRIP_COLLAPSED_HEIGHT,
  clampColumnWidth,
  clampStripHeight,
  resolveLibraryArrangement,
  stripShowsGrid,
} from '../library-layout.js'

const view = (width: number, height: number, isWeb: boolean, screenMinSide?: number) => ({
  width,
  height,
  isWeb,
  screenMinSide,
})

describe('library arrangement', () => {
  it('a phone gets the strip, in portrait and landscape', () => {
    expect(resolveLibraryArrangement(view(390, 844, false, 390))).toBe('strip')
    expect(resolveLibraryArrangement(view(844, 390, false, 390))).toBe('strip')
    expect(resolveLibraryArrangement(view(390, 844, true))).toBe('strip')
  })
  it('a tablet and a desktop window get the right column', () => {
    expect(resolveLibraryArrangement(view(1024, 768, false, 768))).toBe('column')
    expect(resolveLibraryArrangement(view(768, 1024, false, 768))).toBe('column')
    expect(resolveLibraryArrangement(view(1440, 900, true))).toBe('column')
  })
})

describe('strip height', () => {
  it('starts collapsed: a strip, not the grid', () => {
    expect(stripShowsGrid(STRIP_COLLAPSED_HEIGHT)).toBe(false)
  })
  it('expanding clamps at three quarters of the window', () => {
    expect(clampStripHeight(900, 844)).toBe(633)
    expect(clampStripHeight(10, 844)).toBe(STRIP_COLLAPSED_HEIGHT)
    expect(stripShowsGrid(633)).toBe(true)
  })
  it('any height in between is a height the strip keeps (no snapping)', () => {
    expect(clampStripHeight(150, 844)).toBe(150)
    expect(clampStripHeight(300, 844)).toBe(300)
  })
})

describe('column width', () => {
  it('clamps between the floor and three quarters of the window', () => {
    expect(clampColumnWidth(40, 1440)).toBe(COLUMN_MIN_WIDTH)
    expect(clampColumnWidth(280, 1440)).toBe(280)
    expect(clampColumnWidth(900, 1440)).toBe(900)
    expect(clampColumnWidth(2000, 1440)).toBe(1080)
    expect(clampColumnWidth(2000, 1024)).toBe(768)
  })
})
