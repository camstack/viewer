/**
 * Off the local network, recorded playback (and the live edge that shares its
 * target) must ask for `low`. These are wiring assertions — the pure clamp is
 * in `quality-scale.spec.ts`; this file proves the two player surfaces call it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

function src(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

describe('remote playback quality wiring', () => {
  it('the theater clamps the LiveView target through qualityToTargetForRoute', () => {
    const detail = src('screens/CameraDetailScreen.tsx')
    expect(detail).toContain('useRouteChannel')
    expect(detail).toContain('qualityToTargetForRoute')
    // The stream is clamped via `liveTarget`; the chip shows the preference so
    // a pick off-LAN still updates the selector (the clamp is not "your pick
    // failed").
    // The single picture's binding; with the wall up the chip binds the wall's
    // session tier instead (`wallQualityPick ?? quality`), still a preference.
    expect(detail).toContain(': { quality, onSelectQuality: onQualityChange }')
    expect(detail).toContain('{ quality: wallQualityPick ?? quality, onSelectQuality: onWallQualityChange }')
    expect(detail).toContain('qualityToTargetForRoute(quality, routeChannel)')
  })

  it('the on-demand overlay pins the same clamp (it opens recorded)', () => {
    const ondemand = src('components/camera/OnDemandPlayer.tsx')
    expect(ondemand).toContain('useRouteChannel')
    expect(ondemand).toContain('qualityToTargetForRoute')
    expect(ondemand).toContain('target={liveTarget}')
  })
})
