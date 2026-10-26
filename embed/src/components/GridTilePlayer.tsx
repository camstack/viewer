import type { System } from '@camstack/sdk'
import {
  CameraStreamPlayer,
  type PlayerConnectionState,
  useDeviceWebrtc,
  type WebrtcTarget,
} from '@camstack/ui-library'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { GridHighlightConfig, GridQuality, TileOverlayConfig } from '../embed/embed-grid-config'
import { isOverlayAnchor } from '../embed/tile-overlays'
import {
  TileAudioMeter,
  TileMotionRegionsOverlay,
  TileOccupancy,
  TileStats,
  TileViewers,
  TILE_STATS_DEFAULT_ANCHOR,
} from './TileIndicators'
import { useStallWatchdog } from '../embed/use-stall-watchdog'
import { drawsRemoveControl, resolveTileControls, type TileAction } from '../embed/tile-controls'
import { fitInside, VIDEO_ASPECT } from '../embed/cell-fit'
import { DEFAULT_OVERLAY_SIZE, overlayScale, scaleVarStyle } from '../embed/overlay-size'
import type { CellSpan } from '../embed/grid-layout'
import { DEFAULT_TILE_LABELS, type TileLabels } from '../embed/tile-labels'
import { highlightFallback, useTileHighlight } from '../embed/use-tile-highlight'
import { usePaletteView } from '../../../shared/palette'
import { TileBoxesOverlay } from './TileBoxesOverlay'
import { ZoomPan } from './ZoomPan'
import { posterUrlFromLinkRows, type SnapshotLinkRow } from './grid-tile-poster'
import { createTileOfferBridge } from './grid-tile-offer'

/** How long the in-tile control overlay stays up after a tap (ms). */
const OVERLAY_HIDE_MS = 3500

/**
 * Map the grid-wide quality hint to the player's WebrtcTarget.
 *
 * No translation any more: the hint IS the system's profile enum, so `auto`
 * (the absence of a request) is the only member that is not passed through.
 */
function qualityToTarget(quality: GridQuality): WebrtcTarget {
  if (quality === 'auto') return { kind: 'adaptive' }
  return { kind: 'profile', profile: quality }
}

interface GridTilePlayerProps {
  readonly system: System
  readonly deviceId: number
  readonly name: string
  readonly online: boolean
  readonly quality: GridQuality
  readonly muted: boolean
  readonly paused: boolean
  readonly showName: boolean
  /** This tile currently owns the (exclusive) audio. */
  readonly audioActive: boolean
  /** This tile currently owns the (exclusive) mic — wired in F3 (intercom). */
  readonly micActive: boolean
  readonly onTogglePause: (deviceId: number) => void
  readonly onToggleAudio: (deviceId: number) => void
  readonly onToggleMic: (deviceId: number) => void
  /** The in-tile "open" button → host navigates to camera detail. */
  readonly onOpen: (deviceId: number) => void
  /** Camera supports PTZ (host-supplied) → show the in-tile PTZ button. */
  readonly ptzSupported?: boolean
  /** The in-tile PTZ button → host opens the native PTZ controls. */
  readonly onPtz?: (deviceId: number) => void
  /** Measured cell size (CSS px) — decides whether the secondary actions fit
   *  as their own buttons or collapse behind one "more" (see tile-controls). */
  readonly cellW?: number
  readonly cellH?: number
  /** A secondary in-tile button (linked devices / view options) or the
   *  compact "more" button → the HOST mounts the matching panel. The tile
   *  hosts none of them: they are the app's components, not the page's. */
  readonly onCellPanel?: (deviceId: number, panel: TileAction | 'actions') => void
  /** Per-grid highlight config (enabled + triggers). */
  readonly highlight?: GridHighlightConfig
  /** Live detection bounding-box overlay (grid-wide session toggle). */
  readonly showBoxes?: boolean
  /** THIS camera's own indicators, as its per-cell view-options menu set them
   *  (`GridConfig.overlays[deviceId]`). Absent ⇒ this camera placed none, and
   *  none of the subscriptions behind them are opened. */
  readonly overlay?: TileOverlayConfig
  /** Host-driven fast reconnect nonce — bump to reconnect keeping the last frame. */
  readonly reconnectSignal?: number
  /** A stall was detected and a session rebuild was triggered for this device.
   *  Reported so the symptom is visible to the host instead of silent. */
  readonly onStall?: (deviceId: number) => void
  /** Last-known snapshot data URL — cold-start poster only (before first frame). */
  readonly posterUrl?: string
  /** This wall is the operator's VIEW: the cell carries a remove control and
   *  resize grips, and the host answers both. Absent ⇒ a saved grid, unchanged. */
  readonly editable?: boolean
  /** This camera's current size in TRACKS. Absent ⇒ 1×1, today's cell. */
  readonly span?: CellSpan
  /** The remove control → the host drops this camera from the wall's set. */
  readonly onRemove?: (deviceId: number) => void
  /** A resize grip → the host records a new track span and pushes it back. The
   *  page keeps no optimistic copy: the wall it draws is always the host's. */
  readonly onResize?: (deviceId: number, cw: number, ch: number) => void
  /** The page's words, injected by the host in the config it already sends.
   *  Absent ⇒ the English that ships — an older host, or an external iframe
   *  that sends no strings, draws exactly the wall it drew before. */
  readonly labels?: TileLabels
  /** The config's bearer, for `/adaptive-probe` only (D635): a `file://`
   *  page has no session cookie. Never logged. */
  readonly probeAuthToken?: string
}

