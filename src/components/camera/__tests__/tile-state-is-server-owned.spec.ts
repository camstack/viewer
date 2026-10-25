/**
 * The app does not manage camera tiles. The hub does.
 *
 * ## The directive this pins (operator, 2026-08-20)
 *
 * "The viewer app should never manage these tiles — you can delete every line
 * of that code. The backend must provision the correct tile in every case; the
 * only case to show is a long timeout when the backend is overloaded."
 *
 * ## What was deleted, and why it kept coming back
 *
 * The snapshot service has rendered a camera's state INTO the frame since D62
 * (`snapshot-courtesy.ts`) and names it in `getSnapshotLinks.stateReason`. The
 * app still grew three parallel mechanisms for the same fact, because for
 * `offline` — and only offline — the server used to answer with a bare stale
 * photograph that said nothing:
 *
 *   1. `shouldRequestSnapshot` refused to ASK for an offline camera;
 *   2. `useSnapshot`'s `holdLastFrame` painted a frame the app held anyway;
 *   3. `CameraCard` drew a `WifiOff` chip, then `CameraTileState.tsx` drew the
 *      same chip for two states so they would at least agree with each other.
 *
 * Every one of them derived the camera's state from REGISTRY FLAGS (`online`,
 * `disabled`, `sleeping`) — a second source for a fact the pixels already
 * carried, free to disagree with them. D190 gave the server the whole job:
 * `offline` is now a first-class state reason, painted into the frame and
 * carried in `stateReason` + `ageMs`.
 *
 * So this file is the previous guard INVERTED. It used to prove there was
 * exactly one client rendering of an inactive tile; it now proves there is
 * none.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isLiveEdge,
  shouldRequestSnapshot,
  type TileCameraState,
} from '../tile-snapshot-gate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..')

function read(...rel: readonly string[]): string {
  return readFileSync(path.resolve(SRC, ...rel), 'utf8')
}

const UP: TileCameraState = {
  screenActive: true,
  online: true,
  disabled: false,
  sleeping: false,
}

describe('the snapshot gate asks for every camera on screen', () => {
  it('asks for an OFFLINE camera — the hub has its tile, and only the hub knows what it is', () => {
    // The old rule ("do not ask, that path dials before it gives up") stopped
    // being true when `offline` became a state the server answers from cache
    // with the treatment already painted (D190). While it was true, it cost the
    // operator a blank tile and the app three mechanisms to fill it.
    expect(shouldRequestSnapshot({ ...UP, online: false })).toBe(true)
  })

  it('asks for a disabled or sleeping camera, exactly as before', () => {
    expect(shouldRequestSnapshot({ ...UP, disabled: true, online: false })).toBe(true)
    expect(shouldRequestSnapshot({ ...UP, sleeping: true })).toBe(true)
  })

  it('still asks nothing while the surface is off screen — the one gate that is not about the camera', () => {
    expect(shouldRequestSnapshot({ ...UP, screenActive: false })).toBe(false)
    expect(shouldRequestSnapshot({ ...UP, screenActive: false, online: false })).toBe(false)
  })

  it('keeps the LIVE EDGE narrow — occupancy and motion are not tiles', () => {
    // The two questions stay separate: what may poll live, and what may be
    // painted. Only the second one moved.
    expect(isLiveEdge(UP)).toBe(true)
    expect(isLiveEdge({ ...UP, online: false })).toBe(false)
    expect(isLiveEdge({ ...UP, disabled: true })).toBe(false)
    expect(isLiveEdge({ ...UP, sleeping: true })).toBe(false)
  })
})

describe('no client-side rendering of a camera state survives', () => {
  it('has no CameraTileState module at all', () => {
    // Deleted, not rewired. It was the LAST client derivation of an inactive
    // tile, and a module that still exists is a module that gets imported again.
    expect(existsSync(path.resolve(SRC, 'components', 'camera', 'CameraTileState.tsx'))).toBe(
      false,
    )
  })

  it('leaves CameraCard with no state vocabulary of its own', () => {
    const card = read('components', 'CameraCard.tsx')
    // `WifiOff` is a TILE icon — it existed for exactly one purpose, drawing the
    // app's own offline verdict over a photograph. (The footer's status dot and
    // its sleeping moon are a different thing and stay: they describe the device
    // ROW, which has always read the registry, and they are not painted over the
    // frame the hub composed.)
    expect(card, 'CameraCard must not draw a WifiOff').not.toMatch(/\bWifiOff\b/)
    // Derivations of state from registry flags.
    for (const gone of ['cameraTileState', 'CameraTileStateChip', 'CameraTileStateOverlay']) {
      expect(card, `CameraCard must not use ${gone}`).not.toContain(gone)
    }
    // Per-state sentences. The tile's own words come from served metadata only.
    for (const key of [
      'offlineSnapshot',
      'sleepingSnapshot',
      'offlineSnapshotNoFrame',
      'sleepingSnapshotNoFrame',
    ]) {
      expect(card, `CameraCard must not translate ${key}`).not.toContain(key)
    }
  })

  it('leaves useSnapshot with no hold-the-last-frame branch', () => {
    // `holdLastFrame` existed only to paint something for a camera the gate
    // refused to ask about. The gate asks about everything now, so the branch
    // has no caller and no reason to exist — and while it existed, "what is
    // painted" had a second owner.
    const hook = read('data', 'use-snapshot.ts')
    expect(hook).not.toContain('holdLastFrame')
  })

  it('lets no surface gate its snapshot on the camera being online', () => {
    // Every tile in the app, not just the Cameras page: a grid tile that skips
    // an offline camera is the same bug with a different container.
    for (const file of [
      ['components', 'grid', 'GridTile.tsx'],
      ['screens', 'GridsScreen.tsx'],
      ['screens', 'GridBuilderScreen.web.tsx'],
    ] as const) {
      const src = read(...file)
      const calls = [...src.matchAll(/useSnapshot\(([^)]*)\)/g)].map((m) => m[1] ?? '')
      expect(calls.length, `${file.join('/')} should still take snapshots`).toBeGreaterThan(0)
      for (const args of calls) {
        expect(args, `${file.join('/')} must not gate a snapshot on camera.online`).not.toContain(
          '.online',
        )
      }
    }
  })
})
