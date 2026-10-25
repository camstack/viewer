/**
 * The simulated navigation FOCUS, kept OUT of the expo-router stub.
 *
 * `freezeOnBlur: false` means a pushed route leaves the screen underneath
 * MOUNTED: its effects never re-run when it comes back to the front, so
 * anything app-wide that another route changed while it was covered (the
 * orientation lock) stays changed. `useFocusEffect` is the only hook that fires
 * again on a return, so a harness that cannot re-focus a mounted tree cannot
 * tell a `useEffect` from a `useFocusEffect` — and that difference is the whole
 * defect.
 *
 * Same split as `app-state-control.ts` / `orientation-control.ts`: plain typed
 * module here, adapter in the stub.
 */
import { useSyncExternalStore } from 'react'

let generation = 0
let focused = true
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): number {
  return generation
}

/** Wired by the expo-router stub's `useFocusEffect`; re-runs its effect on
 *  every {@link emitFocus}. */
export function useTestFocusGeneration(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Bring the mounted tree back to the front, the way popping a pushed route
 * does. Wrap the call in `act()`.
 */
export function emitFocus(): void {
  generation += 1
  for (const listener of [...listeners]) listener()
}

export function resetTestFocus(): void {
  generation = 0
  focused = true
}

function focusedSnapshot(): boolean {
  return focused
}

/** Wired by the expo-router stub's `useIsFocused`; follows {@link setTestFocused}. */
export function useTestIsFocused(): boolean {
  return useSyncExternalStore(subscribe, focusedSnapshot, focusedSnapshot)
}

/**
 * Cover or reveal the mounted tree the way a pushed route does: `false` is a
 * screen left mounted underneath another one. Wrap the call in `act()`.
 */
export function setTestFocused(next: boolean): void {
  focused = next
  for (const listener of [...listeners]) listener()
}
