/**
 * snapshot-media-url — build absolute URLs for the snapshot HTTP data-plane
 * (served by the hub reverse-proxy at `/addon/snapshot/media/<deviceId>.jpg`).
 *
 * The server owns the snapshot cache, coalescing and stale-while-revalidate; the
 * client just renders a plain image URL (`<Image source={{ uri }}>`) and lets the
 * platform image layer do the rest.
 *
 * ## Why the URL carries a frame identity, and not a clock
 *
 * This used to append `?v=floor(now/30000)`, a wall-clock bucket. Two things
 * were wrong with it, and they pull in opposite directions:
 *
 *  - **On web** the bucket made a 304 impossible. The browser cache keys on the
 *    full URL, so when `v` rolled over there was no stored entry to revalidate
 *    against — no `If-None-Match` was ever sent, and every window was a full 200
 *    with a full body. The docblock here used to claim "a request for an
 *    unchanged frame is a cheap 304"; the bucket it documented was what
 *    prevented it.
 *
 *  - **On native** the opposite failure is waiting if you simply delete the
 *    bucket. `expo-image` is URL-keyed and does NOT revalidate: its own docs
 *    define `cachePolicy: 'disk'` (the default) as "queried from the disk cache
 *    if exists, otherwise downloaded". `Cache-Control` and `ETag` do not enter
 *    into it. A permanently-stable URL would be served from disk until evicted,
 *    which is a frozen thumbnail, forever.
 *
 * So the URL changes when — and only when — the FRAME changes. `version` is the
 * capture identity (`lastCapturedAt` from `snapshot.getSnapshotOverview`, the
 * same value the server's ETag is built from). Unchanged frame → byte-identical
 * URL → a native disk-cache hit and a web revalidation, both free. New frame →
 * new URL → exactly one fetch of bytes that are genuinely new.
 *
 * Pure + side-effect-free (no React). Unit-tested in `__tests__/snapshot-media-url.spec.ts`.
 */

/** The hub-proxied path prefix for the snapshot image data-plane (addonId = `snapshot`). */
export const SNAPSHOT_MEDIA_PATH = '/addon/snapshot/media'

/**
 * The `v` token for a device's current frame.
 *
 * `lastCapturedAt` is the server's capture identity. `refreshEpoch` is bumped by
 * an explicit pull-to-refresh and rides along so an operator can force a new URL
 * (and therefore a real fetch) even when the frame has not moved.
 *
 * Returns `undefined` when the frame identity is unknown — the caller then emits
 * NO `v`, which keeps the URL stable and lets web revalidate on ETag. Never
 * substitute a clock here: that is the bug this function replaced.
 */
export function snapshotVersionTag(
  lastCapturedAt: number | null,
  refreshEpoch: number,
  /** Coarse fallback counter, used ONLY when the identity is unknown. Zero means
   *  "no fallback yet", which keeps the URL in its plain stable form. */
  fallbackTick = 0,
  /**
   * Start of the CURRENT unknown-identity episode (epoch ms). Makes each
   * episode's fallback URLs unique: `?v=f1` minted today and `?v=f1` minted two
   * weeks ago are the same cache key to expo-image, which never revalidates —
   * so the second outage repainted the first outage's frames.
   */
  fallbackEpochMs?: number,
): string | undefined {
  const parts: string[] = []
  if (lastCapturedAt !== null) parts.push(String(lastCapturedAt))
  if (fallbackTick > 0) {
    parts.push(
      fallbackEpochMs !== undefined
        ? `f${String(fallbackTick)}e${String(fallbackEpochMs)}`
        : `f${String(fallbackTick)}`,
    )
  }
  if (refreshEpoch > 0) parts.push(`r${String(refreshEpoch)}`)
  return parts.length > 0 ? parts.join('') : undefined
}

export interface SnapshotUrlOptions {
  /**
   * Frame identity (see {@link snapshotVersionTag}). Omit for a URL that is
   * stable forever — correct only where the platform revalidates.
   */
  readonly version?: string
  /** Preferred stream quality (e.g. `high`). Omit for the server's auto pick. */
  readonly streamId?: string
  /** Force a fresh capture (UI refresh button); wakes battery cams. */
  readonly force?: boolean
  /**
   * Target width in px for a THUMBNAIL. Omit to get the frame as captured.
   *
   * The server snaps this to a small ladder (160…960) and derives the variant
   * once per capture, so nearby tile widths share one image. Without it a card
   * receives the full capture: measured live at 758 KB average per camera,
   * 11.4 MB for one 16-camera grid paint, into tiles 180–390 px wide.
   */
  readonly width?: number
}

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '')
}

