import { describe, it, expect } from 'vitest'
import { isReadRow, parseScopeRowHead, parseScopeRowHeads, scopeRowsOf } from '../scope-rows.js'

/**
 * The boundary between the hub's batch answer and the timeline's knowledge.
 *
 * Everything here leans the same way: when the wire says something this build
 * cannot understand, the camera ends up UNKNOWN rather than "read, and empty".
 * The opposite lean is the whole defect the `read` tag exists to prevent, and a
 * parser is exactly where it would be reintroduced by accident.
 */
describe('scopeRowsOf', () => {
  it('an absent cap answers null — a real answer, and an empty one', () => {
    expect(scopeRowsOf(null)).toEqual([])
    expect(scopeRowsOf(undefined)).toEqual([])
  })

  it('anything that is not an array carries no rows', () => {
    expect(scopeRowsOf({ rows: [] })).toEqual([])
    expect(scopeRowsOf('nope')).toEqual([])
  })
})

describe('parseScopeRowHead', () => {
  it('reads the two fields every batch row carries', () => {
    expect(parseScopeRowHead({ deviceId: 7, read: 'read', ranges: [] })).toEqual({
      deviceId: 7,
      read: 'read',
    })
    expect(parseScopeRowHead({ deviceId: 7, read: 'unreadable', ranges: [] })).toEqual({
      deviceId: 7,
      read: 'unreadable',
    })
  })

  it('refuses a row with no device — it could not be matched to an ask anyway', () => {
    expect(parseScopeRowHead({ read: 'read' })).toBeNull()
    expect(parseScopeRowHead({ deviceId: '7', read: 'read' })).toBeNull()
  })

  it('refuses a `read` value this build does not know, rather than assuming the safe-looking one', () => {
    // A future hub adding a third verdict must leave the camera UNKNOWN here.
    // Defaulting to `'read'` would let a value we cannot interpret claim that
    // the camera answered and had nothing.
    expect(parseScopeRowHead({ deviceId: 7, read: 'partial' })).toBeNull()
    expect(parseScopeRowHead({ deviceId: 7 })).toBeNull()
  })
})

describe('parseScopeRowHeads', () => {
  it('keeps wire order and drops what it cannot read', () => {
    expect(
      parseScopeRowHeads([
        { deviceId: 3, read: 'read' },
        'garbage',
        { deviceId: 4, read: 'unreadable' },
      ]),
    ).toEqual([
      { deviceId: 3, read: 'read' },
      { deviceId: 4, read: 'unreadable' },
    ])
  })
})

describe('isReadRow — the gate on folding a payload into a union', () => {
  it('only an explicit `read` row may contribute', () => {
    expect(isReadRow({ deviceId: 1, read: 'read', ranges: [] })).toBe(true)
    expect(isReadRow({ deviceId: 1, read: 'unreadable', ranges: [] })).toBe(false)
    expect(isReadRow({ deviceId: 1, ranges: [] })).toBe(false)
    expect(isReadRow(null)).toBe(false)
  })
})
