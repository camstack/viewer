/**
 * @vitest-environment jsdom
 *
 * The "Analyze the last 100 unassigned" modal, MOUNTED over a fake hub that
 * really changes state — the only harness that can see the defect the operator
 * reported on 2026-09-01: *"assigning through the groups modal, the same groups
 * with the same faces come straight back"*.
 *
 * The hub was cleared by hand first (2026-09-01, live .9 hub):
 * `faceGallery.assignFaces` with the EXACT payload this client sends returned
 * `{assigned:1, failed:[]}`, and the assigned face left both
 * `listRecentFaces{filter:'unassigned'}` and `suggestFaceClusters` on the very
 * next call. The write lands. What did not happen was on this side: the
 * modal's two queries — `face-review-analyze-pool` and `face-review-clusters`
 * — are keyed under NEITHER of the two prefixes `useAssignFaces` invalidates
 * (`track-face`, `face-identities`), and the screen's `onAssigned` refetch
 * reaches only the main grid. With a 30 s `staleTime` on both, re-opening the
 * modal re-rendered the very same cached pool and the very same cached
 * clusters: the same groups, the same faces, assignment after assignment.
 *
 * So the claim held down here is END-TO-END and stated the way the operator
 * would state it: after the batch write, a group whose faces the hub no longer
 * reports as unassigned MUST NOT still be on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { setTestPlatform } from '../../../testing/platform-control.js'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { FaceReviewAnalyzeModal } from '../FaceReviewAnalyzeModal.js'
import type { PersonIdentity } from '../../../data/use-face-gallery.js'
import { useActivityStore } from '../../../activity/activity-instance.js'
import type { JobActivityItem } from '../../../activity/activity-model.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const ALICE = 'alice-id'

const IDENTITIES: readonly PersonIdentity[] = [
  { id: ALICE, name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob-id', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
]

const GROUP_FACE_IDS = ['f1', 'f2', 'f3'] as const

interface HubFaceRow {
  readonly faceId: string
  readonly deviceId: number
  readonly trackId: string
  readonly timestamp: number
  readonly assigned: boolean
  readonly suggestedIdentityId: string
  readonly suggestedMatchScore: number
}

function faceRow(faceId: string, index: number): HubFaceRow {
  return {
    faceId,
    deviceId: 104,
    trackId: `t-${faceId}`,
    timestamp: 1_788_000_000_000 + index,
    assigned: false,
    // A majority vote for a KNOWN person, so the group starts pre-selected on
    // Alice exactly as `seedAnalyzeIdentitySelection` does on the device.
    suggestedIdentityId: ALICE,
    suggestedMatchScore: 0.58,
  }
}

const ALL_FACES: readonly HubFaceRow[] = GROUP_FACE_IDS.map(faceRow)

/** Faces the fake hub has been told to assign — it stops reporting them as
 *  unassigned, precisely as the live hub does. */
let assignedOnHub = new Set<string>()
/** Every `assignFaces` payload the client actually sent. */
let assignCalls: { readonly faceIds: readonly string[]; readonly identityId: string }[] = []

function unassignedRows(): readonly HubFaceRow[] {
  return ALL_FACES.filter((f) => !assignedOnHub.has(f.faceId))
}

interface AssignInput {
  readonly faceIds: readonly string[]
  readonly identityId: string
}

function isAssignInput(input: unknown): input is AssignInput {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as { faceIds?: unknown; identityId?: unknown }
  return Array.isArray(candidate.faceIds) && typeof candidate.identityId === 'string'
}

function hubResponses(assign: (input: AssignInput) => unknown) {
  return {
    'faceGallery.listRecentFaces': () => unassignedRows(),
    'faceGallery.suggestFaceClusters': () => {
      const members = GROUP_FACE_IDS.filter((id) => !assignedOnHub.has(id))
      if (members.length < 2) return []
      return [
        {
          faceIds: members,
          representativeFaceId: members[0],
          size: members.length,
          cohesion: 0.82,
        },
      ]
    },
    'faceGallery.assignFaces': (input?: unknown) => {
      if (!isAssignInput(input)) throw new Error('assignFaces called with a malformed input')
      assignCalls = [...assignCalls, { faceIds: input.faceIds, identityId: input.identityId }]
      return assign(input)
    },
  }
}

/** The hub that accepts the batch, the way the live .9 hub did. */
function acceptingHub() {
  return hubResponses((input) => {
    assignedOnHub = new Set([...assignedOnHub, ...input.faceIds])
    return { assigned: input.faceIds.length, failed: [] }
  })
}

const EXCLUDE = (): string => i18n.t('v2.faceReview.groupExcludeFace')
const ASSIGN = (): string => i18n.t('v2.faceReview.assign')

/** The sheet is a `Modal` — react-native-web portals it out of the render
 *  container and into `document.body`, so every query here reads the body. */
function memberTiles(): HTMLElement[] {
  return [...document.body.querySelectorAll('[role="button"]')].filter(
    (el) => el.getAttribute('aria-label') === EXCLUDE(),
  ) as HTMLElement[]
}

/** The footer's Confirm. It carries no `accessibilityRole`, so it is found by
 *  its LABEL and pressed on the `Pressable` that wraps it — react-native-web
 *  listens on the pressable itself, not on the `Text` inside it. */
function confirmButton(): HTMLElement {
  const pressable = screen.getByText(ASSIGN()).parentElement
  if (pressable === null) throw new Error('the Assign label has no pressable around it')
  return pressable
}

/**
 * The confirmation dialog `useConfirm` draws on the web, found by the role its
 * card carries. Before 2026-09-01 this spec did not look for it: it stubbed
 * `Alert.alert` and pressed button index 1 itself, which is the fake supplying
 * the behaviour production did NOT have — on the browser `Alert.alert` is an
 * empty function and this whole flow was dead.
 */
