/**
 * The cameras grid must not paint until the saved arrangement is known.
 *
 * The list cache is readable from the hub URL before the server-scope bind
 * finishes. Camera prefs used to wait on that bind, so the first paint applied
 * an empty order and the grid jumped when the document arrived.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAMERA_PREFS_STORAGE_KEY,
  resetCameraPrefsEntry,
  type AppCameraPrefs,
} from '../../store/camera-prefs-store.js'
import {
  cameraPrefsForPaint,
  cameraPrefsHasArrangement,
  ensureCameraOrderBoot,
  readBootCameraPrefs,
  resetCameraOrderBoot,
  cameraOrderBootSnapshot,
} from '../camera-order-boot.js'

const saved = (order: readonly number[]): AppCameraPrefs => ({
  byId: { 3: { hidden: true } },
  order,
})

describe('cameraPrefsForPaint', () => {
  const empty = resetCameraPrefsEntry()

  it('withholds the grid while the boot read is in flight', () => {
    const paint = cameraPrefsForPaint({
      hydrated: false,
      prefs: empty,
      boot: { phase: 'loading', serverId: 'hub', prefs: empty },
    })
    expect(paint.ready).toBe(false)
  })

  it('paints the disk arrangement before the store has hydrated', () => {
    const bootPrefs = saved([3, 1, 2])
    const paint = cameraPrefsForPaint({
      hydrated: false,
      prefs: empty,
      boot: { phase: 'ready', serverId: 'hub', prefs: bootPrefs },
    })
    expect(paint.ready).toBe(true)
    expect(paint.prefs.order).toEqual([3, 1, 2])
    expect(paint.prefs.byId[3]?.hidden).toBe(true)
  })

  it('reconciles to the store once it has hydrated', () => {
    const paint = cameraPrefsForPaint({
      hydrated: true,
      prefs: saved([9, 8]),
      boot: { phase: 'ready', serverId: 'hub', prefs: saved([3, 1, 2]) },
    })
    expect(paint.ready).toBe(true)
    expect(paint.prefs.order).toEqual([9, 8])
  })

  it('does not withhold when nothing started a boot read', () => {
    const paint = cameraPrefsForPaint({
      hydrated: false,
      prefs: empty,
      boot: { phase: 'idle', serverId: null, prefs: empty },
    })
    expect(paint.ready).toBe(true)
    expect(paint.prefs.order).toEqual([])
  })
})

describe('the camera list uses the boot arrangement', () => {
  it('withholds rows while the read is in flight', () => {
    const src = readFileSync(new URL('../use-cameras.ts', import.meta.url), 'utf8')
    expect(src).toContain('cameraPrefsForPaint')
    expect(src).toContain('isLoading: held || query.isLoading')
  })
})

describe('readBootCameraPrefs', () => {
  it('reads the per-hub document without waiting for anything else', async () => {
    const raw = JSON.stringify(saved([5, 4]))
    const prefs = await readBootCameraPrefs(async (key) => {
      return key.endsWith('@hub-a') ? raw : null
    }, 'hub-a')
    expect(prefs.order).toEqual([5, 4])
  })

  it('falls back to the unscoped document when the per-hub copy has no arrangement', async () => {
    const legacy = JSON.stringify(saved([7, 6]))
    const prefs = await readBootCameraPrefs(async (key) => {
      if (key.endsWith('@hub-a')) return JSON.stringify(resetCameraPrefsEntry())
      if (key === CAMERA_PREFS_STORAGE_KEY) return legacy
      return null
    }, 'hub-a')
    expect(prefs.order).toEqual([7, 6])
  })

  it('an empty document is an answer, not a reason to keep waiting', () => {
    expect(cameraPrefsHasArrangement(resetCameraPrefsEntry())).toBe(false)
  })
})

describe('ensureCameraOrderBoot', () => {
  it('settles to the disk order and does not start a second read', async () => {
    resetCameraOrderBoot()
    let reads = 0
    ensureCameraOrderBoot('hub-a', async (key) => {
      reads += 1
      return key.endsWith('@hub-a') ? JSON.stringify(saved([2, 1])) : null
    })
    expect(cameraOrderBootSnapshot().phase).toBe('loading')
    ensureCameraOrderBoot('hub-a', async () => {
      reads += 1
      return null
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(cameraOrderBootSnapshot().phase).toBe('ready')
    expect(cameraOrderBootSnapshot().prefs.order).toEqual([2, 1])
    expect(reads).toBe(1)
    resetCameraOrderBoot()
  })

  it('a failed read still releases the grid', async () => {
    resetCameraOrderBoot()
    ensureCameraOrderBoot('hub-a', async () => {
      throw new Error('disk')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cameraOrderBootSnapshot().phase).toBe('ready')
    expect(cameraOrderBootSnapshot().prefs.order).toEqual([])
    resetCameraOrderBoot()
  })
})
