/**
 * The session workspace, by value.
 *
 * "Add to view" writes here and nothing renders it yet — the wall is Fase F of
 * `docs/2026-09-01-tablet-multi-camera-workspace-design.md`. That is exactly why
 * this file exists: the shape has to be the one that phase reads, and the only
 * way to hold a not-yet-rendered contract still is to assert it by value.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_WORKSPACE,
  addMember,
  isMember,
  reconcileMembers,
  removeMember,
  resizeMember,
  setMembers,
  setPrimary,
} from '../workspace.js'

describe('adding', () => {
  it('keeps the order the operator added them in — the order IS the geometry', () => {
    const s = addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7)
    expect(s.members).toEqual([3, 1, 7])
  })

  it('the first member becomes the primary, so no singular control is orphaned', () => {
    expect(addMember(EMPTY_WORKSPACE, 5).primaryId).toBe(5)
  })

  it('a later add does NOT steal the primary', () => {
    const s = addMember(addMember(EMPTY_WORKSPACE, 5), 6)
    expect(s.primaryId).toBe(5)
  })

  it('is idempotent, and returns the same object so no subscriber re-renders', () => {
    const s = addMember(EMPTY_WORKSPACE, 5)
    expect(addMember(s, 5)).toBe(s)
  })

  it('refuses a non-id', () => {
    expect(addMember(EMPTY_WORKSPACE, Number.NaN)).toBe(EMPTY_WORKSPACE)
  })
})

describe('removing', () => {
  const three = addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7)

  it('drops the member and keeps the rest in order', () => {
    expect(removeMember(three, 1).members).toEqual([3, 7])
  })

  it('moves the primary to the first survivor rather than leaving it dangling', () => {
    expect(removeMember(three, 3).primaryId).toBe(1)
  })

  it('leaves the primary alone when someone else went', () => {
    expect(removeMember(three, 7).primaryId).toBe(3)
  })

  it('the last member out empties the workspace, primary included', () => {
    expect(removeMember(addMember(EMPTY_WORKSPACE, 5), 5)).toEqual(EMPTY_WORKSPACE)
  })

  it('removing a non-member changes nothing', () => {
    expect(removeMember(three, 99)).toBe(three)
  })
})

describe('the primary', () => {
  const two = addMember(addMember(EMPTY_WORKSPACE, 3), 1)

  it('can be pointed at another member', () => {
    expect(setPrimary(two, 1).primaryId).toBe(1)
  })

  it('cannot be a camera that is not in the view', () => {
    expect(setPrimary(two, 99)).toBe(two)
  })
})

describe('reconciliation against the known cameras', () => {
  const three = addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7)

  it('drops members the camera list no longer has', () => {
    expect(reconcileMembers(three, [3, 7]).members).toEqual([3, 7])
  })

  it('re-homes the primary when it was the one that went', () => {
    expect(reconcileMembers(three, [1, 7]).primaryId).toBe(1)
  })

  it('empties when nothing survives', () => {
    expect(reconcileMembers(three, [])).toEqual(EMPTY_WORKSPACE)
  })

  it('returns the same object when nothing changed', () => {
    expect(reconcileMembers(three, [3, 1, 7, 9])).toBe(three)
  })
})

describe('membership', () => {
  it('answers the shelf button', () => {
    const s = addMember(EMPTY_WORKSPACE, 5)
    expect(isMember(s, 5)).toBe(true)
    expect(isMember(s, 6)).toBe(false)
  })
})

describe('resizing a cell', () => {
  const three = addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7)

  it('records a size in TRACKS, keyed by camera', () => {
    expect(resizeMember(three, 1, { cw: 2, ch: 1 }).cells).toEqual({ 1: { cw: 2, ch: 1 } })
  })

  it('leaves every other camera exactly as it was', () => {
    const s = resizeMember(three, 1, { cw: 2, ch: 2 })
    expect(s.members).toBe(three.members)
    expect(s.cells[3]).toBeUndefined()
    expect(s.cells[7]).toBeUndefined()
  })

  it('stores the DEFAULT as absence, so "nothing was arranged" is expressible', () => {
    // The whole compat story rests on it: an empty map is the wall that ships,
    // and a map full of 1×1 entries would make that indistinguishable from an
    // arrangement the operator made.
    const resized = resizeMember(three, 1, { cw: 3, ch: 1 })
    expect(resizeMember(resized, 1, { cw: 1, ch: 1 }).cells).toEqual({})
  })

  it('refuses a span for a camera that is not in the view', () => {
    expect(resizeMember(three, 99, { cw: 2, ch: 1 })).toBe(three)
  })

  it('clamps a nonsense span instead of storing it', () => {
    expect(resizeMember(three, 1, { cw: 0, ch: -4 }).cells).toEqual({})
    expect(resizeMember(three, 1, { cw: 2.4, ch: Number.NaN }).cells).toEqual({
      1: { cw: 2, ch: 1 },
    })
  })

  it('returns the same object for a no-op, so no subscriber re-renders', () => {
    const resized = resizeMember(three, 1, { cw: 2, ch: 1 })
    expect(resizeMember(resized, 1, { cw: 2, ch: 1 })).toBe(resized)
    expect(resizeMember(three, 1, { cw: 1, ch: 1 })).toBe(three)
  })
})

describe('a size never outlives the camera it describes', () => {
  const arranged = resizeMember(
    addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7),
    1,
    { cw: 2, ch: 2 },
  )

  it('removing the camera drops its span', () => {
    // Otherwise re-adding it later would silently restore a size the operator
    // has no memory of choosing, on a wall they built fresh.
    expect(removeMember(arranged, 1).cells).toEqual({})
  })

  it('reconciling away a camera drops its span too', () => {
    expect(reconcileMembers(arranged, [3, 7]).cells).toEqual({})
  })

  it('emptying the view empties the arrangement', () => {
    expect(removeMember(removeMember(removeMember(arranged, 1), 3), 7)).toEqual(EMPTY_WORKSPACE)
  })
})

describe('setting the whole view at once', () => {
  const three = addMember(addMember(addMember(EMPTY_WORKSPACE, 3), 1), 7)

  it('the given cameras BECOME the members — the ones before are not kept', () => {
    // The panel's confirm states a whole view. The shelf card is what ADDS one
    // camera at a time, and it is the control that reports what is already in.
    expect(setMembers(three, [9, 5]).members).toEqual([9, 5])
  })

  it('keeps the primary when it survived the change', () => {
    // `three`'s primary is 3 (the first added). It is still in the new view, so
    // re-stating the view must not move what the singular controls act on.
    expect(setMembers(three, [7, 3]).primaryId).toBe(3)
  })

  it('re-homes the primary to the first of the new view when it did not', () => {
    expect(setMembers(three, [9, 5]).primaryId).toBe(9)
  })

  it('drops the spans of cameras the new view does not have', () => {
    const sized = resizeMember(three, 7, { cw: 2, ch: 1 })
    expect(setMembers(sized, [3, 1]).cells).toEqual({})
    expect(setMembers(sized, [7, 1]).cells).toEqual({ 7: { cw: 2, ch: 1 } })
  })

  it('an empty view is the empty workspace, primary included', () => {
    expect(setMembers(three, [])).toEqual(EMPTY_WORKSPACE)
  })

  it('collapses duplicates and ignores nonsense ids', () => {
    expect(setMembers(EMPTY_WORKSPACE, [5, 5, Number.NaN, 9]).members).toEqual([5, 9])
  })

  it('returns the SAME object for the view it already has — one write, no render', () => {
    expect(setMembers(three, [3, 1, 7])).toBe(three)
  })
})
