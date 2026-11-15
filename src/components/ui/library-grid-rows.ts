/**
 * Rows of a Library grid, keyed so a later page cannot rename a row that is
 * already on screen.
 *
 * `FlatList`'s `numColumns` builds each row key by joining every cell key
 * (`a:b`). The last row of a page is often short; the next page fills it, the
 * joined key changes, and the virtualised list drops that cell. The operator
 * is at the end of the list when the page arrives, so the scroll offset goes
 * back to the top. The row key here is the FIRST item's id: filling the tail
 * keeps the key, and the list instance stays mounted.
 */
export interface LibraryGridRow<T> {
  readonly key: string
  readonly items: readonly T[]
}

/** Id of one cell. Unique across the list — it is the row key of the row that starts with that cell. */
export type LibraryGridRowId<T> = (item: T) => string

export function libraryGridRows<T>(
  items: readonly T[],
  columns: number,
  idOf: LibraryGridRowId<T>,
): readonly LibraryGridRow<T>[] {
  const width = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 1
  const rows: LibraryGridRow<T>[] = []
  for (let start = 0; start < items.length; start += width) {
    const slice = items.slice(start, start + width)
    const first = slice[0]
    if (first === undefined) continue
    rows.push({ key: idOf(first), items: slice })
  }
  return rows
}
