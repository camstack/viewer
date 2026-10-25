/**
 * clip-still — what a clip tile's mint route answered, and when to come back.
 *
 * A native clip carries no thumbnail: it carries an OFFER
 * ({@link Clip.thumbnailMintUrl}), a route that cuts a still from the file on
 * demand. That route answers **200** with a JPEG or **204** with a refusal —
 * and a 204 is not one kind of answer (D563):
 *
 *  - `deferred` — you are in the QUEUE. The provider serves one CoverPreview in
 *    flight per host behind a 16-deep FIFO and refuses past that instantly
 *    rather than holding a request open. Measured on 592 on 2026-09-20, firing
 *    one page of 60 mint URLs in parallel exactly as a first paint does:
 *    **17 × 200, 43 × 204 `deferred queue-full`**. Being queued is the majority
 *    answer, not the edge case.
 *  - `final` — it will not happen. The camera is asleep, the window holds no
 *    decodable frame, the catalog row is gone.
 *
 * Latching a `deferred` leaves a tile blank for ever for a still that was 16
 * seconds away. Coming back under this ladder served all 60 in 20.6 s for 103
 * requests, none of which reached the camera.
 *
 * ## Why the client never classifies the PROSE
 *
 * The three headers are a code, the provider's own sentence, and a
 * disposition. Only the disposition decides whether the tile comes back, and
 * only the CODE keys the words we show. This is not a style preference: the
 * route sends `queue-full: 16 thumbnail mints already waiting for host
 * 192.0.2.80` in `x-camstack-reason` while the admin surface keyed its
 * table on the bare token — no key ever matched, and every refusal on the
 * fleet rendered as `Refused: <prose>` with a passing spec that hand-fed the
 * token the route never sends.
 *
 * **A response with no disposition header is FINAL.** Not a guess — it is
 * byte-for-byte what shipped before D563, so an addon older than that header
 * keeps latching exactly as it used to instead of gaining a retry loop nobody
 * tested it against.
 *
 * ## Why these numbers live here AND in `@camstack/ui-library` (D573)
 *
 * They are a deliberate duplicate, not an oversight. The admin UI's copy is
 * `packages/ui-library/src/composites/clips/clip-still-retry.ts`. This app
 * resolves `@camstack/*` from the PUBLISHED packages by design, and the
 * published `@camstack/types` it holds (1.2.235) predates D563's header
 * constants entirely — so sharing the rule is a types publish plus a dependency
 * bump plus an OTA, not an import. `@camstack/ui-library` is a DOM component
 * library and `src/**` is React Native, so that direction is closed outright.
 *
 * What must not drift is the CONTRACT — which disposition comes back, that a
 * missing one is final, that the budget ends — and that is pinned by
 * `clip-still.spec.ts` against the real wire. The five numbers are pinned by
 * `clip-still-drift.spec.ts`, which reads the other copy's source. See D573.
 */

// ─── The wire ────────────────────────────────────────────────────────────────

/** Says whether to come back. The ONLY thing that decides that. */
export const CLIP_STILL_DISPOSITION_HEADER = 'x-camstack-disposition'
/** One token from the provider's refusal vocabulary. Keys the words we show. */
export const CLIP_STILL_REASON_CODE_HEADER = 'x-camstack-reason-code'
/** The provider's / camera's own sentence. Rendered verbatim, never parsed. */
export const CLIP_STILL_REASON_HEADER = 'x-camstack-reason'
/** Seconds. Sent on a `deferred` answer only. */
export const CLIP_STILL_RETRY_AFTER_HEADER = 'retry-after'

/** The one disposition that means "come back". Everything else is final. */
const DISPOSITION_DEFERRED = 'deferred'

/**
 * A `Headers`-shaped reader.
 *
 * Structural on purpose: production passes a real `Response.headers` and a
 * spec passes the bytes it captured, with no cast at either end.
 */
export interface ClipStillHeaderReader {
  readonly get: (name: string) => string | null
}

/** What the mint route said. */
export type ClipStillAnswer =
  /** 200 — the still is in the body. */
  | { readonly kind: 'served' }
  /** 204, `deferred` — queued. Come back under {@link planClipStillRetry}. */
  | {
      readonly kind: 'deferred'
      readonly code: string | null
      readonly reason: string
      /** The server's hint in ms, or `null` when it sent none. A FLOOR, never
       *  an instruction — see {@link planClipStillRetry}. */
      readonly retryAfterMs: number | null
    }
  /** It will not happen. Latches immediately; never retried. */
  | { readonly kind: 'refused'; readonly code: string | null; readonly reason: string }

/**
 * One completed attempt at a still: the wire answer, with the BYTES attached
 * when there were any.
 *
 * The still is carried as a `data:` URI rather than re-addressed by URL,
 * because the mint route holds no cache: firing the same page of 60 URLs a
 * second time, 30 seconds after the first, answered 17 × 200 and 43 × 204
 * `queue-full` again (measured on 592, 2026-09-20). A tile that probed for the
 * disposition and then handed the URL to `<Image>` would throw away the still
 * it already had and re-enter the queue with nobody reading the headers — the
 * same blank tile, one request later.
 */
export type ClipStillOutcome =
  | { readonly kind: 'served'; readonly uri: string }
  | {
      readonly kind: 'deferred'
      readonly code: string | null
      readonly reason: string
      readonly retryAfterMs: number | null
    }
  | { readonly kind: 'refused'; readonly code: string | null; readonly reason: string }

