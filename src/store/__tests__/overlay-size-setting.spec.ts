/**
 * The overlay size is a DEVICE setting: it lives in the device settings
 * store, defaults to medium, survives a restart, and is never an account
 * setting (`DEVICE_SETTINGS_LEVELS`).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEVICE_SETTINGS_DEFAULTS,
  DEVICE_SETTINGS_LEVELS,
  DEVICE_SETTINGS_STORAGE_KEY,
  parseDeviceSettings,
  useDeviceSettingsStore,
} from '../device-settings-store.js'
import { SETTINGS_LEVELS } from '../settings-levels.js'
import { resetDeviceLocalMigrationForTests } from '../device-local-migration.js'

beforeEach(async () => {
  await AsyncStorage.clear()
  resetDeviceLocalMigrationForTests()
  useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: false })
})

describe('overlay size setting', () => {
  it('defaults to medium', () => {
    expect(DEVICE_SETTINGS_DEFAULTS.overlaySize).toBe('medium')
    expect(parseDeviceSettings(null).overlaySize).toBe('medium')
    expect(parseDeviceSettings('{}').overlaySize).toBe('medium')
  })

  it('keeps each valid level and falls back to medium on junk, field by field', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(parseDeviceSettings(JSON.stringify({ debugMode: true, overlaySize: size }))).toMatchObject({
        debugMode: true,
        overlaySize: size,
      })
    }
    expect(parseDeviceSettings(JSON.stringify({ debugMode: true, overlaySize: 'huge' }))).toMatchObject({
      debugMode: true,
      overlaySize: 'medium',
    })
    expect(parseDeviceSettings(JSON.stringify({ overlaySize: 2 })).overlaySize).toBe('medium')
  })

  it('persists a change and restores it on the next launch', async () => {
    useDeviceSettingsStore.getState().setOverlaySize('large')
    expect(useDeviceSettingsStore.getState().settings.overlaySize).toBe('large')
    expect(await AsyncStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY)).toContain('"overlaySize":"large"')

    // A new process: memory reset, disk kept.
    useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: false })
    await useDeviceSettingsStore.getState().hydrate()
    expect(useDeviceSettingsStore.getState().settings.overlaySize).toBe('large')
  })

  it('changing it leaves the other device switches alone', () => {
    useDeviceSettingsStore.getState().setDebugMode(true)
    useDeviceSettingsStore.getState().setOverlaySize('small')
    expect(useDeviceSettingsStore.getState().settings).toMatchObject({
      debugMode: true,
      overlaySize: 'small',
    })
  })

  it('is a device field, and no part of the account settings document', () => {
    expect(DEVICE_SETTINGS_LEVELS.overlaySize).toBe('device')
    expect(Object.keys(SETTINGS_LEVELS)).not.toContain('overlaySize')
  })
})
