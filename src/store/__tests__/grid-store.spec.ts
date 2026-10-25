import { describe, it, expect } from 'vitest'
import {
  createGridEntry,
  renameGridEntry,
  setGridCamerasEntry,
  addGridCameraEntry,
  removeGridCameraEntry,
  reorderGridCamerasEntry,
  setGridCameraHiddenEntry,
  setGridOptionsEntry,
  deleteGridEntry,
  parseGrids,
  generateGridId,
  resolveGridOptions,
  visibleGridCameraIds,
  GRID_OPTION_DEFAULTS,
  type Grid,
} from '../grid-store.js'
import {
  gridToExportShape,
  buildGridExport,
  parseGridExport,
} from '../../grid/grid-export-shape.js'

const seed: readonly Grid[] = [
  { id: 'a', name: 'Hall', cameraIds: [1, 2] },
  { id: 'b', name: 'Esterno', cameraIds: [] },
]

describe('grid-store reducers', () => {
  it('createGridEntry appends a new grid with the given id and trimmed name', () => {
    const next = createGridEntry(seed, '  Garage  ', 'c', 'New grid', 'hub-a')
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({ id: 'c', name: 'Garage', serverId: 'hub-a', cameraIds: [] })
    // input not mutated
    expect(seed).toHaveLength(2)
  })

  it('createGridEntry falls back to the caller-supplied default name when blank', () => {
    const next = createGridEntry([], '   ', 'c', 'New grid', 'hub-a')
    expect(next[0]?.name).toBe('New grid')
  })

  it('renameGridEntry renames the matching grid and trims', () => {
    const next = renameGridEntry(seed, 'a', '  Living room ')
    expect(next.find((g) => g.id === 'a')?.name).toBe('Living room')
    expect(next.find((g) => g.id === 'b')?.name).toBe('Esterno')
  })

  it('renameGridEntry ignores blank names (keeps prior name)', () => {
    const next = renameGridEntry(seed, 'a', '   ')
    expect(next.find((g) => g.id === 'a')?.name).toBe('Hall')
  })

  it('renameGridEntry is a no-op for an unknown id', () => {
    const next = renameGridEntry(seed, 'zzz', 'Nope')
    expect(next).toEqual(seed)
  })

  it('setGridCamerasEntry replaces the camera set and dedupes (order preserved)', () => {
    const next = setGridCamerasEntry(seed, 'b', [5, 5, 3, 3, 7])
    expect(next.find((g) => g.id === 'b')?.cameraIds).toEqual([5, 3, 7])
    // other grids untouched
    expect(next.find((g) => g.id === 'a')?.cameraIds).toEqual([1, 2])
  })

  it('reorderGridCamerasEntry rewrites order for known members only', () => {
    const next = reorderGridCamerasEntry(seed, 'a', [2, 1])
    expect(next.find((g) => g.id === 'a')?.cameraIds).toEqual([2, 1])
    expect(next.find((g) => g.id === 'b')?.cameraIds).toEqual([])
    expect(seed.find((g) => g.id === 'a')?.cameraIds).toEqual([1, 2]) // input untouched
  })

  it('reorderGridCamerasEntry ignores non-members and appends missing members', () => {
    // 99 is not a member (ignored); 1 is omitted from the order (appended last)
    const next = reorderGridCamerasEntry(seed, 'a', [2, 99])
    expect(next.find((g) => g.id === 'a')?.cameraIds).toEqual([2, 1])
  })

  it('reorderGridCamerasEntry dedupes a repeated id in the order payload', () => {
    const next = reorderGridCamerasEntry(seed, 'a', [2, 2, 1])
    expect(next.find((g) => g.id === 'a')?.cameraIds).toEqual([2, 1])
  })

  it('setGridOptionsEntry merges a partial patch over existing options', () => {
    const withOpts: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [], options: { showName: false } }]
    const next = setGridOptionsEntry(withOpts, 'a', { activeOnly: true })
    expect(next[0]?.options).toEqual({ showName: false, activeOnly: true })
  })

  it('setGridOptionsEntry is a no-op for an unknown id', () => {
    expect(setGridOptionsEntry(seed, 'zzz', { showName: false })).toEqual(seed)
  })

  it('resolveGridOptions falls back per-field to the defaults', () => {
    expect(resolveGridOptions(undefined)).toEqual(GRID_OPTION_DEFAULTS)
    expect(resolveGridOptions({ showName: false })).toEqual({
      ...GRID_OPTION_DEFAULTS,
      showName: false,
    })
    // The layout is this device's, handed in from `grid-local-store`.
    expect(resolveGridOptions({}, 3)).toEqual({ ...GRID_OPTION_DEFAULTS, layout: 3 })
  })

  // ── the border highlight defaults ON ───────────────────────────────────────
  // A grid that has never been told otherwise shows the highlight border; a
  // grid the operator switched OFF stays off. Those are different states and
  // storage has to keep them apart — `undefined` is "never answered", `false`
  // is an answer.

  it('resolveGridOptions turns the border highlight ON when the grid never stored one', () => {
    expect(GRID_OPTION_DEFAULTS.highlightOn).toBe(true)
    // A grid persisted before the key existed: no `options` at all…
    expect(resolveGridOptions(undefined).highlightOn).toBe(true)
    // …and one with other options but no answer for this key.
    expect(resolveGridOptions({ showName: true }, 2).highlightOn).toBe(true)
  })

  it('resolveGridOptions respects an explicit OFF (never re-enabled by the default)', () => {
    expect(resolveGridOptions({ highlightOn: false }).highlightOn).toBe(false)
    expect(resolveGridOptions({ highlightOn: true }).highlightOn).toBe(true)
  })

  it('resolveGridOptions defaults the session view toggles OFF', () => {
    expect(resolveGridOptions(undefined).activeOnly).toBe(false)
    expect([...resolveGridOptions(undefined).layers]).toEqual([])
    expect(resolveGridOptions({ activeOnly: true, layers: ['stationary', 'objects'] })).toMatchObject({
      activeOnly: true,
      // Canonical order, whatever order the chips were tapped in.
      layers: ['objects', 'stationary'],
    })
  })

  it('setGridOptionsEntry stores an explicit highlight OFF (not an absent key)', () => {
    const next = setGridOptionsEntry(seed, 'a', { highlightOn: false })
    expect(next[0]?.options).toEqual({ highlightOn: false })
    expect(resolveGridOptions(next[0]?.options).highlightOn).toBe(false)
  })

  it('resolveGridOptions migrates a grid persisted on the retired boxes rung', () => {
    // A wall at 'kept' WAS drawing the parked objects — they rode that rung —
    // so the migration must keep drawing them. `motion` is per-camera and has
    // no meaning on a grid document, so it never lands here.
    expect([...resolveGridOptions({ boxes: 'kept' }).layers]).toEqual(['objects', 'stationary'])
    expect([...resolveGridOptions({ boxes: 'all' }).layers]).toEqual([
      'objects',
      'discarded',
      'stationary',
    ])
    expect([...resolveGridOptions({ boxes: 'off' }).layers]).toEqual([])
    expect([...resolveGridOptions({ boxes: 'kept', motionBoxes: true }).layers]).toEqual([
      'objects',
      'stationary',
    ])
  })

  it('parseGrids keeps a stored highlightOn/activeOnly/boxes and drops a bad boxes rung', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Off', cameraIds: [1], options: { highlightOn: false } },
      { id: 'b', name: 'Boxes', cameraIds: [2], options: { boxes: 'all', activeOnly: true } },
      { id: 'c', name: 'BadBoxes', cameraIds: [3], options: { boxes: 'everything' } },
      { id: 'd', name: 'BadHighlight', cameraIds: [4], options: { highlightOn: 'yes' } },
    ])
    const parsed = parseGrids(raw)
    expect(parsed.map((g) => g.id)).toEqual(['a', 'b'])
    expect(resolveGridOptions(parsed[0]?.options).highlightOn).toBe(false)
    expect(resolveGridOptions(parsed[1]?.options)).toMatchObject({
      highlightOn: true,
      activeOnly: true,
      layers: ['objects', 'discarded', 'stationary'],
    })
  })

  it('parseGrids does not judge a layout left in a grid (it is a device setting now)', () => {
    // `layout` moved to `grid-local-store`; a grid not migrated yet must not be
    // deleted over a value this document no longer owns.
    const raw = JSON.stringify([
      { id: 'a', name: 'AutoLayout', cameraIds: [1], options: { layout: 'auto' } },
      { id: 'c', name: 'BadLayout', cameraIds: [3], options: { layout: 0 } },
    ])
    expect(parseGrids(raw).map((g) => g.id)).toEqual(['a', 'c'])
  })

  it('parseGrids drops a grid whose options are the wrong SHAPE', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Ok', cameraIds: [1], options: { showName: true, quality: 'high' } },
      { id: 'b', name: 'BadShowName', cameraIds: [], options: { showName: 'yes' } },
      { id: 'c', name: 'OkNoOpts', cameraIds: [] },
    ])
    const parsed = parseGrids(raw)
    expect(parsed.map((g) => g.id)).toEqual(['a', 'c'])
  })

  it('but an unrecognised QUALITY keeps the grid — it is normalised on read', () => {
    // Changed on 2026-09-02, and it is a fix. This guard decides whether the
    // whole grid survives, so judging the tier VALUE here meant that retiring a
    // spelling deleted every grid written with it — cameras, layout and audio
    // set — at the next launch. The tier is device-local now and its scale
    // lives in ONE place (`isStreamQuality`, read by `grid-local-store`); see
    // `quality-scale.spec.ts`.
    const raw = JSON.stringify([
      { id: 'b', name: 'RetiredTier', cameraIds: [7], options: { quality: 'medium' } },
    ])
    expect(parseGrids(raw).map((g) => g.id)).toEqual(['b'])
  })

  it('deleteGridEntry removes the matching grid', () => {
    const next = deleteGridEntry(seed, 'a')
    expect(next).toHaveLength(1)
    expect(next[0]?.id).toBe('b')
  })

  it('parseGrids returns [] for null/invalid JSON', () => {
    expect(parseGrids(null)).toEqual([])
    expect(parseGrids('not json')).toEqual([])
    expect(parseGrids('{"not":"array"}')).toEqual([])
  })

  it('parseGrids drops malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Ok', cameraIds: [1, 2] },
      { id: 'b', name: 'BadCams', cameraIds: ['x'] },
      { id: 1, name: 'BadId', cameraIds: [] },
      { name: 'NoId', cameraIds: [] },
    ])
    const parsed = parseGrids(raw)
    expect(parsed).toEqual([{ id: 'a', name: 'Ok', cameraIds: [1, 2] }])
  })

  it('generateGridId produces unique, prefixed ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateGridId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id.startsWith('grid_')).toBe(true)
  })

  // ── add / remove camera ──────────────────────────────────────────────────
  it('addGridCameraEntry appends a new member (no-op if already present)', () => {
    const added = addGridCameraEntry(seed, 'a', 3)
    expect(added.find((g) => g.id === 'a')?.cameraIds).toEqual([1, 2, 3])
    // already a member → unchanged
    expect(addGridCameraEntry(seed, 'a', 1)).toEqual(seed)
    expect(seed.find((g) => g.id === 'a')?.cameraIds).toEqual([1, 2]) // input untouched
  })

  it('removeGridCameraEntry drops the member and prunes it from the hidden set', () => {
    const withHidden: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [1, 2, 3], hiddenCameraIds: [2, 3] }]
    const next = removeGridCameraEntry(withHidden, 'a', 2)
    expect(next[0]?.cameraIds).toEqual([1, 3])
    expect(next[0]?.hiddenCameraIds).toEqual([3])
  })

  it('removeGridCameraEntry clears the hidden field when the last hidden id is removed', () => {
    const withHidden: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [1, 2], hiddenCameraIds: [2] }]
    const next = removeGridCameraEntry(withHidden, 'a', 2)
    expect(next[0]?.cameraIds).toEqual([1])
    expect(next[0]?.hiddenCameraIds).toBeUndefined()
  })

  it('setGridCamerasEntry prunes hidden ids that are no longer members', () => {
    const withHidden: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [1, 2, 3], hiddenCameraIds: [2, 3] }]
    const next = setGridCamerasEntry(withHidden, 'a', [1, 2])
    expect(next[0]?.cameraIds).toEqual([1, 2])
    expect(next[0]?.hiddenCameraIds).toEqual([2])
  })

  // ── hide / show ──────────────────────────────────────────────────────────
  it('setGridCameraHiddenEntry hides a member and keeps hidden membership-clean/ordered', () => {
    const next = setGridCameraHiddenEntry(seed, 'a', 1, true)
    expect(next.find((g) => g.id === 'a')?.hiddenCameraIds).toEqual([1])
    expect(seed.find((g) => g.id === 'a')?.hiddenCameraIds).toBeUndefined() // input untouched
  })

  it('setGridCameraHiddenEntry refuses to hide a non-member', () => {
    expect(setGridCameraHiddenEntry(seed, 'a', 99, true)).toEqual(seed)
  })

  it('setGridCameraHiddenEntry orders the hidden set by display order', () => {
    const grids: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [1, 2, 3], hiddenCameraIds: [3] }]
    const next = setGridCameraHiddenEntry(grids, 'a', 1, true)
    // 1 comes before 3 in cameraIds → hidden set follows that order
    expect(next[0]?.hiddenCameraIds).toEqual([1, 3])
  })

  it('setGridCameraHiddenEntry shows a hidden camera (drops it from the set)', () => {
    const grids: readonly Grid[] = [{ id: 'a', name: 'A', cameraIds: [1, 2], hiddenCameraIds: [1, 2] }]
    const next = setGridCameraHiddenEntry(grids, 'a', 1, false)
    expect(next[0]?.hiddenCameraIds).toEqual([2])
  })

  it('setGridCameraHiddenEntry is a no-op for an unknown id', () => {
    expect(setGridCameraHiddenEntry(seed, 'zzz', 1, true)).toEqual(seed)
  })

  it('visibleGridCameraIds returns members minus the hidden set, in order', () => {
    const grid: Grid = { id: 'a', name: 'A', cameraIds: [1, 2, 3], hiddenCameraIds: [2] }
    expect(visibleGridCameraIds(grid)).toEqual([1, 3])
    // no hidden field → returns the original reference (cheap path)
    const none: Grid = { id: 'b', name: 'B', cameraIds: [4, 5] }
    expect(visibleGridCameraIds(none)).toBe(none.cameraIds)
  })

  it('parseGrids keeps a grid with a valid hiddenCameraIds and drops a malformed one', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Ok', cameraIds: [1, 2], hiddenCameraIds: [2] },
      { id: 'b', name: 'BadHidden', cameraIds: [1], hiddenCameraIds: ['x'] },
      { id: 'c', name: 'NoHidden', cameraIds: [3] },
    ])
    expect(parseGrids(raw).map((g) => g.id)).toEqual(['a', 'c'])
  })
})

