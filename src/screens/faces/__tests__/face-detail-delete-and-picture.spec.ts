/**
 * @vitest-environment jsdom
 *
 * The face detail, mounted on the People page over a stubbed hub (operator,
 * 2026-10-23): a face can be DELETED from its own detail, and the detail shows
 * the FULL PICTURE the crop was cut from — or says the hub kept none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import i18n from '../../../app/i18n.js'
import { FaceReviewScreen } from '../FaceReviewScreen.js'
import {
  FaceReviewDetailModal,
  type FaceReviewDetailModalProps,
} from '../../../components/faces/FaceReviewDetailModal.js'
import type { FaceReviewRow } from '../../../data/face-cluster-review.js'
import { isRecord } from '../../../data/cap-query.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

interface FaceRow {
  readonly faceId: string
  readonly deviceId: number
  readonly trackId: string
  readonly timestamp: number
  readonly assigned: boolean
  readonly cropUrl: string
  readonly recognizedIdentityId?: string
  readonly keyFrameMediaId?: number
  readonly faceBbox?: { x: number; y: number; w: number; h: number }
}

const NOW = Date.now()
const PARKED: FaceRow = {
  faceId: 'f-parked',
  deviceId: 7,
  trackId: 'trk-1',
  timestamp: NOW - 1_000,
  assigned: false,
  cropUrl: '/addon/pipeline-analytics/event-media/m/11',
  keyFrameMediaId: 4242,
  faceBbox: { x: 100, y: 50, w: 40, h: 40 },
}
const LEGACY: FaceRow = {
  faceId: 'f-legacy',
  deviceId: 7,
  trackId: 'trk-2',
  timestamp: NOW - 2_000,
  assigned: false,
  cropUrl: '/addon/pipeline-analytics/event-media/m/12',
}
const ALICE_FACE: FaceRow = {
  faceId: 'f-alice',
  deviceId: 7,
  trackId: 'trk-3',
  timestamp: NOW - 3_000,
  assigned: true,
  recognizedIdentityId: 'alice',
  cropUrl: '/addon/pipeline-analytics/event-media/m/13',
}

let onHub: readonly FaceRow[] = []

/** A string field of a hub call's input, or '' — a guard, not a cast. */
function textField(input: unknown, key: string): string {
  const value = isRecord(input) ? input[key] : undefined
  return typeof value === 'string' ? value : ''
}

/** The custom action an `addons.custom` call names, and its own input. */
interface CustomCall {
  readonly action: string
  readonly args: unknown
}

function customCall(input: unknown): CustomCall {
  return { action: textField(input, 'action'), args: isRecord(input) ? input['input'] : undefined }
}

function hub(): Record<string, unknown> {
  return {
    'faceGallery.listRecentFaces': () => onHub,
    'faceGallery.listIdentities': () => [
      { id: 'alice', name: 'Alice', sampleCount: 1 },
      { id: 'bob', name: 'Bob', sampleCount: 3 },
    ],
    'addons.custom': (input: unknown) => {
      const { action, args } = customCall(input)
      const trackId = textField(args, 'trackId')
      // The screen also polls `face.rescoreStatus`; an old hub without it is a
      // path the screen already handles, and this test is about one face.
      if (action !== 'face.rescoreTrack') throw new Error(`addon has no custom action '${action}'`)
      return {
        faceId: trackId === PARKED.trackId ? PARKED.faceId : 'other',
        deviceId: 7,
        trackId,
        assigned: false,
        verdict: 'suggestion',
        comparable: true,
        probeModelId: 'm',
        clusterModelId: 'm',
        params: { threshold: 0.6, margin: 0.05, minIdentitySamples: 2, suggestionMinCosine: 0.3 },
        identities: [
          { identityId: 'alice', name: 'Alice', score: 0.31, sampleCount: 1, eligible: false, meetsThreshold: false, wouldAutoAssign: false },
          { identityId: 'bob', name: 'Bob', score: 0.47, sampleCount: 3, eligible: true, meetsThreshold: false, wouldAutoAssign: false },
        ],
        reembedAvailable: false,
        reembed: { attempted: false, succeeded: false },
      }
    },
    'faceGallery.deleteFace': (input: unknown) => {
      const faceId = textField(input, 'faceId')
      onHub = onHub.filter((r) => r.faceId !== faceId)
      return undefined
    },
  }
}

beforeEach(() => {
  onHub = [PARKED, LEGACY, ALICE_FACE]
  // The browser branch of `useConfirm` draws a dialog a test can answer.
  setTestPlatform('web')
})
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

function tileFor(faceId: string): HTMLElement {
  const crop = document.body.querySelector(`[data-testid$="/m/${faceId === PARKED.faceId ? 11 : faceId === LEGACY.faceId ? 12 : 13}"]`)
  if (crop === null) throw new Error(`no tile for ${faceId}`)
  const pressable = crop.closest('[role="button"]')
  if (!(pressable instanceof HTMLElement)) throw new Error(`the tile for ${faceId} is not pressable`)
  return pressable
}

