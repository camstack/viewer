/**
 * Unified app logger (srcV2).
 *
 * One entry point — `log.debug/info/warn/error(scope, msg, data?)` — callable
 * from anywhere (React or not). Entries land in an in-memory ring buffer (the
 * Settings → Logs page reads it) and are batched-shipped to the connected server
 * (`/addon/stream-broker/clientlog`) so they can be debugged from the hub.
 *
 * Verbosity: `debug`-level entries are dropped unless DEBUG MODE is on
 * (`setLogVerbose(true)`, driven by `device-settings.debugMode`). `info`/`warn`/
 * `error` are always kept. Shipping: `warn`/`error` always, everything in debug
 * mode, plus `info` from the diagnostic scopes in `ALWAYS_SHIP_SCOPES` — see
 * the note there for what shipping nothing at `info` had been hiding.
 *
 * Embed bridge: the recording/grid WebView embeds emit `{type:'log'}` messages;
 * the native hosts forward them here as `log.debug('embed:…', …)`, so scrub/frame
 * diagnostics flow into the same buffer + server pipeline.
 */
import { create } from 'zustand'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  readonly id: number
  /** ms epoch */
  readonly ts: number
  readonly level: LogLevel
  readonly scope: string
  readonly msg: string
  readonly data?: unknown
}

const MAX_ENTRIES = 2000
const SHIP_INTERVAL_MS = 4000
const SHIP_MAX_BATCH = 200
const SHIP_REQUEUE_CAP = 400

/**
 * Scopes whose `info` lines ALWAYS ship, debug mode or not.
 *
 * ## What this fixes
 *
 * `emit` only queued a line for the hub when `verbose || warn || error`. Every
 * diagnostic scope this app has writes at `info` — so in normal operation NONE
 * of them left the device. `lifecycle-trace.ts` states in its own docblock
 * "These lines ship to the hub through the normal log pipeline, so a session on
 * a phone is readable from Loki afterwards"; that was not true, and the
 * cold-start timings in `LiveViewWebView` were equally invisible. The design
 * was written down and never wired, which reads as verification and is worse
 * than having no instrumentation at all.
 *
 * ## Why an allowlist rather than shipping all `info`
 *
 * `info` is also the level for ordinary chatter, and this pipe is a POST every
 * 4 s to a hub already measured at 70-95% main thread. These scopes are
 * low-rate and bounded — a handful of lines per launch and per connection
 * transition — and they are the only ones a latency question can be answered
 * from. Anything noisier belongs at `debug`, behind the debug-mode switch.
 */
