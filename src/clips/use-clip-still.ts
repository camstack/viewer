/**
 * use-clip-still — one tile's still: ask, read the disposition, come back if
 * the server said to, and stop with a NAME when the budget runs out (D573).
 *
 * The rule itself is in `clip-still.ts`; this is the machine that drives it.
 * What it guarantees, and what the specs assert from a real first paint:
 *
 *  - A tile is never blank with no explanation. Before the first answer it is
 *    `loading`; after a deferral it is still `loading` and it carries the
 *    reason's own key, so the box can say "waiting for the camera" rather than
 *    show a skeleton that is indistinguishable from a dead one.
 *  - A `final` refusal latches on the first answer and is never retried.
 *  - The budget ends. Four retries, then `refused` with `gaveUp`.
 *  - An unmounted tile drops its pending retry: scrolling a long list must not
 *    leave 60 timers asking for stills nobody is looking at.
 *
 * `<Image src>` cannot do any of this: a 204 fires `onerror` with nothing to
 * say, turning a named, temporary refusal into an anonymous broken tile. So
 * the mint goes through `fetch`, and the bytes it returns are what the tile
 * renders — see {@link ClipStillOutcome} for why they are not re-fetched.
 *
 * And the bytes OUTLIVE the tile. They are held in `clip-still-memory.ts`, so
 * a still survives the unmount an ordinary scroll causes, a remount of the
 * list and a trip to another screen; a tile that finds one there is `ready` on
 * its first render and asks nobody. Before that, every unmount threw away a
 * still the app had already paid a mint for, and the re-ask rejoined a 16-deep
 * queue — *"le thumbnail non arrivano nonostante prima dovrebbe già averle
 * scaricate"* (D574).
 */
import { useEffect, useRef, useState } from 'react'

import { bytesToBase64 } from '../lib/bytes-to-base64.js'
import { noteClipStill, type ClipStillOutcomeName } from './clip-telemetry.js'

import { requestClipStill } from './clip-still-lane.js'
import {
  recallClipStill,
  recallClipStillFailure,
  rememberClipStill,
  rememberClipStillFailure,
} from './clip-still-memory.js'
import {
  clipStillMessageKey,
  clipStillNetworkFailure,
  planClipStillRetry,
  readClipStillAnswer,
  type ClipStillOutcome,
} from './clip-still.js'

/** The `fetch` this module uses — injected so the contract is testable. */
export type StillFetcher = (url: string, init: RequestInit) => Promise<Response>

/** What a tile draws. */
export type ClipStillPhase =
  /** No mint offered: this clip has no still to ask for. */
  | 'idle'
  /** Asked, or waiting to ask again. */
  | 'loading'
  /** {@link ClipStillView.uri} is the still. */
  | 'ready'
  /** There will be no still. Latched. */
  | 'refused'

export interface ClipStillView {
  readonly phase: ClipStillPhase
  /** The still, as a `data:` URI, once there is one. */
  readonly uri: string | null
  /** i18n key for what to say, or `null` when only {@link ClipStillView.reason}
   *  exists — a code this build has never heard of. */
  readonly messageKey: string | null
  /** The provider's own sentence. Rendered verbatim, never parsed. */
  readonly reason: string | null
  /** Requests made so far, for the surface that wants to show it. */
  readonly attempts: number
}

/** Injection seams. Production passes neither. */
export interface ClipStillDeps {
  readonly fetchStill?: (
    url: string,
    authorization: string | null,
    signal?: AbortSignal,
  ) => Promise<ClipStillOutcome>
  readonly random?: () => number
}

const IDLE: ClipStillView = {
  phase: 'idle',
  uri: null,
  messageKey: null,
  reason: null,
  attempts: 0,
}

/** Said while the first request is still in the air — the tile has asked and
 *  has no answer yet, which is a different thing from having been refused. */
const ASKING_KEY = 'v2.clips.still.waiting'

/** Said when the ladder ran out. The operator's next refresh asks again. */
const GAVE_UP_KEY = 'v2.clips.still.gaveUp'

/**
 * Ask the mint route once.
 *
 * Never rejects: a thrown fetch is an answer like any other, because a tile
 * that throws is a tile that renders nothing and says nothing — the exact
 * failure this module exists to prevent. A thrown fetch is DEFERRED; nothing
 * refused anything, one request lost a race.
 *
 * Nothing but the session token is attached, plus the caller's `signal` — the
 * tile's lifetime, not a credential. The mint URL is not a credential and must
 * not become one.
 */
