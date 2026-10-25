/**
 * The tile's double tap follows the app's rule (`shared/zoom/double-tap-zoom.ts`,
 * operator 2026-10-22): from the whole picture it zooms in until the video
 * fills the tile, the tapped point held still; from any zoom it goes back to
 * the whole picture. It used to only reset, which at rest did nothing.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ZoomPan } from '../ZoomPan'

afterEach(cleanup)

const TILE = { left: 0, top: 0, width: 400, height: 300 }

function pointer(type: string, x: number, y: number): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  return ev
}

function mountTile(): { outer: HTMLElement; inner: HTMLElement } {
  const { container } = render(
    <ZoomPan onTap={() => undefined}>
      <video />
    </ZoomPan>,
  )
  const outer = container.firstElementChild as HTMLElement
  const inner = outer.firstElementChild as HTMLElement
  outer.getBoundingClientRect = () =>
    ({ ...TILE, right: TILE.width, bottom: TILE.height, x: 0, y: 0, toJSON: () => TILE }) as DOMRect
  const video = inner.querySelector('video') as HTMLVideoElement
  // A 16:9 picture in a 4:3 tile: letterboxed top and bottom.
  Object.defineProperty(video, 'videoWidth', { value: 1600 })
  Object.defineProperty(video, 'videoHeight', { value: 900 })
  return { outer, inner }
}

function doubleTap(outer: HTMLElement, x: number, y: number): void {
  for (let i = 0; i < 2; i += 1) {
    fireEvent(outer, pointer('pointerdown', x, y))
    fireEvent(outer, pointer('pointerup', x, y))
  }
}

function transformOf(inner: HTMLElement): { tx: number; ty: number; scale: number } {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(inner.style.transform)
  if (!m) throw new Error(`no transform: "${inner.style.transform}"`)
  return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
}

describe('ZoomPan double tap', () => {
  it('from the whole picture: in to the scale that fills the tile, at the tap', () => {
    const { outer, inner } = mountTile()
    doubleTap(outer, 100, 75)
    const t = transformOf(inner)
    const cover = (16 / 9) / (4 / 3)
    expect(t.scale).toBeCloseTo(cover, 6)
    // At cover the picture exactly fills the height: no vertical travel. The
    // horizontal anchor holds the tapped point still: (100 - 200) * (1 - s).
    expect(t.ty).toBeCloseTo(0, 6)
    expect(t.tx).toBeCloseTo((100 - 200) * (1 - cover), 6)
    expect(outer.style.touchAction).toBe('none')
  })

  it('from any zoom: back to the whole picture', () => {
    const { outer, inner } = mountTile()
    doubleTap(outer, 100, 75)
    doubleTap(outer, 300, 200)
    expect(transformOf(inner)).toEqual({ tx: 0, ty: 0, scale: 1 })
    expect(outer.style.touchAction).toBe('pan-y')
  })
})
