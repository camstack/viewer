import { describe, it, expect } from 'vitest'
import { listViewportReport, SnapshotViewportRegistry } from '../snapshot-viewport.js'

describe('listViewportReport', () => {
  // The hosted PWA measured it: react-native-web's FlatList reported its first
  // viewable items ~15 s after mount, and until then the Cameras list voted EVERY
  // camera hidden — so `getSnapshotLinks` was not sent at all and no tile could
  // paint. A list that has not measured yet knows nothing about what is on
  // screen, and must not vote.
  it('casts no vote before the list has reported viewability', () => {
    expect(listViewportReport([103, 586, 587], null, [])).toBeNull()
  })

  it('leaves every camera demandable while the list has not measured', () => {
    const registry = new SnapshotViewportRegistry()
    const report = listViewportReport([103, 586], null, [])
    if (report !== null) registry.report('cameras-list', report)
    expect(registry.isDemandable(103)).toBe(true)
    expect(registry.isDemandable(586)).toBe(true)
  })

  it('once measured, splits the list into visible (viewable or warm) and hidden', () => {
    expect(listViewportReport([103, 586, 587, 104], [103], [104])).toEqual({
      visible: [103, 104],
      hidden: [586, 587],
    })
  })

  it('a measured EMPTY viewport is a real answer: everything hidden', () => {
    expect(listViewportReport([103, 586], [], [])).toEqual({ visible: [], hidden: [103, 586] })
  })
})
