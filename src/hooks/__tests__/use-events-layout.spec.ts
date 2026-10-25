import { describe, it, expect } from 'vitest'
import { resolveEventsLayout, EVENTS_MAX_CONTENT_WIDTH } from '../events-layout-rules.js'

describe('resolveEventsLayout', () => {
  it('phone: a single base column → one-column rows, no detail pane', () => {
    const l = resolveEventsLayout({ columns: 1, wide: false })
    expect(l.mode).toBe('phone')
    expect(l.columns).toBe(1)
    expect(l.showDetailPane).toBe(false)
  })

  it('phone wins over wide when there is only one base column', () => {
    // Narrow-but-wide-flagged edge: 1 column can never split.
    const l = resolveEventsLayout({ columns: 1, wide: true })
    expect(l.mode).toBe('phone')
    expect(l.showDetailPane).toBe(false)
  })

  it('grid: multiple columns but not wide → masonry, no pane', () => {
    const l = resolveEventsLayout({ columns: 3, wide: false })
    expect(l.mode).toBe('grid')
    expect(l.columns).toBe(3)
    expect(l.showDetailPane).toBe(false)
  })

  it('split: wide + multiple columns → pane steals one column', () => {
    const l = resolveEventsLayout({ columns: 4, wide: true })
    expect(l.mode).toBe('split')
    expect(l.columns).toBe(3) // 4 - 1 for the detail pane
    expect(l.showDetailPane).toBe(true)
  })

  it('split floors the masonry at 2 columns when the base is only 2', () => {
    const l = resolveEventsLayout({ columns: 2, wide: true })
    expect(l.mode).toBe('split')
    expect(l.columns).toBe(2) // max(2, 2 - 1)
    expect(l.showDetailPane).toBe(true)
  })

  it('always caps content width for ultrawide centering', () => {
    for (const input of [
      { columns: 1, wide: false },
      { columns: 3, wide: false },
      { columns: 6, wide: true },
    ]) {
      expect(resolveEventsLayout(input).maxContentWidth).toBe(EVENTS_MAX_CONTENT_WIDTH)
    }
  })
})
