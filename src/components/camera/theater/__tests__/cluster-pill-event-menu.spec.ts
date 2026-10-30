/**
 * @vitest-environment jsdom
 *
 * Keeping an event: the cluster card has NO download control of its own; a long
 * press on a member pill opens the event menu, and the track detail's Download
 * opens that same menu. A tap still seeks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../../testing/platform-control.js'
import { useActivityStore } from '../../../../activity/activity-instance.js'
import { ClusterCard } from '../ClusterCard.js'
import { HOLD_MS } from '../ClusterPill.js'
import {
  EVENT_ACTION_CLIP_TEST_ID,
  EVENT_ACTION_KEYFRAME_TEST_ID,
  EVENT_ACTION_SNAPSHOT_TEST_ID,
} from '../../../events/EventActionMenu.js'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

beforeAll(() => setTestPlatform('web'))
afterAll(() => setTestPlatform('ios'))
afterEach(cleanup)

const START = Date.parse('2026-09-07T10:00:00Z')
const END = START + 12_000
const EVENT: ObjectEvent = {
  id: 'e1',
  deviceId: 7,
  trackId: 't1',
  className: 'person',
  timestamp: START,
  endTimestamp: END,
}
const MANIFEST = [
  { mediaId: 2, url: 'm/2', kind: 'keyFrame', sizeBytes: 411_002, timestamp: START },
  { mediaId: 3, url: 'm/3', kind: 'keyFrameSmall', sizeBytes: 41_002, timestamp: START },
]

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

function card(onPress: () => void) {
  const [cluster] = clusterByZoom([EVENT], { topMs: START + 1_000, zoomIndex: 0, sizePx: 200, gapPx: 8 })
  return mountScreen(React.createElement(ClusterCard, { cluster, width: 260, onPress }), {
    hub: {
      'recordingExport.createExport': () => ({ id: 'exp-1', deviceId: 7, state: 'queued', createdAt: START, profiles: ['high'] }),
      'pipelineAnalytics.listTrackMedia': MANIFEST,
    },
  })
}

const pill = (): HTMLElement => {
  const el = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].find((n) =>
    /^\d{1,2}[:.]\d{2}/.test(n.getAttribute('aria-label') ?? ''),
  )
  expect(el).toBeDefined()
  return el as HTMLElement
}
const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

/** Finger down on the pill and kept there past the hold. */
async function holdPill(): Promise<void> {
  fireEvent.mouseDown(pill(), { button: 0, buttons: 1 })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 100))
  })
}

describe('the cluster card has no download control', () => {
  it('renders the card and its pill, and nothing that downloads', () => {
    card(vi.fn())
    expect(document.body.querySelector('[data-testid="cluster-card"]')).not.toBeNull()
    const labels = [...document.body.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => /download/i.test(l))).toBe(false)
    expect(document.body.querySelector('[data-testid="cluster-event-download"]')).toBeNull()
  })

  it('the wiring is gone from the card, the scroller and the timeline', () => {
    for (const rel of [
      'src/components/camera/theater/ClusterCard.tsx',
      'src/components/camera/theater/TimelineScroller.tsx',
      'src/components/camera/theater/TheaterTimeline.tsx',
    ]) {
      const src = read(rel)
      expect(src, rel).not.toContain('onDownloadEvent')
      expect(src, rel).not.toContain('EventDownloadModal')
    }
  })
})

describe('the long press', () => {
  it('a tap seeks and opens nothing', () => {
    const onPress = vi.fn()
    card(onPress)
    fireEvent.click(pill())
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(byId(EVENT_ACTION_CLIP_TEST_ID)).toBeNull()
  })

  it('a hold opens the menu with its three actions, and does not seek', async () => {
    const onPress = vi.fn()
    card(onPress)
    await holdPill()
    await waitFor(() => expect(byId(EVENT_ACTION_CLIP_TEST_ID)).not.toBeNull())
    expect(byId(EVENT_ACTION_SNAPSHOT_TEST_ID)).not.toBeNull()
    expect(byId(EVENT_ACTION_KEYFRAME_TEST_ID)).not.toBeNull()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('Download clip queues the event span ±3 s with no confirmation step', async () => {
    card(vi.fn())
    await holdPill()
    await waitFor(() => expect(byId(EVENT_ACTION_CLIP_TEST_ID)).not.toBeNull())
    await act(async () => {
      fireEvent.click(byId(EVENT_ACTION_CLIP_TEST_ID) as HTMLElement)
    })
    await waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'recordingExport.createExport')).toHaveLength(1),
    )
    const input = hubCalls().find((c) => c.path === 'recordingExport.createExport')?.input
    expect(input).toMatchObject({ deviceId: 7, fromMs: START - 3_000, toMs: END + 3_000 })
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
    // The Activity centre is the acknowledgement.
    expect(useActivityStore.getState().items.map((i) => i.id)).toContain('export:exp-1')
  })
})

describe('one menu for both surfaces', () => {
  it('the cluster pill and the track detail mount the same component', () => {
    const pillSrc = read('src/components/camera/theater/ClusterPill.tsx')
    const detailSrc = read('src/components/events/track/TrackDetailView.tsx')
    expect(pillSrc).toContain("from '../../events/EventActionMenu.js'")
    expect(pillSrc).toContain('<EventActionMenu')
    expect(detailSrc).toContain("from '../EventActionMenu.js'")
    expect(detailSrc).toContain('<EventActionMenu')
  })

  it('neither surface carries its own download modal or action runner', () => {
    for (const rel of [
      'src/components/camera/theater/ClusterPill.tsx',
      'src/components/events/track/TrackDetailView.tsx',
    ]) {
      const src = read(rel)
      expect(src, rel).not.toContain('useRunExport')
      expect(src, rel).not.toContain('EventDownloadModal')
    }
  })
})
