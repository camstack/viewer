/**
 * events-track-list — WHAT the host is told about the ordered row collection,
 * and how little of it can be sent.
 *
 * The events embed hands the host the shown rows in display order so a detail
 * view can offer prev/next (`trackList`). Posting the WHOLE collection on every
 * change makes the Nth appended page cost O(N): at the 5 000-row ceiling the
 * last appends serialise ~1 MB each, and that message — not the ~4 MB of
 * retained rows — is what bounded `DEFAULT_EVENTS_MAX_ROWS`.
 *
 * ## Why a diff and not "send the tail"
 *
 * The feed is not append-only. `applyDelta` PREPENDS newer rows; a track whose
 * `lastSeen` advanced is REPLACED and moves to the head; a filter, a sort, a
 * day change or a reload REPLACE the collection outright. "Here are the new
 * ones, append" drifts the first time any of those happens, and the failure is
 * silent: the operator opens a card and the arrows walk a different event's
 * neighbours.
 *
 * So the embed never asserts a delta it cannot prove. {@link diffTrackList}
 * accepts one only when the new list is EXACTLY
 *
 *     prepend ++ held.filter(id ∉ removeIds) ++ append
 *
 * — verified id by id against the list actually on screen. Anything else (a
 * reorder, a sort flip, a new day) is a full `trackList`, which is
 * unconditional and re-establishes the sequence. There is no "probably fine"
 * branch.
 *
 * ## Detecting drift rather than assuming it away
 *
 * Every message carries `seq`; every delta also carries the `baseSeq` it
 * applies to and the `count` the host must end up with. A host that lost a
 * message sees `baseSeq !== held seq`; a host that misapplied one sees the
 * count disagree. Either way it DROPS the collection (no arrows) and asks for a
 * baseline — see `events-track-list-sync.ts` on the viewer side.
 *
 * ## An older host is untouched
 *
 * Delta mode is entered only on the host's explicit `setTrackListMode: 'delta'`
 * command, which is announced as the `track-list-delta` feature on `ready`. A
 * host that does not send it — every build shipped before this revision, on
 * either the OTA or the browser chain — keeps receiving exactly the full lists
 * it received before, at exactly the same moments.
 *
 * Pure: no window access, no React. Unit-tested.
 */
import {
  type EventsHostMessage,
  type TrackClickPayload,
  type TrackListMode,
  trackListDeltaMsg,
  trackListMsg,
} from './events-messages'

/**
 * Rough serialised size of one row of the message, in bytes:
 * `{"trackId":"…","deviceId":101,"bestEventId":"…","className":"person",
 * "firstSeen":1756742400000,"lastSeen":1756742460000}` measures ~200 on live
 * data. Used ONLY to pick the smaller of two correct messages — never for
 * correctness, so being off by a factor of two costs nothing.
 */
const ROW_BYTES = 200

/** Rough serialised size of one bare id in `removeIds`. */
const ID_BYTES = 45

/**
 * The change from one posted collection to the next.
 *
 * `reset` carries no rows: the caller already holds the new list and sends it
 * whole. Keeping the payload out of the union is what stops a `reset` from
 * being a second, silent way to describe a delta.
 */
export type TrackListChange =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'reset' }
  | {
      readonly kind: 'delta'
      readonly prepend: readonly TrackClickPayload[]
      readonly append: readonly TrackClickPayload[]
      readonly removeIds: readonly string[]
    }

/**
 * The six fields the protocol carries, and nothing else.
 *
 * `rows` are `EventsTrackRow`s with a dozen more fields (zone names, audio
 * labels, the classes array). They are structurally assignable to
 * {@link TrackClickPayload}, so serialising one directly would quietly put all
 * of them on the wire — which is the cost this module exists to remove.
 */
function toPayload(row: TrackClickPayload): TrackClickPayload {
  return {
    trackId: row.trackId,
    deviceId: row.deviceId,
    bestEventId: row.bestEventId,
    className: row.className,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  }
}

function idsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/**
 * What changed between the ids last SENT and the rows now shown.
 *
 * Keyed on `trackId` only — deliberately the same fidelity the full-list
 * protocol always had, which re-posted only when the ID SEQUENCE changed. A
 * row whose `lastSeen` advanced in place was never re-sent before this change
 * and is not re-sent now; the host upgrades an opened track through `getTrack`
 * anyway.
 *
 * Returns `reset` for anything it cannot prove, INCLUDING a delta that would
 * be no smaller than the full list (a filter that drops 4 900 of 5 000 rows
 * expresses as 4 900 `removeIds` — bigger than the 100 rows that survive).
 *
 * The result is always VERIFIED before it is returned: the alignment is a
 * greedy backwards walk, and the reconstruction the host will perform is
 * replayed here and compared id by id. A wrong delta is the one failure mode
 * with no visible symptom, so it is never returned on a heuristic's word.
 */
export function diffTrackList(
  prevIds: readonly string[],
  next: readonly TrackClickPayload[],
): TrackListChange {
  const nextIds = next.map((row) => row.trackId)
  if (idsEqual(prevIds, nextIds)) return { kind: 'unchanged' }
  // Nothing to build on: the first post of a collection is always the whole
  // thing, so the host has a baseline before any delta names one.
  if (prevIds.length === 0) return { kind: 'reset' }

  const prevSet = new Set(prevIds)
  let i = nextIds.length - 1
  let j = prevIds.length - 1

  // 1. The APPEND: trailing rows the host has never seen. A page loaded at the
  //    tail is made entirely of new tracks, which is what makes this exact
  //    rather than a guess.
  let appendFrom = nextIds.length
  while (i >= 0 && !prevSet.has(nextIds[i])) {
    appendFrom = i
    i -= 1
  }

  // 2. The MIDDLE: align backwards. A held id that is not where the new list
  //    wants it was either dropped (a filter, the age floor) or MOVED to the
  //    head — an active track whose `lastSeen` advanced. Both are a remove;
  //    the move gets its row back in the prepend below.
  const removeIds: string[] = []
  while (i >= 0 && j >= 0) {
    if (nextIds[i] === prevIds[j]) {
      i -= 1
      j -= 1
      continue
    }
    removeIds.push(prevIds[j])
    j -= 1
  }
  // 3. Whatever is left at the front of each list: new rows at the head, and
  //    held rows the new list does not contain at all.
  const prependTo = i + 1
  while (j >= 0) {
    removeIds.push(prevIds[j])
    j -= 1
  }

  // 4. The PROOF. The alignment above is greedy, so it is not trusted: the
  //    reconstruction the HOST will perform is run here and compared to the
  //    list actually on screen. A reorder no prepend/append can state fails
  //    this and becomes a full list — there is no "probably fine" branch.
  const removeSet = new Set(removeIds)
  const rebuilt = [
    ...nextIds.slice(0, prependTo),
    ...prevIds.filter((id) => !removeSet.has(id)),
    ...nextIds.slice(appendFrom),
  ]
  if (!idsEqual(rebuilt, nextIds)) return { kind: 'reset' }

  const rowCount = prependTo + (nextIds.length - appendFrom)
  const deltaBytes = ROW_BYTES * rowCount + ID_BYTES * removeIds.length
  if (deltaBytes >= ROW_BYTES * nextIds.length) return { kind: 'reset' }

  return {
    kind: 'delta',
    prepend: next.slice(0, prependTo).map(toPayload),
    append: appendFrom === nextIds.length ? [] : next.slice(appendFrom).map(toPayload),
    removeIds,
  }
}

/**
 * What the embed knows about the collection the host holds.
 *
 * `sentIds` is IDS, not rows: the payloads of a delta are sliced out of the
 * live `rows` array, so holding a second 5 000-row copy to diff against would
 * re-introduce the retention this change removes. The id strings are the same
 * instances the rows already hold — the array is 5 000 pointers, ~40 KB.
 *
 * `null` means nothing has been posted yet, which is distinct from "posted an
 * empty list": the first post is unconditional, exactly as before this change.
 */
export interface TrackListPublisher {
  readonly seq: number
  readonly sentIds: readonly string[] | null
  readonly mode: TrackListMode
}

export const INITIAL_TRACK_LIST_PUBLISHER: TrackListPublisher = {
  seq: 0,
  sentIds: null,
  mode: 'full',
}

