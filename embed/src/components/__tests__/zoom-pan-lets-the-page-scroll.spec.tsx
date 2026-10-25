/**
 * At rest, a tile does not own the page's scroll gesture.
 *
 * ## The report this closes (operator, 2026-09-16)
 *
 * "lo scrolling non e' funzionante su mobile" — on the Home Assistant card,
 * which frames this embed. Two hypotheses were falsified before this one: the
 * card's `overflow` is correct, and the card binds no touch handler. The
 * gesture is eaten by the framed document, here.
 *
 * `ZoomPan` declared `touch-action: none` on its container unconditionally and
 * captured the pointer on every `pointerdown`. So one finger anywhere on a tile
 * belonged to it — on the phone, that is every finger, because a tile is the
 * whole card.
 *
 * And it did nothing with it. The single-pointer branch of `onPointerMove`
 * pans only `if (scale.current > 1)`: at rest the component consumed a gesture
 * it had already decided to ignore. That is the whole defect — not a tuning
 * question, a claim the component does not act on.
 *
 * `pan-y` and not `manipulation`: it lets the browser scroll vertically AND,
 * by omission, forbids the browser's own pinch-zoom, which we implement
 * ourselves from the pointer stream. The embed's viewport is user-scalable, so
 * a value that permitted `pinch-zoom` would zoom the whole page instead.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ZoomPan, touchActionForScale } from '../ZoomPan'

afterEach(cleanup)

describe('touchActionForScale', () => {
  it('leaves the page its gesture while the tile is at rest', () => {
    expect(touchActionForScale(1)).toBe('pan-y')
  })

  it('takes every gesture once zoomed — there, one finger IS the pan', () => {
    expect(touchActionForScale(1.4)).toBe('none')
    expect(touchActionForScale(4)).toBe('none')
  })

  it('treats a scale below 1 as at rest rather than as zoomed', () => {
    // Clamping keeps it at 1, but a comparison written the other way round
    // would hand a degenerate value the whole gesture.
    expect(touchActionForScale(0.5)).toBe('pan-y')
  })
})

describe('the mounted tile', () => {
  it('starts without claiming the scroll', () => {
    // The unit above pins the rule; this pins that the component USES it. The
    // style is written imperatively (scale lives in a ref, so a re-render is
    // not what applies it) and that is exactly the wiring a refactor drops.
    const { container } = render(
      <ZoomPan onTap={() => undefined}>
        <div data-testid="tile" />
      </ZoomPan>,
    )
    const outer = container.firstElementChild as HTMLElement | null
    expect(outer).not.toBeNull()
    expect(outer?.style.touchAction).toBe('pan-y')
  })
})
