/**
 * What the clip surface DID, as three cumulative lines instead of hundreds.
 *
 * ## Why this exists
 *
 * The `clips` scope only ever spoke on failure. So when the operator reported
 * *"nessuna thumbnail, nessun progress"* on 2026-09-21, the hub's copy of his
 * session contained not one clip line — and silence is indistinguishable from
 * "the surface never ran", which is exactly the shape this repo's CLAUDE.md
 * forbids. The hub side was healthy in every check (list, 200 JPEG, mint,
 * 206 bytes), and there was no way to tell where between the two it stopped.
 *
 * ## Cumulative, and why not per item
 *
 * A camera's list is 300 rows and each row asks for a still, so one line per
 * item would flood the ingest and get itself rate-limited or turned off — the
 * fate of every log that answers a question nobody asked yet. Each area keeps
 * running TOTALS and flushes ONE line after a quiet moment, carrying both the
 * burst that just ended and the totals since launch. A burst is what an
 * operator reproduces; the totals are what a report needs.
 *
 * Every counter is a fact, never a derivation: `deferred` (the mint says "you
 * are in the queue") and `final` (it will never produce one) stay apart,
 * because folding them would make "still coming" and "never" one number again.
 */
import { log } from '../lib/logger.js'

/** How long the surface must be quiet before a burst is reported. */
export const CLIP_TELEMETRY_QUIET_MS = 1_500

/**
 * The telemetry NAME of a still's outcome — not `clip-still.ts`'s outcome type,
 * which carries the payload. `refused` is the provider saying it will not mint
 * one; it is kept apart from `deferred` (queued) and from `failed` (the request
 * itself broke), because collapsing them is how "still coming" and "never" stop
 * being different facts.
 */
export type ClipStillOutcomeName = 'served' | 'held' | 'deferred' | 'refused' | 'failed'

interface Tally {
  [key: string]: number
}

interface Area {
  readonly name: 'list' | 'stills' | 'playback' | 'gate'
  burst: Tally
  total: Tally
  timer: ReturnType<typeof setTimeout> | null
}

const AREAS: Readonly<Record<string, Area>> = {
  list: { name: 'list', burst: {}, total: {}, timer: null },
  stills: { name: 'stills', burst: {}, total: {}, timer: null },
  playback: { name: 'playback', burst: {}, total: {}, timer: null },
  gate: { name: 'gate', burst: {}, total: {}, timer: null },
}

function bump(tally: Tally, key: string, by = 1): void {
  tally[key] = (tally[key] ?? 0) + by
}

function schedule(area: Area, context: Readonly<Record<string, unknown>>): void {
  if (area.timer !== null) clearTimeout(area.timer)
  area.timer = setTimeout(() => {
    area.timer = null
    const burst = area.burst
    area.burst = {}
    log.info('clips', `${area.name} burst`, { ...context, burst, sinceLaunch: { ...area.total } })
  }, CLIP_TELEMETRY_QUIET_MS)
}

/** One settled `listClips` — rows, or the failure, per provider. */
export function noteClipList(input: {
  readonly deviceId: number
  readonly provider: string
  readonly rows: number | null
  readonly ms: number
}): void {
  const area = AREAS.list
  if (area === undefined) return
  const failed = input.rows === null
  for (const t of [area.burst, area.total]) {
    bump(t, 'asks')
    bump(t, failed ? 'failed' : 'answered')
    if (!failed) bump(t, 'rows', input.rows ?? 0)
    bump(t, 'ms', Math.round(input.ms))
  }
  schedule(area, { deviceId: input.deviceId, provider: input.provider })
}

/** One still, however it ended — including the ones nobody asked the network for. */
export function noteClipStill(input: {
  readonly outcome: ClipStillOutcomeName
  readonly ms: number
}): void {
  const area = AREAS.stills
  if (area === undefined) return
  for (const t of [area.burst, area.total]) {
    bump(t, 'asks')
    bump(t, input.outcome)
    bump(t, 'ms', Math.round(input.ms))
  }
  schedule(area, {})
}

/** One clip's playback resolution — the mint, not the frames. */
export function noteClipPlayback(input: {
  readonly deviceId: number
  readonly ok: boolean
  readonly served: string | null
  readonly ms: number
}): void {
  const area = AREAS.playback
  if (area === undefined) return
  for (const t of [area.burst, area.total]) {
    bump(t, 'asks')
    bump(t, input.ok ? 'resolved' : 'failed')
    if (input.served !== null) bump(t, `served:${input.served}`)
    bump(t, 'ms', Math.round(input.ms))
  }
  schedule(area, { deviceId: input.deviceId })
}

/**
 * One timeline input refused because a clip holds the frame.
 *
 * Counted rather than logged: a drag emits `scrubTo` tens of times a second,
 * and the first session that logged each one spent 260 of its 454 entries on
 * this single line. The COUNT answers the same question — "did the gate fire,
 * and on what" — in one line per burst.
 */
export function noteTimelineInputIgnored(what: string): void {
  const area = AREAS.gate
  if (area === undefined) return
  for (const t of [area.burst, area.total]) {
    bump(t, 'ignored')
    bump(t, what)
  }
  schedule(area, {})
}

/**
 * One STEP of opening a clip in the camera's frame.
 *
 * Not bursted, unlike everything else here: a tap is rare, the chain is five
 * hops long, and at least two of them are optional calls that vanish in
 * silence when the thing they point at is absent. The operator tapped clips
 * for three rounds and the hub saw nothing at all between the tap and the
 * silence — including, in the end, no `playClip` reaching the embed.
 */
export function noteClipOpenStep(step: string, data: Readonly<Record<string, unknown>>): void {
  log.info('clips', `open: ${step}`, data)
}

/** Test seam: drop every pending flush and every count. */
export function resetClipTelemetry(): void {
  for (const area of Object.values(AREAS)) {
    if (area.timer !== null) clearTimeout(area.timer)
    area.timer = null
    area.burst = {}
    area.total = {}
  }
}
