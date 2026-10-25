/**
 * @vitest-environment jsdom
 *
 * The detail loads the bytes of ONE entry — the selected one — and never the
 * block.
 *
 * Measured on the live hub for a track that "looked empty":
 *   listTrackMedia  →  7 rows in 0.25 s   (metadata; no bytes)
 *   getTrackMedia   →  60 s timeout        (the whole block, disk contention)
 *
 * The block fetch is therefore the failure mode itself, not an optimisation
 * target: while it hangs the modal shows nothing, and nothing reads as "no
 * media". These tests pin the two properties that make that impossible —
 * the call is always restricted to the selected kind, and a failed read
 * announces itself as a failure with a retry instead of vanishing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { useTrackMediaEntry } from '../use-track-media-entry.js'
import type { MediaFileLite } from '../track-events.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 3829
const TRACK_ID = 'a3019e7a-ff67-4098-aae4-20dd552dedbe'

/** Real manifest rows — key, kind, size, stamp, and NO bytes. */
const KEY_FRAME: MediaFileLite = {
  mediaId: 101,
  url: '/addon/pipeline-analytics/event-media/m/101',
  kind: 'keyFrameSmall',
  timestamp: 20,
  sizeBytes: 41_002,
}
const THUMBNAIL: MediaFileLite = {
  mediaId: 102,
  url: '/addon/pipeline-analytics/event-media/m/102',
  kind: 'thumbnail',
  timestamp: 20,
  sizeBytes: 22_140,
}

interface ProbeProps {
  readonly selected: MediaFileLite | null
}

function Probe({ selected }: ProbeProps): React.ReactElement {
  const entry = useTrackMediaEntry(DEVICE_ID, TRACK_ID, selected)
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('span', { 'data-testid': 'status' }, entry.state.status),
    React.createElement('button', { 'data-testid': 'retry', onClick: () => entry.retry() }),
  )
}

function statusText(container: HTMLElement): string {
  return container.querySelector('[data-testid="status"]')?.textContent ?? ''
}

function byteCalls(): readonly { readonly path: string; readonly input: unknown }[] {
  return hubCalls().filter((call) => call.path === 'pipelineAnalytics.getTrackMedia')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The `kinds` each byte call asked for. */
function kindsAsked(): readonly unknown[] {
  return byteCalls().map((call) => (isRecord(call.input) ? call.input.kinds : undefined))
}

// ─── The selection restricts `kinds` ─────────────────────────────────────────

describe('useTrackMediaEntry — one entry, one kind, never the block', () => {
  it('asks getTrackMedia with kinds restricted to the SELECTED kind alone', async () => {
    const { container } = mountScreen(
      React.createElement(Probe, { selected: KEY_FRAME }),
      {
        hub: {
          'pipelineAnalytics.getTrackMedia': [{ ...KEY_FRAME, base64: 'AAAA' }],
        },
      },
    )

    await waitFor(() => expect(statusText(container)).toBe('ready'))

    expect(byteCalls()).toHaveLength(1)
    expect(kindsAsked()).toEqual([['keyFrameSmall']])
  })

  it('a different selection asks for that other kind — still exactly one', async () => {
    const { container } = mountScreen(
      React.createElement(Probe, { selected: THUMBNAIL }),
      {
        hub: {
          'pipelineAnalytics.getTrackMedia': [{ ...THUMBNAIL, base64: 'BBBB' }],
        },
      },
    )

    await waitFor(() => expect(statusText(container)).toBe('ready'))

    expect(kindsAsked()).toEqual([['thumbnail']])
  })

  it('never issues an unrestricted byte read', async () => {
    const { container } = mountScreen(
      React.createElement(Probe, { selected: KEY_FRAME }),
      {
        hub: {
          'pipelineAnalytics.getTrackMedia': [{ ...KEY_FRAME, base64: 'AAAA' }],
        },
      },
    )

    await waitFor(() => expect(statusText(container)).toBe('ready'))

    for (const kinds of kindsAsked()) {
      expect(Array.isArray(kinds)).toBe(true)
      expect(kinds).toHaveLength(1)
    }
  })
})

// ─── The three states, through the real hook ─────────────────────────────────

describe('useTrackMediaEntry — a failed byte read is an ERROR with a retry', () => {
  it('surfaces error (never absent) when the read throws, and retry recovers', async () => {
    let calls = 0
    const { container } = mountScreen(
      React.createElement(Probe, { selected: KEY_FRAME }),
      {
        hub: {
          'pipelineAnalytics.getTrackMedia': () => {
            calls += 1
            if (calls === 1) throw new Error('deadline: disk contention')
            return [{ ...KEY_FRAME, base64: 'AAAA' }]
          },
        },
      },
    )

    await waitFor(() => expect(statusText(container)).toBe('error'))

    container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    await waitFor(() => expect(statusText(container)).toBe('ready'))
  })

  it('an answer that carries no bytes for an INDEXED key is error, not absent', async () => {
    const { container } = mountScreen(
      React.createElement(Probe, { selected: KEY_FRAME }),
      { hub: { 'pipelineAnalytics.getTrackMedia': [] } },
    )

    await waitFor(() => expect(statusText(container)).toBe('error'))
  })

  it('nothing selected is ABSENT, and costs no call at all', async () => {
    const { container } = mountScreen(
      React.createElement(Probe, { selected: null }),
      { hub: { 'pipelineAnalytics.getTrackMedia': [] } },
    )

    await waitFor(() => expect(statusText(container)).toBe('absent'))
    expect(byteCalls()).toHaveLength(0)
  })
})