/** The prose to fall back to when the route sent none — never a blank tile. */
const NO_REASON_GIVEN = 'no reason given'

function retryAfterMsOf(headers: ClipStillHeaderReader): number | null {
  const raw = headers.get(CLIP_STILL_RETRY_AFTER_HEADER)
  if (raw === null) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
}

/**
 * Read one mint answer.
 *
 * Never throws, and never looks at {@link CLIP_STILL_REASON_HEADER} to decide
 * anything — that header is carried, not interpreted.
 */
export function readClipStillAnswer(
  status: number,
  headers: ClipStillHeaderReader,
): ClipStillAnswer {
  if (status === 200) return { kind: 'served' }
  const code = headers.get(CLIP_STILL_REASON_CODE_HEADER)
  const reason = headers.get(CLIP_STILL_REASON_HEADER) ?? statusReason(status)
  if (status !== 204) return { kind: 'refused', code, reason }
  if (headers.get(CLIP_STILL_DISPOSITION_HEADER) !== DISPOSITION_DEFERRED) {
    return { kind: 'refused', code, reason }
  }
  return { kind: 'deferred', code, reason, retryAfterMs: retryAfterMsOf(headers) }
}

function statusReason(status: number): string {
  return status === 204 ? NO_REASON_GIVEN : `HTTP ${String(status)}`
}

/**
 * A request that never got an answer — a dropped socket, a Wi-Fi handover.
 *
 * DEFERRED: nothing refused anything, one request lost a race, and a tile that
 * goes permanently blank for that is the same defect with a different cause.
 */
export function clipStillNetworkFailure(err: unknown): ClipStillAnswer {
  return {
    kind: 'deferred',
    code: null,
    reason: err instanceof Error ? err.message : String(err),
    retryAfterMs: null,
  }
}

// ─── The words ───────────────────────────────────────────────────────────────

/**
 * i18n key for a refusal CODE — never for the prose.
 *
 * A code this build has never heard of has no key, and the caller shows the
 * provider's own sentence instead. A firmware that invents a refusal reaches
 * the operator rather than becoming a blank tile.
 */
const MESSAGE_KEYS: Readonly<Record<string, string>> = {
  sleeping: 'v2.clips.still.sleeping',
  'camera-refused': 'v2.clips.still.cameraRefused',
  'no-keyframe': 'v2.clips.still.noKeyframe',
  unsupported: 'v2.clips.still.unsupported',
  'queue-full': 'v2.clips.still.queueFull',
  'camera-backoff': 'v2.clips.still.cameraBackoff',
  'no-catalog-row': 'v2.clips.still.noCatalogRow',
  'unknown-device': 'v2.clips.still.unknownDevice',
  'uid-missing': 'v2.clips.still.uidMissing',
}

/** The key for `code`, or `null` when this build does not know it. */
export function clipStillMessageKey(code: string | null): string | null {
  if (code === null) return null
  return MESSAGE_KEYS[code] ?? null
}

// ─── The ladder ──────────────────────────────────────────────────────────────

/** How many times a tile comes back before it says so and stops. */
export const CLIP_STILL_RETRY_ATTEMPTS = 4

/** First wait, doubling from there. */
export const CLIP_STILL_RETRY_BASE_MS = 4_000

/** No single wait is longer than this, whatever the server hints. */
export const CLIP_STILL_RETRY_MAX_WAIT_MS = 30_000

/** ±25 %: enough to break a synchronised herd, not enough to stop being a
 *  schedule. */
export const CLIP_STILL_RETRY_JITTER_FRACTION = 0.25

export interface ClipStillRetryInput {
  /** 0 for the first retry, 1 for the second, … */
  readonly attempt: number
  /** The server's `retry-after` in ms, or `null` when it sent none. */
  readonly serverHintMs: number | null
  /** Injected so the schedule is assertable; `Math.random` in production. */
  readonly random: () => number
}

export interface ClipStillRetryPlan {
  readonly waitMs: number
}

/**
 * The next wait, or `null` when the budget is spent.
 *
 * Exponential because a fixed interval either hammers or dawdles; JITTERED
 * because 43 tiles refused in one paint would otherwise come back in one
 * instant and refuse together again; BOUNDED because a tile that asks for ever
 * is the other way to show the operator nothing.
 *
 * The server's hint is a FLOOR, never an instruction: a provider answering
 * `retry-after: 1` for a whole page must not turn this into 43 requests a
 * second. The hub's real answer is `retry-after: 16`, which beats the curve on
 * the first attempt and is why every deferred tile of the measured paint was
 * served on its second request.
 */
export function planClipStillRetry(input: ClipStillRetryInput): ClipStillRetryPlan | null {
  if (input.attempt >= CLIP_STILL_RETRY_ATTEMPTS || input.attempt < 0) return null
  const curve = CLIP_STILL_RETRY_BASE_MS * 2 ** input.attempt
  const chosen = Math.max(curve, input.serverHintMs ?? 0)
  const bounded = Math.min(chosen, CLIP_STILL_RETRY_MAX_WAIT_MS)
  const jitter = 1 + (input.random() * 2 - 1) * CLIP_STILL_RETRY_JITTER_FRACTION
  return { waitMs: Math.round(bounded * jitter) }
}
