/**
 * @vitest-environment jsdom
 *
 * The grid page mounting THE timeline, scoped to the grid's own cameras.
 *
 * The page used to carry a timeline of its own — a band of per-camera lanes
 * with its own window, its own playhead store and its own placement gate. It is
 * deleted, and every claim below is about what replaced it, on a real rendered
 * tree: the ones that matter here are what crossed the WIRE and what the
 * surface then drew, and neither is visible from a pure function.
 *
 * Five gates, in the operator's own order:
 *
 *  1. the page renders the theater timeline, not the old band;
 *  2. the scope IS the grid's cameras, and it changes with them;
 *  3. an unreadable camera stays distinguishable from a quiet one HERE too —
 *     the property the batch's per-row `read` tag exists for, at a second
 *     surface that could have thrown it away;
 *  4. nothing in `src/` or `app/` still refers to the deleted timeline;
 *  5. a phone is unchanged — no timeline, and not one batched read.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen, TEST_SERVER_ID } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPHONE_PORTRAIT,
  IPHONE_LANDSCAPE,
} from '../../testing/viewport-control.js'
import { resetWebViewStub } from '../../testing/webview-control.js'
import { useGridStore, type Grid } from '../../store/grid-store.js'
import { GridViewScreen } from '../GridViewScreen.js'
import { detailShapeTestId } from '../camera-detail/detail-layout.js'
import { TIMELINE_SCOPE_NOTICE_TEST_ID } from '../../components/camera/theater/TimelineScopeNotice.js'
import { HEATMAP_UNKNOWN_TEST_ID } from '../../components/camera/theater/HeatmapBar.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
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
const TRACKS_BATCH = 'pipelineAnalytics.listRecentTracks'

const GRID_ID = 'g1'

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
    [TRACKS_BATCH]: { tracks: [], nextCursor: null },
    ...overrides,
  }
}

function callsTo(path: string): readonly { readonly input: unknown }[] {
  return hubCalls().filter((c) => c.path === path)
}

function deviceIdsOf(input: unknown): readonly number[] {
  return (input as { deviceIds?: readonly number[] }).deviceIds ?? []
}

/** Blank out block and line comments, so prose about a deletion does not read
 *  as a live reference to the thing deleted. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

function seedGrid(grid: Partial<Grid>): void {
  useGridStore.setState({
    grids: [{ id: GRID_ID, name: 'Piano terra', serverId: TEST_SERVER_ID, cameraIds: [], ...grid }],
    hydrated: true,
  })
}

/**
 * Mount the page and turn the timeline ON.
 *
 * The chrome opens HIDDEN (the operator's default — the page opened without a
 * timeline before the substitution, and hidden reads nothing), so every claim
 * below about a batched read or a drawn band has to press the clock button
 * first. The button's own behaviour — that it hides rather than unmounts, and
 * that no tile is remounted by the round trip — is `grid-timeline-toggle.spec`.
 *
 * A phone has no button, so `showChrome` is skipped there; that is the same
 * absence gate 5 asserts.
 */
async function openGrid(
  hub: Readonly<Record<string, unknown>>,
  showChrome = true,
): Promise<HTMLElement> {
  const { container } = mountScreen(
    React.createElement(GridViewScreen, { gridId: GRID_ID }),
    { hub },
  )
  await act(async () => undefined)
  if (showChrome) {
    const clock = container.querySelector('[aria-label="Timeline"]')
    if (clock === null) throw new Error('the control bar offered no clock button')
    act(() => {
      fireEvent.click(clock)
    })
    await act(async () => undefined)
  }
  return container
}

/** The coverage read is the readiness signal every negative assertion waits
 *  for. Counting `act` flushes would prove nothing about a query not yet
 *  issued. */
async function coverageAnswered(): Promise<void> {
  await waitFor(() => expect(callsTo(AVAILABILITY_BATCH).length).toBeGreaterThan(0))
}

beforeEach(() => {
  useGridStore.setState({ grids: [], hydrated: true })
  resetWebViewStub()
  setTestPlatform('ios')
  setTestViewport(IPAD_LANDSCAPE)
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useGridStore.setState({ grids: [], hydrated: true })
})

describe('gate 1 — the page renders THE timeline', () => {
  it('the theater timeline is mounted, in the shape the window resolves to', async () => {
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith())
    // `detailShapeTestId` is the theater timeline's root marker and carries the
    // layout it resolved to. A tablet in landscape is `wide` — the right rail,
    // which is where the deleted band docked in landscape too.
    await waitFor(() =>
      expect(root.querySelector(`[data-testid="${detailShapeTestId('wide')}"]`)).not.toBeNull(),
    )
  })

  it('a tablet in PORTRAIT gets the stacked column, not a second placement rule', async () => {
    setTestViewport({ width: 834, height: 1194 })
    seedGrid({ cameraIds: [1, 5] })
    const root = await openGrid(hubWith())
    await waitFor(() =>
      expect(root.querySelector(`[data-testid="${detailShapeTestId('stack')}"]`)).not.toBeNull(),
    )
  })
})

