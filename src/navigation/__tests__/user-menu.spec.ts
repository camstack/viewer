import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { orderServers, showServerList, userInitial, userMenuEntries } from '../user-menu.js'
import { navItems, registeredTabs } from '../nav-items.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('the account menu', () => {
  it('lists the servers inline only when there are at least two', () => {
    expect(showServerList(0)).toBe(false)
    expect(showServerList(1)).toBe(false)
    expect(showServerList(2)).toBe(true)
  })

  it('offers Settings then Sign out, and never "Add server" or a Switch button', () => {
    expect(userMenuEntries()).toEqual(['settings', 'signOut'])
  })

  it('orders the current server first, then the most recently used', () => {
    const list = [{ id: 'a', lastUsedAt: 1 }, { id: 'b', lastUsedAt: 9 }, { id: 'c', lastUsedAt: 5 }]
    expect(orderServers(list, 'c').map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('the avatar shows one uppercase initial, and ? before the name is known', () => {
    expect(userInitial('alice')).toBe('A')
    expect(userInitial('')).toBe('?')
    expect(userInitial(null)).toBe('?')
  })

  it('the component gates the list on the rule and switches through the existing switchServer', () => {
    const src = read('navigation/UserMenuButton.tsx')
    expect(src).toContain('showServerList(servers.length)')
    expect(src).toContain('switchServer(id)')
  })
})

describe('Settings is a route, not a destination in the bar', () => {
  it('the bar lists Cameras, Grids, Library (Events) and Notifications — no Settings', () => {
    expect(navItems.map((i) => i.name)).not.toContain('settings')
    expect(navItems.map((i) => i.name)).toEqual(['cameras', 'grids', 'events', 'notifications'])
  })

  it('but the tab navigator still registers /settings so the route resolves', () => {
    expect(registeredTabs.map((i) => i.name)).toContain('settings')
    expect(read('navigation/TabsNavigator.tsx')).toContain('registeredTabs.map')
  })

  it('both navigation surfaces carry the account cluster', () => {
    expect(read('navigation/BottomNavBar.tsx')).toContain('<NavAccountCluster')
    expect(read('navigation/SideNavRail.tsx')).toContain('<NavAccountCluster')
  })
})