function dialogButton(label: string): HTMLElement {
  const dialog = document.body.querySelector('[role="alert"]')
  if (dialog === null) throw new Error('no confirmation dialog on screen')
  const button = [...dialog.querySelectorAll('[role="button"]')].find(
    (el) => el.textContent === label,
  )
  if (button === undefined) throw new Error(`the confirmation has no "${label}" button`)
  return button as HTMLElement
}

/**
 * Tap Confirm, then answer the confirmation dialog — for real.
 *
 * The leading flush is load-bearing: the group's pre-selection lands in a
 * state update that commits AFTER the render which first shows the members,
 * and the Confirm button is inert until that commit has painted.
 */
async function pressConfirm(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    fireEvent.click(confirmButton())
  })
  await act(async () => {
    fireEvent.click(dialogButton(ASSIGN()))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** Refuse the confirmation instead of accepting it. */
async function refuseConfirm(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    fireEvent.click(confirmButton())
  })
  await act(async () => {
    fireEvent.click(dialogButton(i18n.t('v2.settings.cancel')))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function sheetText(): string {
  return document.body.textContent ?? ''
}

/** The jobs the confirm handed to the Activity queue. */
function queuedJobs(): readonly JobActivityItem[] {
  return useActivityStore.getState().items.flatMap((item) => (item.kind === 'job' ? [item] : []))
}

/** Wait for the (only) job to finish, then hand it back. */
async function finishedJob(): Promise<JobActivityItem> {
  await waitFor(() => {
    const [job] = queuedJobs()
    expect(job?.state === 'done' || job?.state === 'failed').toBe(true)
  })
  const [job] = queuedJobs()
  if (job === undefined) throw new Error('no job was queued')
  return job
}

function mountModal(hub: Record<string, unknown>) {
  return mountScreen(
    React.createElement(FaceReviewAnalyzeModal, {
      open: true,
      connected: true,
      identities: IDENTITIES,
      serverUrl: 'http://hub.test:8080',
      mediaHeaders: undefined,
      // The screen closes the sheet; this spec keeps it open on purpose, so
      // what the operator sees NEXT is what the assertions read.
      onClose: (): void => undefined,
    }),
    { hub },
  )
}

beforeEach(() => {
  useActivityStore.setState({ items: [] })
  assignedOnHub = new Set()
  assignCalls = []
  // The BROWSER branch on purpose: this is the platform the operator reported
  // the assignment dead on, and the one `Alert.alert` cannot serve.
  setTestPlatform('web')
})

afterEach(() => {
  vi.restoreAllMocks()
  setTestPlatform('ios')
})

describe('the groups modal after a batch assignment', () => {
  it('sends the picked identity and the surviving faces to the hub', async () => {
    mountModal(acceptingHub())
    await waitFor(() => expect(memberTiles()).toHaveLength(3))

    await pressConfirm()

    await waitFor(() =>
      expect(assignCalls).toEqual([{ faceIds: [...GROUP_FACE_IDS], identityId: ALICE }]),
    )
  })

  // ⚠ THE REPORTED DEFECT. The write landed on the hub and the group came
  // straight back, because nothing on this side ever asked the hub again for
  // the pool or the clusters.
  it('does not show the same group again once the hub has taken those faces', async () => {
    mountModal(acceptingHub())
    await waitFor(() => expect(memberTiles()).toHaveLength(3))

    await pressConfirm()

    await waitFor(() => expect(memberTiles()).toHaveLength(0))
    expect(sheetText()).toContain(i18n.t('v2.faceReview.analyzeEmpty'))
  })
})

describe('the confirmation actually gates the write', () => {
  // ⚠ THE OPERATOR'S REPORT, stated as a gate: from a browser this dialog did
  // not exist, so neither answer to it did anything. Both answers are asserted
  // — an accepted one that never writes is the same defect wearing a
  // different face.
  it('writes nothing when the confirmation is refused', async () => {
    mountModal(acceptingHub())
    await waitFor(() => expect(memberTiles()).toHaveLength(3))

    await refuseConfirm()

    expect(assignCalls).toEqual([])
    // …and the groups are still on screen, untouched.
    expect(memberTiles()).toHaveLength(3)
  })
})

describe('a batch the hub refuses is REPORTED, never swallowed', () => {
  // The write is a job on the Activity queue now: the refusal is the job's
  // failure, in the hub's own words, not a banner inside the modal.
  it('fails the job with the hub\'s reason when the whole call throws', async () => {
    mountModal(
      hubResponses(() => {
        throw new Error('promiscuous embedding')
      }),
    )
    await waitFor(() => expect(memberTiles()).toHaveLength(3))

    await pressConfirm()

    const job = await finishedJob()
    expect(job.state).toBe('failed')
    expect(job.error).toContain(i18n.t('v2.faceReview.analyzeAssignFailed'))
    expect(job.error).toContain('promiscuous embedding')
    // The groups are still there — nothing was written, and the modal must not
    // pretend otherwise by emptying itself.
    expect(memberTiles()).toHaveLength(3)
  })

  it('reports the per-face failures the hub reports inside a successful call', async () => {
    mountModal(
      hubResponses(() => ({ assigned: 1, failed: ['f2', 'f3'] })),
    )
    await waitFor(() => expect(memberTiles()).toHaveLength(3))

    await pressConfirm()

    const job = await finishedJob()
    expect(job.state).toBe('done')
    expect(job.summary).toContain(i18n.t('v2.faceReview.analyzeAssignFailed'))
  })
})