describe('gate 2 — the scope is the grid, and it follows the grid', () => {
  it('the coverage read names the grid cameras, in grid order, once', async () => {
    seedGrid({ cameraIds: [9, 1, 5] })
    await openGrid(hubWith())
    await coverageAnswered()

    for (const call of callsTo(AVAILABILITY_BATCH)) {
      // The grid's own order, not sorted: `planScopeAsk` truncates from the
      // END, so the order the operator arranged is the order that survives.
      expect(deviceIdsOf(call.input)).toEqual([9, 1, 5])
    }
    // Not one call per camera. This is the whole point of the batch.
    expect(callsTo(AVAILABILITY_ONE)).toHaveLength(0)
  })

  it('the events read is one merged feed for the whole grid', async () => {
    seedGrid({ cameraIds: [1, 5, 9] })
    await openGrid(hubWith())
    await waitFor(() => expect(callsTo(TRACKS_BATCH).length).toBeGreaterThan(0), {
      timeout: 4_000,
    })
    for (const call of callsTo(TRACKS_BATCH)) {
      expect(deviceIdsOf(call.input)).toEqual([1, 5, 9])
    }
  })

  it('a camera hidden from the wall leaves the timeline with it', async () => {
    // The scope comes from the VISIBLE wall cameras — the one list the page
    // already resolves. A hidden camera is not on the wall, so the timeline
    // must not be reading it either: two answers to "which cameras is this
    // page about" is the defect a single source exists to prevent.
    seedGrid({ cameraIds: [1, 5, 9], hiddenCameraIds: [5] })
    await openGrid(hubWith())
    await coverageAnswered()
    for (const call of callsTo(AVAILABILITY_BATCH)) {
      expect(deviceIdsOf(call.input)).toEqual([1, 9])
    }
  })
})

describe('gate 3 — unreadable is not quiet, on this page too', () => {
  it('a grid whose cameras ALL answered draws no unknown mark at all', async () => {
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith())
    await coverageAnswered()
    await act(async () => undefined)

    expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${TIMELINE_SCOPE_NOTICE_TEST_ID}"]`)).toBeNull()
  })

  it('one unreadable camera marks the tape AND says so', async () => {
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(
      hubWith({
        [AVAILABILITY_BATCH]: (input: unknown) => rowsWithUnreadable(input, 'ranges', [9]),
      }),
    )
    await coverageAnswered()

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
    // The SAME payload shape as the unreadable case (`ranges: []`); the only
    // difference is the tag. If this page drew them the same, the hub's whole
    // per-row `read` field would be pointless here.
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith())
    await coverageAnswered()
    await act(async () => undefined)
    expect(root.querySelector(`[data-testid="${HEATMAP_UNKNOWN_TEST_ID}"]`)).toBeNull()
  })
})

describe('the timebar over a WALL offers nothing per-camera', () => {
  /**
   * The rule the operator applied to the theater's own bar on 2026-09-02 — a
   * control on a per-view bar has to mean something for a SET — reaching the
   * page where the set is the whole point.
   *
   * Three controls stayed on camera-detail because they DO mean something for
   * one camera, and none of them survives here: the stream TIER (the grid's own
   * control bar already owns a per-grid one, and two knobs over one function is
   * worse than none), the view-options / overlay menu (a per-camera stored
   * document, and the wall draws a different one per cell), and the ZONE (drawn
   * on a picture this page does not have).
   *
   * Asserted on the RENDERED tree, not on the source: a source check would go
   * green on a page that passed the bindings and hid the buttons some other
   * way, which is the same control acting on whichever camera is first.
   */
  it('no zone-filter chip, and no camera chip either', async () => {
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith())
    await coverageAnswered()
    await act(async () => undefined)

    // A POSITIVE control first: without it these negatives would also pass on a
    // page that rendered no footer bar at all, which is the vacuous-negative
    // trap. The RANGE chip sits in the same row and is always rendered.
    expect(root.querySelector('[aria-label="Time range"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="Zone filter"]')).toBeNull()
    // Gone on the operator's call (2026-09-02) — this page is a tablet surface
    // and a tablet builds its view from the grid itself. See
    // `camera-jump-gate.spec.ts` for the threshold on both surfaces.
    expect(root.querySelector('[aria-label="Switch camera"]')).toBeNull()
  })

  it('the page hands the timeline no single-camera bindings, and nowhere to jump', () => {
    // The half that survives someone re-adding a button: with no group there is
    // nothing for a control to act on, and the type refuses a partial one.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'grid', 'GridWallTimeline.tsx'),
      'utf8',
    )
    expect(stripComments(src)).not.toContain('singleCamera={')
    expect(stripComments(src)).not.toContain('streamBinding')
    expect(stripComments(src)).not.toContain('overlayBinding')
    // The camera panel's three callbacks are DELETED here, not merely unwired:
    // the button that opened it cannot appear on this page at all.
    expect(stripComments(src)).not.toContain('cameraJump')
    expect(stripComments(src)).not.toContain('onOpenAdhocGrid')
    expect(stripComments(src)).not.toContain('cameraSelection')
  })
})

