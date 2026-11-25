import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8')

describe('the top bar wiring (#691)', () => {
  const tabs = read('navigation/TabsNavigator.tsx')

  it('the tab navigator mounts the home bar only for a home route and tells the screens the inset is spent', () => {
    expect(tabs).toMatch(/barKindForPath\(pathname\) === 'home'/)
    expect(tabs).toMatch(/<HomeBar/)
    expect(tabs).toMatch(/TopInsetSpentContext\.Provider value=\{showHomeBar\}/)
  })

  it('the rail and the bottom capsule give up the ☰ and the account only while the bar carries them', () => {
    expect(tabs.match(/chrome=\{showHomeBar \? 'nav' : 'full'\}/g)).toHaveLength(2)
    expect(read('navigation/SideNavRail.tsx')).toMatch(/chrome = 'full'/)
    expect(read('navigation/BottomNavBar.tsx')).toMatch(/chrome = 'full'/)
  })

  it('a header below the bar reads the shared top inset instead of spending its own', () => {
    for (const rel of ['components/ScreenHeader.tsx', 'components/ui/ScopeBar.tsx']) {
      const src = read(rel)
      expect(src, rel).toMatch(/useScreenTopInset\(\)/)
      expect(src, rel).not.toMatch(/insets\.top/)
    }
  })

  it('a tab page draws no header of its own under the home bar (#707)', () => {
    for (const rel of ['screens/CamerasScreen.tsx', 'screens/GridsScreen.tsx']) {
      expect(read(rel), rel).not.toMatch(/<ScreenHeader/)
    }
  })

  it('the inner bar is the screen header with a ☰, and only where the route map says inner', () => {
    const header = read('components/ScreenHeader.tsx')
    expect(header).toMatch(/barKindForPath\(pathname\) === 'inner'/)
    expect(header).toMatch(/<HeaderMenuButton \/>/)
  })

  it('the camera screen stays bar-less: no home bar, no header menu in it', () => {
    const camera = read('screens/CameraDetailScreen.tsx')
    expect(camera).not.toMatch(/HomeBar|HeaderMenuButton/)
  })

  it('the wide bar search opens the drawer search, not a second search', () => {
    const bar = read('navigation/HomeBar.tsx')
    expect(bar).toMatch(/openDrawerSearch/)
    expect(read('apps/AppDrawer.tsx')).toMatch(/autoFocus: searchFocus/)
  })
})