export function GridTilePlayer({
  system,
  deviceId,
  name,
  online,
  quality,
  muted,
  paused,
  showName,
  audioActive,
  micActive,
  onTogglePause,
  onToggleAudio,
  onToggleMic,
  onOpen,
  ptzSupported,
  onPtz,
  cellW,
  cellH,
  onCellPanel,
  highlight,
  showBoxes,
  overlay,
  reconnectSignal,
  onStall,
  posterUrl,
  labels = DEFAULT_TILE_LABELS,
  editable,
  span,
  onRemove,
  onResize,
  probeAuthToken,
}: GridTilePlayerProps) {
  const kindPalette = usePaletteView()
  const {
    handleOffer,
    getIceServers,
    addIceCandidate,
    getIceCandidates,
    closeSession,
    getSessionState,
    getSessionDebug,
    applyDownlinkProbe,
  } = useDeviceWebrtc(system.trpcClient, deviceId)

  const highlightType = useTileHighlight(system, deviceId, highlight)

  /**
   * Stall watchdog — a FROZEN tile, which is not an errored one.
   *
   * The player reports `playing` and the peer connection stays up while the
   * last decoded frame never changes, so every existing recovery path (all of
   * which key off an error) sleeps through it. The operator's only remedy was
   * closing and reopening the grid.
   *
   * Recovery reuses the reconnect nonce the HOST already drives — the exact
   * path `__camstackGrid.reconnect()` takes — so a rebuild here goes through
   * the same code as a manual one, including `CameraStreamPlayer`'s explicit
   * `video.play()` (Chrome will not start a MediaStream without it).
   */
  const tileRef = useRef<HTMLDivElement | null>(null)
  const [selfReconnect, setSelfReconnect] = useState(0)
  const [playerState, setPlayerState] = useState<PlayerConnectionState>('idle')
  const watchdog = useStallWatchdog({
    containerRef: tileRef,
    playing: playerState === 'playing' && !paused,
    onRecover: () => {
      setSelfReconnect((n) => n + 1)
      onStall?.(deviceId)
    },
  })

  // Cold-start poster: the injected last-known snapshot wins (host-provided,
  // survives restarts); otherwise mint a signed link so a tile opens on the
  // last frame instead of a black loader. Used ONLY before the first WebRTC
  // frame — the live stream + its retained frame take over after. Bytes travel
  // the HTTP link plane, not a base64 `getSnapshot` through hub-main.
  const [fetchedPoster, setFetchedPoster] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (posterUrl || paused) return // injected poster wins; don't fetch while paused
    let cancelled = false
    const width = cellW !== undefined && cellW > 0 ? Math.round(cellW) : undefined
    void system.trpcClient.snapshot.getSnapshotLinks
      .query({
        targets: [{ deviceId, ...(width !== undefined ? { width } : {}) }],
      })
      .then((rows: readonly SnapshotLinkRow[] | null) => {
        if (cancelled) return
        const uri = posterUrlFromLinkRows(system.serverUrl, rows ?? [])
        if (uri !== null) setFetchedPoster(uri)
      })
      .catch(() => {
        /* best-effort cold-start poster — fall back to the loader */
      })
    return () => {
      cancelled = true
    }
  }, [posterUrl, paused, system, deviceId, cellW])
  const effectivePoster = posterUrl ?? fetchedPoster

  const webrtcTarget = useMemo<WebrtcTarget>(() => qualityToTarget(quality), [quality])
  const key = `grid:${deviceId}:${quality}`

  // The player hands its auto-derived client hints as the LAST argument; the
  // bridge forwards them. See `grid-tile-offer.ts` for what dropping them cost.
  const offerBridge = useMemo(
    () => createTileOfferBridge(handleOffer, webrtcTarget),
    [handleOffer, webrtcTarget],
  )

  // ── Control overlay (tap to reveal, auto-hide) ────────────────────────────
  const [controlsOn, setControlsOn] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const armHide = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsOn(false), OVERLAY_HIDE_MS)
  }
  const reveal = (): void => {
    setControlsOn(true)
    armHide()
  }
  // A clean single tap on the tile (from ZoomPan) toggles the overlay; tapping a
  // button reveals + keeps it up (the button handler calls keepAlive first).
  const onBackgroundTap = (): void => {
    setControlsOn((v) => {
      const next = !v
      if (next) armHide()
      return next
    })
  }
  // Does this cell have room for the secondary buttons, or do they collapse
  // behind one "more"? Pure + unit-tested (mirrors the native wall's copy).
  const secondary = resolveTileControls(cellW ?? 0, cellH ?? 0)

  const keepAlive = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation()
    reveal()
  }

  // ── The picture inside a cell that may not be the picture's shape ──────────
  //
  // A 1×1 cell IS 16:9 and this resolves to the whole cell, byte for byte. A
  // spanned one is not, and the operator settled what happens then: bands, no
  // crop (see `cell-fit`). Only the things anchored to the VIDEO move with it —
  // the detection boxes and the motion regions are in frame coordinates, and
  // leaving them on the cell would put every rectangle beside its object. The
  // name, the highlight border and the controls stay on the cell, which is the
  // camera's territory whatever shape it has.
  const measured = cellW !== undefined && cellH !== undefined && cellW > 0 && cellH > 0
  const picture = fitInside(cellW ?? 0, cellH ?? 0, VIDEO_ASPECT)
  const pictureStyle = measured
    ? {
        position: 'absolute' as const,
        left: picture.left,
        top: picture.top,
        width: picture.width,
        height: picture.height,
      }
    : { position: 'absolute' as const, inset: 0 }

  // The grips move the span one TRACK at a time, and a track is this cell's own
  // size divided by the span it already has — so the step stays right without
  // the page ever being told the wall's geometry.
  const spanCw = Math.max(1, Math.round(span?.cw ?? 1))
  const spanCh = Math.max(1, Math.round(span?.ch ?? 1))
  const trackW = measured && cellW !== undefined ? cellW / spanCw : 0
  const trackH = measured && cellH !== undefined ? cellH / spanCh : 0
  const canEdit = drawsRemoveControl(editable === true, cellW ?? 0, cellH ?? 0)
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )

  return (
    <div
      ref={tileRef}
      data-stall-recovering={watchdog.recovering ? 'true' : undefined}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}
    >
      <div style={pictureStyle}>
      <ZoomPan onTap={onBackgroundTap}>
        {paused ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fafaf9',
            }}
          >
            <PlayIcon size={28} />
          </div>
        ) : (
          <CameraStreamPlayer
            key={key}
            applyDownlinkProbe={applyDownlinkProbe}
            serverUrl={system.serverUrl}
            streamKey={key}
            autoPlay
            muted={muted}
            showControls={false}
            className="w-full h-full"
            handleOffer={offerBridge.handleOffer}
            reoffer={offerBridge.reoffer}
            getSessionState={getSessionState}
            getSessionDebug={getSessionDebug}
            getIceServers={getIceServers}
            addIceCandidate={addIceCandidate}
            getIceCandidates={getIceCandidates}
            closeSession={closeSession}
            // The host's nonce and the watchdog's are summed: either can
            // rebuild the session, and neither can cancel the other out.
            reconnectSignal={(reconnectSignal ?? 0) + selfReconnect}
            onStateChange={setPlayerState}
            posterUrl={effectivePoster}
            // D635: the downlink probe needs a session credential.
            probeAuthToken={probeAuthToken}
            // Feed the broker's adaptive ladder the client's live conditions
            // (only for 'auto' — a pinned tier ignores the ladder).
            onClientNetworkSample={
              quality === 'auto'
                ? (sample) => {
                    void system.trpcClient.networkQuality.reportClientStats
                      .mutate({ deviceId, ...sample })
                      .catch(() => {
                        /* best-effort telemetry */
                      })
                  }
                : undefined
            }
          />
        )}
      </ZoomPan>

      {showBoxes && !paused ? <TileBoxesOverlay deviceId={deviceId} /> : null}

      {/* ── This camera's OWN indicators (see `tile-overlays`). Each is mounted
          only where the operator placed it, so the subscription/poll behind it
          is the one that was asked for. Live only: a paused tile shows a still,
          and an indicator over a frozen frame describes a moment that passed. */}
      {overlay?.motionBoxes === true && !paused ? (
        <TileMotionRegionsOverlay deviceId={deviceId} />
      ) : null}
      </div>
      {/* The anchored indicators live in a frame laid over the PICTURE (not the
          cell: a spanned cell is banded) that publishes the device's overlay
          size as `--ov`, the multiplier every indicator's dimensions use. */}
      <div
        style={{
          ...pictureStyle,
          pointerEvents: 'none',
          ...scaleVarStyle(overlayScale(measured ? picture.width : (cellW ?? 0), overlay?.size ?? DEFAULT_OVERLAY_SIZE)),
        }}
      >
        {isOverlayAnchor(overlay?.audioMeter) && !paused ? (
          <TileAudioMeter deviceId={deviceId} anchor={overlay.audioMeter} />
        ) : null}
        {isOverlayAnchor(overlay?.occupancy) && !paused ? (
          <TileOccupancy system={system} deviceId={deviceId} anchor={overlay.occupancy} />
        ) : null}
        {overlay?.stats === true && !paused ? (
          <TileStats containerRef={tileRef} anchor={overlay.statsAt ?? TILE_STATS_DEFAULT_ANCHOR} />
        ) : null}
        {isOverlayAnchor(overlay?.viewers) && !paused ? (
          <TileViewers system={system} deviceId={deviceId} anchor={overlay.viewers} />
        ) : null}
      </div>

      {highlightType &&
        (() => {
          const ap = highlight?.appearance
          const color =
            highlightType === 'motion'
              ? (ap?.motionColor ?? highlightFallback('motion', kindPalette))
              : highlightType === 'audio'
                ? (ap?.audioColor ?? highlightFallback('audio', kindPalette))
                : (ap?.detectionColor ?? highlightFallback('detection', kindPalette))
          const width = ap?.thickness ?? 3
          return (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: `${width}px solid ${color}`,
                boxShadow: `inset 0 0 12px ${color}`,
                pointerEvents: 'none',
              }}
            />
          )
        })()}

      {/* Name bar: shown when the grid's per-grid showName is on, OR transiently
          while the tap-to-reveal control overlay is up — so the camera name is
          always identifiable on tap even when names are hidden by default
          (matches the single camera-detail view). */}
      {(showName || controlsOn) && (
        <div
          className="cs-glass cs-fade"
          data-on={showName || controlsOn}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
            opacity: showName || controlsOn ? 1 : 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: online ? '#34d399' : '#71717a',
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </div>
      )}

      {/* Control overlay — wrapper never captures pointers so taps on empty
          space fall through to ZoomPan (toggle); only the buttons are hit
          targets, and only while the overlay is shown. */}
      <div
        className="cs-fade"
        data-on={controlsOn}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: controlsOn ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {/* Center pause/play — the inset:0 wrapper must NOT capture pointers
            (it'd block ZoomPan / tap-to-hide); only the button does. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <OverlayButton
            label={paused ? labels.play : labels.pause}
            big
            enabled={controlsOn}
            onClick={(e) => {
              keepAlive(e)
              onTogglePause(deviceId)
            }}
          >
            {paused ? <PlayIcon size={22} /> : <PauseIcon size={22} />}
          </OverlayButton>
        </div>

        {/* Bottom-left: audio + mic */}
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            display: 'flex',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          <OverlayButton
            label={audioActive ? labels.mute : labels.listen}
            active={audioActive}
            enabled={controlsOn}
            onClick={(e) => {
              keepAlive(e)
              onToggleAudio(deviceId)
            }}
          >
            {audioActive ? <SpeakerOnIcon size={18} /> : <SpeakerOffIcon size={18} />}
          </OverlayButton>
          <OverlayButton
            label={micActive ? labels.stopTalk : labels.talk}
            active={micActive}
            enabled={controlsOn}
            onClick={(e) => {
              keepAlive(e)
              onToggleMic(deviceId)
            }}
          >
            <MicIcon size={18} muted={!micActive} />
          </OverlayButton>
          {/* PTZ collapses with the other secondary actions on a compact cell —
              it is offered by the host's list instead (and it is the first
              disc that stops fitting). Without a host that can show that list
              (`onCellPanel`) it stays put: a button that vanishes with no way
              back is worse than a cramped row. */}
          {ptzSupported && onPtz && (!onCellPanel || !secondary.overflow) ? (
            <OverlayButton
              label={labels.ptz}
              enabled={controlsOn}
              onClick={(e) => {
                keepAlive(e)
                onPtz(deviceId)
              }}
            >
              <PtzIcon size={18} />
            </OverlayButton>
          ) : null}
          {/* Secondary actions — the camera's LINKED DEVICES and its
              view-options MENU, both hosted by the app (same components the
              single-camera view uses). On a cell too small to carry two more
              discs they collapse behind one "more" that opens the same panels
              as a list. */}
          {onCellPanel
            ? secondary.inline.map((action) => (
                <OverlayButton
                  key={action}
                  label={action === 'devices' ? labels.linkedDevices : labels.viewOptions}
                  enabled={controlsOn}
                  onClick={(e) => {
                    keepAlive(e)
                    onCellPanel(deviceId, action)
                  }}
                >
                  {action === 'devices' ? <DevicesIcon size={18} /> : <SlidersIcon size={18} />}
                </OverlayButton>
              ))
            : null}
          {onCellPanel && secondary.overflow ? (
            <OverlayButton
              label={labels.moreActions}
              enabled={controlsOn}
              onClick={(e) => {
                keepAlive(e)
                onCellPanel(deviceId, 'actions')
              }}
            >
              <MoreIcon size={18} />
            </OverlayButton>
          ) : null}
        </div>

        {/* Bottom-right: open */}
        <div style={{ position: 'absolute', right: 8, bottom: 8, pointerEvents: 'none' }}>
          <OverlayButton
            label={labels.open}
            enabled={controlsOn}
            onClick={(e) => {
              keepAlive(e)
              onOpen(deviceId)
            }}
          >
            <OpenIcon size={18} />
          </OverlayButton>
        </div>

        {/* Top-right: take THIS camera off the wall.
            The only per-cell verb that removes anything: `open` promotes a
            camera and the host's own close button empties the whole view, so
            without this there is no way to say "this one no, the others yes".
            It posts an intent — the wall's membership is the host's, and a page
            that edited its own set would disagree with the next `setDevices`. */}
        {canEdit && onRemove ? (
          <div style={{ position: 'absolute', right: 8, top: 8, pointerEvents: 'none' }}>
            <OverlayButton
              label={labels.removeFromView}
              enabled={controlsOn}
              onClick={(e) => {
                keepAlive(e)
                onRemove(deviceId)
              }}
            >
              <CloseIcon size={18} />
            </OverlayButton>
          </div>
        ) : null}

        {/* The resize grips: one per AXIS, on the edge that axis grows along.
            Edges rather than a corner because all four corners already carry a
            control, and because one axis per grip is what a track-snapping
            resize actually is — a corner would have to guess which of two spans
            a diagonal drag meant. */}
        {canEdit && onResize ? (
          <>
            <SpanGrip
              axis="x"
              label={labels.resizeWidth}
              enabled={controlsOn}
              track={trackW}
              span={spanCw}
              onSpan={(next) => {
                reveal()
                onResize(deviceId, next, spanCh)
              }}
            />
            <SpanGrip
              axis="y"
              label={labels.resizeHeight}
              enabled={controlsOn}
              track={trackH}
              span={spanCh}
              onSpan={(next) => {
                reveal()
                onResize(deviceId, spanCw, next)
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

interface SpanGripProps {
  readonly axis: 'x' | 'y'
  readonly label: string
  readonly enabled: boolean
  /** One track along this axis, in CSS px — the size of one step. Derived by
   *  the tile from its OWN box, so the page never needs the wall's geometry. */
  readonly track: number
  /** The span this cell has right now, along this axis. */
  readonly span: number
  readonly onSpan: (next: number) => void
}

/**
 * One edge grip. Reports a whole new SPAN, never a pixel size.
 *
 * The drag origin and the span it started from are latched on pointer-down and
 * the step is recomputed from the CURRENT track on every move, so the grip
 * stays honest while the wall reflows under it: the host echoes each change
 * back, the cell physically moves, and a grip that measured deltas between
 * consecutive moves would drift by exactly one track each time.
 */
function SpanGrip({ axis, label, enabled, track, span, onSpan }: SpanGripProps) {
  const drag = useRef<{ origin: number; base: number } | null>(null)
  const pos = (e: { clientX: number; clientY: number }): number =>
    axis === 'x' ? e.clientX : e.clientY

  return (
    <div
      className="cs-glass cs-grip"
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { origin: pos(e), base: span }
      }}
      onPointerMove={(e) => {
        if (drag.current === null || !(track > 0)) return
        e.stopPropagation()
        const steps = Math.round((pos(e) - drag.current.origin) / track)
        const next = Math.max(1, drag.current.base + steps)
        if (next !== span) onSpan(next)
      }}
      onPointerUp={(e) => {
        drag.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      style={{
        position: 'absolute',
        ...(axis === 'x'
          ? { right: 0, top: '50%', width: 14, height: 48, transform: 'translateY(-50%)' }
          : { bottom: 0, left: '50%', width: 48, height: 14, transform: 'translateX(-50%)' }),
        borderRadius: 7,
        cursor: axis === 'x' ? 'ew-resize' : 'ns-resize',
        touchAction: 'none',
        pointerEvents: enabled ? 'auto' : 'none',
      }}
    />
  )
}

// ── Overlay button + icons ────────────────────────────────────────────────────

function OverlayButton({
  children,
  label,
  onClick,
  big = false,
  active = false,
  enabled = true,
}: {
  children: ReactNode
  label: string
  onClick: (e: { stopPropagation: () => void }) => void
  big?: boolean
  active?: boolean
  enabled?: boolean
}) {
  const d = big ? 52 : 40
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="cs-glass cs-glass-btn"
      data-active={active}
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        WebkitTapHighlightColor: 'transparent',
        pointerEvents: enabled ? 'auto' : 'none',
      }}
    >
      {children}
    </button>
  )
}

interface IconProps {
  size: number
}
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function PlayIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
    </svg>
  )
}
function PauseIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="6" y="4" width="4" height="16" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" />
    </svg>
  )
}
function SpeakerOnIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  )
}
function SpeakerOffIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}
function MicIcon({ size, muted }: IconProps & { muted: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}
function OpenIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M15 3h6v6M21 3l-9 9M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  )
}
/** A bulb — the camera's LINKED devices (siren, floodlight, switches …). */
function DevicesIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5A5.5 5.5 0 1 0 7.5 11.5c.8.8 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6M10 22h4" />
    </svg>
  )
}
/** Sliders — the per-camera view-options menu. */
function SlidersIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M3 6h18M3 12h18M3 18h18" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </svg>
  )
}
/** Ellipsis — the compact cell's single "more actions" button. */
function MoreIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}
/** A cross — take this camera off the wall (not "close the view"). */
function CloseIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}
/** Four-way move (PTZ) — a directional pad glyph. */
function PtzIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 2v20M2 12h20" />
      <path d="M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
    </svg>
  )
}
