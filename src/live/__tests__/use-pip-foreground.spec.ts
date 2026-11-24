/**
 * @vitest-environment jsdom
 *
 * The PiP-aware foreground return, driven through the real hook with fake
 * timers and a fake AppState. `pip-foreground.spec.ts` pins the pure gate;
 * this pins the wiring that spec cannot see — above all that a change of
 * `onPeerReconnect` identity while the restore is pending does not drop it.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (next: string) => void
const listeners = new Set<Listener>()
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_: string, cb: Listener) => {
      listeners.add(cb)
      return { remove: () => listeners.delete(cb) }
    },
  },
}))
vi.mock('../../lib/logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { usePipForeground } from '../use-pip-foreground.js'
import { PIP_RESTORE_FALLBACK_MS, PIP_RESTORE_SETTLE_MS } from '../pip-foreground.js'

const emit = (next: string): void => {
  for (const l of [...listeners]) l(next)
}

function mount(playerState = 'connecting') {
  const reconnect = vi.fn()
  const exitPip = vi.fn()
  const peer1 = vi.fn()
  const hook = renderHook(
    (p: { onPeerReconnect: () => void; playerState: string }) =>
      usePipForeground({ deviceId: 7, playerState: p.playerState, reconnect, onPeerReconnect: p.onPeerReconnect, exitPip }),
    { initialProps: { onPeerReconnect: peer1, playerState } },
  )
  return { hook, reconnect, exitPip, peer1 }
}

const backgroundThenForeground = (): void => {
  act(() => emit('background'))
  act(() => emit('active'))
}

describe('usePipForeground', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listeners.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('PiP up: waits for the inline report, then reconnects once after the settle', () => {
    const { hook, reconnect, exitPip } = mount()
    act(() => hook.result.current.noteMode('picture-in-picture'))
    backgroundThenForeground()
    expect(exitPip).toHaveBeenCalledTimes(1)
    expect(reconnect).not.toHaveBeenCalled()
    act(() => hook.result.current.noteMode('inline'))
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_SETTLE_MS - 1))
    expect(reconnect).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(reconnect).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_FALLBACK_MS))
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('no inline report: the fallback reconnects once', () => {
    const { hook, reconnect } = mount()
    act(() => hook.result.current.noteMode('picture-in-picture'))
    backgroundThenForeground()
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_FALLBACK_MS - 1))
    expect(reconnect).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('a new onPeerReconnect identity while pending does not cancel the restore', () => {
    const { hook, reconnect, peer1 } = mount()
    act(() => hook.result.current.noteMode('picture-in-picture'))
    backgroundThenForeground()
    const peer2 = vi.fn()
    hook.rerender({ onPeerReconnect: peer2, playerState: 'connecting' })
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_FALLBACK_MS))
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(peer1).not.toHaveBeenCalled()
    expect(peer2).toHaveBeenCalledTimes(1)
  })

  it('unmount while pending cancels the restore', () => {
    const { hook, reconnect } = mount()
    act(() => hook.result.current.noteMode('picture-in-picture'))
    backgroundThenForeground()
    hook.unmount()
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_FALLBACK_MS))
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('cold foreground without PiP reconnects immediately', () => {
    const { reconnect, exitPip, peer1 } = mount()
    backgroundThenForeground()
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(peer1).toHaveBeenCalledTimes(1)
    expect(exitPip).not.toHaveBeenCalled()
  })

  it('a stream still playing after PiP closed is not rebuilt', () => {
    const { hook, reconnect, peer1 } = mount('playing')
    act(() => hook.result.current.noteMode('picture-in-picture'))
    backgroundThenForeground()
    act(() => hook.result.current.noteMode('inline'))
    act(() => void vi.advanceTimersByTime(PIP_RESTORE_SETTLE_MS))
    expect(reconnect).not.toHaveBeenCalled()
    expect(peer1).toHaveBeenCalledTimes(1)
  })

  it('resetMode forgets a PiP the page no longer shows', () => {
    const { hook, reconnect, exitPip } = mount()
    act(() => hook.result.current.noteMode('picture-in-picture'))
    act(() => hook.result.current.resetMode())
    backgroundThenForeground()
    expect(exitPip).not.toHaveBeenCalled()
    expect(reconnect).toHaveBeenCalledTimes(1)
  })
})
