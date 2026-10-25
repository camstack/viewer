/**
 * The one-time MOVE of device-local state out of the shared documents.
 *
 * Discriminating by construction: every moved value is a MARK no default could
 * produce (a `false` audio choice, the `low` tier, an isolated timeline kind,
 * debug mode ON), and every case asserts both halves of a move — the value is
 * in the new document AND the field is gone from the old one. A migration that
 * only copied, or only deleted, fails here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  resetDeviceLocalMigrationForTests,
  splitDeviceLocalDocs,
  type DeviceLocalDocs,
} from '../device-local-migration.js'
import { CAMERA_PREFS_STORAGE_KEY, useCameraPrefsStore } from '../camera-prefs-store.js'
import { useCameraLocalStore } from '../camera-local-store.js'
import { GRIDS_STORAGE_KEY, useGridStore } from '../grid-store.js'
import { useGridLocalStore } from '../grid-local-store.js'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import { migrateServerScopeOnce, resetServerScopeMigrationForTests } from '../server-scope-migration.js'
import { migrateTwoLevelsOnce, resetTwoLevelsMigrationForTests } from '../two-levels-migration.js'
import { SETTINGS_STORAGE_KEY, useSettingsStore, resetSettingsEntry } from '../settings-store.js'
import { DEVICE_SETTINGS_DEFAULTS, DEVICE_SETTINGS_STORAGE_KEY, useDeviceSettingsStore } from '../device-settings-store.js'

const LEGACY_PREFS = {
  byId: {
    '101': { localName: 'Front door', quality: 'low', audioOn: false, timelineKinds: ['audio'], timelineClasses: ['dog'] },
    '102': { audioOn: true },
  },
  order: [102, 101],
}
const LEGACY_GRIDS = [
  { id: 'g1', name: 'Esterno', cameraIds: [101, 102], audioOnIds: [102], options: { quality: 'low', layout: 2 } },
  { id: 'g2', name: 'Interno', cameraIds: [1] },
]
const LEGACY_SETTINGS = { grid: { motionHoldSec: 8 }, advanced: { debugMode: true } }

async function disk(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

async function seedLegacy(): Promise<void> {
  await AsyncStorage.setItem(CAMERA_PREFS_STORAGE_KEY, JSON.stringify(LEGACY_PREFS))
  await AsyncStorage.setItem(GRIDS_STORAGE_KEY, JSON.stringify(LEGACY_GRIDS))
  await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(LEGACY_SETTINGS))
}

/** What `ServerScopeBinder` does once the active hub is known: the hub-blind
 *  documents move onto it (after this file's move), then into the two levels,
 *  then the scope binds. */
async function bindHub(): Promise<void> {
  await migrateServerScopeOnce([], 'hub-a')
  await migrateTwoLevelsOnce(['hub-a'])
  useServerScopeStore.getState().bind('hub-a')
}

/** Cold launch: nothing in memory, the move not yet run this process. */
function coldLaunch(): void {
  resetDeviceLocalMigrationForTests()
  resetServerScopeMigrationForTests()
  resetTwoLevelsMigrationForTests()
  useServerScopeStore.getState().bind(null)
  useCameraPrefsStore.setState({ prefs: { byId: {}, order: [] }, hydrated: false })
  useCameraLocalStore.setState({ local: { byId: {} }, hydrated: false })
  useGridStore.setState({ grids: [], hydrated: false })
  useGridLocalStore.setState({ local: { byId: {} }, hydrated: false })
  useSettingsStore.setState({ settings: resetSettingsEntry(), hydrated: false, accountServerId: null })
  useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: false })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  coldLaunch()
})

