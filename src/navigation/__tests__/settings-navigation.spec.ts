import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registeredTabs, settingsNavigation, settingsTab } from '../nav-items.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('reaching Settings from the app drawer', () => {
  it('Settings is a registered tab, so the route the drawer pops to exists', () => {
    expect(registeredTabs).toContain(settingsTab)
    expect(settingsTab.name).toBe('settings')
  })

  it('from a tab route the drawer jumps tabs with replace: dismissTo is a POP_TO the tab router ignores', () => {
    for (const tab of registeredTabs.filter((t) => t !== settingsTab)) {
      expect(settingsNavigation(tab.segment)).toBe('replace')
    }
  })

  it('from a route stacked over the tabs it pops back to them', () => {
    expect(settingsNavigation('/camera/102')).toBe('dismiss')
    expect(settingsNavigation('/settings/cameras')).toBe('dismiss')
  })

  it('on Settings itself it does nothing', () => {
    expect(settingsNavigation('/settings')).toBe('noop')
  })

  it('the drawer sits outside <Tabs>: it asks settingsNavigation, never a TabTrigger or a blind dismissTo', () => {
    const drawer = read('apps/AppDrawer.tsx')
    expect(drawer).toContain('settingsNavigation(pathname)')
    expect(drawer).not.toContain('TabTrigger')
    expect(drawer).not.toContain("router.dismissTo('/settings')")
  })

  it('the avatar opens the drawer; the popover and its TabTrigger plumbing are gone', () => {
    const button = read('navigation/UserMenuButton.tsx')
    expect(button).toContain('setDrawerOpen(true)')
    expect(button).not.toContain('AnchoredMenu')
    expect(read('navigation/NavAccountCluster.tsx')).not.toContain('wrapSettings')
  })
})