/** A publisher step: the new state, and the message to post (if any). */
export interface TrackListPublication {
  readonly state: TrackListPublisher
  readonly message: EventsHostMessage | null
}

function fullPublication(
  state: TrackListPublisher,
  rows: readonly TrackClickPayload[],
  ids: readonly string[],
): TrackListPublication {
  const seq = state.seq + 1
  return {
    state: { seq, sentIds: ids, mode: state.mode },
    message: trackListMsg(rows.map(toPayload), seq),
  }
}

/**
 * Report the current collection, sending as little as the mode allows.
 *
 * In `full` mode this is byte-for-byte the pre-delta behaviour: post on the
 * first call, then only when the id sequence changes. In `delta` mode a change
 * the diff can prove goes out as a `trackListDelta`; anything else is a full
 * list, which also re-bases the sequence.
 */
export function publishTrackList(
  state: TrackListPublisher,
  rows: readonly TrackClickPayload[],
): TrackListPublication {
  const ids = rows.map((row) => row.trackId)
  if (state.sentIds === null) return fullPublication(state, rows, ids)
  if (state.mode === 'full') {
    if (idsEqual(state.sentIds, ids)) return { state, message: null }
    return fullPublication(state, rows, ids)
  }

  const change = diffTrackList(state.sentIds, rows)
  if (change.kind === 'unchanged') return { state, message: null }
  if (change.kind === 'reset') return fullPublication(state, rows, ids)

  const seq = state.seq + 1
  return {
    state: { seq, sentIds: ids, mode: state.mode },
    message: trackListDeltaMsg({
      seq,
      baseSeq: state.seq,
      prepend: change.prepend,
      append: change.append,
      removeIds: change.removeIds,
      count: ids.length,
    }),
  }
}

/**
 * Answer the host's `setTrackListMode` command: adopt the mode and post a fresh
 * full baseline at a new `seq`.
 *
 * The baseline is not an optimisation to skip — it is the whole point of the
 * command being idempotent. A host that detected drift re-sends the SAME
 * command and gets a list it can trust, so "recover from a lost delta" needs no
 * second verb and no state the two sides could disagree about.
 */
export function setTrackListMode(
  state: TrackListPublisher,
  mode: TrackListMode,
  rows: readonly TrackClickPayload[],
): TrackListPublication {
  const ids = rows.map((row) => row.trackId)
  return fullPublication({ ...state, mode }, rows, ids)
}

/**
 * The stateful face of the publisher: report the rows, answer the mode command,
 * and post whatever falls out.
 *
 * A closure rather than a `useRef` in the page. The page reports from an effect
 * (rows changed) and from a host command (`setTrackListMode`), neither of which
 * is render — but a ref written in EITHER place is a React Compiler violation
 * in that component, and the alternative (writing it during render, the shape
 * the file's older refs use) is the tear the rule is actually about. Closure
 * state is owned by nobody's render pass and is what a `useState` initialiser
 * is for.
 *
 * `post` is injected so this module stays pure and directly testable: a caller
 * can collect the messages instead of putting them on a bridge.
 */
export interface TrackListReporter {
  /** The collection changed (or the page re-derived it). */
  readonly report: (rows: readonly TrackClickPayload[]) => void
  /** The host asked for a mode — and, either way, for a fresh baseline. */
  readonly setMode: (mode: TrackListMode) => void
}

export function createTrackListReporter(
  post: (message: EventsHostMessage) => void,
): TrackListReporter {
  let publisher = INITIAL_TRACK_LIST_PUBLISHER
  // The rows a mode command must re-baseline against. The command carries no
  // rows of its own, and re-reading them from the feed would be a second source
  // of truth about what is on screen.
  let latest: readonly TrackClickPayload[] = []

  const emit = (published: TrackListPublication): void => {
    publisher = published.state
    if (published.message !== null) post(published.message)
  }

  return {
    report: (rows) => {
      latest = rows
      emit(publishTrackList(publisher, rows))
    },
    setMode: (mode) => {
      emit(setTrackListMode(publisher, mode, latest))
    },
  }
}
