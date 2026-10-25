/**
 * SnapshotOverviewProvider — one metadata poll for every snapshot in the app.
 *
 * Mounted ONCE, in the authenticated app layout, over the full camera list. That
 * placement is deliberate: snapshots are rendered in at least seven places
 * (cards, the paused grid wall, the grid list's preview strip, the detail
 * poster, the live-view poster, the zone-drawing overlay, the web grid builder)
 * and they sit in different route subtrees. A per-screen provider would leave
 * whichever surface forgot to mount one with a permanently stable URL — and
 * since `expo-image` never revalidates, "stable URL with no version" means a
 * thumbnail frozen until the disk cache evicts it.
 *
 * The overview poll itself is a 5 min reconcile (`SNAPSHOT_OVERVIEW_POLL_MS`).
 * Capture demand is a different call: `getSnapshotLinks` every 5 s, scoped to
 * surfaces that registered via {@link useSnapshotLink} — and each tick names a
 * SLICE of them (`snapshot-link-slices.ts`), so thirty tiles are not thirty
 * captures in one second. A surface rendered
 * OUTSIDE the provider (a test, a standalone embed) reads `supported: false`
 * and falls back to the stable-URL behaviour, which is the same answer an
 * older hub gives — one fallback path, not two.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { log } from '../lib/logger.js'
import { snapshotViewport } from './snapshot-viewport.js'
import { useSnapshotOverview, type SnapshotOverviewRow } from './use-snapshot-overview.js'
import {
  keepNewestSnapshotLinks,
  skippableSnapshotLinkKeys,
  snapshotLinkTargetKey,
  useSnapshotLinks,
  type SnapshotLinkRow,
  type SnapshotLinkTarget,
} from './use-snapshot-links.js'

/**
 * What one surface needs to know about a device's cached frame.
 *
 * A discriminated union rather than a nullable row plus a flag: "we have an
 * answer" and "there is a frame" are different facts, and a caller that
 * conflates them renders a 404 tile for a camera that simply has not been
 * captured yet.
 */
export type SnapshotVersionSlice =
  /** The hub answered, and this device has a cached frame. */
  | { readonly known: true; readonly lastCapturedAt: number; readonly etag: string | null }
  /** The hub answered, and this device has NEVER produced a frame → render an
   *  empty state, do not request an image that will 404. */
  | { readonly known: true; readonly lastCapturedAt: null; readonly etag: null }
  /** No answer (old hub, outside the provider, still loading). */
  | { readonly known: false; readonly lastCapturedAt: null; readonly etag: null }

const UNKNOWN: SnapshotVersionSlice = Object.freeze({
  known: false,
  lastCapturedAt: null,
  etag: null,
})

const NEVER_CAPTURED: SnapshotVersionSlice = Object.freeze({
  known: true,
  lastCapturedAt: null,
  etag: null,
})

interface OverviewContextValue {
  readonly supported: boolean
  readonly byId: Readonly<Record<number, SnapshotOverviewRow>>
  /** Minted links, keyed by device. Empty on an older hub. */
  readonly linksSupported: boolean
  /** False until the first links capability answer settles. */
  readonly linksReady: boolean
  readonly linksByTarget: Readonly<Record<string, SnapshotLinkRow>>
  /**
   * Register a tile that is on screen right now, at the width it is painted at.
   * Returns the unregister function.
   *
   * This is what keeps `getSnapshotLinks` scoped. The server creates a keep-warm
   * subscription per target, and warming costs one capture per camera per tick —
   * so asking about the whole install would be the fleet-wide blind poll D93
   * exists to avoid. Only a MOUNTED surface registers, and the set shrinks again
   * when it unmounts.
   */
  readonly registerDemand: (deviceId: number, width: number | undefined) => () => void
}

const OverviewContext = createContext<OverviewContextValue | null>(null)

/** Stable key for one (device, width) demand. */
function demandKey(deviceId: number, width: number | undefined): string {
  return `${String(deviceId)}:${width === undefined ? 'full' : String(width)}`
}

export interface SnapshotOverviewProviderProps {
  readonly deviceIds: readonly number[]
  /** Gate the poll — app awake and connected. */
  readonly enabled: boolean
  /** Optional so a spec can hand children to `createElement` as arguments,
   *  which is what `react/no-children-prop` asks for. */
  readonly children?: React.ReactNode
}

