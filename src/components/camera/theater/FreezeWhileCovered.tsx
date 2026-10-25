/**
 * FreezeWhileCovered — keep a subtree MOUNTED but stop reconciling it while it
 * is covered by something opaque.
 *
 * The consumer is the timeline body: a panel that opens over the timeline must
 * never unmount it (scroll offset, zoom, the measured viewport and every
 * decoded thumb would be lost — the operator's "opening a track loses the
 * timeline state"). But a timeline that stays mounted under an opaque panel
 * would keep re-rendering on every live-edge tick for a surface nobody can
 * see. So while `frozen`:
 *
 *  • the child element is NOT reconciled — `memo`'s comparator reports "equal",
 *    React bails out, and the subtree does zero render work;
 *  • the child instance survives untouched — state, refs and native views are
 *    exactly where they were;
 *  • context changes still propagate (context bypasses `memo`), so a theme
 *    flip is not lost.
 *
 * On unfreeze the comparator reports "changed" and the subtree catches up with
 * the CURRENT child in a single render.
 */
import React, { memo } from 'react'

export interface FreezeWhileCoveredProps {
  /** True while the subtree is covered: reconciliation stops, instance stays. */
  readonly frozen: boolean
  readonly children: React.ReactElement
}

export const FreezeWhileCovered = memo(
  function FreezeWhileCovered({ children }: FreezeWhileCoveredProps): React.ReactElement {
    return children
  },
  // memo semantics: return TRUE to skip the re-render. Frozen ⇒ skip; the
  // previous element (and everything under it) is left exactly as it was.
  (_prev, next) => next.frozen,
)
