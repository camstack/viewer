/**
 * Pure derivation logic for the face review tab (redesigned 2026-08-26) — no
 * hub involved. See `../face-cluster-review.ts`'s module doc for what each
 * piece is for: the main grid (one row per FACE, never a group vote), the
 * "Analyze last 100 unassigned" modal (clustering lives ONLY here now,
 * including the per-face exclusions), and the "Recompute suggestions" button.
 *
 * Sorting, filtering and multi-selection moved to `face-review-filters.ts` —
 * see `face-review-filters.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  toFaceCluster,
  toFaceClusters,
  deriveClusterProposal,
  faceSuggestionCertainty,
  buildFaceReviewRows,
  restrictClustersToPool,
  buildAnalyzeGroupRows,
  buildAnalyzeAssignPlan,
  includedGroupFaceIds,
  toggleGroupFaceExclusion,
  analyzeCoverage,
  seedAnalyzeIdentitySelection,
  setAnalyzeGroupIdentity,
  runWithConcurrency,
  type AnalyzeGroupRow,
  type FaceCluster,
} from '../face-cluster-review.js'
import type { TrackFace, PersonIdentity } from '../use-face-gallery.js'

/** Build a minimal TrackFace for these tests — only the fields the
 *  derivation logic reads are meaningful; the rest are harmless defaults. */
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

