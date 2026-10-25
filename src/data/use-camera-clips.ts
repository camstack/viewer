/**
 * use-camera-clips — the app's ONE read of `videoclips`, for ONE source.
 *
 * ## Why this hook exists again, when its predecessor was deleted
 *
 * `use-clips.ts` fed `TimelineClipsPanel`, and it was deleted with it: the
 * panel clustered the HUB's event log into visits while the timeline clustered
 * `listTracks` client-side, so one camera had two card sets and the operator
 * saw both. Reading the cap again would re-open that — unless the two
 * derivations can never be on screen together.
 *
 * They cannot. The operator settled it on 2026-09-20:
 *
 * > *"La sorgente deve essere selezionata lato viewer dall'utente nelle settings
 * > generali della camera come provider di quella camera. Mai mischiate provider
 * > diversi."*
 *
 * One camera, one source, chosen in that camera's settings. When the source is
 * CamStack the clips are the derived ones and this hook asks nothing at all;
 * when it is the camera's own storage the clips are these rows and the derived
 * list is not built. There is never a second answer to disagree with the first
 * (D569).
 *
 * ## What it answers with
 *
 * `listSources` and `listClips` under one hook, so the clips-mode axis and any
 * later download list render ONE derivation — D558's *"do not write a second
 * lister"*, applied to this app. Two listers would first disagree on
 * `index-empty` (618) or `no-storage` (640), which are exactly the states this
 * line of work exists to stop rendering as "no clips".
 *
 * Two deliberate absences:
 *
 * - **No `getClipPlayback`.** It mints an entry in a bounded per-device scratch
 *   (10 files / 200 MB LRU); one per card would evict the first card's file on
 *   the eleventh. The address is resolved on the TAP.
 * - **No merge.** `clips` is whatever the chosen source answered, and the
 *   caller reads `derivation` to know whether to build the derived list
 *   instead.
 */
import { useMemo, useRef } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capQuery } from './cap-query.js'
import { parseClips } from '../clips/clip-mapping.js'
import { noteClipList } from '../clips/clip-telemetry.js'
import {
  parseClipSources,
  resolveClipProvider,
  type ClipProviderChoice,
  type ClipSourceRow,
} from '../clips/clip-sources.js'
import type { Clip } from '../clips/clip-model.js'

/** Query-key root for everything this hook reads. */
/** Stable empty list. See the `clips:` field below — an inline `[]` in a memo
 *  that recomputes every render is a new array every render. */
const EMPTY_CLIPS: readonly Clip[] = []

export const CAMERA_CLIPS_KEY = 'camera-clips'

/** The key for one camera's source list. */
export function clipSourcesKey(deviceId: number): readonly unknown[] {
  return ['v2', CAMERA_CLIPS_KEY, 'sources', deviceId]
}

/**
 * Whether two clip-list keys describe the SAME list read over a different
 * window — the one case in which the rows already on screen may stand while a
 * new read is in flight (D574).
 *
 * The camera and the provider must both match. A window that widens is the
 * back-scroll asking for more of the same list; a PROVIDER that changes is the
 * operator picking a different source, and painting one source's files under
 * another source's name is the two-derivations defect D569 exists to forbid,
 * one frame at a time.
 */
export function sameClipScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  // ['v2', root, 'list', deviceId, providerAddonId, sinceMs, untilMs]
  return a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4]
}

/** The key for one camera's clips, for one provider, over one window. */
export function clipListKey(
  deviceId: number,
  providerAddonId: string,
  sinceMs: number,
  untilMs: number,
): readonly unknown[] {
  return ['v2', CAMERA_CLIPS_KEY, 'list', deviceId, providerAddonId, sinceMs, untilMs]
}

/**
 * How stale a source list may be.
 *
 * A source appears or disappears when a configuration ELSEWHERE changes — a
 * card is fitted, a camera is exported to HomeKit, a provider is bound. That is
 * a human-paced event, and `listSources` MEASURES its states against the camera
 * (D561), so polling it hard is asking a sleeping battery camera the same
 * question every minute.
 */
const SOURCES_STALE_MS = 60_000

/**
 * How stale a clip list may be.
 *
 * Shorter, because a camera writes a new file while the operator is looking at
 * the list — but never shorter than the provider's own catalog refresh, which
 * this cannot outrun: every row carries `catalogAsOf` and is never fresher.
 */
const CLIPS_STALE_MS = 30_000

