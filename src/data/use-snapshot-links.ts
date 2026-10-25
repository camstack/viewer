/**
 * `snapshot.getSnapshotLinks` — the call that makes a tile CURRENT, not just the
 * call that describes it.
 *
 * ## Why this exists next to `use-snapshot-overview.ts`
 *
 * The overview is cache-only by contract: it answers from whatever the wrapper
 * happens to hold and never captures. D93 built the client's freshness on it
 * anyway — the image URL carries `lastCapturedAt`, and an image REQUEST is what
 * enrols a camera in the server's keep-warm loop.
 *
 * Both of those are satisfiable by the platform image cache. `expo-image` is
 * URL-keyed and never revalidates, so a URL this app painted in a previous
 * session is served from disk with **no network at all**: no request, no
 * enrolment, nothing warming, and an overview that goes on reporting the same
 * frozen identity. Measured on the live hub, reopening after two minutes idle
 * painted 15 of 16 tiles at 168 s old with zero HTTP requests. That is the
 * "snapshot vecchi, devo aggiornare più volte" report, exactly.
 *
 * An RPC has no image cache in front of it. So this call is both halves at once:
 * it is the demand signal (the server enrols what it is asked about, at the
 * width it is asked for), and it returns a signed link whose capture identity
 * the server briefly WAITED for. The client stops inferring freshness and is
 * simply told.
 *
 * Degrades to `supported: false` on an older hub (NOT_FOUND through `capQuery`),
 * which leaves the whole D93/D94/D95 identity path in place underneath.
 */
import { useMemo, useRef } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { BULK_QUERY_DEADLINE_MS, capQuery, isRecord } from './cap-query.js'
import { planSnapshotLinkPoll, SNAPSHOT_LINK_POLL_SLICES } from './snapshot-link-slices.js'

/**
 * Poll cadence. Matched to the server's keep-warm tick (`WARM_INTERVAL_MS`,
 * 5 s) for the same reason the overview poll is: the warm loop is what makes a
 * watched camera's frame move, so asking faster only adds calls and asking
 * slower adds latency to a change the server already has.
 *
 * This poll is also what keeps the subscription alive, so it must not be
 * throttled below the server's warm window without changing that window too.
 */
export const SNAPSHOT_LINKS_POLL_MS = 5_000
/** Renew a same-generation signed link only when it is close enough to expiry
 *  that keeping it through another poll risks an unusable image URL. */
export const SNAPSHOT_LINK_RENEW_MARGIN_MS = SNAPSHOT_LINKS_POLL_MS * 2

/**
 * How long a row's answer still counts as an OBSERVATION of the camera's
 * state — after which the target must be named again, whatever its slice turn.
 *
 * One full rotation is how long a demanded, minted target normally waits
 * between namings (`snapshot-link-slices.ts`); one extra poll is the slack for
 * the RPC itself. Past that, the row was not merely waiting its turn — it was
 * NOT ASKED, because the tile was off-screen and the viewport gate dropped it
 * from the demand set, and `keepNewestSnapshotLinks` carried it forward
 * untouched for up to the signed link's whole 120 s TTL.
 *
 * That carry-forward is right for the frame and wrong for the state. See
 * {@link skippableSnapshotLinkKeys}.
 */
export const SNAPSHOT_LINK_STATE_MAX_AGE_MS =
  SNAPSHOT_LINK_POLL_SLICES * SNAPSHOT_LINKS_POLL_MS + SNAPSHOT_LINKS_POLL_MS

/** One tile a surface is rendering: which camera, at what width. */
export interface SnapshotLinkTarget {
  readonly deviceId: number
  /** Target width in px, snapped server-side to the ladder. Omit for the frame
   *  as captured — correct only for a full-bleed surface. */
  readonly width: number | undefined
}

