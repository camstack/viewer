/**
 * clip-list-identity — the one rule that lets a clip list travel between two
 * components without becoming a render loop.
 *
 * ## What this is paying for
 *
 * The clip list is derived in the timeline's body and needed by the camera's
 * frame (the frame steps through it). Sending it up means putting it in state,
 * and putting a DERIVED ARRAY in state is only safe if the array's identity
 * means something.
 *
 * It did not. `useCameraClips` builds its empty list as a fresh `[]` inside a
 * `useMemo` whose dependency list includes the react-query RESULT objects,
 * whose identity changes on every render. So on a camera whose clip query has
 * not answered — or one on the CamStack source, where the cap is not asked at
 * all — `clips.clips` was a NEW array every render. `derivedClips` lists it as
 * a dep, so it recomputed; `cameraClips` recomputed; the publish effect fired;
 * the screen set state; the screen re-rendered; the timeline re-rendered; and
 * around again at frame rate.
 *
 * On device 3629 ("Camera porta retro", a sleeping battery camera) that
 * starved the JS thread — *"non posso più muovere"*.
 *
 * ## Two fixes, and both are load-bearing
 *
 * `useCameraClips` now returns a module-level constant for its empty list, so
 * the common churn is gone at the SOURCE. This module is the belt: the screen
 * adopts a published list only when it actually says something new, so the loop
 * cannot come back through a dependency nobody has audited (`eventClusters` and
 * `activity.recording` are also deps of `derivedClips`, and neither was checked).
 *
 * Fixing only the source would leave the hazard one careless memo away; fixing
 * only this would leave every other consumer of `clips.clips` recomputing for
 * ever. Neither alone is the fix.
 *
 * ## Why ids and not a deep compare
 *
 * This runs whenever the array identity churns, over up to 357 rows (592).
 * Comparing ids is bounded and is exactly the question the consumer asks: the
 * frame steps through the list BY id, so two lists with the same ids in the
 * same order are the same list as far as stepping is concerned. A clip whose
 * thumbnail changed is not a different clip to step onto.
 *
 * Pure: no React, no i18n, no network.
 */

import type { Clip } from './clip-model.js'

/** The same clips, in the same order — judged by identity, which is what the
 *  frame's stepping actually consumes. */
export function sameClipList(a: readonly Clip[], b: readonly Clip[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.clipId !== b[i]?.clipId) return false
  }
  return true
}

/**
 * The value a `setState` updater should return for a freshly published list.
 *
 * Returns `prev` — **the same reference** — when nothing changed, because
 * reference equality is the entire mechanism: React bails out of the re-render
 * only when the state value is identical. Returning a content-equal copy would
 * stop nothing, which is why the spec asserts `toBe` and not `toEqual`.
 */
export function adoptClipList(prev: readonly Clip[], next: readonly Clip[]): readonly Clip[] {
  return sameClipList(prev, next) ? prev : next
}
