/**
 * @vitest-environment jsdom
 *
 * Starting a download is acknowledged by the Activity button: adding a running
 * activity puts it in its start-of-operation state; an old one, a finished
 * one, or one already pulsed for does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup } from '@testing-library/react'

import { mountScreen } from '../../testing/mount.js'
import { useActivityStore } from '../activity-instance.js'
import { snapshotItemFrom, type ActivityItem } from '../activity-model.js'
import { queuedJob } from '../activity-jobs.js'
import { ActivityButton, ACTIVITY_START_PULSE_TEST_ID } from '../ActivityButton.js'
import { START_FRESH_MS, START_PULSE_MS, justStartedId } from '../activity-start-pulse.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useActivityStore.setState({ items: [] })
})

function job(id: string, now: number): ActivityItem {
  return queuedJob({ id, jobKind: 'face-assign', title: 'Export', now })
}

describe('justStartedId', () => {
  it('names the newest running item that was just created', () => {
    const items = [job('job:a', 1_000), job('job:b', 1_500)]
    expect(justStartedId(items, 2_000)).toBe('job:b')
  })

  it('ignores an item older than the freshness window (a restored list)', () => {
    expect(justStartedId([job('job:a', 1_000)], 1_000 + START_FRESH_MS + 1)).toBeNull()
  })

  it('ignores an item that is not running', () => {
    const snap = snapshotItemFrom({ uid: 'u', deviceId: 1, cameraName: 'Door', atMs: 1, fileUri: 'file:///a.jpg', mime: 'image/jpeg', now: 1_000 })
    expect(justStartedId([snap], 1_100)).toBeNull()
  })
})

describe('the Activity button', () => {
  it('is in its start state when an activity is added, and leaves it after the pulse', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    mountScreen(React.createElement(ActivityButton))
    expect(document.body.querySelector(`[data-testid="${ACTIVITY_START_PULSE_TEST_ID}"]`)).toBeNull()

    await act(async () => {
      useActivityStore.getState().add(job('job:1', Date.now()))
    })
    expect(document.body.querySelector(`[data-testid="${ACTIVITY_START_PULSE_TEST_ID}"]`)).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(START_PULSE_MS + 50)
    })
    expect(document.body.querySelector(`[data-testid="${ACTIVITY_START_PULSE_TEST_ID}"]`)).toBeNull()
  })

  it('does not pulse for an activity that was already old when it appeared', async () => {
    mountScreen(React.createElement(ActivityButton))
    await act(async () => {
      useActivityStore.getState().add(job('job:old', Date.now() - START_FRESH_MS - 10_000))
    })
    expect(document.body.querySelector(`[data-testid="${ACTIVITY_START_PULSE_TEST_ID}"]`)).toBeNull()
  })
})
