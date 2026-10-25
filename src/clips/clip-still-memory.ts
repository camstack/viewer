/**
 * clip-still-memory — the stills this app is HOLDING, across tiles.
 *
 * ## Why there has to be one
 *
 * A clip still is minted ON DEMAND: the provider cuts a frame out of the
 * clip — on Amcrest out of the camera's own replay, which shares one session
 * budget with the live streams. Every provider queues its mints per camera,
 * and this app asks each camera for one still at a time
 * (`clip-still-lane.ts`). So asking twice for bytes we already have is not a
 * cheap round trip: it is a turn in that camera's queue, and on Amcrest a
 * camera session.
 *
 * `useClipStill` held its bytes in `useState`. The clips body mounts only a
 * band around the viewport (`timeline-window.ts`, 320 px of margin, re-selected
 * every 160 px), so an ordinary scroll unmounts tiles constantly, and every one
 * of those unmounts destroyed a still the app had already paid for. Scrolling
 * back re-asked for all of them at once. That is the operator's report:
 * *"le thumbnail non arrivano nonostante prima dovrebbe già averle
 * scaricate"* (D574).
 *
 * ## Why a module and not a query cache
 *
 * These bytes do not come from tRPC — the mint is a raw `fetch` against the
 * addon's own data plane, because a 204 with headers is the whole contract and
 * react-query has no opinion about it (D563, D573). A module-level map is the
 * smallest thing that outlives a mount. The IN-FLIGHT request is shared by
 * `clip-still-lane.ts`, which also keeps each camera to one request at a
 * time; this module holds only what came BACK — the bytes, and the stills
 * that failed.
 *
 * ## What bounds it
 *
 * Both of the things that can run away. 592 holds 357 clips of four hours and
 * a day is thousands, at 30-50 KB each (measured, D573) — so "keep everything"
 * is not an answer, and neither is a count alone, because a still is not a
 * fixed size. The map is an LRU on BOTH: entries and bytes, whichever bites
 * first. A recall counts as a use, so the tile the operator keeps returning to
 * is the last one dropped.
 *
 * Deliberately not persisted. The same bytes are on the hub's disk once minted
 * (the provider's `ClipArtifactStore` vouches a real JPEG with a stat and
 * serves it `immutable`), so the expensive thing to avoid is the MINT, not the
 * transfer, and a process restart is a fine moment to let go.
 *
 * Pure apart from the map: no React, no i18n, no network.
 */

import { forgetClipStillLanes } from './clip-still-lane.js'

/** How many stills may be held. ~2 pages of a 60-tile paint. */
export const CLIP_STILL_MEMORY_MAX_ENTRIES = 120

/** …and the ceiling that actually matters on a phone: 8 MB of JPEG. */
export const CLIP_STILL_MEMORY_MAX_BYTES = 8 * 1024 * 1024

export interface ClipStillMemorySize {
  readonly entries: number
  readonly bytes: number
}

/**
 * Insertion order IS the LRU order: a `Map` iterates in insertion order, and a
 * recall re-inserts. Nothing else is needed for a bound this small.
 */
const held = new Map<string, string>()
let heldBytes = 0

/** What a `data:` URI costs us, near enough: base64 is 4 chars per 3 bytes. */
function costOf(uri: string): number {
  return uri.length
}

/** The still for this mint URL, or null. A hit counts as a USE. */
export function recallClipStill(url: string): string | null {
  const uri = held.get(url)
  if (uri === undefined) return null
  held.delete(url)
  held.set(url, uri)
  return uri
}

/** Hold a still that really arrived. Only `served` bytes reach here — a
 *  deferral is not an answer and must never be remembered as one. */
export function rememberClipStill(url: string, uri: string): void {
  const previous = held.get(url)
  if (previous !== undefined) {
    held.delete(url)
    heldBytes -= costOf(previous)
  }
  held.set(url, uri)
  heldBytes += costOf(uri)
  evict()
}

function evict(): void {
  for (const [url, uri] of held) {
    if (held.size <= CLIP_STILL_MEMORY_MAX_ENTRIES && heldBytes <= CLIP_STILL_MEMORY_MAX_BYTES) {
      return
    }
    held.delete(url)
    heldBytes -= costOf(uri)
  }
}

export function clipStillMemorySize(): ClipStillMemorySize {
  return { entries: held.size, bytes: heldBytes }
}

/** Test seam, and the hook for a future memory-pressure handler. */
export function forgetClipStills(): void {
  held.clear()
  heldBytes = 0
  failed.clear()
  forgetClipStillLanes()
}

// ─── The stills that FAILED ───────────────────────────────────────────

/**
 * A still that will not come, by mint URL: a FINAL refusal only. A tile that
 * spent its ladder on deferrals is not here — "not now" is not "never", and
 * its next mount asks again. Remembered for the session, so a remount answers
 * from here instead of asking the camera again (2026-09-25, 3836: a remount
 * re-dialled every still that had just failed). Only the refusal's WORDS are
 * kept, never bytes; bounded by count.
 */
export interface ClipStillFailure {
  readonly code: string | null
  readonly reason: string
  /** The i18n key the tile showed, so a remount says the same thing. */
  readonly messageKey: string | null
}

/** Failed stills held at once. Words only, so a count is the bound. */
export const CLIP_STILL_FAILURE_MAX_ENTRIES = 500

const failed = new Map<string, ClipStillFailure>()

export function recallClipStillFailure(url: string): ClipStillFailure | null {
  return failed.get(url) ?? null
}

export function rememberClipStillFailure(url: string, failure: ClipStillFailure): void {
  failed.delete(url)
  failed.set(url, failure)
  for (const key of failed.keys()) {
    if (failed.size <= CLIP_STILL_FAILURE_MAX_ENTRIES) return
    failed.delete(key)
  }
}
