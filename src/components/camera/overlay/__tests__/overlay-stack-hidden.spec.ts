/**
 * @vitest-environment jsdom
 *
 * The REAL OverlayStack (planning#751): a hidden entry is drawn with
 * `display: none` where it stands, and a fade toggle keeps the node mounted,
 * so its state survives.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { OverlayStack, type OverlayStackEntry } from '../OverlayStack.js'
import { OVERLAY_DEFAULTS } from '../overlay-config.js'

const mounts = { n: 0 }

function Counter(): React.JSX.Element {
  const [n, setN] = React.useState(0)
  React.useEffect(() => {
    mounts.n += 1
  }, [])
  return React.createElement('button', { 'data-testid': 'counter', onClick: () => setN((v) => v + 1) }, String(n))
}

const entry = (hidden: boolean): OverlayStackEntry => ({
  id: 'audioMeter',
  anchor: 'top-right',
  hidden,
  node: React.createElement(Counter),
})

function hiddenAncestor(el: HTMLElement): boolean {
  for (let cur: HTMLElement | null = el; cur !== null; cur = cur.parentElement) {
    if (cur.style.display === 'none' || getComputedStyle(cur).display === 'none') return true
  }
  return false
}

afterEach(() => {
  cleanup()
  mounts.n = 0
})

describe('OverlayStack hidden entries', () => {
  it('draws a hidden entry with display none, and a shown one without', () => {
    const hidden = render(React.createElement(OverlayStack, { entries: [entry(true)], userOrder: OVERLAY_DEFAULTS.order }))
    expect(hiddenAncestor(hidden.getByTestId('counter'))).toBe(true)
    cleanup()
    const shown = render(React.createElement(OverlayStack, { entries: [entry(false)], userOrder: OVERLAY_DEFAULTS.order }))
    expect(hiddenAncestor(shown.getByTestId('counter'))).toBe(false)
  })

  it('a fade toggle keeps the node mounted and its state', () => {
    const { getByTestId, rerender } = render(
      React.createElement(OverlayStack, { entries: [entry(false)], userOrder: OVERLAY_DEFAULTS.order }),
    )
    fireEvent.click(getByTestId('counter'))
    expect(getByTestId('counter').textContent).toBe('1')
    rerender(React.createElement(OverlayStack, { entries: [entry(true)], userOrder: OVERLAY_DEFAULTS.order }))
    expect(hiddenAncestor(getByTestId('counter'))).toBe(true)
    rerender(React.createElement(OverlayStack, { entries: [entry(false)], userOrder: OVERLAY_DEFAULTS.order }))
    expect(getByTestId('counter').textContent).toBe('1')
    expect(mounts.n).toBe(1)
  })
})
