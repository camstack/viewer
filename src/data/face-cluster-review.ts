/**
 * face-cluster-review — pure (RN-free) derivation logic for the admin-only
 * face review tab (Task C.4, redesigned 2026-08-26 after operator feedback:
 * the CLUSTER-VOTE version — "one name is a group's majority vote, inherited
 * by every member" — read as a per-face identification when it was actually a
 * group verdict, and its confidence bar mixed two unrelated quantities
 * (vote agreement × vote strength, or cohesion when nobody voted) behind one
 * fill length. See `docs/history/sessions.md` 2026-08-26 for the full finding.
 *
 * ## What this module owns now
 *
 * 0. **What it does NOT own.** Sorting, filtering (status / camera / date)
 *    and multi-selection live in `face-review-filters.ts` — the operator
 *    chooses all three now, and none of them is a property of a face row.
 *
 * 1. **The main grid.** One row per FACE (`buildFaceReviewRows`), classified
 *    by that face's OWN persisted signal — `identityId` (assigned),
 *    `suggestedIdentityId` (suggested, recognizer's own per-face call), or
 *    neither (unassigned). Never a cluster, never a vote. The confidence word
 *    (`faceSuggestionCertainty`) bands that SAME face's `suggestedMatchScore`
 *    through the identical thresholds `face-confidence.ts` already uses for
 *    `bestMatchScore` (`FACE_CONFIDENCE_GOOD_THRESHOLD` / `_MEDIUM_THRESHOLD`)
 *    — one meaning for "certain / probable / uncertain" everywhere in the app,
 *    not a new scale invented for this screen.
 *
 * 2. **The "Similar groups" modal.** THIS is where look-alike
 *    clustering (`suggestFaceClusters`) still belongs — it is explicit there
 *    that a row represents a GROUP, so a group-derived proposal is honest
 *    instead of misleading (`deriveClusterProposal`, unchanged from the
 *    original design; `restrictClustersToPool` / `buildAnalyzeGroupRows` /
 *    `buildAnalyzeAssignPlan` scope the server's UNBOUNDED cluster sweep down
 *    to the pool the modal actually shows, the same "invisible
 *    members must not be adoptable" rule the admin-ui `SimilarGroupsModal`
 *    already enforces). Since 2026-09-01 the modal PICKS a known person per
 *    group instead of typing a name, so the proposal is carried as an
 *    `identityId` (`proposedIdentityId`) and the free-text resolver that used
 *    to turn a typo into a brand-new identity is gone.
 *
 * 3. **The "Recompute suggestions" button.** `face.rescoreTrack` (see
 *    `face-rescore.ts`) reads the embedding already persisted on the face row
 *    and scores it against the gallery AS IT IS NOW — and the hub PERSISTS
 *    the result onto that same row's `suggestedIdentityId` /
 *    `suggestedMatchScore` (never an assignment, never automatic). There is
 *    no client-side override map here any more: two sources of truth for the
 *    same fact was worse than one, and the old one evaporated on refresh. The
 *    screen just re-reads the list (`refetch`) once the batch of probes
 *    finishes. `runWithConcurrency` bounds how many of those probes run at
 *    once so a "recompute" over a few hundred rows does not fire a few
 *    hundred simultaneous requests.
 *
 * Kept framework-free so every decision here runs under the repo's node
 * vitest env without touching the hub — `data/__tests__/face-cluster-review.spec.ts`.
 */
import { isRecord } from './cap-query.js'
import { faceConfidenceTone } from './face-confidence.js'
import { faceHasPerson, type FaceBox, type PersonIdentity, type TrackFace } from './use-face-gallery.js'

/** One `suggestFaceClusters` row, narrowed. */
export interface FaceCluster {
  readonly faceIds: readonly string[]
  readonly representativeFaceId: string
  readonly size: number
  readonly cohesion: number
}

