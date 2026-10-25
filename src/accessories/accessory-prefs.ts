/**
 * accessory-prefs — the operator's LOCAL customisation of one camera's
 * accessory panel, and the reducers over it.
 *
 * ## The model (settled with the operator 2026-09-22)
 *
 * The local list is an ADDITION to the hub's linked devices, never a
 * replacement:
 *
 *  - **Server-linked devices keep following the hub.** An admin who unlinks
 *    one in admin-ui makes it disappear here too. The viewer never writes that
 *    set — `use-linked-device-picks.ts`, which did, is gone.
 *  - **Local additions are independent** — `added` is a list of device ids no
 *    hub call affects.
 *  - **Local customisations apply to BOTH**: `order`, a `name`, an `icon`, a
 *    `hidden` flag, keyed by device id in `byId`.
 *
 * This document rides `CameraPref.accessories` in the camera-prefs store —
 * the same per-camera, profile-shared store every other viewer
 * personalisation uses — so a NON-admin can customise, and a saved profile
 * carries it to the next phone.
 *
 * ## Orphans
 *
 * A customisation whose device is neither linked by the hub nor added here
 * is an orphan and is DISCARDED ON READ (`composeAccessoryRows` never draws
 * it) — never on write. A hub answer that is momentarily wrong (a fallback
 * to the children source, an empty page during a restart) must not be the
 * event that deletes an operator's icon choice: pruning persisted state from
 * one read is the destroy-on-bad-read shape D49 forbids. A local ADDITION is
 * never an orphan; being independent of the hub is the point of it.
 *
 * Pure — no React, no I/O, no mutation: every reducer returns a new document
 * and leaves its input untouched.
 */
import { accessoryIconKey, type AccessoryIconKey } from './accessory-icon-keys.js'

/** One device's local customisation. Absent fields mean "no override". */
export interface AccessoryCustomisation {
  /** A local display name. Trimmed, never empty — empty clears the field. */
  readonly name?: string
  /** A local icon, by key. Only keys this viewer can draw are stored. */
  readonly icon?: AccessoryIconKey
  /** Hidden from the panel's normal view; still listed in edit mode. */
  readonly hidden?: boolean
}

/** The whole local document for one camera. */
export interface CameraAccessoryPrefs {
  /** Device ids the operator added HERE. Independent of the hub's link set. */
  readonly added: readonly number[]
  /** Display order, by device id. Ids absent here follow in the base order. */
  readonly order: readonly number[]
  readonly byId: Readonly<Record<number, AccessoryCustomisation>>
}

export const EMPTY_ACCESSORY_PREFS: CameraAccessoryPrefs = Object.freeze({
  added: Object.freeze([]) as readonly number[],
  order: Object.freeze([]) as readonly number[],
  byId: Object.freeze({}) as Readonly<Record<number, AccessoryCustomisation>>,
})

/** True when the document says nothing — stored as absence by the prefs store. */
export function isEmptyAccessoryPrefs(prefs: CameraAccessoryPrefs): boolean {
  return prefs.added.length === 0 && prefs.order.length === 0 && Object.keys(prefs.byId).length === 0
}