const ALWAYS_SHIP_SCOPES: ReadonlySet<string> = new Set([
  'boot',
  'cold-query',
  'conn',
  'conn:lifecycle',
  // How the PREVIOUS runtime ended. `error` ships anyway; this entry is for the
  // one `info` line each launch writes, which is the line that says a crash
  // happened at all. The 2026-08-20 report arrived with debug mode OFF, so a
  // launch verdict gated on verbose would not have existed. See
  // `lib/crash-record.ts`.
  'crash',
  // The resume/reconnect reconcile decisions. Its own module states "every
  // outcome is logged, including the ones that do nothing" — and none of them
  // left the device, so the SECOND report of the same stale-camera-list symptom
  // (2026-08-19) arrived with no trail at all and had to be re-derived from the
  // code. A handful of lines per resume; low-rate and bounded, like the rest.
  'data:reconcile',
  // What the CLIP surface did, as three cumulative lines (`clip-telemetry.ts`):
  // one per burst of list asks, of stills and of playback resolutions, each
  // carrying the burst and the totals since launch. Always on, because the
  // report that needed them arrived with the surface silent — the scope spoke
  // on failure only, so "it ran and produced nothing" and "it never ran" were
  // the same absence of lines (2026-09-21). Bounded by construction: a burst
  // of 300 stills is still one line.
  'clips',
  'events:feed',
  'events:media',
  'live:cold-start',
  // Both halves of the system-PiP handoff: the page's answer to a request, and
  // every LATER presentation-mode change. The swipe-back handoff navigates on
  // that answer and unmounts the player, so a "the PiP window died" report is
  // unreadable without them — and the 2026-09-01 report arrived with debug
  // mode off, exactly like the crash and reconcile gaps above. A handful of
  // lines per gesture.
  'live:pip',
  // The player's teardown. Its whole purpose is to be readable NEXT TO
  // `live:pip`: system PiP is anchored to the WKWebView this line reports the
  // release of, so "did the unmount kill the window" is answered by the two
  // timestamps and by nothing else. One line per player.
  'live:lifecycle',
  'live:warmup',
  'media:snapshot',
  // Finger down → first scrub frame painted, one line per drag. The hub's drag
  // census stops at "on the wire" (`firstPushMs`); this is the only record of
  // the decode+paint leg, and a diagnostic gated on debug mode would not exist
  // in any report the operator actually files.
  'scrub:first-frame',
  // Recorded playback E2E: 5 s getStats census + land/play intent. Without
  // this allowlist the probe existed only behind debug mode, so a "playback
  // takes seconds / hiccups" report arrived with no client trail.
  // Every outcome of a `playClip` the host injected: arrived, sent to the
  // broker, or refused with the reason. Always on, because a clip that does
  // not play was reported with nothing at all between the tap and the silence
  // — and the app cannot even tell whether the command reached the embed it is
  // running, which may be the hub's copy rather than its own (2026-09-21).
  // A handful of lines per tap.
  'embed:clip:play',
  'embed:playback',
  // The client's half of the adaptive-tier join: the viewport and pixel ratio
  // this app measured, the downlink it managed to measure (and the origin it
  // probed — null means the probe had nowhere to go, which is how the native
  // WebView spent every session pinned to the sub-stream), and the live
  // profile it landed on. The hub logs its own pick from those same inputs, so
  // without this line a "quality always drops to low" report shows the hub
  // scoring hints and never shows whether the app sent any. One line per
  // decision CHANGE — not per offer, not per tick. See `live/embed-log-level.ts`,
  // which owns the other half of this pairing (the level the bridge forwards at).
  'embed:adaptive',
  // Cold-start phase breakdown, once per connect. `LiveViewWebView` has always
  // forwarded this at `info` and it has never been listed here, so it has never
  // shipped — the exact half-wired shape this allowlist exists to prevent, and
  // the reason `onConnectTiming`'s own docblock ("lets an embedding host ship
  // the numbers to its own logs instead of them dying in the in-WebView
  // console") was not true. One line per connect.
  'embed:webrtc-timing',
  // One line per timeline drag (the commit census: mapping mode counts,
  // velocities, span). Without this entry the line ships only in verbose and
  // the hub's per-drag `mapFine`/`mapCoarse` have no client counterpart —
  // exactly the "an info scope not in the allowlist is invisible" trap the
  // 2026-08-07 instrumentation spec warns about. One line per gesture,
  // low-rate and bounded like the rest.
  'theater:scrub',
  // The camera-detail layout decision — one line per TRANSITION (rotation,
  // Split View drag, rail appearing, measurement accepted/expired), carrying
  // the raw window, the device screen, both thresholds and the column width.
  // "In landscape la timeline va sotto" has been reported three times and
  // re-diagnosed twice from the code alone, because the geometry line next to
  // it is `debug` and the operator files with debug mode off — so the four
  // numbers that actually pick `stack` vs `wide` have never left a device. Same
  // bound as the entries above: quantised by physics, silent while the tablet
  // sits still. See `screens/camera-detail/layout-trace.ts`.
  'theater:layout',
  // The playback machine's own `commitScrub` line — the app-side half of the
  // dragId join (`scrub-drag-id.ts` / C1 in the 2026-08-26 scrub-debug plan).
  // The hub's `scrub-feeder:*`/`recorded:seek-*` lines carry the hub's clock;
  // this carries the phone's; a debug-gated line would leave no trail in any
  // report filed with debug mode off — the exact gap C1 exists to close. One
  // line per gesture commit, not per tick.
  'playback:machine',
])

/**
 * Scopes a full queue may NOT drop.
 *
 * The queue evicts oldest-first, and the crash verdict is emitted at module
 * scope — the earliest line of the launch — while `cold-query` alone writes
 * several hundred lines in the 30 s that follow, all before `ServerProvider`
 * has restored a token and started the ship timer. Plain oldest-first eviction
 * therefore deletes the launch verdict before anything is ever POSTed. That is
 * not hypothetical: it is why the 2026-08-20 logs show `serverRestored` /
 * `transportCreated` only INSIDE the aggregate `timeline` payload and never as
 * their own lines. A crash report that the crash's own log flood erases would
 * have reproduced the bug it exists to diagnose.
 */
const UNEVICTABLE_SCOPES: ReadonlySet<string> = new Set(['crash'])

/**
 * Bound the queue to `cap`, dropping the oldest — but never a line from an
 * unevictable scope, which is kept in place and costs an extra ordinary line.
 * Order is preserved: the hub reads these as a sequence.
 */
export function trimShipQueue(queue: readonly LogEntry[], cap: number): readonly LogEntry[] {
  if (queue.length <= cap) return queue
  const kept = new Set<number>()
  const protectedIds = queue.filter((e) => UNEVICTABLE_SCOPES.has(e.scope)).slice(-cap)
  for (const e of protectedIds) kept.add(e.id)
  const room = Math.max(0, cap - kept.size)
  for (const e of queue.filter((e) => !kept.has(e.id)).slice(-room)) kept.add(e.id)
  return queue.filter((e) => kept.has(e.id))
}

