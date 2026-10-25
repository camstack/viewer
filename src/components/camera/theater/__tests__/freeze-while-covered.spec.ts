/**
 * @vitest-environment jsdom
 *
 * FreezeWhileCovered — the subtree keeps its INSTANCE (mounted state survives)
 * but stops reconciling while `frozen`, and catches up in one render when
 * uncovered. This is what lets a panel cover the timeline without unmounting
 * it: scroll offset and zoom survive, and the covered timeline does not
 * re-render on every live-edge tick underneath a surface nobody can see.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React, { useEffect } from 'react'

import { FreezeWhileCovered } from '../FreezeWhileCovered.js'

afterEach(cleanup)

const renderSpy = vi.fn<(value: number) => void>()
const unmountSpy = vi.fn<() => void>()

function Probe({ value }: { readonly value: number }): React.ReactElement {
  renderSpy(value)
  useEffect(() => unmountSpy, [])
  return React.createElement('div', { 'data-testid': 'probe' }, String(value))
}

function frame(frozen: boolean, value: number): React.ReactElement {
  return React.createElement(FreezeWhileCovered, {
    frozen,
    children: React.createElement(Probe, { value }),
  })
}

describe('FreezeWhileCovered', () => {
  it('renders its child normally while not frozen', () => {
    renderSpy.mockClear()
    const { getByTestId, rerender } = render(frame(false, 1))
    expect(getByTestId('probe').textContent).toBe('1')
    rerender(frame(false, 2))
    expect(getByTestId('probe').textContent).toBe('2')
  })

  it('stops reconciling the child while frozen — no render, stale content kept', () => {
    renderSpy.mockClear()
    const { getByTestId, rerender } = render(frame(false, 1))
    rerender(frame(true, 2))
    rerender(frame(true, 3))
    expect(getByTestId('probe').textContent).toBe('1')
    expect(renderSpy.mock.calls.map(([v]) => v)).toEqual([1])
  })

  it('never unmounts the child while frozen, and catches up when uncovered', () => {
    renderSpy.mockClear()
    unmountSpy.mockClear()
    const { getByTestId, rerender } = render(frame(false, 1))
    rerender(frame(true, 2))
    expect(unmountSpy).not.toHaveBeenCalled()
    rerender(frame(false, 4))
    expect(getByTestId('probe').textContent).toBe('4')
    expect(unmountSpy).not.toHaveBeenCalled()
  })
})
