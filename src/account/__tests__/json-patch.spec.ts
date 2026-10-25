/** The touched-fields diff and its replay — the core of the LWW merge. */
import { describe, expect, it } from 'vitest'
import { applyJsonPatch, diffJson, jsonEqual } from '../json-patch.js'

describe('diffJson / applyJsonPatch', () => {
  it('equal values have no patch', () => {
    expect(diffJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toEqual([])
  })

  it('only the touched leaves are replayed onto a third document', () => {
    const base = { highlight: { motion: 'red', audio: 'blue' }, loop: true }
    const local = { highlight: { motion: 'green', audio: 'blue' }, loop: true }
    const remote = { highlight: { motion: 'red', audio: 'yellow' }, loop: false }
    expect(applyJsonPatch(remote, diffJson(base, local))).toEqual({
      highlight: { motion: 'green', audio: 'yellow' },
      loop: false,
    })
  })

  it('a removal is replayed as a removal; arrays are one value', () => {
    const base = { byId: { a: 1, b: 2 }, order: [1, 2] }
    const local = { byId: { a: 1 }, order: [2, 1] }
    const remote = { byId: { a: 1, b: 2, c: 3 }, order: [1, 2, 3] }
    expect(applyJsonPatch(remote, diffJson(base, local))).toEqual({ byId: { a: 1, c: 3 }, order: [2, 1] })
  })

  it('never mutates its input', () => {
    const remote = { a: { b: 1 } }
    applyJsonPatch(remote, [{ kind: 'set', path: ['a', 'b'], value: 2 }])
    expect(remote).toEqual({ a: { b: 1 } })
    expect(jsonEqual({ a: undefined }, {})).toBe(true)
  })
})
