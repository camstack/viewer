/**
 * face-review-jobs — the People page's long actions, as Activity-queue jobs.
 *
 * Each builder returns a `JobRequest` (title + the function the queue runs). The
 * function reaches the hub only through the injected ports, so it is the same
 * code in the app and in the specs, and carries no React: the job outlives the
 * screen that queued it (the operator leaves People while it runs).
 *
 * What used to be a banner at the top of the page — "Assigned 3 faces to Anna",
 * "Recomputed 40 faces", a refusal with the hub's reason — is now the job's
 * summary or its failure, shown in the Activity centre.
 */
import type { JobRequest } from '../activity/activity-store.js'
import { log } from '../lib/logger.js'
import type { Translate } from './export-format.js'
import { recomputeArchive } from './face-rescore-job.js'
import type { FaceRescoreClient, FaceRescoreStatus } from './face-rescore.js'
import type { AnalyzeAssignPlanEntry } from './face-cluster-review.js'
import type { SuggestionAssignEntry } from './face-review-suggestions.js'
import { suggestionPlanFaceCount } from './face-review-suggestions.js'

/** What a job needs from the hub and from the query cache. */
export interface FaceJobPorts {
  readonly assign: (input: {
    readonly faceIds: readonly string[]
    readonly identityId: string
    /** Mid-loop: the caller flushes the queries once at the end. */
    readonly defer: boolean
  }) => Promise<{ readonly assigned: number; readonly failed: readonly string[] }>
  readonly createPerson: (name: string) => Promise<{ readonly id: string; readonly name: string }>
  readonly deleteFaces: (faceIds: readonly string[]) => Promise<{ readonly deleted: number }>
  /** Re-ask the hub for every face query (the end of a loop of deferred writes). */
  readonly flush: () => Promise<void>
  readonly rescoreClient: () => FaceRescoreClient | null
  /** `face.rescoreTrack` for one row; resolves when it landed, rejects when it did not. */
  readonly rescoreTrack: (row: RescoreTarget) => Promise<void>
  readonly sleep: (ms: number) => Promise<void>
}

export interface RescoreTarget {
  readonly deviceId: number
  readonly trackId: string
}

