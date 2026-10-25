import { describe, expect, it } from 'vitest'
import { displayedImageRect } from '../boxes.js'
import {
  committedDraw,
  decideCanvasDrag,
  dragStep,
  NO_DRAG,
  tapTarget,
  type CanvasBox,
  type CanvasDrag,
} from '../canvas-gesture.js'
import { IDENTITY_VIEWPORT, normToScreen, screenToNorm, type Viewport } from '../viewport.js'

const container = { w: 400, h: 600 }
// A 16:9 frame letterboxed in a portrait container: 400 x 225 centred.
const imgOrNull = displayedImageRect(400, 600, 1920, 1080)
if (imgOrNull === null) throw new Error('fixture')
const img = imgOrNull

const big: CanvasBox = { key: 'big', bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }
const small: CanvasBox = { key: 'small', bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }
const at = (nx: number, ny: number, vp: Viewport = IDENTITY_VIEWPORT) =>
  normToScreen({ x: nx, y: ny }, vp, container, img)

function decide(over: Partial<Parameters<typeof decideCanvasDrag>[0]> & { touch: { x: number; y: number } }): CanvasDrag {
  return decideCanvasDrag({
    drawMode: false,
    selected: null,
    viewport: IDENTITY_VIEWPORT,
    container,
    img,
    ...over,
  })
}

describe('decideCanvasDrag — which gesture a one-finger drag is', () => {
  it('draws in "add box" mode, even on top of the selected box', () => {
    const d = decide({ touch: at(0.5, 0.5), drawMode: true, selected: small })
    expect(d.kind).toBe('draw')
    if (d.kind !== 'draw') return
    expect(d.start.x).toBeCloseTo(0.5)
    expect(d.start.y).toBeCloseTo(0.5)
  })

  it('clamps a draw that starts on the letterbox bar to the frame edge', () => {
    const d = decide({ touch: { x: 200, y: 5 }, drawMode: true })
    expect(d).toMatchObject({ kind: 'draw', start: { y: 0 } })
  })

  it('resizes from a corner of the selected box, within a 44 pt target', () => {
    const corner = at(0.6, 0.6)
    const d = decide({ touch: { x: corner.x + 20, y: corner.y - 20 }, selected: small })
    expect(d).toMatchObject({ kind: 'edit', key: 'small', grab: { kind: 'corner', corner: 'se' } })
  })

  it('moves the selected box from its body', () => {
    const d = decide({ touch: at(0.5, 0.5), selected: small })
    expect(d).toMatchObject({ kind: 'edit', key: 'small', grab: { kind: 'body' }, base: small.bbox })
  })

  it('pans a zoomed picture when the finger is off the selected box', () => {
    const vp = { scale: 2, tx: 0, ty: 0 }
    const d = decide({ touch: at(0.15, 0.15, vp), selected: small, viewport: vp })
    expect(d).toEqual({ kind: 'view', start: vp })
  })

  it('does nothing at 1x off the selected box (a tap selects there instead)', () => {
    expect(decide({ touch: at(0.15, 0.15), selected: small })).toBe(NO_DRAG)
    expect(decide({ touch: at(0.5, 0.5) })).toBe(NO_DRAG)
  })

  it('never edits an UNSELECTED box: a zoomed drag on it pans', () => {
    const vp = { scale: 2, tx: 0, ty: 0 }
    expect(decide({ touch: at(0.5, 0.5, vp), viewport: vp }).kind).toBe('view')
  })

  it('does nothing before the layout is known', () => {
    expect(decide({ touch: { x: 10, y: 10 }, drawMode: true, img: null })).toBe(NO_DRAG)
  })
})

describe('dragStep — measured from touch-down, not from a runtime translation', () => {
  it('moves the box by the finger travel', () => {
    const d = decide({ touch: at(0.5, 0.5), selected: small })
    const down = at(0.5, 0.5)
    const step = dragStep(d, down, at(0.6, 0.55), IDENTITY_VIEWPORT, container, img)
    expect(step.kind).toBe('edit')
    if (step.kind !== 'edit') return
    expect(step.bbox.x).toBeCloseTo(0.5)
    expect(step.bbox.y).toBeCloseTo(0.45)
    expect(step.bbox.w).toBeCloseTo(0.2)
  })

  it('resizes the grabbed corner by the finger travel, not to the finger', () => {
    const corner = at(0.6, 0.6)
    const down = { x: corner.x + 10, y: corner.y + 10 }
    const d = decide({ touch: down, selected: small })
    const step = dragStep(d, down, at(0.7, 0.7), IDENTITY_VIEWPORT, container, img)
    if (step.kind !== 'edit') throw new Error('expected an edit')
    // The corner travelled (0.1, 0.1) less the 10 px it was grabbed off by.
    const off = screenToNorm({ x: corner.x + 10, y: corner.y + 10 }, IDENTITY_VIEWPORT, container, img)
    expect(step.bbox.x + step.bbox.w).toBeCloseTo(0.6 + (0.7 - off.x))
    expect(step.bbox.x).toBeCloseTo(0.4)
  })

  it('draws from the touch-down point to the finger, in any direction', () => {
    const d = decide({ touch: at(0.6, 0.6), drawMode: true })
    const step = dragStep(d, at(0.6, 0.6), at(0.3, 0.2), IDENTITY_VIEWPORT, container, img)
    if (step.kind !== 'draw') throw new Error('expected a draw')
    expect(step.box.x).toBeCloseTo(0.3)
    expect(step.box.y).toBeCloseTo(0.2)
    expect(step.box.w).toBeCloseTo(0.3)
    expect(step.box.h).toBeCloseTo(0.4)
  })

  it('pans a zoomed view by the finger travel', () => {
    const vp = { scale: 2, tx: 0, ty: 0 }
    const d = decide({ touch: { x: 200, y: 300 }, viewport: vp })
    const step = dragStep(d, { x: 200, y: 300 }, { x: 230, y: 310 }, vp, container, img)
    // The 16:9 picture is shorter than the container even at 2x: no vertical pan.
    expect(step).toEqual({ kind: 'view', viewport: { scale: 2, tx: 30, ty: 0 } })
  })

  it('a drag that was decided as nothing stays nothing', () => {
    expect(dragStep(NO_DRAG, { x: 0, y: 0 }, { x: 50, y: 50 }, IDENTITY_VIEWPORT, container, img)).toEqual({
      kind: 'none',
    })
  })
})

describe('committedDraw', () => {
  it('drops a drag too small to be a box', () => {
    expect(committedDraw({ x: 0.5, y: 0.5, w: 0.001, h: 0.2 })).toBeNull()
    expect(committedDraw(null)).toBeNull()
    expect(committedDraw({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
  })
})

describe('tapTarget', () => {
  it('selects the SMALLEST box under the finger', () => {
    expect(tapTarget([big, small], at(0.5, 0.5), IDENTITY_VIEWPORT, container, img)).toBe('small')
    expect(tapTarget([big, small], at(0.2, 0.2), IDENTITY_VIEWPORT, container, img)).toBe('big')
  })

  it('clears the selection on empty picture', () => {
    expect(tapTarget([big, small], at(0.05, 0.05), IDENTITY_VIEWPORT, container, img)).toBeNull()
  })

  it('hits through the zoom', () => {
    const vp = { scale: 3, tx: -40, ty: 20 }
    expect(tapTarget([big, small], at(0.5, 0.5, vp), vp, container, img)).toBe('small')
  })
})
