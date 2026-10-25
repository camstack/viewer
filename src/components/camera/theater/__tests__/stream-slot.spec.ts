import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { streamSlotStyle, STREAM_SLOT_Z } from '../stream-slot.js'
import { DRAWER_OVERLAY_Z } from '../landscape-drawer-geometry.js'
import type { DetailLayoutMode } from '../../../../screens/camera-detail/detail-layout.js'

const SHAPES: readonly DetailLayoutMode[] = ['fill', 'wide', 'stack']

/**
 * The stream slot is the ONE parent the player has in every layout, so its box
 * is not optional.
 *
 * `TheaterTimeline` used to render it as `shape === 'wide' ? wideColumn : null`.
 * A `null` style is a View with no flex and no height: in `fill` its only child
 * is `videoWrapFull` (`StyleSheet.absoluteFill`), which is out of flow, so the
 * slot measured 900x0 on a 900x500 window — verified in a browser on
 * 2026-08-08. Nothing showed the fault only because the screen ALSO writes an
 * animated `height` onto the player, so the picture sized itself while its
 * parent stayed collapsed. Every geometry derived from the slot instead of from
 * that animated value — the recorded `<canvas>` fit box, the gesture catcher,
 * the zone-draw overlay — sits on a box of zero height until the animation
 * writes one.
 */
describe('the stream slot has a real box in every shape', () => {
  it.each(SHAPES)('%s resolves to a style object, never null', (shape) => {
    const style = streamSlotStyle(shape)
    expect(style).toBeTypeOf('object')
    expect(style).not.toBeNull()
  })

  it('fill gives the slot the whole column, so an absolute child has a box', () => {
    expect(streamSlotStyle('fill').flex).toBe(1)
  })

  it('wide keeps the picture column beside the rail', () => {
    const wide = streamSlotStyle('wide')
    expect(wide.flex).toBe(1)
    expect(wide.minWidth).toBe(0)
  })

  it('stack stays plain flow — the layout that rendered correctly for years', () => {
    const stack = streamSlotStyle('stack')
    expect(stack.flex).toBeUndefined()
    expect(stack.width).toBe('100%')
  })

  it('the slot carries the picture z-order, and the drawer out-ranks it', () => {
    // The zIndex used to live on `videoWrapFull`, INSIDE the slot, where it
    // ranks the player against its own (non-existent) siblings and cannot
    // out-rank anything in the timeline column. The comparison that matters is
    // slot vs drawer overlay, and both numbers are now exported.
    expect(streamSlotStyle('fill').zIndex).toBe(STREAM_SLOT_Z)
    expect(STREAM_SLOT_Z).toBeLessThan(DRAWER_OVERLAY_Z)
  })
})

describe('the OFF state of the timeline toggle', () => {
  it('the stacked slot stops being sized by its child and takes the column', () => {
    // Chrome shown, `stack`'s slot has no height of its own — the picture (or,
    // on the grid page, the wall) supplies it. Hidden, there is nothing below
    // to take the rest, so a slot that kept that shape would draw the picture
    // at its old height over an empty band.
    expect(streamSlotStyle('stack').flex).toBeUndefined()
    expect(streamSlotStyle('stack', true).flex).toBe(1)
    expect(streamSlotStyle('stack', true).minHeight).toBe(0)
    expect(streamSlotStyle('stack', true).width).toBe('100%')
  })

  it('`wide` needs no second shape — the rail is out of flow and flex takes the row', () => {
    expect(streamSlotStyle('wide', true)).toEqual(streamSlotStyle('wide'))
  })

  it('shown is the default, so camera-detail is untouched by the argument', () => {
    for (const shape of ['wide', 'stack', 'fill'] as const) {
      expect(streamSlotStyle(shape, false), shape).toEqual(streamSlotStyle(shape))
    }
  })
})

describe('the component uses it', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
    'utf8',
  )

  it('TheaterTimeline styles the slot from this module, chrome state included', () => {
    expect(src).toContain('streamSlotStyle(shape, chromeHidden)')
  })

  it('no shape falls through to a null style again', () => {
    expect(src).not.toContain("shape === 'wide' ? styles.wideStreamColumn : null")
  })
})
