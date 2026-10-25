/**
 * @vitest-environment jsdom
 *
 * The Android wall is given the wall-wide switches, not `GridTile`'s defaults.
 *
 * ## The defect this pins
 *
 * `NativeWorkspaceWall` handed `GridWall` only `cameras`, `layout`, `showName`,
 * `quality` and `ptzIds` — never `layers`, `muted` or `paused`, while
 * `GridViewScreen` draws the SAME component and has always passed all three.
 *
 * `GridTile`'s defaults decide what that silence meant: `muted = true`,
 * `paused = false`, `layers = []`. So on an Android tablet the wall was mute by
 * construction, could not be paused, and drew no detection boxes — with the
 * operator's box toggle in the timeline reporting ON. The per-cell mute and
 * pause shipped for iOS/web on 2026-09-02 did not reach this branch at all.
 *
 * ## Why this renders the branch directly
 *
 * `GridWall` is gated on a measured box, and `onLayout` does not fire under
 * jsdom — which is why the Android mount spec in `workspace-grid-mount.spec.ts`
 * can only assert the container. `NativeWorkspaceWall` already takes that box
 * as a PROP, so it is handed one here and the branch actually draws.
 *
 * What this covers: the mapping and the forward inside the branch. What it does
 * NOT cover is the one-line pass-through at the call site in `WorkspaceGrid` —
 * stated rather than implied, because a reader who assumes otherwise would be
 * wrong about exactly the kind of omission this file exists for.
 *
 * The props are asserted rather than the pixels because `GridWall` is native:
 * there is no DOM to read a layer set off, and a tile renders the same box
 * muted or not. The claim IS the wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'

import type { CameraInfo } from '../../../data/use-cameras.js'
import type { OverlayLayer } from '../../../components/camera/overlay/overlay-config.js'
import { NativeWorkspaceWall } from '../WorkspaceGrid.js'

/** Records what the Android wall was handed, and draws nothing. */
const wallProps: Record<string, unknown>[] = []
vi.mock('../../../components/grid/GridWall.js', () => ({
  GridWall: (props: Record<string, unknown>) => {
    wallProps.push(props)
    return null
  },
}))

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true, features: [] },
  { id: 5, name: 'Garden', isCamera: true, online: true, features: [] },
] as unknown as readonly CameraInfo[]

interface WallOverrides {
  readonly layers?: readonly OverlayLayer[]
  readonly audioOnIds?: readonly number[]
  readonly pausedIds?: readonly number[]
}

function drawWall(overrides: WallOverrides = {}): Record<string, unknown> {
  render(
    React.createElement(NativeWorkspaceWall, {
      cameras: CAMERAS,
      quality: 'auto',
      ptzIds: [],
      layers: overrides.layers ?? [],
      audioOnIds: overrides.audioOnIds ?? [],
      pausedIds: overrides.pausedIds ?? [],
      // The measurement the screen would have made. Explicit, because jsdom
      // never fires `onLayout` and a zero box draws nothing at all.
      box: { w: 1200, h: 700, stamp: '1200x700' },
      onCellPanel: () => {},
    }),
  )
  const last = wallProps[wallProps.length - 1]
  expect(last, 'the native wall did not draw').toBeDefined()
  return last as Record<string, unknown>
}

beforeEach(() => {
  wallProps.length = 0
})

afterEach(() => {
  cleanup()
})

describe('the Android wall carries the detection layer', () => {
  it('boxes ON reaches the tiles as an objects layer', () => {
    expect(drawWall({ layers: ['objects'] }).layers).toEqual(['objects'])
  })

  it('boxes OFF is an empty set, stated rather than left unsaid', () => {
    expect(drawWall({ layers: [] }).layers).toEqual([])
  })
})

describe('the Android wall carries the transport, collapsed to the wall', () => {
  it('no cell listening is a muted wall', () => {
    expect(drawWall({ audioOnIds: [] }).muted).toBe(true)
  })

  it('one cell listening unmutes it — GridWall has no per-tile audio', () => {
    expect(drawWall({ audioOnIds: [5] }).muted).toBe(false)
  })

  it('nothing paused is a running wall', () => {
    expect(drawWall({ pausedIds: [] }).paused).toBe(false)
  })

  it('any cell paused pauses it — the same collapse the grid page lives with', () => {
    expect(drawWall({ pausedIds: [5] }).paused).toBe(true)
  })
})