async function openDetail(faceId: string): Promise<void> {
  mountScreen(React.createElement(FaceReviewScreen), { hub: hub() })
  await waitFor(() => {
    tileFor(faceId)
  })
  await act(async () => {
    fireEvent.click(tileFor(faceId))
  })
  await screen.findByTestId('face-full-picture')
}

function dialogButton(label: string): HTMLElement {
  const dialog = document.body.querySelector('[role="alert"]')
  if (dialog === null) throw new Error('no confirmation dialog on screen')
  const button = [...dialog.querySelectorAll('[role="button"]')].find((el) => el.textContent === label)
  if (!(button instanceof HTMLElement)) throw new Error(`the confirmation has no "${label}" button`)
  return button
}

function listReads(): number {
  return hubCalls().filter((c) => c.path === 'faceGallery.listRecentFaces').length
}

describe('deleting a face from its detail', () => {
  it('asks first, then calls faceGallery.deleteFace for THAT face and re-reads the list', async () => {
    await openDetail(PARKED.faceId)
    await act(async () => {
      fireEvent.click(screen.getByTestId('face-detail-delete'))
    })
    // Nothing is written before the operator answers.
    expect(hubCalls().some((c) => c.path === 'faceGallery.deleteFace')).toBe(false)
    const readsBefore = listReads()
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.faceReview.deleteOne')))
    })
    await waitFor(() => {
      expect(hubCalls().filter((c) => c.path === 'faceGallery.deleteFace').map((c) => c.input)).toEqual([
        { faceId: PARKED.faceId },
      ])
    })
    // The mutation invalidated the People queries: the list was asked again.
    await waitFor(() => {
      expect(listReads()).toBeGreaterThan(readsBefore)
    })
    expect(screen.queryByTestId('face-full-picture')).toBeNull()
  })

  it('writes nothing when the operator cancels', async () => {
    await openDetail(PARKED.faceId)
    await act(async () => {
      fireEvent.click(screen.getByTestId('face-detail-delete'))
    })
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.settings.cancel')))
    })
    expect(hubCalls().some((c) => c.path === 'faceGallery.deleteFace')).toBe(false)
    expect(screen.getByTestId('face-full-picture')).toBeTruthy()
  })

  // Mounted bare: whether the People page's default filters even show an
  // assigned face is the list's business, not this rule's.
  it('is not offered for a face that belongs to a person', async () => {
    const assigned: FaceReviewRow = {
      faceId: ALICE_FACE.faceId,
      deviceId: 7,
      cameraName: 'Door',
      trackId: ALICE_FACE.trackId,
      timestamp: ALICE_FACE.timestamp,
      cropUrl: ALICE_FACE.cropUrl,
      base64: undefined,
      status: 'assigned',
      assignedIdentityName: 'Alice',
      suggestedIdentityId: undefined,
      suggestedIdentityName: undefined,
      suggestedMatchScore: undefined,
      certainty: undefined,
    }
    const props: FaceReviewDetailModalProps = {
      rows: [assigned],
      identities: [],
      cropUriFor: () => null,
      mediaHeaders: undefined,
      pending: false,
      onAssign: () => undefined,
      onCreate: () => undefined,
      fullPictureFor: () => null,
      onOpenTrack: () => undefined,
      onDelete: () => undefined,
      onClose: () => undefined,
    }
    mountScreen(React.createElement(FaceReviewDetailModal, props), { hub: hub() })
    await screen.findByTestId('face-full-picture')
    expect(screen.queryByTestId('face-detail-delete')).toBeNull()
  })
})

describe('the full picture', () => {
  it('shows the track key frame when the face names one', async () => {
    await openDetail(PARKED.faceId)
    const picture = screen.getByTestId('face-full-picture')
    expect(picture.querySelector('[data-testid$="/event-media/m/4242"]')).not.toBeNull()
    expect(screen.queryByTestId('face-full-picture-absent')).toBeNull()
    expect(screen.getByTestId('face-open-track')).toBeTruthy()
  })

  it('says the hub kept none when the face names no key frame', async () => {
    await openDetail(LEGACY.faceId)
    expect(screen.getByTestId('face-full-picture-absent').textContent).toBe(
      i18n.t('v2.faceReview.fullPictureAbsent'),
    )
    expect(screen.getByTestId('face-full-picture').querySelector('[data-testid*="/event-media/m/"]')).toBeNull()
  })
})

// Issue 557: recompute one photo and see every person's % on the list.
describe('recompute from the face detail', () => {
  it('scores the face against every person and puts the best first', async () => {
    await openDetail(PARKED.faceId)
    await act(async () => {
      fireEvent.click(screen.getByTestId('face-rescore'))
    })
    await screen.findByText('47%')
    expect(screen.getByText('31%')).toBeTruthy()
    const call = hubCalls().find(
      (c) => c.path === 'addons.custom' && customCall(c.input).action === 'face.rescoreTrack',
    )
    expect(call?.input).toMatchObject({ action: 'face.rescoreTrack', input: { deviceId: 7, trackId: PARKED.trackId } })
    const names = [...document.body.querySelectorAll('[role="button"]')]
      .map((el) => el.textContent ?? '')
      .filter((text) => text.startsWith('Alice') || text.startsWith('Bob'))
    expect(names[0]).toContain('Bob')
  })
})