export function SnapshotOverviewProvider({
  deviceIds,
  enabled,
  children,
}: SnapshotOverviewProviderProps): React.JSX.Element {
  const { data } = useSnapshotOverview(deviceIds, enabled)

  // ── Demand registry ────────────────────────────────────────────────────
  //
  // Refcounted per (device, width): several tiles can render the same camera at
  // the same width (a card and a grid tile), and the last one to unmount is the
  // one that should drop the demand. A plain Set would have the first unmount
  // silently unwatch a camera still on screen.
  const demand = useRef(new Map<string, { count: number; target: SnapshotLinkTarget }>())
  const [demandKeys, setDemandKeys] = useState<readonly string[]>([])

  const publish = useCallback(() => {
    const next = [...demand.current.keys()].sort()
    // Compare before setting: a mount storm would otherwise re-render the whole
    // tree once per tile, and re-key the query each time.
    setDemandKeys((prev) =>
      prev.length === next.length && prev.every((k, i) => k === next[i]) ? prev : next,
    )
  }, [])

  const registerDemand = useCallback(
    (deviceId: number, width: number | undefined): (() => void) => {
      const key = demandKey(deviceId, width)
      const existing = demand.current.get(key)
      if (existing) existing.count += 1
      else demand.current.set(key, { count: 1, target: { deviceId, width } })
      publish()
      let released = false
      return () => {
        if (released) return
        released = true
        const entry = demand.current.get(key)
        if (!entry) return
        entry.count -= 1
        if (entry.count <= 0) demand.current.delete(key)
        publish()
      }
    },
    [publish],
  )

  // ── Viewport gate ──────────────────────────────────────────────────────
  //
  // Mounted is not on screen (a FlatList realises cells past the fold; Expo
  // keeps every tab mounted), and after D108 a named target is not a question
  // but a standing instruction to capture — one camera hit every five seconds,
  // for as long as it is named. `snapshot-viewport.ts` holds the rule and the
  // reason it is subtractive; here we only apply it.
  //
  // Subscribed rather than read once: a scroll changes what is demandable
  // without changing what is mounted, so nothing else would re-render.
  const viewportVersion = useSyncExternalStore(
    snapshotViewport.subscribe,
    () => snapshotViewport.version,
    () => snapshotViewport.version,
  )

  const targets = useMemo<readonly SnapshotLinkTarget[]>(() => {
    void viewportVersion
    return demandKeys
      .map((k) => demand.current.get(k)?.target)
      .filter((t): t is SnapshotLinkTarget => t !== undefined)
      .filter((t) => snapshotViewport.isDemandable(t.deviceId))
  }, [demandKeys, viewportVersion])

  const [acceptedLinks, setAcceptedLinks] = useState<Readonly<Record<string, SnapshotLinkRow>>>({})
  // What the poll may leave for its turn (`snapshot-link-slices.ts`): a row
  // that is usable AND makes no state claim. Read through a ref at call time —
  // the queryFn is created once per key and must see the rows accepted by the
  // ticks before it, not the ones captured when the key was minted. Mirrored
  // from an effect, not during render: a poll fires from a timer, never from
  // the render that accepted the previous answer, so the effect is always
  // ahead of it.
  const acceptedRef = useRef(acceptedLinks)
  useEffect(() => {
    acceptedRef.current = acceptedLinks
  }, [acceptedLinks])
  const skippableKeys = useCallback(
    (): ReadonlySet<string> => skippableSnapshotLinkKeys(acceptedRef.current, Date.now()),
    [],
  )
  const { data: links, dataUpdatedAt: linksUpdatedAt } = useSnapshotLinks(
    targets,
    enabled,
    skippableKeys,
  )
  const [processedLinks, setProcessedLinks] = useState(links)
  if (processedLinks !== links) {
    setProcessedLinks(links)
    if (links?.supported !== true && Object.keys(acceptedLinks).length > 0) {
      // The trail for "every tile dropped its link at once" — the poll
      // regressed to unsupported (older-hub answer shape, or a parse-level
      // surprise) and every accepted link goes with it.
      log.warn('media:snapshot', 'snapshot links wiped (poll answered unsupported)', {
        dropped: Object.keys(acceptedLinks).length,
      })
    }
    setAcceptedLinks(
      links?.supported === true
        ? keepNewestSnapshotLinks(acceptedLinks, links.byTarget, linksUpdatedAt)
        : {},
    )
  }

  const value = useMemo<OverviewContextValue>(
    () => ({
      supported: data?.supported === true,
      byId: data?.byId ?? {},
      linksReady: links !== undefined,
      linksSupported: links?.supported === true,
      linksByTarget: acceptedLinks,
      registerDemand,
    }),
    [data, links, acceptedLinks, registerDemand],
  )
  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>
}

/**
 * Declare that this surface is painting `deviceId` at `width`, for as long as it
 * is mounted, and read back what the hub minted for it.
 *
 * A surface rendered OUTSIDE the provider registers nothing and reads
 * `supported: false`, which degrades to the identity-versioned URL exactly as
 * before — one fallback path, not two.
 */
export interface SnapshotLinkSlice {
  readonly ready: boolean
  readonly supported: boolean
  readonly row: SnapshotLinkRow | null
}

export function useSnapshotLink(
  deviceId: number,
  width: number | undefined,
  enabled: boolean,
): SnapshotLinkSlice {
  const ctx = useContext(OverviewContext)
  const register = ctx?.registerDemand
  useEffect(() => {
    if (register === undefined || !enabled || deviceId <= 0) return
    return register(deviceId, width)
  }, [register, enabled, deviceId, width])
  if (ctx === null) return { ready: true, supported: false, row: null }
  return {
    ready: ctx.linksReady,
    supported: ctx.linksSupported,
    row: ctx.linksSupported
      ? (ctx.linksByTarget[snapshotLinkTargetKey({ deviceId, width })] ?? null)
      : null,
  }
}

/** This device's cached-frame identity from the app-wide overview. */
export function useSnapshotVersion(deviceId: number): SnapshotVersionSlice {
  const ctx = useContext(OverviewContext)
  return useMemo(() => {
    if (ctx === null || !ctx.supported) return UNKNOWN
    const row = ctx.byId[deviceId]
    if (row === undefined) return UNKNOWN
    if (row.lastCapturedAt === null) return NEVER_CAPTURED
    return { known: true, lastCapturedAt: row.lastCapturedAt, etag: row.etag }
  }, [ctx, deviceId])
}
