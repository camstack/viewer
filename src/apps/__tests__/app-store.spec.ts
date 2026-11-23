import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { APP_SWITCHER_STORAGE_KEY, parseAppSwitcher, useAppStore } from '../app-store.js'
import { STORAGE_KEY_LEVELS } from '../../store/storage-levels.js'

async function stored(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(APP_SWITCHER_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(async () => {
  await AsyncStorage.clear()
  useAppStore.setState({
    lastApp: 'viewer',
    launchPreference: 'last',
    hydrated: false,
    active: { kind: 'viewer' },
    launchSettled: false,
    drawerOpen: false,
  })
})

describe('the app switcher store', () => {
  it('the key is declared as a device setting', () => {
    expect(STORAGE_KEY_LEVELS.find((e) => e.key === APP_SWITCHER_STORAGE_KEY)?.level).toBe('device')
  })

  it('parses field by field and never throws', () => {
    expect(parseAppSwitcher(null)).toEqual({ lastApp: 'viewer', launchPreference: 'last' })
    expect(parseAppSwitcher('{nope')).toEqual({ lastApp: 'viewer', launchPreference: 'last' })
    expect(parseAppSwitcher(JSON.stringify({ lastApp: 'admin', launchPreference: 'bogus' }))).toEqual({
      lastApp: 'admin',
      launchPreference: 'last',
    })
  })

  it('hydrates what an earlier run wrote', async () => {
    await AsyncStorage.setItem(APP_SWITCHER_STORAGE_KEY, JSON.stringify({ lastApp: 'admin', launchPreference: 'viewer' }))
    await useAppStore.getState().hydrate()
    expect(useAppStore.getState()).toMatchObject({ lastApp: 'admin', launchPreference: 'viewer', hydrated: true })
  })

  it('opening an app remembers it and closes the drawer', async () => {
    useAppStore.getState().setDrawerOpen(true)
    useAppStore.getState().open({ kind: 'admin' })
    expect(useAppStore.getState()).toMatchObject({ active: { kind: 'admin' }, lastApp: 'admin', drawerOpen: false })
    expect(await stored()).toEqual({ lastApp: 'admin', launchPreference: 'last' })
  })

  it('a node UI is shown but never remembered', async () => {
    useAppStore.getState().open({ kind: 'admin' })
    useAppStore.getState().open({ kind: 'node', nodeId: 'n1', nodeName: 'Agent' })
    expect(useAppStore.getState().active).toEqual({ kind: 'node', nodeId: 'n1', nodeName: 'Agent' })
    expect(useAppStore.getState().lastApp).toBe('admin')
    expect(await stored()).toEqual({ lastApp: 'admin', launchPreference: 'last' })
  })

  it('the launch choice is stored beside the last app', async () => {
    useAppStore.getState().open({ kind: 'admin' })
    useAppStore.getState().setLaunchPreference('viewer')
    expect(await stored()).toEqual({ lastApp: 'admin', launchPreference: 'viewer' })
  })

  it('the launch resolution is spent once and does not touch the remembered app', () => {
    useAppStore.getState().settleLaunch('admin')
    useAppStore.getState().settleLaunch('viewer')
    expect(useAppStore.getState()).toMatchObject({ active: { kind: 'admin' }, launchSettled: true, lastApp: 'viewer' })
  })

  it('sign-out / server switch leaves Admin and node UIs, keeps the device choices, re-arms the launch', () => {
    useAppStore.getState().setLaunchPreference('admin')
    useAppStore.getState().open({ kind: 'admin' })
    useAppStore.getState().settleLaunch('admin')
    useAppStore.getState().setDrawerOpen(true)
    useAppStore.getState().resetSession()
    expect(useAppStore.getState()).toMatchObject({
      active: { kind: 'viewer' },
      launchSettled: false,
      drawerOpen: false,
      lastApp: 'admin',
      launchPreference: 'admin',
    })
  })
})
