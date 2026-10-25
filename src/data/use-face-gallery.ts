/**
 * use-face-gallery — the events page's window onto the hub `face-gallery` cap
 * (tRPC router `faceGallery`). Powers the "assign this face to a person" flow:
 *
 *   • `useTrackFace(deviceId, trackId, enabled)` — the face detected for one
 *     track (`getFaceByTrack`), with its inline crop and current assignment.
 *     Null when the track carries no face (cap absent / non-person track).
 *   • `useIdentities(enabled)` — the saved persons (`listIdentities`), sorted
 *     by name, with their inline cover avatars.
 *   • `useAssignFace()` — `assignFace {faceId, identityId}` mutation.
 *   • `useCreateIdentity()` — `createIdentity {name}` mutation returning the new
 *     person (so create-and-assign chains without a refetch).
 *
 * All calls go through the defensive `capQuery`/`capMutate` helpers (graceful
 * null on a server without the cap). Row narrowing is pure and unit-tested in
 * `__tests__/use-face-gallery.spec.ts`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { absoluteMediaPath, buildMediaIdUrl } from './event-media-url.js'
import { reloadEventsFeedsAfterBurst } from '../events/events-feed-registry.js'
import {
  invalidateFaceAssignmentQueries,
  invalidateFaceAssignmentQueriesNow,
  IDENTITIES_KEY,
  TRACK_FACE_KEY,
} from './face-query-keys.js'

/** The face detected for a track, normalised for the assignment UI. */
export interface TrackFace {
  readonly faceId: string
  readonly deviceId: number
  readonly trackId: string
  readonly timestamp: number
  readonly assigned: boolean
  readonly identityId: string | undefined
  readonly identityName: string | undefined
  /** Data-plane crop URL when the hub stored a media key. Prefer this. */
  readonly cropUrl: string | undefined
  /** Inline base64 JPEG face crop, when an older hub still sends one. */
  readonly base64: string | undefined
  /**
   * Winning cosine similarity (0..1) of the auto-match that assigned this face.
   * `undefined` on legacy rows and manual assignments (no recognizer match).
   */
  readonly bestMatchScore: number | undefined
  /** Native (pre-downscale) face short-side px. `undefined` on legacy rows. */
  readonly nativeFaceShortSidePx: number | undefined
  /**
   * A PLAUSIBLE-but-not-confident match the recognizer found WITHOUT
   * auto-assigning (server band ~0.50–0.62, or a good score on a small face);
   * the operator can confirm or dismiss it. `undefined` when there was no
   * suggestion. Distinct from `identityId` (an actual assignment).
   */
  readonly suggestedIdentityId: string | undefined
  /** The suggested match's score (0..1). `undefined` when there's no suggestion. */
  readonly suggestedMatchScore: number | undefined
  /**
   * Media row id of the TRACK's native key frame — the full picture this face
   * was cropped from. Absent when the track stored no key frame (a native /
   * onboard source) or on a hub that predates it.
   */
  readonly keyFrameMediaId?: number
  /** The face's box on that key frame, in its pixels. Absent on legacy rows. */
  readonly faceBbox?: FaceBox
}

