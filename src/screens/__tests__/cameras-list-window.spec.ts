/**
 * The cameras tab must not realise the whole install on a cold start.
 *
 * `FlatList` defaults (windowSize 21, ten rows per 50 ms batch) mounted ~30
 * cards in the first three seconds on a 48-camera hub and kept the thread busy
 * until 3.7 s. The window is a constant in `cameras-list-window.ts` and the
 * screen must spread it onto its list — a constant nothing reads is the defect
 * again with a comment on it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAMERAS_LIST_WINDOW } from '../cameras-list-window.js'

/** React Native's own defaults — what the list used before. */
const FLATLIST_DEFAULTS = { initialNumToRender: 10, maxToRenderPerBatch: 10, windowSize: 21, updateCellsBatchingPeriod: 50 }

describe('cameras list window', () => {
  it('builds less ahead, in smaller batches, with a longer gap, than the defaults', () => {
    expect(CAMERAS_LIST_WINDOW.windowSize).toBeLessThan(FLATLIST_DEFAULTS.windowSize)
    expect(CAMERAS_LIST_WINDOW.maxToRenderPerBatch).toBeLessThan(FLATLIST_DEFAULTS.maxToRenderPerBatch)
    expect(CAMERAS_LIST_WINDOW.updateCellsBatchingPeriod).toBeGreaterThan(FLATLIST_DEFAULTS.updateCellsBatchingPeriod)
  })

  it('keeps enough lookahead that an ordinary flick lands on a built row', () => {
    expect(CAMERAS_LIST_WINDOW.windowSize).toBeGreaterThanOrEqual(3)
    expect(CAMERAS_LIST_WINDOW.initialNumToRender).toBeGreaterThanOrEqual(4)
  })

  it('is applied to the list on the cameras screen', () => {
    const source = readFileSync(new URL('../CamerasScreen.tsx', import.meta.url), 'utf8')
    expect(source).toContain('{...CAMERAS_LIST_WINDOW}')
    expect(source).toContain("from './cameras-list-window.js'")
  })
})
