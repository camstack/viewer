import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { log } from '../lib/logger.js'
import { resolveSnapshotUri } from './snapshot-media-url.js'
import { snapshotTransitionSignature, SNAPSHOT_STUCK_WAITING_MS } from './snapshot-transition-signature.js'
import {
  isSignedSnapshotLink,
  snapshotPageOrigin,
  shouldAttachSnapshotBearer,
  shouldPaintSignedSnapshotLink,
} from './snapshot-image-auth.js'
import { useSnapshotRefreshStore } from '../store/snapshot-refresh-store.js'
import { useSnapshotLink, useSnapshotVersion } from './SnapshotOverviewProvider.js'
import { useSnapshotFile } from './use-snapshot-file.js'
import { snapshotThumbnailFetchReady } from './snapshot-fetch-ready.js'

/** Cadence for the connecting poster (WebView data-URI + force-refresh URL).
 *  Matched to the server's per-device snapshot max-age (10 s). */
export const SNAPSHOT_REFETCH_MS = 10_000

/**
 * How often the image URL advances while the frame identity is UNKNOWN.
 *
 * Not the normal refresh path — normally the URL changes because the frame did.
 * This is the floor that stops a tile freezing when the overview cannot be
 * reached at all (socket down, older hub, a surface mounted outside the
 * provider). Same 30 s the client used before the overview existed.
 *
 * Its MEANING narrowed when the native file cache landed, and it is worth being
 * precise about because the mechanism looks unchanged. On web it still does what
 * it always did: advance the URL so the browser re-asks. On native it no longer
 * gates a PAINT at all — the tile paints its cached file regardless — it only
 * lets the downloader ask again, now as a CONDITIONAL GET. So the worst case
 * during a long socket outage went from "a full ~9 KB body per tile per 30 s"
 * to "a ~200-byte 304", and from "a frame of unknown age" to one whose capture
 * time the response itself stated. Nothing here is dead, so nothing was removed;
 * the same is true of `namedThisSession` below.
 */
const SNAPSHOT_IDENTITY_FALLBACK_MS = 30_000

/**
 * A ready-to-render snapshot image source plus a small load-state machine.
 *
 * The server owns the cache/coalescing/SWR; the client points an `<Image>` at
 * {@link uri} (with {@link headers} on native) and wires {@link onLoad} /
 * {@link onError}.
 *
 * ## The client-side cache contract every snapshot surface must honour
 *
 * 1. The `uri` is **stable per frame**. It changes only when the capture
 *    changes, so a repaint, a remount and a tab switch cost zero network.
 * 2. A superseded frame is never used as a placeholder. Once the hub names a
 *    newer capture, continuing to paint the old one would make a stale image
 *    look current.
 * 3. **On native the painted `uri` is a `file://` path this app wrote**, from
 *    the snapshot file cache (`snapshot-file-cache.ts`). `expo-image`'s own disk
 *    cache is no longer the persistence layer for snapshots, because it is
 *    URL-keyed, never revalidates and cannot be inspected — three incidents
 *    ended with a tile painting bytes nobody could date. The cached file's name
 *    carries the server's ETag, so the frame's age is always stateable, even at
 *    a cold start with the hub unreachable. Web keeps the remote URL: the
 *    browser revalidates on `ETag`, so there the existing path is correct.
 */
