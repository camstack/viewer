/**
 * @vitest-environment jsdom
 *
 * Back in an embedded app: the frame's REAL history decides (planning#763). A frame that
 * moved stays where it is; one that did not falls back to the shell's own back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { resetRouterStub, routerCalls, setTestCanGoBack } from '../../testing/native-stubs/expo-router.js'
import { FRAME_BACK_WAIT_MS, goBackInFrame } from '../frame-back.js'
import { frameController } from '../frame-controller.js'
import { AppTopStrip } from '../AppTopStrip.js'

vi.mock('../../connection/ConnectionProvider.js', async () => (await import('../../testing/connection-stub.js')).connectionStubModule())

afterEach(cleanup)

describe('the frame controller', () => {
  it('says what the frame reported, and false with no frame or a refusing one', async () => {
    expect(await frameController.back()).toBe(false)
    const release = frameController.attach(() => Promise.resolve(true))
    expect(await frameController.back()).toBe(true)
    release()
    const refuse = frameController.attach(() => Promise.reject(new Error('cross-origin')))
    expect(await frameController.back()).toBe(false)
    refuse()
  })
})

describe('goBackInFrame', () => {
  type Fake = Window & { _pop: () => void }
  function fakeFrame(opts: { canGoBack?: boolean; onBack: (frame: { href: string }, pop: () => void) => void }): Fake {
    const listeners = new Set<() => void>()
    const loc = { href: 'http://hub/a' }
    const pop = (): void => listeners.forEach((l) => l())
    const frame = {
      navigation: opts.canGoBack === undefined ? undefined : { canGoBack: opts.canGoBack },
      location: loc,
      history: { back: () => opts.onBack(loc, pop) },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      _pop: pop,
    }
    return frame as unknown as Fake
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('moved: a popstate arrives', async () => {
    const result = goBackInFrame(fakeFrame({ onBack: (_l, pop) => pop() }))
    expect(await result).toBe(true)
  })
  it('moved: the location changed without a popstate', async () => {
    const result = goBackInFrame(fakeFrame({ onBack: (l) => (l.href = 'http://hub/prev') }))
    await vi.advanceTimersByTimeAsync(FRAME_BACK_WAIT_MS)
    expect(await result).toBe(true)
  })
  it('not moved: nothing happens within the wait (a root, or a redirect that left no entry)', async () => {
    const result = goBackInFrame(fakeFrame({ onBack: () => undefined }))
    await vi.advanceTimersByTimeAsync(FRAME_BACK_WAIT_MS)
    expect(await result).toBe(false)
  })
  it('not moved, and never called, when the Navigation API says there is nothing to go back to', async () => {
    const back = vi.fn()
    expect(await goBackInFrame(fakeFrame({ canGoBack: false, onBack: back }))).toBe(false)
    expect(back).not.toHaveBeenCalled()
  })
  it('not moved when access is refused or there is no frame', async () => {
    const refusing = { get location(): never { throw new Error('cross-origin') } } as unknown as Window
    expect(await goBackInFrame(refusing)).toBe(false)
    expect(await goBackInFrame(null)).toBe(false)
  })
})

describe('the top strip Back', () => {
  beforeEach(() => resetRouterStub())
  const strip = () => mountScreen(React.createElement(AppTopStrip, { title: 'Admin', local: true, onMenu: () => undefined }))

  it('a frame that moved back keeps the shell where it is', async () => {
    const back = vi.fn(() => Promise.resolve(true))
    const release = frameController.attach(back)
    const view = strip()
    fireEvent.click(view.getByTestId('app-strip-back'))
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(routerCalls()).toEqual([])
    release()
  })

  it('a frame that did not move falls back to the shell back, then to the Cameras tab', async () => {
    const release = frameController.attach(() => Promise.resolve(false))
    const view = strip()
    fireEvent.click(view.getByTestId('app-strip-back'))
    await waitFor(() => expect(routerCalls().map((c) => c.kind)).toEqual(['back']))
    setTestCanGoBack(false)
    fireEvent.click(view.getByTestId('app-strip-back'))
    await waitFor(() => expect(routerCalls().map((c) => c.kind)).toContain('replace'))
    release()
  })

  it('puts Back to the right of the menu button', () => {
    const view = strip()
    const menu = view.getByTestId('app-strip-menu')
    const back = view.getByTestId('app-strip-back')
    expect(menu.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
