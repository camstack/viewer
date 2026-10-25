/**
 * TileIndicators — the per-camera indicators a hosted grid tile draws.
 *
 * The wall's per-cell menu (the app's own view-options surface, hosted natively
 * over this WebView) offers each camera its motion regions, motion pill, audio
 * meter, occupancy chips and stream read-out. A menu may only offer what
 * something DRAWS, and on iOS/web the thing that draws a tile is this bundle —
 * so here they are. The pure half (parsing, placement, the level ladder) is
 * `embed/tile-overlays`; this file is the thin React shell over it.
 *
 * ## Cost
 *
 * Each component is mounted by the tile ONLY when that camera placed it, and
 * each opens exactly one subscription while mounted. A wall where nobody placed
 * an indicator opens nothing at all; a wall where one camera has the audio
 * meter opens one audio subscription, not N. Occupancy seeds once from
 * `getCurrentSnapshot` and then follows `occupancy-changed`.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveEvent } from '@camstack/ui-library'
import type { System } from '@camstack/sdk'
import { EventCategory } from '@camstack/types/enums'
import type { PipelineAudioInferenceResultPayload } from '@camstack/types'
import {
  audioLevelColor,
  anchorStyle,
  dbfsToLevel,
  framesPerSecond,
  meterOrientation,
  meterRenderOrder,
  meterSegmentSize,
  parseMotionRegions,
  parseOccupancyCounts,
  regionAlpha,
  statsLine,
  type OverlayAnchor,
  type TileMotionRegion,
  type TileOccupancyCount,
  type TilePlaybackStats,
} from '../embed/tile-overlays'
import { ov } from '../embed/overlay-size'
import {
  LiveViewersPoller,
  queryLiveViewerCounts,
  viewersFor,
} from '../embed/live-viewers'

/** Milliseconds a region set survives without a fresh analysis frame — the
 *  overlay empties instead of freezing on the last shape. */
const REGIONS_FADE_MS = 1200
/** Motion pill linger after the falling edge (the wall's tiles are scanned, not
 *  stared at; a pill that blinks off instantly is a pill nobody sees). */
const MOTION_BADGE_HOLD_MS = 3000
/** Stats sample cadence — one playback-quality read per second. */
const STATS_POLL_MS = 1000

// ── Motion regions ───────────────────────────────────────────────────────────

export function TileMotionRegionsOverlay({ deviceId }: { readonly deviceId: number }) {
  const [regions, setRegions] = useState<readonly TileMotionRegion[]>([])
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLiveEvent<Record<string, unknown>>(EventCategory.MotionAnalysis, (evt) => {
    const p = evt.data
    if (!p || p.deviceId !== deviceId) return
    setRegions(parseMotionRegions(p))
    if (fade.current) clearTimeout(fade.current)
    fade.current = setTimeout(() => setRegions([]), REGIONS_FADE_MS)
  })

  useEffect(
    () => () => {
      if (fade.current) clearTimeout(fade.current)
    },
    [deviceId],
  )

  if (regions.length === 0) return null
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {regions.map((r, i) => (
        <div
          // A region has no identity to track across frames; its geometry is
          // the only stable key within one.
          key={`${r.x}:${r.y}:${r.w}:${r.h}:${i}`}
          style={{
            position: 'absolute',
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
            border: '1px dashed #f59e0b',
            borderRadius: 2,
            background: `rgba(245,158,11,${regionAlpha(r.pixelCount)})`,
          }}
        />
      ))}
    </div>
  )
}

// ── Motion pill ──────────────────────────────────────────────────────────────

export function TileMotionBadge({
  deviceId,
  anchor,
}: {
  readonly deviceId: number
  readonly anchor: OverlayAnchor
}) {
  // Both the deadline and the clock are STATE, not a ref read during render:
  // the pill has to disappear on its own when no further event arrives, and a
  // render that reads `Date.now()` cannot schedule that.
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useLiveEvent<{ deviceId?: number; detected?: boolean }>(
    EventCategory.MotionOnMotionChanged,
    (evt) => {
      const p = evt.data
      if (!p || p.deviceId !== deviceId) return
      // Both edges arm the linger: a rising edge must stay visible, and a
      // falling edge re-arms from NOW so the pill does not blink out mid-glance.
      setUntil(Date.now() + MOTION_BADGE_HOLD_MS)
    },
  )

  // The tick only EXPIRES the pill (the deadline above shows it immediately),
  // so half a second of granularity costs nothing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  if (now >= until) return null
  return (
    <div style={{ ...anchorStyle(anchor), pointerEvents: 'none' }}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: ov(4),
          padding: `${ov(2)} ${ov(8)}`,
          borderRadius: ov(6),
          background: 'rgba(245,158,11,0.15)',
          color: '#f59e0b',
          fontSize: ov(11),
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: ov(7), height: ov(7), borderRadius: ov(4), background: '#f59e0b' }} />
        Motion
      </span>
    </div>
  )
}