/** Finite integers, first occurrence wins. */
function uniqueIds(ids: readonly unknown[]): readonly number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const id of ids) {
    if (typeof id === 'number' && Number.isInteger(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

function isEmptyCustomisation(entry: AccessoryCustomisation): boolean {
  return entry.name === undefined && entry.icon === undefined && entry.hidden !== true
}

/** Merge a patch onto one device's customisation, dropping an entry that
 *  ends up saying nothing. `undefined` in the patch CLEARS a field. */
function mergeCustomisation(
  prefs: CameraAccessoryPrefs,
  id: number,
  patch: AccessoryCustomisation,
): CameraAccessoryPrefs {
  const current = prefs.byId[id] ?? {}
  const merged: AccessoryCustomisation = { ...current, ...patch }
  const next: { name?: string; icon?: AccessoryIconKey; hidden?: boolean } = {}
  if (typeof merged.name === 'string' && merged.name.length > 0) next.name = merged.name
  if (merged.icon !== undefined) next.icon = merged.icon
  if (merged.hidden === true) next.hidden = true
  const byId: Record<number, AccessoryCustomisation> = { ...prefs.byId }
  if (isEmptyCustomisation(next)) delete byId[id]
  else byId[id] = next
  return { ...prefs, byId }
}

/** Replace the set of local additions. An id that leaves the set takes its
 *  customisation and its order slot with it — those described an addition
 *  that no longer exists, and would otherwise sit as orphans forever. */
export function setAccessoryAdditionsEntry(
  prefs: CameraAccessoryPrefs,
  ids: readonly number[],
): CameraAccessoryPrefs {
  const added = uniqueIds(ids)
  const removed = prefs.added.filter((id) => !added.includes(id))
  return removed.reduce(
    (acc, id) => ({
      ...acc,
      order: acc.order.filter((v) => v !== id),
      byId: Object.fromEntries(
        Object.entries(acc.byId).filter(([key]) => Number(key) !== id),
      ) as Readonly<Record<number, AccessoryCustomisation>>,
    }),
    { ...prefs, added },
  )
}

/** Add local additions (union with the existing ones, order preserved). */
export function addAccessoriesEntry(
  prefs: CameraAccessoryPrefs,
  ids: readonly number[],
): CameraAccessoryPrefs {
  return setAccessoryAdditionsEntry(prefs, [...prefs.added, ...ids])
}

/** Remove ONE local addition. A no-op for an id that is not an addition —
 *  a server-linked device cannot be removed here, only hidden. */
export function removeAccessoryEntry(prefs: CameraAccessoryPrefs, id: number): CameraAccessoryPrefs {
  if (!prefs.added.includes(id)) return prefs
  return setAccessoryAdditionsEntry(prefs, prefs.added.filter((v) => v !== id))
}

/** Set (or clear) a device's local name. Blank clears it. */
export function setAccessoryNameEntry(
  prefs: CameraAccessoryPrefs,
  id: number,
  name: string,
): CameraAccessoryPrefs {
  const trimmed = name.trim()
  return mergeCustomisation(prefs, id, { name: trimmed.length > 0 ? trimmed : undefined })
}

/** Set (or clear, with `null`) a device's local icon. A key this viewer
 *  is not in the catalog is refused: it would be a customisation with no visible effect. */
export function setAccessoryIconEntry(
  prefs: CameraAccessoryPrefs,
  id: number,
  icon: string | null,
): CameraAccessoryPrefs {
  const key = icon === null ? undefined : accessoryIconKey(icon)
  if (icon !== null && key === undefined) return prefs
  return mergeCustomisation(prefs, id, { icon: key })
}

/** Hide (or show) a device in the panel's normal view. */
export function setAccessoryHiddenEntry(
  prefs: CameraAccessoryPrefs,
  id: number,
  hidden: boolean,
): CameraAccessoryPrefs {
  return mergeCustomisation(prefs, id, { hidden: hidden ? true : undefined })
}

/** Replace the display order outright. */
export function setAccessoryOrderEntry(
  prefs: CameraAccessoryPrefs,
  ids: readonly number[],
): CameraAccessoryPrefs {
  return { ...prefs, order: uniqueIds(ids) }
}

/**
 * Move one device up (`-1`) or down (`+1`) within the order the panel is
 * CURRENTLY showing. The caller passes that order (the composed rows, in edit
 * mode, hidden rows included) because the stored `order` may be partial or
 * stale, and a move relative to a list the operator cannot see is a move to
 * nowhere. The whole visible order is then persisted, so the next compose
 * reproduces exactly what the operator arranged.
 */
export function moveAccessoryEntry(
  prefs: CameraAccessoryPrefs,
  shownOrder: readonly number[],
  id: number,
  delta: -1 | 1,
): CameraAccessoryPrefs {
  const from = shownOrder.indexOf(id)
  if (from === -1) return prefs
  const to = from + delta
  if (to < 0 || to >= shownOrder.length) return prefs
  const next = [...shownOrder]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return setAccessoryOrderEntry(prefs, next)
}

/**
 * Parse a stored document. `undefined` when the value is not a document or
 * says nothing — the prefs store stores an empty document as absence.
 * Malformed entries are dropped field by field; nothing throws.
 */
export function parseAccessoryPrefs(raw: unknown): CameraAccessoryPrefs | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const added = Array.isArray(r.added) ? uniqueIds(r.added) : []
  const order = Array.isArray(r.order) ? uniqueIds(r.order) : []
  const byId: Record<number, AccessoryCustomisation> = {}
  if (typeof r.byId === 'object' && r.byId !== null) {
    for (const [key, value] of Object.entries(r.byId as Record<string, unknown>)) {
      const id = Number(key)
      if (!Number.isInteger(id) || typeof value !== 'object' || value === null) continue
      const entry = value as Record<string, unknown>
      const next: { name?: string; icon?: AccessoryIconKey; hidden?: boolean } = {}
      if (typeof entry.name === 'string' && entry.name.trim().length > 0) next.name = entry.name.trim()
      const icon = accessoryIconKey(entry.icon)
      if (icon !== undefined) next.icon = icon
      if (entry.hidden === true) next.hidden = true
      if (!isEmptyCustomisation(next)) byId[id] = next
    }
  }
  const prefs: CameraAccessoryPrefs = { added, order, byId }
  return isEmptyAccessoryPrefs(prefs) ? undefined : prefs
}
