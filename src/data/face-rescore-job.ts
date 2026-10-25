/**
 * face-rescore-job — follow the whole-archive recompute job to its end.
 *
 * Framework-free so the polling rules (stop on completed / failed, resume a
 * job that is already running) are covered by the node vitest env.
 */
import { isUnknownActionError, type FaceRescoreClient, type FaceRescoreStatus } from './face-rescore.js'

export const RESCORE_POLL_MS = 1_500

export interface FollowRescoreOptions {
  readonly client: FaceRescoreClient
  /** true: call rescoreAll first; false: attach to whatever status says. */
  readonly start: boolean
  readonly onProgress: (status: FaceRescoreStatus) => void
  readonly sleep: (ms: number) => Promise<void>
  /** Polled between ticks; true abandons the loop (screen unmounted). */
  readonly cancelled?: () => boolean
}

/** Resolves with the last status seen: terminal, idle, or the one at cancel. */
export async function followRescoreJob(opts: FollowRescoreOptions): Promise<FaceRescoreStatus> {
  let status = opts.start ? await opts.client.rescoreAll() : await opts.client.rescoreStatus()
  while (status.state === 'running') {
    if (opts.cancelled?.()) return status
    opts.onProgress(status)
    await opts.sleep(RESCORE_POLL_MS)
    if (opts.cancelled?.()) return status
    status = await opts.client.rescoreStatus()
  }
  return status
}

export interface RecomputeArchiveOptions extends FollowRescoreOptions {
  /** Re-ask the hub for the face queries; called only after `completed`. */
  readonly invalidate: () => Promise<void>
  /** Hub too old for `face.rescoreAll`: the visible-rows loop. */
  readonly fallback: () => Promise<void>
}

export type RecomputeOutcome =
  | { readonly kind: 'job'; readonly status: FaceRescoreStatus }
  | { readonly kind: 'fallback' }

/** Follow the job, invalidate on completion, fall back on an unknown action. */
export async function recomputeArchive(opts: RecomputeArchiveOptions): Promise<RecomputeOutcome> {
  try {
    const status = await followRescoreJob(opts)
    if (status.state === 'completed' && !opts.cancelled?.()) await opts.invalidate()
    return { kind: 'job', status }
  } catch (err: unknown) {
    if (!opts.start || !isUnknownActionError(err)) throw err
    await opts.fallback()
    return { kind: 'fallback' }
  }
}