/** What one camera's clip surface knows. */
export interface CameraClipsView {
  /** Every source the camera HAS, with its state — whichever is being read. */
  readonly sources: readonly ClipSourceRow[]
  /** Which one is being read, and how. */
  readonly choice: ClipProviderChoice
  /** The rows of the chosen source. Empty while `derivation` is `derived` —
   *  those clips are the timeline's own and are not this hook's to produce. */
  readonly clips: readonly Clip[]
  /** A read is in flight (either of them). */
  readonly loading: boolean
  /** A read rejected. */
  readonly failed: boolean
  /**
   * THIS window's read has come back — with rows or with none.
   *
   * Not `clips.length === 0`, and the distinction is the whole point: an empty
   * list means "nothing happened in this window" only once something has
   * answered for it. Before that it means "nobody has looked yet", and the two
   * render identically unless somebody asks. The operator opened a camera on a
   * quiet day, saw "Nessuna clip per questa telecamera" and had to scroll by
   * hand to discover 21 clips one day back (2026-09-22).
   *
   * False while a PLACEHOLDER is showing: `placeholderData` keeps the previous
   * window's rows on screen across a window change, so `isSuccess` alone would
   * claim the new window had answered with the old window's list.
   *
   * Always false when there is no cap source to ask — there is nothing that
   * could answer, which is a different thing again.
   */
  readonly answered: boolean
  readonly refetch: () => void
}

export interface UseCameraClipsInput {
  readonly deviceId: number
  /** The window the surface is showing. */
  readonly sinceMs: number
  readonly untilMs: number
  /** The per-camera stored pick (a SOURCE id), from `camera-prefs-store`. */
  readonly chosenSourceId?: string
  /** Off entirely while the clip surface is not on screen. */
  readonly enabled: boolean
}

/**
 * Just the camera's sources — for the picker, which needs the rows and not a
 * single clip.
 *
 * Shares `useClipSources`' query key with {@link useCameraClips}, so opening
 * the menu over an open clips list costs no second read, and picking a source
 * there is answered by a cache the list already filled.
 */
export function useClipSourceRows(deviceId: number): readonly ClipSourceRow[] {
  return useClipSources(deviceId, true).data ?? NO_SOURCES
}

/** Stable empty list. A fresh `[]` every render remints `choice` and with it
 *  every memo downstream of it — the same reason the timeline keeps
 *  `EMPTY_TRACKS` around. */
const NO_SOURCES: readonly ClipSourceRow[] = []

function useClipSources(deviceId: number, enabled: boolean): UseQueryResult<readonly ClipSourceRow[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly ClipSourceRow[]>({
    queryKey: clipSourcesKey(deviceId),
    enabled: enabled && Number.isFinite(deviceId) && state === 'connected',
    staleTime: SOURCES_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'videoclips',
        'listSources',
        { deviceId },
        // A hub with no `videoclips` cap answers null, and that is a real
        // answer: the camera has no sources and the surface keeps its derived
        // list. Everything else is a failure and must reach the fault band.
        { rethrow: true, deadlineMs: BULK_QUERY_DEADLINE_MS },
      )
      return parseClipSources(raw)
    },
  })
}

/**
 * One camera's clips, from the one source the operator chose for it.
 *
 * `enabled: false` (the clip surface is closed) costs nothing: neither query
 * runs, and a picker draw never wakes a standalone battery camera by itself —
 * the wake gate is the provider's (D561 defect 3), but the cheapest gate is not
 * asking.
 */
