/**
 * @vitest-environment jsdom
 *
 * press → scrub → Save / Discard, through the real machine, the real hook and
 * the real bar. Only the wire is faked (`hub-stub.ts`) and only the GESTURE is
 * played by the test: `beginSelection` and `commitScrub` are the same calls the
 * timeline's responder makes, so nothing production does is re-implemented here.
 *
 * The two claims that matter are opposites:
 *   • Save creates the export ONCE, with the ends the right way round.
 *   • Discard creates NOTHING — no queued job, no cancelled row, no request.
 *
 * The second is why the export is created on Save and not when the drag is
 * released: `cancelExport` keeps the history row, so an export created early
 * and cancelled late is litter on the hub for a period the operator threw away.
 */
import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from 'vitest'
import { setTestPlatform } from '../../testing/platform-control.js'
import React from 'react'
import { act, cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import {
  TimelinePlaybackBar,
  RECORD_TEST_ID,
  RECORD_ACCEPT_TEST_ID,
  RECORD_DISCARD_TEST_ID,
} from '../../components/camera/theater/TimelinePlaybackBar.js'
import { resolveRecordControl } from '../record-control.js'
import { describeExportSelection } from '../export-selection.js'
import { usePlaybackMachine, selectActiveEpoch, type PlaybackMachine } from '../playback-machine.js'
import { useExportSelection } from '../use-export-selection.js'
import { useIsAdmin } from '../../data/use-me.js'
import { useActivityStore } from '../../activity/activity-instance.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 7
const ANCHOR = Date.parse('2026-09-07T10:05:00Z')
const EARLIER = Date.parse('2026-09-07T10:00:00Z')
/** A day window with footage across the whole selection. */
const DAY_FROM = Date.parse('2026-09-07T00:00:00Z')
const DAY_TO = Date.parse('2026-09-07T23:59:59Z')
const COVERAGE = [{ startMs: DAY_FROM, endMs: DAY_TO }]

/** Late enough that nothing in these ranges is clamped by the live edge. */
const LIVE_EDGE = Date.parse('2026-09-07T23:00:00Z')
/** An hour after the anchor — the FORWARD half of the drag. */
const LATER = Date.parse('2026-09-07T11:05:00Z')

/**
 * The live-capture flow, present but unreachable from a recorded mode. That is
 * the operator's first report: the record button reported "cannot record the
 * live view" during playback, because the screen's handler ran this flow
 * whatever the mode was.
 */
const captureCalls: string[] = []
const snapshotCalls: string[] = []
/** Whether `auth.me` answers admin for the case being mounted. */
let ADMIN = false
const LIVE_CAPTURE = {
  capturing: false,
  elapsedLabel: '0:00',
  onStart: () => captureCalls.push('startLiveCapture'),
  onKeep: () => captureCalls.push('keepLiveCapture'),
  onDiscard: () => captureCalls.push('discardLiveCapture'),
}

const CREATED = {
  id: 'exp-1',
  deviceId: DEVICE_ID,
  profile: 'high',
  fromMs: EARLIER,
  toMs: ANCHOR,
  options: { includeAudio: true, maxLifeMs: 1, deleteAfterDownload: false },
  state: 'queued',
  progressPct: 0,
  expiresAt: 0,
  deleteAfterDownload: false,
  createdAt: 0,
  createdBy: 'test',
}

/**
 * The player. Recording rather than inert, because "no playback starts during
 * the selection" is a claim about what reaches the PLAYER: a commit is what
 * lands a drag (`recorded-track-session.ts` replaces the held scrub keyframe
 * with the land's burst), so the absence of `scrubCommit`/`seek` here IS the
 * operator's "show the last frame reached, do not play".
 */
const sinkCalls: string[] = []
const SINK = {
  scrubStart: () => sinkCalls.push('scrubStart'),
  scrubTo: () => sinkCalls.push('scrubTo'),
  scrubCommit: () => sinkCalls.push('scrubCommit'),
  seek: () => sinkCalls.push('seek'),
  goLive: () => sinkCalls.push('goLive'),
}

let machine: PlaybackMachine | null = null
/** Hand the live machine to the test. A PROP called from an effect, not an
 *  assignment during render: the gesture layer is the only thing the test plays,
 *  and a component that writes to module state while rendering is not one. */
const captureMachine = (m: PlaybackMachine): void => {
  machine = m
}

/**
 * The bar, wired the way `TheaterTimeline` wires it — through the same
 * `describeExportSelection` the timeline uses, so the label, the enablement and
 * the saved range come from one derivation here as they do on the device.
 */
function Harness({ onMachine }: { readonly onMachine: (m: PlaybackMachine) => void }): React.ReactElement {
  const playback = usePlaybackMachine(SINK)
  React.useEffect(() => {
    onMachine(playback)
  }, [onMachine, playback])
  // The same hook the timeline reads the role from: `auth.me`, through the stub.
  const isAdmin = useIsAdmin()
  const selection = useExportSelection(DEVICE_ID, 'Front door', playback)
  const view = describeExportSelection(
    selection.anchorMs,
    selectActiveEpoch(playback.state),
    COVERAGE,
    DAY_FROM,
    DAY_TO,
    LIVE_EDGE,
  )
  return React.createElement(TimelinePlaybackBar, {
    mode: playback.state.mode,
    rate: 1,
    paused: false,
    loading: false,
    onTogglePause: () => undefined,
    onJogBack: () => undefined,
    onJogForward: () => undefined,
    onSelectRate: () => undefined,
    onGoLive: playback.goLive,
    liveLocked: false,
    onToggleLiveLock: playback.toggleLiveLock,
    // The SAME resolver the timeline uses, so the flow the button drives is
    // chosen here exactly as it is on the device.
    record: resolveRecordControl(playback.state.mode, LIVE_CAPTURE, selection, view, {
      isAdmin,
      onSnapshot: () => snapshotCalls.push('snapshot'),
    }),
  })
}

interface Mounted {
  readonly root: HTMLElement
  readonly press: (testId: string) => Promise<void>
  /** REC → the menu row that arms an EXPORT selection. */
  readonly arm: () => Promise<void>
  /** REC → the menu row that arms a DELETE selection. */
  readonly armDelete: () => Promise<void>
  /** The delete dialog's confirm button, pressed. */
  readonly confirmDialog: (label: string) => Promise<void>
}

async function mountCycle(options: { readonly admin?: boolean } = {}): Promise<Mounted> {
  ADMIN = options.admin ?? false
  machine = null
  snapshotCalls.length = 0
  sinkCalls.length = 0
  captureCalls.length = 0
  const { container } = mountScreen(React.createElement(Harness, { onMachine: captureMachine }), {
    hub: {
      'recordingExport.createExport': () => CREATED,
      'recordingArchive.deleteFootprint': () => ({ deletedBuckets: 2, reclaimedBytes: 4096 }),
      'auth.me': () => ({ id: 'u1', username: 'op', isAdmin: ADMIN }),
    },
  })
  await act(async () => undefined)
  // Land the player on a recorded moment first: the selection is refused at the
  // live edge, where the same button records the live picture instead.
  await act(async () => {
    machine!.seek(ANCHOR, 'timeline')
  })
  const press = async (testId: string): Promise<void> => {
    // `document`, not the container: on the web the REC menu is portalled to the
    // window (`PlaybackBarPopover`), and so is the confirmation dialog.
    const el = document.body.querySelector(`[data-testid="${testId}"]`)
    expect(el, testId).not.toBeNull()
    await act(async () => {
      fireEvent.click(el as HTMLElement)
    })
  }
  const arm = async (): Promise<void> => {
    await press(RECORD_TEST_ID)
    await press(`${RECORD_TEST_ID}-selectExport`)
  }
  const armDelete = async (): Promise<void> => {
    await press(RECORD_TEST_ID)
    await press(`${RECORD_TEST_ID}-deleteRecording`)
  }
  const confirmDialog = async (label: string): Promise<void> => {
    const dialog = document.body.querySelector('[role="alert"]')
    expect(dialog, 'a confirmation dialog on screen').not.toBeNull()
    const button = [...(dialog as HTMLElement).querySelectorAll('[role="button"]')].find(
      (el) => el.textContent === label,
    )
    expect(button, `dialog button "${label}"`).toBeDefined()
    await act(async () => {
      fireEvent.click(button as HTMLElement)
    })
  }
  return { root: container, press, arm, armDelete, confirmDialog }
}

/** Move the selection's free end, exactly as a timeline drag does. */
async function scrubTo(epoch: number): Promise<void> {
  await act(async () => {
    machine!.beginScrub('timeline')
    machine!.moveScrub(epoch, 'timeline')
    machine!.commitScrub(epoch, 'timeline')
  })
}

const creates = (): readonly unknown[] =>
  hubCalls().filter((c) => c.path === 'recordingExport.createExport').map((c) => c.input)

describe('press → scrub back → Save', () => {
  it('creates exactly one export, with the ends ordered', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_ACCEPT_TEST_ID)

    expect(creates()).toHaveLength(1)
    // The operator scrubbed BACKWARDS: the free end is before the anchor, and
    // the hub must still receive `fromMs < toMs`.
    expect(creates()[0]).toMatchObject({
      deviceId: DEVICE_ID,
      fromMs: EARLIER,
      toMs: ANCHOR,
    })
  })

  it('the mode closes afterwards — Save/Discard do not survive the save', async () => {
    const { root, press, arm } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_ACCEPT_TEST_ID)
    expect(root.querySelector(`[data-testid="${RECORD_ACCEPT_TEST_ID}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${RECORD_TEST_ID}"]`)).not.toBeNull()
  })
})