describe('grid-export', () => {
  it('gridToExportShape omits the id and empty optional arrays', () => {
    const grid: Grid = { id: 'a', name: 'Hall', cameraIds: [1, 2] }
    expect(gridToExportShape(grid)).toEqual({ name: 'Hall', cameraIds: [1, 2] })
    expect('id' in gridToExportShape(grid)).toBe(false)
  })

  it('gridToExportShape preserves hiddenCameraIds and options when present', () => {
    const grid: Grid = {
      id: 'a',
      name: 'Hall',
      cameraIds: [1, 2, 3],
      hiddenCameraIds: [3],
      options: { showName: false },
    }
    expect(gridToExportShape(grid)).toEqual({
      name: 'Hall',
      cameraIds: [1, 2, 3],
      hiddenCameraIds: [3],
      options: { showName: false },
    })
  })

  it('buildGridExport wraps grids in a versioned envelope', () => {
    const env = buildGridExport([{ id: 'a', name: 'A', cameraIds: [1] }])
    expect(env).toEqual({ type: 'camstack-grids', version: 1, grids: [{ name: 'A', cameraIds: [1] }] })
  })

  it('parseGridExport round-trips a serialized envelope (id stripped)', () => {
    const grid: Grid = { id: 'a', name: 'Esterno', cameraIds: [1, 2], options: { showName: true } }
    const json = JSON.stringify(buildGridExport([grid]))
    const parsed = parseGridExport(json)
    expect(parsed).toEqual([{ name: 'Esterno', cameraIds: [1, 2], options: { showName: true } }])
    for (const g of parsed) expect('id' in g).toBe(false)
  })

  it('parseGridExport accepts a bare array and a single object', () => {
    expect(parseGridExport(JSON.stringify([{ name: 'A', cameraIds: [1] }]))).toEqual([
      { name: 'A', cameraIds: [1] },
    ])
    expect(parseGridExport(JSON.stringify({ name: 'B', cameraIds: [2] }))).toEqual([
      { name: 'B', cameraIds: [2] },
    ])
  })

  it('parseGridExport dedupes cameras and prunes hidden ids to members', () => {
    const json = JSON.stringify({ name: 'X', cameraIds: [1, 1, 2], hiddenCameraIds: [2, 99] })
    expect(parseGridExport(json)).toEqual([{ name: 'X', cameraIds: [1, 2], hiddenCameraIds: [2] }])
  })

  it('parseGridExport ignores a quality (device-local) but keeps a valid showName', () => {
    for (const quality of ['ultra', 'high']) {
      const json = JSON.stringify({ name: 'X', cameraIds: [1], options: { showName: true, quality } })
      expect(parseGridExport(json)).toEqual([{ name: 'X', cameraIds: [1], options: { showName: true } }])
    }
  })

  it('parseGridExport returns [] for null/garbage/malformed entries', () => {
    expect(parseGridExport(null)).toEqual([])
    expect(parseGridExport('not json')).toEqual([])
    expect(parseGridExport(JSON.stringify({ name: 'NoCams' }))).toEqual([])
    expect(parseGridExport(JSON.stringify({ cameraIds: [1] }))).toEqual([])
  })
})
