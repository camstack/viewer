/**
 * The gallery audit — "which of this person's samples do not look like this
 * person?" — and the removal that follows from it.
 *
 * The gallery is the one input to recognition nobody re-reads: a sample
 * enrolled from the wrong face keeps voting forever, and because the matches it
 * pulls then look confident, nobody goes back to check. The hub answers the
 * question (`faceGallery.auditIdentitySamples`); this is the read side plus the
 * one write the panel offers.
 *
 * Narrowed defensively, like every other read in this folder: a hub too old for
 * the method answers nothing, and the panel must say "not available" rather
 * than render an empty accusation list that looks like a clean gallery.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutateOrThrow, capQuery, isRecord } from './cap-query.js'
import { IDENTITIES_KEY } from './face-query-keys.js'

const AUDIT_KEY = 'face-identity-audit'
const IDENTITY_SAMPLES_KEY = 'face-identity-samples'

export interface IdentityAuditForeign {
  readonly identityId: string
  readonly name: string
  readonly score: number
}

export interface IdentityAuditRow {
  readonly sampleId: string
  readonly enrolledAt: number
  readonly deviceId?: number
  readonly source: 'detected' | 'photo'
  /** The enrolled crop's media row id (D482), so the panel can show the
   *  evidence via `buildMediaIdUrl`. */
  readonly mediaId?: number
  /** False = a different face model; every number below says nothing. */
  readonly comparable: boolean
  readonly selfMean: number | null
  readonly bestForeign?: IdentityAuditForeign
  readonly suspicion: number
}

export interface IdentityAudit {
  readonly identityId: string
  readonly name: string
  readonly modelId: string
  readonly totalSamples: number
  readonly comparableSamples: number
  readonly flagged: number
  readonly flagThreshold: number
  readonly rows: readonly IdentityAuditRow[]
}

function toForeign(raw: unknown): IdentityAuditForeign | undefined {
  if (!isRecord(raw)) return undefined
  const { identityId, name, score } = raw
  if (typeof identityId !== 'string' || typeof name !== 'string') return undefined
  if (typeof score !== 'number') return undefined
  return { identityId, name, score }
}

/** One row, or null when it is not one. A malformed row is DROPPED, never
 *  defaulted: a zeroed score here reads as "looks like nobody", which is an
 *  accusation this list would then put a Remove button next to. */
export function toIdentityAuditRow(raw: unknown): IdentityAuditRow | null {
  if (!isRecord(raw)) return null
  const { sampleId, enrolledAt, deviceId, source, mediaId, comparable, selfMean, suspicion } = raw
  if (typeof sampleId !== 'string' || sampleId.length === 0) return null
  if (typeof comparable !== 'boolean' || typeof suspicion !== 'number') return null
  const foreign = toForeign(raw['bestForeign'])
  return {
    sampleId,
    enrolledAt: typeof enrolledAt === 'number' ? enrolledAt : 0,
    ...(typeof deviceId === 'number' ? { deviceId } : {}),
    source: source === 'photo' ? 'photo' : 'detected',
    ...(typeof mediaId === 'number' ? { mediaId } : {}),
    comparable,
    selfMean: typeof selfMean === 'number' ? selfMean : null,
    ...(foreign === undefined ? {} : { bestForeign: foreign }),
    suspicion,
  }
}

export function toIdentityAudit(raw: unknown): IdentityAudit | null {
  if (!isRecord(raw)) return null
  const { identityId, name, modelId, totalSamples, comparableSamples, flagged, flagThreshold } = raw
  if (typeof identityId !== 'string' || typeof name !== 'string') return null
  const rows = Array.isArray(raw['rows'])
    ? raw['rows'].map(toIdentityAuditRow).filter((r): r is IdentityAuditRow => r !== null)
    : []
  return {
    identityId,
    name,
    modelId: typeof modelId === 'string' ? modelId : '',
    totalSamples: typeof totalSamples === 'number' ? totalSamples : rows.length,
    comparableSamples: typeof comparableSamples === 'number' ? comparableSamples : rows.length,
    flagged: typeof flagged === 'number' ? flagged : 0,
    flagThreshold: typeof flagThreshold === 'number' ? flagThreshold : 0.5,
    rows,
  }
}

/**
 * Re-analyse one person's gallery. `null` identity = the panel is closed and
 * nothing is asked.
 *
 * `staleTime: 0` on purpose: the operator opens this AFTER removing something,
 * and a cached answer would still list the sample they just deleted.
 */
export function useIdentityAudit(identityId: string | null) {
  const { controller, state } = useConnection()
  return useQuery<IdentityAudit | null>({
    queryKey: ['v2', AUDIT_KEY, identityId],
    enabled: identityId !== null && state === 'connected',
    staleTime: 0,
    queryFn: async (): Promise<IdentityAudit | null> => {
      const system = controller.getSystem()
      if (!system || identityId === null) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'auditIdentitySamples',
        { identityId },
      )
      return toIdentityAudit(raw)
    },
  })
}

export interface RemoveSampleInput {
  readonly identityId: string
  readonly sampleId: string
}

/**
 * Drop one enrolled sample. THROWS on a hub that lacks the method so the panel
 * can say the removal did not happen — a swallowed failure here leaves the
 * operator believing a bad sample is gone while it keeps voting.
 *
 * ⚠ The procedure is resolved by {@link capMutateOrThrow}, never by an
 * `isRecord` guard. `cap-query.ts` says why in its own module doc: the tRPC v11
 * client is a proxy whose nodes are CALLABLE — `typeof` is `'function'` — so
 * `isRecord(router)` is false for every router this app has, and a resolution
 * written that way throws "unavailable" against a perfectly healthy hub before
 * it makes a call. That is exactly what this hook did, and it is the whole of
 * the operator's 2026-09-13 report: *"la cancellazione di un sample associato
 * non pare fare niente di niente"* — no call, no error, no change. Pinned by
 * `components/faces/__tests__/identity-audit-remove.spec.ts`, which mounts the
 * panel over the tRPC-shaped hub stub.
 */
export function useRemoveIdentitySample() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, RemoveSampleInput>({
    mutationFn: async ({ identityId, sampleId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw new Error('faceGallery.removeSample: not connected')
      await capMutateOrThrow(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'removeSample',
        { identityId, sampleId },
      )
    },
    onSuccess: async (_void, { identityId }) => {
      await queryClient.invalidateQueries({ queryKey: ['v2', AUDIT_KEY, identityId] })
      await queryClient.invalidateQueries({ queryKey: ['v2', IDENTITY_SAMPLES_KEY] })
      // `sampleCount` and the cover avatar are on the identity row, and both
      // move when a sample leaves. A panel that re-read only its own list left
      // "4 samples" under a person who now has 3, everywhere else in the app.
      await queryClient.invalidateQueries({ queryKey: ['v2', IDENTITIES_KEY] })
    },
  })
}
