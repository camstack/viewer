/**
 * @vitest-environment jsdom
 *
 * The quick-run pill, mounted over the real hooks with only the wire faked:
 * visibility, run, cancel + remaining time, and a refusal said in words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../../testing/platform-control.js'
import { TimedRunControl } from '../TimedRunControl.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const DEVICE = 5391

function calls(path: string): readonly unknown[] {
  return hubCalls().filter((c) => c.path === path).map((c) => c.input)
}

function mount(hub: Readonly<Record<string, unknown>>) {
  return mountScreen(React.createElement(TimedRunControl, { deviceId: DEVICE, online: true }), { hub })
}

describe('TimedRunControl', () => {
  it('idle: one tap runs the stored quick run', async () => {
    mount({
      'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
      'timedRun.runFor': { ok: true, activeUntil: 1 },
    })
    const btn = await dom.findByRole('button', { name: 'Run 30 min' })
    await act(async () => { fireEvent.click(btn) })
    await vi.waitFor(() => expect(calls('timedRun.runFor')).toEqual([{ deviceId: DEVICE, duration: 30, unit: 'min' }]))
  })

  it('quickRun null renders no button', async () => {
    const view = mount({ 'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: null, lastFetchedAt: 1 } })
    await vi.waitFor(() => expect(calls('timedRun.getStatus').length).toBeGreaterThan(0))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(dom.queryByRole('button')).toBeNull()
    view.unmount()
  })

  it('armed: shows the time left and cancel forgets the pending off', async () => {
    mount({
      'timedRun.getStatus': {
        activeUntil: Date.now() + 723_000, requestedBy: 'u', quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1,
      },
      'timedRun.cancel': undefined,
    })
    const btn = await dom.findByRole('button', { name: /^Cancel · 12:0\d left$/ })
    await act(async () => { fireEvent.click(btn) })
    await vi.waitFor(() => expect(calls('timedRun.cancel')).toEqual([{ deviceId: DEVICE }]))
    expect(calls('timedRun.runFor')).toEqual([])
  })

  it('a cancel the hub throws on is said in a notice', async () => {
    setTestPlatform('web')
    mount({
      'timedRun.getStatus': {
        activeUntil: Date.now() + 600_000, requestedBy: 'u', quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1,
      },
      'timedRun.cancel': () => { throw new Error('boom') },
    })
    await act(async () => { fireEvent.click(await dom.findByRole('button', { name: /^Cancel · / })) })
    await dom.findByText('The timer is still running.')
  })

  it('an expired deadline still marked armed shows idle', async () => {
    mount({
      'timedRun.getStatus': { activeUntil: Date.now() - 5_000, requestedBy: 'u', quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
    })
    await dom.findByRole('button', { name: 'Run 30 min' })
  })

  it('a refusal is shown with its reason', async () => {
    setTestPlatform('web')
    mount({
      'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
      'timedRun.runFor': { ok: false, reason: 'over-max', maxSeconds: 600 },
    })
    await act(async () => { fireEvent.click(await dom.findByRole('button', { name: 'Run 30 min' })) })
    await dom.findByText('That is longer than this device may run.')
  })
})
