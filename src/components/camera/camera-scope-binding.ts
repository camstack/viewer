/** Scope mode: the ticked cameras are the surface's data scope. */
export interface CameraScopeBinding {
  /** The cameras currently read. */
  readonly selectedIds: ReadonlySet<number>
  /** The new scope, in LIST order, after a tick or "all cameras". */
  readonly onChange: (ids: readonly number[]) => void
}

/**
 * Select-all is a toggle. Every camera already ticked clears the selection;
 * otherwise every camera in list order becomes the selection.
 */
export function toggleSelectAll(known: readonly number[], selected: ReadonlySet<number>): readonly number[] {
  if (known.length === 0) return []
  const allTicked = known.every((id) => selected.has(id))
  return allTicked ? [] : [...known]
}
