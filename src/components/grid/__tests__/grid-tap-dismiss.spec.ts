/**
 * @vitest-environment jsdom
 *
 * The layer that turns a tap on the wall into a dismissal.
 *
 * The two things that make it correct rather than merely present:
 *  • with nothing open it is NOT IN THE TREE, so it cannot eat a tile press,
 *    a long-press or a pinch;
 *  • a tap on it dismisses, and does so through `onPress` — the activation
 *    keyboards and assistive tech also produce.
 *
 * The DRAG rule is NOT replayable here and is deliberately not asserted below.
 * react-native-web resolves `onPressIn` at the position of the last pointer
 * event it saw, so a mousedown-move-mouseup in jsdom reports BOTH endpoints at
 * the move's coordinates: every drag looks like a tap in this harness, and an
 * assertion to the contrary would pass for the wrong reason. The rule itself is
 * pinned on `isDismissTap` in `grid/__tests__/panel-dismiss.spec.ts`, where the
 * endpoints are the input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import React from 'react'

import { GridTapDismiss, GRID_TAP_DISMISS_TEST_ID } from '../GridTapDismiss.js'

afterEach(cleanup)

interface Mounted {
  readonly layer: Element
  readonly onDismiss: ReturnType<typeof vi.fn>
}

function mount(active: boolean): { readonly layer: Element | null; readonly onDismiss: Mounted['onDismiss'] } {
  const onDismiss = vi.fn()
  const { container } = render(
    React.createElement(GridTapDismiss, { active, onDismiss, accessibilityLabel: 'Close' }),
  )
  return { layer: container.querySelector(`[data-testid="${GRID_TAP_DISMISS_TEST_ID}"]`), onDismiss }
}

/** One press in place, through the responder the layer uses. */
function tap(layer: Element, x: number, y: number): void {
  fireEvent.mouseDown(layer, { clientX: x, clientY: y, button: 0 })
  fireEvent.mouseUp(layer, { clientX: x, clientY: y, button: 0 })
  fireEvent.click(layer, { clientX: x, clientY: y })
}

describe('GridTapDismiss', () => {
  it('renders NOTHING while no panel is open', () => {
    const { layer, onDismiss } = mount(false)
    expect(layer).toBeNull()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('a tap dismisses, once', () => {
    const { layer, onDismiss } = mount(true)
    expect(layer).not.toBeNull()
    tap(layer!, 120, 240)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('carries an accessible close label', () => {
    const { layer } = mount(true)
    expect(layer!.getAttribute('aria-label')).toBe('Close')
  })
})
