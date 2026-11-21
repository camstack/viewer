import { describe, expect, it } from 'vitest'
import {
  OVERLAY_DEFAULTS,
  placeOverlay,
  type OverlayItemId,
} from '../overlay-config.js'
import {
  DEFAULT_STACK_ORDER,
  STACK_GAP,
  buildStacks,
  cornerHeightShare,
  cornerWidthShare,
  orderStack,
  stackBox,
  stackDirection,
  stackItems,
} from '../overlay-stack.js'
import type { OverlayAnchor } from '../overlay-position.js'

const NO_DOORBELL = { hasDoorbell: false, deviceInfo: 'off' } as const
const INSET = { top: 8, bottom: 8, left: 8, right: 8 } as const

describe('what is placed by default', () => {
  it('the name is top-left; the control groups are bottom-left and bottom-right', () => {
    const items = stackItems(OVERLAY_DEFAULTS, NO_DOORBELL)
    const at = (id: OverlayItemId) => items.find((i) => i.id === id)?.anchor
    expect(at('cameraName')).toBe('top-left')
    expect(at('controlsLeft')).toBe('bottom-left')
    expect(at('controlsRight')).toBe('bottom-right')
    expect(at('audioMeter')).toBe('top-center')
  })

  it('an overlay that is off is not in any stack', () => {
    const ids = stackItems(placeOverlay(OVERLAY_DEFAULTS, 'cameraName', 'off'), NO_DOORBELL).map((i) => i.id)
    expect(ids).not.toContain('cameraName')
    expect(ids).not.toContain('stats')
  })

  it('the doorbell badge is offered only to a doorbell camera that switched it on', () => {
    const on = { ...OVERLAY_DEFAULTS, doorbell: true }
    expect(stackItems(on, NO_DOORBELL).map((i) => i.id)).not.toContain('doorbell')
    expect(stackItems(on, { ...NO_DOORBELL, hasDoorbell: true }).map((i) => i.id)).toContain('doorbell')
  })
})

describe('order inside one corner', () => {
  it('without a user order it is the default order', () => {
    const ids: OverlayItemId[] = ['viewers', 'stats', 'cameraName', 'occupancy']
    expect([...orderStack(ids, [])]).toEqual(['cameraName', 'stats', 'occupancy', 'viewers'])
  })

  it('the operator\'s order comes first, the rest follow by default', () => {
    const ids: OverlayItemId[] = ['cameraName', 'stats', 'occupancy', 'viewers']
    expect([...orderStack(ids, ['viewers', 'stats'])]).toEqual(['viewers', 'stats', 'cameraName', 'occupancy'])
  })

  it('ignores user-order ids that are not in this corner', () => {
    expect([...orderStack(['stats'], ['viewers', 'stats'])]).toEqual(['stats'])
  })

  it('pinned readouts follow the named overlays, in the order given', () => {
    const ids: OverlayItemId[] = ['readout:b', 'stats', 'readout:a']
    expect([...orderStack(ids, [])]).toEqual(['stats', 'readout:b', 'readout:a'])
  })

  it('placing an overlay later puts it after the ones placed before it', () => {
    let c = placeOverlay(OVERLAY_DEFAULTS, 'viewers', 'top-left')
    c = placeOverlay(c, 'stats', 'top-left')
    const stacks = buildStacks(stackItems(c, NO_DOORBELL), c.order)
    const topLeft = stacks.find((s) => s.anchor === 'top-left')
    // Placed order first (viewers, stats), then the default order (name).
    expect([...(topLeft?.ids ?? [])]).toEqual(['viewers', 'stats', 'cameraName'])
  })

  it('every id of the default order is unique', () => {
    expect(new Set(DEFAULT_STACK_ORDER).size).toBe(DEFAULT_STACK_ORDER.length)
  })
})

