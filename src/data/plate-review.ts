/**
 * plate-review — pure (RN-free) row derivation for the admin-only Plates page,
 * the twin of `face-cluster-review.ts` over the hub's `plateGallery` cap.
 *
 * ## What "assigned / suggested / unassigned" mean for a plate
 *
 * A plate is self-labelling (the OCR text is the identity), so the cap has no
 * recognizer score to rank suggestions by. The three buckets are derived from
 * what a read carries:
 *
 *   • `assigned`   — `assigned` is true: the read was enrolled as a sample of a
 *                    vehicle.
 *   • `suggested`  — not assigned, but the matcher's lookup named a vehicle
 *                    (`recognizedVehicleId`): one tap confirms it.
 *   • `unassigned` — neither.
 *
 * "Certainty" for the sort is the read's own OCR confidence (`score`, 0..1; 1
 * when the text was corrected by hand) — the only number the cap offers.
 */
import { isRecord } from './cap-query.js'
import { absoluteMediaPath, buildMediaIdUrl } from './event-media-url.js'
import type { FaceReviewStatus } from './face-cluster-review.js'
import { foldForSearch } from './identity-picker.js'

export type PlateReviewStatus = FaceReviewStatus

/** One `plateGallery.listPlates` row, narrowed. */
export interface PlateInfo {
  readonly plateId: string
  readonly deviceId: number
  readonly trackId: string
  readonly timestamp: number
  readonly text: string
  readonly score: number
  readonly corrected: boolean
  readonly assigned: boolean
  readonly recognizedVehicleId: string | undefined
  readonly vehicleName: string | undefined
  readonly cropUrl: string | undefined
  readonly base64: string | undefined
}

/** A saved vehicle (`plateGallery.listVehicles`), narrowed. */
export interface PlateVehicle {
  readonly id: string
  readonly name: string
  readonly sampleCount: number
  readonly coverMediaId: number | undefined
}

/** One `suggestPlateClusters` group, narrowed. */
export interface PlateCluster {
  readonly plateIds: readonly string[]
  readonly representativePlateId: string
  readonly representativeText: string
  readonly size: number
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Narrow one `listPlates` / `searchPlates` row. Null on malformed (never throws). */
export function toPlateInfo(row: unknown): PlateInfo | null {
  if (!isRecord(row)) return null
  if (typeof row.plateId !== 'string' || row.plateId.length === 0) return null
  if (typeof row.deviceId !== 'number') return null
  if (typeof row.trackId !== 'string' || row.trackId.length === 0) return null
  return {
    plateId: row.plateId,
    deviceId: row.deviceId,
    trackId: row.trackId,
    timestamp: typeof row.timestamp === 'number' ? row.timestamp : 0,
    text: typeof row.text === 'string' ? row.text : '',
    score: typeof row.score === 'number' ? row.score : 0,
    corrected: row.corrected === true,
    assigned: row.assigned === true,
    recognizedVehicleId: optionalString(row.recognizedVehicleId),
    vehicleName: optionalString(row.vehicleName),
    cropUrl: optionalString(row.cropUrl),
    base64: optionalString(row.base64),
  }
}

export function toPlateVehicle(row: unknown): PlateVehicle | null {
  if (!isRecord(row)) return null
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name,
    sampleCount: typeof row.sampleCount === 'number' ? row.sampleCount : 0,
    coverMediaId: typeof row.coverMediaId === 'number' ? row.coverMediaId : undefined,
  }
}

export function toPlateCluster(row: unknown): PlateCluster | null {
  if (!isRecord(row)) return null
  if (!Array.isArray(row.plateIds)) return null
  const plateIds = row.plateIds.filter((id): id is string => typeof id === 'string')
  if (plateIds.length < 2) return null
  if (typeof row.representativePlateId !== 'string') return null
  return {
    plateIds,
    representativePlateId: row.representativePlateId,
    representativeText: typeof row.representativeText === 'string' ? row.representativeText : '',
    size: typeof row.size === 'number' ? row.size : plateIds.length,
  }
}

export function toPlateList<T>(raw: unknown, narrow: (row: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const row of raw) {
    const item = narrow(row)
    if (item !== null) out.push(item)
  }
  return out
}

/** One cell of the Plates grid. */
export interface PlateReviewRow {
  readonly plateId: string
  readonly deviceId: number
  readonly cameraName: string | undefined
  readonly trackId: string
  readonly timestamp: number
  readonly text: string
  /** OCR confidence 0..1 (1 once corrected by hand). */
  readonly score: number
  readonly corrected: boolean
  readonly cropUrl: string | undefined
  readonly base64: string | undefined
  readonly status: PlateReviewStatus
  /** The vehicle the read is assigned to (`assigned`) or that the matcher named (`suggested`). */
  readonly vehicleId: string | undefined
  readonly vehicleName: string | undefined
}

