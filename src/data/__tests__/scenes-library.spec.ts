import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import { SCENES_BATCH_MAX, sceneBatches, toCameraScenes } from '../scenes-library.js'

describe('toCameraScenes', () => {
  it('keeps "could not be read" (status null) apart from "read, none configured"', () => {
    const out = toCameraScenes([
      { deviceId: 1, status: null },
      { deviceId: 2, status: { monitors: [], lastFetchedAt: 1 } },
      { deviceId: 3, status: { monitors: [{ id: 'm1', label: 'Door', enabled: false }], lastFetchedAt: 1 } },
    ])
    expect(out[0]).toEqual({ deviceId: 1, scenes: null })
    expect(out[1]).toEqual({ deviceId: 2, scenes: [] })
    expect(out[2]?.scenes).toEqual([{ monitorId: 'm1', label: 'Door', enabled: false }])
  })
  it('ignores rows that are not rows', () => {
    expect(toCameraScenes(['x', { status: null }, null])).toEqual([])
    expect(toCameraScenes(undefined)).toEqual([])
  })
})

describe('sceneBatches', () => {
  it('splits at the cap bound so a large fleet never exceeds deviceIds.max(200)', () => {
    const ids = Array.from({ length: SCENES_BATCH_MAX * 2 + 1 }, (_, i) => i)
    expect(sceneBatches(ids).map((b) => b.length)).toEqual([SCENES_BATCH_MAX, SCENES_BATCH_MAX, 1])
    expect(sceneBatches([])).toEqual([])
  })
})

describe('the Scenes page is read-only and complete in both locales', () => {
  const src = readFileSync(join(process.cwd(), 'src/data/scenes-library.ts'), 'utf8')
  it('reads through listScenesBatch and writes nothing', () => {
    expect(src).toContain("'listScenesBatch'")
    expect(src).not.toMatch(/capMutate|\.mutate\(/)
  })
  it('has every key', () => {
    for (const key of ['empty', 'emptyHint', 'loadError', 'refreshButton', 'unreadable', 'sceneCount_one', 'sceneCount_other']) {
      const scenesEn = (enLocale as { v2: { scenes: Record<string, string> } }).v2.scenes
      const scenesIt = (itLocale as { v2: { scenes: Record<string, string> } }).v2.scenes
      expect(scenesEn[key], `en ${key}`).toBeTruthy()
      expect(scenesIt[key], `it ${key}`).toBeTruthy()
    }
  })
})
