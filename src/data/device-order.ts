/**
 * device-order — the ONE place a saved LOCAL id order meets the devices that
 * actually exist.
 *
 * The order is the operator's own arrangement of their own list, persisted on
 * this device (`camera-prefs-store.order`). It therefore OUTLIVES the device set
 * it was written for: cameras get removed on the hub, new ones appear, and a
 * device the operator can see today may be absent from an arrangement saved
 * last month. The degradation rule is stated once, here, and both consumers
 * share it — the list transform (`applyCameraPrefs`) and the arrange session's
 * cancel, which has to rebuild the order the operator started from.
 *
 * THE RULE
 *  • A device NAMED in the saved order takes that order's position.
 *  • A device the order never heard of keeps its relative INPUT (server) order
 *    and follows every named one. A camera added on the hub therefore appears
 *    at the END of the list — one predictable place, not wherever a hash landed.
 *  • An id whose device is gone is skipped; it leaves no hole and costs the
 *    devices after it nothing.
 *  • The output is always a PERMUTATION of the input. A saved order is allowed
 *    to move a device and is never allowed to hide one — hiding is a different
 *    preference (`CameraPref.hidden`), with its own switch.
 */

/** Anything with a numeric device id. */
export interface Identified {
  readonly id: number
}

/**
 * Order `items` by a saved id order, per the rule above. Pure: the input array
 * is never mutated and a new array is always returned.
 */
export function applySavedOrder<T extends Identified>(
  items: readonly T[],
  order: readonly number[],
): T[] {
  if (order.length === 0) return [...items]

  const rank = new Map<number, number>()
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i)
  })

  // Decorate with the input index so the sort is stable for the unranked tail
  // even where the engine's sort is not.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ra = rank.get(a.item.id)
      const rb = rank.get(b.item.id)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return a.i - b.i
    })
    .map((x) => x.item)
}
