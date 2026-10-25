import { describe, expect, it } from 'vitest'
import { displayedImageRect } from '../boxes.js'
import {
  IDENTITY_VIEWPORT,
  centerOnBox,
  clampViewport,
  dragMove,
  dragResize,
  grabAt,
  normToScreen,
  panBy,
  pinchViewport,
  screenToNorm,
  zoomAt,
} from '../viewport.js'

const container = { w: 400, h: 600 }
// A 16:9 frame letterboxed in a portrait container: 400 x 225 centred.
const img = displayedImageRect(400, 600, 1920, 1080)
if (img === null) throw new Error('fixture')

describe('screen <-> norm', () => {
  it('round-trips at any zoom and pan', () => {
    const vp = { scale: 3, tx: 40, ty: -25 }
    const p = { x: 0.3, y: 0.7 }
    const back = screenToNorm(normToScreen(p, vp, container, img), vp, container, img)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('maps the frame corners onto the displayed rect at 1x', () => {
    const tl = normToScreen({ x: 0, y: 0 }, IDENTITY_VIEWPORT, container, img)
    expect(tl.x).toBeCloseTo(img.left)
    expect(tl.y).toBeCloseTo(img.top)
  })
})

describe('zoom and pan', () => {
  it('keeps the point under the focal where it was', () => {
    const focal = { x: 150, y: 300 }
    const before = screenToNorm(focal, IDENTITY_VIEWPORT, container, img)
    const vp = zoomAt(IDENTITY_VIEWPORT, 3, focal, container, img)
    const after = screenToNorm(focal, vp, container, img)
    expect(after.x).toBeCloseTo(before.x, 4)
    expect(after.y).toBeCloseTo(before.y, 4)
  })

  it('never zooms below 1x or above the cap, and never pans past the picture', () => {
    expect(zoomAt(IDENTITY_VIEWPORT, 0.2, { x: 0, y: 0 }, container, img).scale).toBe(1)
    expect(zoomAt(IDENTITY_VIEWPORT, 99, { x: 0, y: 0 }, container, img).scale).toBe(8)
    const panned = panBy({ scale: 2, tx: 0, ty: 0 }, 9999, 9999, container, img)
    expect(panned.tx).toBeCloseTo((2 * img.width - container.w) / 2)
    // The picture is shorter than the container at 2x, so no vertical pan at all.
    expect(clampViewport({ scale: 1, tx: 50, ty: 50 }, container, img)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

describe('pinchViewport — two fingers zoom and pan', () => {
  it('keeps the picture point under the fingers as they spread and slide', () => {
    const startFocal = { x: 200, y: 300 }
    const under = screenToNorm(startFocal, IDENTITY_VIEWPORT, container, img)
    const focal = { x: 230, y: 300 }
    const vp = pinchViewport(IDENTITY_VIEWPORT, 3, startFocal, focal, container, img)
    expect(vp.scale).toBe(3)
    const after = screenToNorm(focal, vp, container, img)
    expect(after.x).toBeCloseTo(under.x, 4)
    expect(after.y).toBeCloseTo(under.y, 4)
  })

  it('pans a zoomed picture with two fingers that slide without spreading', () => {
    const base = { scale: 2, tx: 0, ty: 0 }
    const vp = pinchViewport(base, 1, { x: 200, y: 300 }, { x: 150, y: 300 }, container, img)
    expect(vp).toEqual({ scale: 2, tx: -50, ty: 0 })
  })
})

describe('grabAt', () => {
  const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  const corner = normToScreen({ x: 0.25, y: 0.25 }, IDENTITY_VIEWPORT, container, img)

  it('grabs a corner within a 44 pt target, and corners win over the body', () => {
    expect(grabAt(box, { x: corner.x + 18, y: corner.y + 18 }, IDENTITY_VIEWPORT, container, img)).toEqual({
      kind: 'corner',
      corner: 'nw',
    })
  })

  it('grabs the body inside, nothing far outside', () => {
    const centre = normToScreen({ x: 0.5, y: 0.5 }, IDENTITY_VIEWPORT, container, img)
    expect(grabAt(box, centre, IDENTITY_VIEWPORT, container, img)).toEqual({ kind: 'body' })
    expect(grabAt(box, { x: 5, y: 5 }, IDENTITY_VIEWPORT, container, img)).toBeNull()
  })

  it('keeps the 44 pt target when zoomed out of a tiny box', () => {
    const tiny = { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }
    const c = normToScreen({ x: 0.5, y: 0.5 }, IDENTITY_VIEWPORT, container, img)
    expect(grabAt(tiny, { x: c.x + 20, y: c.y + 20 }, IDENTITY_VIEWPORT, container, img)).not.toBeNull()
  })
})

describe('drags', () => {
  const base = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }

  it('a body drag is the screen distance over the zoomed picture, clamped to the frame', () => {
    const moved = dragMove(base, img.width / 10, 0, IDENTITY_VIEWPORT, img)
    expect(moved.x).toBeCloseTo(0.3)
    expect(moved.w).toBe(0.3)
    expect(dragMove(base, 99999, 0, IDENTITY_VIEWPORT, img).x).toBeCloseTo(0.7)
  })

  it('zoomed 2x the same finger distance moves the box half as far', () => {
    const moved = dragMove(base, img.width / 10, 0, { scale: 2, tx: 0, ty: 0 }, img)
    expect(moved.x).toBeCloseTo(0.25)
  })

  it('a corner drag moves only that corner, by the distance, not to the finger', () => {
    const grown = dragResize(base, 'se', img.width * 0.1, img.height * 0.1, IDENTITY_VIEWPORT, img)
    expect(grown.x).toBe(0.2)
    expect(grown.w).toBeCloseTo(0.4)
    expect(grown.h).toBeCloseTo(0.4)
  })
})

describe('centerOnBox', () => {
  it('never zooms: at 1x the view does not move, a zoomed view pans to the box', () => {
    const box = { x: 0.7, y: 0.4, w: 0.1, h: 0.1 }
    expect(centerOnBox(box, IDENTITY_VIEWPORT, container, img, 200)).toEqual(IDENTITY_VIEWPORT)
    const zoomed = centerOnBox(box, { scale: 3, tx: 0, ty: 0 }, container, img, 0)
    expect(zoomed.scale).toBe(3)
    const c = normToScreen({ x: 0.75, y: 0.45 }, zoomed, container, img)
    expect(c.x).toBeCloseTo(container.w / 2, 0)
  })
})
