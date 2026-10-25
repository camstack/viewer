import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fitToolbar,
  COMPACT_STEPS,
  DATE_WIDTH,
  FIT_CONTROL_SIZE,
  ROW_GAP,
  ROW_GAP_TIGHT,
  ROW_PADDING,
  ROW_PADDING_TIGHT,
  SMALL_CONTROL_SIZE,
  type ToolbarFitInput,
} from '../timeline-toolbar-fit.js'
import { drawerWidth } from '../landscape-drawer-geometry.js'

/** The widest real header: everything on, three status badges. */
const WIDEST: Omit<ToolbarFitInput, 'rowWidth'> = {
  showBack: true,
  actions: ['linked', 'ptz', 'settings', 'quality', 'camera'],
  statusBadges: 3,
}

/** The narrowest row width at which `step` is the one chosen. */
function narrowestFor(step: number, insetRight = 0): number {
  for (let w = 60; w < 1000; w++) {
    if (fitToolbar({ ...WIDEST, rowWidth: w, insetRight }).step === step) return w
  }
  throw new Error(`step ${step} is never chosen`)
}

const LAST = COMPACT_STEPS.length

describe('fitToolbar — compact in steps', () => {
  it("is today's look (step 0) before the row is measured", () => {
    expect(fitToolbar({ ...WIDEST, rowWidth: null })).toMatchObject({
      step: 0,
      gap: ROW_GAP,
      padding: ROW_PADDING,
      dateFormat: 'full',
      qualityIconOnly: false,
      controlSize: FIT_CONTROL_SIZE,
    })
  })

  it('is step 0 at full width, with the width the old row needed (portrait / wide unchanged)', () => {
    const fit = fitToolbar({ ...WIDEST, rowWidth: 600 })
    expect(fit.step).toBe(0)
    expect(fit.needed).toBe(36 + DATE_WIDTH.full + 3 * 28 + (4 * 36 + 44) + 6 * ROW_GAP)
  })

  it('the widest header at step 0 is wider than any landscape drawer', () => {
    const need = fitToolbar({ ...WIDEST, rowWidth: null }).needed
    expect(need).toBeGreaterThan(drawerWidth(844) - ROW_PADDING * 2)
    expect(need).toBeGreaterThan(drawerWidth(932) - ROW_PADDING * 2)
  })

  it('adds exactly one step at each boundary, cumulatively and in order', () => {
    const widths = [1, 2, 3, 4, 5].map((s) => narrowestFor(s))
    expect(widths).toEqual([...widths].sort((a, b) => b - a)) // deeper step = narrower row

    expect(fitToolbar({ ...WIDEST, rowWidth: widths[0] })).toMatchObject({
      gap: ROW_GAP_TIGHT,
      padding: ROW_PADDING_TIGHT,
      dateFormat: 'full',
      qualityIconOnly: false,
      controlSize: 36,
    })
    expect(fitToolbar({ ...WIDEST, rowWidth: widths[1] })).toMatchObject({
      gap: ROW_GAP_TIGHT,
      dateFormat: 'short',
      qualityIconOnly: false,
      controlSize: 36,
    })
    expect(fitToolbar({ ...WIDEST, rowWidth: widths[2] })).toMatchObject({
      dateFormat: 'day',
      qualityIconOnly: false,
      controlSize: 36,
    })
    expect(fitToolbar({ ...WIDEST, rowWidth: widths[3] })).toMatchObject({
      dateFormat: 'day',
      qualityIconOnly: true,
      controlSize: 36,
    })
    expect(fitToolbar({ ...WIDEST, rowWidth: widths[4] })).toMatchObject({
      dateFormat: 'day',
      qualityIconOnly: true,
      controlSize: SMALL_CONTROL_SIZE,
    })
  })

  it('stops at the first step that fits, to the point', () => {
    const need0 = fitToolbar({ ...WIDEST, rowWidth: null }).needed
    expect(fitToolbar({ ...WIDEST, rowWidth: need0 + ROW_PADDING * 2 }).step).toBe(0)
    expect(fitToolbar({ ...WIDEST, rowWidth: need0 + ROW_PADDING * 2 - 1 }).step).toBe(1)
  })

  it('the notch inset narrows the budget and so deepens the step', () => {
    const w = narrowestFor(2)
    expect(fitToolbar({ ...WIDEST, rowWidth: w }).step).toBe(2)
    expect(fitToolbar({ ...WIDEST, rowWidth: w, insetRight: 47 }).step).toBeGreaterThan(2)
  })

  it('an extreme narrow width is the last step with nothing hidden', () => {
    const fit = fitToolbar({ ...WIDEST, rowWidth: 120 })
    expect(fit.step).toBe(LAST)
    expect(fit).toMatchObject({ controlSize: SMALL_CONTROL_SIZE, qualityIconOnly: true, dateFormat: 'day' })
    // The fit has no way to hide a button or a badge, and still counts all of them.
    expect(Object.keys(fit).sort()).toEqual(
      ['controlSize', 'dateFormat', 'gap', 'needed', 'padding', 'qualityIconOnly', 'step'].sort(),
    )
    expect(fit.needed).toBe(30 + DATE_WIDTH.day + 3 * 23 + 5 * 30 + 6 * ROW_GAP_TIGHT)
  })

  it.each([
    ['844x390 phone landscape', drawerWidth(844)],
    ['932x430 phone landscape', drawerWidth(932)],
  ])('%s: compacts (never the step-0 row that used to clip)', (_name, rowWidth) => {
    expect(fitToolbar({ ...WIDEST, rowWidth }).step).toBeGreaterThan(0)
  })

  it('a header with no actions and no badges needs no compacting in a normal row', () => {
    expect(fitToolbar({ showBack: true, actions: [], statusBadges: 0, rowWidth: 200 }).step).toBe(0)
  })

  it('the quality step saves nothing when there is no quality chip', () => {
    const input = { showBack: true, actions: ['camera'], statusBadges: 0, rowWidth: 100 } as const
    expect(fitToolbar(input).needed).toBe(30 + DATE_WIDTH.day + 30 + 3 * ROW_GAP_TIGHT)
  })
})

describe('TimelineToolbarInline is wired to the fit', () => {
  const src = readFileSync(join(__dirname, '..', 'TimelineToolbarInline.tsx'), 'utf8')
  it('measures its row, compacts and spends the notch inset — no overflow menu', () => {
    expect(src).toContain('fitToolbar(')
    expect(src).toContain('onLayout={onRowLayout}')
    expect(src).toContain('insets.right')
    expect(src).toContain('fit.dateFormat')
    expect(src).toContain('fit.qualityIconOnly')
    expect(src).toContain('fit.controlSize')
    expect(src).not.toContain('useHeaderOverflowMenu')
    expect(src).not.toContain('MoreHorizontal')
    expect(src).not.toContain('foldedItems')
  })
})
