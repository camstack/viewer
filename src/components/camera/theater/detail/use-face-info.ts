/**
 * useFaceInfo — queries and mutations for the `face-gallery` system capability.
 *
 * Exposes:
 *   - faceInfo: FaceInfo | null  (null = no face enrolled for this track)
 *   - identities: IdentityInfo[]
 *   - loading / mutating / error state
 *   - assign(faceId, identityId): Promise<void>
 *   - unassign(faceId): Promise<void>
 *   - createAndAssign(faceId, name): Promise<void>
 *
 * Pattern: queries via capQuery, mutations via system.trpcClient.<cap>.<method>.mutate(input)
 * (matches the pattern used in srcV2/data/use-ptz.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection } from '../../../../connection/ConnectionProvider.js'
import { capQuery, isRecord } from '../../../../data/cap-query.js'
import {
  collectFaceIdsForIdentity,
  FACE_ID_RESOLUTION_QUERY,
} from '../../../../data/use-face-gallery.js'
import { log } from '../../../../lib/logger.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FaceInfo {
  readonly faceId: string
  readonly deviceId: number
  readonly trackId: string
  readonly timestamp: number
  readonly recognizedIdentityId?: string
  readonly identityName?: string
  readonly assigned: boolean
  readonly cropUrl?: string
  readonly base64?: string
  /** Winning cosine similarity (0..1) of the auto-match. Undefined on legacy/manual rows. */
  readonly bestMatchScore?: number
  /** Native face short-side px, when the server stored it. Undefined on legacy rows. */
  readonly nativeFaceShortSidePx?: number
  /** A plausible-but-not-confident match the recognizer found WITHOUT
   *  auto-assigning; the operator can confirm or dismiss it. Undefined when
   *  there was no suggestion. */
  readonly suggestedIdentityId?: string
  /** The suggested match's score (0..1). Undefined when there's no suggestion. */
  readonly suggestedMatchScore?: number
}

export interface IdentityInfo {
  readonly id: string
  readonly name: string
  readonly sampleCount: number
  /** Cover crop media row id (D482). No importer reaches this module (see
   *  `FaceAssignPanel.tsx`) — kept in step with the wire shape regardless. */
  readonly coverMediaId?: number
}

export interface FaceInfoResult {
  readonly faceInfo: FaceInfo | null
  readonly identities: IdentityInfo[]
  readonly loading: boolean
  readonly mutating: boolean
  readonly error: string | null
  readonly assign: (faceId: string, identityId: string) => Promise<void>
  readonly unassign: (faceId: string) => Promise<void>
  readonly unassignAll: (identityId: string) => Promise<void>
  readonly createAndAssign: (faceId: string, name: string) => Promise<void>
  readonly clearError: () => void
}

// ─── Defensive parsers ────────────────────────────────────────────────────

function parseFaceInfo(raw: unknown): FaceInfo | null {
  if (!isRecord(raw)) return null
  if (typeof raw.faceId !== 'string' || raw.faceId.length === 0) return null
  if (typeof raw.trackId !== 'string') return null
  if (typeof raw.deviceId !== 'number') return null
  if (typeof raw.timestamp !== 'number') return null
  return {
    faceId: raw.faceId,
    deviceId: raw.deviceId,
    trackId: raw.trackId,
    timestamp: raw.timestamp,
    recognizedIdentityId: typeof raw.recognizedIdentityId === 'string' ? raw.recognizedIdentityId : undefined,
    identityName: typeof raw.identityName === 'string' ? raw.identityName : undefined,
    assigned: typeof raw.assigned === 'boolean' ? raw.assigned : false,
    cropUrl: typeof raw.cropUrl === 'string' && raw.cropUrl.length > 0 ? raw.cropUrl : undefined,
    base64: typeof raw.base64 === 'string' && raw.base64.length > 0 ? raw.base64 : undefined,
    bestMatchScore:
      typeof raw.bestMatchScore === 'number' && Number.isFinite(raw.bestMatchScore)
        ? raw.bestMatchScore
        : undefined,
    nativeFaceShortSidePx:
      typeof raw.nativeFaceShortSidePx === 'number' && Number.isFinite(raw.nativeFaceShortSidePx)
        ? raw.nativeFaceShortSidePx
        : undefined,
    suggestedIdentityId:
      typeof raw.suggestedIdentityId === 'string' && raw.suggestedIdentityId.length > 0
        ? raw.suggestedIdentityId
        : undefined,
    suggestedMatchScore:
      typeof raw.suggestedMatchScore === 'number' && Number.isFinite(raw.suggestedMatchScore)
        ? raw.suggestedMatchScore
        : undefined,
  }
}

function parseIdentities(raw: unknown): IdentityInfo[] {
  if (!Array.isArray(raw)) return []
  const out: IdentityInfo[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue
    out.push({
      id: item.id,
      name: item.name,
      sampleCount: typeof item.sampleCount === 'number' ? item.sampleCount : 0,
      coverMediaId: typeof item.coverMediaId === 'number' ? item.coverMediaId : undefined,
    })
  }
  return out
}

function parseCreatedId(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return typeof raw.id === 'string' ? raw.id : null
}

