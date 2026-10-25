/**
 * face-rescore — "score this face against the gallery AS IT IS NOW".
 *
 * ## Why the button exists
 *
 * The suggestion the track already shows (`suggestedIdentityId` /
 * `suggestedMatchScore`) is NOT computed when you open the track. It is
 * computed during live detection, frame by frame, and the per-track peak is
 * persisted when the track closes. It is a photograph of what the gallery said
 * at that instant — so it is stale by construction for every enrolment made
 * since, and nothing refreshes it.
 *
 * That breaks the exact workflow this feature is for: assign ten faces to build
 * a person up, then open an older unassigned track and ask "does it match now?"
 * — and read a number decided before any of those ten existed. `face.rescoreTrack`
 * asks the question again against the CURRENT gallery and answers for every
 * identity, not just the winner.
 *
 * ## Framework-free on purpose
 *
 * The wire schema, the percentage formatting and the tone bands are the logic
 * worth testing; keeping them out of the RN layer lets the node vitest env
 * cover them (`data/__tests__/face-rescore.spec.ts`), which is the same split
 * `face-confidence.ts` and `face-suggestion.ts` already use.
 */
import { z } from 'zod'

const ADDON = 'pipeline-analytics'
const ACTION = 'face.rescoreTrack'

/** Mirrors the addon's `FaceRescoreVerdictSchema`. Parsed, never trusted raw. */
export const FaceRescoreVerdictSchema = z.enum([
  'auto-assignable',
  'ambiguous',
  'suggestion',
  'below-threshold',
  'no-eligible-identity',
  'empty-gallery',
  'model-mismatch',
])
export type FaceRescoreVerdict = z.infer<typeof FaceRescoreVerdictSchema>

export const FaceRescoreParamsSchema = z.object({
  threshold: z.number(),
  margin: z.number(),
  minIdentitySamples: z.number(),
  suggestionMinCosine: z.number(),
})
export type FaceRescoreParams = z.infer<typeof FaceRescoreParamsSchema>

export const FaceRescoreIdentityRowSchema = z.object({
  identityId: z.string(),
  name: z.string(),
  /** Raw cosine — formatted by {@link formatRescoreScore}, never rendered raw. */
  score: z.number(),
  sampleCount: z.number(),
  eligible: z.boolean(),
  meetsThreshold: z.boolean(),
  wouldAutoAssign: z.boolean(),
})
export type FaceRescoreIdentityRow = z.infer<typeof FaceRescoreIdentityRowSchema>

export const FaceReembedReportSchema = z.object({
  attempted: z.boolean(),
  succeeded: z.boolean(),
  reason: z.string().optional(),
  detail: z.string().optional(),
  modelId: z.string().optional(),
})
export type FaceReembedReport = z.infer<typeof FaceReembedReportSchema>

export const FaceRescoreReportSchema = z.object({
  faceId: z.string(),
  deviceId: z.number(),
  trackId: z.string(),
  assigned: z.boolean(),
  assignedIdentityId: z.string().optional(),
  storedSuggestedIdentityId: z.string().optional(),
  storedSuggestedMatchScore: z.number().optional(),
  verdict: FaceRescoreVerdictSchema,
  comparable: z.boolean(),
  probeModelId: z.string(),
  clusterModelId: z.string(),
  params: FaceRescoreParamsSchema,
  identities: z.array(FaceRescoreIdentityRowSchema),
  runnerUpGap: z.number().optional(),
  reembedAvailable: z.boolean(),
  reembed: FaceReembedReportSchema,
})
export type FaceRescoreReport = z.infer<typeof FaceRescoreReportSchema>

/**
 * A cosine as a whole percentage, clamped to 0..100.
 *
 * Clamped because cosine is SIGNED and a percentage is not: a genuinely
 * orthogonal-or-worse probe produces a negative number, and "−12% match" reads
 * as a bug rather than as "nothing like this person". Null for a non-finite
 * score so the caller renders nothing instead of "NaN%".
 */
export function formatRescoreScore(score: number): string | null {
  if (!Number.isFinite(score)) return null
  const clamped = Math.min(1, Math.max(0, score))
  return `${Math.round(clamped * 100)}%`
}

/**
 * How a single identity row should read.
 *
 * `blocked` outranks every score band on purpose: an identity excluded by
 * `minIdentitySamples` can score 99% and still be un-assignable, and a row that
 * LOOKS assignable but is not sends the operator to the threshold knob when the
 * actual fix is enrolling a second sample.
 */
export type FaceRescoreRowTone =
  | 'would-assign'
  | 'over-threshold'
  | 'suggestion'
  | 'below'
  | 'blocked'

export function rescoreRowTone(
  row: FaceRescoreIdentityRow,
  params: FaceRescoreParams,
): FaceRescoreRowTone {
  if (!row.eligible) return 'blocked'
  if (row.wouldAutoAssign) return 'would-assign'
  if (row.score >= params.threshold) return 'over-threshold'
  if (row.score >= params.suggestionMinCosine) return 'suggestion'
  return 'below'
}