/** Pixel-space box on the key frame (the server's `BoundingBoxSchema`). */
export interface FaceBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Narrow a `faceBbox`; a box with no area is no box. Pure. */
export function toFaceBox(raw: unknown): FaceBox | undefined {
  if (!isRecord(raw)) return undefined
  const { x, y, w, h } = raw
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

/** A saved person (face-gallery identity), normalised for the picker. */
export interface PersonIdentity {
  readonly id: string
  readonly name: string
  readonly sampleCount: number
  /** Cover crop media row id (D482) — render via the event-media HTTP plane
   *  (`buildMediaIdUrl`). */
  readonly coverMediaId: number | undefined
  /** Inline base64 JPEG cover avatar, when an older hub still sends one. */
  readonly coverBase64: string | undefined
}

/** Narrow one `getFaceByTrack` row. Null on malformed (never throws). */
export function toFaceInfo(row: unknown): TrackFace | null {
  if (!isRecord(row)) return null
  if (typeof row.faceId !== 'string' || row.faceId.length === 0) return null
  if (typeof row.deviceId !== 'number') return null
  if (typeof row.trackId !== 'string' || row.trackId.length === 0) return null
  const faceBbox = toFaceBox(row.faceBbox)
  return {
    faceId: row.faceId,
    deviceId: row.deviceId,
    trackId: row.trackId,
    timestamp: typeof row.timestamp === 'number' ? row.timestamp : 0,
    assigned: row.assigned === true,
    identityId:
      typeof row.recognizedIdentityId === 'string' && row.recognizedIdentityId.length > 0
        ? row.recognizedIdentityId
        : undefined,
    identityName:
      typeof row.identityName === 'string' && row.identityName.length > 0
        ? row.identityName
        : undefined,
    cropUrl: typeof row.cropUrl === 'string' && row.cropUrl.length > 0 ? row.cropUrl : undefined,
    base64: typeof row.base64 === 'string' && row.base64.length > 0 ? row.base64 : undefined,
    bestMatchScore:
      typeof row.bestMatchScore === 'number' && Number.isFinite(row.bestMatchScore)
        ? row.bestMatchScore
        : undefined,
    nativeFaceShortSidePx:
      typeof row.nativeFaceShortSidePx === 'number' && Number.isFinite(row.nativeFaceShortSidePx)
        ? row.nativeFaceShortSidePx
        : undefined,
    suggestedIdentityId:
      typeof row.suggestedIdentityId === 'string' && row.suggestedIdentityId.length > 0
        ? row.suggestedIdentityId
        : undefined,
    suggestedMatchScore:
      typeof row.suggestedMatchScore === 'number' && Number.isFinite(row.suggestedMatchScore)
        ? row.suggestedMatchScore
        : undefined,
    ...(finite(row.keyFrameMediaId) ? { keyFrameMediaId: row.keyFrameMediaId } : {}),
    ...(faceBbox !== undefined ? { faceBbox } : {}),
  }
}

/** Narrow one `listIdentities` row. Null on malformed (never throws). */
export function toIdentity(row: unknown): PersonIdentity | null {
  if (!isRecord(row)) return null
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (typeof row.name !== 'string' || row.name.length === 0) return null
  return {
    id: row.id,
    name: row.name,
    sampleCount: typeof row.sampleCount === 'number' ? row.sampleCount : 0,
    coverMediaId: typeof row.coverMediaId === 'number' ? row.coverMediaId : undefined,
    coverBase64:
      typeof row.coverBase64 === 'string' && row.coverBase64.length > 0
        ? row.coverBase64
        : undefined,
  }
}

/** Alphabetical (case-insensitive) person order for the picker. Pure. */
export function sortIdentities(list: readonly PersonIdentity[]): PersonIdentity[] {
  return [...list].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** Renderable face-crop URI: data-plane URL first, legacy inline bytes last. */
export function faceCropUri(
  face: { readonly cropUrl?: string; readonly base64?: string },
  serverUrl: string | null,
): string | null {
  const fromUrl = absoluteMediaPath(serverUrl, face.cropUrl)
  if (fromUrl !== null) return fromUrl
  if (face.base64 !== undefined && face.base64.length > 0) {
    return `data:image/jpeg;base64,${face.base64}`
  }
  return null
}

/** Renderable identity-cover URI: media row id over HTTP, legacy inline bytes last. */
export function identityCoverUri(
  person: { readonly coverMediaId?: number; readonly coverBase64?: string },
  serverUrl: string | null,
): string | null {
  if (person.coverMediaId !== undefined && serverUrl !== null) {
    return buildMediaIdUrl(serverUrl, person.coverMediaId)
  }
  if (person.coverBase64 !== undefined && person.coverBase64.length > 0) {
    return `data:image/jpeg;base64,${person.coverBase64}`
  }
  return null
}

/**
 * True when a face is LINKED to a person — whether the recognizer AUTO-assigned
 * it (PRE-ASSIGNED: `recognizedIdentityId` / `identityId` is set while the
 * server's `assigned` flag stays false, because no manual sample was enrolled)
 * OR the operator manually assigned it (`assigned` true). Every unassign /
 * "remove person" affordance MUST gate on THIS, never on `assigned` alone:
 * gating on `assigned` hides the remove action for pre-assigned faces, forcing
 * the operator to reassign to another person before they can detach — the exact
 * bug this predicate fixes. `unassignFace` itself already handles both cases
 * (its sample removal is guarded on `assignedSampleId`, a no-op for auto rows).
 * Pure.
 */
export function faceHasPerson(identityId: string | undefined | null): boolean {
  return typeof identityId === 'string' && identityId.length > 0
}

/**
 * The `listRecentFaces` input used ONLY to resolve which faceIds belong to a
 * person, before a mass detach. Shared by the two call sites that do this
 * (`useUnassignAllForIdentity` here, and `unassignAll` in
 * `components/camera/theater/detail/use-face-info.ts`) so they cannot diverge.
 *
 * `filter:'all'` is deliberately UNBOUNDED — the resolution must see every face
 * linked to the identity, exactly as the server's own `deleteIdentity` does.
 *
 * `includeCrops:false` is what makes that affordable. The consumer is
 * {@link collectFaceIdsForIdentity}, which reads `faceId` and
 * `recognizedIdentityId` and NOTHING else — the inline base64 crop on every row
 * was downloaded and thrown away. Measured on the live hub over 518 faces:
 * 3,175,028 B in 7.7 s with crops, 281,484 B in 78 ms without. On a phone.
 *
 * Nothing in the app renders a crop from THIS response; the face crop shown in
 * the theater detail comes from `getFaceByTrack`, which always inlines and is
 * unaffected. A hub too old to know the key simply strips it and behaves as
 * before.
 */
export const FACE_ID_RESOLUTION_QUERY = { filter: 'all', includeCrops: false } as const

/** Outcome of a mass detach (`unassignFaces`), normalised for the UI. */
export interface MassUnassignResult {
  readonly unassigned: number
  readonly failed: readonly string[]
}

/** Outcome of a mass assign (`assignFaces`), normalised for the UI. */
export interface MassAssignResult {
  readonly assigned: number
  readonly failed: readonly string[]
}

/**
 * Collect the faceIds currently linked to `identityId` from a `listRecentFaces`
 * response. Mirrors the server's OWN `deleteIdentity` face-resolution: it walks
 * ALL faces (manually assigned AND auto-recognized) and keeps those whose
 * `recognizedIdentityId` matches — NOT `listIdentitySamples`, whose rows carry
 * enrolled-sample ids (random UUIDs), never faceIds, and which omit
 * recognizer-auto-marked faces that were never enrolled. Pure; malformed rows
 * are skipped, never thrown.
 */
export function collectFaceIdsForIdentity(rows: unknown, identityId: string): string[] {
  if (!Array.isArray(rows) || identityId.length === 0) return []
  const out: string[] = []
  for (const row of rows) {
    const face = toFaceInfo(row)
    if (face !== null && face.identityId === identityId) out.push(face.faceId)
  }
  return out
}

/** Narrow an `unassignFaces` result. Missing/mistyped fields default to 0 / []. */
export function toMassUnassignResult(raw: unknown): MassUnassignResult {
  if (!isRecord(raw)) return { unassigned: 0, failed: [] }
  const unassigned = typeof raw.unassigned === 'number' ? raw.unassigned : 0
  const failed = Array.isArray(raw.failed)
    ? raw.failed.filter((x): x is string => typeof x === 'string')
    : []
  return { unassigned, failed }
}

/** Narrow an `assignFaces` result. Missing/mistyped fields default to 0 / []. */
export function toMassAssignResult(raw: unknown): MassAssignResult {
  if (!isRecord(raw)) return { assigned: 0, failed: [] }
  const assigned = typeof raw.assigned === 'number' ? raw.assigned : 0
  const failed = Array.isArray(raw.failed)
    ? raw.failed.filter((x): x is string => typeof x === 'string')
    : []
  return { assigned, failed }
}

/**
 * Strict mutate: unlike `capMutate` (which swallows every failure to null —
 * indistinguishable from a void success), this THROWS on a missing router /
 * method or a server error so `assignFace` failures surface in the UI instead
 * of silently "succeeding".
 */
async function strictMutate(
  client: Record<string, unknown>,
  cap: string,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const router = client[cap]
  const fn = isRecord(router) || typeof router === 'function' ? (router as Record<string, unknown>)[method] : undefined
  const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error(`${cap}.${method} unavailable`)
  return await (mutate as (i: Record<string, unknown>) => Promise<unknown>)(input)
}

/**
 * The face detected for `(deviceId, trackId)`, or null (no face / cap absent).
 * Enabled-gated so non-person tracks never issue the query.
 */
export function useTrackFace(deviceId: number, trackId: string, enabled: boolean) {
  const { controller, state } = useConnection()
  return useQuery<TrackFace | null>({
    queryKey: ['v2', TRACK_FACE_KEY, deviceId, trackId],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<TrackFace | null> => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'getFaceByTrack',
        { deviceId, trackId },
      )
      return toFaceInfo(raw)
    },
  })
}

