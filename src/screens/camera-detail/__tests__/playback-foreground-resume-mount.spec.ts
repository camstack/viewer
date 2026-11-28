/**
 * @vitest-environment jsdom
 *
 * Recorded playback survives the app leaving the foreground — mounted.
 *
 * Reported 2026-11-18 (iOS, camera screen, scrubbed into a recording): pull
 * the notification shade down, come back, and the player says the video
 * stream is unavailable; play has to be pressed several times; and when it
 * plays, it is not where the timeline cursor was.
 *
 *   1. shade (`inactive → active`)   suspends nothing, so the peer is NOT
 *                                    rebuilt — a rebuilt peer starts on the
 *                                    live edge and the cursor is gone.
 *   2. background → active           the peer IS rebuilt, and once it plays the
 *                                    host re-enters the recording AT the cursor.
 *   3. play after an error           one press re-enters at the cursor; a rate
 *                                    change alone moved nothing on the hub.
 *
 * The embed half (a position asked for while the new channel is still
 * negotiating is held, not refused) is `held-playback-on-reconnect.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React from 'react'

import i18n from '../../../app/i18n.js'
import { mountScreen } from '../../../testing/mount.js'
import { deliverLayout } from '../../../testing/layout-control.js'
import { emitAppState } from '../../../testing/app-state-control.js'
import { emitWebViewMessage, injectedWebViewScripts } from '../../../testing/webview-control.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA_NAME = 'Front gate'
const PHONE = { width: 390, height: 600 } as const
const EVENT_AGO_MS = 20 * 60_000
const EVENT_SPAN_MS = 12_000
/** Local noon on an ordinary day, so the event sits inside the day's window. */
const PINNED_NOW_MS = new Date(2026, 9, 14, 12, 0, 0, 0).getTime()

interface TracksRequest {
  readonly since: number
  readonly until: number
}

function isTracksRequest(input: unknown): input is TracksRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof Reflect.get(input, 'since') === 'number' &&
    typeof Reflect.get(input, 'until') === 'number'
  )
}

function tracksAnswer(input: unknown): readonly unknown[] {
  if (!isTracksRequest(input)) return []
  const firstSeen = input.until - EVENT_AGO_MS
  if (firstSeen <= input.since) return []
  return [
    {
      trackId: 't1',
      deviceId: 1,
      className: 'person',
      firstSeen,
      lastSeen: firstSeen + EVENT_SPAN_MS,
      state: 'idle',
      active: false,
      zonesVisited: [],
      zoneNames: [],
      classes: ['person'],
      audioLabels: [],
      bestEventId: 'ev-t1',
      source: 'pipeline',
    },
  ]
}

const HUB = {
  'deviceManager.listAll': [
    { id: 1, name: CAMERA_NAME, type: 'camera', isCamera: true, online: true, disabled: false, features: [] },
  ],
  'pipelineAnalytics.listTracks': tracksAnswer,
}

interface PlayerCall {
  readonly method: string
  readonly args: readonly unknown[]
}

const EMBED_CALL = /^try\{window\.__dominevoEmbed\.(\w+)\((.*)\)\}catch\(e\)\{\}; true;$/

function playerCallsSince(from: number): readonly PlayerCall[] {
  return injectedWebViewScripts()
    .slice(from)
    .flatMap((script) => {
      const match = EMBED_CALL.exec(script)
      if (match === null) return []
      const args: unknown = JSON.parse(`[${match[2]}]`)
      return [{ method: match[1], args: Array.isArray(args) ? args : [] }]
    })
}

/** The foreground peer rebuild the host injects (`LiveViewWebView`). */
function reconnectsSince(from: number): number {
  return injectedWebViewScripts()
    .slice(from)
    .filter((script) => script.includes('__dominevoEmbed.reconnect()')).length
}

function embedSays(payload: Record<string, unknown>): void {
  act(() => emitWebViewMessage(payload))
}

