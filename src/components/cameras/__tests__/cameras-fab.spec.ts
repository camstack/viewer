import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FAB = join(process.cwd(), 'src', 'components', 'cameras', 'CamerasFab.tsx')
const SCREEN = join(process.cwd(), 'src', 'screens', 'CamerasScreen.tsx')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('CamerasFab', () => {
  it('lives in its own module and opens as one vertical glass menu', () => {
    const fab = read(FAB)
    expect(read(SCREEN)).toContain("from '../components/cameras/CamerasFab.js'")
    expect(fab).toContain('<GlassSurface')
    expect(fab).toContain('radius={RADIUS.xl}')
    expect(fab).toContain('iconSlot')
    expect(fab).toContain("justifyContent: 'flex-end'")
    // Label then icon slot — icons sit on the RIGHT of each row.
    expect(fab.indexOf('styles.menuLabel')).toBeLessThan(fab.indexOf('styles.iconSlot'))
    expect(fab).not.toContain('fabActionLabel')
    expect(fab).not.toContain('<GlassGroup')
  })

  it('default reel suffix uses DefaultTag not UseDefault', () => {
    const fab = read(FAB)
    expect(fab).toContain("t('v2.cameras.reelFilterDefaultTag'")
    expect(fab).toContain("t('v2.cameras.reelFilterCountTag'")
    expect(fab).not.toContain('reelFilterUseDefault')
  })

  it('menu row is only the active set, not "Recent events · …"', () => {
    const fab = read(FAB)
    expect(fab).toContain('label: reelSuffix')
    expect(fab).not.toMatch(/label:\s*`\$\{t\('v2\.cameras\.reelFilter'/)
  })
})
