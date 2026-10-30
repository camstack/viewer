/**
 * @vitest-environment jsdom
 *
 * Downloading an event: the card's icon opens the dialog for the ACTIVE event
 * without seeking, the clip's Save is gated on recorded coverage and queues the
 * same `createExport` a timeline selection does, and the snapshot's high
 * resolution is refused with a reason when the event has no full variant.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../../testing/platform-control.js'
import { ClusterCard, CLUSTER_EVENT_DOWNLOAD_TEST_ID } from '../ClusterCard.js'
import {
  EventDownloadModal,
  EVENT_DOWNLOAD_MODAL_TEST_ID,
  EVENT_DOWNLOAD_SAVE_TEST_ID,
  EVENT_DOWNLOAD_SNAPSHOT_OPTION_TEST_ID,
} from '../EventDownloadModal.js'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

// The web presentation: the dialog is a centred dialog and a confirmation is
// rendered in-app, where the test can see it (native hands it to the OS).
beforeAll(() => setTestPlatform('web'))
afterAll(() => setTestPlatform('ios'))
afterEach(cleanup)

const START = Date.parse('2026-09-07T10:00:00Z')
const END = START + 12_000
const DAY_FROM = START - 3_600_000
const DAY_TO = START + 3_600_000

const EVENT: ObjectEvent = {
  id: 'e1',
  deviceId: 7,
  trackId: 't1',
  className: 'person',
  timestamp: START,
  endTimestamp: END,
}

const CREATED = {
  id: 'exp-1',
  deviceId: 7,
  state: 'queued',
  createdAt: START,
  profiles: ['high'],
}

const MANIFEST_WITH_FULL = [
  { mediaId: 2, url: 'm/2', kind: 'keyFrame', sizeBytes: 411_002, timestamp: START },
  { mediaId: 3, url: 'm/3', kind: 'keyFrameSmall', sizeBytes: 41_002, timestamp: START },
]
const MANIFEST_SMALL_ONLY = [
  { mediaId: 3, url: 'm/3', kind: 'thumbnail', sizeBytes: 22_140, timestamp: START },
]

function mountModal(
  coverage: readonly { startMs: number; endMs: number }[],
  manifest: readonly unknown[] = MANIFEST_WITH_FULL,
): void {
  mountScreen(
    React.createElement(EventDownloadModal, {
      event: EVENT,
      cameraName: 'Driveway',
      coverage,
      windowFromMs: DAY_FROM,
      windowToMs: DAY_TO,
      onClose: () => undefined,
    }),
    {
      hub: {
        'recordingExport.createExport': () => CREATED,
        'pipelineAnalytics.listTrackMedia': manifest,
      },
    },
  )
}

const saveButton = (): HTMLElement => {
  const el = document.body.querySelector<HTMLElement>(`[data-testid="${EVENT_DOWNLOAD_SAVE_TEST_ID}"]`)
  expect(el).not.toBeNull()
  return el as HTMLElement
}
const isDisabled = (el: HTMLElement): boolean =>
  el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')
const creates = (): readonly unknown[] =>
  hubCalls().filter((c) => c.path === 'recordingExport.createExport').map((c) => c.input)

function pressText(label: string): void {
  const el = [...document.body.querySelectorAll<HTMLElement>('[role="button"], [role="tab"], button')].find(
    (n) => n.textContent === label,
  )
  expect(el, label).toBeDefined()
  fireEvent.click(el as HTMLElement)
}

describe('the card icon', () => {
  function card(onDownloadEvent: ((e: ObjectEvent) => void) | undefined, onPress: () => void) {
    const [cluster] = clusterByZoom([EVENT], { topMs: START + 1_000, zoomIndex: 0, sizePx: 200, gapPx: 8 })
    return mountScreen(
      React.createElement(ClusterCard, {
        cluster,
        width: 260,
        onPress,
        ...(onDownloadEvent !== undefined ? { onDownloadEvent } : {}),
      }),
    )
  }

  it('hands the active event to the dialog and does not seek', () => {
    const onDownloadEvent = vi.fn()
    const onPress = vi.fn()
    const { container } = card(onDownloadEvent, onPress)
    const icon = container.querySelector(`[data-testid="${CLUSTER_EVENT_DOWNLOAD_TEST_ID}"]`)
    expect(icon).not.toBeNull()
    fireEvent.click(icon as Element)
    expect(onDownloadEvent).toHaveBeenCalledTimes(1)
    expect(onDownloadEvent.mock.calls[0]?.[0]?.id).toBe('e1')
    expect(onPress).not.toHaveBeenCalled()
  })

  it('draws no icon when the surface offers no download', () => {
    const { container } = card(undefined, vi.fn())
    expect(container.querySelector('[data-testid="cluster-card"]')).not.toBeNull()
    expect(container.querySelector(`[data-testid="${CLUSTER_EVENT_DOWNLOAD_TEST_ID}"]`)).toBeNull()
  })

  it('the timeline mounts the dialog for that icon, in normal mode only', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/camera/theater/TheaterTimeline.tsx'), 'utf8')
    expect(src).toContain('onClusterDownloadEvent: clipsMode ? undefined : setDownloadEvent')
    expect(src).toContain('<EventDownloadModal')
  })
})

describe('the clip', () => {
  it('opens on the clip with its span, five seconds each side', async () => {
    mountModal([{ startMs: DAY_FROM, endMs: DAY_TO }])
    await act(async () => undefined)
    expect(document.body.querySelector(`[data-testid="${EVENT_DOWNLOAD_MODAL_TEST_ID}"]`)).not.toBeNull()
    // 5 + 12 + 5 s
    expect(document.body.textContent).toContain('22s')
  })

  it('saves through createExport with the padded bounds', async () => {
    mountModal([{ startMs: DAY_FROM, endMs: DAY_TO }])
    await act(async () => undefined)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0]).toMatchObject({ deviceId: 7, fromMs: START - 5_000, toMs: END + 5_000 })
  })

  it('a longer lead-in widens the exported span', async () => {
    mountModal([{ startMs: DAY_FROM, endMs: DAY_TO }])
    await act(async () => undefined)
    // The first "30 s" is the Before row's.
    const thirty = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].filter(
      (n) => n.textContent === '30 s',
    )
    await act(async () => {
      fireEvent.click(thirty[0] as HTMLElement)
    })
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0]).toMatchObject({ fromMs: START - 30_000, toMs: END + 5_000 })
  })

  it('refuses Save with a reason when nothing was recorded under the clip', async () => {
    mountModal([{ startMs: DAY_FROM, endMs: START - 60_000 }])
    await act(async () => undefined)
    expect(isDisabled(saveButton())).toBe(true)
    expect(document.body.textContent).toContain('Nothing was recorded in this period.')
    await act(async () => {
      fireEvent.click(saveButton())
    })
    expect(creates()).toHaveLength(0)
  })

  it('a partly recorded clip says so and asks before it queues', async () => {
    mountModal([{ startMs: START, endMs: DAY_TO }])
    await act(async () => undefined)
    expect(document.body.textContent).toContain('Part of this period was not recorded.')
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(document.body.querySelector('[role="alert"]')).not.toBeNull())
    expect(creates()).toHaveLength(0)
    // Confirming the gap is what queues it.
    const dialog = document.body.querySelector('[role="alert"]') as HTMLElement
    const confirm = [...dialog.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (n) => n.textContent === 'Export anyway',
    )
    expect(confirm).toBeDefined()
    await act(async () => {
      fireEvent.click(confirm as HTMLElement)
    })
    await waitFor(() => expect(creates()).toHaveLength(1))
  })
})

describe('the snapshot', () => {
  const options = (): readonly HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>(
      `[data-testid="${EVENT_DOWNLOAD_SNAPSHOT_OPTION_TEST_ID}"]`,
    ),
  ]

  it('offers both resolutions when the event has a full variant', async () => {
    mountModal([], MANIFEST_WITH_FULL)
    await act(async () => undefined)
    await act(async () => {
      pressText('Snapshot')
    })
    await waitFor(() => expect(options().length).toBe(2))
    await waitFor(() => expect(isDisabled(options()[0] as HTMLElement)).toBe(false))
  })

  it('draws high disabled, with the reason, when there is no full variant', async () => {
    mountModal([], MANIFEST_SMALL_ONLY)
    await act(async () => undefined)
    await act(async () => {
      pressText('Snapshot')
    })
    await waitFor(() =>
      expect(document.body.textContent).toContain('This event has no full-resolution image.'),
    )
    expect(isDisabled(options()[0] as HTMLElement)).toBe(true)
    expect(isDisabled(options()[1] as HTMLElement)).toBe(false)
  })
})
