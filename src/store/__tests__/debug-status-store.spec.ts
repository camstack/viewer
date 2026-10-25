/**
 * The Library page must subscribe to a STABLE reviewed-ids snapshot.
 * Deriving the array inside the zustand selector remounts the events WebView
 * until RN throws "Attempting to draw on a screen that is not attached".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebugStatusStore } from '../debug-status-store.js'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  },
}))

describe('debug-status-store reviewedIds', () => {
  beforeEach(() => {
    useDebugStatusStore.setState({ statuses: {}, reviewedIds: [], hydrated: false })
  })

  it('keeps the same reviewedIds reference until a reviewed row changes', () => {
    const empty = useDebugStatusStore.getState().reviewedIds
    useDebugStatusStore.getState().markOpen('a')
    expect(useDebugStatusStore.getState().reviewedIds).toBe(empty)
    useDebugStatusStore.getState().markReviewed('a')
    const reviewed = useDebugStatusStore.getState().reviewedIds
    expect(reviewed).toEqual(['a'])
    expect(reviewed).not.toBe(empty)
    useDebugStatusStore.getState().markOpen('b')
    expect(useDebugStatusStore.getState().reviewedIds).toBe(reviewed)
  })
})
