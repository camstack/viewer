import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RECONCILE_MS, STATIONARY_POLL_MS } from '../../../../data/reconcile.js'

/**
 * Why the parked boxes never drew, and what now makes them drawable.
 *
 * Two independent mechanisms, both verified:
 *
 *  1. NO GATE OF THEIR OWN. `MotionBoxesOverlay` drew the parked objects inside
 *     the component that draws the live detections, so the only switch was
 *     `overlay.boxes !== 'off'` — and `boxes` defaults to `off`. A fresh install
 *     never drew a parked car, and "parked only" was inexpressible.
 *
 *  2. NO FRESHNESS. `useCurrentOccupancy` polls at `RECONCILE_MS` (5 minutes)
 *     and the live nudge that would have covered it never fires for this
 *     transition: the hub emits `zone-analytics.occupancy-changed` ONLY when
 *     `frame.totalObjects` CHANGES (server `zone-analytics-provider.ts`), and a
 *     promoted object is folded straight back into the occupancy `tracked` list
 *     as `stationary:<id>` (server `pipeline-analytics/index.ts`) — so the total
 *     is identical across the promotion and no event is emitted. The 5-minute
 *     reconcile was the ONLY path, which reads as "the box didn't show up".
 *
 * Source guards, because this repo has no renderer (vitest runs `node`,
 * `*.spec.ts` only). One assertion per defect.
 */
const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the parked layer has a gate of its own', () => {
  it('lives in its own component instead of riding the detection boxes', () => {
    const stationary = read('components/camera/StationaryBoxesOverlay.tsx')
    expect(stationary).toContain('useCurrentOccupancy')
    expect(stationary).toContain('stationaryObjects')
  })

  it('leaves no parked drawing behind in the detection-box overlay', () => {
    // The leftover that would read as a second answer to the same question.
    const boxes = read('components/camera/MotionBoxesOverlay.tsx')
    expect(boxes).not.toContain('stationaryObjects')
    expect(boxes).not.toContain('useCurrentOccupancy')
    expect(boxes).not.toContain('becameStationaryAt')
  })

  it('the camera screen mounts each layer from its OWN membership test', () => {
    const screen = read('screens/CameraDetailScreen.tsx')
    expect(screen).toContain("hasLayer(overlay, 'motion')")
    expect(screen).toContain("hasLayer(overlay, 'objects')")
    expect(screen).toContain("hasLayer(overlay, 'discarded')")
    expect(screen).toContain("hasLayer(overlay, 'stationary')")
    expect(screen).toContain('<StationaryBoxesOverlay')
  })

  it('the grid tile draws the parked layer too, from the WALL’s set', () => {
    // An operator who asked for parked boxes in the single view and saw none on
    // the wall would call the wall broken.
    const tile = read('components/grid/GridTile.tsx')
    expect(tile).toContain('<StationaryBoxesOverlay')
    expect(tile).toContain("layers.includes('stationary')")
  })
})

describe('the parked layer is fresh enough to look alive', () => {
  it('no longer polls faster than the five-minute reconcile — the event is the mechanism', () => {
    expect(STATIONARY_POLL_MS).toBeLessThan(RECONCILE_MS)
    expect(read('components/camera/StationaryBoxesOverlay.tsx')).not.toContain('STATIONARY_POLL_MS')
    expect(read('data/use-live-invalidation.ts')).toContain("'pipeline-analytics.stationary-changed'")
  })

  it('pairs staleTime with whatever interval the caller asked for', () => {
    const hook = read('data/use-occupancy.ts')
    expect(hook).toContain('staleTime: intervalMs')
    expect(hook).toContain('refetchInterval: intervalMs')
  })

  it('only the parked overlay used to ask for the fast cadence — occupancy chips never did', () => {
    expect(read('components/camera/OccupancyBadge.tsx')).not.toContain('STATIONARY_POLL_MS')
  })
})

describe('nothing parsed is left unrendered', () => {
  it('renders the parked COUNT, which was parsed and consumed by nothing', () => {
    // `stationaryCount` counts every reported parked object; the overlay draws
    // only the DRAWABLE ones. A leftover that describes the right design is
    // worse than nothing, so the number has a home.
    const badge = read('components/camera/OccupancyBadge.tsx')
    expect(badge).toContain('stationaryCount')
  })
})
