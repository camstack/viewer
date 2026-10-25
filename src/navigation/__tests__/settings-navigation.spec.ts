import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registeredTabs, settingsTab } from '../nav-items.js'
import { settingsRoute } from '../user-menu.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('reaching Settings from the account menu', () => {
  it('inside <Tabs> it switches the tab through a TabTrigger, off the tab tree through the router', () => {
    expect(settingsRoute(true)).toBe('tab-trigger')
    expect(settingsRoute(false)).toBe('router')
  })

  it('Settings is a registered tab, so the trigger has a route to switch to', () => {
    expect(registeredTabs).toContain(settingsTab)
    expect(settingsTab.name).toBe('settings')
  })

  it('the menu row is wrapped in the TabTrigger wrapper and never double-navigates', () => {
    const menu = read('navigation/UserMenuButton.tsx')
    expect(menu).toContain('<Wrap key={entry} item={settingsTab}>')
    expect(menu).toMatch(/settingsRoute\(wrapSettings !== undefined\) === 'router'/)
  })

  it('both navigations hand their TabTrigger wrapper to the account cluster', () => {
    expect(read('navigation/BottomNavBar.tsx')).toContain('wrapSettings={wrapperNavigates ? Wrapper : undefined}')
    expect(read('navigation/SideNavRail.tsx')).toContain('wrapSettings={wrapperNavigates ? Wrapper : undefined}')
    expect(read('navigation/NavAccountCluster.tsx')).toContain('wrapSettings={wrapSettings}')
  })
})
