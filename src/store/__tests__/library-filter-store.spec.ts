/**
 * The Library filter bars survive a restart, per section and per hub, and a
 * Reset forgets them. A "restart" here is the store wiped back to its boot
 * state and hydrated again from the DISK.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import { useLibraryFilterStore } from '../library-filter-store.js'
import { FACES_FILTER_STORAGE_KEY, PLATES_FILTER_STORAGE_KEY, parseReviewRemembered } from '../library-filters.js'
import {
  DEFAULTS as EVENTS_DEFAULTS,
  EVENTS_FILTER_DEVICE_STORAGE_KEY,
  useEventsFilterStore,
} from '../events-filter-store.js'

async function disk(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

async function restartLibrary(): Promise<void> {
  useLibraryFilterStore.setState({ values: {}, hydrated: false, serverId: null })
  await useLibraryFilterStore.getState().hydrate()
}

async function restartEvents(): Promise<void> {
  useEventsFilterStore.setState({ filter: EVENTS_DEFAULTS, hydrated: false, serverId: null })
  await useEventsFilterStore.getState().hydrate()
}

beforeEach(async () => {
  await AsyncStorage.clear()
  useServerScopeStore.getState().bind('hub-a')
  await restartLibrary()
  await restartEvents()
})

describe('library filter store', () => {
  it('restores each section on its own after a restart', async () => {
    const s = useLibraryFilterStore.getState()
    s.write('faces', { statuses: ['assigned'], deviceIds: [101], sort: { key: 'date', direction: 'asc' } })
    s.write('plates', { statuses: ['suggested'], deviceIds: [102], sort: { key: 'certainty', direction: 'asc' } })
    s.write('artifacts', { kinds: ['export'], deviceIds: [] })
    s.write('retrain', { deviceId: 101, collectionId: 'c1' })
    await settle()

    await restartLibrary()
    const values = useLibraryFilterStore.getState().values
    expect(parseReviewRemembered(values.faces)).toEqual({
      statuses: ['assigned'],
      deviceIds: [101],
      sort: { key: 'date', direction: 'asc' },
    })
    expect(parseReviewRemembered(values.plates).deviceIds).toEqual([102])
    expect(values.artifacts).toEqual({ kinds: ['export'], deviceIds: [] })
    expect(values.retrain).toEqual({ deviceId: 101, collectionId: 'c1' })
  })

  it('writes one hub-scoped device document per section', async () => {
    useLibraryFilterStore.getState().write('faces', { statuses: [], deviceIds: [1], sort: { key: 'date', direction: 'desc' } })
    await settle()
    expect(await disk(scopedStorageKey(FACES_FILTER_STORAGE_KEY, 'hub-a'))).toMatchObject({ deviceIds: [1] })
    expect(await disk(scopedStorageKey(PLATES_FILTER_STORAGE_KEY, 'hub-a'))).toBeNull()
  })

  it('clear forgets the section, on disk too — the next launch opens on the defaults', async () => {
    const s = useLibraryFilterStore.getState()
    s.write('retrain', { deviceId: 101, collectionId: null })
    s.write('artifacts', { kinds: ['export'], deviceIds: [101] })
    await settle()
    useLibraryFilterStore.getState().clear('retrain')
    await settle()
    expect(await disk(scopedStorageKey('camstack.v2.library-filter.retrain', 'hub-a'))).toBeNull()
    await restartLibrary()
    expect(useLibraryFilterStore.getState().values.retrain).toBeUndefined()
    expect(useLibraryFilterStore.getState().values.artifacts).toEqual({ kinds: ['export'], deviceIds: [101] })
  })

  it('another hub has its own copy', async () => {
    useLibraryFilterStore.getState().write('faces', { statuses: [], deviceIds: [101], sort: { key: 'date', direction: 'desc' } })
    await settle()
    useServerScopeStore.getState().bind('hub-b')
    await settle()
    expect(useLibraryFilterStore.getState().values.faces).toBeUndefined()
    useServerScopeStore.getState().bind('hub-a')
    await settle()
    expect(useLibraryFilterStore.getState().values.faces).toMatchObject({ deviceIds: [101] })
  })
})

describe('events filter — the device half', () => {
  it('restores cameras, classes, attributes and the marks after a restart; not the label', async () => {
    const s = useEventsFilterStore.getState()
    s.toggleCamera(101)
    s.setClasses(['person'])
    s.toggleAttribute('plate')
    s.setFilterTrain(true)
    s.setLabel('MARK-label')
    await settle()

    await restartEvents()
    expect(useEventsFilterStore.getState().filter).toEqual({
      ...EVENTS_DEFAULTS,
      cameraIds: [101],
      classes: ['person'],
      attributes: ['plate'],
      filterTrain: true,
    })
  })

  it('keeps an explicit EMPTY class selection across a restart (not the preset)', async () => {
    useEventsFilterStore.getState().setClasses([])
    await settle()
    await restartEvents()
    expect(useEventsFilterStore.getState().filter.classes).toEqual([])
  })

  it('reset writes the defaults: the next launch opens on the full page', async () => {
    useEventsFilterStore.getState().toggleCamera(101)
    await settle()
    useEventsFilterStore.getState().reset()
    await settle()
    expect(await disk(scopedStorageKey(EVENTS_FILTER_DEVICE_STORAGE_KEY, 'hub-a'))).toMatchObject({ cameraIds: [] })
    await restartEvents()
    expect(useEventsFilterStore.getState().filter).toEqual(EVENTS_DEFAULTS)
  })

  it('drops a remembered camera the hub no longer has, and remembers that', async () => {
    useEventsFilterStore.getState().toggleCamera(101)
    useEventsFilterStore.getState().toggleCamera(999)
    await settle()
    useEventsFilterStore.getState().pruneCameras(undefined)
    expect(useEventsFilterStore.getState().filter.cameraIds).toEqual([101, 999])
    useEventsFilterStore.getState().pruneCameras(new Set([101, 102]))
    await settle()
    expect(useEventsFilterStore.getState().filter.cameraIds).toEqual([101])
    await restartEvents()
    expect(useEventsFilterStore.getState().filter.cameraIds).toEqual([101])
  })
})
