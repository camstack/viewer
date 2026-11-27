import { beforeEach, describe, expect, it } from 'vitest'

import { appsQueryKey } from '../../data/use-apps.js'
import { useAppStore } from '../app-store.js'
import { applyServerChange, serverTransitionOf } from '../server-transition.js'

beforeEach(() => {
  useAppStore.setState({
    lastApp: null,
    launchPreference: 'last',
    hydrated: true,
    active: { appId: null },
    entryPath: null,
    framePath: null,
    launchSettled: false,
    serverId: null,
    carried: null,
    lastAppByServer: {},
    drawerOpen: false,
  })
})

describe('what a change of server does to the app store', () => {
  it('classifies the transitions', () => {
    expect(serverTransitionOf('a', 'a')).toBe('none')
    expect(serverTransitionOf(null, 'a')).toBe('reset')
    expect(serverTransitionOf('a', 'b')).toBe('switch')
    expect(serverTransitionOf('a', null)).toBe('reset')
  })

  it('first connect: no carried app, the launch preference decides', () => {
    applyServerChange(null, 'a')
    const s = useAppStore.getState()
    expect(s.serverId).toBe('a')
    expect(s.carried).toBeNull()
    expect(s.launchSettled).toBe(false)
  })

  it('A to B carries the app on screen', () => {
    useAppStore.setState({ serverId: 'a', launchSettled: true, active: { appId: 'x' } })
    applyServerChange('a', 'b')
    const s = useAppStore.getState()
    expect(s.carried).toEqual({ appId: 'x' })
    expect(s.serverId).toBe('b')
    expect(s.launchSettled).toBe(false)
    expect(s.lastAppByServer).toEqual({ a: 'x' })
  })

  it('A to nothing (a removed server) ends the session: the removed hub app does not stay on screen', () => {
    useAppStore.setState({ serverId: 'a', launchSettled: true, active: { appId: 'x' } })
    applyServerChange('a', null)
    const s = useAppStore.getState()
    expect(s.active).toEqual({ appId: null })
    expect(s.launchSettled).toBe(false)
    expect(s.serverId).toBeNull()
    applyServerChange(null, 'b')
    expect(useAppStore.getState().carried).toBeNull()
    expect(useAppStore.getState().serverId).toBe('b')
  })

  it("the catalog a switch is judged against is the new server's: the list is keyed per server", () => {
    expect(appsQueryKey('https://a', 'tok')).not.toEqual(appsQueryKey('https://b', 'tok'))
  })
})