// ── Audio meter ──────────────────────────────────────────────────────────────

export function TileAudioMeter({
  deviceId,
  anchor,
}: {
  readonly deviceId: number
  readonly anchor: OverlayAnchor
}) {
  const [dbfs, setDbfs] = useState<number | null>(null)

  useLiveEvent<PipelineAudioInferenceResultPayload>(
    EventCategory.PipelineAudioInferenceResult,
    (evt) => {
      const p = evt.data
      if (!p || p.deviceId !== deviceId) return
      setDbfs(p.frame.level?.dbfs ?? null)
    },
  )

  const level = dbfsToLevel(dbfs)
  const orientation = meterOrientation(anchor)
  if (orientation === null) return null
  const horizontal = orientation === 'horizontal'
  const vertical = orientation === 'vertical'
  return (
    <div style={{ ...anchorStyle(anchor), pointerEvents: 'none' }}>
      <span
        className="cs-chip"
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          alignItems: vertical ? 'center' : horizontal ? 'center' : 'flex-end',
          gap: ov(vertical || horizontal ? 4 : 3),
          padding: horizontal || vertical ? `${ov(4)} ${ov(8)}` : `${ov(3)} ${ov(6)}`,
          borderRadius: ov(8),
        }}
      >
        {/* The frame is always drawn, even in silence: a meter that disappears
            when quiet is indistinguishable from one that stopped working.
            Geometry is the viewer's `audio-level` ladder — same bars, same
            order, same size at every anchor. */}
        {meterRenderOrder(orientation).map((logicalIndex) => {
          const lit = logicalIndex < level
          const size = meterSegmentSize(orientation, logicalIndex)
          return (
            <span
              key={logicalIndex}
              style={{
                width: ov(size.width),
                height: ov(size.height),
                borderRadius: ov(2),
                background: lit ? audioLevelColor(logicalIndex) : '#71717a',
                opacity: lit ? 1 : 0.35,
              }}
            />
          )
        })}
      </span>
    </div>
  )
}

// ── Occupancy ────────────────────────────────────────────────────────────────

function queryCurrentSnapshot(client: unknown, deviceId: number): Promise<unknown> | null {
  if (typeof client !== 'object' || client === null) return null
  const router = Reflect.get(client, 'zoneAnalytics')
  if (typeof router !== 'object' || router === null) return null
  const method = Reflect.get(router, 'getCurrentSnapshot')
  if (typeof method !== 'object' || method === null) return null
  const query = Reflect.get(method, 'query')
  if (typeof query !== 'function') return null
  const result: unknown = query.call(method, { deviceId })
  return result instanceof Promise ? result : Promise.resolve(result)
}

