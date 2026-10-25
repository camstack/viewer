/**
 * nc-artifacts — the viewer's typed client onto the Notification Center's
 * ARTIFACT surface: the media the hub produced on its own (timelapses, summary
 * mosaics) and the media a notification rule cut (clip / gif / still).
 *
 * Same transport as the rest of NC and for the same reason (spec C1/C2): the
 * viewer never adds a cap method — every read rides the `addons.custom` bridge
 * (`{ addonId, action, input }` → `unknown`) with an `nc.*` action name on
 * `pipeline-analytics`, and the addon enforces auth + ownership server-side.
 * The delegate type is {@link NcClientDeps}, shared verbatim with
 * `notification-center.ts` — there is ONE bridge seam in this app.
 *
 * The Zod schemas are viewer-LOCAL mirrors of the server contract, and they are
 * parsed PER ROW: `z.array(Schema).parse()` rejects the WHOLE list on one member
 * this build cannot decode, which is how the rule editor twice rendered nothing
 * at all against a current hub. An artifact kind we have never heard of costs
 * that one tile, never the gallery.
 *
 * BYTES do not come through this bridge. Every record carries a RELATIVE
 * `downloadPath` onto the hub's authenticated data plane — the same plane, the
 * same `Authorization: Bearer` header and the same absolute-URL rule as
 * `event-media` (see `event-media-url.ts` / `track-media-uri.ts`). The
 * resolution lives here as pure functions and the header is attached by
 * `use-nc-artifacts.ts`; nothing invents a second URL or auth scheme.
 */
import { z } from 'zod'
import type { NcClientDeps } from './notification-center.js'

// ── Domain ─────────────────────────────────────────────────────────────────

/**
 * Every artifact kind this build can render.
 *
 * Gallery tiles (`timelapse`, `event-gif`, `event-clip`, `summary-mosaic`) are
 * what the operator browses and filters. Poster kinds (`timelapse-preview`,
 * `event-still`) exist so a video/gif row can name its thumbnail via
 * `posterArtifactId` — they are not filter chips and an unfiltered list on the
 * hub omits them.
 */
export const NC_GALLERY_ARTIFACT_KINDS = [
  'timelapse',
  'event-gif',
  'event-clip',
  'summary-mosaic',
] as const
export const NC_POSTER_ARTIFACT_KINDS = ['timelapse-preview', 'event-still'] as const
export const NC_ARTIFACT_KINDS = [
  ...NC_GALLERY_ARTIFACT_KINDS,
  ...NC_POSTER_ARTIFACT_KINDS,
] as const

export const NcArtifactKindSchema = z.enum(NC_ARTIFACT_KINDS)
export type NcArtifactKind = z.infer<typeof NcArtifactKindSchema>

/**
 * WHICH RENDERER draws the bytes. Declared by the server beside the mime and
 * read INSTEAD of it: a mime is a transport fact (`video/mp4`, `image/gif`,
 * `image/webp`, …) and a renderer switch built on it has to know every spelling
 * the hub might ever emit. This field is the hub's own answer to the only
 * question the UI asks.
 */
export const NcArtifactMediaTypeSchema = z.enum(['image', 'gif', 'video'])
export type NcArtifactMediaType = z.infer<typeof NcArtifactMediaTypeSchema>

/** One artifact row as served by `nc.listArtifacts` / `nc.getArtifact`. */
export const NcArtifactRecordSchema = z.object({
  id: z.string().min(1),
  kind: NcArtifactKindSchema,
  mediaType: NcArtifactMediaTypeSchema,
  mime: z.string(),
  sizeBytes: z.number(),
  /** When the artifact was PRODUCED. */
  createdAt: z.number(),
  /** What the content is ABOUT (window end / event instant). Sort + filter key. */
  capturedAt: z.number(),
  /** After this instant the bytes are gone — the gallery counts down to it. */
  expiresAt: z.number(),
  /** Primary camera; `null` for a cluster-wide artifact (a whole-house mosaic). */
  deviceId: z.number().nullable(),
  /** Every camera the artifact covers (a mosaic covers many). */
  deviceIds: z.array(z.number()),
  ruleId: z.string().optional(),
  ruleName: z.string().optional(),
  title: z.string().optional(),
  /** Companion STILL for a video artifact — the tile's thumbnail. */
  posterArtifactId: z.string().optional(),
  /** RELATIVE hub path for the bytes (`/addon/pipeline-analytics/…/<id>`). */
  downloadPath: z.string().min(1),
})
export type NcArtifactRecord = z.infer<typeof NcArtifactRecordSchema>

