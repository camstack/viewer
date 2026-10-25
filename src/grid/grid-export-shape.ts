/**
 * grid-export-shape — PURE serialization / parsing for grid export-import.
 *
 * Deliberately free of any `react-native` import so it is unit-testable in a
 * node/vitest environment (the `Share` side-effects live in
 * `srcV2/data/grid-export.ts`, which re-exports these).
 *
 * The exported shape OMITS the volatile `id` — an imported grid gets a fresh id
 * from the store so re-importing never clobbers an existing one. A single grid
 * exports as one object inside a versioned envelope; "export all" is the same
 * envelope with many grids.
 */
import { type Grid, type GridOptions, type ImportedGrid } from '../store/grid-store.js'

/** The on-the-wire shape of one exported grid (no `id`). */
export interface ExportedGrid {
  readonly name: string
  readonly cameraIds: readonly number[]
  readonly hiddenCameraIds?: readonly number[]
  readonly options?: GridOptions
}

/** A versioned envelope wrapping one or many grids, so the importer can tell a
 *  CamStack grid export apart from arbitrary JSON. */
export interface GridExportEnvelope {
  readonly type: 'camstack-grids'
  readonly version: 1
  readonly grids: readonly ExportedGrid[]
}

const ENVELOPE_TYPE = 'camstack-grids' as const
const ENVELOPE_VERSION = 1 as const

/** Strip a `Grid` down to its exportable fields (drops the volatile `id` and any
 *  empty optional arrays so the JSON stays clean). Pure. */
export function gridToExportShape(grid: Grid): ExportedGrid {
  const base: ExportedGrid = { name: grid.name, cameraIds: [...grid.cameraIds] }
  const withHidden =
    grid.hiddenCameraIds && grid.hiddenCameraIds.length > 0
      ? { ...base, hiddenCameraIds: [...grid.hiddenCameraIds] }
      : base
  return grid.options ? { ...withHidden, options: grid.options } : withHidden
}

/** Build the versioned export envelope for the given grids. Pure. */
export function buildGridExport(grids: readonly Grid[]): GridExportEnvelope {
  return { type: ENVELOPE_TYPE, version: ENVELOPE_VERSION, grids: grids.map(gridToExportShape) }
}

/** Serialize one grid to a shareable JSON string. */
export function serializeGrid(grid: Grid): string {
  return JSON.stringify(buildGridExport([grid]), null, 2)
}

/** Serialize many grids to a shareable JSON string. */
export function serializeGrids(grids: readonly Grid[]): string {
  return JSON.stringify(buildGridExport(grids), null, 2)
}

/** Parse a shared JSON payload into importable grids. Accepts the versioned
 *  envelope, a bare array of exported grids, or a single exported grid object.
 *  Never throws — malformed input yields `[]`. Each result is membership-clean
 *  (hidden ids pruned to actual members). */
export function parseGridExport(raw: string | null): readonly ImportedGrid[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const candidates = extractCandidates(data)
  const result: ImportedGrid[] = []
  for (const c of candidates) {
    const grid = toImportedGrid(c)
    if (grid) result.push(grid)
  }
  return result
}

/** Pull the grid-object array out of any accepted top-level shape. */
function extractCandidates(data: unknown): readonly unknown[] {
  if (isEnvelope(data)) return data.grids
  if (Array.isArray(data)) return data
  if (typeof data === 'object' && data !== null) return [data]
  return []
}

function isEnvelope(value: unknown): value is GridExportEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return e.type === ENVELOPE_TYPE && Array.isArray(e.grids)
}

/** Validate + normalize one candidate into an `ImportedGrid`, or `null` if it is
 *  not a well-formed exported grid. */
function toImportedGrid(value: unknown): ImportedGrid | null {
  if (typeof value !== 'object' || value === null) return null
  const g = value as Record<string, unknown>
  if (typeof g.name !== 'string') return null
  if (!isNumberArray(g.cameraIds)) return null
  const cameraIds = Array.from(new Set(g.cameraIds))
  const members = new Set(cameraIds)
  const imported: { -readonly [K in keyof ImportedGrid]: ImportedGrid[K] } = {
    name: g.name.trim() || 'Griglia importata',
    cameraIds,
  }
  if (isNumberArray(g.hiddenCameraIds)) {
    const hidden = g.hiddenCameraIds.filter((id) => members.has(id))
    if (hidden.length > 0) imported.hiddenCameraIds = hidden
  }
  const options = toOptions(g.options)
  if (options) imported.options = options
  return imported
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number')
}

/** Validate the optional `options` blob, dropping unknown/invalid fields. */
function toOptions(value: unknown): GridOptions | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const o = value as Record<string, unknown>
  const out: { -readonly [K in keyof GridOptions]: GridOptions[K] } = {}
  if (typeof o.showName === 'boolean') out.showName = o.showName
  // A `quality` or a `layout` in the file is IGNORED: a wall's stream tier and
  // its layout are DEVICE settings (`grid-local-store`) and do not travel with
  // a grid. Files exported by older builds still carry them.
  return out.showName === undefined ? undefined : out
}
