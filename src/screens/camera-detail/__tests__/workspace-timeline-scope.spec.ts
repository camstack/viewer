/**
 * @vitest-environment jsdom
 *
 * The theater timeline reading the WHOLE view, on a real rendered tree.
 *
 * `timeline-scope-read.spec.ts` proves the arithmetic. This proves the thing
 * the arithmetic is for, and it is the only place that can: every claim below
 * is about what crossed the WIRE and what the surface then drew, and neither is
 * visible from a pure function.
 *
 * Four gates, in the operator's own order:
 *
 *  1. the whole view is asked for in ONE call per kind of data, never N;
 *  2. a camera the hub could not read is DISTINGUISHABLE from a camera that
 *     was quiet — the gate that decides whether the batch was worth having;
 *  3. the 200 ceiling is respected and the excess is reported, not truncated;
 *  4. with no view, the wire and the cache keys are exactly what shipped.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { setTestViewport, IPAD_LANDSCAPE } from '../../../testing/viewport-control.js'
import { resetWebViewStub } from '../../../testing/webview-control.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE, type WorkspaceState } from '../../../store/workspace.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { HEATMAP_UNKNOWN_TEST_ID } from '../../../components/camera/theater/HeatmapBar.js'
import { TIMELINE_SCOPE_NOTICE_TEST_ID } from '../../../components/camera/theater/TimelineScopeNotice.js'
import { TIMELINE_SCOPE_BATCH_MAX } from '../../../components/camera/theater/timeline-scope-read.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
  { id: 9, name: 'Garage', isCamera: true, online: true },
]

// The batch is the ARCHIVE's — `recording` is a device collection since
// D625 and carries only the per-camera, provider-pinned methods.
const AVAILABILITY_BATCH = 'recordingArchive.getAvailabilityBatch'
const AVAILABILITY_ONE = 'recording.getAvailability'
const DENSITY_BATCH = 'pipelineAnalytics.getEventDensityBatch'
const DENSITY_ONE = 'pipelineAnalytics.getEventDensity'
const TRACKS_BATCH = 'pipelineAnalytics.listRecentTracks'
const TRACKS_ONE = 'pipelineAnalytics.listTracks'

/** Every camera answered, and every one of them was quiet. */
function readRows(input: unknown, payloadKey: string): readonly unknown[] {
  const ids = (input as { deviceIds?: readonly number[] }).deviceIds ?? []
  return ids.map((deviceId) => ({ deviceId, read: 'read', [payloadKey]: [] }))
}

/** `unreadableIds` answered `unreadable`; the rest answered and were quiet. */
function rowsWithUnreadable(
  input: unknown,
  payloadKey: string,
  unreadableIds: readonly number[],
): readonly unknown[] {
  const ids = (input as { deviceIds?: readonly number[] }).deviceIds ?? []
  return ids.map((deviceId) => ({
    deviceId,
    read: unreadableIds.includes(deviceId) ? 'unreadable' : 'read',
    [payloadKey]: [],
  }))
}

function hubWith(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    'deviceManager.listAll': CAMERAS,
    [AVAILABILITY_BATCH]: (input: unknown) => readRows(input, 'ranges'),
    // The singular answer carries the same head as a batch row
    // (`deviceId` + `read`) — a fixture without it is dropped as malformed
    // and the camera reports unknown, which is what the cap would mean.
    [AVAILABILITY_ONE]: (input: unknown) => ({
      deviceId: (input as { deviceId?: number }).deviceId ?? 0,
      read: 'read',
      ranges: [],
    }),
    [DENSITY_BATCH]: (input: unknown) => readRows(input, 'buckets'),
    [DENSITY_ONE]: [],
    [TRACKS_BATCH]: { tracks: [], nextCursor: null },
    [TRACKS_ONE]: [],
    ...overrides,
  }
}

function callsTo(path: string): readonly { readonly input: unknown }[] {
  return hubCalls().filter((c) => c.path === path)
}

function deviceIdsOf(input: unknown): readonly number[] {
  return (input as { deviceIds?: readonly number[] }).deviceIds ?? []
}

async function openTheater(
  view: Partial<WorkspaceState>,
  hub: Readonly<Record<string, unknown>>,
): Promise<HTMLElement> {
  useWorkspaceStore.setState({ workspace: { ...EMPTY_WORKSPACE, ...view } })
  const { container } = mountScreen(
    React.createElement(CameraDetailScreen, { deviceId: 1 }),
    { hub },
  )
  await act(async () => undefined)
  return container
}

/** The coverage read is NOT deferred behind the picture, so its arrival is the
 *  readiness signal every negative assertion below waits for. Counting `act`
 *  flushes would prove nothing about a query that had not been issued yet. */