/** What the hub says about one tile. */
export interface SnapshotLinkRow {
  readonly deviceId: number
  /** Root-relative signed path; the caller joins it to its own `serverUrl`. */
  readonly url: string | null
  /** Epoch ms of the frame the link serves. Null = never captured. */
  readonly capturedAt: number | null
  /** Age of that frame when the hub answered — the honest number the tRPC path
   *  never carried before. */
  readonly ageMs: number | null
  readonly width: number | null
  readonly neverCaptured: boolean
  /** A sleeping battery camera: deliberately stale, and it will NOT refresh in
   *  the background. A surface should say so rather than imply currency. */
  readonly sleeping: boolean
  /** Current state rendered over the photographic background. Null means the
   *  frame itself must be current before it can be displayed. */
  readonly stateReason: 'disabled' | 'sleeping' | 'unreachable' | 'waking' | null
  /** A battery camera. The server does NOT recapture an awake-but-idle battery
   *  camera on the poll cadence (every capture keeps it out of sleep), so its
   *  frame legitimately ages past the currency ceiling while nothing streams —
   *  a surface must keep painting it, not blank to "unavailable". False on an
   *  older hub that predates the field. */
  readonly battery: boolean
  /** Epoch ms at which the signed URL expires. */
  readonly expiresAt: number | null
  /**
   * Epoch ms at which the hub last ANSWERED for this target.
   *
   * Not the same as `capturedAt`, and the difference is the whole point:
   * `capturedAt` dates a photograph, which is a durable artefact and stays
   * true as it ages, while `stateReason` is a claim about NOW. A row carried
   * forward by {@link keepNewestSnapshotLinks} keeps both, so this is what
   * says how old the CLAIM is.
   */
  readonly observedAt: number
}

export interface SnapshotLinks {
  readonly supported: boolean
  /** One signed variant per exact Viewer demand. A camera can be mounted as a
   *  240 px card and a full-size poster at the same time. */
  readonly byTarget: Readonly<Record<string, SnapshotLinkRow>>
}

const UNSUPPORTED: SnapshotLinks = Object.freeze({ supported: false, byTarget: {} })

/** The cap's own input bound. */
const MAX_TARGETS = 200

export function snapshotLinkTargetKey(target: SnapshotLinkTarget): string {
  return `${String(target.deviceId)}:${target.width === undefined ? 'full' : String(target.width)}`
}

function parseRow(raw: unknown, observedAt: number): SnapshotLinkRow | null {
  if (!isRecord(raw)) return null
  const deviceId = raw['deviceId']
  if (typeof deviceId !== 'number') return null
  const url = raw['url']
  const capturedAt = raw['capturedAt']
  const ageMs = raw['ageMs']
  const width = raw['width']
  return {
    deviceId,
    url: typeof url === 'string' && url.length > 0 ? url : null,
    capturedAt: typeof capturedAt === 'number' ? capturedAt : null,
    ageMs: typeof ageMs === 'number' ? ageMs : null,
    width: typeof width === 'number' ? width : null,
    neverCaptured: raw['neverCaptured'] === true,
    sleeping: raw['sleeping'] === true,
    stateReason:
      raw['stateReason'] === 'disabled' ||
      raw['stateReason'] === 'sleeping' ||
      raw['stateReason'] === 'unreachable' ||
      raw['stateReason'] === 'waking'
        ? raw['stateReason']
        : raw['sleeping'] === true
          ? 'sleeping'
          : null,
    battery: raw['battery'] === true,
    expiresAt: typeof raw['expiresAt'] === 'number' ? raw['expiresAt'] : null,
    observedAt,
  }
}

