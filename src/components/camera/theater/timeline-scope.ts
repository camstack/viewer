/**
 * Timeline camera scope — the set of devices a theater timeline aggregates.
 *
 * Camera-detail seeds `[deviceId]`; a populated workspace seeds the picture
 * plus every member (`workspaceTimelineScope`). Pure, so the rules are
 * unit-tested without React.
 *
 * ## What this module lost when it was finally wired up (2026-09-02)
 *
 * It was written ahead of its consumer and shipped with six functions, of which
 * three had no place once the feature was real. They are gone rather than kept
 * "in case", because an unused export that describes a design reads as
 * verification of it:
 *
 *  - `toggleTimelineScope` assumed the operator could drop a camera from the
 *    TIMELINE while leaving it on the wall. That is a second knob disagreeing
 *    with the first: the view IS the scope, and taking a camera out of the
 *    timeline is taking it out of the view (`workspace.ts`'s `removeMember`).
 *  - `reconcileTimelineScope` reconciled the scope against the known cameras.
 *    The workspace store already does exactly that to its MEMBERS
 *    (`reconcileMembers`), and the scope is derived from them — two reconcilers
 *    over one fact is how they end up disagreeing.
 *  - `normalizeDeviceIds` sorted a scope. `scopeQueryKey` does its own sorting
 *    for the cache key, and everywhere else the order is load-bearing (it
 *    decides which camera a batch ceiling drops — `planScopeAsk`).
 */

/** Seed the scope from the grid (or fall back to the surface's primary). */
export function initTimelineScope(
  seedIds: readonly number[],
  fallbackId: number,
): readonly number[] {
  const unique: number[] = []
  const seen = new Set<number>()
  for (const id of seedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique.length > 0 ? unique : [fallbackId]
}

/**
 * React Query key fragment. A single camera stays a number so the existing
 * `device-tracks` / `activity` cache still hits on camera-detail.
 */
export function scopeQueryKey(ids: readonly number[]): number | string {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (unique.length === 0) return 0
  if (unique.length === 1) return unique[0]!
  return unique.join(',')
}

/** Union of calendar-day dots (date picker) across cameras. */
export function unionDaySets(sets: readonly ReadonlySet<number>[]): Set<number> {
  const out = new Set<number>()
  for (const s of sets) {
    for (const d of s) out.add(d)
  }
  return out
}