/** How many `face.rescoreTrack` probes the fallback runs at once. */
export const RESCORE_FALLBACK_CONCURRENCY = 4

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function logError(scope: string, message: string, fields: Record<string, unknown>, error: unknown): void {
  log.error(scope, message, { ...fields, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
}

// ── Assign ───────────────────────────────────────────────────────────────────

export interface AssignJobInput {
  readonly faceIds: readonly string[]
  /** A known person, or a name to create first. */
  readonly target: { readonly identityId: string; readonly name: string } | { readonly newName: string }
}

/** Put one person on a set of faces (the detail modal's Assign / Create). */
export function assignJob(ports: FaceJobPorts, t: Translate, input: AssignJobInput): JobRequest {
  const name = 'newName' in input.target ? input.target.newName : input.target.name
  return {
    jobKind: 'face-assign',
    title: t('v2.faceReview.jobs.assignTitle', { count: input.faceIds.length, name }),
    run: async () => {
      try {
        const person =
          'newName' in input.target
            ? await ports.createPerson(input.target.newName)
            : { id: input.target.identityId, name: input.target.name }
        const result = await ports.assign({ faceIds: input.faceIds, identityId: person.id, defer: false })
        if (result.assigned === 0) {
          // The hub ANSWERED and assigned nothing: the answer names which faces
          // failed, and an empty list means the response itself was not understood.
          log.error('face-assign', 'the hub assigned none of the faces', {
            identityId: person.id,
            asked: input.faceIds.length,
            failed: result.failed.length,
            failedIds: result.failed.slice(0, 10),
            unrecognisedResponse: result.failed.length === 0,
          })
          throw new Error(t('v2.faceReview.assignFailed'))
        }
        return {
          summary:
            input.faceIds.length > 1
              ? t('v2.faceReview.assignedManySuccess', { count: result.assigned, name: person.name })
              : t('v2.faceReview.assignedSuccess', { name: person.name }),
        }
      } catch (error: unknown) {
        logError('face-assign', 'the assign job threw', { asked: input.faceIds.length }, error)
        throw error instanceof Error ? error : new Error(t('v2.faceReview.assignFailed'))
      }
    },
  }
}

// ── Apply suggestions ────────────────────────────────────────────────────────

/** Each selected face onto its OWN suggested person: one write per person. */
export function applySuggestionsJob(
  ports: FaceJobPorts,
  t: Translate,
  plan: readonly SuggestionAssignEntry[],
): JobRequest {
  const total = suggestionPlanFaceCount(plan)
  return {
    jobKind: 'face-apply-suggestions',
    title: t('v2.faceReview.jobs.applyTitle', { count: total }),
    run: async (context) => {
      let assigned = 0
      let handled = 0
      context.progress(0, total)
      try {
        for (const entry of plan) {
          try {
            const result = await ports.assign({ faceIds: entry.faceIds, identityId: entry.identityId, defer: true })
            assigned += result.assigned
          } catch (error: unknown) {
            logError('face-assign', 'an apply-suggestions write threw', { identityId: entry.identityId, asked: entry.faceIds.length }, error)
          }
          handled += entry.faceIds.length
          context.progress(handled, total)
        }
      } finally {
        // Even a pass that wrote nothing leaves the screen on the window it was derived from.
        await ports.flush()
      }
      if (assigned === 0) throw new Error(t('v2.faceReview.assignFailed'))
      return { summary: t('v2.faceReview.applySuggestionsResult', { count: assigned, groups: plan.length, total }) }
    },
  }
}

// ── Similar groups ───────────────────────────────────────────────────────────

/** The Similar-groups modal's confirmed plan: one write per group, in order. */
export function analyzeAssignJob(
  ports: FaceJobPorts,
  t: Translate,
  plan: readonly AnalyzeAssignPlanEntry[],
): JobRequest {
  const total = plan.reduce((sum, entry) => sum + entry.faceIds.length, 0)
  return {
    jobKind: 'face-analyze-assign',
    title: t('v2.faceReview.jobs.analyzeTitle', { count: total, groups: plan.length }),
    run: async (context) => {
      let assigned = 0
      let handled = 0
      // The hub's OWN words for whatever it refused, so a count can be acted on.
      const reasons = new Set<string>()
      context.progress(0, total)
      try {
        for (const entry of plan) {
          try {
            const result = await ports.assign({ faceIds: entry.faceIds, identityId: entry.identityId, defer: true })
            assigned += result.assigned
          } catch (error: unknown) {
            reasons.add(describeError(error))
            logError('face-assign', 'a similar-group write threw', { identityId: entry.identityId, asked: entry.faceIds.length }, error)
          }
          handled += entry.faceIds.length
          context.progress(handled, total)
        }
      } finally {
        await ports.flush()
      }
      if (assigned === 0) throw new Error([t('v2.faceReview.analyzeAssignFailed'), ...reasons].join(' '))
      const result = t('v2.faceReview.analyzeResult', { assigned, count: total })
      const refused = assigned < total ? [t('v2.faceReview.analyzeAssignFailed'), ...reasons].join(' ') : null
      return { summary: refused === null ? result : `${result} ${refused}` }
    },
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

/** Remove parked faces (already confirmed by the caller). */
export function deleteFacesJob(ports: FaceJobPorts, t: Translate, faceIds: readonly string[]): JobRequest {
  return {
    jobKind: 'face-delete',
    title: t('v2.faceReview.jobs.deleteTitle', { count: faceIds.length }),
    run: async () => {
      try {
        const result = await ports.deleteFaces(faceIds)
        return { summary: t('v2.faceReview.deleteResult', { count: result.deleted, total: faceIds.length }) }
      } catch (error: unknown) {
        logError('face-delete', 'the delete job threw', { asked: faceIds.length }, error)
        throw new Error(t('v2.faceReview.deleteFailed'))
      }
    },
  }
}

// ── Recompute ────────────────────────────────────────────────────────────────

export interface RescoreJobInput {
  /** true: ask the hub to start the archive job; false: follow the one already running. */
  readonly start: boolean
  /** Rows to probe one by one when the hub predates `face.rescoreAll`. */
  readonly fallbackRows: readonly RescoreTarget[]
}

function rescoreSummary(status: FaceRescoreStatus, t: Translate): string {
  return t('v2.faceReview.recomputeSummary', {
    count: status.changed,
    raised: status.raised,
    lowered: status.lowered,
    cleared: status.cleared,
    modelMismatch: status.modelMismatch,
  })
}

async function probeRows(
  ports: FaceJobPorts,
  rows: readonly RescoreTarget[],
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  let done = 0
  let succeeded = 0
  const queue = [...rows]
  const worker = async (): Promise<void> => {
    for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
      try {
        await ports.rescoreTrack(row)
        succeeded += 1
      } catch {
        // One bad probe must not abort the batch: that row stays as it was.
      }
      done += 1
      onProgress(done, rows.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESCORE_FALLBACK_CONCURRENCY, rows.length) }, worker))
  return succeeded
}

/** Recompute every suggestion's percentage: follow the hub's archive job to its end. */
export function rescoreJob(ports: FaceJobPorts, t: Translate, input: RescoreJobInput): JobRequest {
  return {
    jobKind: 'face-rescore',
    title: t('v2.faceReview.jobs.recomputeTitle'),
    run: async (context) => {
      const client = ports.rescoreClient()
      if (client === null) throw new Error(t('v2.common.offline'))
      let probed = 0
      try {
        const outcome = await recomputeArchive({
          client,
          start: input.start,
          onProgress: (status) => context.progress(status.scanned, status.total),
          sleep: ports.sleep,
          invalidate: ports.flush,
          fallback: async () => {
            log.debug('face-rescore', 'hub has no face.rescoreAll, recomputing visible rows')
            probed = await probeRows(ports, input.fallbackRows, context.progress)
            await ports.flush()
          },
        })
        if (outcome.kind === 'fallback') return { summary: t('v2.faceReview.recomputeDone', { count: probed }) }
        if (outcome.status.state === 'failed') {
          throw new Error(t('v2.faceReview.recomputeFailed', { error: outcome.status.error ?? '' }))
        }
        if (outcome.status.state === 'completed') return { summary: rescoreSummary(outcome.status, t) }
        return { summary: t('v2.faceReview.recomputeIdle') }
      } catch (error: unknown) {
        logError('face-rescore', 'archive recompute threw', {}, error)
        throw error instanceof Error ? error : new Error(t('v2.faceReview.recomputeFailed', { error: '' }))
      }
    },
  }
}