export interface ResolveSnapshotUriParams {
  /** Connected hub base, or null when there is nowhere to ask. */
  readonly serverUrl: string | null
  readonly deviceId: number
  /** Frame identity from `getSnapshotOverview`; null when nothing is cached. */
  readonly lastCapturedAt: number | null
  /**
   * Whether we have an ANSWER from the overview at all.
   *
   * This is not the same question as `lastCapturedAt !== null`, and conflating
   * the two is what froze the tiles. "The hub says this camera has no frame" is
   * an answer — a stable URL is right, and must not advance, or a sleeping
   * battery camera gets a request every window forever. "We have not heard from
   * the hub" is NOT an answer, and a stable URL there is a permanent freeze.
   */
  readonly identityKnown: boolean
  /**
   * Advances while `identityKnown` is false. See {@link resolveSnapshotUri} —
   * this is the safety net that stops a tile freezing when the frame identity
   * cannot be learned.
   */
  readonly fallbackTick: number
  /**
   * Advances while a connecting poster is on screen. Unlike {@link fallbackTick}
   * this applies even when the identity is KNOWN: the hub may still be naming
   * the same frozen capture, and `expo-image` will not revalidate it.
   */
  readonly forceRefreshTick?: number
  /** Manual pull-to-refresh epoch. */
  readonly refreshEpoch: number
  /** Target width in px for a thumbnail surface. */
  readonly width?: number | undefined
  /**
   * A signed, expiring, ROOT-RELATIVE link from `snapshot.getSnapshotLinks`.
   *
   * When present it WINS over everything below, because it is the only form
   * whose capture identity somebody actually waited for. Null/undefined on an
   * older hub (the cap answers NOT_FOUND), which leaves the whole
   * D93/D94/D95 path underneath exactly as it was.
   */
  readonly link?: string | null | undefined
  /**
   * Server-rendered state over the frame ('sleeping' | 'waking' |
   * 'unreachable' | 'disabled'), when the links cap reported one.
   *
   * It is part of the URL identity: the server switches the bytes it serves
   * for a device when its state changes WITHOUT a new capture (a camera that
   * falls asleep keeps its last frame's `capturedAt`), and `expo-image` is
   * URL-keyed and never revalidates. Without the reason in `v`, the state
   * overlay would lose to the disk-cached raw frame every single time.
   */
  readonly stateReason?: string | null | undefined
  /**
   * True once THIS app process has received a hub frame identity for this
   * device. Cold start with the hub unreachable must not paint expo-image's
   * disk cache of last week's JPEG — that cache is keyed on the stable URL
   * this function would otherwise emit while `identityKnown` is false.
   *
   * Omit (or pass true) for the mid-session freeze net: once the hub has
   * named a frame, a later unknown identity may keep resolving.
   *
   * On NATIVE this is now a fetch gate rather than a paint gate: the tile paints
   * its own cached file (`snapshot-file-cache.ts`), whose name states which
   * capture is inside it, so "paint nothing at a cold start" stopped being the
   * defence — a frame we can DATE is. Withholding the URL still costs nothing
   * and still protects web, where `expo-image`'s reasoning does not apply but a
   * stale disk entry in the browser cache does.
   */
  readonly namedThisSession?: boolean
  /**
   * The newest frame identity THIS process has seen for this device, kept
   * across unknown-identity episodes. While the identity is unknown the URL is
   * built on this instead of the stable form, so the tile keeps painting the
   * newest frame the hub actually named — never whatever bytes a previous slow
   * episode happened to leave in the platform's disk cache under the stable
   * URL (observed live: a two-week-old JPEG).
   */
  readonly lastKnownCapturedAt?: number | null
  /** Start of the current unknown-identity episode — see {@link snapshotVersionTag}. */
  readonly fallbackEpochMs?: number
}