async function coverageAnswered(path: string): Promise<void> {
  await waitFor(() => expect(callsTo(path).length).toBeGreaterThan(0))
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
  resetWebViewStub()
  setTestPlatform('ios')
  setTestViewport(IPAD_LANDSCAPE)
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

describe('gate 1 — the whole view, in one call per kind of data', () => {
  it('the coverage read names every camera in the view, once', async () => {
    await openTheater({ members: [5, 9], primaryId: 5 }, hubWith())
    await coverageAnswered(AVAILABILITY_BATCH)

    for (const call of callsTo(AVAILABILITY_BATCH)) {
      // The picture FIRST — `workspaceTimelineScope`. The wall excludes the
      // route camera; the timeline must not.
      expect(deviceIdsOf(call.input)).toEqual([1, 5, 9])
    }
    // Not one call per camera. This is the whole point of the batch.
    expect(callsTo(AVAILABILITY_ONE)).toHaveLength(0)
  })

  it('the events read is one merged feed, not one listTracks per camera', async () => {
    await openTheater({ members: [5, 9], primaryId: 5 }, hubWith())
    await waitFor(() => expect(callsTo(TRACKS_BATCH).length).toBeGreaterThan(0), {
      timeout: 4_000,
    })
    for (const call of callsTo(TRACKS_BATCH)) {
      expect(deviceIdsOf(call.input)).toEqual([1, 5, 9])
    }
    expect(callsTo(TRACKS_ONE)).toHaveLength(0)
  })

  it('the density read is one histogram request for the whole view', async () => {
    await openTheater({ members: [5, 9], primaryId: 5 }, hubWith())
    await waitFor(() => expect(callsTo(DENSITY_BATCH).length).toBeGreaterThan(0), {
      timeout: 4_000,
    })
    for (const call of callsTo(DENSITY_BATCH)) {
      expect(deviceIdsOf(call.input)).toEqual([1, 5, 9])
    }
    expect(callsTo(DENSITY_ONE)).toHaveLength(0)
  })
})

describe('gate 2 — unreadable is not quiet', () => {
  it('a view whose cameras ALL answered draws no unknown mark at all', async () => {
    const root = await openTheater({ members: [5, 9], primaryId: 5 }, hubWith())
    await coverageAnswered(AVAILABILITY_BATCH)
    await act(async () => undefined)

    expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)).toBeNull()
  })

  it('one unreadable camera marks the tape AND says so — the same picture would be a lie', async () => {
    const root = await openTheater(
      { members: [5, 9], primaryId: 5 },
      hubWith({
        [AVAILABILITY_BATCH]: (input: unknown) => rowsWithUnreadable(input, 'ranges', [9]),
      }),
    )
    await coverageAnswered(AVAILABILITY_BATCH)

    await waitFor(() =>
      expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).not.toBeNull(),
    )
    const notice = root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)
    expect(notice).not.toBeNull()
    // English over the shipped locale — never a raw i18n key on screen.
    expect(notice?.textContent ?? '').toContain('could not be read')
    expect(notice?.textContent ?? '').not.toContain('v2.timeline')
  })

  it('a camera that answered with NOTHING is not marked — an empty answer is an answer', async () => {
    // Same shape of payload as the unreadable case above (`ranges: []`), and
    // the ONLY difference is the tag. If the surface drew these the same, the
    // hub's whole per-row `read` field would be pointless.
    const root = await openTheater({ members: [5, 9], primaryId: 5 }, hubWith())
    await coverageAnswered(AVAILABILITY_BATCH)
    await act(async () => undefined)
    expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).toBeNull()
  })

  /**
   * The EVENTS half, on its own.
   *
   * The two always-on reads (day-window coverage and the activity bundle) both
   * touch `getAvailabilityBatch`, so a fixture that marks a camera unreadable
   * there is answered by either of them — which left the activity bundle's own
   * `mergeKnowledge` covered by nothing. Discovered by disarming it and
   * watching this file stay green. Here only the DENSITY read reports the
   * camera unreadable, so the notice can only come from that bundle.
   */
  it('a camera whose EVENTS could not be read is unknown, even when its footage was readable', async () => {
    const root = await openTheater(
      { members: [5, 9], primaryId: 5 },
      hubWith({
        [DENSITY_BATCH]: (input: unknown) => rowsWithUnreadable(input, 'buckets', [9]),
      }),
    )
    await waitFor(() => expect(callsTo(DENSITY_BATCH).length).toBeGreaterThan(0), {
      timeout: 4_000,
    })
    await waitFor(
      () =>
        expect(
          root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`),
        ).not.toBeNull(),
      { timeout: 4_000 },
    )
  })

  it('a short answer — a row simply missing — counts as unknown too', async () => {
    const root = await openTheater(
      { members: [5, 9], primaryId: 5 },
      hubWith({
        // Answers for two of the three cameras asked about. A caller that only
        // read the rows it got would never learn the third is missing.
        [AVAILABILITY_BATCH]: () => [
          { deviceId: 1, read: 'read', ranges: [] },
          { deviceId: 5, read: 'read', ranges: [] },
        ],
      }),
    )
    await coverageAnswered(AVAILABILITY_BATCH)
    await waitFor(() =>
      expect(root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)).not.toBeNull(),
    )
  })
})

describe('gate 3 — the 200 ceiling', () => {
  /** A view larger than one batch may carry. The hub REFUSES an over-cap ask
   *  (it is a zod `.max`), so the client must not send one. */
  const HUGE = Array.from({ length: TIMELINE_SCOPE_BATCH_MAX + 4 }, (_, i) => i + 2)
  /** Every one of them a camera this hub knows about — otherwise
   *  `reconcileMembers` empties the view and these gates pass vacuously. */
  const MANY_CAMERAS = [
    ...CAMERAS,
    ...HUGE.filter((id) => !CAMERAS.some((c) => c.id === id)).map((id) => ({
      id,
      name: `Cam ${id}`,
      isCamera: true,
      online: true,
    })),
  ]
  const hugeHub = () => hubWith({ 'deviceManager.listAll': MANY_CAMERAS })

  it('never sends more ids than the hub schema accepts', async () => {
    await openTheater({ members: HUGE, primaryId: HUGE[0] }, hugeHub())
    await waitFor(() =>
      expect(deviceIdsOf(callsTo(AVAILABILITY_BATCH)[0]?.input)).toHaveLength(
        TIMELINE_SCOPE_BATCH_MAX,
      ),
    )
    for (const call of callsTo(AVAILABILITY_BATCH)) {
      expect(deviceIdsOf(call.input).length).toBeLessThanOrEqual(TIMELINE_SCOPE_BATCH_MAX)
    }
  })

  it('the camera in the picture is never the one the ceiling drops', async () => {
    await openTheater({ members: HUGE, primaryId: HUGE[0] }, hugeHub())
    await waitFor(() =>
      expect(deviceIdsOf(callsTo(AVAILABILITY_BATCH)[0]?.input)).toHaveLength(
        TIMELINE_SCOPE_BATCH_MAX,
      ),
    )
    expect(deviceIdsOf(callsTo(AVAILABILITY_BATCH)[0]?.input)[0]).toBe(1)
  })

  it('the excess is REPORTED, not silently truncated', async () => {
    const root = await openTheater({ members: HUGE, primaryId: HUGE[0] }, hugeHub())
    await waitFor(
      () =>
        expect(
          root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`),
        ).not.toBeNull(),
      { timeout: 4_000 },
    )
    const text = root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)?.textContent
    // Named as a view too big, not as cameras that failed: the remedy differs.
    expect(text ?? '').toContain('more than the timeline can read at once')
  })
})