// ── Request / response shapes ──────────────────────────────────────────────

/** The server's default page size when `limit` is omitted. */
export const NC_ARTIFACTS_PAGE_SIZE = 50

/** The server's ceiling on `limit`. Asking for more is a validation error, not
 *  a bigger page — so the input builder clamps rather than letting the whole
 *  list fail. */
export const NC_ARTIFACTS_MAX_LIMIT = 200

/** What the operator narrowed the gallery to. Every field is absent-means-all. */
export interface NcArtifactFilters {
  readonly kinds?: readonly NcArtifactKind[]
  readonly deviceIds?: readonly number[]
  readonly ruleId?: string
  readonly fromMs?: number
  readonly toMs?: number
}

/** One page request. */
export interface NcArtifactPage {
  readonly limit: number
  readonly offset: number
}

/** The exact `nc.listArtifacts` input. Built by {@link buildListArtifactsInput};
 *  a field is present only when it NARROWS something. */
export interface NcListArtifactsInput {
  readonly kinds?: readonly NcArtifactKind[]
  readonly deviceIds?: readonly number[]
  readonly ruleId?: string
  readonly fromMs?: number
  readonly toMs?: number
  readonly limit: number
  readonly offset: number
}

/**
 * Map filters + a page onto the wire input.
 *
 * An EMPTY list is omitted, never sent. `kinds: []` reads on the server as "none
 * of the kinds", which is a gallery that can only ever be empty — and it is
 * exactly what a naive `state.kinds` passthrough produces the moment the
 * operator deselects the last chip. "No chip selected" means NO filter here, so
 * the two states cannot share a wire shape.
 *
 * `limit` is clamped to the server's ceiling: over it the call is rejected
 * outright and the operator sees a failed screen rather than a shorter page.
 */
export function buildListArtifactsInput(
  filters: NcArtifactFilters,
  page: NcArtifactPage,
): NcListArtifactsInput {
  const limit = Math.max(1, Math.min(Math.round(page.limit), NC_ARTIFACTS_MAX_LIMIT))
  const offset = Math.max(0, Math.round(page.offset))
  const kinds = filters.kinds !== undefined && filters.kinds.length > 0 ? filters.kinds : undefined
  const deviceIds =
    filters.deviceIds !== undefined && filters.deviceIds.length > 0 ? filters.deviceIds : undefined
  const ruleId = filters.ruleId !== undefined && filters.ruleId.length > 0 ? filters.ruleId : undefined
  return {
    ...(kinds !== undefined ? { kinds } : {}),
    ...(deviceIds !== undefined ? { deviceIds } : {}),
    ...(ruleId !== undefined ? { ruleId } : {}),
    ...(filters.fromMs !== undefined ? { fromMs: filters.fromMs } : {}),
    ...(filters.toMs !== undefined ? { toMs: filters.toMs } : {}),
    limit,
    offset,
  }
}

/**
 * A STABLE cache key for a filter set — the TanStack query key.
 *
 * Order-insensitive on the list fields on purpose: the chip row emits
 * `[timelapse, summary-mosaic]` or `[summary-mosaic, timelapse]` depending on
 * the tap order, and two keys for one filter would refetch the whole gallery
 * for a selection the operator did not change.
 */
export function artifactFilterKey(filters: NcArtifactFilters): string {
  const kinds = [...(filters.kinds ?? [])].sort().join('|')
  const devices = [...(filters.deviceIds ?? [])].sort((a, b) => a - b).join('|')
  return [kinds, devices, filters.ruleId ?? '', filters.fromMs ?? '', filters.toMs ?? ''].join('~')
}