/** Whether an entry should be queued for the hub. */
export function shouldShip(level: LogLevel, scope: string, isVerbose: boolean): boolean {
  if (isVerbose) return true
  if (level === 'warn' || level === 'error') return true
  return level === 'info' && ALWAYS_SHIP_SCOPES.has(scope)
}

// ── Ring-buffer store (Settings → Logs reads this) ──────────────────────────

interface LogState {
  readonly entries: readonly LogEntry[]
  readonly clear: () => void
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  clear: () => set({ entries: [] }),
}))

function appendEntry(entry: LogEntry): void {
  useLogStore.setState((s) => {
    const base = s.entries.length >= MAX_ENTRIES ? s.entries.slice(s.entries.length - MAX_ENTRIES + 1) : s.entries.slice()
    base.push(entry)
    return { entries: base }
  })
}

// ── Verbosity ───────────────────────────────────────────────────────────────

let verbose = false
export function setLogVerbose(on: boolean): void {
  verbose = on
}
export function isLogVerbose(): boolean {
  return verbose
}

// ── Server shipping (batched, best-effort) ──────────────────────────────────

interface ShipConfig {
  readonly serverUrl: string
  readonly token: string
}
let shipConfig: ShipConfig | null = null
let shipQueue: LogEntry[] = []
let shipTimer: ReturnType<typeof setInterval> | null = null

/** Point the shipper at the connected server (call on connect; null on sign-out). */
export function configureLogShipping(cfg: ShipConfig | null): void {
  shipConfig = cfg
  if (cfg && shipTimer === null) {
    shipTimer = setInterval(() => {
      void flushShipQueue()
    }, SHIP_INTERVAL_MS)
  } else if (!cfg && shipTimer !== null) {
    clearInterval(shipTimer)
    shipTimer = null
  }
}

/**
 * Ship everything queued right now, instead of waiting up to `SHIP_INTERVAL_MS`.
 *
 * For the one caller that cannot wait: a fatal error. The batching interval is
 * correct for ordinary traffic and fatal for a crash — the lines describing the
 * death sat in this queue while the process was torn down, which is a large
 * part of why the 2026-08-20 restarts had no trail. See `lib/crash-reporter.ts`.
 */
export async function flushLogsNow(): Promise<void> {
  await flushShipQueue()
}

async function flushShipQueue(): Promise<void> {
  const cfg = shipConfig
  if (!cfg || shipQueue.length === 0) return
  const batch = shipQueue.slice(0, SHIP_MAX_BATCH)
  shipQueue = shipQueue.slice(batch.length)
  try {
    const base = cfg.serverUrl.replace(/\/+$/, '')
    // octet-stream so the hub's Fastify leaves the body unparsed and the
    // data-plane reverse-proxy can pipe it to the addon (see main.ts parser).
    await fetch(`${base}/addon/stream-broker/clientlog/`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ source: 'app', entries: batch }),
    })
  } catch {
    // Transient failure — requeue (bounded) so we don't lose recent logs.
    shipQueue = [...trimShipQueue(batch.concat(shipQueue), SHIP_REQUEUE_CAP)]
  }
}

// ── Emit ────────────────────────────────────────────────────────────────────

let idCounter = 0

/** Make `data` JSON-safe once, at capture time, so the store + shipper never
 *  throw on a circular / non-serialisable payload. */
function safeData(d: unknown): unknown {
  if (d === undefined) return undefined
  try {
    JSON.stringify(d)
    return d
  } catch {
    return String(d)
  }
}

function emit(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  if (level === 'debug' && !verbose) return
  const entry: LogEntry = { id: ++idCounter, ts: Date.now(), level, scope, msg, data: safeData(data) }
  appendEntry(entry)
  if (shouldShip(level, scope, verbose)) {
    shipQueue.push(entry)
    if (shipQueue.length > SHIP_REQUEUE_CAP) {
      shipQueue = [...trimShipQueue(shipQueue, SHIP_REQUEUE_CAP)]
    }
  }
}

export const log = {
  debug: (scope: string, msg: string, data?: unknown): void => emit('debug', scope, msg, data),
  info: (scope: string, msg: string, data?: unknown): void => emit('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown): void => emit('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: unknown): void => emit('error', scope, msg, data),
}

// ── Formatting helpers (Settings → Logs export) ─────────────────────────────

/** One-line text form of an entry (for the export action / copy). */
export function logEntryToLine(e: LogEntry): string {
  const t = new Date(e.ts).toISOString().slice(11, 23)
  const d = e.data !== undefined ? ' ' + safeJsonString(e.data) : ''
  return `${t} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${d}`
}

function safeJsonString(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
