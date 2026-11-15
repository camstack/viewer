/**
 * camera-scope — which cameras the Library timeline reads.
 *
 * The pick is an explicit list, remembered on this device (`library-filters.ts`,
 * section `timeline`). Nothing stored is nothing selected: the first visit does
 * not mean "every camera". A camera that joins the fleet later stays out until
 * the operator ticks it. Ids the fleet no longer has are dropped here, and the
 * stored document drops them once the camera list has answered.
 *
 * Pure — no React, no store.
 */

/** The ids the operator kept, in no particular order. */
export type CameraPick = readonly number[]

/** The cameras a pick means, in the FLEET's order. Unknown ids are omitted. */
export function resolveCameraScope(known: readonly number[], pick: CameraPick): readonly number[] {
  const kept = new Set(pick)
  return known.filter((id) => kept.has(id))
}

/** The ids a panel reports, kept in fleet order, without ids the fleet lacks. */
export function pickFromIds(known: readonly number[], ids: readonly number[]): CameraPick {
  const kept = new Set(ids)
  return known.filter((id) => kept.has(id))
}

/** The ids a panel shows ticked for a pick. */
export function ticksFor(known: readonly number[], pick: CameraPick): ReadonlySet<number> {
  return new Set(resolveCameraScope(known, pick))
}
