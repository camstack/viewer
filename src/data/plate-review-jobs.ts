/**
 * plate-review-jobs — the Plates page's long actions, as Activity-queue jobs.
 * The twin of `face-review-jobs.ts`: each builder returns a `JobRequest` whose
 * `run` reaches the hub only through injected ports, so the job outlives the
 * screen that queued it and is the same code in the app and in the specs.
 */
import type { JobRequest } from '../activity/activity-store.js'
import { log } from '../lib/logger.js'
import type { Translate } from './export-format.js'
import type { PlateSuggestionEntry } from './plate-review.js'

export interface PlateJobPorts {
  readonly assign: (input: {
    readonly plateIds: readonly string[]
    readonly vehicleId: string
    /** Mid-loop: the caller flushes the queries once at the end. */
    readonly defer: boolean
  }) => Promise<{ readonly assigned: number; readonly failed: readonly string[] }>
  readonly createVehicle: (name: string) => Promise<{ readonly id: string; readonly name: string }>
  readonly deletePlates: (plateIds: readonly string[]) => Promise<{ readonly deleted: number }>
  /** Re-ask the hub for every plate query (the end of a loop of deferred writes). */
  readonly flush: () => Promise<void>
}

function logError(scope: string, message: string, fields: Record<string, unknown>, error: unknown): void {
  log.error(scope, message, { ...fields, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
}

export interface PlateAssignJobInput {
  readonly plateIds: readonly string[]
  /** A known vehicle, or a name to create first. */
  readonly target: { readonly vehicleId: string; readonly name: string } | { readonly newName: string }
}

/** Put one vehicle on a set of reads (the detail modal's Assign / Create). */
export function plateAssignJob(ports: PlateJobPorts, t: Translate, input: PlateAssignJobInput): JobRequest {
  const name = 'newName' in input.target ? input.target.newName : input.target.name
  return {
    jobKind: 'plate-assign',
    title: t('v2.plateReview.jobs.assignTitle', { count: input.plateIds.length, name }),
    run: async () => {
      try {
        const vehicle =
          'newName' in input.target
            ? await ports.createVehicle(input.target.newName)
            : { id: input.target.vehicleId, name: input.target.name }
        const result = await ports.assign({ plateIds: input.plateIds, vehicleId: vehicle.id, defer: false })
        if (result.assigned === 0) {
          log.error('plate-assign', 'the hub assigned none of the plates', {
            vehicleId: vehicle.id,
            asked: input.plateIds.length,
            failed: result.failed.length,
            failedIds: result.failed.slice(0, 10),
          })
          throw new Error(t('v2.plateReview.assignFailed'))
        }
        return {
          summary:
            input.plateIds.length > 1
              ? t('v2.plateReview.assignedManySuccess', { count: result.assigned, name: vehicle.name })
              : t('v2.plateReview.assignedSuccess', { name: vehicle.name }),
        }
      } catch (error: unknown) {
        logError('plate-assign', 'the assign job threw', { asked: input.plateIds.length }, error)
        throw error instanceof Error ? error : new Error(t('v2.plateReview.assignFailed'))
      }
    },
  }
}

/** Each selected read onto its OWN suggested vehicle: one write per vehicle. */
export function plateApplySuggestionsJob(
  ports: PlateJobPorts,
  t: Translate,
  plan: readonly PlateSuggestionEntry[],
): JobRequest {
  const total = plan.reduce((sum, entry) => sum + entry.plateIds.length, 0)
  return {
    jobKind: 'plate-apply-suggestions',
    title: t('v2.plateReview.jobs.applyTitle', { count: total }),
    run: async (context) => {
      let assigned = 0
      let handled = 0
      context.progress(0, total)
      try {
        for (const entry of plan) {
          try {
            const result = await ports.assign({ plateIds: entry.plateIds, vehicleId: entry.vehicleId, defer: true })
            assigned += result.assigned
          } catch (error: unknown) {
            logError('plate-assign', 'an apply-suggestions write threw', { vehicleId: entry.vehicleId, asked: entry.plateIds.length }, error)
          }
          handled += entry.plateIds.length
          context.progress(handled, total)
        }
      } finally {
        await ports.flush()
      }
      if (assigned === 0) throw new Error(t('v2.plateReview.assignFailed'))
      return { summary: t('v2.plateReview.applySuggestionsResult', { count: assigned, groups: plan.length, total }) }
    },
  }
}

/** Remove reads that belong to no vehicle (already confirmed by the caller). */
export function plateDeleteJob(ports: PlateJobPorts, t: Translate, plateIds: readonly string[]): JobRequest {
  return {
    jobKind: 'plate-delete',
    title: t('v2.plateReview.jobs.deleteTitle', { count: plateIds.length }),
    run: async () => {
      try {
        const result = await ports.deletePlates(plateIds)
        return { summary: t('v2.plateReview.deleteResult', { count: result.deleted, total: plateIds.length }) }
      } catch (error: unknown) {
        logError('plate-delete', 'the delete job threw', { asked: plateIds.length }, error)
        throw new Error(t('v2.plateReview.deleteFailed'))
      }
    },
  }
}