/**
 * `nc.listArtifacts` result, parsed PER ROW.
 *
 * A row this build cannot decode is DROPPED and named, never fatal — the repo
 * has twice shipped a `z.array(Schema).parse()` at a bridge boundary and twice
 * watched one unknown member empty an entire screen. `total` and `hasMore` come
 * from the SERVER and are kept verbatim: they describe the query, not the rows
 * that survived this parse, and pagination must advance by what was ASKED (see
 * {@link NcArtifactsPage}).
 */
export const NcListArtifactsResultSchema = z.object({
  artifacts: z.array(z.unknown()).transform((rows) => {
    const parsed: NcArtifactRecord[] = []
    const skipped: string[] = []
    for (const row of rows) {
      const result = NcArtifactRecordSchema.safeParse(row)
      if (result.success) {
        parsed.push(result.data)
        continue
      }
      const id =
        typeof row === 'object' && row !== null && 'id' in row
          ? String((row as { id: unknown }).id)
          : '<unidentified>'
      skipped.push(id)
    }
    if (skipped.length > 0) {
      // An artifact the app cannot show is media the operator cannot reach —
      // name it rather than letting the gallery quietly come up short.
      console.warn(
        `[nc] artifacts: ${skipped.length} artifact(s) this build cannot decode were skipped: ${skipped.join(', ')}`,
      )
    }
    return parsed
  }),
  total: z.number(),
  hasMore: z.boolean(),
})
export type NcListArtifactsResult = z.infer<typeof NcListArtifactsResultSchema>

/** `nc.getArtifact` result — `null` when the row is gone (expired, deleted). */
export const NcGetArtifactResultSchema = z.object({
  artifact: NcArtifactRecordSchema.nullable(),
})
export type NcGetArtifactResult = z.infer<typeof NcGetArtifactResultSchema>

/**
 * `nc.deleteArtifact` result.
 *
 * `deleted: false` is the hub's ONE answer to every refusal — unknown id,
 * already expired, another household's row, or a GLOBAL artifact (one the hub
 * produced for the household) that only an admin may remove. The server
 * deliberately does not say which, so neither does this app: a caller that
 * guessed a reason would be inventing one.
 *
 * `removedIds` is what actually went away, and it can hold MORE than the id
 * asked for: deleting a video takes its poster still with it. Every id here is
 * a cached row that must be dropped, or a thumbnail keeps pointing at bytes the
 * hub no longer has.
 */
export const NcDeleteArtifactResultSchema = z.object({
  deleted: z.boolean(),
  removedIds: z.array(z.string()),
})
export type NcDeleteArtifactResult = z.infer<typeof NcDeleteArtifactResultSchema>

/** One loaded page, carrying the offset the NEXT page must start at. */
export interface NcArtifactsPage {
  readonly artifacts: readonly NcArtifactRecord[]
  readonly total: number
  readonly hasMore: boolean
  /** `offset + limit` of the request that produced this page — NOT
   *  `offset + artifacts.length`. Rows dropped by the per-row parse above would
   *  otherwise make the next page re-request what was already served, and every
   *  subsequent page would repeat a row for each one skipped. */
  readonly nextOffset: number
}

/** Fold a wire result plus the request that produced it into a loaded page. */
export function toArtifactsPage(
  result: NcListArtifactsResult,
  request: NcArtifactPage,
): NcArtifactsPage {
  return {
    artifacts: result.artifacts,
    total: result.total,
    hasMore: result.hasMore,
    nextOffset: request.offset + request.limit,
  }
}

/** The offset of the page after `page`, or `undefined` when the list is done. */
export function nextArtifactsPageParam(page: NcArtifactsPage): number | undefined {
  return page.hasMore ? page.nextOffset : undefined
}

// ── Bytes: absolute URL for the authenticated data plane ───────────────────

/**
 * Absolute URL for a record's `downloadPath` against the connected hub.
 *
 * The same rule the export download and the event-media tiles already follow:
 * the server stamps a RELATIVE path, native `expo-image` / `react-native-video`
 * need an ABSOLUTE one, and an already-absolute value is passed through
 * untouched. The plane is `access: 'authenticated'` — the caller MUST attach the
 * session Bearer header (`use-nc-artifacts.ts` does), or the tile renders a
 * broken-image glyph exactly as the track detail strip once did.
 *
 * Returns `null` when there is no connected hub to resolve against, so a caller
 * renders a placeholder instead of requesting a relative path off a phone.
 */