/**
 * Which accepted rows a poll may leave for their slice's turn.
 *
 * `planSnapshotLinkPoll` rations CAPTURES: naming a target is a standing
 * instruction to capture it, so a minted target is named once per rotation
 * rather than once per poll. It used to be handed every key that held an
 * unexpired row, which quietly rationed something else as well — the row's
 * `stateReason`, which is a claim about the camera RIGHT NOW.
 *
 * Two ways that went wrong on the live hub (2026-09-22, device 3628):
 *
 *  - A tile scrolled out of the viewport leaves the demand set, so the poll
 *    stops naming it, so `keepNewestSnapshotLinks` carries its row forward
 *    untouched — for up to `SNAPSHOT_LINK_TTL_MS` (120 s). When the tile came
 *    back it MOUNTED on that row: the hub committed `sleeping: false` at
 *    16:08:04.597 and tiles were still mounting `sr=sleeping` at 16:09:02,
 *    **58 s later**, with live frames arriving the whole time.
 *  - Even on screen, a minted target waits a whole rotation (~20 s) for its
 *    turn, so an "asleep" overlay outlives the wake by that much.
 *
 * A row already carrying a `stateReason` costs NOTHING to re-ask: the hub
 * short-circuits `getSnapshotLinks` before any capture for a device in a
 * named state (`if (state.reason !== undefined) return`, and again for an
 * idle battery camera). So the rationing buys nothing there, and what it
 * costs is the only thing that can retire the claim.
 *
 * Hence: a key is skippable only while it holds a row that is unexpired,
 * recently observed, and makes NO state claim.
 */
export function skippableSnapshotLinkKeys(
  rows: Readonly<Record<string, SnapshotLinkRow>>,
  nowMs: number,
): ReadonlySet<string> {
  const skippable = new Set<string>()
  for (const [key, row] of Object.entries(rows)) {
    if (row.expiresAt !== null && row.expiresAt <= nowMs) continue
    if (nowMs - row.observedAt >= SNAPSHOT_LINK_STATE_MAX_AGE_MS) continue
    if (row.stateReason !== null) continue
    skippable.add(key)
  }
  return skippable
}

/**
 * Merge a links poll without ever moving a device back to an older capture.
 *
 * An expired previous link is never retained: after a hub restart the new cache
 * may legitimately be empty, and keeping an expired URL would freeze the tile
 * on an image that can no longer be fetched.
 *
 * ## A target that vanished from the ASK is not a target that lost its link
 *
 * The demand set shrinks whenever a tile leaves the viewport
 * (`snapshot-viewport.ts`), so `incoming` routinely omits cameras whose signed
 * links are still valid for another minute. This function used to build its
 * result from `incoming` alone, which collapsed "nobody asked about 101 this
 * time" into "101 has no link" — and `useSnapshot` renders nothing at all
 * without a link row on a hub that supports the cap. Scrolling a tile away and
 * back therefore blanked it until a fresh mint landed, for a frame the app
 * already held on disk.
 *
 * So an unexpired previous row survives a poll that did not mention it. It is
 * still subject to expiry, which is what stops this from becoming the
 * freeze-on-a-dead-URL case above.
 */