export function useCameraClips(input: UseCameraClipsInput): CameraClipsView {
  const { deviceId, sinceMs, untilMs, chosenSourceId, enabled } = input
  const { controller, state } = useConnection()

  const sourcesQuery = useClipSources(deviceId, enabled)
  const sources = sourcesQuery.data ?? NO_SOURCES

  const choice = useMemo(
    () => resolveClipProvider({ chosen: chosenSourceId, sources }),
    [chosenSourceId, sources],
  )

  const askCap = enabled && choice.derivation === 'cap' && choice.addonId !== null
  const providerAddonId = choice.addonId ?? ''

  const clipsQuery = useQuery<readonly Clip[]>({
    queryKey: clipListKey(deviceId, providerAddonId, sinceMs, untilMs),
    enabled: askCap && state === 'connected' && Number.isFinite(sinceMs) && Number.isFinite(untilMs),
    staleTime: CLIPS_STALE_MS,
    // The rows the operator is reading STAND while a wider window loads.
    //
    // `clips-status.ts` has always documented `clipCount` as including "a
    // previous window's rows, which the hook deliberately keeps while a wider
    // one loads". It did not: a widened window is a new key, a new key has no
    // data, and the body emptied — which said `loading` over a list that was
    // on screen a moment earlier AND put the scroll offset back at the oldest
    // end, where the back-scroll walk asked for another day. Half of D574.
    //
    // Scoped, not blanket: only a different WINDOW on the same camera and the
    // same provider may keep rows. A provider change must blank, or one
    // source's files paint under another source's name.
    placeholderData: (previous: readonly Clip[] | undefined, previousQuery) => {
      if (previous === undefined || previousQuery === undefined) return undefined
      return sameClipScope(previousQuery.queryKey, clipListKey(deviceId, providerAddonId, sinceMs, untilMs))
        ? previous
        : undefined
    },
    queryFn: async () => {
      const askedAt = Date.now()
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // The failure is RECORDED and then re-thrown untouched: the fault band
      // still owns it (the rethrow above is load-bearing), and the counters
      // must not show a quiet surface when every ask died.
      let raw: unknown
      try {
        raw = await capQuery(
          system.trpcClient as unknown as Record<string, unknown>,
          'videoclips',
          'listClips',
          {
            deviceId,
            since: sinceMs,
            until: untilMs,
            // ALWAYS named. See the header, and `clip-sources.ts`.
            provider: providerAddonId,
          },
          { rethrow: true, deadlineMs: BULK_QUERY_DEADLINE_MS },
        )
      } catch (err) {
        noteClipList({ deviceId, provider: providerAddonId, rows: null, ms: Date.now() - askedAt })
        throw err
      }
      const rows = parseClips(raw, deviceId)
      // Counted, never one line per row: see `clip-telemetry.ts`. An answer
      // with zero rows is an ANSWER and is recorded as one.
      noteClipList({ deviceId, provider: providerAddonId, rows: rows.length, ms: Date.now() - askedAt })
      return rows
    },
  })

  // The rows the operator can SEE are never taken away while we are still
  // fetching. *"mai nascondere la lista corrente quando abbiamo dati da
  // caricare"* — the operator's rule, and it has to be a latch rather than
  // `placeholderData` alone, because a placeholder only reaches a new KEY on
  // the same observer. It does nothing for the other way the body emptied:
  // `askCap` going false short-circuits to the empty constant before the query
  // is consulted at all, so any upstream flicker — the source list refetching,
  // the provider preference rehydrating, the surface toggling — blanked a list
  // that was on screen, and the blank read as `loading`.
  //
  // Scoped to (camera, provider) and to nothing else: a held list from another
  // SOURCE painting under this one's name is the two-derivations defect D569
  // forbids, one frame at a time. And what is held is whatever the query last
  // SETTLED with, an empty answer included — holding only non-empty lists
  // would make a camera that really has no clips keep showing yesterday's.
  const heldScope = `${String(deviceId)}|${providerAddonId}`
  const heldRef = useRef<{ readonly scope: string; readonly rows: readonly Clip[] } | null>(null)
  const answered = askCap ? clipsQuery.data : undefined
  if (answered !== undefined) heldRef.current = { scope: heldScope, rows: answered }
  const held = heldRef.current
  const shownClips =
    answered ?? (held !== null && held.scope === heldScope ? held.rows : EMPTY_CLIPS)

  return useMemo(
    () => ({
      sources,
      choice,
      // NEVER a fresh `[]`. This memo's deps include the react-query RESULT
      // objects, whose identity changes on every render, so it recomputes every
      // render — and an inline literal here handed every consumer a new array
      // each time. `derivedClips` lists this as a dependency, so it recomputed,
      // and the list the timeline publishes up to the frame changed identity on
      // every render: a setState loop that starved the JS thread on device 3629
      // ("Camera porta retro" — a sleeping battery camera whose clip query
      // had not answered). See `clips/clip-list-identity.ts`.
      clips: shownClips,
      // A body with rows in it is not loading, whatever any query thinks. The
      // status line turns `loading` into an overlay ON TOP of the list, and an
      // overlay over rows the operator is reading is the hiding the rule above
      // forbids.
      loading:
        shownClips.length > 0
          ? false
          : sourcesQuery.isLoading || (askCap && clipsQuery.isLoading),
      failed: sourcesQuery.isError || (askCap && clipsQuery.isError),
      // See `CameraClipsView.answered`. `isPlaceholderData` is the half that
      // matters: without it a window that has not been read yet reports the
      // PREVIOUS window's answer as its own.
      answered: askCap && clipsQuery.isSuccess && clipsQuery.isPlaceholderData !== true,
      refetch: () => {
        void sourcesQuery.refetch()
        if (askCap) void clipsQuery.refetch()
      },
    }),
    [sources, choice, askCap, clipsQuery, sourcesQuery, shownClips],
  )
}