describe('gate 4 — the deleted timeline left nothing behind', () => {
  const ROOT = process.cwd()

  function sourceFiles(dir: string): readonly string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        out.push(...sourceFiles(full))
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full)
      }
    }
    return out
  }

  it('no file in src/ or app/ names the old band or its modules', () => {
    const self = join(ROOT, 'src', 'screens', '__tests__', 'grid-timeline-scope.spec.ts')
    const files = [
      ...sourceFiles(join(ROOT, 'src')),
      ...sourceFiles(join(ROOT, 'app')),
    ].filter((f) => f !== self)
    const banned = [
      'GridTimeline',
      'grid-timeline-store',
      'grid-timeline-window',
      'grid-timeline-lanes',
      'grid-timeline-gate',
      'use-grid-timeline-events',
      'useGridTimelineStore',
    ]
    const offenders: string[] = []
    for (const file of files) {
      // CODE only. A docblock is allowed to say what was deleted and why —
      // that is the record, not a reference — but nothing may still import,
      // render or call it.
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const name of banned) {
        if (new RegExp(`\\b${name}\\b`).test(src)) {
          offenders.push(`${file.slice(ROOT.length + 1)} → ${name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the deleted modules are really gone from disk', () => {
    for (const rel of [
      ['src', 'components', 'grid', 'GridTimeline.tsx'],
      ['src', 'store', 'grid-timeline-store.ts'],
      ['src', 'data', 'use-grid-timeline-events.ts'],
      ['src', 'grid', 'timeline', 'grid-timeline-window.ts'],
      ['src', 'grid', 'timeline', 'grid-timeline-lanes.ts'],
      ['src', 'grid', 'timeline', 'grid-timeline-gate.ts'],
    ]) {
      expect(() => readFileSync(join(ROOT, ...rel), 'utf8'), rel.join('/')).toThrow()
    }
  })

  it('its locale strings are gone from BOTH locales', () => {
    for (const locale of ['en', 'it'] as const) {
      const json: unknown = JSON.parse(
        readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8'),
      )
      const v2 = (json as { v2: Record<string, Record<string, unknown>> }).v2
      expect(v2.gridTimeline, `${locale}.v2.gridTimeline`).toBeUndefined()
      // The control bar's clock button is BACK (2026-09-02, operator) — but it
      // toggles the theater timeline's chrome, it does not resurrect the band.
      // Its string is the only thing the deleted component shared with what
      // replaced it, so it is asserted PRESENT here rather than absent.
      expect(v2.gridBar.timeline, `${locale}.v2.gridBar.timeline`).toBeTypeOf('string')
    }
  })
})

describe('gate 5 — the phone is unchanged', () => {
  it('a phone in portrait mounts no timeline and issues no batched read', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith(), false)
    // Readiness: the camera list IS fetched on a phone, so waiting on it proves
    // the screen got far enough for a timeline read to have been issued.
    await waitFor(() => expect(callsTo('deviceManager.listAll').length).toBeGreaterThan(0))
    await act(async () => undefined)

    for (const shape of ['wide', 'stack', 'fill'] as const) {
      expect(root.querySelector(`[data-testid="${detailShapeTestId(shape)}"]`)).toBeNull()
    }
    expect(callsTo(AVAILABILITY_BATCH)).toHaveLength(0)
    expect(callsTo(DENSITY_BATCH)).toHaveLength(0)
  })

  it('a phone in LANDSCAPE is excluded too — the old band excluded both', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    seedGrid({ cameraIds: [1, 5, 9] })
    const root = await openGrid(hubWith(), false)
    await waitFor(() => expect(callsTo('deviceManager.listAll').length).toBeGreaterThan(0))
    await act(async () => undefined)

    for (const shape of ['wide', 'stack', 'fill'] as const) {
      expect(root.querySelector(`[data-testid="${detailShapeTestId(shape)}"]`)).toBeNull()
    }
    expect(callsTo(AVAILABILITY_BATCH)).toHaveLength(0)
  })
})
