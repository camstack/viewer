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
    lastApp: null,
    launchPreference: 'last',
    hydrated: false,
    active: { appId: null },
    entryPath: null,
    framePath: null,
    launchSettled: false,
    drawerOpen: false,
  })
})

describe('the app switcher store', () => {
  it('the key is declared as a device setting', () => {
    expect(STORAGE_KEY_LEVELS.find((e) => e.key === APP_SWITCHER_STORAGE_KEY)?.level).toBe('device')
  })

  it('parses field by field and never throws', () => {
    expect(parseAppSwitcher(null)).toEqual({ lastApp: null, launchPreference: 'last' })
    expect(parseAppSwitcher('{nope')).toEqual({ lastApp: null, launchPreference: 'last' })
    expect(parseAppSwitcher(JSON.stringify({ lastApp: 'x', launchPreference: 7 }))).toEqual({
      lastApp: 'x',
      launchPreference: 'last',
    })
  })

  it('hydrates what an earlier run wrote — an app id is data, whatever it is', async () => {
    await AsyncStorage.setItem(APP_SWITCHER_STORAGE_KEY, JSON.stringify({ lastApp: 'x', launchPreference: 'y' }))
    await useAppStore.getState().hydrate()
    expect(useAppStore.getState()).toMatchObject({ lastApp: 'x', launchPreference: 'y', hydrated: true })
  })

  it('opening an app remembers it, closes the drawer and keeps the path to open on', async () => {
    useAppStore.getState().setDrawerOpen(true)
    useAppStore.getState().open({ appId: 'x' }, '/p')
    expect(useAppStore.getState()).toMatchObject({ active: { appId: 'x' }, lastApp: 'x', drawerOpen: false, entryPath: '/p' })
    expect(await stored()).toEqual({ lastApp: 'x', launchPreference: 'last' })
    useAppStore.getState().clearEntryPath()
    expect(useAppStore.getState().entryPath).toBeNull()
  })

  it('opening the shell itself remembers null', async () => {
    useAppStore.getState().open({ appId: 'x' })
    useAppStore.getState().open({ appId: null })
    expect(await stored()).toEqual({ lastApp: null, launchPreference: 'last' })
  })

  it('the launch resolution is spent once and does not touch the remembered app', () => {
    useAppStore.getState().settleLaunch('x')
    useAppStore.getState().settleLaunch(null)
    expect(useAppStore.getState()).toMatchObject({ active: { appId: 'x' }, launchSettled: true, lastApp: null })
  })

  it('a session reset leaves the embedded app but keeps this device’s habits', () => {
    useAppStore.getState().open({ appId: 'x' })
    useAppStore.getState().setLaunchPreference('x')
    useAppStore.getState().setFramePath('/a')
    useAppStore.getState().resetSession()
    expect(useAppStore.getState()).toMatchObject({
      active: { appId: null },
      framePath: null,
      launchSettled: false,
      lastApp: 'x',
      launchPreference: 'x',
    })
  })

  it('the top bar search opens the drawer with its search focused; any other open does not', () => {
    useAppStore.getState().openDrawerSearch()
    expect(useAppStore.getState().drawerOpen).toBe(true)
    expect(useAppStore.getState().drawerSearchFocus).toBe(true)
    useAppStore.getState().setDrawerOpen(false)
    useAppStore.getState().setDrawerOpen(true)
    expect(useAppStore.getState().drawerSearchFocus).toBe(false)
  })
})
