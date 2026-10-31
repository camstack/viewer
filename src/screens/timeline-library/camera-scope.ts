/**
 * camera-scope — which cameras the Library timeline reads.
 *
 * The scope is a PICK that is either "every camera" (`null`, the default) or an
 * explicit list. "Every" is a state and not a copy of the list: a camera that
 * joins the fleet while the page is open belongs to the timeline of someone who
 * asked for all of them, and a stored snapshot of the ids would leave it out
 * without saying so.
 *
 * Pure — no React, no store. The scope itself is a screen-local `useState`:
 * it is an investigation, like the activity filter, not a preference.
 */

/** `null` ⟺ every camera. Otherwise the ids the operator kept. */
export type CameraPick = readonly number[] | null

/** The cameras a pick means, in the FLEET's order (the order decides which
 *  camera an over-large scope drops — `planScopeAsk`). */
export function resolveCameraScope(known: readonly number[], pick: CameraPick): readonly number[] {
  if (pick === null) return known
  const kept = new Set(pick)
  return known.filter((id) => kept.has(id))
}

/**
 * Turn the ids a panel reports into a pick. The whole fleet collapses back to
 * `null`, so re-ticking every box returns to "all" — including the cameras that
 * arrive later — instead of freezing today's list.
 */
export function pickFromIds(known: readonly number[], ids: readonly number[]): CameraPick {
  const kept = new Set(ids)
  const inFleet = known.filter((id) => kept.has(id))
  return inFleet.length === known.length ? null : inFleet
}

/** The ids a panel shows ticked for a pick — the pick resolved, never stored. */
export function ticksFor(known: readonly number[], pick: CameraPick): ReadonlySet<number> {
  return new Set(resolveCameraScope(known, pick))
}