export function keepNewestSnapshotLinks(
  previous: Readonly<Record<string, SnapshotLinkRow>>,
  incoming: Readonly<Record<string, SnapshotLinkRow>>,
  now: number,
): Readonly<Record<string, SnapshotLinkRow>> {
  let changed = false
  const next: Record<string, SnapshotLinkRow> = {}

  for (const [targetKey, candidate] of Object.entries(incoming)) {
    const current = previous[targetKey]
    const currentUsable = current !== undefined && (current.expiresAt === null || current.expiresAt > now)
    // State is authoritative and must NEVER be suppressed by the frame-identity
    // merge below: a camera that fell asleep keeps its last frame's capturedAt,
    // so the sleeping row looks like the "same generation" — and keeping the
    // older stateReason:null row hides the overlay behind the 30 s paint gate
    // until the tile blanks to "unavailable" (2026-08-16).
    const stateChanged = current !== undefined && current.stateReason !== candidate.stateReason
    const regressed =
      currentUsable &&
      !stateChanged &&
      current.capturedAt !== null &&
      (candidate.capturedAt === null || candidate.capturedAt < current.capturedAt)
    const sameGeneration =
      currentUsable &&
      !stateChanged &&
      current.capturedAt === candidate.capturedAt &&
      current.url !== null &&
      current.expiresAt !== null &&
      current.expiresAt - now > SNAPSHOT_LINK_RENEW_MARGIN_MS
    // A newly signed URL over the SAME capture is not a new image. Replacing it
    // every 5 s defeats expo-image's URL cache and clears the painted frame.
    //
    // Keeping the old row also keeps its older `observedAt`, deliberately: it
    // costs at most one extra naming, because the next poll finds the row past
    // `SNAPSHOT_LINK_STATE_MAX_AGE_MS` and asks again. Both branches here are
    // the EXCEPTION — four slices exist so that a target's turn always comes
    // after its frame has expired, so the ordinary answer is a new capture and
    // a fresh row. Advancing the stamp on a kept row instead would hand every
    // tile a new object identity on every poll.
    const selected = regressed || sameGeneration ? current : candidate
    next[targetKey] = selected
    if (selected !== current) changed = true
  }

  // Carry forward what the poll did not mention but that is still usable.
  for (const [targetKey, retained] of Object.entries(previous)) {
    if (targetKey in next) continue
    if (retained.expiresAt !== null && retained.expiresAt <= now) {
      // Dropped, and that IS a change — the tile must fall back rather than
      // keep a URL the hub will refuse.
      changed = true
      continue
    }
    next[targetKey] = retained
  }

  if (Object.keys(previous).length !== Object.keys(next).length) changed = true
  return changed ? next : previous
}

/** Parse a positional cap response without collapsing two widths of one camera. */
export function snapshotLinksByTarget(
  raw: unknown,
  targets: readonly SnapshotLinkTarget[],
  observedAt: number,
): SnapshotLinks {
  if (!Array.isArray(raw)) return UNSUPPORTED
  const byTarget: Record<string, SnapshotLinkRow> = {}
  for (let index = 0; index < raw.length; index += 1) {
    const target = targets[index]
    if (target === undefined) break
    const row = parseRow(raw[index], observedAt)
    if (row) byTarget[snapshotLinkTargetKey(target)] = row
  }
  return { supported: true, byTarget }
}

/**
 * Mint one batch of links.
 *
 * Extracted from the hook so the failure contract is TESTABLE — this suite has
 * no react renderer, so a rule living inside a `queryFn` is a rule nothing can
 * check.
 *
 * ## The catch below used to be unreachable
 *
 * The hook already wrapped this call in a try/catch that logged and rethrew.
 * It could never run: `capQuery` swallowed every failure to null FIRST, so the
 * mint "succeeded" with `UNSUPPORTED` and the warning line had not once been
 * emitted. Measured over 24h on the live hub this was the single biggest
 * consumer of the badge-sized deadline (125 expiries), every one of them
 * reported as "this hub cannot mint links".
 *
 * That is not a no-op. `SnapshotOverviewProvider` reduces a `supported: false`
 * poll to `setAcceptedLinks({})` — so each of those 125 expiries WIPED every
 * accepted link in the app and dropped the whole grid back to the unsigned
 * path until a later poll rebuilt it. A rejection instead leaves the previous
 * successful value in cache, the reducer never runs, and the tiles keep the
 * links they had.
 *
 * A batch of up to {@link MAX_TARGETS} targets is also not a per-camera status
 * probe, so it gets the bulk deadline rather than the badge one.
 */
export async function fetchSnapshotLinks(
  client: Record<string, unknown>,
  targets: readonly SnapshotLinkTarget[],
  deadlineMs: number = BULK_QUERY_DEADLINE_MS,
): Promise<SnapshotLinks> {
  const raw: unknown = await capQuery(
    client,
    'snapshot',
    'getSnapshotLinks',
    {
      targets: targets.map((t) => ({
        deviceId: t.deviceId,
        ...(t.width === undefined ? {} : { width: t.width }),
      })),
    },
    { deadlineMs, rethrow: true },
  )
  // Reachable only for a hub without the cap — `rethrow` sends everything else
  // to the caller.
  return snapshotLinksByTarget(raw, targets, Date.now())
}

