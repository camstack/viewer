import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ACTIVITY_HEADER_PX,
  ACTIVITY_CHROME_PX,
  activityPopoverMaxHeight,
  activityPopoverSize,
} from '../activity-popover-size.js'

describe('activityPopoverSize', () => {
  it('is shorter than the cap for a few rows — no half-window of empty space', () => {
    const tall = 1000
    const one = activityPopoverSize(1, null, tall)
    expect(one.sheetHeight).toBeLessThan(activityPopoverMaxHeight(tall))
    expect(activityPopoverSize(2, null, tall).sheetHeight).toBeGreaterThan(one.sheetHeight)
  })

  it('follows the MEASURED list once it has been laid out', () => {
    const size = activityPopoverSize(3, 200, 1000)
    expect(size.sheetHeight).toBe(ACTIVITY_HEADER_PX + ACTIVITY_CHROME_PX + 200)
  })

  it('stops at the cap and leaves the rest to scroll', () => {
    const size = activityPopoverSize(40, 5000, 1000)
    expect(size.sheetHeight).toBe(activityPopoverMaxHeight(1000))
    expect(size.maxBodyHeight).toBe(size.sheetHeight - ACTIVITY_HEADER_PX - ACTIVITY_CHROME_PX)
  })

  it('a short window shrinks the cap, never below a usable card', () => {
    expect(activityPopoverMaxHeight(300)).toBeGreaterThanOrEqual(ACTIVITY_HEADER_PX + 160)
    expect(activityPopoverMaxHeight(2000)).toBe(480)
  })

  it('the empty state is sized to itself, ignoring a stale measurement', () => {
    expect(activityPopoverSize(0, 900, 1000)).toEqual(activityPopoverSize(0, null, 1000))
  })
})

describe('the popover applies it', () => {
  const src = readFileSync(join(process.cwd(), 'src/activity/ActivityPopover.tsx'), 'utf8')
  it('feeds the size to the menu and keeps no fixed body height', () => {
    expect(src).toContain('activityPopoverSize(')
    expect(src).toContain('estimatedHeight={sheetHeight}')
    expect(src).toContain('maxHeight: maxBodyHeight')
    expect(src).not.toMatch(/height: bodyHeight/)
  })
})