/** The saved persons, sorted by name. Empty when the cap is absent. */
export function useIdentities(enabled: boolean) {
  const { controller, state } = useConnection()
  return useQuery<PersonIdentity[]>({
    queryKey: ['v2', IDENTITIES_KEY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<PersonIdentity[]> => {
      const system = controller.getSystem()
      if (!system) return []
      // listIdentities takes z.void() — call with NO input ({} would fail).
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'listIdentities',
      )
      if (!Array.isArray(raw)) return []
      const out: PersonIdentity[] = []
      for (const row of raw) {
        const person = toIdentity(row)
        if (person !== null) out.push(person)
      }
      return sortIdentities(out)
    },
  })
}

export interface AssignFaceInput {
  readonly faceId: string
  readonly identityId: string
}

/**
 * Assign a buffered face to a person. On success invalidates the face + person
 * queries AND the track feed (the server rewrites the track's label with the
 * recognized name, so the events cards + detail must refetch — otherwise the
 * event looks unchanged until an app restart). Throws on a server that
 * rejected/lacked the mutation so the UI can surface the failure.
 */
export function useAssignFace() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, AssignFaceInput>({
    mutationFn: async ({ faceId, identityId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Strict (throwing) call: assignFace returns void, so a swallowed error
      // would be indistinguishable from success.
      await strictMutate(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'assignFace',
        { faceId, identityId },
      )
    },
    onSuccess: async () => {
      await invalidateFaceAssignmentQueries(queryClient)
      // The ONLY thing that puts the new name on an event card: the track
      // surfaces are the hub-hosted embed, which has its own feed inside the
      // WebView and hears no query-cache invalidation. (There used to be a
      // `['v2','tracks-feed']` invalidation here for the onboard list; that
      // renderer was deleted on 2026-08-18 and the key now has no producer.)
      // A full reload, not an incremental refresh: assigning an identity
      // rewrites the label without moving `lastSeen`, so the delta never
      // carries the row. See the registry.
      reloadEventsFeedsAfterBurst('face-assignment')
    },
  })
}