/**
 * Mint links for the tiles currently on screen.
 *
 * `targets` must be the tiles a surface is ACTUALLY rendering, not the whole
 * install. The server creates a keep-warm subscription per target, and warming
 * costs a capture per camera per tick — the entire reason D93 forbade the
 * app-wide overview poll from creating one. The demand registry in
 * `SnapshotOverviewProvider` is what keeps this honest.
 *
 * ## One poll names a SLICE
 *
 * The query is keyed on the WHOLE demand set (one key, one 5 s interval), but
 * each tick asks the hub about `planSnapshotLinkPoll`'s slice of it: every
 * target that may not be left for its turn, plus the quarter whose turn it is.
 * `skippableKeys` is read at call time, never captured, because the accepted
 * rows are the provider's state and move between ticks — and what may be left
 * is narrower than "already minted": see {@link skippableSnapshotLinkKeys}. A
 * row the tick did not mention is carried forward by
 * `keepNewestSnapshotLinks`, so a tile between turns keeps what it has.
 * `snapshot-link-slices.ts` has the burst this replaces and why the slice
 * count is four.
 */
export function useSnapshotLinks(
  targets: readonly SnapshotLinkTarget[],
  enabled: boolean,
  skippableKeys: () => ReadonlySet<string>,
): UseQueryResult<SnapshotLinks> {
  const { controller, state } = useConnection()
  // Sorted + truncated so the query key is stable under mount order and the
  // input can never exceed what the cap accepts.
  const sorted = useMemo(
    () =>
      [...targets]
        .sort((a, b) => a.deviceId - b.deviceId || (a.width ?? 0) - (b.width ?? 0))
        .slice(0, MAX_TARGETS),
    [targets],
  )
  const key = useMemo(
    () => sorted.map(snapshotLinkTargetKey),
    [sorted],
  )
  // The poll ordinal. Per hook instance, never reset on a key change: a
  // reshuffle of the demand set must not restart every slice's turn at zero.
  const tick = useRef(0)

  return useQuery<SnapshotLinks>({
    queryKey: ['v2', 'snapshot-links', key],
    enabled: enabled && sorted.length > 0 && state === 'connected',
    // Paired on purpose — the global 5 s staleTime default would otherwise make
    // every remount refetch out of band. See `reconcile.ts`.
    staleTime: SNAPSHOT_LINKS_POLL_MS,
    refetchInterval: SNAPSHOT_LINKS_POLL_MS,
    // Keep the previous links visible while a new set is minted; without it a
    // target set that changes (a tile scrolls in) blanks every tile for a round
    // trip, and the server's answer can take the full mint deadline on a cold
    // fleet.
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<SnapshotLinks> => {
      const system = controller.getSystem()
      if (!system) return UNSUPPORTED
      const named = planSnapshotLinkPoll({
        targets: sorted,
        keys: key,
        minted: skippableKeys(),
        tick: tick.current,
      })
      tick.current += 1
      // Every target is minted and none has its turn: nothing to ask. An empty
      // answer carries every accepted row forward unchanged.
      if (named.length === 0) return { supported: true, byTarget: {} }
      const startedAt = Date.now()
      try {
        const result = await fetchSnapshotLinks(
          system.trpcClient as unknown as Record<string, unknown>,
          named,
        )
        const ms = Date.now() - startedAt
        if (ms >= 1_000) {
          log.info('media:snapshot', 'snapshot links slow', {
            ms,
            targets: named.length,
            demanded: sorted.length,
            returned: Object.keys(result.byTarget).length,
          })
        }
        return result
      } catch (error) {
        log.warn('media:snapshot', 'snapshot links failed', {
          ms: Date.now() - startedAt,
          targets: named.length,
          demanded: sorted.length,
          error: String(error),
        })
        throw error
      }
    },
  })
}
