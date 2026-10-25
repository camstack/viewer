/**
 * @vitest-environment jsdom
 *
 * People / Plates remember their filter and sort on this device, through a
 * REMOUNT of the page and a restart of the app; the day is not remembered; a
 * camera the hub no longer has is dropped (and only once the list answered).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { useReviewFilters } from '../use-review-filters.js'
import { useLibraryFilterStore } from '../../../store/library-filter-store.js'
import { scopedStorageKey, useServerScopeStore } from '../../../store/server-scope.js'
import { FACES_FILTER_STORAGE_KEY } from '../../../store/library-filters.js'
import {
  DEFAULT_FACE_REVIEW_FILTERS,
  toggleFaceReviewDevice,
  toggleFaceReviewStatus,
} from '../../../data/face-review-filters.js'

let cameras: { id: number }[] | undefined = [{ id: 101 }, { id: 102 }]
vi.mock('../../../data/use-cameras.js', () => ({
  useAllCameras: () => ({ data: cameras }),
}))

async function disk(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

function restartApp(): void {
  useLibraryFilterStore.setState({ values: {}, hydrated: false, serverId: null })
}

async function mountReady(page: 'faces' | 'plates') {
  const hook = renderHook(() => useReviewFilters(page))
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true))
  return hook
}

beforeEach(async () => {
  cameras = [{ id: 101 }, { id: 102 }]
  await AsyncStorage.clear()
  useServerScopeStore.getState().bind('hub-a')
  restartApp()
})

describe('useReviewFilters', () => {
  it('opens People and Plates on confidence, highest first', async () => {
    for (const page of ['faces', 'plates'] as const) {
      const { result, unmount } = await mountReady(page)
      expect(result.current.sort).toEqual({ key: 'certainty', direction: 'desc' })
      expect(result.current.filters).toEqual(DEFAULT_FACE_REVIEW_FILTERS)
      unmount()
    }
  })

  it('restores status, cameras and sort after a remount and after a restart — not the day', async () => {
    const first = await mountReady('faces')
    act(() => {
      first.result.current.setFilters((prev) => toggleFaceReviewDevice(toggleFaceReviewStatus(prev, 'assigned'), 101))
      first.result.current.setFilters((prev) => ({ ...prev, dayMs: 1_790_000_000_000 }))
      first.result.current.setSort(() => ({ key: 'date', direction: 'asc' }))
    })
    expect(first.result.current.filters.dayMs).toBe(1_790_000_000_000)
    first.unmount()

    const remounted = await mountReady('faces')
    const expected = {
      statuses: [...DEFAULT_FACE_REVIEW_FILTERS.statuses, 'assigned'],
      deviceIds: [101],
      dayMs: null,
    }
    expect(remounted.result.current.filters).toEqual(expected)
    expect(remounted.result.current.sort).toEqual({ key: 'date', direction: 'asc' })
    remounted.unmount()

    restartApp()
    const restarted = await mountReady('faces')
    expect(restarted.result.current.filters).toEqual(expected)
    expect(restarted.result.current.sort).toEqual({ key: 'date', direction: 'asc' })

    // The other page is untouched.
    const plates = await mountReady('plates')
    expect(plates.result.current.filters).toEqual(DEFAULT_FACE_REVIEW_FILTERS)
  })

  it('Reset (back to the default filters) is what the next launch opens on', async () => {
    const first = await mountReady('plates')
    act(() => first.result.current.setFilters((prev) => toggleFaceReviewDevice(prev, 102)))
    act(() => first.result.current.setFilters(() => DEFAULT_FACE_REVIEW_FILTERS))
    first.unmount()
    restartApp()
    const again = await mountReady('plates')
    expect(again.result.current.filters).toEqual(DEFAULT_FACE_REVIEW_FILTERS)
  })

  it('drops a remembered camera the hub no longer has, on screen and on disk', async () => {
    await AsyncStorage.setItem(
      scopedStorageKey(FACES_FILTER_STORAGE_KEY, 'hub-a'),
      JSON.stringify({ statuses: ['suggested'], deviceIds: [101, 999], sort: { key: 'date', direction: 'desc' } }),
    )
    const { result } = await mountReady('faces')
    expect(result.current.filters.deviceIds).toEqual([101])
    await waitFor(async () =>
      expect(await disk(scopedStorageKey(FACES_FILTER_STORAGE_KEY, 'hub-a'))).toMatchObject({ deviceIds: [101] }),
    )
  })

  it('keeps every remembered camera while the camera list has not answered', async () => {
    cameras = undefined
    await AsyncStorage.setItem(
      scopedStorageKey(FACES_FILTER_STORAGE_KEY, 'hub-a'),
      JSON.stringify({ statuses: ['suggested'], deviceIds: [101, 999] }),
    )
    const { result } = await mountReady('faces')
    expect(result.current.filters.deviceIds).toEqual([101, 999])
  })
})