/**
 * Disassociate a face from its person (`unassignFace`). The face returns to the
 * unassigned buffer (crop preserved) and the server clears the track's label.
 * Invalidates the same queries as assign so the event reflects the removal
 * immediately (no app restart). Throws on failure so the UI can surface it.
 */
export function useUnassignFace() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly faceId: string }>({
    mutationFn: async ({ faceId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      await strictMutate(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'unassignFace',
        { faceId },
      )
    },
    onSuccess: async () => {
      await invalidateFaceAssignmentQueries(queryClient)
      // The ONLY thing that puts the new name on an event card: the track
      // surfaces are the hub-hosted embed, which has its own feed inside the
      // WebView and hears no query-cache invalidation. (There used to be a
      // `['v2','tracks-feed']` invalidation here for the onboard list; that
      // renderer was deleted on 2026-08-18 and the key now has no producer.)
      // A full reload, not an incremental refresh: assigning an identity
      // rewrites the label without moving `lastSeen`, so the delta never
      // carries the row. See the registry.
      reloadEventsFeedsAfterBurst('face-assignment')
    },
  })
}

/**
 * Disassociate a person from EVERY event: resolve every face currently linked to
 * `identityId` (via `listRecentFaces {filter:'all'}` — manually assigned AND
 * auto-recognized, matching the server's own `deleteIdentity` resolution) then
 * batch-detach them with `unassignFaces {faceIds}`. The identity itself is
 * PRESERVED — only the per-face links are cleared, so the person can be
 * reassigned later. On success invalidates the same queries as the single
 * unassign so every affected event reflects "Unknown" without an app restart.
 * Resolves to the per-face outcome; throws on transport / server failure so the
 * UI can surface it. A no-op (0 unassigned) when the person has no linked faces
 * or the cap is absent.
 */