describe('press → scrub back → Discard', () => {
  it('creates nothing at all', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_DISCARD_TEST_ID)

    expect(creates()).toHaveLength(0)
    // Not even a cancel: there is nothing on the hub to cancel.
    expect(hubCalls().some((c) => c.path.startsWith('recordingExport.'))).toBe(false)
  })

  it('returns the bar to the arm control, with the player where it was left', async () => {
    const { root, press, arm } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_DISCARD_TEST_ID)
    expect(root.querySelector(`[data-testid="${RECORD_TEST_ID}"]`)).not.toBeNull()
    expect(machine!.state.playhead).toBe(ANCHOR)
  })
})

describe('during the selection the recording never plays', () => {
  it('the drag pushes frames but never lands, and the playhead does not move', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    sinkCalls.length = 0
    await scrubTo(EARLIER)
    // Frames ARE pushed — the operator has to see where they are going.
    expect(sinkCalls).toContain('scrubTo')
    // Nothing LANDS: no commit, no seek, so the last pushed keyframe holds.
    expect(sinkCalls).not.toContain('scrubCommit')
    expect(sinkCalls).not.toContain('seek')
    expect(machine!.state.playhead).toBe(ANCHOR)
    expect(machine!.state.mode).toBe('playback')
    // The indicator follows the free end — that is what the band is drawn to.
    expect(selectActiveEpoch(machine!.state)).toBe(EARLIER)
  })
})