function appGoes(next: 'active' | 'inactive' | 'background'): void {
  act(() => emitAppState(next))
}

/**
 * Open the screen, tap the one event, and let the embed confirm it is playing
 * the recording there. Returns the cursor — the instant the player was sent to.
 */
async function enterRecordingAtEvent(): Promise<number> {
  mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), { hub: HUB })
  await screen.findAllByText(CAMERA_NAME)
  deliverLayout(document.body, PHONE)
  embedSays({ type: 'state', state: 'playing' })

  const card = await screen.findByTestId('cluster-card')
  const pill = card.querySelector('[role="button"], button')
  if (pill === null) throw new Error('the event card has no pressable pill')
  const from = injectedWebViewScripts().length
  fireEvent.click(pill)
  await act(async () => undefined)
  const seek = playerCallsSince(from).find((c) => c.method === 'seek')
  const cursor = seek?.args[0]
  if (typeof cursor !== 'number') throw new Error('the event tap sent no seek')

  embedSays({ type: 'position', positionMs: cursor })
  embedSays({ type: 'recState', state: 'playing' })
  return cursor
}

/**
 * The stream's fault in the one fault slot. The stub hub serves no recording
 * coverage, so `recordings` is always failing here: a failing stream shows as
 * the lead of a two-part summary, or alone by its own string.
 */
const streamFault = (): HTMLElement | null =>
  screen.queryByText(i18n.t('v2.timeline.faultStream')) ??
  screen.queryByText(i18n.t('v2.timeline.faultSummary', { count: 2 }))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW_MS, shouldAdvanceTime: true })
  await AsyncStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('recorded playback across the app leaving the foreground', () => {
  it('a notification-shade pull keeps the peer — no rebuild, no fault', async () => {
    await enterRecordingAtEvent()
    const from = injectedWebViewScripts().length

    appGoes('inactive')
    appGoes('active')

    expect(reconnectsSince(from)).toBe(0)
    expect(playerCallsSince(from).filter((c) => c.method === 'goLive')).toHaveLength(0)
    expect(streamFault()).toBeNull()
  })

  it('a return from background rebuilds the peer and re-enters the recording at the cursor', async () => {
    const cursor = await enterRecordingAtEvent()
    const from = injectedWebViewScripts().length

    appGoes('inactive')
    appGoes('background')
    appGoes('inactive')
    appGoes('active')
    expect(reconnectsSince(from)).toBe(1)

    embedSays({ type: 'state', state: 'connecting' })
    embedSays({ type: 'state', state: 'playing' })

    const reasserts = playerCallsSince(from).filter((c) => c.method === 'playRecorded')
    expect(reasserts).toHaveLength(1)
    expect(reasserts[0].args[0]).toBe(1)
    expect(reasserts[0].args[1]).toBe(cursor)
    expect(streamFault()).toBeNull()
  })

  it('one play press after a failed recording re-enters at the cursor', async () => {
    const cursor = await enterRecordingAtEvent()
    // The operator had paused on the frame they were looking at.
    fireEvent.click(screen.getByLabelText(i18n.t('v2.streamBar.pause')))
    await act(async () => undefined)
    embedSays({ type: 'recState', state: 'error' })
    expect(streamFault()).not.toBeNull()

    const from = injectedWebViewScripts().length
    fireEvent.click(screen.getByLabelText(i18n.t('v2.streamBar.play')))
    await act(async () => undefined)

    // One press, one re-entry at the cursor — within the machine's 2 s commit
    // dedupe of the original seek to that same instant, on purpose.
    const seeks = playerCallsSince(from).filter((c) => c.method === 'seek')
    expect(seeks).toHaveLength(1)
    expect(seeks[0].args[0]).toBe(cursor)
    // Landing there clears the fault: the machine is back in playback.
    embedSays({ type: 'position', positionMs: cursor })
    expect(streamFault()).toBeNull()
  })
})