export function TileOccupancy({
  system,
  deviceId,
  anchor,
}: {
  readonly system: System
  readonly deviceId: number
  readonly anchor: OverlayAnchor
}) {
  const [counts, setCounts] = useState<readonly TileOccupancyCount[]>([])

  useEffect(() => {
    let cancelled = false
    const pending = queryCurrentSnapshot(system.trpcClient, deviceId)
    // A hub without the cap is not an error here — it is a camera with no
    // occupancy, which draws nothing.
    if (pending === null) return
    void pending
      .then((raw) => {
        if (!cancelled) setCounts(parseOccupancyCounts(raw))
      })
      .catch(() => {
        if (!cancelled) setCounts([])
      })
    return () => {
      cancelled = true
    }
  }, [system, deviceId])

  useLiveEvent<Record<string, unknown>>(EventCategory.ZoneAnalyticsOccupancyChanged, (evt) => {
    const data = evt.data
    if (data.deviceId !== deviceId) return
    setCounts(parseOccupancyCounts(data))
  })

  if (counts.length === 0) return null
  return (
    <div style={{ ...anchorStyle(anchor), gap: ov(4), pointerEvents: 'none' }}>
      {counts.slice(0, 4).map((c) => (
        <span
          key={c.className}
          className="cs-chip"
          style={{
            padding: `${ov(2)} ${ov(6)}`,
            borderRadius: ov(6),
                fontSize: ov(11),
            fontWeight: 700,
            fontFamily: 'system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {`${c.className} ${c.count}`}
        </span>
      ))}
    </div>
  )
}

// ── Stream read-out ──────────────────────────────────────────────────────────

/**
 * The tile's stream read-out.
 *
 * Reads the `<video>` element inside the player rather than the peer: the
 * `RTCPeerConnection` lives in `CameraStreamPlayer` and is not exposed, exactly
 * as it is not on the app's WebView player — so this is the same
 * `source: 'playback'` set the single-camera view falls back to. One line, not
 * a panel: on a wall a tile is 200-600pt wide and a stats card would cover the
 * picture it describes.
 */
/** Where a tile drew the read-out before it could be placed — and still does
 *  for a host that does not say (`statsAt` absent). */
export const TILE_STATS_DEFAULT_ANCHOR: OverlayAnchor = 'top-right'

interface TileStatsProps {
  readonly containerRef: { current: HTMLElement | null }
  readonly anchor: OverlayAnchor
}

export function TileStats({ containerRef, anchor }: TileStatsProps) {
  const [stats, setStats] = useState<TilePlaybackStats | null>(null)
  const previous = useRef<{ frames: number; at: number } | null>(null)

  useEffect(() => {
    const sample = (): void => {
      const video = containerRef.current?.querySelector('video')
      if (!video) {
        setStats(null)
        return
      }
      const quality =
        typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null
      const frames = quality?.totalVideoFrames ?? 0
      const now = Date.now()
      const prev = previous.current
      previous.current = { frames, at: now }
      setStats({
        resolution: video.videoWidth > 0 ? `${video.videoWidth}x${video.videoHeight}` : '—',
        fps: prev === null ? 0 : framesPerSecond(prev.frames, frames, now - prev.at),
        dropped: quality?.droppedVideoFrames ?? 0,
      })
    }
    sample()
    const iv = setInterval(sample, STATS_POLL_MS)
    return () => {
      clearInterval(iv)
      previous.current = null
    }
  }, [containerRef])

  return (
    <div style={{ ...anchorStyle(anchor), pointerEvents: 'none' }}>
      <div
        className="cs-chip"
        style={{
          maxWidth: '100%',
          padding: `${ov(2)} ${ov(6)}`,
          borderRadius: ov(6),
          fontSize: ov(10),
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          pointerEvents: 'none',
        }}
      >
        {statsLine(stats)}
      </div>
    </div>
  )
}

// ── Live viewers ─────────────────────────────────────────────────────────────

/** One shared poller per hub connection: every tile that placed the indicator
 *  reads the same answer, so a twelve-tile wall is one request per poll. */
const pollers = new WeakMap<System, LiveViewersPoller>()

function pollerFor(system: System): LiveViewersPoller {
  const existing = pollers.get(system)
  if (existing) return existing
  const created = new LiveViewersPoller({
    fetchCounts: () => queryLiveViewerCounts(system.trpcClient),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => {
      if (handle !== null && handle !== undefined) clearInterval(handle as ReturnType<typeof setInterval>)
    },
  })
  pollers.set(system, created)
  return created
}

/** This camera's live viewer count, or `null` while it is unknown. */
export function useTileViewers(system: System, deviceId: number): number | null {
  const poller = pollerFor(system)
  const counts = useSyncExternalStore(poller.subscribe, poller.getSnapshot)
  return viewersFor(counts, deviceId)
}

/**
 * The tile's live-viewers pill: an eye and the number, absent while nobody
 * watches and while the count is unknown (an unanswered question is not "0").
 */
export function TileViewers({
  system,
  deviceId,
  anchor,
}: {
  readonly system: System
  readonly deviceId: number
  readonly anchor: OverlayAnchor
}) {
  const viewers = useTileViewers(system, deviceId)
  if (viewers === null || viewers < 1) return null
  return (
    <div style={{ ...anchorStyle(anchor), pointerEvents: 'none' }} data-testid="tile-viewers">
      <span
        role="img"
        aria-label={`${viewers} watching live`}
        className="cs-chip"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: ov(4),
          padding: `${ov(2)} ${ov(6)}`,
          borderRadius: ov(6),
          fontSize: ov(11),
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        <svg
          style={{ width: ov(13), height: ov(13) }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.06 12.35a1 1 0 0 1 0-.7C3.4 8.4 7.3 5 12 5s8.6 3.4 9.94 6.65a1 1 0 0 1 0 .7C20.6 15.6 16.7 19 12 19s-8.6-3.4-9.94-6.65" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {viewers}
      </span>
    </div>
  )
}
