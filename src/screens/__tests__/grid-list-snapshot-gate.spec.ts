/**
 * Grid list thumbs and the web builder palette used to call
 * `useSnapshot(id, true)` with no screen gate. Tabs stay mounted under a
 * pushed camera detail (`freezeOnBlur: false`), so that `true` kept
 * `getSnapshotLinks` capturing the whole strip every 5 s while the operator
 * scrubbed — the same standing capture order D108 made of a named target.
 *
 * Camera cards already go through `shouldRequestSnapshot` + `useScreenActive`.
 * These surfaces must use the same gate.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const grids = readFileSync(join(SRC, 'screens/GridsScreen.tsx'), 'utf8')
const builder = readFileSync(join(SRC, 'screens/GridBuilderScreen.web.tsx'), 'utf8')

describe('grid list preview thumbs do not capture while the tab is covered', () => {
  it('GridCamThumb asks through shouldRequestSnapshot, not an unconditional true', () => {
    expect(grids).toContain('useScreenActive')
    expect(grids).toContain('shouldRequestSnapshot')
    expect(grids).not.toContain('useSnapshot(camera.id, true')
  })
})

describe('the web grid-builder palette does not capture while covered', () => {
  it('CameraThumb asks through shouldRequestSnapshot, not an unconditional true', () => {
    expect(builder).toContain('useScreenActive')
    expect(builder).toContain('shouldRequestSnapshot')
    expect(builder).not.toContain('useSnapshot(camera.id, true')
  })
})