describe('stacks: one per anchor, nothing alone', () => {
  it('two overlays in one corner share ONE stack (no absolute pair to overlap)', () => {
    const c = placeOverlay(OVERLAY_DEFAULTS, 'stats', 'top-left')
    const stacks = buildStacks(stackItems(c, NO_DOORBELL), c.order)
    expect(stacks.filter((s) => s.anchor === 'top-left')).toHaveLength(1)
    expect([...(stacks.find((s) => s.anchor === 'top-left')?.ids ?? [])]).toEqual(['stats', 'cameraName'])
  })

  it('the two control groups can share a corner, controls first at the edge', () => {
    const c = { ...OVERLAY_DEFAULTS, controlsLeft: 'bottom-right' as const }
    const stacks = buildStacks(stackItems(c, NO_DOORBELL), c.order)
    const bottomRight = stacks.find((s) => s.anchor === 'bottom-right')
    expect([...(bottomRight?.ids ?? [])]).toEqual(['controlsLeft', 'controlsRight'])
    expect(stacks.some((s) => s.anchor === 'bottom-left')).toBe(false)
  })

  it('empty anchors have no stack', () => {
    const anchors = buildStacks(stackItems(OVERLAY_DEFAULTS, NO_DOORBELL), []).map((s) => s.anchor)
    expect(anchors.sort()).toEqual(['bottom-left', 'bottom-right', 'top-center', 'top-left'])
  })
})

describe('direction', () => {
  it('top anchors and the sides flow down, bottom anchors flow up', () => {
    const down: OverlayAnchor[] = ['top-left', 'top-center', 'top-right', 'left-center', 'right-center']
    const up: OverlayAnchor[] = ['bottom-left', 'bottom-center', 'bottom-right']
    for (const a of down) expect(stackDirection(a), a).toBe('down')
    for (const a of up) expect(stackDirection(a), a).toBe('up')
  })

  it('a bottom box reverses its column so the FIRST item sits on the edge', () => {
    const occupied = new Set<OverlayAnchor>(['bottom-left'])
    expect(stackBox('bottom-left', occupied, INSET).flexDirection).toBe('column-reverse')
    expect(stackBox('top-left', occupied, INSET).flexDirection).toBe('column')
  })

  it('stacked rows are separated by a gap, never touching', () => {
    expect(STACK_GAP).toBeGreaterThan(0)
    expect(stackBox('top-left', new Set<OverlayAnchor>(['top-left']), INSET).gap).toBe(STACK_GAP)
  })
})

describe('fitting: a phone portrait and a grid tile obey the same fractions', () => {
  it('a lone corner may use the whole band', () => {
    const only = new Set<OverlayAnchor>(['top-left'])
    expect(cornerWidthShare('top-left', only)).toBe(100)
    expect(cornerHeightShare('top-left', only)).toBe(100)
  })

  it('two corners on one edge get half the width each', () => {
    const both = new Set<OverlayAnchor>(['top-left', 'top-right'])
    expect(cornerWidthShare('top-left', both)).toBe(50)
    expect(cornerWidthShare('top-right', both)).toBe(50)
  })

  it('a third stack in the middle leaves 40% to each corner, and the centre 100% of its own box', () => {
    const three = new Set<OverlayAnchor>(['top-left', 'top-center', 'top-right'])
    expect(cornerWidthShare('top-left', three)).toBe(40)
    expect(cornerWidthShare('top-center', three)).toBe(100)
  })

  it('the default layout never lets the two bottom control stacks exceed the width', () => {
    const defaults = new Set(buildStacks(stackItems(OVERLAY_DEFAULTS, NO_DOORBELL), []).map((s) => s.anchor))
    const left = cornerWidthShare('bottom-left', defaults)
    const right = cornerWidthShare('bottom-right', defaults)
    expect(left + right).toBeLessThanOrEqual(100)
  })

  it('a corner with a stack on the opposite edge of its side gets half the height', () => {
    const both = new Set<OverlayAnchor>(['top-left', 'bottom-left'])
    expect(cornerHeightShare('top-left', both)).toBe(50)
    expect(cornerHeightShare('bottom-left', both)).toBe(50)
  })

  it('the box clips instead of overflowing onto a neighbour', () => {
    const box = stackBox('top-left', new Set<OverlayAnchor>(['top-left', 'top-right']), INSET)
    expect(box.overflow).toBe('hidden')
    expect(box.maxWidth).toBe('50%')
    expect(box.maxHeight).toBe('100%')
  })

  it('every box sits on its own edges only, at the inset', () => {
    const all = new Set<OverlayAnchor>(['top-left'])
    expect(stackBox('top-left', all, INSET)).toMatchObject({ top: 8, left: 8 })
    expect(stackBox('bottom-right', all, INSET)).toMatchObject({ bottom: 8, right: 8 })
    expect(stackBox('top-left', all, INSET).bottom).toBeUndefined()
  })
})
