/**
 * "Apply suggestion" over a multi-selection — the all-or-nothing gate and the
 * grouped write behind it (`face-review-suggestions.ts`).
 *
 * The rows here are built by the REAL classifier (`buildFaceReviewRows`) from
 * `TrackFace` fixtures rather than hand-written literals: what counts as "has a
 * suggestion" is then the same predicate the grid paints from, and a change to
 * the classification cannot leave this spec agreeing with itself while the
 * screen disagrees.
 */
import { describe, it, expect } from 'vitest'
import { buildFaceReviewRows, type FaceReviewRow } from '../face-cluster-review.js'
import {
  groupRowsBySuggestedIdentity,
  suggestionApplyReadiness,
  suggestionPlanFaceCount,
} from '../face-review-suggestions.js'
import type { PersonIdentity, TrackFace } from '../use-face-gallery.js'

const IDENTITIES: readonly PersonIdentity[] = [
  { id: 'alice', name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
  { id: 'carol', name: 'Carol', sampleCount: 1, coverMediaId: undefined, coverBase64: undefined },
]
const NO_CAMERAS: ReadonlyMap<number, string> = new Map()

function face(overrides: Partial<TrackFace> & { readonly faceId: string }): TrackFace {
  return {
    faceId: overrides.faceId,
    deviceId: overrides.deviceId ?? 1,
    trackId: overrides.trackId ?? `t-${overrides.faceId}`,
    timestamp: overrides.timestamp ?? 0,
    assigned: overrides.assigned ?? false,
    identityId: overrides.identityId,
    identityName: overrides.identityName,
    cropUrl: overrides.cropUrl,
    base64: overrides.base64,
    bestMatchScore: overrides.bestMatchScore,
    nativeFaceShortSidePx: overrides.nativeFaceShortSidePx,
    suggestedIdentityId: overrides.suggestedIdentityId,
    suggestedMatchScore: overrides.suggestedMatchScore,
  }
}

/** A face the recognizer put a name on. `score` decides the certainty band. */
function suggested(faceId: string, identityId: string, score: number): TrackFace {
  return face({ faceId, suggestedIdentityId: identityId, suggestedMatchScore: score })
}

function rowsOf(faces: readonly TrackFace[]): FaceReviewRow[] {
  return buildFaceReviewRows(faces, IDENTITIES, NO_CAMERAS)
}

describe('suggestionApplyReadiness — the all-or-nothing gate', () => {
  it('is ready when every selected face carries its own suggestion', () => {
    const readiness = suggestionApplyReadiness(
      rowsOf([suggested('f1', 'alice', 0.9), suggested('f2', 'bob', 0.7)]),
    )
    expect(readiness.ready).toBe(true)
    expect(readiness.selected).toBe(2)
    expect(readiness.missing).toBe(0)
  })

  // ⚠ LOAD-BEARING: the operator decision is that a mixed selection does not
  // half-fire. A plan that carried only the suggested ones would drop the rest
  // silently, which is the failure this whole gate exists to prevent.
  it('is NOT ready on a mixed selection, and says how many faces are the reason', () => {
    const readiness = suggestionApplyReadiness(
      rowsOf([suggested('f1', 'alice', 0.9), face({ faceId: 'f2' }), face({ faceId: 'f3' })]),
    )
    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toBe(2)
    expect(readiness.plan).toEqual([])
  })

  // An already-assigned face has no `suggestedIdentityId` either — it is just
  // as much a blocker, and for the same reason: there is nothing to apply.
  it('counts an already-assigned face as one with no suggestion', () => {
    const readiness = suggestionApplyReadiness(
      rowsOf([suggested('f1', 'alice', 0.9), face({ faceId: 'f2', identityId: 'bob', identityName: 'Bob' })]),
    )
    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toBe(1)
  })

  it('an empty selection is not ready, and has nothing to explain', () => {
    expect(suggestionApplyReadiness([])).toEqual({ selected: 0, missing: 0, ready: false, plan: [] })
  })

  // ⚠ LOAD-BEARING: certainty is NOT a filter here. This is the requested use
  // case — skim a screen of weak suggestions, agree with them, apply the lot.
  // Certainty informs the SELECTION (the bar on each cell); it must not
  // silently veto it afterwards.
  it('applies an uncertain suggestion exactly like a near-certain one', () => {
    const readiness = suggestionApplyReadiness(
      rowsOf([suggested('f1', 'alice', 0.05), suggested('f2', 'alice', 0.99)]),
    )
    expect(readiness.ready).toBe(true)
    expect(readiness.plan).toEqual([{ identityId: 'alice', name: 'Alice', faceIds: ['f1', 'f2'] }])
  })
})

describe('grouping — one call per identity, never one per face', () => {
  it('groups 7 faces over 3 people into 3 entries', () => {
    const rows = rowsOf([
      suggested('f1', 'alice', 0.9),
      suggested('f2', 'bob', 0.8),
      suggested('f3', 'alice', 0.7),
      suggested('f4', 'carol', 0.6),
      suggested('f5', 'alice', 0.5),
      suggested('f6', 'bob', 0.4),
      suggested('f7', 'alice', 0.3),
    ])
    const readiness = suggestionApplyReadiness(rows)
    expect(readiness.ready).toBe(true)
    // First-seen order, face ids in row order — the write is reproducible.
    expect(readiness.plan).toEqual([
      { identityId: 'alice', name: 'Alice', faceIds: ['f1', 'f3', 'f5', 'f7'] },
      { identityId: 'bob', name: 'Bob', faceIds: ['f2', 'f6'] },
      { identityId: 'carol', name: 'Carol', faceIds: ['f4'] },
    ])
    // ⚠ The point of the grouping: 7 faces cost 3 calls, not 7.
    expect(readiness.plan.length).toBe(3)
    expect(suggestionPlanFaceCount(readiness.plan)).toBe(rows.length)
  })

  it('a selection all pointing at one person is a SINGLE call', () => {
    const readiness = suggestionApplyReadiness(
      rowsOf(['f1', 'f2', 'f3', 'f4'].map((id) => suggested(id, 'bob', 0.6))),
    )
    expect(readiness.plan).toEqual([{ identityId: 'bob', name: 'Bob', faceIds: ['f1', 'f2', 'f3', 'f4'] }])
  })

  // The grouping key is the identity ID, never the display name: two people
  // may legitimately share a name, and the write must not merge them.
  it('groups by identity id, and carries the name only for the banner', () => {
    const twins: readonly PersonIdentity[] = [
      { id: 'a1', name: 'Alice', sampleCount: 1, coverMediaId: undefined, coverBase64: undefined },
      { id: 'a2', name: 'Alice', sampleCount: 1, coverMediaId: undefined, coverBase64: undefined },
    ]
    const rows = buildFaceReviewRows(
      [suggested('f1', 'a1', 0.9), suggested('f2', 'a2', 0.9)],
      twins,
      NO_CAMERAS,
    )
    expect(groupRowsBySuggestedIdentity(rows).map((e) => e.identityId)).toEqual(['a1', 'a2'])
  })

  it('ignores the rows with no suggestion rather than inventing a target', () => {
    const rows = rowsOf([face({ faceId: 'f1' }), suggested('f2', 'bob', 0.6)])
    expect(groupRowsBySuggestedIdentity(rows)).toEqual([{ identityId: 'bob', name: 'Bob', faceIds: ['f2'] }])
  })
})