export interface SnapshotSource {
  /** Absolute image URL (versioned by frame identity) or, on native, the
   *  `file://` path of the cached frame. Null when the surface is disabled (and
   *  did not ask to hold its last frame), or when the device has never produced
   *  one. */
  readonly uri: string | null
  /**
   * Bearer header to attach on native (`expo-image` honours it); omitted on a
   * SAME-ORIGIN web page, where the httpOnly session cookie authenticates the
   * request and the header would instead switch `expo-image` onto its JS
   * fetch-to-blob loader. The rule, and the incident, are in
   * `snapshot-image-auth.ts`. Object identity is stable across renders — it is
   * an expo-image cache key on web.
   */
  readonly headers?: Record<string, string>
  /** Wire to `<Image onLoad>` — marks a frame painted (clears loading/failed). */
  readonly onLoad: () => void
  /** Wire to `<Image onError>` — marks failed, but keeps any painted frame. */
  readonly onError: () => void
  /** True while a URL is set but no frame has painted yet and none has failed. */
  readonly isLoading: boolean
  /** True when loading failed and no frame has ever painted for this device. */
  readonly failed: boolean
  /** True while a NEWER frame is being fetched behind an already-painted one —
   *  the surface keeps showing the last frame and can overlay a subtle
   *  "updating" affordance. Clears on load OR error. */
  readonly refreshing: boolean
  /**
   * The hub says this device has no cached frame. It is the REASON a request
   * may fail, not a reason to skip the request — the request is what makes the
   * first capture happen. Pair it with `failed` to tell "never captured (a
   * sleeping battery camera)" apart from "the camera is unreachable".
   */
  readonly neverCaptured: boolean
  /**
   * Epoch ms of the frame being painted, when the hub told us.
   *
   * Null on an older hub, or on the identity-versioned fallback path. Nothing on
   * the tRPC path carried a capture time before `getSnapshotLinks`, which is why
   * a two-minute-old frame could render as if it were current with nothing able
   * to say otherwise.
   */
  readonly capturedAt: number | null
  /** Age of that frame when the hub answered. Pair with {@link stale}. */
  readonly ageMs: number | null
  /**
   * The frame is old enough that presenting it as current would be a lie.
   *
   * True either because it genuinely is (a camera we cannot reach) or because it
   * is DELIBERATELY old — see {@link sleeping}. False when we simply do not know
   * the age, so a surface never invents staleness it cannot substantiate.
   */
  readonly stale: boolean
  /**
   * A sleeping battery camera. Its frame will not refresh in the background and
   * that is correct — `force` is an operator signal, and a tile appearing on
   * screen is not one. A surface should say "asleep", never "broken".
   */
  readonly sleeping: boolean
  /**
   * The hub did not provision a tile within {@link SNAPSHOT_HUB_TIMEOUT_MS}.
   *
   * The ONLY state a surface may render on its own authority (D190). Everything
   * else a tile says about a camera is painted into the frame by the snapshot
   * service and named in {@link stateReason} — this is what is left when the
   * service itself is unreachable or too busy to answer.
   */
  readonly hubUnresponsive: boolean
}

/**
 * Above this the age is worth surfacing.
 *
 * Comfortably past the server's warm cadence (a 5 s tick against a 10 s
 * per-device max-age), so a healthy watched camera never trips it and the badge
 * means something when it appears.
 */
const SNAPSHOT_STALE_AFTER_MS = 30_000
/**
 * How long a surface waits for the hub before it says anything at all.
 *
 * The ONE state this client still owns (D190). Every camera state — disabled,
 * sleeping, waking, unreachable, offline — comes back from the hub as a frame
 * with the state painted into it, so the only thing left for the app to report
 * is the hub itself not answering.
 *
 * Deliberately generous. The tile used to decide within one failed request that
 * a camera was "Unavailable", which on a cold start, a slow hub, or a fleet all
 * capturing at once painted a grid of failure messages over frames that were
 * seconds away. A skeleton that lasts fifteen seconds is a worse look exactly
 * once; a false verdict is a worse look every time.
 */
export const SNAPSHOT_HUB_TIMEOUT_MS = 15_000

/**
 * Server-owned snapshot image source for a device.
 *
 * `enabled` answers ONE question: is anybody looking at this surface? It is NOT
 * a judgement about the camera — the hub has a correct tile for every camera
 * state (D190) and the client is not allowed a second opinion about which of
 * them are worth painting.
 */
export interface UseSnapshotOptions {
  /**
   * Connecting / paused-waiting poster: keep asking for a new frame on the
   * 10 s cadence even when the hub still names the same capture. Without this
   * `expo-image` never revalidates a stable URL, so a dead stream freezes the
   * last snapshot until the player gives up.
   */
  readonly refreshWhileWaiting?: boolean
}

