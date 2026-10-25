/**
 * Who owns a grid's view switches — pinned at the source.
 *
 * The border highlight, the active-only filter and the box-overlay layers are
 * PER-GRID SETTINGS. They were regressed into `useState` seeded from literals,
 * which is why they "did not persist across reopen": there was no write path at
 * all, so nothing was ever saved and every reopen re-seeded them off. The store
 * round trip (`store/__tests__/grid-store-persistence.spec.ts`) cannot see that
 * — it proves storage works, and storage was never the broken half.
 *
 * The viewer cannot mount components (vitest runs `node`, no renderer — see
 * `docs/roadmap.md`), so this is a source assertion in the style of
 * `live/__tests__/mute-ownership-wiring.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const screen = readFileSync(join(SRC, 'screens/GridViewScreen.tsx'), 'utf8')

describe('the grid view switches live in the grid, not in the screen', () => {
  it('reads the switches off the resolved per-grid options', () => {
    expect(screen).toContain('const highlightOn = options.highlightOn')
    expect(screen).toContain('const activeOnly = options.activeOnly')
    expect(screen).toContain('const layers: readonly OverlayLayer[] = options.layers')
  })

  it('never re-seeds a switch from a component-local literal', () => {
    // The exact shape of the regression. A blanket `useState(false)` ban would
    // not discriminate — `shareOpen` is dialog visibility and belongs there;
    // these three setters exist only if the switch went back to local state.
    expect(screen).not.toContain('useState<readonly OverlayLayer[]>')
    expect(screen).not.toContain('setHighlightOn')
    expect(screen).not.toContain('setActiveOnly')
    expect(screen).not.toContain('setLayers')
  })

  it('every toggle writes back through the per-grid options patcher', () => {
    expect(screen).toContain('updateGridOptions({ highlightOn: !highlightOn })')
    expect(screen).toContain('updateGridOptions({ activeOnly: !activeOnly })')
    expect(screen).toContain('updateGridOptions({\n          layers:')
  })

  it('pause stays session-only — a wall that reopens frozen looks broken', () => {
    expect(screen).toContain('const [pausedIds, setPausedIds] = useState<ReadonlySet<number>>(new Set())')
  })

  it('the timeline toggle is session-only, and it never decides the TREE', () => {
    // Two different questions, and keeping them apart is the whole safety of
    // the feature. Whether this page HAS a timeline is a property of the
    // viewport (`shouldMountGridTimeline`) and decides what is mounted; the
    // operator's clock button only says whether the mounted chrome is DRAWN.
    // Collapsing them back into one — mounting the host on the toggle — would
    // re-parent the wall and re-dial every peer on it, which is why the button
    // was deleted in the first place (`grid-timeline-toggle.spec.ts`).
    expect(screen).toContain('const [timelineOn, setTimelineOn] = useState(false)')
    expect(screen).toContain('shouldMountGridTimeline(viewportInput)')
    expect(screen).toContain('chromeHidden={!timelineOn}')
    // Session-only, like `pausedIds` above: nothing writes it to a store.
    expect(screen).not.toContain('setGridOptions(gridId, { timelineOn')
  })

  // POP_TO, not REPLACE: replace mints a SECOND tab navigator instead of
  // returning to the mounted one, so the list behind the wall reopens scrolled
  // to the top. See `src/navigation/back-to-cameras.ts`.
  it('back always lands on the cameras tab, never router.back()', () => {
    expect(screen).toContain('const goBack = (): void => backToCameras(router)')
    expect(screen).not.toContain('router.back()')
    expect(screen).not.toContain("router.replace('/cameras')")
  })

  it('opening a tile replaces the grid so the wall unmounts instead of stacking', () => {
    expect(screen).toContain('onTileOpen={(id) => router.replace(`/camera/${id}`)}')
  })

  it('pauses the wall when the grid is covered or backgrounded', () => {
    expect(screen).toContain('useScreenActive')
    expect(screen).toContain('screenActive')
  })
})
