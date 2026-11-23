import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registeredTabs, settingsTab } from '../nav-items.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('reaching Settings from the app drawer', () => {
  it('Settings is a registered tab, so the route the drawer pops to exists', () => {
    expect(registeredTabs).toContain(settingsTab)
    expect(settingsTab.name).toBe('settings')
  })

  it('the drawer sits outside <Tabs>, so it goes through the router, not a TabTrigger', () => {
    const drawer = read('apps/AppDrawer.tsx')
    expect(drawer).toContain("router.dismissTo('/settings')")
    expect(drawer).not.toContain('TabTrigger')
  })

  it('the avatar opens the drawer; the popover and its TabTrigger plumbing are gone', () => {
    const button = read('navigation/UserMenuButton.tsx')
    expect(button).toContain('setDrawerOpen(true)')
    expect(button).not.toContain('AnchoredMenu')
    expect(read('navigation/NavAccountCluster.tsx')).not.toContain('wrapSettings')
  })
})