describe('gate 4 — with no view, nothing changed', () => {
  it('an empty workspace sends the SINGULAR reads, exactly as camera-detail shipped', async () => {
    await openTheater(EMPTY_WORKSPACE, hubWith())
    await coverageAnswered(AVAILABILITY_ONE)

    expect(callsTo(AVAILABILITY_BATCH)).toHaveLength(0)
    for (const call of callsTo(AVAILABILITY_ONE)) {
      expect((call.input as { deviceId?: number }).deviceId).toBe(1)
    }
  })

  it('a view of ONE camera is still the single-camera wire — the picture IS the view', async () => {
    await openTheater({ members: [1], primaryId: 1 }, hubWith())
    await coverageAnswered(AVAILABILITY_ONE)
    expect(callsTo(AVAILABILITY_BATCH)).toHaveLength(0)
  })

  it('the events read stays listTracks, with its paging and its zone prefilter', async () => {
    await openTheater(EMPTY_WORKSPACE, hubWith())
    await waitFor(() => expect(callsTo(TRACKS_ONE).length).toBeGreaterThan(0), { timeout: 4_000 })
    expect(callsTo(TRACKS_BATCH)).toHaveLength(0)
  })

  it('and nothing on screen claims a camera went unread', async () => {
    const root = await openTheater(EMPTY_WORKSPACE, hubWith())
    await coverageAnswered(AVAILABILITY_ONE)
    await act(async () => undefined)
    expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)).toBeNull()
  })
})
