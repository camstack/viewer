/**
 * planning#751 — the global detection hold is seeded ONCE from the most common
 * per-camera / per-grid value, never over an explicit global, never twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => void disk.set(k, v),
    removeItem: async (k: string) => void disk.delete(k),
  },
}))

import { CAMERA_PREFS_STORAGE_KEY } from '../camera-prefs-store.js'
import { GRIDS_STORAGE_KEY } from '../grid-store.js'
import { scopedStorageKey } from '../server-scope.js'
import { DEFAULTS, useSettingsStore } from '../settings-store.js'
import {
  DETECTION_HOLD_SEEDED_KEY,
  mostCommonHold,
  resetDetectionHoldSeedForTests,
  seedDetectionHoldOnce,
  storedDetectionHolds,
} from '../detection-hold-seed.js'

const HUB = 'hub-a'

function bind(hold: number): void {
  useSettingsStore.setState({
    settings: { ...DEFAULTS, grid: { ...DEFAULTS.grid, detectionHoldSec: hold } },
    hydrated: true,
    accountServerId: HUB,
  })
}

function storeCameras(holds: Record<number, number>): void {
  const byId = Object.fromEntries(Object.entries(holds).map(([id, h]) => [id, { highlight: { detectionHoldSec: h } }]))
  disk.set(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, HUB), JSON.stringify({ byId, order: [] }))
}

beforeEach(() => {
  disk.clear()
  resetDetectionHoldSeedForTests()
})

describe('detection hold seed', () => {
  it('reads the holds of cameras and of this hub\'s grids', () => {
    const prefs = { byId: { 2: { highlight: { detectionHoldSec: 8 } }, 1: { highlight: { detectionHoldSec: 5 } } } }
    const grids = [
      { serverId: HUB, highlight: { detectionHoldSec: 8 } },
      { serverId: 'other', highlight: { detectionHoldSec: 2 } },
    ]
    expect(storedDetectionHolds(prefs, grids, HUB)).toEqual([5, 8, 8])
    expect(mostCommonHold([5, 8, 8])).toBe(8)
    expect(mostCommonHold([])).toBeNull()
  })

  it('seeds the global from the most common stored value, once', async () => {
    storeCameras({ 1: 8, 2: 8, 3: 5 })
    bind(DEFAULTS.grid.detectionHoldSec)
    await seedDetectionHoldOnce()
    expect(useSettingsStore.getState().settings.grid.detectionHoldSec).toBe(8)
    expect(disk.has(scopedStorageKey(DETECTION_HOLD_SEEDED_KEY, HUB))).toBe(true)

    // The operator then edits it, and a second run (even after a restart) is a no-op.
    useSettingsStore.getState().setGridDefault('detectionHoldSec', 2)
    resetDetectionHoldSeedForTests()
    await seedDetectionHoldOnce()
    expect(useSettingsStore.getState().settings.grid.detectionHoldSec).toBe(2)
  })

  it('leaves an explicit global untouched', async () => {
    storeCameras({ 1: 8, 2: 8 })
    bind(5)
    await seedDetectionHoldOnce()
    expect(useSettingsStore.getState().settings.grid.detectionHoldSec).toBe(5)
  })

  it('waits for a bound hub instead of giving up', async () => {
    storeCameras({ 1: 8 })
    useSettingsStore.setState({ hydrated: true, accountServerId: null })
    await seedDetectionHoldOnce()
    expect(disk.size).toBe(1)
    bind(DEFAULTS.grid.detectionHoldSec)
    await seedDetectionHoldOnce()
    expect(useSettingsStore.getState().settings.grid.detectionHoldSec).toBe(8)
  })

  it('seeds from stored grids when no camera stored one', async () => {
    disk.set(GRIDS_STORAGE_KEY, JSON.stringify([{ serverId: HUB, highlight: { detectionHoldSec: 8 } }]))
    bind(DEFAULTS.grid.detectionHoldSec)
    await seedDetectionHoldOnce()
    expect(useSettingsStore.getState().settings.grid.detectionHoldSec).toBe(8)
  })
})
