/**
 * The Library's ONE column rule and tile geometry (`library-grid.ts`), agreed
 * with the operator on 2026-10-21: 2 columns on a phone, 3 on a tablet in
 * portrait, 4–5 on a desktop — for Media, Plates and Retrain. People (2026-10-22)
 * draws the events gallery's square tile and packs by its column rule.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCREEN_GUTTER } from '../../../theme/tokens.js'
import { galleryColumns, type GalleryDeviceClass, type GridDensity } from '../../../store/settings-store.js'

const at = (device: GalleryDeviceClass) => (width: number, density: GridDensity): number =>
  galleryColumns(width, density, device)
import {
  LIBRARY_GRID_GAP,
  LIBRARY_GRID_PADDING,
  LIBRARY_COLUMN_RULE,
  LIBRARY_TILE_ASPECT,
  libraryGridColumns,
  libraryTileLongPress,
  libraryGridColumnsFor,
  libraryPrimaryShowsLabel,
  libraryTileAspect,
  libraryTileImageState,
  libraryTileWidth,
} from '../library-grid.js'

describe('libraryGridColumns', () => {
  it.each([
    [320, 2],
    [390, 2],
    [430, 2],
    [599, 2],
    [600, 3],
    [744, 3], // iPad mini portrait, or an 820 pt iPad minus the side rail
    [899, 3],
    [900, 4],
    [1180, 4], // iPad Air landscape
    [1279, 4],
    [1280, 5],
    [1920, 5],
  ])('a %i pt list gets %i columns', (width, columns) => {
    expect(libraryGridColumns(width)).toBe(columns)
  })

  it('answers the phone count, never 0, before the first measurement', () => {
    expect(libraryGridColumns(0)).toBe(2)
    expect(libraryGridColumns(Number.NaN)).toBe(2)
    expect(libraryGridColumns(-10)).toBe(2)
  })
})

describe('libraryGridColumnsFor', () => {
  it('the library rule is libraryGridColumns', () => {
    expect(libraryGridColumnsFor(390, LIBRARY_COLUMN_RULE, at('phone'))).toBe(2)
    expect(libraryGridColumnsFor(744, LIBRARY_COLUMN_RULE, at('tablet'))).toBe(3)
  })
  it.each([
    [390, 'phone', 'medium'],
    [390, 'phone', 'compact'],
    [390, 'phone', 'large'],
    [744, 'tablet', 'medium'],
    [1024, 'tablet', 'medium'],
    [1440, 'desktop', 'large'],
  ] as const)('the events rule at %i pt on a %s (%s) is the events gallery count', (width, device, density) => {
    expect(libraryGridColumnsFor(width, { kind: 'events', density }, at(device))).toBe(galleryColumns(width, density, device))
  })
  it('a 390 pt phone at the default density gets the events grid\'s 4 columns', () => {
    expect(libraryGridColumnsFor(390, { kind: 'events', density: 'medium' }, at('phone'))).toBe(4)
  })
  it('answers the phone count, never 0, before the first measurement', () => {
    expect(libraryGridColumnsFor(0, { kind: 'events', density: 'medium' }, at('phone'))).toBe(2)
  })
})

describe('libraryTileAspect', () => {
  it('is 16:9 for a frame and 1:1 (the events tile) for a square', () => {
    expect(libraryTileAspect('frame')).toBe(LIBRARY_TILE_ASPECT)
    expect(libraryTileAspect('square')).toBe(1)
  })
})

describe('libraryTileWidth', () => {
  it('is one width for every row, so the columns fill a row exactly', () => {
    const w = libraryTileWidth(390, 2)
    expect(w).toBe(177)
    expect(w * 2 + LIBRARY_GRID_GAP + LIBRARY_GRID_PADDING * 2).toBeLessThanOrEqual(390)
  })
  it('pads a row by the screen gutter, the scope bar\'s own inset', () => {
    expect(LIBRARY_GRID_PADDING).toBe(SCREEN_GUTTER)
  })
  it('never goes negative or divides by zero', () => {
    expect(libraryTileWidth(10, 8)).toBe(0)
    expect(libraryTileWidth(400, 0)).toBe(0)
  })
})

describe('libraryTileImageState', () => {
  it('draws the image it was given', () => {
    expect(libraryTileImageState({ hasSource: true, loading: false, broken: false })).toBe('image')
  })
  it('is a placeholder — never an empty box — when there is no image', () => {
    expect(libraryTileImageState({ hasSource: false, loading: false, broken: false })).toBe('placeholder')
  })
  it('is a placeholder when the image failed to load', () => {
    expect(libraryTileImageState({ hasSource: true, loading: false, broken: true })).toBe('placeholder')
  })
  it('is a skeleton only while the source is still being fetched — unknown is not absent', () => {
    expect(libraryTileImageState({ hasSource: false, loading: true, broken: false })).toBe('loading')
  })
})

describe('libraryPrimaryShowsLabel', () => {
  it('is the bare "+" on a phone and labelled on a tablet or desktop', () => {
    expect(libraryPrimaryShowsLabel(390)).toBe(false)
    expect(libraryPrimaryShowsLabel(820)).toBe(true)
    expect(libraryPrimaryShowsLabel(1440)).toBe(true)
  })
})

describe('every Library grid uses the one rule', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
  it.each([
    'src/screens/faces/FaceReviewScreen.tsx',
    'src/screens/plates/PlateReviewScreen.tsx',
    'src/screens/retrain/RetrainScreen.tsx',
    'src/screens/artifacts/ArtifactsScreen.tsx',
  ])('%s solves its columns through useLibraryGrid, with no target width of its own', (path) => {
    const src = read(path)
    expect(src).toMatch(/useLibraryGrid\((columnRule)?\)/)
    expect(src).not.toMatch(/TARGET_CELL_WIDTH|GRID_COLUMNS\s*=/)
    expect(src).toContain('LIBRARY_GRID_BOTTOM_PADDING')
  })
  it.each([
    'src/components/review/ReviewTile.tsx',
    'src/screens/retrain/RetrainFrameThumb.tsx',
    'src/components/artifacts/ArtifactCard.tsx',
    'src/components/artifacts/ExportCard.tsx',
  ])('%s is drawn as the shared LibraryTile', (path) => {
    expect(read(path)).toContain('<LibraryTile')
  })
})

describe('People is the events tile; the other Library grids stay 16:9', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
  it('the face tile is square, the plate tile a 16:9 frame — one tile, two ratios', () => {
    expect(read('src/components/review/review-tile.ts')).toMatch(/faceReviewTileContent[\s\S]*?shape: 'square'/)
    expect(read('src/components/review/review-tile.ts')).toMatch(/plateReviewTileContent[\s\S]*?shape: 'frame'/)
    expect(read('src/components/review/ReviewTile.tsx')).toContain('shape={content.shape}')
  })
  it('the face grid is packed by the events column rule', () => {
    const screen = read('src/screens/faces/FaceReviewScreen.tsx')
    expect(screen).toContain("kind: 'events'")
    expect(screen).toContain('settings.events.gridDensity')
  })
  it.each([
    'src/screens/retrain/RetrainFrameThumb.tsx',
    'src/components/artifacts/ArtifactCard.tsx',
    'src/components/artifacts/ExportCard.tsx',
  ])('%s keeps the 16:9 frame', (path) => {
    expect(read(path)).not.toContain('shape="square"')
  })
  it.each([
    'src/screens/plates/PlateReviewScreen.tsx',
    'src/screens/retrain/RetrainScreen.tsx',
    'src/screens/artifacts/ArtifactsScreen.tsx',
  ])('%s keeps the Library column rule', (path) => {
    expect(read(path)).toContain('useLibraryGrid()')
  })
})

describe('one side gutter under the scope bar', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
  it.each([
    'src/components/ui/ScopeBar.tsx',
    'src/components/ui/LibraryFilterBar.tsx',
    'src/screens/SettingsScreen.tsx',
  ])('%s lays out on SCREEN_GUTTER', (path) => {
    expect(read(path)).toContain('SCREEN_GUTTER')
  })
})

describe('long-press on a selectable tile (operator, 2026-10-22)', () => {
  it('starts selection outside the mode and toggles inside it — it never opens the detail', () => {
    expect(libraryTileLongPress(false)).toBe('start-selection')
    expect(libraryTileLongPress(true)).toBe('toggle')
  })

  it.each([
    ['src/components/review/ReviewTile.tsx', 'onStartSelect(id)'],
  ])('%s hands the tile a long-press that starts selection', (file, call) => {
    const src = readFileSync(join(__dirname, '../../../..', file), 'utf8')
    expect(src).toContain('onLongPress={longPress}')
    expect(src).toContain(call)
    expect(src).not.toMatch(/[Tt]ap (OR|or) long-press/)
  })

  it.each([
    ['src/screens/faces/FaceReviewScreen.tsx'],
    ['src/screens/plates/PlateReviewScreen.tsx'],
  ])('%s enters selection mode with the pressed tile selected, with a haptic', (file) => {
    const src = readFileSync(join(__dirname, '../../../..', file), 'utf8')
    expect(src).toMatch(/hapticAction\(\)\s+setSelectionMode\(true\)\s+setSelected\(new Set\(\[\w+\]\)\)/)
  })
})