/**
 * Headline tone for the verdict.
 *
 * `model-mismatch` is `warning`, NOT `low`. They are opposite statements — "the
 * gallery does not know this face" versus "this question cannot be answered in
 * this feature space" — and collapsing the second into the first is exactly how
 * an operator concludes a person is missing from a gallery they are in.
 */
export type FaceRescoreTone = 'good' | 'medium' | 'low' | 'warning'

export function rescoreVerdictTone(verdict: FaceRescoreVerdict): FaceRescoreTone {
  switch (verdict) {
    case 'auto-assignable':
      return 'good'
    case 'suggestion':
    case 'ambiguous':
      return 'medium'
    case 'model-mismatch':
      return 'warning'
    case 'below-threshold':
    case 'no-eligible-identity':
    case 'empty-gallery':
      return 'low'
  }
}

/** i18n key for the verdict headline. One key per verdict, never a fallback. */
export function rescoreVerdictKey(verdict: FaceRescoreVerdict): string {
  return `v2.tracks.rescore.verdict.${verdict}`
}

/**
 * Should the UI offer "re-embed and try again"?
 *
 * Only when it could change the answer: the face must be OUT of the cluster's
 * feature space (the sole condition a re-embed fixes), the backend must have
 * found pixels to re-embed from, and a successful re-embed must not already
 * have happened — otherwise the button would run inference to reproduce a
 * result the operator is already looking at.
 */
export function shouldOfferReembed(report: FaceRescoreReport): boolean {
  if (report.verdict !== 'model-mismatch') return false
  if (!report.reembedAvailable) return false
  return !report.reembed.succeeded
}

export interface FaceRescoreClientDeps {
  readonly addonsCustomMutate: (args: {
    addonId: string
    action: string
    input: unknown
  }) => Promise<unknown>
}

export interface FaceRescoreInput {
  readonly deviceId: number
  readonly trackId: string
  /** Absent means FALSE. A recompute never runs inference by surprise. */
  readonly reembed?: boolean
}

/**
 * Status of the whole-archive recompute job (`face.rescoreStatus`). Parsed,
 * never cast: `jobId`/`startedAt` are null while idle.
 */
export const FaceRescoreStatusSchema = z.object({
  jobId: z.string().nullable(),
  state: z.enum(['idle', 'running', 'completed', 'failed']),
  scanned: z.number(),
  total: z.number(),
  changed: z.number(),
  newlySuggested: z.number(),
  raised: z.number(),
  lowered: z.number(),
  cleared: z.number(),
  modelMismatch: z.number(),
  noVector: z.number(),
  batches: z.number(),
  maxBatchStoreMs: z.number(),
  durationMs: z.number(),
  galleryFingerprint: z.string().nullable().optional(),
  fingerprint: z.string().nullable().optional(),
  startedAt: z.union([z.string(), z.number()]).nullable(),
  error: z.string().optional(),
})
export type FaceRescoreStatus = z.infer<typeof FaceRescoreStatusSchema>

/**
 * A hub that predates `face.rescoreAll` rejects the action by name. Detected
 * from the message because the transport carries no typed code for it.
 */
export function isUnknownActionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  // The hub's real wording (measured 2026-10-17): "addon 'pipeline-analytics' has no
  // custom action 'face.rescoreStatus' — known actions: …".
  return /has no custom action|unknown action|action .*not (found|supported|registered)|no such action|unsupported action/i.test(
    message,
  )
}

export interface FaceRescoreClient {
  readonly rescoreTrack: (input: FaceRescoreInput) => Promise<FaceRescoreReport>
  /** Start the archive job, or return the one already running. */
  readonly rescoreAll: () => Promise<FaceRescoreStatus>
  readonly rescoreStatus: () => Promise<FaceRescoreStatus>
}

export function makeFaceRescoreClient(deps: FaceRescoreClientDeps): FaceRescoreClient {
  return {
    rescoreTrack: async (input) => {
      const raw = await deps.addonsCustomMutate({
        addonId: ADDON,
        action: ACTION,
        // Sent explicitly rather than left to the addon's Zod default, so the
        // request on the wire says what it will do.
        input: {
          deviceId: input.deviceId,
          trackId: input.trackId,
          reembed: input.reembed ?? false,
        },
      })
      return FaceRescoreReportSchema.parse(raw)
    },
    rescoreAll: async () =>
      FaceRescoreStatusSchema.parse(
        await deps.addonsCustomMutate({ addonId: ADDON, action: 'face.rescoreAll', input: {} }),
      ),
    rescoreStatus: async () =>
      FaceRescoreStatusSchema.parse(
        await deps.addonsCustomMutate({ addonId: ADDON, action: 'face.rescoreStatus', input: {} }),
      ),
  }
}
