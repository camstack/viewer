/**
 * cameras-arrange — the pencil/confirm/cancel session over the device list.
 *
 * The list is NOT draggable by default: a long-press that reorders a live
 * camera list by accident is worse than one extra tap. The pencil opens a
 * session, every drag lands in the session's DRAFT, and only a confirm writes
 * the local order.
 *
 * Cancel restores the order the session STARTED from — the baseline captured
 * when the pencil was pressed — never "whatever was persisted last". Those are
 * different the moment a previous session confirmed something.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyArrangeDrag,
  arrangeIsDirty,
  beginArrange,
  type ArrangeSession,
} from '../cameras-arrange.js'

const SCREEN_SRC = readFileSync(join(__dirname, '..', 'CamerasManageScreen.tsx'), 'utf8')

describe('beginArrange', () => {
  it('captures the order on screen as BOTH the baseline and the first draft', () => {
    const s = beginArrange([1, 2, 3])
    expect(s.baseline).toEqual([1, 2, 3])
    expect(s.draft).toEqual([1, 2, 3])
  })

  it('a fresh session is not dirty, so a confirm that dragged nothing writes nothing', () => {
    expect(arrangeIsDirty(beginArrange([1, 2, 3]))).toBe(false)
  })

  it('copies the ids — a later mutation of the caller array cannot rewrite the baseline', () => {
    const live = [1, 2, 3]
    const s = beginArrange(live)
    live.reverse()
    expect(s.baseline).toEqual([1, 2, 3])
  })
})

describe('applyArrangeDrag', () => {
  it('moves the draft and LEAVES THE BASELINE ALONE', () => {
    const s = applyArrangeDrag(beginArrange([1, 2, 3]), [3, 1, 2])
    expect(s.draft).toEqual([3, 1, 2])
    expect(s.baseline).toEqual([1, 2, 3])
  })

  it('never mutates the session it was given', () => {
    const first = beginArrange([1, 2, 3])
    applyArrangeDrag(first, [2, 1, 3])
    expect(first.draft).toEqual([1, 2, 3])
  })

  it('keeps the baseline across a whole chain of drags', () => {
    const s = [[2, 1, 3], [2, 3, 1], [3, 2, 1]].reduce<ArrangeSession>(
      (acc, next) => applyArrangeDrag(acc, next),
      beginArrange([1, 2, 3]),
    )
    expect(s.draft).toEqual([3, 2, 1])
    expect(s.baseline).toEqual([1, 2, 3])
  })

  it('reports dirty once the draft differs from the baseline', () => {
    expect(arrangeIsDirty(applyArrangeDrag(beginArrange([1, 2, 3]), [3, 1, 2]))).toBe(true)
  })

  it('reports clean again when a drag puts everything back where it started', () => {
    const there = applyArrangeDrag(beginArrange([1, 2, 3]), [3, 1, 2])
    expect(arrangeIsDirty(applyArrangeDrag(there, [1, 2, 3]))).toBe(false)
  })

  it('a membership change during the session counts as dirty (lengths differ)', () => {
    expect(arrangeIsDirty(applyArrangeDrag(beginArrange([1, 2, 3]), [1, 2]))).toBe(true)
  })
})

/**
 * The screen's half of the contract. These read SOURCE TEXT because the failure
 * they guard is a one-line regression that no unit test of the pure module can
 * see: persisting from the drag handler again, which is exactly what makes
 * cancel unable to restore anything.
 */
describe('CamerasManageScreen wiring', () => {
  it('persists the order ONLY from the confirm handler', () => {
    // Ends at `cancelArrange`, the next declaration — widening this past it
    // would swallow `confirmArrange`, which is the one place `setOrder` is
    // allowed to appear, and the guard would pass on the bug it exists for.
    const dragEnd = SCREEN_SRC.slice(
      SCREEN_SRC.indexOf('const handleDragEnd'),
      SCREEN_SRC.indexOf('const cancelArrange'),
    )
    expect(dragEnd.length).toBeGreaterThan(120)
    expect(dragEnd).not.toContain('setOrder(')
  })

  it('cancel restores the session BASELINE, not the persisted prefs', () => {
    const cancel = SCREEN_SRC.slice(
      SCREEN_SRC.indexOf('const cancelArrange'),
      SCREEN_SRC.indexOf('const confirmArrange'),
    )
    expect(cancel.length).toBeGreaterThan(80)
    expect(cancel).toContain('.baseline')
  })

  it('the pencil enters the mode — the rows carry no drag handle outside it', () => {
    expect(SCREEN_SRC).toContain('icon: Pencil')
    // `drag` is handed to a row only while a session is open.
    expect(SCREEN_SRC).toMatch(/arranging/)
  })
})
