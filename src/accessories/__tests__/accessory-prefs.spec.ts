/**
 * The local accessory document: additions, order, name, icon, hidden.
 *
 * Every reducer is pure and immutable; every gate here was made to go red
 * once by removing it (see the commit that introduced this file).
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACCESSORY_PREFS,
  addAccessoriesEntry,
  isEmptyAccessoryPrefs,
  moveAccessoryEntry,
  parseAccessoryPrefs,
  removeAccessoryEntry,
  setAccessoryAdditionsEntry,
  setAccessoryHiddenEntry,
  setAccessoryIconEntry,
  setAccessoryNameEntry,
  setAccessoryOrderEntry,
  type CameraAccessoryPrefs,
} from '../accessory-prefs.js'

const EMPTY = EMPTY_ACCESSORY_PREFS

describe('additions', () => {
  it('adds ids once, keeping first-seen order, and never mutates the input', () => {
    const next = addAccessoriesEntry(EMPTY, [12, 7, 12, 3.5, Number.NaN])
    expect(next.added).toEqual([12, 7])
    expect(EMPTY.added).toEqual([])
    expect(addAccessoriesEntry(next, [7, 9]).added).toEqual([12, 7, 9])
  })

  it('an addition that leaves the set takes its customisation and order slot with it', () => {
    let prefs = addAccessoriesEntry(EMPTY, [12, 7])
    prefs = setAccessoryNameEntry(prefs, 12, 'Porch light')
    prefs = setAccessoryOrderEntry(prefs, [12, 7, 500])
    const next = setAccessoryAdditionsEntry(prefs, [7])
    expect(next.added).toEqual([7])
    expect(next.byId).toEqual({})
    // 500 is not an addition — it is a server device's slot and stays.
    expect(next.order).toEqual([7, 500])
  })

  it('removeAccessoryEntry only ever removes a LOCAL addition', () => {
    const prefs = setAccessoryHiddenEntry(addAccessoriesEntry(EMPTY, [12]), 500, true)
    // 500 is server-linked (not in `added`): it can be hidden, never removed.
    expect(removeAccessoryEntry(prefs, 500)).toBe(prefs)
    expect(removeAccessoryEntry(prefs, 12).added).toEqual([])
    expect(removeAccessoryEntry(prefs, 12).byId).toEqual({ 500: { hidden: true } })
  })
})

describe('customisations', () => {
  it('a blank name clears the field and an entry that says nothing is dropped', () => {
    const named = setAccessoryNameEntry(EMPTY, 500, '  Garden  ')
    expect(named.byId).toEqual({ 500: { name: 'Garden' } })
    expect(setAccessoryNameEntry(named, 500, '   ').byId).toEqual({})
  })

  it('stores only an icon key this viewer can draw; anything else is refused', () => {
    const iconed = setAccessoryIconEntry(EMPTY, 500, 'flashlight')
    expect(iconed.byId).toEqual({ 500: { icon: 'flashlight' } })
    expect(setAccessoryIconEntry(EMPTY, 500, 'unicorn')).toBe(EMPTY)
    expect(setAccessoryIconEntry(iconed, 500, null).byId).toEqual({})
  })

  it('hidden is stored only as true; showing again drops the field', () => {
    const hidden = setAccessoryHiddenEntry(EMPTY, 500, true)
    expect(hidden.byId).toEqual({ 500: { hidden: true } })
    expect(setAccessoryHiddenEntry(hidden, 500, false).byId).toEqual({})
  })

  it('fields merge independently on one device', () => {
    let prefs = setAccessoryNameEntry(EMPTY, 500, 'Garden')
    prefs = setAccessoryIconEntry(prefs, 500, 'lamp')
    prefs = setAccessoryHiddenEntry(prefs, 500, true)
    expect(prefs.byId[500]).toEqual({ name: 'Garden', icon: 'lamp', hidden: true })
    expect(setAccessoryIconEntry(prefs, 500, null).byId[500]).toEqual({ name: 'Garden', hidden: true })
  })
})

describe('order', () => {
  it('moves relative to the order the panel is SHOWING and persists the whole of it', () => {
    const shown = [500, 501, 12]
    const up = moveAccessoryEntry(EMPTY, shown, 12, -1)
    expect(up.order).toEqual([500, 12, 501])
    const down = moveAccessoryEntry(up, [500, 12, 501], 500, 1)
    expect(down.order).toEqual([12, 500, 501])
  })

  it('refuses to move past either end, and an id not shown moves nowhere', () => {
    const shown = [500, 501]
    expect(moveAccessoryEntry(EMPTY, shown, 500, -1)).toBe(EMPTY)
    expect(moveAccessoryEntry(EMPTY, shown, 501, 1)).toBe(EMPTY)
    expect(moveAccessoryEntry(EMPTY, shown, 999, 1)).toBe(EMPTY)
  })
})

describe('parse', () => {
  it('round-trips a document and drops what it cannot read, field by field', () => {
    const stored: CameraAccessoryPrefs = {
      added: [12],
      order: [500, 12],
      byId: { 500: { name: 'Garden', icon: 'lamp' }, 12: { hidden: true } },
    }
    expect(parseAccessoryPrefs(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
    expect(
      parseAccessoryPrefs({
        added: ['x', 3],
        order: 'nope',
        byId: { 500: { name: '  ', icon: 'unicorn', hidden: 'yes' }, abc: { hidden: true }, 7: { hidden: true } },
      }),
    ).toEqual({ added: [3], order: [], byId: { 7: { hidden: true } } })
  })

  it('an empty or non-document value is absence, never an empty document', () => {
    expect(parseAccessoryPrefs(null)).toBeUndefined()
    expect(parseAccessoryPrefs('x')).toBeUndefined()
    expect(parseAccessoryPrefs({ added: [], order: [], byId: {} })).toBeUndefined()
    expect(isEmptyAccessoryPrefs(EMPTY)).toBe(true)
  })
})
