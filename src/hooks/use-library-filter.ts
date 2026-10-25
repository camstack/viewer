/**
 * One Library page's remembered filter (`store/library-filters.ts`): the stored
 * value parsed, with ids that no longer exist dropped, and a setter that
 * remembers on this device.
 *
 * A dropped id is dropped for good: once the list it was checked against has
 * answered, the pruned value is written back, so a deleted camera never comes
 * back as a phantom chip on a later launch.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useAllCameras } from '../data/use-cameras.js'
import { useLibraryFilterStore } from '../store/library-filter-store.js'
import type { LibraryFilterSection } from '../store/library-filters.js'

export interface LibraryFilterState<T> {
  /** The remembered value (defaults until storage answered, and when nothing is stored). */
  readonly value: T
  /** Takes the CURRENT value (the store's, not a render's) and returns the next. */
  readonly set: (update: (prev: T) => T) => void
  /** Forget it: the page is back on its defaults, now and on the next launch. */
  readonly clear: () => void
  /** Storage has answered (a page can hold its query until then). */
  readonly hydrated: boolean
}

/**
 * `prune` must be referentially stable while its inputs are, and must return
 * its argument UNCHANGED (same reference) when it dropped nothing.
 */
export function useLibraryFilter<T>(
  section: LibraryFilterSection,
  parse: (raw: unknown) => T,
  prune: (value: T) => T,
): LibraryFilterState<T> {
  const raw = useLibraryFilterStore((s) => s.values[section])
  const hydrated = useLibraryFilterStore((s) => s.hydrated)
  const hydrate = useLibraryFilterStore((s) => s.hydrate)
  const write = useLibraryFilterStore((s) => s.write)
  const forget = useLibraryFilterStore((s) => s.clear)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const stored = useMemo(() => parse(raw), [parse, raw])
  const value = useMemo(() => prune(stored), [prune, stored])

  useEffect(() => {
    if (hydrated && raw !== undefined && value !== stored) write(section, value)
  }, [hydrated, raw, value, stored, write, section])

  const set = useCallback(
    (update: (prev: T) => T) => {
      write(section, update(prune(parse(useLibraryFilterStore.getState().values[section]))))
    },
    [parse, prune, section, write],
  )
  const clear = useCallback(() => forget(section), [forget, section])

  return { value, set, clear, hydrated }
}

/**
 * The ids of every camera the hub has (hidden ones included — hiding a camera
 * is not deleting it), or `undefined` while the list has not answered. An
 * EMPTY list is treated as unanswered too: a hub reporting no cameras at all is
 * far more likely a list that could not be read than a hub whose every camera
 * was deleted, and pruning against it would forget every remembered camera.
 */
export function useKnownCameraIds(): ReadonlySet<number> | undefined {
  const { data } = useAllCameras()
  return useMemo(() => (data !== undefined && data.length > 0 ? new Set(data.map((c) => c.id)) : undefined), [data])
}