export function plateStatus(plate: PlateInfo): PlateReviewStatus {
  if (plate.assigned) return 'assigned'
  return plate.recognizedVehicleId !== undefined ? 'suggested' : 'unassigned'
}

export function buildPlateReviewRows(
  plates: readonly PlateInfo[],
  vehicles: readonly PlateVehicle[],
  cameraNameById: ReadonlyMap<number, string>,
): PlateReviewRow[] {
  const vehicleNameById = new Map(vehicles.map((v) => [v.id, v.name]))
  return plates.map((plate) => {
    const status = plateStatus(plate)
    const vehicleId = status === 'unassigned' ? undefined : plate.recognizedVehicleId
    return {
      plateId: plate.plateId,
      deviceId: plate.deviceId,
      cameraName: cameraNameById.get(plate.deviceId),
      trackId: plate.trackId,
      timestamp: plate.timestamp,
      text: plate.text,
      score: plate.score,
      corrected: plate.corrected,
      cropUrl: plate.cropUrl,
      base64: plate.base64,
      status,
      vehicleId,
      vehicleName:
        status === 'unassigned'
          ? undefined
          : (plate.vehicleName ?? (vehicleId !== undefined ? vehicleNameById.get(vehicleId) : undefined)),
    }
  })
}

/** Renderable crop URI: the data-plane URL first, legacy inline bytes last. */
export function plateCropUri(
  plate: { readonly cropUrl?: string; readonly base64?: string },
  serverUrl: string | null,
): string | null {
  const fromUrl = absoluteMediaPath(serverUrl, plate.cropUrl)
  if (fromUrl !== null) return fromUrl
  if (plate.base64 !== undefined && plate.base64.length > 0) return `data:image/jpeg;base64,${plate.base64}`
  return null
}

export function vehicleCoverUri(vehicle: { readonly coverMediaId?: number }, serverUrl: string | null): string | null {
  if (vehicle.coverMediaId !== undefined && serverUrl !== null) return buildMediaIdUrl(serverUrl, vehicle.coverMediaId)
  return null
}

/** Field-by-field equality, so a re-fetched window does not re-render every memoised cell. */
export function samePlateReviewRow(a: PlateReviewRow, b: PlateReviewRow): boolean {
  if (a === b) return true
  const keys = Object.keys(a) as (keyof PlateReviewRow)[]
  return keys.every((k) => a[k] === b[k])
}

// ── Suggestions and deletion (selection rules) ──────────────────────────────

export interface PlateSuggestionEntry {
  readonly vehicleId: string
  readonly name: string
  readonly plateIds: readonly string[]
}

export interface PlateSuggestionReadiness {
  readonly selected: number
  /** Selected reads the matcher named no vehicle for. `> 0` ⇒ not ready. */
  readonly missing: number
  readonly ready: boolean
  /** Grouped by vehicle; EMPTY unless `ready` (all-or-nothing, like People). */
  readonly plan: readonly PlateSuggestionEntry[]
}

export function plateSuggestionReadiness(rows: readonly PlateReviewRow[]): PlateSuggestionReadiness {
  let missing = 0
  const groups = new Map<string, { name: string; plateIds: string[] }>()
  for (const row of rows) {
    if (row.status !== 'suggested' || row.vehicleId === undefined) {
      missing += 1
      continue
    }
    const group = groups.get(row.vehicleId)
    if (group === undefined) groups.set(row.vehicleId, { name: row.vehicleName ?? row.vehicleId, plateIds: [row.plateId] })
    else group.plateIds.push(row.plateId)
  }
  const ready = rows.length > 0 && missing === 0
  return {
    selected: rows.length,
    missing,
    ready,
    plan: ready ? [...groups].map(([vehicleId, g]) => ({ vehicleId, name: g.name, plateIds: g.plateIds })) : [],
  }
}

export interface PlateDeletionReadiness {
  readonly selected: number
  /** Selected reads already assigned to a vehicle. `> 0` ⇒ not ready. */
  readonly blocked: number
  readonly ready: boolean
  readonly plateIds: readonly string[]
}

/** Only reads that belong to no vehicle may be deleted: detach first, delete second. */
export function plateDeletionReadiness(rows: readonly PlateReviewRow[]): PlateDeletionReadiness {
  const blocked = rows.filter((row) => row.status === 'assigned').length
  const ready = rows.length > 0 && blocked === 0
  return { selected: rows.length, blocked, ready, plateIds: ready ? rows.map((r) => r.plateId) : [] }
}

/** The vehicles whose name contains `query` (accent- and case-insensitive); all of them for an empty query. */
export function filterVehicles(vehicles: readonly PlateVehicle[], query: string): readonly PlateVehicle[] {
  const needle = foldForSearch(query.trim())
  if (needle.length === 0) return vehicles
  return vehicles.filter((v) => foldForSearch(v.name).includes(needle))
}

/** Plate text as the hub stores it: upper-case, no separators. */
export function normalizePlateText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
