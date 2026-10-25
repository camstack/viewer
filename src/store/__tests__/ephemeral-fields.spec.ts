/**
 * The EPHEMERAL fields (operator decision 2026-10-21) live in memory only:
 * the events label text, a camera's timeline filters, the Settings segment.
 * (The events filter bar itself is a DEVICE setting since 2026-10-23.)
 * Each store is driven through its real setters and the DISK is read back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import {
  DEFAULTS as EVENTS_DEFAULTS,
  EVENTS_FILTER_DEVICE_STORAGE_KEY,
  EVENTS_FILTER_STORAGE_KEY,
  useEventsFilterStore,
} from '../events-filter-store.js'
import { CAMERA_LOCAL_STORAGE_KEY, useCameraLocalStore } from '../camera-local-store.js'
import {
  DEVICE_SETTINGS_DEFAULTS,
  DEVICE_SETTINGS_STORAGE_KEY,
  useDeviceSettingsStore,
} from '../device-settings-store.js'

async function disk(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(async () => {
  await AsyncStorage.clear()
  useServerScopeStore.getState().bind('hub-a')
})

describe('memory-only fields', () => {
  it('the events page writes parked rows to the account, the filter bar to the device, never the label', async () => {
    useEventsFilterStore.setState({ filter: EVENTS_DEFAULTS, hydrated: true, serverId: 'hub-a' })
    const s = useEventsFilterStore.getState()
    s.toggleCamera(101)
    s.setLabel('MARK-memory-only')
    s.setFilterDebug(true)
    s.setShowStationary(true)
    await Promise.resolve()
    expect(await disk(scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, 'hub-a'))).toEqual({
      showStationary: true,
      v: 2,
    })
    const device = await disk(scopedStorageKey(EVENTS_FILTER_DEVICE_STORAGE_KEY, 'hub-a'))
    expect(device).toMatchObject({ cameraIds: [101], filterDebug: true, v: 2 })
    expect(JSON.stringify(device)).not.toContain('MARK-memory-only')
    expect(useEventsFilterStore.getState().filter).toMatchObject({ cameraIds: [101], label: 'MARK-memory-only' })
  })

  it('a camera’s timeline filter stays in memory; its tier is written', async () => {
    useCameraLocalStore.setState({ local: { byId: {} }, hydrated: true, serverId: 'hub-a' })
    const s = useCameraLocalStore.getState()
    s.setCameraQuality(101, 'low')
    s.setCameraTimelineClasses(101, ['MARK-memory-dog'])
    await Promise.resolve()
    expect(await disk(scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, 'hub-a'))).toEqual({ byId: { '101': { quality: 'low' } } })
    expect(useCameraLocalStore.getState().local.byId[101]?.timelineClasses).toEqual(['MARK-memory-dog'])
  })

  it('the Settings segment is never written', async () => {
    useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: true })
    useDeviceSettingsStore.getState().setSettingsSegment('advanced')
    useDeviceSettingsStore.getState().setDebugMode(true)
    await Promise.resolve()
    expect(await disk(DEVICE_SETTINGS_STORAGE_KEY)).toEqual({ debugMode: true, overlaySize: 'medium' })
    expect(useDeviceSettingsStore.getState().settings.settingsSegment).toBe('advanced')
  })
})