export function useSnapshot(
  deviceId: number,
  enabled: boolean,
  /**
   * Target width in px for a thumbnail surface. Omit on anything full-bleed
   * (the detail view, a zone-drawing overlay) — those need the frame as
   * captured. A card that omits it is served the full 4K capture.
   */
  targetWidth?: number,
  options?: UseSnapshotOptions,
): SnapshotSource {
  const { controller } = useConnection()
  const { token, server } = useServer()
  // Manual pull-to-refresh epoch: bumping it shifts every snapshot's bucket so a
  // mid-window refresh cache-busts to a fresh frame (see snapshot-refresh-store).
  const refreshEpoch = useSnapshotRefreshStore((s) => s.epoch)
  const refreshWhileWaiting = options?.refreshWhileWaiting === true

  /**
   * **A snapshot is a plain HTTP GET with a Bearer header. It needs nothing
   * from the WebSocket.**
   *
   * This used to be gated on `state === 'connected'`, and that is why every
   * card went "unavailable" when the app came back from the background: iOS
   * suspends the socket, the mirrored state leaves `connected`, the URL becomes
   * null, the bucket interval is torn down — so the URL can never change again
   * — and nothing recovers until the socket does. The images themselves would
   * have loaded fine the whole time.
   */
  const serverUrl = controller.getSystem()?.serverUrl ?? server?.serverUrl ?? null

  // The frame identity, from the app-wide overview poll. This replaces the 30 s
  // wall-clock bucket entirely: no timer here at all, so a tile refetches when
  // its frame moved rather than four times an hour regardless.
  const version = useSnapshotVersion(deviceId)

  // The minted link, and — as a side effect of asking for it — the statement
  // that this surface is watching this camera at this width.
  //
  // That side effect is the whole point. Enrolment used to ride on the image
  // request, and the platform image cache answers a repeated URL with no
  // network, so a reopened app enrolled nothing and warmed nothing. An RPC has
  // no such cache in front of it, so the demand always lands.
  const linkState = useSnapshotLink(deviceId, targetWidth, enabled)
  const link = linkState.row
  const namedThisSession = useRef(false)
  const namedDeviceId = useRef(deviceId)
  if (namedDeviceId.current !== deviceId) {
    namedDeviceId.current = deviceId
    namedThisSession.current = false
  }
  if (link !== null || version.known) namedThisSession.current = true

  const neverCaptured =
    link !== null ? link.neverCaptured : version.known && version.lastCapturedAt === null

  // Safety net for a frame identity we cannot LEARN.
  //
  // The identity comes from `getSnapshotOverview`, a tRPC query gated on a live
  // WebSocket; the image is a plain HTTP GET that needs nothing from it. When
  // the socket drops — iOS suspending the app is the everyday case — the
  // identity stops advancing and, because `expo-image` is URL-keyed and never
  // revalidates, the tile paints the same frame forever. This ticks the URL on a
  // coarse timer while the identity is unknown, which is exactly the behaviour
  // that existed before the overview did, so the worst case degrades to "stale
  // by up to 30 s" instead of "frozen".
  //
  // It runs ONLY while unknown. `known: true` with a null `lastCapturedAt` is a
  // real answer — the hub saying it has no frame — and must stay stable, or a
  // sleeping battery camera is requested every window forever.
  const [fallbackTick, setFallbackTick] = useState(0)
  // Start of the current unknown-identity episode. Stamps the fallback URLs so
  // they are unique PER EPISODE: expo-image is URL-keyed and never revalidates,
  // so `?v=f1` minted in this outage and `?v=f1` minted in the last one are the
  // same cache key — the second outage repainted the first outage's frames
  // (observed live: two-week-old JPEGs while the server was merely slow).
  const [fallbackEpochMs, setFallbackEpochMs] = useState(0)
  // Also gated on `enabled`. Without it the one path that runs precisely
  // BECAUSE the socket is down — which is what backgrounding the app looks
  // like — kept advancing the URL of every tile whose surface had already said
  // nobody is looking, and each advance is an HTTP GET per tile. `enabled` is
  // `useScreenActive` at every list/reel/grid caller, so this now ticks only
  // for a tile somebody can actually see.
  useEffect(() => {
    if (version.known || !enabled) {
      setFallbackTick(0)
      setFallbackEpochMs(0)
      return
    }
    setFallbackEpochMs(Date.now())
    const id = setInterval(
      () => setFallbackTick((t) => t + 1),
      SNAPSHOT_IDENTITY_FALLBACK_MS,
    )
    return () => clearInterval(id)
  }, [version.known, enabled])

  const [waitingTick, setWaitingTick] = useState(0)
  useEffect(() => {
    if (!refreshWhileWaiting || !enabled) {
      setWaitingTick(0)
      return
    }
    const id = setInterval(() => setWaitingTick((t) => t + 1), SNAPSHOT_REFETCH_MS)
    return () => clearInterval(id)
  }, [refreshWhileWaiting, enabled])

  // NOTE: `neverCaptured` deliberately does NOT suppress the URL. A device with
  // no cached frame gets the stable form, and that request is what enrols it in
  // the server's keep-warm loop and triggers the first capture. Suppressing it
  // is a self-sealing deadlock — see `resolveSnapshotUri`, which is where that
  // rule and the incident that produced it are written down.
  const hubCapturedAt =
    link?.capturedAt !== null && link?.capturedAt !== undefined
      ? Math.max(link.capturedAt, version.lastCapturedAt ?? 0)
      : version.lastCapturedAt
  // The newest identity this process has seen, kept across unknown episodes so
  // the fallback path keeps painting the newest frame the hub actually named.
  const lastKnownCapturedAt = useRef<number | null>(null)
  if (hubCapturedAt !== null && hubCapturedAt > (lastKnownCapturedAt.current ?? 0)) {
    lastKnownCapturedAt.current = hubCapturedAt
  }

  // Freshness contract (revised 2026-08-16): the tile ALWAYS paints the frame
  // the hub names — freshness is communicated by the `stale` badge, not by
  // blanking. The previous hard 30 s paint ceiling blanked the whole grid on
  // every resume from background (while suspended the app issues no demand, so
  // the server stops warming and every frame ages past the ceiling), and it
  // blanked awake-but-idle battery cameras whose frames legitimately age (the
  // server no longer recaptures them on the poll cadence — each capture is a
  // camera hit that keeps the camera out of sleep).
  //
  // What remains strict: a `stateReason` overlay (sleeping / waking /
  // unreachable / disabled) is authoritative and always painted; and a device
  // with NO named frame still gets the bootstrap URL whose request enrols it.
  const stateReason = link?.stateReason ?? null
  const linkRenderable = linkState.supported && link !== null
  // Older hubs have no links cap at all; keep the legacy identity-versioned
  // path there (the image request is their only capture-demand signal).
  // A sized native tile does not wait for the links poll: the width-scoped
  // JPEG starts with the card. The poll still names the camera.
  const renderable = snapshotThumbnailFetchReady({
    enabled,
    hasServerUrl: serverUrl !== null,
    targetWidth,
    linkRenderable,
    linksReady: linkState.ready,
    linksSupported: linkState.supported,
    nativeFileCache: Platform.OS !== 'web',
  })
  const bootstrapThumb =
    Platform.OS !== 'web' &&
    !linkRenderable &&
    targetWidth !== undefined &&
    targetWidth > 0 &&
    serverUrl !== null
  const waitingForCurrentLink =
    enabled && (!linkState.ready || (linkState.supported && !linkRenderable))
  // A web page on another origin than its hub paints the SIGNED link: a plain
  // `<img>`, no Bearer, so no CORS preflight and no JS blob fetch per frame
  // (`snapshot-image-auth.ts`). A link that failed once falls back to the
  // authenticated media URL until a new one is minted.
  const [failedLinkPath, setFailedLinkPath] = useState<string | null>(null)
  const paintSignedLink = shouldPaintSignedSnapshotLink({
    platform: Platform.OS,
    serverUrl,
    pageOrigin: snapshotPageOrigin(),
    linkPath: link?.url ?? null,
    expiresAt: link?.expiresAt ?? null,
    nowMs: Date.now(),
    failedLinkPath,
  })
  const resolvedUri = renderable
    ? resolveSnapshotUri({
        serverUrl,
        deviceId,
        // The link RPC remains the freshness/demand authority, but the Viewer
        // renders through its authenticated media URL. Signed links expire while
        // iOS is suspended; handing one to expo-image made a perfectly good cached
        // frame disappear on resume and forced the UI to wait for the socket before
        // it could mint another one. The exception is a cross-origin web page,
        // where the media URL costs a preflight and a blob per tile.
        lastCapturedAt: hubCapturedAt,
        identityKnown: link !== null || version.known,
        lastKnownCapturedAt: lastKnownCapturedAt.current,
        fallbackTick,
        fallbackEpochMs,
        forceRefreshTick: refreshWhileWaiting ? waitingTick : 0,
        refreshEpoch,
        width: targetWidth,
        link: paintSignedLink ? link?.url ?? null : null,
        // The state reason rides in the URL identity: a sleeping→awake
        // transition over the SAME capture must bust expo-image's disk cache,
        // or the overlay variant the server now serves would never be fetched.
        stateReason,
        // A native thumbnail bootstrap must still emit a URL: the cold-start
        // guard withholds one until this process has been told a frame identity,
        // which is exactly the links round-trip this path is not waiting for.
        namedThisSession: namedThisSession.current || bootstrapThumb,
      })
    : null

  // ── The native file cache ────────────────────────────────────────────────
  //
  // On native the tile no longer hands `expo-image` the remote URL at all. The
  // store fetches `resolvedUri` ITSELF (same URL, same handler — so the request
  // that enrols a camera in the server's keep-warm loop still happens), writes
  // the bytes under a name carrying the server's ETag, and the tile paints that
  // file. What this buys, in the order the incidents happened:
  //
  //  - the frame's age is always stateable, so `stale` can be honest at a cold
  //    start with the hub down — where previously the age came from a
  //    socket-gated RPC and was unknown exactly when it mattered;
  //  - a conditional GET (`If-None-Match`) means a slow hub answers 304 and we
  //    keep our own dated frame instead of whatever `expo-image` had;
  //  - a capture time that moves BACKWARDS is refused, which is precisely the
  //    two-week-old JPEG that came back in the second outage.
  //
  // On web this is inert (`supported: false`) and everything above stands: the
  // browser revalidates on ETag, so the remote URL is already correct there.
  const cachedFile = useSnapshotFile({
    deviceId,
    width: targetWidth,
    remoteUrl: resolvedUri,
    token,
    enabled: renderable,
  })

  // An enabled surface paints its file even when the link machinery has never
  // answered — the cold-start-offline case the cache exists for: the frame is
  // one we already hold, so needing a live socket to show it would be absurd.
  //
  // A DISABLED surface paints nothing. There is no longer an exception: the
  // hold-the-last-frame branch existed only for a camera the gate refused to
  // ask about, and the gate asks about every camera on screen now (D190). A
  // surface that is off is off because something else owns this box — a live
  // player behind its poster, a grid tile that is streaming — and painting a
  // photograph over live video is worse than painting nothing.
  const uri = enabled ? (cachedFile.supported ? cachedFile.uri : resolvedUri) : null
  // A download in flight is a frame being waited for, exactly like an unsettled
  // link. So is the gap BEFORE it starts: the store dispatches from an effect,
  // so there is at least one render where this surface has no file and no
  // failure yet, and on an older hub (no links cap) the link wait does not cover
  // it. Stated structurally rather than by timing — supported, renderable,
  // nothing on disk, nothing failed means the store will either land a frame or
  // record a failure — because the alternative is a card painting "unavailable"
  // over a frame that is milliseconds away, on every tile, on every cold launch.
  const awaitingCachedFile =
    cachedFile.supported && renderable && cachedFile.uri === null && !cachedFile.failed
  const awaitingFrame = waitingForCurrentLink || cachedFile.fetching || awaitingCachedFile
  // The badge must describe the frame ON SCREEN. When that is a cached file, its
  // capture time is the one the server stamped into the file's name — not the
  // newest capture the hub happens to hold, which is a frame we may not have.
  const paintedCapturedAt =
    cachedFile.supported && cachedFile.uri !== null ? cachedFile.capturedAt : null
  const capturedAt = paintedCapturedAt ?? hubCapturedAt
  const ageMs = capturedAt === null ? link?.ageMs ?? null : Math.max(0, Date.now() - capturedAt)

  // Load-state machine, reset per device. `everLoaded` is sticky: once a frame
  // paints, a later transient error keeps the last frame (no blank flash).
  // `settledUri` records the last URL whose load ATTEMPT finished (painted or
  // errored) — while the current bucketed `uri` differs, a refresh is in
  // flight behind the painted frame.
  const [everLoaded, setEverLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [settledUri, setSettledUri] = useState<string | null>(null)
  /**
   * A same-origin web load failed, so stop trusting the session cookie.
   *
   * Dropping the Bearer on a hub-served page is what puts the tile back on the
   * browser's own `<img>` loader, and it is right for as long as the httpOnly
   * `camstack_session` cookie is valid. That cookie has its own lifetime and can
   * expire while this app still holds a live JWT — an app that never signs out
   * is exactly the long web session where that happens. Rather than let the
   * whole grid go "Unavailable" on a cookie nobody can inspect from here, ONE
   * failure moves this surface back to the header path (the slower loader, but
   * the one authenticated by a credential we own). Sticky per device, and reset
   * with the rest of the load state.
   */
  const [cookieAuthFailed, setCookieAuthFailed] = useState(false)
  const everLoadedRef = useRef(false)
  // Reset only when this hook is reused for another camera. Endpoint failover,
  // backgrounding and reconnects must retain the painted-frame state.
  useEffect(() => {
    everLoadedRef.current = false
    namedThisSession.current = false
    lastKnownCapturedAt.current = null
    setEverLoaded(false)
    setFailed(false)
    setSettledUri(null)
    setCookieAuthFailed(false)
    setFailedLinkPath(null)
  }, [deviceId])

  /**
   * The hub is not answering.
   *
   * The one verdict this client is still allowed to reach, and it is about the
   * HUB — never about the camera, because a camera nothing has answered about is
   * not a fact this app holds. It arms only while the surface is asking and has
   * nothing on screen, and it disarms the instant a frame paints, so a slow
   * first load ends in a picture rather than in a message about a picture.
   */
  const nothingOnScreen = enabled && !everLoaded
  const [hubUnresponsive, setHubUnresponsive] = useState(false)
  useEffect(() => {
    if (!nothingOnScreen) {
      setHubUnresponsive(false)
      return
    }
    const timer = setTimeout(() => {
      setHubUnresponsive(true)
      log.warn('media:snapshot', 'hub did not provision a tile in time', {
        deviceId,
        waitedMs: SNAPSHOT_HUB_TIMEOUT_MS,
      })
    }, SNAPSHOT_HUB_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [nothingOnScreen, deviceId])

  // Diagnostics at scope `media:snapshot` — always shipped to the hub, no
  // toggle. One line per TRANSITION (signature-deduped, so the 5 s link poll
  // cannot spam): when a tile gains/loses its paintable frame, when the state
  // overlay changes, when a load fails. This is the trail for "snapshot went
  // to Unavailable" / "snapshots lost on phone lock" reports.
  // The age is a FIELD, never part of the signature. It used to ride as a
  // coarse class (fresh/stale/ancient) to keep a precise age from defeating the
  // dedupe — which halved the problem instead of removing it: the class still
  // flips on a clock, so every tile on screen re-logged at 60 s and again at
  // 5 min. Measured 2026-09-09: 43% of everything this app shipped to the hub.
  const transitionSig = snapshotTransitionSignature({
    enabled,
    uri,
    stateReason,
    failed,
    awaitingFrame,
    cachedFileSupported: cachedFile.supported,
    cachedFileUri: cachedFile.uri,
    neverCaptured,
    ageMs,
  })
  const lastTransitionRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastTransitionRef.current === transitionSig) return
    const prev = lastTransitionRef.current
    lastTransitionRef.current = transitionSig
    // The first signature is the baseline, not an event: a grid mount is tens
    // of tiles and `tile mount` was pure volume. Only a CHANGE is a line, and
    // the signature excludes the routine waiting<->ready refresh cycle, so
    // what is left is enable/disable, a state reason, failure/recovery,
    // never-captured and cache-support changes — a handful per hour.
    if (prev === null) return
    log.info('media:snapshot', 'tile transition', {
      deviceId,
      from: prev,
      to: transitionSig,
      ...(ageMs === null ? {} : { ageMs }),
    })
  }, [transitionSig, deviceId, ageMs])

  // A tile that stays "waiting" past the bound is worth exactly one line per
  // episode; a refresh that ends ready inside the bound is silent.
  useEffect(() => {
    if (!awaitingFrame) return
    const timer = setTimeout(() => {
      log.warn('media:snapshot', 'tile stuck waiting for a frame', {
        deviceId,
        waitedMs: SNAPSHOT_STUCK_WAITING_MS,
      })
    }, SNAPSHOT_STUCK_WAITING_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [awaitingFrame, deviceId])

  /**
   * The image credential, memoised on its OWN inputs and never rebuilt with the
   * source object.
   *
   * The identity of this object is load-bearing on web: `expo-image`'s web
   * loader keys its fetch effect on the whole `source`, and `SnapshotImage`
   * derives its candidate from `source.headers`. The `source` memo below
   * depends on `ageMs`, which is `Date.now()`-derived and therefore different on
   * every single render — so building the headers inside it handed expo-image a
   * new object each render and made it re-download the JPEG each render.
   *
   * Whether a Bearer belongs here at all is `snapshot-image-auth.ts`: on a
   * hub-served web viewer it does not, and omitting it is what puts the tile
   * back on the browser's own `<img>` loader instead of a JS blob round trip.
   */
  const headers = useMemo<Record<string, string> | undefined>(() => {
    const attach =
      cookieAuthFailed ||
      shouldAttachSnapshotBearer({
        platform: Platform.OS,
        uri,
        token,
        pageOrigin: snapshotPageOrigin(),
      })
    return attach && token !== null && uri !== null && !uri.startsWith('file:') && !isSignedSnapshotLink(uri)
      ? { Authorization: `Bearer ${token}` }
      : undefined
  }, [uri, token, cookieAuthFailed])

  const source = useMemo<SnapshotSource>(() => {
    return {
      uri,
      ...(headers ? { headers } : {}),
      onLoad: () => {
        everLoadedRef.current = true
        setEverLoaded(true)
        setFailed(false)
        setSettledUri(uri)
      },
      onError: () => {
        log.warn('media:snapshot', 'snapshot image load failed', {
          deviceId,
          stateReason,
          ageMs,
          everLoaded: everLoadedRef.current,
          // Which credential was on the request. A grid that fails only with
          // `auth=cookie` is a stale hub session, not a broken camera, and that
          // is not answerable after the fact without this field.
          auth:
            uri !== null && isSignedSnapshotLink(uri)
              ? 'signed-link'
              : headers === undefined
                ? 'cookie'
                : 'bearer',
        })
        // A signed link that failed (expired while the tab slept, a hub that
        // re-keyed): fall back to the authenticated media URL for this link.
        if (uri !== null && isSignedSnapshotLink(uri)) {
          if (paintSignedLink && link?.url) setFailedLinkPath(link.url)
        } else if (headers === undefined) {
          // A cookie-authed load that failed is the one failure mode this hook
          // can do something about: retry the SAME url with the token attached.
          setCookieAuthFailed(true)
        }
        if (!everLoadedRef.current) setFailed(true)
        // A failed refresh is still a finished attempt — don't strand the
        // "updating" affordance until the next frame lands.
        setSettledUri(uri)
      },
      isLoading: !everLoaded && (awaitingFrame || (uri !== null && !failed)),
      failed: (failed || cachedFile.failed) && !everLoaded,
      refreshing:
        everLoaded &&
        (awaitingFrame || (uri !== null && settledUri !== uri)),
      neverCaptured,
      capturedAt,
      ageMs,
      // Never invented: an unknown age is not a stale one. A sleeping camera is
      // stale by definition, however recently it last managed a frame.
      //
      // Deliberately NOT gated on a link any more. A link needs a live socket,
      // so the badge used to vanish in exactly the situation it exists for —
      // offline, painting a cached frame, with nothing on screen saying how old
      // it was. That is the report this cache was built for.
      // A frame the hub has NAMED a state for is not a live one, whatever its
      // age says — that is the server telling us, and it outranks a clock. The
      // age threshold still covers a camera the hub thinks is fine but has not
      // managed to recapture.
      stale:
        stateReason !== null ||
        link?.sleeping === true ||
        (ageMs !== null && ageMs > SNAPSHOT_STALE_AFTER_MS),
      sleeping: link?.sleeping ?? false,
      hubUnresponsive,
    }
  }, [
    uri,
    headers,
    everLoaded,
    failed,
    settledUri,
    neverCaptured,
    link,
    awaitingFrame,
    cachedFile.failed,
    capturedAt,
    ageMs,
    deviceId,
    stateReason,
    hubUnresponsive,
  ])

  return source
}