describe('the record button never attempts a live capture off the live edge', () => {
  it('pressing it in playback arms the selection and touches no capture', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    // The reported defect: this pressed `startLiveCapture()` and the screen
    // answered "cannot record the live view" over recorded footage.
    expect(captureCalls).toEqual([])
    expect(machine!.state.selectionAnchor).toBe(ANCHOR)
  })

  it('and Accept/Discard belong to the selection too', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_DISCARD_TEST_ID)
    expect(captureCalls).toEqual([])
  })
})

describe('the free end may be dragged FORWARD as well as back', () => {
  it('two hours ago until one hour later: the anchor is the START', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    await scrubTo(LATER)
    await press(RECORD_ACCEPT_TEST_ID)
    expect(creates()).toHaveLength(1)
    expect(creates()[0]).toMatchObject({ fromMs: ANCHOR, toMs: LATER })
  })
})

describe('a zero-length selection cannot be saved', () => {
  it('arming and pressing Save without scrubbing creates nothing', async () => {
    const { press, arm } = await mountCycle()
    await arm()
    await press(RECORD_ACCEPT_TEST_ID)
    expect(creates()).toHaveLength(0)
  })
})

describe('the REC press only opens a menu — nothing is armed until a row is chosen', () => {
  it('pressing REC arms nothing; the menu row does', async () => {
    const { press } = await mountCycle()
    await press(RECORD_TEST_ID)
    expect(machine!.state.selectionAnchor).toBeNull()
    await press(`${RECORD_TEST_ID}-selectExport`)
    expect(machine!.state.selectionAnchor).toBe(ANCHOR)
  })

  it('Download snapshot reaches the snapshot flow and arms nothing', async () => {
    const { press } = await mountCycle()
    await press(RECORD_TEST_ID)
    await press(`${RECORD_TEST_ID}-snapshot`)
    expect(snapshotCalls).toEqual(['snapshot'])
    expect(machine!.state.selectionAnchor).toBeNull()
  })
})