const IDENTITIES: readonly PersonIdentity[] = [
  { id: 'alice', name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
]
const IDENTITY_NAMES = new Map(IDENTITIES.map((i) => [i.id, i.name]))
const CAMERA_NAMES: ReadonlyMap<number, string> = new Map([
  [1, 'Front door'],
  [2, 'Garden'],
])

describe('toFaceCluster / toFaceClusters — suggestFaceClusters row narrowing', () => {
  it('parses a valid cluster', () => {
    const c = toFaceCluster({ faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.81 })
    expect(c).toEqual({ faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.81 })
  })

  it('clamps an out-of-range cohesion into 0..1', () => {
    expect(toFaceCluster({ faceIds: ['f1'], representativeFaceId: 'f1', size: 1, cohesion: 1.4 })?.cohesion).toBe(1)
    expect(toFaceCluster({ faceIds: ['f1'], representativeFaceId: 'f1', size: 1, cohesion: -0.2 })?.cohesion).toBe(0)
  })

  it('rejects malformed rows without throwing', () => {
    expect(toFaceCluster(null)).toBeNull()
    expect(toFaceCluster({})).toBeNull()
    expect(toFaceCluster({ faceIds: 'nope', representativeFaceId: 'f1' })).toBeNull()
    expect(toFaceCluster({ faceIds: [], representativeFaceId: 'f1' })).toBeNull()
  })

  it('toFaceClusters drops malformed rows and keeps the rest', () => {
    expect(
      toFaceClusters([{ faceIds: ['f1'], representativeFaceId: 'f1', size: 1, cohesion: 0.5 }, null, { faceIds: [] }]),
    ).toEqual([{ faceIds: ['f1'], representativeFaceId: 'f1', size: 1, cohesion: 0.5 }])
    expect(toFaceClusters('nope')).toEqual([])
  })
})

describe('faceSuggestionCertainty — the score → word mapping (load-bearing)', () => {
  // These thresholds are NOT invented for this screen — they are
  // `face-confidence.ts`'s existing `FACE_CONFIDENCE_GOOD_THRESHOLD` (0.75)
  // and `FACE_CONFIDENCE_MEDIUM_THRESHOLD` (0.62), reused so a colour/word
  // means the same thing everywhere in the app.
  it('bands >= 0.75 as certain', () => {
    expect(faceSuggestionCertainty(0.75)).toBe('certain')
    expect(faceSuggestionCertainty(0.9)).toBe('certain')
    expect(faceSuggestionCertainty(1)).toBe('certain')
  })

  it('bands [0.62, 0.75) as probable', () => {
    expect(faceSuggestionCertainty(0.62)).toBe('probable')
    expect(faceSuggestionCertainty(0.7)).toBe('probable')
    expect(faceSuggestionCertainty(0.7499)).toBe('probable')
  })

  it('bands < 0.62 as uncertain', () => {
    expect(faceSuggestionCertainty(0.61999)).toBe('uncertain')
    expect(faceSuggestionCertainty(0.2)).toBe('uncertain')
    expect(faceSuggestionCertainty(0)).toBe('uncertain')
  })
})

describe('buildFaceReviewRows — one row per FACE, never a group vote', () => {
  it('an assigned face becomes status:"assigned" with no suggestion fields set', () => {
    const rows = buildFaceReviewRows(
      [face({ faceId: 'f1', identityId: 'alice', identityName: 'Alice' })],
      IDENTITIES,
      CAMERA_NAMES,
    )
    expect(rows).toEqual([
      {
        faceId: 'f1',
        deviceId: 1,
        cameraName: 'Front door',
        trackId: 't-f1',
        timestamp: 0,
        cropUrl: undefined,
        base64: undefined,
        status: 'assigned',
        assignedIdentityName: 'Alice',
        suggestedIdentityId: undefined,
        suggestedIdentityName: undefined,
        suggestedMatchScore: undefined,
        certainty: undefined,
      },
    ])
  })

  it('falls back to the identity map when the face carries no identityName', () => {
    const rows = buildFaceReviewRows([face({ faceId: 'f1', identityId: 'bob' })], IDENTITIES, CAMERA_NAMES)
    expect(rows[0]?.assignedIdentityName).toBe('Bob')
  })

  it('resolves the camera name from the shared device list, and never invents one', () => {
    const rows = buildFaceReviewRows(
      [face({ faceId: 'f1', deviceId: 2 }), face({ faceId: 'f2', deviceId: 102 })],
      IDENTITIES,
      CAMERA_NAMES,
    )
    expect(rows[0]?.cameraName).toBe('Garden')
    // A device the camera list does not carry stays UNDEFINED — the cell
    // renders `#102` rather than an empty label that reads as "no camera".
    expect(rows[1]?.cameraName).toBeUndefined()
  })

  it('a face with a suggestion (and no assignment) becomes status:"suggested" from ITS OWN score', () => {
    const rows = buildFaceReviewRows(
      [face({ faceId: 'f1', suggestedIdentityId: 'alice', suggestedMatchScore: 0.8 })],
      IDENTITIES,
      CAMERA_NAMES,
    )
    expect(rows[0]?.status).toBe('suggested')
    expect(rows[0]?.suggestedIdentityId).toBe('alice')
    expect(rows[0]?.suggestedIdentityName).toBe('Alice')
    expect(rows[0]?.suggestedMatchScore).toBe(0.8)
    expect(rows[0]?.certainty).toBe('certain')
  })

  it('assignment wins over a leftover suggestion on the same row', () => {
    const rows = buildFaceReviewRows(
      [face({ faceId: 'f1', identityId: 'alice', suggestedIdentityId: 'bob', suggestedMatchScore: 0.9 })],
      IDENTITIES,
      CAMERA_NAMES,
    )
    expect(rows[0]?.status).toBe('assigned')
    expect(rows[0]?.suggestedIdentityId).toBeUndefined()
  })

  it('a face with neither becomes status:"unassigned"', () => {
    const rows = buildFaceReviewRows([face({ faceId: 'f1' })], IDENTITIES, CAMERA_NAMES)
    expect(rows[0]?.status).toBe('unassigned')
    expect(rows[0]?.suggestedIdentityId).toBeUndefined()
    expect(rows[0]?.assignedIdentityName).toBeUndefined()
  })

  it('two look-alike faces with different OWN scores get different certainty words — the fixed bug', () => {
    // Before the redesign these two would have inherited the SAME
    // cluster-vote name/confidence just for looking alike. Now each reads
    // its own signal.
    const rows = buildFaceReviewRows(
      [
        face({ faceId: 'f1', suggestedIdentityId: 'alice', suggestedMatchScore: 0.9 }),
        face({ faceId: 'f2', suggestedIdentityId: 'alice', suggestedMatchScore: 0.4 }),
      ],
      IDENTITIES,
      CAMERA_NAMES,
    )
    const byId = new Map(rows.map((r) => [r.faceId, r]))
    expect(byId.get('f1')?.certainty).toBe('certain')
    expect(byId.get('f2')?.certainty).toBe('uncertain')
  })
})

describe('deriveClusterProposal — Analyze modal per-group seed (majority vote)', () => {
  it('unanimous voters ⇒ confidence equals their average score exactly', () => {
    const cluster: FaceCluster = { faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.4 }
    const facesById = new Map([
      ['f1', face({ faceId: 'f1', suggestedIdentityId: 'alice', suggestedMatchScore: 0.7 })],
      ['f2', face({ faceId: 'f2', suggestedIdentityId: 'alice', suggestedMatchScore: 0.6 })],
      ['f3', face({ faceId: 'f3', suggestedIdentityId: 'alice', suggestedMatchScore: 0.8 })],
    ])
    const proposal = deriveClusterProposal(cluster, facesById, IDENTITY_NAMES)
    expect(proposal.identityId).toBe('alice')
    expect(proposal.confidence).toBeCloseTo(0.7, 5)
  })

  it('a silent (no-suggestion) member neither votes nor drags confidence down', () => {
    const cluster: FaceCluster = { faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.4 }
    const facesById = new Map([
      ['f1', face({ faceId: 'f1', suggestedIdentityId: 'alice', suggestedMatchScore: 0.7 })],
      ['f2', face({ faceId: 'f2' })],
      ['f3', face({ faceId: 'f3' })],
    ])
    const proposal = deriveClusterProposal(cluster, facesById, IDENTITY_NAMES)
    expect(proposal.identityId).toBe('alice')
    expect(proposal.confidence).toBeCloseTo(0.7, 5)
  })

  it('no member carries a suggestion ⇒ falls back to cohesion, no name', () => {
    const cluster: FaceCluster = { faceIds: ['f1', 'f2'], representativeFaceId: 'f1', size: 2, cohesion: 0.63 }
    const facesById = new Map([['f1', face({ faceId: 'f1' })], ['f2', face({ faceId: 'f2' })]])
    const proposal = deriveClusterProposal(cluster, facesById, IDENTITY_NAMES)
    expect(proposal.identityId).toBeUndefined()
    expect(proposal.confidence).toBe(0.63)
  })
})

describe('restrictClustersToPool — Analyze modal scoping to "last 100 unassigned"', () => {
  it('drops members outside the pool rather than leaving them invisibly adoptable', () => {
    const clusters: FaceCluster[] = [{ faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.8 }]
    const pool = new Set(['f1', 'f2']) // f3 is outside the "last 100" window
    const restricted = restrictClustersToPool(clusters, pool, 2)
    expect(restricted).toEqual([{ faceIds: ['f1', 'f2'], representativeFaceId: 'f1', size: 2, cohesion: 0.8 }])
  })

  it('drops a cluster entirely once restriction takes it below minClusterSize', () => {
    const clusters: FaceCluster[] = [{ faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.8 }]
    const pool = new Set(['f1']) // only one survivor
    expect(restrictClustersToPool(clusters, pool, 2)).toEqual([])
  })

  it('re-picks the representative when the original one falls outside the pool', () => {
    const clusters: FaceCluster[] = [{ faceIds: ['f1', 'f2', 'f3'], representativeFaceId: 'f1', size: 3, cohesion: 0.8 }]
    const pool = new Set(['f2', 'f3'])
    const restricted = restrictClustersToPool(clusters, pool, 2)
    expect(restricted[0]?.representativeFaceId).toBe('f2')
  })
})

describe('buildAnalyzeGroupRows', () => {
  it('seeds the proposal from the majority vote, biggest group first', () => {
    const clusters: FaceCluster[] = [
      { faceIds: ['s1', 's2'], representativeFaceId: 's1', size: 2, cohesion: 0.5 },
      { faceIds: ['b1', 'b2', 'b3'], representativeFaceId: 'b1', size: 3, cohesion: 0.9 },
    ]
    const facesById = new Map([
      ['s1', face({ faceId: 's1' })],
      ['s2', face({ faceId: 's2' })],
      ['b1', face({ faceId: 'b1', suggestedIdentityId: 'alice', suggestedMatchScore: 0.8 })],
      ['b2', face({ faceId: 'b2', suggestedIdentityId: 'alice', suggestedMatchScore: 0.8 })],
      ['b3', face({ faceId: 'b3' })],
    ])
    const groups = buildAnalyzeGroupRows(clusters, facesById, IDENTITY_NAMES)
    expect(groups.map((g) => g.representativeFaceId)).toEqual(['b1', 's1']) // size desc
    expect(groups[0]?.proposedName).toBe('Alice')
    expect(groups[0]?.proposedIdentityId).toBe('alice')
    expect(groups[1]?.proposedName).toBe('') // no consensus
    expect(groups[1]?.proposedIdentityId).toBeUndefined()
  })

  // ⚠ LOAD-BEARING: the modal can no longer CREATE an identity, so a vote for
  // someone the gallery does not hold has nothing to pre-select. Seeding the
  // picker with that id would look chosen while being unpickable, and the
  // group would then be written to a person the operator never saw.
  it('refuses to pre-select an identity the gallery does not hold', () => {
    const clusters: FaceCluster[] = [
      { faceIds: ['b1', 'b2'], representativeFaceId: 'b1', size: 2, cohesion: 0.9 },
    ]
    const facesById = new Map([
      ['b1', face({ faceId: 'b1', suggestedIdentityId: 'ghost-person', suggestedMatchScore: 0.9 })],
      ['b2', face({ faceId: 'b2', suggestedIdentityId: 'ghost-person', suggestedMatchScore: 0.9 })],
    ])
    const groups = buildAnalyzeGroupRows(clusters, facesById, IDENTITY_NAMES)
    expect(groups[0]?.proposedIdentityId).toBeUndefined()
  })

  it('carries EVERY member as a grid tile, in cluster order', () => {
    const clusters: FaceCluster[] = [
      { faceIds: ['b1', 'b2', 'b3'], representativeFaceId: 'b1', size: 3, cohesion: 0.9 },
    ]
    const facesById = new Map([
      ['b1', face({ faceId: 'b1', timestamp: 10, cropUrl: '/c/b1' })],
      ['b2', face({ faceId: 'b2', timestamp: 20 })],
      ['b3', face({ faceId: 'b3', timestamp: 30 })],
    ])
    const groups = buildAnalyzeGroupRows(clusters, facesById, IDENTITY_NAMES)
    expect(groups[0]?.members.map((m) => m.faceId)).toEqual(['b1', 'b2', 'b3'])
    expect(groups[0]?.members[0]?.cropUrl).toBe('/c/b1')
  })

  it('drops a member the pool never fetched rather than rendering a blank page', () => {
    const clusters: FaceCluster[] = [
      { faceIds: ['b1', 'ghost'], representativeFaceId: 'b1', size: 2, cohesion: 0.9 },
    ]
    const facesById = new Map([['b1', face({ faceId: 'b1' })]])
    const groups = buildAnalyzeGroupRows(clusters, facesById, IDENTITY_NAMES)
    expect(groups[0]?.members.map((m) => m.faceId)).toEqual(['b1'])
  })

  it('drops a cluster whose representative face was never fetched', () => {
    const clusters: FaceCluster[] = [{ faceIds: ['f1'], representativeFaceId: 'ghost', size: 1, cohesion: 0.5 }]
    expect(buildAnalyzeGroupRows(clusters, new Map(), IDENTITY_NAMES)).toEqual([])
  })
})

describe('buildAnalyzeAssignPlan — CHOSEN people AND exclusions', () => {
  const groups: readonly AnalyzeGroupRow[] = [
    {
      representativeFaceId: 'g1',
      members: [
        { faceId: 'f1', timestamp: 1, cropUrl: undefined, base64: undefined },
        { faceId: 'f2', timestamp: 2, cropUrl: undefined, base64: undefined },
      ],
      proposedIdentityId: 'alice',
      proposedName: 'Alice',
    },
    {
      representativeFaceId: 'g2',
      members: [{ faceId: 'f3', timestamp: 3, cropUrl: undefined, base64: undefined }],
      proposedIdentityId: undefined,
      proposedName: '',
    },
  ]
  const NONE: ReadonlySet<string> = new Set()
  /** What the modal seeds the picker with before the operator touches it. */
  const SEEDED = seedAnalyzeIdentitySelection(groups)

  // ⚠ LOAD-BEARING, and the whole reason the free-text field is gone: a group
  // NOBODY has chosen a person for must not be written. It used to be written
  // whenever a name had been typed, and a typo minted a second identity.
  it('never writes a group with no person chosen', () => {
    const plan = buildAnalyzeAssignPlan(groups, SEEDED, NONE)
    expect(plan).toEqual([{ representativeFaceId: 'g1', identityId: 'alice', faceIds: ['f1', 'f2'] }])
  })

  it('writes nothing at all while the operator has chosen nobody', () => {
    expect(buildAnalyzeAssignPlan(groups, new Map(), NONE)).toEqual([])
  })

  // The pre-selection is a starting point, not a commitment.
  it('an operator choice overrides the seeded proposal, and reaches a group that had none', () => {
    const picked = setAnalyzeGroupIdentity(setAnalyzeGroupIdentity(SEEDED, 'g1', 'bob'), 'g2', 'alice')
    expect(buildAnalyzeAssignPlan(groups, picked, NONE)).toEqual([
      { representativeFaceId: 'g1', identityId: 'bob', faceIds: ['f1', 'f2'] },
      { representativeFaceId: 'g2', identityId: 'alice', faceIds: ['f3'] },
    ])
  })

  // Clearing a pre-selection has to be expressible: an operator who disagrees
  // with the recognizer and has nobody to put in its place must be able to
  // leave the group alone rather than being forced to assign SOMEONE.
  it('un-picking the pre-selected person leaves the group unwritten', () => {
    const cleared = setAnalyzeGroupIdentity(SEEDED, 'g1', 'alice')
    expect(buildAnalyzeAssignPlan(groups, cleared, NONE)).toEqual([])
  })

  // ⚠ LOAD-BEARING: the ✕ on a carousel page must reach the WRITE, not just
  // dim a thumbnail. A plan that still carried the excluded faceId would
  // assign a face the operator explicitly struck out.
  it('never writes a face the operator struck out', () => {
    const plan = buildAnalyzeAssignPlan(groups, SEEDED, new Set(['f1']))
    expect(plan).toEqual([{ representativeFaceId: 'g1', identityId: 'alice', faceIds: ['f2'] }])
  })

  it('drops a group entirely once every member is struck out — never an empty write', () => {
    const plan = buildAnalyzeAssignPlan(groups, SEEDED, new Set(['f1', 'f2']))
    expect(plan).toEqual([])
  })

  it('an exclusion in one group leaves the others untouched', () => {
    const picked = setAnalyzeGroupIdentity(SEEDED, 'g2', 'bob')
    const plan = buildAnalyzeAssignPlan(groups, picked, new Set(['f3']))
    expect(plan).toEqual([{ representativeFaceId: 'g1', identityId: 'alice', faceIds: ['f1', 'f2'] }])
  })

  // ⚠ LOAD-BEARING, and a property that predates the grid: the header's
  // count, the confirm dialog's count and the result banner's total are all
  // the SAME arithmetic over the survivors. Moving the ✕ from a carousel page
  // to a grid tile must not let them drift apart.
  it('the header count and the write count move together under an exclusion', () => {
    const picked = setAnalyzeGroupIdentity(SEEDED, 'g2', 'bob')
    for (const excluded of [new Set<string>(), new Set(['f1']), new Set(['f1', 'f3']), new Set(['f1', 'f2', 'f3'])]) {
      const planned = buildAnalyzeAssignPlan(groups, picked, excluded).reduce((n, e) => n + e.faceIds.length, 0)
      expect(analyzeCoverage(groups, 100, excluded).grouped).toBe(planned)
    }
  })
})

describe('seedAnalyzeIdentitySelection / setAnalyzeGroupIdentity', () => {
  const groups: readonly AnalyzeGroupRow[] = [
    {
      representativeFaceId: 'g1',
      members: [{ faceId: 'f1', timestamp: 1, cropUrl: undefined, base64: undefined }],
      proposedIdentityId: 'alice',
      proposedName: 'Alice',
    },
    {
      representativeFaceId: 'g2',
      members: [{ faceId: 'f2', timestamp: 2, cropUrl: undefined, base64: undefined }],
      proposedIdentityId: undefined,
      proposedName: '',
    },
  ]

  it('pre-selects only the groups the clustering actually voted for', () => {
    expect([...seedAnalyzeIdentitySelection(groups)]).toEqual([['g1', 'alice']])
  })

  it('picks, re-picks and un-picks, never mutating the map it was given', () => {
    const seeded = seedAnalyzeIdentitySelection(groups)
    const repicked = setAnalyzeGroupIdentity(seeded, 'g1', 'bob')
    expect(repicked.get('g1')).toBe('bob')
    expect(seeded.get('g1')).toBe('alice')
    expect(setAnalyzeGroupIdentity(repicked, 'g1', 'bob').has('g1')).toBe(false)
    expect(setAnalyzeGroupIdentity(seeded, 'g2', 'bob').get('g2')).toBe('bob')
  })
})

describe('toggleGroupFaceExclusion / includedGroupFaceIds', () => {
  const group: AnalyzeGroupRow = {
    representativeFaceId: 'g1',
    members: [
      { faceId: 'f1', timestamp: 1, cropUrl: undefined, base64: undefined },
      { faceId: 'f2', timestamp: 2, cropUrl: undefined, base64: undefined },
    ],
    proposedIdentityId: 'alice',
    proposedName: 'Alice',
  }

  it('adds then removes, and never mutates the set it was given', () => {
    const empty: ReadonlySet<string> = new Set()
    const one = toggleGroupFaceExclusion(empty, 'f1')
    expect([...one]).toEqual(['f1'])
    expect(empty.size).toBe(0)
    expect([...toggleGroupFaceExclusion(one, 'f1')]).toEqual([])
  })

  it('reports the survivors in member order', () => {
    expect(includedGroupFaceIds(group, new Set())).toEqual(['f1', 'f2'])
    expect(includedGroupFaceIds(group, new Set(['f1']))).toEqual(['f2'])
    expect(includedGroupFaceIds(group, new Set(['f1', 'f2']))).toEqual([])
  })
})

describe('analyzeCoverage — what the "last 100" header may honestly claim', () => {
  const groups: readonly AnalyzeGroupRow[] = [
    {
      representativeFaceId: 'g1',
      members: [
        { faceId: 'f1', timestamp: 1, cropUrl: undefined, base64: undefined },
        { faceId: 'f2', timestamp: 2, cropUrl: undefined, base64: undefined },
      ],
      proposedIdentityId: 'alice',
      proposedName: 'Alice',
    },
    {
      representativeFaceId: 'g2',
      members: [
        { faceId: 'f3', timestamp: 3, cropUrl: undefined, base64: undefined },
        { faceId: 'f4', timestamp: 4, cropUrl: undefined, base64: undefined },
        { faceId: 'f5', timestamp: 5, cropUrl: undefined, base64: undefined },
      ],
      proposedIdentityId: undefined,
      proposedName: '',
    },
  ]

  // ⚠ LOAD-BEARING: this is the operator's actual complaint — "it doesn't
  // look like it really takes 100". It takes 100; only the GROUPED ones are
  // actionable, and the header must say the smaller number.
  it('counts the grouped faces, NOT the pool it analysed', () => {
    expect(analyzeCoverage(groups, 100, new Set())).toEqual({ groups: 2, grouped: 5, pool: 100 })
  })

  it('an exclusion lowers the grouped count immediately', () => {
    expect(analyzeCoverage(groups, 100, new Set(['f1', 'f4']))).toEqual({ groups: 2, grouped: 3, pool: 100 })
  })

  it('reports the pool it ACTUALLY got, which may be under the requested 100', () => {
    expect(analyzeCoverage(groups, 37, new Set()).pool).toBe(37)
  })

  it('no groups at all ⇒ zero grouped, and the pool still stated', () => {
    expect(analyzeCoverage([], 100, new Set())).toEqual({ groups: 0, grouped: 0, pool: 100 })
  })
})

describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency bound', async () => {
    let active = 0
    let maxActive = 0
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
    })
    expect(maxActive).toBeLessThanOrEqual(3)
  })

  it('a single worker rejection propagates — the caller decides whether to catch it', async () => {
    await expect(
      runWithConcurrency([1, 2], 2, async (n) => {
        if (n === 1) throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
