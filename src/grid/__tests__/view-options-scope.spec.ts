import { describe, it, expect } from 'vitest'
import {
  GRID_BAR_GROUPS,
  GRID_BAR_ROWS,
  GRID_ROW_OWNER,
  GROUP_HEADER_KEY,
  ROW_GROUP,
  VIEW_OPTION_GROUPS,
  VIEW_OPTION_ROWS,
  barRowsInGroup,
  hiddenRows,
  isGroupVisible,
  isRowVisible,
  rowsInGroup,
  type ViewOptionRow,
} from '../view-options-scope.js'

/**
 * ONE list decides what a row IS (its group) and WHERE it is configured (its
 * owner, per context).
 *
 * Two failures are pinned here, both real:
 *
 *  1. The grid bar and a cell's menu offered the same rows against two
 *     different documents — the grid's and the camera's — so whichever the
 *     operator touched last was the one that looked broken.
 *  2. The first fix hid five rows instead of drawing them, and the operator
 *     lost the audio meter, the occupancy chips and the stream stats from the
 *     grid entirely. A row offered where nothing paints it is a dead control;
 *     the answer is to paint it, and that is now the ONLY answer — there is no
 *     third owner to hide behind.
 */
describe('groups are the same everywhere', () => {
  it('gives every row exactly one group', () => {
    for (const row of VIEW_OPTION_ROWS) {
      expect(VIEW_OPTION_GROUPS).toContain(ROW_GROUP[row])
    }
    expect(Object.keys(ROW_GROUP).sort()).toEqual([...VIEW_OPTION_ROWS].sort())
  })

  it('leaves no group empty, and loses no row between the groups', () => {
    const collected = VIEW_OPTION_GROUPS.flatMap((g) => rowsInGroup(g))
    expect([...collected].sort()).toEqual([...VIEW_OPTION_ROWS].sort())
    for (const group of VIEW_OPTION_GROUPS) {
      expect(rowsInGroup(group).length).toBeGreaterThan(0)
    }
  })

  it('keeps the rows of a group in the surface order', () => {
    expect(rowsInGroup('detection')).toEqual([
      'detectionLayers',
      'motionLayer',
      'highlightBorder',
    ])
    expect(rowsInGroup('liveIndicators')).toEqual([
      'audioMeter',
      'occupancy',
      'stats',
      'liveViewers',
      'deviceInfo',
    ])
    expect(rowsInGroup('sensors')).toEqual(['readouts'])
  })

  it('names a header for every group, or says the component draws its own', () => {
    expect(Object.keys(GROUP_HEADER_KEY).sort()).toEqual([...VIEW_OPTION_GROUPS].sort())
    // Only the switch group titles itself (`v2.cameraSwitches.title`); a second
    // header above it would be the same words twice.
    const selfTitled = VIEW_OPTION_GROUPS.filter((g) => GROUP_HEADER_KEY[g] === null)
    expect(selfTitled).toEqual(['functions'])
  })
})

describe('every row is owned, and no row is hidden from everyone', () => {
  it('assigns an owner to every row', () => {
    expect(Object.keys(GRID_ROW_OWNER).sort()).toEqual([...VIEW_OPTION_ROWS].sort())
  })

  it('has only two owners — a row is the bar\'s or the camera\'s', () => {
    // The regression this replaces: an `unpainted` third class that removed the
    // audio meter, occupancy and stats from the grid instead of drawing them.
    const owners = new Set(VIEW_OPTION_ROWS.map((row) => GRID_ROW_OWNER[row]))
    expect([...owners].sort()).toEqual(['bar', 'cell'])
  })

  it('keeps the three live indicators per-camera IN THE GRID', () => {
    const perCamera: readonly ViewOptionRow[] = ['audioMeter', 'occupancy', 'stats']
    for (const row of perCamera) {
      expect(GRID_ROW_OWNER[row]).toBe('cell')
      expect(isRowVisible(row, 'grid-cell')).toBe(true)
    }
  })

  it('keeps the motion overlays per-camera too', () => {
    // `motionLayer` is a chip of the SAME control the bar owns the rest of, and
    // it stays here on purpose: the tile paints motion regions from the
    // camera's own document, and the bar has no write path to N of those.
    expect(isRowVisible('motionLayer', 'grid-cell')).toBe(true)
  })

  it('lists the bar rows as exactly the rows the bar owns', () => {
    expect([...GRID_BAR_ROWS]).toEqual(VIEW_OPTION_ROWS.filter((r) => GRID_ROW_OWNER[r] === 'bar'))
    expect([...GRID_BAR_ROWS]).toEqual([
      'detectionLayers',
      'highlightBorder',
      'deviceInfo',
      'clusterLabel',
    ])
  })
})

describe('the single-camera menu is complete', () => {
  it('hides nothing at all', () => {
    expect(hiddenRows('single')).toEqual([])
    for (const group of VIEW_OPTION_GROUPS) {
      expect(isGroupVisible(group, 'single')).toBe(true)
    }
  })
})

describe('a grid CELL shows what the tile paints per camera', () => {
  it('hides every row the grid bar owns, and only those', () => {
    expect([...hiddenRows('grid-cell')].sort()).toEqual([...GRID_BAR_ROWS].sort())
  })

  it('never leaves a row visible in both menus', () => {
    expect(GRID_BAR_ROWS.filter((row) => isRowVisible(row, 'grid-cell'))).toEqual([])
  })

  it('keeps every group alive in the cell — a group never vanishes wholesale', () => {
    // Each group has at least one per-camera row, so the cell menu wears the
    // same headers as the single-camera one and nothing becomes unfindable.
    //
    // AMENDED 2026-09-20: `timeline` used to be the exception, because its only
    // row (`clusterLabel`) is wall-wide. It gained `clipSource`, which is per
    // camera by the operator's own rule ("come provider di quella camera") —
    // so the exception is gone and the rule is now universal, which is what it
    // always wanted to be. The assertion is tightened rather than relaxed.
    for (const group of VIEW_OPTION_GROUPS) {
      expect(isGroupVisible(group, 'grid-cell'), group).toBe(true)
    }
  })
})

describe('the bar wears the same groups', () => {
  it('lists only the groups it has rows in, in display order', () => {
    expect([...GRID_BAR_GROUPS]).toEqual(['detection', 'liveIndicators', 'timeline'])
  })

  it('splits its rows into those groups without losing any', () => {
    const collected = GRID_BAR_GROUPS.flatMap((g) => barRowsInGroup(g))
    expect([...collected].sort()).toEqual([...GRID_BAR_ROWS].sort())
    expect(barRowsInGroup('detection')).toEqual(['detectionLayers', 'highlightBorder'])
    expect(barRowsInGroup('liveIndicators')).toEqual(['deviceInfo'])
    expect(barRowsInGroup('timeline')).toEqual(['clusterLabel'])
  })
})
