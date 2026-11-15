/**
 * useFaceRescoreSession — the state behind `FaceRescoreControls`: run a
 * recompute for one face, keep its report, say which recompute is in flight,
 * and keep a failure with the face it was asked for.
 *
 * Shared by the track's face sheet (`FaceAssignSheet`) and the Library face
 * detail (`FaceReviewDetailModal`) so the two never disagree on what a report
 * belongs to. A report belongs to ONE face (`report.faceId`): both surfaces
 * are reused for the next face without unmounting, and a report kept across
 * that swap would show face A's percentages beside face B's crop — the worst
 * thing this feature could do, since the operator would act on it. So every
 * read goes through `reportFor(faceId)` / `scoresFor(faceId)`.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { log } from '../../lib/logger.js'
import { refusalAwareKey } from '../../auth/forbidden.js'
import { useFaceRescore } from '../../data/use-face-rescore.js'
import type { FaceRescoreIdentityRow, FaceRescoreReport } from '../../data/face-rescore.js'
import type { FaceRescorePending } from './FaceRescoreControls.js'

/** What a recompute needs to know about the face. */
export interface RescoreFace {
  readonly faceId: string
  readonly deviceId: number
  readonly trackId: string
}

/** A failed recompute, kept with the face it was asked for. */
interface RescoreFailure {
  readonly faceId: string
  readonly message: string
}

/** Anything listed by identity id (a person row). */
export interface RescoreRanked {
  readonly id: string
}

const NO_SCORES: ReadonlyMap<string, FaceRescoreIdentityRow> = new Map()

export interface FaceRescoreSession {
  /** Which recompute is in flight, if any. */
  readonly pending: FaceRescorePending
  /** The last report, if it belongs to this face. */
  readonly reportFor: (faceId: string | undefined) => FaceRescoreReport | null
  /** identityId → fresh row for this face; empty before a recompute. */
  readonly scoresFor: (faceId: string | undefined) => ReadonlyMap<string, FaceRescoreIdentityRow>
  /** The failure message for this face, if its last recompute failed. */
  readonly errorFor: (faceId: string | undefined) => string | null
  /** Recompute (`reembed` re-runs the embedding on a node first). */
  readonly run: (face: RescoreFace, reembed: boolean) => Promise<void>
  /** Forget the report and the failure (the surface closed). */
  readonly reset: () => void
}

/** `logScope` names the surface in the log line of a failure. */
export function useFaceRescoreSession(logScope: string): FaceRescoreSession {
  const { t } = useTranslation()
  const rescore = useFaceRescore()
  const [report, setReport] = useState<FaceRescoreReport | null>(null)
  const [pending, setPending] = useState<FaceRescorePending>(null)
  const [failure, setFailure] = useState<RescoreFailure | null>(null)

  const run = useCallback(
    async (face: RescoreFace, reembed: boolean): Promise<void> => {
      if (pending !== null) return
      setFailure(null)
      setPending(reembed ? 'reembed' : 'rescore')
      try {
        setReport(await rescore.mutateAsync({ deviceId: face.deviceId, trackId: face.trackId, reembed }))
      } catch (err: unknown) {
        log.error(logScope, 'rescore threw', {
          deviceId: face.deviceId,
          trackId: face.trackId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        setFailure({ faceId: face.faceId, message: t(refusalAwareKey(err, 'v2.tracks.rescore.failed')) })
      } finally {
        setPending(null)
      }
    },
    [logScope, pending, rescore, t],
  )

  const reportFor = useCallback(
    (faceId: string | undefined): FaceRescoreReport | null =>
      report !== null && faceId !== undefined && report.faceId === faceId ? report : null,
    [report],
  )

  const scoresMap = useMemo(
    (): ReadonlyMap<string, FaceRescoreIdentityRow> =>
      report === null ? NO_SCORES : new Map(report.identities.map((row) => [row.identityId, row])),
    [report],
  )
  const scoresFor = useCallback(
    (faceId: string | undefined): ReadonlyMap<string, FaceRescoreIdentityRow> =>
      reportFor(faceId) !== null ? scoresMap : NO_SCORES,
    [reportFor, scoresMap],
  )

  const errorFor = useCallback(
    (faceId: string | undefined): string | null =>
      failure !== null && faceId !== undefined && failure.faceId === faceId ? failure.message : null,
    [failure],
  )

  const reset = useCallback(() => {
    setReport(null)
    setFailure(null)
  }, [])

  return useMemo(
    () => ({ pending, reportFor, scoresFor, errorFor, run, reset }),
    [pending, reportFor, scoresFor, errorFor, run, reset],
  )
}

/** Best-first once scored: the operator's next tap is almost always the top row. */
export function orderByRescore<T extends RescoreRanked>(
  items: readonly T[],
  scores: ReadonlyMap<string, FaceRescoreIdentityRow>,
): readonly T[] {
  if (scores.size === 0) return items
  const rank = (id: string): number => scores.get(id)?.score ?? Number.NEGATIVE_INFINITY
  return [...items].sort((a, b) => rank(b.id) - rank(a.id))
}