export function useUnassignAllForIdentity() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<MassUnassignResult, Error, { readonly identityId: string }>({
    mutationFn: async ({ identityId }): Promise<MassUnassignResult> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const client = system.trpcClient as Record<string, unknown>
      // Resolve the identity's faceIds. capQuery swallows a missing cap to null;
      // collectFaceIdsForIdentity then yields [] → a clean 0-face no-op.
      const rows = await capQuery(
        client,
        'faceGallery',
        'listRecentFaces',
        FACE_ID_RESOLUTION_QUERY,
      )
      const faceIds = collectFaceIdsForIdentity(rows, identityId)
      if (faceIds.length === 0) return { unassigned: 0, failed: [] }
      // Strict (throwing) call so a rejected/absent mutation surfaces in the UI.
      const raw = await strictMutate(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'unassignFaces',
        { faceIds },
      )
      return toMassUnassignResult(raw)
    },
    onSuccess: async () => {
      await invalidateFaceAssignmentQueriesNow(queryClient)  // A batch is one round trip, and its surface IS the list (D434).
      // The ONLY thing that puts the new name on an event card: the track
      // surfaces are the hub-hosted embed, which has its own feed inside the
      // WebView and hears no query-cache invalidation. (There used to be a
      // `['v2','tracks-feed']` invalidation here for the onboard list; that
      // renderer was deleted on 2026-08-18 and the key now has no producer.)
      // A full reload, not an incremental refresh: assigning an identity
      // rewrites the label without moving `lastSeen`, so the delta never
      // carries the row. See the registry.
      reloadEventsFeedsAfterBurst('face-assignment')
    },
  })
}

/**
 * Create a new person. Resolves with the created identity (validated) so the
 * caller can chain an immediate `assignFace`. Rejects when the server returned
 * nothing parseable (cap absent, validation error, auth).
 */
export function useCreateIdentity() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<PersonIdentity, Error, { readonly name: string }>({
    mutationFn: async ({ name }): Promise<PersonIdentity> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await strictMutate(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'createIdentity',
        { name },
      )
      const person = toIdentity(raw)
      if (person === null) throw new Error('createIdentity failed')
      return person
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2', IDENTITIES_KEY] })
    },
  })
}

/**
 * Batch-assign many buffered faces to ONE identity (`assignFaces`) — the face
 * mass-review tab's write path. Throws on a server that rejected/lacked the
 * mutation (a swallowed error here would read as "your batch was assigned"
 * when it silently wasn't); resolves to the per-face outcome so the caller can
 * report a PARTIAL success honestly instead of a flat pass/fail.
 *
 * Invalidates the same queries + reloads the events embeds as the single-face
 * `useAssignFace`, for the same reason documented there: the track surfaces
 * are the hub-hosted embed and hear no query-cache invalidation.
 */
export function useAssignFaces() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<
    MassAssignResult,
    Error,
    {
      readonly faceIds: readonly string[]
      readonly identityId: string
      /**
       * Skip the gallery refetch — the CALLER will do it once when its loop
       * ends (D434).
       *
       * "Apply suggestions" is one `assignFaces` per distinct PERSON, awaited
       * in sequence, so a selection spanning six people is six writes each
       * refetching five queries. A batch is not a burst; a LOOP of batches is.
       */
      readonly deferInvalidation?: boolean
    }
  >({
    mutationFn: async ({ faceIds, identityId }): Promise<MassAssignResult> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await strictMutate(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'assignFaces',
        { faceIds: [...faceIds], identityId },
      )
      return toMassAssignResult(raw)
    },
    onSuccess: async (_result, variables) => {
      // A batch is one round trip and its surface IS the list, so it refetches
      // at once — unless the caller says it is mid-loop and will do it itself.
      if (variables.deferInvalidation !== true) {
        await invalidateFaceAssignmentQueriesNow(queryClient)
      }
      reloadEventsFeedsAfterBurst('face-assignment')
    },
  })
}
