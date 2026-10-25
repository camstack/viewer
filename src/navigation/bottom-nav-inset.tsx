/**
 * How far content must stay clear of the floating bottom bar.
 *
 * The phone bar is a glass capsule drawn OVER the tab screens, so their lists
 * scroll under it. A list that ends at the window edge would leave its last row
 * behind the capsule; each scroll surface adds this inset to its bottom padding.
 * `0` outside the provider (and whenever the side rail is shown instead), so a
 * screen mounted anywhere else pays nothing.
 */
import React, { createContext, useContext } from 'react'

const BottomNavInsetContext = createContext(0)

export function BottomNavInsetProvider({
  inset,
  children,
}: {
  readonly inset: number
  readonly children: React.ReactNode
}): React.JSX.Element {
  return <BottomNavInsetContext.Provider value={inset}>{children}</BottomNavInsetContext.Provider>
}

/** Points the floating bar covers at the bottom of the window. */
export function useBottomNavInset(): number {
  return useContext(BottomNavInsetContext)
}

/**
 * Bottom padding of a tab-root scroller: its own `base` plus the capsule.
 *
 * The ONE rule of every tab root (Cameras, Grids, Library, Notifications,
 * Settings): the scroller runs to the bottom edge of the window so content
 * passes UNDER the glass, and ends `inset` points higher than that edge so the
 * last item clears it. A page that instead shortens its box leaves a blank
 * strip behind the capsule — the bug this replaces on every tab but Cameras.
 */
export function scrollBottomPadding(base: number, inset: number): number {
  return base + Math.max(0, inset)
}

/** {@link scrollBottomPadding} with the live inset — what a tab root calls. */
export function useTabScrollPadding(base = 0): number {
  return scrollBottomPadding(base, useBottomNavInset())
}
