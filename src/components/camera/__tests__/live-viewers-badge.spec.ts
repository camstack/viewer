/**
 * @vitest-environment jsdom
 *
 * The live-viewers overlay: an eye and a number, absent when empty OR unknown.
 *
 * An unanswered question must never read as "nobody is watching" — a hub that
 * predates the method (the call throws NOT_FOUND), a failed call and a camera
 * the hub left out of a SUCCESSFUL answer are three different things, and only
 * the last is a zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { LiveViewersBadge } from '../LiveViewersBadge.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const PATH = 'streamBroker.getLiveViewerCounts'

function badge(position: 'top-left' | 'off' = 'top-left', enabled = true): React.ReactElement {
  return React.createElement(LiveViewersBadge, { deviceId: 7, position, enabled })
}

/** The hub was asked AND its answer has been through the hook and rendered —
 *  without the settle, "draws nothing" would pass before anything could draw. */
async function asked(): Promise<void> {
  await waitFor(() => expect(hubCalls().some((c) => c.path === PATH)).toBe(true))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

describe('LiveViewersBadge', () => {
  it('shows the count of this camera, with an accessible label', async () => {
    mountScreen(badge(), {
      hub: {
        [PATH]: [
          { deviceId: 7, viewers: 3 },
          { deviceId: 9, viewers: 1 },
        ],
      },
    })
    const el = await screen.findByTestId('live-viewers-badge')
    expect(el.textContent).toBe('3')
    expect(screen.getByLabelText('3 people watching live')).toBeTruthy()
  })

  it('uses the singular for one viewer', async () => {
    mountScreen(badge(), { hub: { [PATH]: [{ deviceId: 7, viewers: 1 }] } })
    await screen.findByTestId('live-viewers-badge')
    expect(screen.getByLabelText('1 person watching live')).toBeTruthy()
  })

  it('draws nothing for a camera the hub left out of a successful answer (a real zero)', async () => {
    mountScreen(badge(), { hub: { [PATH]: [{ deviceId: 9, viewers: 2 }] } })
    await asked()
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
  })

  it('draws nothing while the answer is an empty list', async () => {
    mountScreen(badge(), { hub: { [PATH]: [] } })
    await asked()
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
  })

  it('draws nothing on a hub without the method (unknown, not zero)', async () => {
    mountScreen(badge())
    await asked()
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
  })

  it('draws nothing when the answer is not a list', async () => {
    mountScreen(badge(), { hub: { [PATH]: { oops: true } } })
    await asked()
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
  })

  it('does not even ask the hub while it is switched off', () => {
    mountScreen(badge('off'), { hub: { [PATH]: [{ deviceId: 7, viewers: 5 }] } })
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
    expect(hubCalls().some((c) => c.path === PATH)).toBe(false)
  })

  it('does not ask while the picture is not live', () => {
    mountScreen(badge('top-left', false), { hub: { [PATH]: [{ deviceId: 7, viewers: 5 }] } })
    expect(screen.queryByTestId('live-viewers-badge')).toBeNull()
    expect(hubCalls().some((c) => c.path === PATH)).toBe(false)
  })
})
