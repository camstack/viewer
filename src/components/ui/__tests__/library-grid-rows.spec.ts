/**
 * @vitest-environment jsdom
 *
 * A Library page that grows by appending a page must keep the rows it already
 * painted. `FlatList` `numColumns` joins every cell id into the row key, so
 * the short tail is renamed when the next page fills it and that cell
 * unmounts — at the bottom of the list, the scroll offset returns to the top.
 */
import React, { useEffect } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FlatList, Text, View } from 'react-native'

import { libraryGridRows, type LibraryGridRow } from '../library-grid-rows.js'

const mounts = new Map<string, number>()
let listMounts = 0

function Cell({ id }: { readonly id: string }): React.JSX.Element {
  useEffect(() => {
    mounts.set(id, (mounts.get(id) ?? 0) + 1)
  }, [id])
  return React.createElement(Text, null, id)
}

function ListLifetime(): React.JSX.Element {
  useEffect(() => {
    listMounts += 1
  }, [])
  return React.createElement(View, null)
}

function Grid({ ids }: { readonly ids: readonly string[] }): React.JSX.Element {
  const rows = libraryGridRows(ids, 2, (id) => id)
  return React.createElement(FlatList<LibraryGridRow<string>>, {
    data: rows,
    keyExtractor: (row: LibraryGridRow<string>) => row.key,
    ListHeaderComponent: ListLifetime,
    renderItem: ({ item }: { item: LibraryGridRow<string> }) =>
      React.createElement(
        View,
        null,
        item.items.map((id) => React.createElement(Cell, { key: id, id })),
      ),
  })
}

const SCREENS = [
  'src/screens/faces/FaceReviewScreen.tsx',
  'src/screens/plates/PlateReviewScreen.tsx',
  'src/screens/artifacts/ArtifactsScreen.tsx',
  'src/screens/retrain/RetrainScreen.tsx',
]

describe('libraryGridRows', () => {
  afterEach(() => {
    cleanup()
    mounts.clear()
    listMounts = 0
  })

  it('names a row by its first item, so a short tail keeps its key when the next page fills it', () => {
    const page1 = libraryGridRows(['a', 'b', 'c'], 2, (id) => id)
    const page2 = libraryGridRows(['a', 'b', 'c', 'd', 'e'], 2, (id) => id)
    expect(page1.map((row) => row.key)).toEqual(['a', 'c'])
    expect(page2.map((row) => row.key).slice(0, page1.length)).toEqual(['a', 'c'])
    expect(page2[1]?.items).toEqual(['c', 'd'])
  })

  it('does not mutate the page it was given', () => {
    const page = ['a', 'b', 'c']
    libraryGridRows(page, 2, (id) => id)
    expect(page).toEqual(['a', 'b', 'c'])
  })

  it('answers one column for an unusable width, and nothing for an empty page', () => {
    expect(libraryGridRows(['a', 'b'], 0, (id) => id).map((row) => row.key)).toEqual(['a', 'b'])
    expect(libraryGridRows([], 3, (id) => id)).toEqual([])
  })

  it('keeps the painted cells and the list mounted when the next page arrives', () => {
    const view = render(React.createElement(Grid, { ids: ['a', 'b', 'c'] }))
    expect(mounts.get('a')).toBe(1)
    expect(mounts.get('c')).toBe(1)
    expect(listMounts).toBe(1)

    view.rerender(React.createElement(Grid, { ids: ['a', 'b', 'c', 'd', 'e'] }))

    expect(mounts.get('a')).toBe(1)
    expect(mounts.get('c')).toBe(1)
    expect(mounts.get('d')).toBe(1)
    expect(listMounts).toBe(1)
  })

  it('every paging Library grid chunks with that key and does not hand FlatList numColumns', () => {
    for (const path of SCREENS) {
      const src = readFileSync(join(process.cwd(), path), 'utf8')
      expect(src, path).toContain('libraryGridRows(')
      expect(src, path).not.toContain('numColumns=')
      expect(src, path).not.toMatch(/key=\{`cols-/)
      expect(src, path).not.toMatch(/\.join\(['"]\|['"]\)/)
    }
  })
})
