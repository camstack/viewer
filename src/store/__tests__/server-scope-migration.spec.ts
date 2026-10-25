/**
 * Grids and per-camera prefs belong to ONE hub.
 *
 * The fixture is MARKED: every value names the hub it must end up on
 * (`MARK-A-…`, `MARK-B-…`), so a value that lands on the wrong hub is visible
 * in the assertion, not just a count that happens to match. Camera 101 exists
 * on BOTH hubs — the collision the bug was about.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  pickOwnerServer,
  planServerScopeMigration,
  migrateServerScopeOnce,
  resetServerScopeMigrationForTests,
  type ServerCameraCandidate,
} from '../server-scope-migration.js'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import { resetDeviceLocalMigrationForTests } from '../device-local-migration.js'
import { CAMERA_PREFS_STORAGE_KEY, useCameraPrefsStore } from '../camera-prefs-store.js'
import { CAMERA_LOCAL_STORAGE_KEY, useCameraLocalStore } from '../camera-local-store.js'
import {
  GRIDS_STORAGE_KEY,
  findServerGrid,
  gridsForServer,
  parseGrids,
  replaceServerGridsEntry,
  type Grid,
} from '../grid-store.js'
import { CAMERA_FAVOURITES_STORAGE_KEY, useCameraFavouritesStore } from '../camera-favourites-store.js'
import { EVENTS_FILTER_STORAGE_KEY } from '../events-filter-store.js'
import { LAST_CAMERA_STORAGE_KEY } from '../../navigation/last-camera.js'

const HUB_A: ServerCameraCandidate = { serverId: 'hub-a', cameraIds: new Set([101, 616, 102]) }
const HUB_B: ServerCameraCandidate = { serverId: 'hub-b', cameraIds: new Set([101, 900, 901]) }

const LEGACY_GRIDS = [
  { id: 'gA', name: 'MARK-A-wall', cameraIds: [101, 616, 102] },
  { id: 'gB', name: 'MARK-B-wall', cameraIds: [900, 901, 101] },
  { id: 'gNone', name: 'MARK-A-fallback', cameraIds: [12345] },
  { id: 'gDone', name: 'MARK-B-already', serverId: 'hub-b', cameraIds: [616] },
]
const LEGACY_PREFS = {
  byId: {
    '101': { localName: 'MARK-A-shared-id' },
    '616': { localName: 'MARK-A-only' },
    '900': { localName: 'MARK-B-only' },
  },
  order: [900, 616, 101],
}
const LEGACY_LOCAL = { byId: { '901': { quality: 'low' }, '102': { quality: 'high' } } }

function docs(scoped: Record<string, string | null> = {}) {
  return {
    grids: JSON.stringify(LEGACY_GRIDS),
    cameraPrefs: JSON.stringify(LEGACY_PREFS),
    cameraLocal: JSON.stringify(LEGACY_LOCAL),
    scoped,
  }
}

function parsed(raw: string | undefined): unknown {
  return raw === undefined ? undefined : JSON.parse(raw)
}

describe('pickOwnerServer', () => {
  it('goes to the hub whose camera list holds the most ids', () => {
    expect(pickOwnerServer([900, 901, 101], [HUB_A, HUB_B], 'hub-a')).toBe('hub-b')
  })
  it('a tie goes to the active hub, no overlap at all too', () => {
    expect(pickOwnerServer([101], [HUB_A, HUB_B], 'hub-b')).toBe('hub-b')
    expect(pickOwnerServer([12345], [HUB_A, HUB_B], 'hub-a')).toBe('hub-a')
    expect(pickOwnerServer([616], [], 'hub-b')).toBe('hub-b')
  })
})

describe('planServerScopeMigration (pure)', () => {
  const plan = planServerScopeMigration(docs(), [HUB_A, HUB_B], 'hub-a')

  it('stamps every grid with its hub and leaves a stamped one alone', () => {
    const grids = parseGrids(plan.set[GRIDS_STORAGE_KEY] ?? null)
    const byName = Object.fromEntries(grids.map((g) => [g.name, g.serverId]))
    expect(byName).toEqual({
      'MARK-A-wall': 'hub-a',
      'MARK-B-wall': 'hub-b',
      'MARK-A-fallback': 'hub-a',
      'MARK-B-already': 'hub-b',
    })
  })

  it('splits camera prefs: an id on ONE hub goes there, a shared id to the document owner', () => {
    expect(parsed(plan.set[scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-a')])).toEqual({
      byId: { '101': { localName: 'MARK-A-shared-id' }, '616': { localName: 'MARK-A-only' } },
      order: [616, 101],
    })
    expect(parsed(plan.set[scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-b')])).toEqual({
      byId: { '900': { localName: 'MARK-B-only' } },
      order: [900],
    })
  })

  it('splits camera-local the same way and removes both old keys', () => {
    expect(parsed(plan.set[scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, 'hub-a')])).toEqual({
      byId: { '102': { quality: 'high' } },
    })
    expect(parsed(plan.set[scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, 'hub-b')])).toEqual({
      byId: { '901': { quality: 'low' } },
    })
    expect([...plan.remove].sort()).toEqual([CAMERA_LOCAL_STORAGE_KEY, CAMERA_PREFS_STORAGE_KEY].sort())
  })

  it('an existing per-hub copy wins over the moved value', () => {
    const key = scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-a')
    const again = planServerScopeMigration(
      docs({ [key]: JSON.stringify({ byId: { '616': { localName: 'MARK-A-newer' } }, order: [616] }) }),
      [HUB_A, HUB_B],
      'hub-a',
    )
    expect(parsed(again.set[key])).toEqual({
      byId: { '101': { localName: 'MARK-A-shared-id' }, '616': { localName: 'MARK-A-newer' } },
      order: [616],
    })
  })

  it('has nothing to do once the old keys are gone and every grid carries a hub', () => {
    const done = planServerScopeMigration(
      { grids: plan.set[GRIDS_STORAGE_KEY] ?? null, cameraPrefs: null, cameraLocal: null, scoped: {} },
      [HUB_A, HUB_B],
      'hub-a',
    )
    expect(done).toEqual({ set: {}, remove: [] })
  })
})

describe('through the stores', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    resetDeviceLocalMigrationForTests()
    resetServerScopeMigrationForTests()
    useServerScopeStore.getState().bind(null)
    useCameraPrefsStore.setState({ prefs: { byId: {}, order: [] }, hydrated: false, serverId: null })
    useCameraLocalStore.setState({ local: { byId: {} }, hydrated: false, serverId: null })
    await AsyncStorage.setItem(GRIDS_STORAGE_KEY, JSON.stringify(LEGACY_GRIDS))
    await AsyncStorage.setItem(CAMERA_PREFS_STORAGE_KEY, JSON.stringify(LEGACY_PREFS))
    await AsyncStorage.setItem(CAMERA_LOCAL_STORAGE_KEY, JSON.stringify(LEGACY_LOCAL))
  })

  it("hub A's 101 is not hub B's 101, before and after a switch", async () => {
    await migrateServerScopeOnce([HUB_A, HUB_B], 'hub-a')
    const hydrating = useCameraPrefsStore.getState().hydrate()
    useServerScopeStore.getState().bind('hub-a')
    await hydrating
    expect(useCameraPrefsStore.getState().prefs.byId[101]).toEqual({ localName: 'MARK-A-shared-id' })
    expect(useCameraPrefsStore.getState().prefs.byId[900]).toBeUndefined()

    useServerScopeStore.getState().bind('hub-b')
    await new Promise((r) => setTimeout(r, 0))
    expect(useCameraPrefsStore.getState().serverId).toBe('hub-b')
    expect(useCameraPrefsStore.getState().prefs.byId[101]).toBeUndefined()
    expect(useCameraPrefsStore.getState().prefs.byId[900]).toEqual({ localName: 'MARK-B-only' })

    // A write on hub B lands in hub B's copy only.
    useCameraPrefsStore.getState().setLocalName(101, 'MARK-B-new')
    await new Promise((r) => setTimeout(r, 0))
    const onA = JSON.parse((await AsyncStorage.getItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-a'))) ?? '{}')
    const onB = JSON.parse((await AsyncStorage.getItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, 'hub-b'))) ?? '{}')
    expect(onA.byId['101']).toEqual({ localName: 'MARK-A-shared-id' })
    expect(onB.byId['101']).toEqual({ localName: 'MARK-B-new' })
  })

  it('a grid of another hub is neither listed nor found', async () => {
    await migrateServerScopeOnce([HUB_A, HUB_B], 'hub-a')
    const grids = parseGrids(await AsyncStorage.getItem(GRIDS_STORAGE_KEY))
    expect(gridsForServer(grids, 'hub-a').map((g) => g.name)).toEqual(['MARK-A-wall', 'MARK-A-fallback'])
    expect(findServerGrid(grids, 'gB', 'hub-a')).toBeUndefined()
    expect(findServerGrid(grids, 'gB', 'hub-b')?.name).toBe('MARK-B-wall')
    expect(gridsForServer(grids, null)).toEqual([])
  })
})

describe('replaceServerGridsEntry — account grids are applied onto ONE hub', () => {
  const local: readonly Grid[] = [
    { id: 'gA', name: 'MARK-A-old', serverId: 'hub-a', cameraIds: [101] },
    { id: 'gB', name: 'MARK-B-keep', serverId: 'hub-b', cameraIds: [900] },
  ]

  it("replaces the active hub's grids, keeps every other hub's, stamps the incoming", () => {
    const next = replaceServerGridsEntry(local, 'hub-a', [{ id: 'gA', name: 'MARK-A-new', cameraIds: [616] }])
    expect(next).toEqual([
      { id: 'gB', name: 'MARK-B-keep', serverId: 'hub-b', cameraIds: [900] },
      { id: 'gA', name: 'MARK-A-new', serverId: 'hub-a', cameraIds: [616] },
    ])
  })

  it("an incoming id another hub already uses is suffixed, the same way every time", () => {
    const incoming: readonly Grid[] = [{ id: 'gB', name: 'MARK-A-from-B', cameraIds: [101] }]
    const once = replaceServerGridsEntry(local, 'hub-a', incoming)
    const twice = replaceServerGridsEntry(once, 'hub-a', incoming)
    expect(twice.filter((g) => g.serverId === 'hub-a').map((g) => g.id)).toEqual(['gB@hub-a'])
    expect(twice.find((g) => g.id === 'gB')?.name).toBe('MARK-B-keep')
  })
})

describe('favourites, the last camera and the events filter move too', () => {
  // Marked by id: 616/102 exist only on hub A, 900/901 only on hub B, 101 on both.
  const plan = planServerScopeMigration(
    {
      grids: null,
      cameraPrefs: null,
      cameraLocal: null,
      favourites: JSON.stringify([616, 900, 101]),
      lastCamera: '901',
      eventsFilter: JSON.stringify({ cameraIds: [900, 901], label: 'MARK-B-investigation' }),
      scoped: {},
    },
    [HUB_A, HUB_B],
    'hub-a',
  )

  it('each favourite lands on the one hub that has it, a shared id on the document owner', () => {
    expect(parsed(plan.set[scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, 'hub-a')])).toEqual([616, 101])
    expect(parsed(plan.set[scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, 'hub-b')])).toEqual([900])
  })

  it('the last camera and the events filter go to the hub that has their cameras', () => {
    expect(plan.set[scopedStorageKey(LAST_CAMERA_STORAGE_KEY, 'hub-b')]).toBe('901')
    expect(plan.set[scopedStorageKey(LAST_CAMERA_STORAGE_KEY, 'hub-a')]).toBeUndefined()
    expect(parsed(plan.set[scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, 'hub-b')])).toEqual({
      cameraIds: [900, 901],
      label: 'MARK-B-investigation',
    })
    expect(plan.set[scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, 'hub-a')]).toBeUndefined()
    expect([...plan.remove].sort()).toEqual(
      [CAMERA_FAVOURITES_STORAGE_KEY, EVENTS_FILTER_STORAGE_KEY, LAST_CAMERA_STORAGE_KEY].sort(),
    )
  })

  it('through the store: hub B shows its favourites, hub A its own', async () => {
    await AsyncStorage.clear()
    resetDeviceLocalMigrationForTests()
    resetServerScopeMigrationForTests()
    useServerScopeStore.getState().bind(null)
    useCameraFavouritesStore.setState({ ids: new Set(), hydrated: false, serverId: null })
    await AsyncStorage.setItem(CAMERA_FAVOURITES_STORAGE_KEY, JSON.stringify([616, 900]))
    await migrateServerScopeOnce([HUB_A, HUB_B], 'hub-a')
    useServerScopeStore.getState().bind('hub-b')
    await useCameraFavouritesStore.getState().hydrate()
    expect([...useCameraFavouritesStore.getState().ids]).toEqual([900])
    useServerScopeStore.getState().bind('hub-a')
    await new Promise((r) => setTimeout(r, 0))
    expect([...useCameraFavouritesStore.getState().ids]).toEqual([616])
  })
})
