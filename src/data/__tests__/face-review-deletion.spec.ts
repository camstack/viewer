/**
 * The rule behind "delete the parked faces".
 *
 * Operator, 2026-09-13: *"non esiste una funzione di cancellazione samples
 * parcheggiati"* — the review grid could assign a face and detach a face, and
 * nothing at all could get rid of one. A crop of the back of a head, a blurred
 * half-face, a wall: they stay in the buffer forever, and they are the ones the
 * operator scrolls past every single pass.
 *
 * The hub has `faceGallery.deleteFace`, and its contract is narrow — *"Delete
 * an UNASSIGNED face from the buffer (row + its crop media)"*. That narrowness
 * is the whole rule here: a face that belongs to a person is not parked, and
 * offering to delete it would either be refused by the hub or would quietly
 * take a sample out of somebody's gallery through a door marked "tidy up".
 * Detaching first is a different, reversible decision the operator already has.
 */
import { describe, expect, it } from 'vitest'

import { faceDeletionReadiness } from '../face-review-deletion.js'
import type { FaceReviewRow, FaceReviewStatus } from '../face-cluster-review.js'

function row(faceId: string, status: FaceReviewStatus): FaceReviewRow {
  return {
    faceId,
    deviceId: 101,
    cameraName: 'Gate',
    trackId: `t-${faceId}`,
    timestamp: 1_700_000_000_000,
    cropUrl: undefined,
    base64: undefined,
    status,
    assignedIdentityName: status === 'assigned' ? 'Alice' : undefined,
    suggestedIdentityId: status === 'suggested' ? 'alice-id' : undefined,
    suggestedIdentityName: status === 'suggested' ? 'Alice' : undefined,
    suggestedMatchScore: status === 'suggested' ? 0.55 : undefined,
    certainty: undefined,
  }
}

describe('faceDeletionReadiness', () => {
  it('deletes a plain unassigned face', () => {
    const readiness = faceDeletionReadiness([row('a', 'unassigned')])
    expect(readiness.ready).toBe(true)
    expect(readiness.faceIds).toEqual(['a'])
    expect(readiness.blocked).toBe(0)
  })

  // A SUGGESTION is not an assignment — the cap's own words: "the face stays
  // UNASSIGNED and everything else keeps treating it as unrecognized". A face
  // the recognizer merely guessed at is exactly the kind the operator wants
  // gone when the guess is nonsense.
  it('deletes a face that only carries a suggestion', () => {
    const readiness = faceDeletionReadiness([row('a', 'suggested')])
    expect(readiness.ready).toBe(true)
    expect(readiness.faceIds).toEqual(['a'])
  })

  // ⚠ LOAD-BEARING: `deleteFace` takes the row AND its crop media. Aimed at an
  // assigned face it is a gallery edit wearing a broom.
  it('refuses the whole batch when a face belongs to a person', () => {
    const readiness = faceDeletionReadiness([row('a', 'unassigned'), row('b', 'assigned')])
    expect(readiness.ready).toBe(false)
    expect(readiness.blocked).toBe(1)
    // And it names NO target, so a caller that ignores `ready` still writes
    // nothing. A partial delete is work dropped without saying so.
    expect(readiness.faceIds).toEqual([])
  })

  it('is not ready over an empty selection, and has nothing to explain', () => {
    const readiness = faceDeletionReadiness([])
    expect(readiness.ready).toBe(false)
    expect(readiness.blocked).toBe(0)
    expect(readiness.selected).toBe(0)
  })

  it('counts what it was given', () => {
    const readiness = faceDeletionReadiness([row('a', 'unassigned'), row('b', 'suggested')])
    expect(readiness.selected).toBe(2)
    expect(readiness.faceIds).toEqual(['a', 'b'])
  })
})
