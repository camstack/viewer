// @vitest-environment jsdom
/**
 * The wiring half of the background close — the half that gets it wrong.
 *
 * Two questions this file answers and nothing else can: does the app close its
 * socket when it actually LEAVES, and does it leave one alone when it is
 * merely obscured (Control Centre, the notification shade, an incoming call)?
 * Both are `AppState` statuses, and the second one arrives far more often than
 * the first.
 */
import React from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { emitAppState, setTestAppState } from '../../testing/app-state-control.js'

import { AppPhaseTracer } from '../AppPhaseTracer.js'

const { controller } = vi.hoisted(() => ({
  controller: {
    suspendForBackground: vi.fn(() => 'suspend'),
    handleForeground: vi.fn(async (_awayMs: number | null) => 'resumed'),
    isSuspended: vi.fn(() => false),
  },
}))

vi.mock('../ConnectionProvider.js', () => ({
  useConnection: () => ({ controller, state: 'connected', startingUp: false }),
}))

function mountTracer(): void {
  setTestAppState('active')
  render(React.createElement(AppPhaseTracer))
}

beforeEach(() => {
  controller.suspendForBackground.mockClear()
  controller.handleForeground.mockClear()
})

afterEach(() => {
  cleanup()
  setTestAppState('active')
})

describe('AppPhaseTracer', () => {
  it('closes the socket when the app goes to the background', () => {
    mountTracer()
    act(() => emitAppState('background'))
    expect(controller.suspendForBackground).toHaveBeenCalledTimes(1)
  })

  it('leaves the socket alone while the app is only obscured', () => {
    mountTracer()
    // The iOS shapes: an app-switcher peek, Control Centre, an incoming call.
    act(() => emitAppState('inactive'))
    expect(controller.suspendForBackground).not.toHaveBeenCalled()
  })

  it('closes once for the iOS `inactive` → `background` pair', () => {
    mountTracer()
    act(() => emitAppState('inactive'))
    act(() => emitAppState('background'))
    expect(controller.suspendForBackground).toHaveBeenCalledTimes(1)
  })

  it('hands the return to the controller, with how long the app was away', () => {
    mountTracer()
    act(() => emitAppState('inactive'))
    act(() => emitAppState('background'))
    act(() => emitAppState('active'))
    expect(controller.handleForeground).toHaveBeenCalledTimes(1)
    const awayMs = controller.handleForeground.mock.calls[0]?.[0]
    expect(typeof awayMs).toBe('number')
  })

  it('asks on a return that never closed anything, too', () => {
    mountTracer()
    act(() => emitAppState('inactive'))
    act(() => emitAppState('active'))
    expect(controller.suspendForBackground).not.toHaveBeenCalled()
    expect(controller.handleForeground).toHaveBeenCalledTimes(1)
  })

  it('stops listening when it unmounts', () => {
    mountTracer()
    cleanup()
    act(() => emitAppState('background'))
    expect(controller.suspendForBackground).not.toHaveBeenCalled()
  })
})
