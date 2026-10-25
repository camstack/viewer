/**
 * The measured half of the Library column rule (`library-grid.ts`): a grid
 * page puts `onLayout` on the box its list fills and reads `columns` and
 * `tileWidth` back. `rule` picks the column rule (the Library's own by
 * default; `events` for a grid that packs like the events gallery). Until the first positive measurement the window width
 * stands in, so the first frame lays out at a plausible count.
 */
import { useCallback, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { useScreenMinSide } from '../../hooks/use-responsive.js'
import { galleryColumns, galleryDeviceClass, type GridDensity } from '../../store/settings-store.js'
import { LIBRARY_COLUMN_RULE, libraryGridColumnsFor, libraryTileWidth, type LibraryColumnRule } from './library-grid.js'

export interface LibraryGrid {
  readonly columns: number
  readonly tileWidth: number
  readonly onLayout: (event: LayoutChangeEvent) => void
}

export function useLibraryGrid(rule: LibraryColumnRule = LIBRARY_COLUMN_RULE): LibraryGrid {
  const viewport = useViewportSize()
  const windowWidth = viewport.width
  // The events gallery's device class, read the same way it reads it.
  const screenMinSide = useScreenMinSide() ?? Math.min(viewport.width, viewport.height)
  const [measured, setMeasured] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width)
    if (next > 0) setMeasured(next)
  }, [])
  const width = measured > 0 ? measured : windowWidth
  const device = galleryDeviceClass(screenMinSide)
  const columns = libraryGridColumnsFor(width, rule, (w: number, density: GridDensity) => galleryColumns(w, density, device))
  return { columns, tileWidth: libraryTileWidth(width, columns), onLayout }
}