/**
 * The image URL for one surface — including the case where the server has no
 * frame for this device yet.
 *
 * **A missing frame identity must still produce a URL.** It is tempting to read
 * `lastCapturedAt: null` as "there is nothing to show, request nothing", and
 * that is precisely the bug this function exists to prevent. The image request
 * is the ONLY thing that enrols a camera in the server's keep-warm loop, and
 * enrolment is what makes the first capture happen. Suppressing the request for
 * a device with no frame means the device never gets a frame, so the request
 * stays suppressed: a self-sealing deadlock.
 *
 * It reached production. The hub OOM'd, restarted with an empty cache, and
 * `getSnapshotOverview` answered null for 15 of 16 cameras — every thumbnail in
 * the app went blank and stayed blank, on every surface, surviving an app kill,
 * because no client would ask for an image and nothing else ever would.
 *
 * So a device with no frame gets the STABLE form of the URL (no `v`). That
 * request triggers the capture and the enrolment; the next overview tick carries
 * a real `lastCapturedAt` and the URL becomes versioned from then on. Because
 * the bootstrap URL is byte-stable it costs exactly one request per mount, so a
 * device that legitimately never produces a frame — a sleeping battery camera,
 * which the wrapper refuses to wake — is not hammered either.
 *
 * ## And a stable URL is only safe when we actually HAVE an answer
 *
 * The frame identity comes from `getSnapshotOverview`, a tRPC call gated on a
 * live WebSocket. The image is a plain HTTP GET that needs nothing from it. So
 * when the socket drops — iOS suspending the app is the everyday case — the
 * identity stops advancing, the URL stops changing, and `expo-image` (URL-keyed,
 * never revalidates) paints the same frame forever.
 *
 * `use-snapshot.ts` already documents this exact failure from the first time a
 * snapshot was gated on the socket. Deriving the URL from a socket-gated query
 * reintroduced it one level of indirection away, which is why it came back
 * looking like "the snapshot is frozen" rather than "the card says unavailable".
 *
 * Hence `fallbackTick`: while the identity is UNKNOWN the URL advances on a
 * coarse timer, exactly the pre-existing behaviour, so a tile degrades to
 * "refreshes every 30 s" instead of "never refreshes again". It starts at 0, so
 * a healthy launch — where the overview answers in about 5 s — never pays for
 * the safety net.
 */
export function resolveSnapshotUri(params: ResolveSnapshotUriParams): string | null {
  const { serverUrl, deviceId, lastCapturedAt, identityKnown, fallbackTick, refreshEpoch, width } =
    params
  if (serverUrl === null || deviceId <= 0) return null
  // Cold start, hub has not named a frame in this process: emit nothing so
  // expo-image cannot serve last week's JPEG from disk under the stable URL.
  if (params.namedThisSession === false && !identityKnown) return null
  // A minted link short-circuits everything. Not an optimisation: the identity
  // in it is one the server WAITED for, where `lastCapturedAt` below is whatever
  // the cache-only overview happened to be holding — which is precisely the
  // generation of lag the operator was refreshing his way through.
  //
  // It arrives root-relative because the hub must never guess which origin the
  // client reached it on. Joining it to the base we are actually connected to is
  // the client's job and nobody else can do it correctly.
  if (params.link !== null && params.link !== undefined && params.link.length > 0) {
    return `${trimTrailingSlashes(serverUrl)}${params.link}`
  }
  const forceTick = params.forceRefreshTick ?? 0
  const frameVersion = identityKnown
    ? snapshotVersionTag(lastCapturedAt, refreshEpoch, forceTick)
    : snapshotVersionTag(
        params.lastKnownCapturedAt ?? null,
        refreshEpoch,
        fallbackTick,
        params.fallbackEpochMs,
      )
  const stateKey =
    params.stateReason !== null && params.stateReason !== undefined && params.stateReason !== ''
      ? `s-${params.stateReason}`
      : undefined
  const version =
    frameVersion !== undefined
      ? `${frameVersion}${stateKey ?? ''}`
      : stateKey
  return buildSnapshotMediaUrl(serverUrl, deviceId, {
    ...(version !== undefined ? { version } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(forceTick > 0 ? { force: true } : {}),
  })
}

/**
 * Absolute snapshot image URL for a device against the connected hub base.
 */
export function buildSnapshotMediaUrl(
  serverUrl: string,
  deviceId: number,
  opts?: SnapshotUrlOptions,
): string {
  const base = trimTrailingSlashes(serverUrl)
  const params = new URLSearchParams()
  if (opts?.streamId !== undefined && opts.streamId.length > 0) params.set('streamId', opts.streamId)
  if (opts?.force === true) params.set('force', '1')
  // A layout that has not measured yet reports 0, and a fractional width is a
  // request the server would reject — both mean "no preference", not "zero".
  if (opts?.width !== undefined && Number.isInteger(opts.width) && opts.width > 0) {
    params.set('w', String(opts.width))
  }
  if (opts?.version !== undefined && opts.version.length > 0) params.set('v', opts.version)
  const query = params.toString()
  return `${base}${SNAPSHOT_MEDIA_PATH}/${deviceId}.jpg${query.length > 0 ? `?${query}` : ''}`
}
