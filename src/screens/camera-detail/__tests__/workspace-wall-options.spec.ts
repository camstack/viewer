/**
 * The camera-detail wall's view options, by value: an untouched bar draws what
 * the wall drew before it existed (the primary's documents), a field the bar
 * set wins, the live-edge gate still applies, and the choices die with the view.
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { GridHighlightEmbedConfig } from '../../../grid-embed/embed-config.js'
import { GRID_HIGHLIGHT_DEFAULTS } from '../../../store/grid-store.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../store/workspace.js'
import { toggleWallTransport } from '../../../live/battery-stream-gate.js'
import {
  NO_WALL_OPTIONS,
  resolveWorkspaceWall,
  toggleWallAudio,
  toggleWallLayer,
  type WorkspaceWallPrimary,
} from '../workspace-wall-options.js'

const HIGHLIGHT: GridHighlightEmbedConfig = {
  ...GRID_HIGHLIGHT_DEFAULTS,
  enabled: true,
  motion: true,
  detection: true,
}
const PRIMARY: WorkspaceWallPrimary = { quality: 'high', highlight: HIGHLIGHT, showBoxes: true }

afterEach(() => {
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE, wallOptions: NO_WALL_OPTIONS })
})

describe('an untouched bar draws the primary', () => {
  it('tier, highlight and boxes are the primary documents; layout auto; active-only off', () => {
    const wall = resolveWorkspaceWall(PRIMARY, NO_WALL_OPTIONS, true)
    expect(wall.quality).toBe('high')
    expect(wall.highlightOn).toBe(true)
    expect(wall.highlight).toEqual(HIGHLIGHT)
    expect(wall.layers).toEqual(['objects'])
    expect(wall.showBoxes).toBe(true)
    expect(wall.layout).toBe('auto')
    expect(wall.activeOnly).toBe(false)
  })
})

describe('what the bar set wins', () => {
  it('per field, leaving the rest on the primary', () => {
    const wall = resolveWorkspaceWall(
      PRIMARY,
      { quality: 'low', layout: 3, highlightOn: false, layers: ['stationary'], highlight: { motion: false } },
      true,
    )
    expect(wall.quality).toBe('low')
    expect(wall.layout).toBe(3)
    expect(wall.highlight.enabled).toBe(false)
    expect(wall.highlight.motion).toBe(false)
    expect(wall.highlight.detection).toBe(true)
    expect(wall.showBoxes).toBe(false)
  })

  it('off the live edge the embed highlight stops, whatever the bar said', () => {
    const wall = resolveWorkspaceWall(PRIMARY, { highlightOn: true, highlight: { motion: true } }, false)
    expect(wall.highlight.enabled).toBe(false)
    expect(wall.highlight.motion).toBe(false)
    // The menu still shows what the operator chose — only the drawing stops.
    expect(wall.highlightOn).toBe(true)
  })
})

describe('the mass commands cover the whole set', () => {
  it('pause all, then play all — battery cameras started explicitly', () => {
    const empty = { pausedIds: new Set<number>(), startedIds: new Set<number>() }
    const paused = toggleWallTransport(empty, [1, 7, 9], new Set([9]))
    expect([...paused.pausedIds].sort()).toEqual([1, 7, 9])
    const played = toggleWallTransport(paused, [1, 7, 9], new Set([9]))
    expect([...played.pausedIds]).toEqual([])
    expect([...played.startedIds]).toEqual([9])
  })

  it('unmute all, then mute all', () => {
    expect(toggleWallAudio([], [1, 7, 9])).toEqual([1, 7, 9])
    expect(toggleWallAudio([7], [1, 7, 9])).toEqual([])
  })

  it('a layer chip toggles one layer', () => {
    expect(toggleWallLayer(['objects'], 'stationary')).toEqual(['objects', 'stationary'])
    expect(toggleWallLayer(['objects', 'stationary'], 'objects')).toEqual(['stationary'])
  })
})

describe('the choices live and die with the view', () => {
  it('survive a member change, drop when the view empties', () => {
    const store = useWorkspaceStore.getState()
    store.add(7)
    store.add(9)
    useWorkspaceStore.getState().setWallOptions({ quality: 'low' })
    useWorkspaceStore.getState().setWallOptions({ activeOnly: true })
    useWorkspaceStore.getState().remove(9)
    expect(useWorkspaceStore.getState().wallOptions).toEqual({ quality: 'low', activeOnly: true })
    useWorkspaceStore.getState().remove(7)
    expect(useWorkspaceStore.getState().wallOptions).toEqual(NO_WALL_OPTIONS)
  })
})
