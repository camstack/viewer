import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for Task C.2 — the cameras-list controls button/overlay —
 * for the properties a real mount can't cheaply hold across two files at
 * once (which component the screen wires the button to, and that only ONE
 * overlay instance exists for N cards). `camera-controls-overlay.spec.ts`
 * covers the overlay's own rendering behaviour with a real mount; this file
 * is the "does the screen actually wire it up" half, in the style already
 * established by `grid-cell-controls-wiring.spec.ts`.
 */

const SRC = join(process.cwd(), 'src')
const CARD = join(SRC, 'components', 'CameraCard.tsx')
const SCREEN = join(SRC, 'screens', 'CamerasScreen.tsx')
const OVERLAY = join(SRC, 'components', 'camera', 'CameraControlsOverlay.tsx')

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the cameras-list card opens the shared overlay, not a copy', () => {
  it('the card takes an onOpenControls prop and calls it, stopping the navigate press', () => {
    const src = code(CARD)
    expect(src).toContain('onOpenControls: () => void')
    expect(src).toContain('onOpenControls()')
    // Nested inside the card's own navigate-Pressable — must not also
    // navigate to the camera.
    expect(src).toContain('e.stopPropagation()')
  })

  it('the card renders no accessory/switch control of its own', () => {
    // Reuse discipline, same rule `grid-cell-controls-wiring.spec.ts` holds
    // for the grid: the button only ASKS, it does not carry its own copy of
    // PTZ / devices / switches.
    const src = code(CARD)
    expect(src).not.toContain('CameraSwitchGroup')
    expect(src).not.toContain('DevicesPanel')
    expect(src).not.toContain('PtzControls')
  })

  it('the screen mounts exactly one overlay instance for the whole list', () => {
    const occurrences = code(SCREEN).match(/<CameraControlsOverlay/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('every card in the list is wired to the SAME overlay-opening callback', () => {
    const src = code(SCREEN)
    expect(src).toContain('onOpenControls={() => { hapticTap(); setControlsCameraId(item.id) }}')
  })
})

describe('the overlay reuses the single-camera surfaces, unmodified', () => {
  it('mounts PtzControls and the ONE composed accessory panel', () => {
    const src = code(OVERLAY)
    expect(src).toContain("from './PtzControls.js'")
    expect(src).toContain("from './accessory-panel/CameraAccessoryPanel.js'")
    // The devices list and the switch group are composed INSIDE the panel —
    // a second composition here is the drift the panel exists to end.
    expect(src).not.toContain('CameraSwitchGroup')
    expect(src).not.toContain('AccessoryDeviceList')
  })

  it('PTZ is gated on the feature AND on being able to actuate, mirroring the detail screen', () => {
    const src = code(OVERLAY)
    expect(src).toContain('canActuate && camera.features.includes(FEATURE.ptz)')
  })

  it('re-implements no accessory control of its own', () => {
    const src = code(OVERLAY)
    expect(src).not.toContain('accessory-controls/')
  })
})

describe('the yellow badge — where its signal went', () => {
  it('the tile no longer renders SwitchedOffBadge', () => {
    const src = code(CARD)
    expect(src).not.toContain('SwitchedOffBadge')
    expect(src).not.toContain('useSwitchedOffFor')
  })

  it('the overlay draws the SAME badge component for a non-admin session', () => {
    // The retired tile badge's job, not a re-implementation of it — reused
    // verbatim, just relocated (see `camera-controls-overlay.spec.ts` for the
    // behavioural half: it only appears for a non-admin, and only when
    // something actually is off). Since 2026-09-22 the badge lives inside the
    // composed accessory panel the overlay mounts, so it reaches the overlay
    // through ONE import — the panel's — and the overlay itself names neither.
    const src = code(OVERLAY)
    expect(src).toContain("from './accessory-panel/CameraAccessoryPanel.js'")
    expect(src).not.toContain('SwitchedOffBadge')
    const panel = code(join(SRC, 'components', 'camera', 'accessory-panel', 'CameraAccessoryPanel.tsx'))
    expect(panel).toContain("from '../SwitchedOffBadge.js'")
    expect(panel).toContain('<SwitchedOffBadge')
  })

  it('the grid wall keeps its own badge untouched — out of scope for C.2', () => {
    const tile = code(join(SRC, 'components', 'grid', 'GridTile.tsx'))
    expect(tile).toContain('SwitchedOffBadge')
    expect(tile).toContain('useSwitchedOffFor')
  })
})