// ─── Mutation helper ──────────────────────────────────────────────────────

async function callMutate(
  client: Record<string, unknown>,
  cap: string,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const router = (client as Record<string, unknown>)[cap]
  if (router === undefined || router === null) throw new Error(`cap "${cap}" not found`)
  const fn = (router as Record<string, unknown>)[method]
  const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error(`"${cap}.${method}" has no mutate`)
  return await (mutate as (i: Record<string, unknown>) => Promise<unknown>)(input)
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useFaceInfo(deviceId: number, trackId: string | undefined): FaceInfoResult {
  const { controller, state } = useConnection()
  const [faceInfo, setFaceInfo] = useState<FaceInfo | null>(null)
  const [identities, setIdentities] = useState<IdentityInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (ac: AbortController): Promise<void> => {
    if (state !== 'connected' || !trackId) return
    setLoading(true)
    try {
      const system = controller.getSystem()
      if (!system) { setLoading(false); return }
      const client = system.trpcClient as Record<string, unknown>

      const [rawFace, rawIdentities] = await Promise.all([
        capQuery(client, 'faceGallery', 'getFaceByTrack', { deviceId, trackId }),
        capQuery(client, 'faceGallery', 'listIdentities', {}),
      ])
      if (ac.signal.aborted) return
      setFaceInfo(parseFaceInfo(rawFace))
      setIdentities(parseIdentities(rawIdentities))
    } catch (err) {
      if (ac.signal.aborted) return
      log.warn('theater:detail:face', 'fetch failed', { trackId, error: String(err) })
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }, [controller, state, deviceId, trackId])

  useEffect(() => {
    if (!trackId || state !== 'connected') {
      setFaceInfo(null)
      setIdentities([])
      return
    }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    void fetchAll(ac)
    return () => { ac.abort() }
  }, [fetchAll, trackId, state])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const assign = useCallback(async (faceId: string, identityId: string): Promise<void> => {
    setMutating(true)
    setError(null)
    try {
      const system = controller.getSystem()
      if (!system) throw new Error('Not connected')
      await callMutate(system.trpcClient as Record<string, unknown>, 'faceGallery', 'assignFace', { faceId, identityId })
      // Refresh
      const ac = new AbortController()
      await fetchAll(ac)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('theater:detail:face', 'assignFace failed', { faceId, identityId, error: msg })
      setError(msg)
    } finally {
      setMutating(false)
    }
  }, [controller, fetchAll])

  const unassign = useCallback(async (faceId: string): Promise<void> => {
    setMutating(true)
    setError(null)
    try {
      const system = controller.getSystem()
      if (!system) throw new Error('Not connected')
      await callMutate(system.trpcClient as Record<string, unknown>, 'faceGallery', 'unassignFace', { faceId })
      const ac = new AbortController()
      await fetchAll(ac)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('theater:detail:face', 'unassignFace failed', { faceId, error: msg })
      setError(msg)
    } finally {
      setMutating(false)
    }
  }, [controller, fetchAll])

  // Disassociate a person from EVERY event: resolve all faces linked to
  // `identityId` (FACE_ID_RESOLUTION_QUERY — `filter:'all'`, mirroring the
  // server's own deleteIdentity resolution, and NO inline crops: this reads ids
  // only) then batch-detach via unassignFaces. The identity is preserved.
  // Refreshes the panel so this face reads "Unknown" immediately.
  const unassignAll = useCallback(async (identityId: string): Promise<void> => {
    setMutating(true)
    setError(null)
    try {
      const system = controller.getSystem()
      if (!system) throw new Error('Not connected')
      const client = system.trpcClient as Record<string, unknown>
      const rows = await capQuery(
        client,
        'faceGallery',
        'listRecentFaces',
        FACE_ID_RESOLUTION_QUERY,
      )
      const faceIds = collectFaceIdsForIdentity(rows, identityId)
      if (faceIds.length > 0) {
        await callMutate(client, 'faceGallery', 'unassignFaces', { faceIds })
      }
      const ac = new AbortController()
      await fetchAll(ac)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('theater:detail:face', 'unassignAll failed', { identityId, error: msg })
      setError(msg)
    } finally {
      setMutating(false)
    }
  }, [controller, fetchAll])

  const createAndAssign = useCallback(async (faceId: string, name: string): Promise<void> => {
    setMutating(true)
    setError(null)
    try {
      const system = controller.getSystem()
      if (!system) throw new Error('Not connected')
      const client = system.trpcClient as Record<string, unknown>
      const created = await callMutate(client, 'faceGallery', 'createIdentity', { name })
      const identityId = parseCreatedId(created)
      if (!identityId) throw new Error('createIdentity returned no id')
      await callMutate(client, 'faceGallery', 'assignFace', { faceId, identityId })
      const ac = new AbortController()
      await fetchAll(ac)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('theater:detail:face', 'createAndAssign failed', { faceId, name, error: msg })
      setError(msg)
    } finally {
      setMutating(false)
    }
  }, [controller, fetchAll])

  const clearError = useCallback(() => { setError(null) }, [])

  return { faceInfo, identities, loading, mutating, error, assign, unassign, unassignAll, createAndAssign, clearError }
}
