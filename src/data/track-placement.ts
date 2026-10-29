/**
 * track-placement — where a track was inferred: the node, the inference
 * device and the root model of the frame it was born on (`openedPlacement`)
 * and of its last matched sighting (`closedPlacement`).
 *
 * A camera's detection session can hop node or device between on-motion
 * sessions, so the two can differ; when they agree the detail says so once.
 * Absent is UNKNOWN — a row from before the fields, a camera's onboard
 * detector — and nothing here renders it as a node.
 *
 * Diagnostic: the detail shows it to an admin only (the node ids and device
 * keys say nothing to a household member). Pure — no React.
 */
import type { TrackPlacement } from '@camstack/types'

export type { TrackPlacement }

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one wire placement; anything without a node id is unknown (`undefined`). */
export function parseTrackPlacement(raw: unknown): TrackPlacement | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const nodeId = nonEmptyString(Reflect.get(raw, 'nodeId'))
  if (nodeId === undefined) return undefined
  const deviceKey = nonEmptyString(Reflect.get(raw, 'deviceKey'))
  const modelId = nonEmptyString(Reflect.get(raw, 'modelId'))
  return {
    nodeId,
    ...(deviceKey !== undefined ? { deviceKey } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
  }
}

export function samePlacement(a: TrackPlacement, b: TrackPlacement): boolean {
  return a.nodeId === b.nodeId && a.deviceKey === b.deviceKey && a.modelId === b.modelId
}

/** Node id → the display name the hub holds for it. */
export type NodeNames = ReadonlyMap<string, string>

/**
 * The node's display name; the raw id while the directory is unanswered
 * (`names` undefined), when the node is unknown, or when its name is empty or
 * just the id. The hub stays the source of truth.
 */
export function nodeLabel(nodeId: string, names?: NodeNames): string {
  const name = names?.get(nodeId)
  return name !== undefined && name.length > 0 && name !== nodeId ? name : nodeId
}

/** `node · device (model)`, leaving out what the placement does not name. */
export function formatPlacement(placement: TrackPlacement, names?: NodeNames): string {
  const node = nodeLabel(placement.nodeId, names)
  const where = placement.deviceKey !== undefined ? `${node} · ${placement.deviceKey}` : node
  return placement.modelId !== undefined ? `${where} (${placement.modelId})` : where
}

/** Which row a placement is shown under. */
export type PlacementRowKind = 'detectedOn' | 'openedOn' | 'closedOn'

export interface PlacementRow {
  readonly kind: PlacementRowKind
  readonly placement: TrackPlacement
}

/**
 * The metadata rows for a track's two placements: one "Detected on" when both
 * ends agree, else "Opened on" and "Closed on" for each end that is known, and
 * nothing when neither is.
 */
export function placementRows(
  opened: TrackPlacement | undefined,
  closed: TrackPlacement | undefined,
): readonly PlacementRow[] {
  if (opened !== undefined && closed !== undefined && samePlacement(opened, closed)) {
    return [{ kind: 'detectedOn', placement: opened }]
  }
  return [
    ...(opened !== undefined ? [{ kind: 'openedOn' as const, placement: opened }] : []),
    ...(closed !== undefined ? [{ kind: 'closedOn' as const, placement: closed }] : []),
  ]
}