export function resolveArtifactUrl(serverUrl: string | null, downloadPath: string): string | null {
  if (downloadPath.length === 0) return null
  if (downloadPath.startsWith('http://') || downloadPath.startsWith('https://')) return downloadPath
  if (serverUrl === null || serverUrl.length === 0) return null
  const base = serverUrl.replace(/\/+$/, '')
  return downloadPath.startsWith('/') ? `${base}${downloadPath}` : `${base}/${downloadPath}`
}

/**
 * The read path of a SIBLING artifact (the poster of a video), derived from the
 * record's own path by swapping the last segment.
 *
 * Derived rather than rebuilt from a hardcoded prefix on purpose: the record is
 * the authority on where its bytes live, so a hub that ever remounts the plane
 * moves both paths together and this keeps working. A `?query` tail is dropped —
 * it belongs to the record, not to its poster.
 */
export function siblingArtifactPath(downloadPath: string, artifactId: string): string | null {
  if (artifactId.length === 0) return null
  const [path] = downloadPath.split('?')
  const cut = path.lastIndexOf('/')
  if (cut < 0) return null
  return `${path.slice(0, cut + 1)}${artifactId}`
}

/** What a gallery tile should draw for an artifact. */
export type ArtifactThumbSource =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'placeholder' }

/**
 * Resolve the tile image for one artifact.
 *
 *  • `image` / `gif` render THEMSELVES — the bytes are already a picture.
 *  • `video` renders its `posterArtifactId` companion still when the hub cut
 *    one; a video artifact without a poster gets the caller's placeholder icon
 *    rather than a video element on a list row (which is how a gallery of
 *    twenty tiles becomes twenty decoders).
 */
export function resolveArtifactThumb(
  record: NcArtifactRecord,
  serverUrl: string | null,
): ArtifactThumbSource {
  if (record.mediaType === 'image' || record.mediaType === 'gif') {
    const url = resolveArtifactUrl(serverUrl, record.downloadPath)
    return url === null ? { kind: 'placeholder' } : { kind: 'image', url }
  }
  if (record.posterArtifactId === undefined) return { kind: 'placeholder' }
  const path = siblingArtifactPath(record.downloadPath, record.posterArtifactId)
  if (path === null) return { kind: 'placeholder' }
  const url = resolveArtifactUrl(serverUrl, path)
  return url === null ? { kind: 'placeholder' } : { kind: 'image', url }
}

// ── The typed client ───────────────────────────────────────────────────────

/** The addon that owns every artifact action (same addon as the NC rules). */
const ARTIFACTS_ADDON = 'pipeline-analytics'

/** One typed method per `nc.*` artifact action. */
export interface NcArtifactsClient {
  readonly listArtifacts: (input: NcListArtifactsInput) => Promise<NcListArtifactsResult>
  readonly getArtifact: (artifactId: string) => Promise<NcGetArtifactResult>
  /** Remove one artifact: the index row AND the bytes, poster included. */
  readonly deleteArtifact: (artifactId: string) => Promise<NcDeleteArtifactResult>
}

/**
 * Build an {@link NcArtifactsClient} over an `addons.custom` mutate delegate.
 * Pure — no transport, no React — so it is unit-tested directly with a mock
 * delegate, exactly like `makeNcClient`.
 */
export function makeNcArtifactsClient(deps: NcClientDeps): NcArtifactsClient {
  const call = <T>(action: string, input: unknown, out: z.ZodType<T>): Promise<T> =>
    deps.addonsCustomMutate({ addonId: ARTIFACTS_ADDON, action, input }).then((r) => out.parse(r))
  return {
    listArtifacts: (input) => call('nc.listArtifacts', input, NcListArtifactsResultSchema),
    getArtifact: (artifactId) => call('nc.getArtifact', { artifactId }, NcGetArtifactResultSchema),
    deleteArtifact: (artifactId) =>
      call('nc.deleteArtifact', { artifactId }, NcDeleteArtifactResultSchema),
  }
}
