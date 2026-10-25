/**
 * live-viewers — the hosted wall's "who is watching" count.
 *
 * Mirrors the app's `data/use-live-viewers.ts` (the embed cannot import it): the
 * hub answers ONE call, `streamBroker.getLiveViewerCounts`, for every camera,
 * and every tile that placed the indicator reads its own number from the same
 * answer. So the poll is shared — a wall of twelve tiles is one request every
 * ten seconds, started by the first subscriber and stopped with the last.
 *
 * `null` is UNKNOWN (no answer yet, a hub without the method, a failed call) and
 * is never drawn as "nobody"; a camera missing from a successful answer is a
 * real zero.
 *
 * Pure parsing and a tiny external store — no React here (the hook is in
 * `components/TileIndicators.tsx`).
 */

export const LIVE_VIEWERS_POLL_MS = 10_000

export type LiveViewerCounts = Readonly<Record<number, number>>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** The hub's list as a per-camera record, or `null` when it is not a list. */
export function parseLiveViewerCounts(raw: unknown): LiveViewerCounts | null {
  if (!Array.isArray(raw)) return null
  const out: Record<number, number> = {}
  for (const row of raw) {
    if (!isRecord(row)) continue
    const { deviceId, viewers } = row
    if (typeof deviceId !== 'number' || !Number.isInteger(deviceId) || deviceId < 0) continue
    if (typeof viewers !== 'number' || !Number.isFinite(viewers) || viewers < 1) continue
    out[deviceId] = Math.floor(viewers)
  }
  return out
}

/** One camera's number from an answer (absent from a successful answer = 0). */
export function viewersFor(counts: LiveViewerCounts | null, deviceId: number): number | null {
  if (counts === null) return null
  return counts[deviceId] ?? 0
}

/** Call `streamBroker.getLiveViewerCounts.query()` on an untyped tRPC proxy. */
export async function queryLiveViewerCounts(client: unknown): Promise<LiveViewerCounts | null> {
  if (typeof client !== 'object' || client === null) return null
  const router: unknown = Reflect.get(client, 'streamBroker')
  if (typeof router !== 'object' || router === null) return null
  const method: unknown = Reflect.get(router, 'getLiveViewerCounts')
  if (typeof method !== 'object' || method === null) return null
  const query: unknown = Reflect.get(method, 'query')
  if (typeof query !== 'function') return null
  try {
    return parseLiveViewerCounts(await query.call(method))
  } catch {
    return null
  }
}

/** What a poller needs: how to ask, and a timer. Injected so it is testable. */
export interface LiveViewersPollerDeps {
  readonly fetchCounts: () => Promise<LiveViewerCounts | null>
  readonly setInterval: (fn: () => void, ms: number) => unknown
  readonly clearInterval: (handle: unknown) => void
}

/**
 * A reference-counted poll: `subscribe` starts it for the first listener and
 * the returned function stops it with the last. `getSnapshot` is stable between
 * answers (the same object), as `useSyncExternalStore` requires.
 */
export class LiveViewersPoller {
  private counts: LiveViewerCounts | null = null
  private readonly listeners = new Set<() => void>()
  private timer: unknown = null

  constructor(private readonly deps: LiveViewersPollerDeps) {}

  getSnapshot = (): LiveViewerCounts | null => this.counts

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  get isRunning(): boolean {
    return this.timer !== null
  }

  private start(): void {
    void this.tick()
    this.timer = this.deps.setInterval(() => void this.tick(), LIVE_VIEWERS_POLL_MS)
  }

  private stop(): void {
    if (this.timer !== null) this.deps.clearInterval(this.timer)
    this.timer = null
    // A stale number must not greet the next subscriber as if it were current.
    this.counts = null
  }

  private async tick(): Promise<void> {
    const next = await this.deps.fetchCounts()
    // Answered after the last listener left: nobody to tell, nothing to keep.
    if (this.listeners.size === 0) return
    this.counts = next
    for (const l of this.listeners) l()
  }
}