describe('the move, through the stores', () => {
  it('per-camera tier and audio memory land in camera-local and leave camera-prefs; the timeline filters go', async () => {
    await seedLegacy()
    await bindHub()
    // ANY store's hydrate runs the move — here the SHARED one, first, which is
    // the order that would lose the values if the shared store read first.
    await useCameraPrefsStore.getState().hydrate()
    await useCameraLocalStore.getState().hydrate()

    // The timeline filters were moved here by the profile split, then dropped
    // by the two-level split: they are EPHEMERAL now.
    expect(useCameraLocalStore.getState().local.byId[101]).toEqual({ quality: 'low', audioOn: false })
    expect(useCameraLocalStore.getState().local.byId[102]).toEqual({ audioOn: true })
    expect(useCameraPrefsStore.getState().prefs.byId[101]).toEqual({ localName: 'Front door' })
    expect(useCameraPrefsStore.getState().prefs.byId[102]).toBeUndefined()
    expect(useCameraPrefsStore.getState().prefs.order).toEqual([102, 101])

    // On DISK, not just in memory: the old field is gone from the shared
    // document — which now lives in the hub's own copy.
    expect(await disk(CAMERA_PREFS_STORAGE_KEY)).toBeNull()
    expect(await disk(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-a'))).toEqual({
      byId: { '101': { localName: 'Front door' } },
      order: [102, 101],
    })
  })

  it('a wall\'s audio set and tier land in grid-local and leave the grid', async () => {
    await seedLegacy()
    await useGridStore.getState().hydrate()
    await useGridLocalStore.getState().hydrate()

    expect(useGridLocalStore.getState().local.byId['g1']).toEqual({ audioOnIds: [102], quality: 'low' })
    expect(useGridLocalStore.getState().local.byId['g2']).toBeUndefined()
    expect(await disk(GRIDS_STORAGE_KEY)).toEqual([
      { id: 'g1', name: 'Esterno', cameraIds: [101, 102], options: { layout: 2 } },
      { id: 'g2', name: 'Interno', cameraIds: [1] },
    ])
  })

  it('debug mode lands in device-settings and `advanced` leaves the settings document', async () => {
    await seedLegacy()
    await bindHub()
    await useSettingsStore.getState().hydrate()
    await useDeviceSettingsStore.getState().hydrate()

    expect(useDeviceSettingsStore.getState().settings.debugMode).toBe(true)
    expect(useSettingsStore.getState().settings.grid.motionHoldSec).toBe(8)
    const settingsOnDisk = await disk(SETTINGS_STORAGE_KEY)
    expect(settingsOnDisk).not.toHaveProperty('advanced')
    expect(await disk(DEVICE_SETTINGS_STORAGE_KEY)).toEqual({ debugMode: true })
  })

  it('runs ONCE: a second launch writes nothing and a later local choice survives it', async () => {
    await seedLegacy()
    await bindHub()
    await useCameraLocalStore.getState().hydrate()
    useCameraLocalStore.getState().setCameraAudioOn(101, true)
    await Promise.resolve()

    coldLaunch()
    await bindHub()
    await useCameraLocalStore.getState().hydrate()
    expect(useCameraLocalStore.getState().local.byId[101]?.audioOn).toBe(true)
  })
})

describe('splitDeviceLocalDocs (pure)', () => {
  const empty: DeviceLocalDocs = {
    cameraPrefs: null,
    cameraLocal: null,
    grids: null,
    gridLocal: null,
    settings: null,
    deviceSettings: null,
  }

  it('writes nothing when there is nothing to move', () => {
    expect(splitDeviceLocalDocs(empty)).toEqual({})
    expect(
      splitDeviceLocalDocs({
        ...empty,
        cameraPrefs: JSON.stringify({ byId: { '1': { localName: 'A' } }, order: [] }),
        grids: JSON.stringify([{ id: 'g', name: 'G', cameraIds: [] }]),
        settings: JSON.stringify({ grid: { motionHoldSec: 3 } }),
      }),
    ).toEqual({})
  })

  it('an answer already in the device-local document wins over a leftover', () => {
    const writes = splitDeviceLocalDocs({
      ...empty,
      cameraPrefs: JSON.stringify({ byId: { '1': { audioOn: false, quality: 'low' } }, order: [] }),
      cameraLocal: JSON.stringify({ byId: { '1': { audioOn: true } } }),
      settings: JSON.stringify({ advanced: { debugMode: true } }),
      deviceSettings: JSON.stringify({ debugMode: false }),
    })
    expect(JSON.parse(writes.cameraLocal ?? 'null')).toEqual({ byId: { '1': { audioOn: true, quality: 'low' } } })
    expect(JSON.parse(writes.settings ?? 'null')).toEqual({})
    expect(writes.deviceSettings).toBeUndefined()
  })

  it('tolerates corrupt documents without throwing', () => {
    expect(() =>
      splitDeviceLocalDocs({ ...empty, cameraPrefs: 'nope', grids: '{', settings: '[]' }),
    ).not.toThrow()
  })
})