export async function fetchClipStill(
  url: string,
  authorization: string | null,
  fetcher: StillFetcher = fetch,
  signal?: AbortSignal,
): Promise<ClipStillOutcome> {
  let response: Response
  try {
    response = await fetcher(url, {
      ...(authorization === null ? {} : { headers: { Authorization: authorization } }),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (err: unknown) {
    return asOutcome(clipStillNetworkFailure(err))
  }
  const answer = readClipStillAnswer(response.status, response.headers)
  if (answer.kind !== 'served') return asOutcome(answer)
  try {
    return { kind: 'served', uri: await responseToDataUri(response) }
  } catch (err: unknown) {
    return asOutcome(clipStillNetworkFailure(err))
  }
}

/** A wire answer as an outcome. Only `served` differs, and it never reaches
 *  here — the caller attaches the bytes itself. */
function asOutcome(answer: ReturnType<typeof readClipStillAnswer>): ClipStillOutcome {
  return answer.kind === 'served'
    ? { kind: 'refused', code: null, reason: 'a still with no bytes' }
    : answer
}

/**
 * The still, as something both `expo-image` and the web `<img>` can render.
 *
 * ## Why not `response.blob()`
 *
 * It throws here. React Native's fetch cannot build a Blob out of a buffered
 * body — *"Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not
 * supported"* — and on 2026-09-21 that sentence was printed across every clip
 * card on the operator's phone, the moment the stills started being requested
 * at all. The embed does exactly this with `res.blob()` and
 * `URL.createObjectURL`, and is right to: it runs in a real browser inside the
 * WebView. This code does not.
 *
 * So the bytes never become a Blob. `arrayBuffer()` is supported, and
 * `bytes-to-base64.ts` does the rest without `btoa` (absent on Hermes) and
 * without `String.fromCharCode(...bytes)` (blows the argument limit on a 47 KB
 * JPEG). One page of 60 stills is ~2 MB of JPEG and the page bounds it — a
 * tile that scrolls away unmounts and drops its copy.
 */
async function responseToDataUri(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error('the still arrived empty')
  // What the server SAID it sent. A still is a JPEG in practice, but writing
  // that in would mislabel the first camera whose provider sends a PNG.
  const declared = response.headers.get('content-type')
  const mime = declared !== null && declared.length > 0 ? declared.split(';')[0] : 'image/jpeg'
  return `data:${mime ?? 'image/jpeg'};base64,${bytesToBase64(bytes)}`
}

function waitingView(outcome: ClipStillOutcome, attempts: number): ClipStillView {
  if (outcome.kind === 'served' || outcome.kind === 'refused') return IDLE
  return {
    phase: 'loading',
    uri: null,
    messageKey: clipStillMessageKey(outcome.code),
    reason: outcome.reason,
    attempts,
  }
}

function refusedView(outcome: ClipStillOutcome, attempts: number, key: string | null): ClipStillView {
  if (outcome.kind === 'served') return IDLE
  return {
    phase: 'refused',
    uri: null,
    messageKey: key ?? clipStillMessageKey(outcome.code),
    reason: outcome.reason,
    attempts,
  }
}

/**
 * One tile's still.
 *
 * @param url - the mint URL, already absolute, or `null` when the clip offers
 *   no still at all.
 * @param authorization - the `Authorization` header value, or `null`.
 */
/**
 * The view a tile opens with, before it has asked anything.
 *
 * A still this app already holds is drawn on the FIRST render, synchronously —
 * not after an effect, and never through a `loading` frame. The frame is the
 * whole point: a tile that reports `loading` on a remount has already rejoined
 * the provider's 16-deep mint queue, which is what made a scrolled-away
 * thumbnail fail to come back (D574).
 */
function openingView(url: string | null): ClipStillView {
  if (url === null) return IDLE
  const held = recallClipStill(url)
  if (held !== null) {
    return { phase: 'ready', uri: held, messageKey: null, reason: null, attempts: 0 }
  }
  return rememberedFailureView(url) ?? IDLE
}

/**
 * A still that already failed this session, as the tile showed it then. It is
 * not asked for again: on an Amcrest a failed still is a camera replay that
 * ran its whole bound, and a remount re-dialled every one (2026-09-25).
 */
function rememberedFailureView(url: string): ClipStillView | null {
  const failure = recallClipStillFailure(url)
  if (failure === null) return null
  return {
    phase: 'refused',
    uri: null,
    messageKey: failure.messageKey ?? clipStillMessageKey(failure.code),
    reason: failure.reason,
    attempts: 0,
  }
}

/** Latch a FINAL refusal in the view AND in the session's memory. */
function latchRefusal(url: string, view: ClipStillView, code: string | null): ClipStillView {
  rememberClipStillFailure(url, {
    code,
    reason: view.reason ?? '',
    messageKey: view.messageKey,
  })
  return view
}

/** The telemetry name for a fetch outcome. Unknown kinds count as failures
 *  rather than vanishing — a kind nobody counted is a kind nobody sees. */
function stillOutcomeName(kind: string): ClipStillOutcomeName {
  if (kind === 'served') return 'served'
  if (kind === 'deferred') return 'deferred'
  if (kind === 'refused') return 'refused'
  return 'failed'
}

export function useClipStill(
  url: string | null,
  authorization: string | null,
  deps?: ClipStillDeps,
): ClipStillView {
  const [view, setView] = useState<ClipStillView>(() => openingView(url))
  // Held in a ref so a caller passing a fresh options object every render does
  // not restart the ladder — the URL is the identity, and nothing else is.
  const depsRef = useRef<ClipStillDeps | undefined>(deps)
  depsRef.current = deps

  useEffect(() => {
    if (url === null) {
      setView(IDLE)
      return
    }
    // Held from an earlier mount — this URL costs nothing and asks nobody.
    const held = recallClipStill(url)
    if (held !== null) {
      // Counted too: a surface that paints entirely from memory and a surface
      // that never asked look identical from the hub, and the difference is
      // the whole question when the operator says "no thumbnails".
      noteClipStill({ outcome: 'held', ms: 0 })
      setView({ phase: 'ready', uri: held, messageKey: null, reason: null, attempts: 0 })
      return
    }
    // Failed earlier this session — answered from memory, asks nobody.
    const failure = rememberedFailureView(url)
    if (failure !== null) {
      noteClipStill({ outcome: 'refused', ms: 0 })
      setView(failure)
      return
    }
    const fetchStill = depsRef.current?.fetchStill
    const ask = (signal: AbortSignal): Promise<ClipStillOutcome> =>
      fetchStill !== undefined
        ? fetchStill(url, authorization, signal)
        : fetchClipStill(url, authorization, fetch, signal)
    const random = depsRef.current?.random ?? Math.random
    const gone = new AbortController()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    setView({ phase: 'loading', uri: null, messageKey: ASKING_KEY, reason: null, attempts: 0 })

    const run = async (attempt: number): Promise<void> => {
      // Through the camera's lane (`clip-still-lane.ts`): one request in the
      // air per camera, shared per URL, withdrawn if this tile goes away
      // before its turn. Retries go through it too, so a ladder never runs in
      // parallel with the rest of the page.
      const askedAt = Date.now()
      const outcome = await requestClipStill(url, ask, gone.signal)
      if (outcome === null) return
      noteClipStill({ outcome: stillOutcomeName(outcome.kind), ms: Date.now() - askedAt })
      if (outcome.kind === 'served') rememberClipStill(url, outcome.uri)
      if (cancelled) return
      const attempts = attempt + 1
      if (outcome.kind === 'served') {
        setView({ phase: 'ready', uri: outcome.uri, messageKey: null, reason: null, attempts })
        return
      }
      if (outcome.kind === 'refused') {
        setView(latchRefusal(url, refusedView(outcome, attempts, null), outcome.code))
        return
      }
      const plan = planClipStillRetry({ attempt, serverHintMs: outcome.retryAfterMs, random })
      if (plan === null) {
        // Tile-local, NOT latched: a run of deferrals (a paused camera, a hub
        // reconnecting) says "not now", never "never". The next mount asks
        // again, and the camera's lane still honours the last retry-after.
        setView(refusedView(outcome, attempts, GAVE_UP_KEY))
        return
      }
      setView(waitingView(outcome, attempts))
      timer = setTimeout(() => {
        void run(attempt + 1)
      }, plan.waitMs)
    }
    void run(0)

    return (): void => {
      cancelled = true
      gone.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [url, authorization])

  return view
}