describe('Save puts the export in the Activity list', () => {
  it('adds one running item and says so', async () => {
    useActivityStore.setState({ items: [], hydrated: true, serverId: 'test' })
    const { arm, press } = await mountCycle()
    await arm()
    await scrubTo(EARLIER)
    await press(RECORD_ACCEPT_TEST_ID)
    const items = useActivityStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'export', exportId: 'exp-1', deviceId: DEVICE_ID, cameraName: 'Front door' })
  })
})

describe('delete mode', () => {
  // The browser draws the confirmation itself (`Alert.alert` is empty there),
  // which is the only rendering a test can answer.
  beforeAll(() => setTestPlatform('web'))
  afterAll(() => setTestPlatform('ios'))

  const deletes = (): readonly unknown[] =>
    hubCalls().filter((c) => c.path === 'recordingArchive.deleteFootprint').map((c) => c.input)

  it('an admin: arm → scrub → confirm the dialog → deleteFootprint with the ordered window', async () => {
    const { armDelete, press, confirmDialog } = await mountCycle({ admin: true })
    await act(async () => undefined)
    await armDelete()
    await scrubTo(EARLIER)
    await press(RECORD_ACCEPT_TEST_ID)
    // Nothing is deleted before the operator answers the dialog.
    expect(deletes()).toHaveLength(0)
    await confirmDialog('Delete')
    expect(deletes()).toEqual([{ deviceId: DEVICE_ID, fromMs: EARLIER, toMs: ANCHOR }])
    // And no export is created by a delete.
    expect(creates()).toHaveLength(0)
  })

  it('declining the dialog deletes nothing and leaves the selection armed', async () => {
    const { armDelete, press, confirmDialog } = await mountCycle({ admin: true })
    await act(async () => undefined)
    await armDelete()
    await scrubTo(EARLIER)
    await press(RECORD_ACCEPT_TEST_ID)
    await confirmDialog('Cancel')
    expect(deletes()).toHaveLength(0)
    expect(machine!.state.selectionAnchor).toBe(ANCHOR)
  })

  it('a non-admin has no Delete entry and cannot reach deleteFootprint at all', async () => {
    const { press, root } = await mountCycle({ admin: false })
    await act(async () => undefined)
    await press(RECORD_TEST_ID)
    expect(root.querySelector(`[data-testid="${RECORD_TEST_ID}-deleteRecording"]`)).toBeNull()
    expect(deletes()).toHaveLength(0)
    expect(machine!.state.selectionAnchor).toBeNull()
  })
})
