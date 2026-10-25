/**
 * The one-time move into the device and account levels.
 *
 * The fixture is MARKED: every value says where it must end up
 * (`MARK-ACCOUNT-…`, `MARK-DEVICE-…`, `MARK-GONE-…`), so a value that lands at
 * the wrong level is visible in the assertion, not just a count that happens
 * to match. Two hubs are signed in; both must get the account copy.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  migrateTwoLevelsOnce,
  planTwoLevelsMigration,
  resetTwoLevelsMigrationForTests,
  RETIRED_STORAGE_KEYS,
  twoLevelsMigrationKeys,
} from '../two-levels-migration.js'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import {
  SETTINGS_ACCOUNT_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  resetSettingsEntry,
  useSettingsStore,
} from '../settings-store.js'
import { LANGUAGE_STORAGE_KEY, useLanguageStore } from '../language-store.js'
import { REEL_FILTER_STORAGE_KEY } from '../reel-filter-store.js'
import { REEL_HIGHLIGHT_STORAGE_KEY } from '../reel-highlight-store.js'
import { DEVICE_PICKER_GROUP_KEY } from '../device-picker-group-store.js'
import { EVENTS_FILTER_STORAGE_KEY, useEventsFilterStore, DEFAULTS as EVENTS_DEFAULTS } from '../events-filter-store.js'
import { CAMERA_LOCAL_STORAGE_KEY } from '../camera-local-store.js'
import { GRIDS_STORAGE_KEY } from '../grid-store.js'
import { GRID_LOCAL_STORAGE_KEY } from '../grid-local-store.js'
import { DEVICE_SETTINGS_STORAGE_KEY } from '../device-settings-store.js'
import { storageLevelOf } from '../storage-levels.js'

const HUBS = ['hub-a', 'hub-b'] as const

const LEGACY_SETTINGS = {
  grid: { motionHoldSec: 8 }, // ACCOUNT
  stream: { audioOnOpen: 'on', toolbarDensity: 'large', navBarOnStream: true }, // mixed
  highlight: { motionColor: '#ABCDEF', thickness: 5 }, // ACCOUNT
  clusters: { gapPercent: 22, cardWidthFraction: 0.72, showClass: false }, // mixed
  events: { reelThumbSize: 'large', reelThumbSizeRev: 2, gridDensity: 'compact', tileLabelMode: 'label', reelChromeRev: 1 },
  cameraList: { occupancy: 'top-left' }, // ACCOUNT
  deviceInfo: 'bottom-right', // DEVICE
  haptics: { uiFeedback: false }, // DEVICE
}

function legacyDocs(): Record<string, string | null> {
  return {
    [SETTINGS_STORAGE_KEY]: JSON.stringify(LEGACY_SETTINGS),
    [LANGUAGE_STORAGE_KEY]: 'it',
    [REEL_FILTER_STORAGE_KEY]: JSON.stringify({ classes: ['MARK-ACCOUNT-person'] }),
    [REEL_HIGHLIGHT_STORAGE_KEY]: JSON.stringify({ motion: false, audio: 'level' }),
    [DEVICE_PICKER_GROUP_KEY]: 'location',
    [scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, 'hub-a')]: JSON.stringify({
      showStationary: true,
      cameraIds: [101],
      label: 'MARK-GONE-investigation',
      filterDebug: true,
      v: 2,
    }),
    [scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, 'hub-a')]: JSON.stringify({
      byId: {
        '101': { quality: 'low', audioOn: true, timelineKinds: ['audio'], timelineClasses: ['MARK-GONE-dog'] },
        '616': { timelineClasses: ['MARK-GONE-cat'] },
      },
    }),
    [GRIDS_STORAGE_KEY]: JSON.stringify([
      { id: 'g1', name: 'MARK-ACCOUNT-wall', serverId: 'hub-a', cameraIds: [101], options: { layout: 3, showName: true } },
      { id: 'g2', name: 'MARK-ACCOUNT-auto', serverId: 'hub-a', cameraIds: [616], options: { layout: 'auto' } },
      { id: 'g3', name: 'MARK-ACCOUNT-plain', serverId: 'hub-b', cameraIds: [900] },
    ]),
    [GRID_LOCAL_STORAGE_KEY]: JSON.stringify({ byId: { g1: { quality: 'high' } } }),
    [DEVICE_SETTINGS_STORAGE_KEY]: JSON.stringify({ debugMode: true, settingsSegment: 'advanced', overlaySize: 'large' }),
    [RETIRED_STORAGE_KEYS.settingsTemplateLink]: JSON.stringify({ snapshotId: 's1', role: 'follower' }),
    [RETIRED_STORAGE_KEYS.rulesStripTab]: 'sensor',
  }
}

function parsed(raw: string | undefined): unknown {
  return raw === undefined ? undefined : JSON.parse(raw)
}

describe('planTwoLevelsMigration (pure)', () => {
  const plan = planTwoLevelsMigration(legacyDocs(), HUBS)

  it('the settings document keeps only its DEVICE half', () => {
    const device = parsed(plan.set[SETTINGS_STORAGE_KEY])
    expect(device).toEqual({
      stream: { pinchExpandsHeight: false, navBarOnStream: true, toolbarDensity: 'large', landscapeTimeline: 'off' },
      clusters: { cardWidthFraction: 0.72 },
      events: { reelThumbSize: 'large', reelThumbSizeRev: 2, gridDensity: 'compact' },
      deviceInfo: 'bottom-right',
      haptics: { enabled: false, motion: true, detection: true, person: true, uiFeedback: false },
    })
  })

  it('EVERY signed-in hub gets the same ACCOUNT half', () => {
    for (const hub of HUBS) {
      const account = parsed(plan.set[scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, hub)])
      expect(account).toMatchObject({
        grid: { motionHoldSec: 8 },
        stream: { audioOnOpen: 'on' },
        highlight: { motionColor: '#ABCDEF', thickness: 5 },
        clusters: { gapPercent: 22, showClass: false },
        events: { tileLabelMode: 'label' },
        cameraList: { occupancy: 'top-left' },
      })
      expect(account).not.toHaveProperty('deviceInfo')
      expect(account).not.toHaveProperty('haptics')
    }
  })

  it('the device-wide account values become one copy per hub, and the old keys go', () => {
    for (const hub of HUBS) {
      expect(plan.set[scopedStorageKey(LANGUAGE_STORAGE_KEY, hub)]).toBe('it')
      expect(parsed(plan.set[scopedStorageKey(REEL_FILTER_STORAGE_KEY, hub)])).toEqual({ classes: ['MARK-ACCOUNT-person'] })
      expect(plan.set[scopedStorageKey(DEVICE_PICKER_GROUP_KEY, hub)]).toBe('location')
      expect(plan.set[scopedStorageKey(REEL_HIGHLIGHT_STORAGE_KEY, hub)]).toBeDefined()
    }
    expect(plan.remove).toEqual(
      expect.arrayContaining([LANGUAGE_STORAGE_KEY, REEL_FILTER_STORAGE_KEY, REEL_HIGHLIGHT_STORAGE_KEY, DEVICE_PICKER_GROUP_KEY]),
    )
  })

  it('the events filter keeps the page preferences; the investigation is not persisted', () => {
    expect(parsed(plan.set[scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, 'hub-a')])).toEqual({
      showStationary: true,
      v: 2,
    })
  })

  it('camera-local keeps tier and audio memory; the timeline filters go (and an entry left empty)', () => {
    expect(parsed(plan.set[scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, 'hub-a')])).toEqual({
      byId: { '101': { quality: 'low', audioOn: true } },
    })
  })

  it('a grid’s layout moves to grid-local; an `auto` one is simply dropped', () => {
    expect(parsed(plan.set[GRIDS_STORAGE_KEY])).toEqual([
      { id: 'g1', name: 'MARK-ACCOUNT-wall', serverId: 'hub-a', cameraIds: [101], options: { showName: true } },
      { id: 'g2', name: 'MARK-ACCOUNT-auto', serverId: 'hub-a', cameraIds: [616], options: {} },
      { id: 'g3', name: 'MARK-ACCOUNT-plain', serverId: 'hub-b', cameraIds: [900] },
    ])
    expect(parsed(plan.set[GRID_LOCAL_STORAGE_KEY])).toEqual({ byId: { g1: { quality: 'high', layout: 3 } } })
  })

  it('the settings segment, the template link and the rules strip tab are gone', () => {
    expect(parsed(plan.set[DEVICE_SETTINGS_STORAGE_KEY])).toEqual({ debugMode: true, overlaySize: 'large' })
    expect(plan.remove).toEqual(
      expect.arrayContaining([RETIRED_STORAGE_KEYS.settingsTemplateLink, RETIRED_STORAGE_KEYS.rulesStripTab]),
    )
  })

  it('a per-hub copy that already exists WINS over the device-wide value', () => {
    const docs = {
      ...legacyDocs(),
      [scopedStorageKey(LANGUAGE_STORAGE_KEY, 'hub-b')]: 'en',
      [scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, 'hub-b')]: JSON.stringify({ grid: { motionHoldSec: 2 } }),
    }
    const again = planTwoLevelsMigration(docs, HUBS)
    expect(again.set[scopedStorageKey(LANGUAGE_STORAGE_KEY, 'hub-b')]).toBeUndefined()
    expect(again.set[scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, 'hub-b')]).toBeUndefined()
    expect(again.set[scopedStorageKey(LANGUAGE_STORAGE_KEY, 'hub-a')]).toBe('it')
  })

  it('is idempotent: the migrated state plans nothing', () => {
    const after: Record<string, string | null> = { ...legacyDocs() }
    for (const [k, v] of Object.entries(plan.set)) after[k] = v
    for (const k of plan.remove) after[k] = null
    expect(planTwoLevelsMigration(after, HUBS)).toEqual({ set: {}, remove: [] })
  })

  it('every key the plan writes has a declared level, and none is retired', () => {
    for (const key of Object.keys(plan.set)) {
      const level = storageLevelOf(key)
      expect(level, key).toBeDefined()
      expect(level?.level, key).not.toBe('retired')
    }
    expect(twoLevelsMigrationKeys(HUBS).every((k) => storageLevelOf(k) !== undefined)).toBe(true)
  })
})

describe('through the stores', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    resetTwoLevelsMigrationForTests()
    useServerScopeStore.getState().bind(null)
    useSettingsStore.setState({ settings: resetSettingsEntry(), hydrated: false, accountServerId: null })
    useLanguageStore.setState({ preference: 'system', hydrated: false, serverId: null })
    useEventsFilterStore.setState({ filter: EVENTS_DEFAULTS, hydrated: false, serverId: null })
  })

  it('after the move, each store reads its value from its new home', async () => {
    for (const [k, v] of Object.entries(legacyDocs())) if (v !== null) await AsyncStorage.setItem(k, v)
    await migrateTwoLevelsOnce([...HUBS])
    useServerScopeStore.getState().bind('hub-a')
    await useSettingsStore.getState().hydrate()
    await useLanguageStore.getState().hydrate()
    await useEventsFilterStore.getState().hydrate()

    const s = useSettingsStore.getState().settings
    expect(s.grid.motionHoldSec).toBe(8)
    expect(s.highlight.motionColor).toBe('#ABCDEF')
    expect(s.stream.toolbarDensity).toBe('large')
    expect(s.deviceInfo).toBe('bottom-right')
    expect(s.haptics.uiFeedback).toBe(false)
    expect(useLanguageStore.getState().preference).toBe('it')
    expect(useEventsFilterStore.getState().filter).toMatchObject({ showStationary: true, cameraIds: [], label: '' })

    // Every key left on disk has exactly one declared level.
    for (const key of await AsyncStorage.getAllKeys()) expect(storageLevelOf(key), key).toBeDefined()
  })

  it('an edit writes each half to its own home — never one into the other', async () => {
    await migrateTwoLevelsOnce([...HUBS])
    useServerScopeStore.getState().bind('hub-a')
    await useSettingsStore.getState().hydrate()
    useSettingsStore.getState().setHighlightAppearance('motionColor', '#123456')
    useSettingsStore.getState().setStreamDefault('toolbarDensity', 'small')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    const device = parsed((await AsyncStorage.getItem(SETTINGS_STORAGE_KEY)) ?? undefined)
    const account = parsed((await AsyncStorage.getItem(scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, 'hub-a'))) ?? undefined)
    expect(device).toMatchObject({ stream: { toolbarDensity: 'small' } })
    expect(device).not.toHaveProperty('highlight')
    expect(account).toMatchObject({ highlight: { motionColor: '#123456' } })
    expect(account).not.toHaveProperty('stream.toolbarDensity')
    // hub B's account copy is untouched by an edit on hub A.
    expect(await AsyncStorage.getItem(scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, 'hub-b'))).toBeNull()
  })
})