/** Narrow one `suggestFaceClusters` row. Null on malformed (never throws). */
export function toFaceCluster(row: unknown): FaceCluster | null {
  if (!isRecord(row)) return null
  if (!Array.isArray(row.faceIds)) return null
  if (typeof row.representativeFaceId !== 'string' || row.representativeFaceId.length === 0) return null
  const faceIds = row.faceIds.filter((f): f is string => typeof f === 'string')
  if (faceIds.length === 0) return null
  return {
    faceIds,
    representativeFaceId: row.representativeFaceId,
    size: typeof row.size === 'number' ? row.size : faceIds.length,
    cohesion:
      typeof row.cohesion === 'number' && Number.isFinite(row.cohesion)
        ? Math.max(0, Math.min(1, row.cohesion))
        : 0,
  }
}

/** Narrow a raw `suggestFaceClusters` array. Malformed rows are dropped. */
export function toFaceClusters(rows: unknown): FaceCluster[] {
  if (!Array.isArray(rows)) return []
  const out: FaceCluster[] = []
  for (const row of rows) {
    const cluster = toFaceCluster(row)
    if (cluster !== null) out.push(cluster)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Main grid — one row per FACE, never a group vote
// ─────────────────────────────────────────────────────────────────────────

export type FaceReviewStatus = 'assigned' | 'suggested' | 'unassigned'

/** The certainty WORD — banded through the SAME thresholds
 *  `face-confidence.ts` uses for `bestMatchScore`, so "certain" always means
 *  the same score range everywhere in the app. */
export type FaceSuggestionCertainty = 'certain' | 'probable' | 'uncertain'

export function faceSuggestionCertainty(score: number): FaceSuggestionCertainty {
  const tone = faceConfidenceTone(score)
  if (tone === 'good') return 'certain'
  if (tone === 'medium') return 'probable'
  return 'uncertain'
}

/** One face crop in the review grid. Exactly one of the two identity fields
 *  is populated, and only for the matching `status` — never both, never a
 *  cluster-inherited value. */
export interface FaceReviewRow {
  readonly faceId: string
  readonly deviceId: number
  /** Display name of the camera that captured this face, resolved from the
   *  shared camera list. `undefined` when that list has not arrived yet or no
   *  longer contains the device — the cell then falls back to the id rather
   *  than pretending the capture has no origin. */
  readonly cameraName: string | undefined
  readonly trackId: string
  readonly timestamp: number
  readonly cropUrl: string | undefined
  readonly base64: string | undefined
  readonly status: FaceReviewStatus
  /** Set only when `status === 'assigned'`. */
  readonly assignedIdentityName: string | undefined
  /** Set only when `status === 'suggested'` — THIS face's own recognizer
   *  suggestion, never a cluster's. */
  readonly suggestedIdentityId: string | undefined
  readonly suggestedIdentityName: string | undefined
  readonly suggestedMatchScore: number | undefined
  readonly certainty: FaceSuggestionCertainty | undefined
  /** The track's native key frame (the full picture) — see `TrackFace`. */
  readonly keyFrameMediaId?: number
  /** The face's box on that key frame, in its pixels. */
  readonly faceBbox?: FaceBox
}

const EMPTY_SUGGESTION = {
  suggestedIdentityId: undefined,
  suggestedIdentityName: undefined,
  suggestedMatchScore: undefined,
  certainty: undefined,
} as const

function toFaceReviewRow(
  face: TrackFace,
  identityNameById: ReadonlyMap<string, string>,
  cameraNameById: ReadonlyMap<number, string>,
): FaceReviewRow {
  const base = {
    faceId: face.faceId,
    deviceId: face.deviceId,
    cameraName: cameraNameById.get(face.deviceId),
    trackId: face.trackId,
    timestamp: face.timestamp,
    cropUrl: face.cropUrl,
    base64: face.base64,
    ...(face.keyFrameMediaId !== undefined ? { keyFrameMediaId: face.keyFrameMediaId } : {}),
    ...(face.faceBbox !== undefined ? { faceBbox: face.faceBbox } : {}),
  }
  if (faceHasPerson(face.identityId)) {
    return {
      ...base,
      status: 'assigned',
      assignedIdentityName: face.identityName ?? identityNameById.get(face.identityId ?? '') ?? face.identityId,
      ...EMPTY_SUGGESTION,
    }
  }
  if (face.suggestedIdentityId !== undefined) {
    const score = face.suggestedMatchScore ?? 0
    return {
      ...base,
      status: 'suggested',
      assignedIdentityName: undefined,
      suggestedIdentityId: face.suggestedIdentityId,
      suggestedIdentityName: identityNameById.get(face.suggestedIdentityId) ?? face.suggestedIdentityId,
      suggestedMatchScore: score,
      certainty: faceSuggestionCertainty(score),
    }
  }
  return {
    ...base,
    status: 'unassigned',
    assignedIdentityName: undefined,
    ...EMPTY_SUGGESTION,
  }
}

/**
 * One row per face — classification only, no clustering, no voting.
 *
 * `cameraNameById` comes from the shared camera list the whole app already
 * holds (`use-cameras.ts`); a face row itself carries only a `deviceId`, and
 * this screen must NOT keep a second copy of a device fact.
 *
 * Sorting and filtering are NOT applied here — see `face-review-filters.ts`,
 * which owns both because the operator now chooses them. Pure.
 */
export function buildFaceReviewRows(
  faces: readonly TrackFace[],
  identities: readonly PersonIdentity[],
  cameraNameById: ReadonlyMap<number, string>,
): FaceReviewRow[] {
  const identityNameById = new Map(identities.map((i) => [i.id, i.name]))
  return faces.map((f) => toFaceReviewRow(f, identityNameById, cameraNameById))
}

// ─────────────────────────────────────────────────────────────────────────
// "Similar groups" modal — clustering lives ONLY here now
// ─────────────────────────────────────────────────────────────────────────

/** What a cluster's members' individual recognizer suggestions agree on —
 *  used ONLY to seed the modal's editable per-group name, never to label a
 *  face in the main grid. */
export interface ClusterProposal {
  readonly identityId: string | undefined
  readonly identityName: string | undefined
  readonly confidence: number
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * Majority vote over a cluster's members' `suggestedIdentityId`s — a face
 * with no suggestion abstains rather than counting as disagreement, so a
 * cluster of mostly-unscored faces is never punished for its silent members.
 * Pure.
 */
export function deriveClusterProposal(
  cluster: FaceCluster,
  facesById: ReadonlyMap<string, TrackFace>,
  identityNameById: ReadonlyMap<string, string>,
): ClusterProposal {
  const votes = new Map<string, { count: number; scoreSum: number }>()
  let totalVoters = 0
  for (const faceId of cluster.faceIds) {
    const face = facesById.get(faceId)
    if (face === undefined || face.suggestedIdentityId === undefined) continue
    const entry = votes.get(face.suggestedIdentityId) ?? { count: 0, scoreSum: 0 }
    entry.count += 1
    entry.scoreSum += face.suggestedMatchScore ?? 0
    votes.set(face.suggestedIdentityId, entry)
    totalVoters += 1
  }

  let winnerId: string | null = null
  let winnerCount = 0
  let winnerAvgScore = 0
  for (const [identityId, entry] of votes) {
    const avgScore = entry.scoreSum / entry.count
    if (winnerId === null || entry.count > winnerCount || (entry.count === winnerCount && avgScore > winnerAvgScore)) {
      winnerId = identityId
      winnerCount = entry.count
      winnerAvgScore = avgScore
    }
  }

  if (winnerId === null || totalVoters === 0) {
    return { identityId: undefined, identityName: undefined, confidence: cluster.cohesion }
  }

  const agreementFraction = winnerCount / totalVoters
  return {
    identityId: winnerId,
    identityName: identityNameById.get(winnerId),
    confidence: clamp01(agreementFraction * winnerAvgScore),
  }
}

/**
 * Restrict a cluster's membership to a POOL of faceIds the caller actually
 * has loaded (the modal's unassigned window) — a member outside
 * the pool is dropped rather than left invisibly adoptable (mirrors the
 * admin-ui `SimilarGroupsModal`'s rule for the same failure mode). A cluster
 * that falls below `minClusterSize` after restriction is dropped entirely,
 * and its `representativeFaceId` is re-picked from the survivors if the
 * original representative did not make the cut. Pure.
 */
export function restrictClustersToPool(
  clusters: readonly FaceCluster[],
  poolIds: ReadonlySet<string>,
  minClusterSize: number,
): FaceCluster[] {
  const out: FaceCluster[] = []
  for (const cluster of clusters) {
    const faceIds = cluster.faceIds.filter((id) => poolIds.has(id))
    if (faceIds.length < minClusterSize) continue
    const representativeFaceId = faceIds.includes(cluster.representativeFaceId)
      ? cluster.representativeFaceId
      : (faceIds[0] as string)
    out.push({ faceIds, representativeFaceId, size: faceIds.length, cohesion: cluster.cohesion })
  }
  return out
}

/** One face inside an Analyze group — enough to render it as a carousel page
 *  and to strike it out of the write. */
export interface AnalyzeGroupMember {
  readonly faceId: string
  readonly timestamp: number
  readonly cropUrl: string | undefined
  readonly base64: string | undefined
}

/** One group row in the "Analyze" modal — its member crops (shown as a GRID
 *  the operator taps to strike out anyone who does not belong) and the
 *  clustering's proposal.
 *
 *  The proposal is an IDENTITY, not a name: `proposedIdentityId` is set only
 *  when the members' majority vote landed on a person the gallery actually
 *  holds, and it PRE-SELECTS that person in the group's picker. A group with
 *  no proposal starts with no choice and is not written until the operator
 *  makes one — the modal can no longer mint an identity, so a proposal it
 *  cannot resolve must not become one. `proposedName` is the display of that
 *  same vote (empty when there was none).
 *
 *  There is no separate `faceIds`/`size`/`cropUrl` on the row: one list of
 *  members is the single source for all three, so an exclusion cannot update
 *  the grid and leave the count behind. */
export interface AnalyzeGroupRow {
  readonly representativeFaceId: string
  readonly members: readonly AnalyzeGroupMember[]
  readonly proposedIdentityId: string | undefined
  readonly proposedName: string
}

/** Groups whose representative face is actually in the pool, biggest first
 *  (the biggest one-edit win leads). Pure. */
export function buildAnalyzeGroupRows(
  clusters: readonly FaceCluster[],
  facesById: ReadonlyMap<string, TrackFace>,
  identityNameById: ReadonlyMap<string, string>,
): AnalyzeGroupRow[] {
  const out: AnalyzeGroupRow[] = []
  for (const cluster of clusters) {
    if (!facesById.has(cluster.representativeFaceId)) continue
    const members: AnalyzeGroupMember[] = []
    for (const faceId of cluster.faceIds) {
      const face = facesById.get(faceId)
      if (face === undefined) continue
      members.push({
        faceId,
        timestamp: face.timestamp,
        cropUrl: face.cropUrl,
        base64: face.base64,
      })
    }
    if (members.length === 0) continue
    const proposal = deriveClusterProposal(cluster, facesById, identityNameById)
    // A vote for an identity the gallery does not hold cannot pre-select
    // anything: the picker only offers known people, and seeding it with an id
    // absent from that list would look chosen while being unpickable.
    const proposedIdentityId =
      proposal.identityId !== undefined && identityNameById.has(proposal.identityId)
        ? proposal.identityId
        : undefined
    out.push({
      representativeFaceId: cluster.representativeFaceId,
      members,
      proposedIdentityId,
      proposedName: proposal.identityName ?? '',
    })
  }
  return out.sort((a, b) => b.members.length - a.members.length)
}

/** Flip one face's exclusion. Always a NEW set. Pure. */
export function toggleGroupFaceExclusion(
  excluded: ReadonlySet<string>,
  faceId: string,
): ReadonlySet<string> {
  const next = new Set(excluded)
  if (next.has(faceId)) next.delete(faceId)
  else next.add(faceId)
  return next
}

/** The members of `group` the operator has NOT struck out. Pure. */
export function includedGroupFaceIds(
  group: AnalyzeGroupRow,
  excluded: ReadonlySet<string>,
): readonly string[] {
  return group.members.filter((m) => !excluded.has(m.faceId)).map((m) => m.faceId)
}

/** One group the modal's Confirm action will actually write. The target is an
 *  identity the operator PICKED (or the pre-selection they left alone) — never
 *  a name to be resolved, and never a name to be created. */
export interface AnalyzeAssignPlanEntry {
  readonly representativeFaceId: string
  readonly identityId: string
  readonly faceIds: readonly string[]
}

/**
 * The picker's starting state: every group whose clustering vote landed on a
 * KNOWN person starts on that person. A group without one is simply absent
 * from the map — "no choice yet", which {@link buildAnalyzeAssignPlan} then
 * refuses to write. Pure.
 */
export function seedAnalyzeIdentitySelection(
  groups: readonly AnalyzeGroupRow[],
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const group of groups) {
    if (group.proposedIdentityId !== undefined) out.set(group.representativeFaceId, group.proposedIdentityId)
  }
  return out
}

/**
 * Pick a person for one group — or UNPICK, when the same one is tapped again.
 * Always a NEW map, never a mutation of the one handed in.
 *
 * Un-picking has to be expressible: the pre-selection is the recognizer's
 * guess, and an operator who disagrees with it and has nobody to put in its
 * place must be able to leave the group unwritten rather than being forced to
 * assign SOMEONE. Pure.
 */
export function setAnalyzeGroupIdentity(
  selection: ReadonlyMap<string, string>,
  representativeFaceId: string,
  identityId: string,
): ReadonlyMap<string, string> {
  const next = new Map(selection)
  if (next.get(representativeFaceId) === identityId) next.delete(representativeFaceId)
  else next.set(representativeFaceId, identityId)
  return next
}

/**
 * Groups with a CHOSEN person AND at least one member left after exclusions.
 *
 * No choice means "skip this group", not an error, and so does striking out
 * every member: the modal still fires ONE batch of writes for everything that
 * IS decided, gated by ONE confirmation, rather than forcing an
 * all-or-nothing choice. An excluded face is never written — that is the whole
 * point of the ✕, and a plan that carried it anyway would be the UI showing
 * one thing and the hub doing another.
 *
 * `selection` is read WITHOUT falling back to `proposedIdentityId`: the modal
 * seeds it from the proposals ({@link seedAnalyzeIdentitySelection}), so a
 * fallback here would only serve to resurrect a pre-selection the operator
 * deliberately cleared. Pure.
 */
export function buildAnalyzeAssignPlan(
  groups: readonly AnalyzeGroupRow[],
  selection: ReadonlyMap<string, string>,
  excluded: ReadonlySet<string>,
): AnalyzeAssignPlanEntry[] {
  const out: AnalyzeAssignPlanEntry[] = []
  for (const group of groups) {
    const identityId = selection.get(group.representativeFaceId)
    if (identityId === undefined) continue
    const faceIds = includedGroupFaceIds(group, excluded)
    if (faceIds.length === 0) continue
    out.push({ representativeFaceId: group.representativeFaceId, identityId, faceIds })
  }
  return out
}

/**
 * What the modal ACTUALLY covers, so its header can stop implying it acted on
 * everything it looked at.
 *
 * The pool is the newest `ANALYZE_POOL_SIZE` unassigned faces, and since
 * 2026-09-13 it is also exactly what the hub was asked to cluster. Only those
 * that land in a look-alike group of ≥ 2 ever appear: the rest of the pool is
 * analysed and produces nothing to act on, correctly — a group of one is not a
 * batch. `grouped` is the honest number of faces on screen, `pool` the number
 * actually fetched (itself smaller when the hub holds fewer). Pure.
 */
export interface AnalyzeCoverage {
  readonly groups: number
  readonly grouped: number
  readonly pool: number
}

export function analyzeCoverage(
  groups: readonly AnalyzeGroupRow[],
  poolSize: number,
  excluded: ReadonlySet<string>,
): AnalyzeCoverage {
  let grouped = 0
  for (const group of groups) grouped += includedGroupFaceIds(group, excluded).length
  return { groups: groups.length, grouped, pool: poolSize }
}

// ─────────────────────────────────────────────────────────────────────────
// "Recompute suggestions" — fan-out control only; the hub persists the result
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run `worker` over `items` with at most `concurrency` in flight at once —
 * the recompute button's fan-out control, so scoring a few hundred rows does
 * not fire a few hundred simultaneous `face.rescoreTrack` calls. A single
 * `worker` rejection is NOT caught here — the caller decides whether one bad
 * probe should abort the batch or just be skipped (the recompute button
 * skips it; see the screen). Pure scheduling, no I/O of its own.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, concurrency)
  let cursor = 0
  async function runOne(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) continue
      await worker(item, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runOne()))
}
