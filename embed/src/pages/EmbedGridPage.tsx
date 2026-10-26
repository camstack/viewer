/**
 * EmbedGridPage — chrome-less N-camera WebRTC grid.
 *
 * Served with the Viewer at `/viewer/camstack/embed/index.html?mode=grid`
 * (see `EmbedApp`). One SPA boot renders N players (one WebRTC peer per device),
 * which is the whole point of the shared embed: on iOS each WKWebView booting
 * the full SPA + its own peer doesn't scale, so the grid lives in ONE WebView.
 *
 * Hybrid model: this page renders video + PASSIVE overlays (name + online dot);
 * the native app draws the interactive chrome (control bar, fullscreen, tap →
 * camera detail, long-press → controls). The page reports tapped-tile rects so
 * the native overlays anchor without pixel measurement.
 *
 * Contract:
 *   IN  (set before load):  window.__CAMSTACK_GRID__ = { serverUrl, token, devices, layout, quality, showName, showBadges, muted, paused }
 *   OUT (postMessage):      state / layout / tileOpen / audioToggle (see grid-messages)
 *   IN  (once mounted):     window.__camstackGrid = { setAudioOn, setMutedAll, setActiveMic, setPaused, setDevices, setQuality, setLayout, setShowName, setShowBadges, setShowBoxes, setOverlays, fit }
 *
 * Tap a tile to reveal in-tile controls (auto-hide): center pause/play (per
 * tile), bottom-left audio + mic, bottom-right open (→ host navigates via the
 * tileOpen msg). Audio is COMBINABLE (host-owned set; the in-tile button posts
 * audioToggle); the mic (intercom) is EXCLUSIVE — one camera at a time.
 *
 * (A paragraph describing EXCLUSIVE audio — an `activeAudioId` and a
 * `setActiveAudio(deviceId)` host call — was deleted on 2026-09-12. Neither
 * identifier has existed since audio became the combinable set described two
 * lines above; it contradicted its own docblock, and D483 nearly built a
 * cross-surface audio-ownership rule on it.)
 */
import { useEffect, useMemo, useRef, useState} from 'react'
import { SystemProvider, trpc } from '@camstack/ui-library'
import { createSystem, type System } from '@camstack/sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  gridQualitySchema,
  parseGridConfig,
  type GridConfig,
  type GridLayout,
  type GridQuality,
  type GridHighlightConfig,
} from '../embed/embed-grid-config'
import { onHostCommand, useEmbedConfig } from '../embed/host-bridge'
import { readGridUrlConfig } from '../embed/embed-url-config'
import { resolveWall, type CellSpan, type WallSpans } from '../embed/grid-layout'
import { resolveTileLabels } from '../embed/tile-labels'
import { useExclusiveIntercom } from '../embed/use-exclusive-intercom'
import { useActiveDevices } from '../embed/use-active-devices'
import {
  audioToggleMsg,
  gridStateMsg,
  layoutMsg,
  pauseToggleMsg,
  postToHost,
  ptzOpenMsg,
  cellPanelOpenMsg,
  tileOpenMsg,
  tileRemoveMsg,
  tileResizeMsg,
  type TileRect,
} from '../embed/grid-messages'
import { GridTilePlayer } from '../components/GridTilePlayer'
import { PaletteBridge } from '../embed/PaletteBridge'
import { GridWallSurface } from '../components/GridWallSurface'
import type { TileOverlayConfig } from '../embed/embed-grid-config'
import { useHostBox } from '../embed/use-host-box.js'

declare global {
  interface Window {
    __CAMSTACK_GRID__?: unknown
    __camstackGrid?: {
      setMutedAll: (b: boolean) => void
      setAudioOn: (ids: readonly number[]) => void
      setActiveMic: (deviceId: number | null) => void
      setHighlight: (h: GridHighlightConfig) => void
      setActiveOnly: (b: boolean) => void
      setShowBoxes: (b: boolean) => void
      /** PER-DEVICE indicators, keyed by device id (string) — the first
       *  per-camera channel in this protocol (everything before it was one
       *  value for the whole wall). */
      setOverlays: (overlays: Record<string, TileOverlayConfig>) => void
      setPaused: (ids: readonly number[]) => void
      /** The device SET, at runtime. Without it the only way to change the
       *  cameras on the wall was for the host to reload this document, which
       *  costs a second SPA boot and renegotiates EVERY peer for one added
       *  camera. Declared to the host in the `ready` report, because a host
       *  that cannot tell whether we have it has to keep reloading. */
      setDevices: (ids: readonly number[]) => void
      /** Per-camera SIZE on the wall, in tracks. Declared to the host in the
       *  `ready` report — unlike the device set, a host whose page lacks this
       *  must send NOTHING rather than reload: an evenly distributed wall is
       *  the correct wall, just not the arranged one. */
      setSpans: (spans: Record<string, CellSpan>) => void
      setQuality: (q: GridQuality) => void
      setLayout: (l: GridLayout) => void
      setShowName: (b: boolean) => void
      setShowBadges: (b: boolean) => void
      setSnapshots: (snapshots: Record<string, string>) => void
      fit: (w: number, h: number) => void
      reconnect: () => void
    }
  }
}

/** Minimal device-list row we read from `deviceManager.listAll` (name + online). */
interface DeviceRow {
  readonly id: number
  readonly name?: string
  readonly online?: boolean
}

function FatalError({ message }: { message: string }) {
  useEffect(() => postToHost(gridStateMsg('error', message)), [message])
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        color: '#f87171',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        padding: 16,
        textAlign: 'center',
      }}
    >
      Grid embed config error: {message}
    </div>
  )
}

interface GridProps {
  readonly system: System
  readonly config: GridConfig
}

/** The commands this build implements — named to the host in the `ready`
 *  report. Only `setDevices` is load-bearing today (see the host's
 *  `GRID_HOT_DEVICES_COMMAND`); the list is the shape a second one would use. */
const IMPLEMENTED_COMMANDS: readonly string[] = ['setDevices', 'setSpans']

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function Grid({ system, config }: GridProps) {
  // The wall's cameras. Seeded from the injected config, then replaced in place
  // by `setDevices`. Identical ids resolve to the SAME array so a re-pushed set
  // cannot churn the name query or the activity subscriptions.
  const [devices, setDevices] = useState<readonly number[]>(config.devices)
  // Combinable audio: the set of device ids whose audio is ON (more than one
  // allowed). The HOST owns this set (mirrored in the bar's audio multiselect);
  // the in-tile audio button posts an audioToggle and the host pushes the
  // updated set back via setAudioOn. Seeded from the per-grid initial-audio set.
  const [audioOnIds, setAudioOnIds] = useState<ReadonlySet<number>>(
    () => new Set(config.audioOnIds ?? []),
  )
  // Exclusive mic (intercom) — at most one camera talking, managed by the
  // controller (getUserMedia + intercom cap WebRTC session).
  const intercom = useExclusiveIntercom()
  // Latest intercom.setActiveMic captured in a ref so the (mount-once) host API
  // effect can call it without re-registering on every render.
  const setActiveMicRef = useRef(intercom.setActiveMic)
  setActiveMicRef.current = intercom.setActiveMic
  // Paused tiles — host-owned set (so the bar's mass play/pause can reflect
  // per-tile pauses). The in-tile pause button posts pauseToggle; the host
  // pushes the updated set back via setPaused.
  const [pausedIds, setPausedIds] = useState<ReadonlySet<number>>(
    () => new Set(config.pausedIds ?? []),
  )
  const [highlight, setHighlight] = useState<GridHighlightConfig | undefined>(config.highlight)
  const [activeOnly, setActiveOnly] = useState(config.activeOnly ?? false)
  // Live bounding-box overlay — grid-wide session toggle (host-pushed).
  const [showBoxes, setShowBoxes] = useState(config.showBoxes ?? false)
  // Per-device indicators (motion regions, motion pill, audio meter, occupancy,
  // stats) — set per camera in the app's cell menu and pushed here, because a
  // menu may only offer what something DRAWS and on this platform that is us.
  const [overlays, setOverlays] = useState<Record<string, TileOverlayConfig>>(
    () => config.overlays ?? {},
  )
  // Per-camera track spans — the operator's arrangement. HOST-owned, exactly
  // like the audio and paused sets: a grip posts `tileResize` and the host
  // pushes the resolved map back. The page keeps no optimistic copy, so what it
  // draws is always what the host believes, and a resize that the host declined
  // (a camera that left the wall mid-drag) cannot leave a ghost cell here.
  const [spans, setSpans] = useState<WallSpans>(() => config.spans ?? {})

  // Active-cameras-only: which devices are currently active (same triggers as
  // highlight). Subscriptions run regardless; the filter only applies when on.
  const activeSet = useActiveDevices(devices, highlight)
  const visibleDevices = useMemo(
    () => (activeOnly ? devices.filter((id) => activeSet.has(id)) : devices),
    [activeOnly, devices, activeSet],
  )
  const [quality, setQuality] = useState<GridQuality>(config.quality)
  const [layout, setLayout] = useState<GridLayout>(config.layout)
  const [showName, setShowName] = useState(config.showName)
  // Host-driven fast reconnect: every reconnect() bump forwards a new
  // reconnectSignal to every tile's CameraStreamPlayer, which reconnects
  // WITHOUT remounting (keeps the last decoded frame — no black flash). The
  // native shell calls this on a NetInfo connectivity change / foreground
  // resume INSTEAD of reloading the WebView (a reload blanks every tile).
  const [reconnectNonce, setReconnectNonce] = useState(0)
  // The host's words, merged over the English once. Injected at the handshake
  // and never pushed hot, so the config object is the whole of the dependency:
  // resolving per tile per render would rebuild sixteen strings on every frame.
  const labels = useMemo(() => resolveTileLabels(config.labels), [config.labels])
  // Per-device last-known snapshot data URLs (cold-start poster only). Seeded
  // from the injected config; refreshed at runtime via setSnapshots.
  const [snapshots, setSnapshots] = useState<Record<string, string>>(() => config.snapshots ?? {})
  // Device ids that support PTZ (host-supplied) — gates the in-tile PTZ button.
  const ptzSet = useMemo(() => new Set(config.ptzIds ?? []), [config.ptzIds])
  // box: the host pushes exact px via fit() (WKWebView innerHeight is stale on
  // rotation); fall back to the window until the first fit() arrives.
  const { box, fit: fitBox } = useHostBox()

  // Resolve device names (best-effort; falls back to the host's word for a
  // camera plus the id — the ONE place the page composes a name itself, which
  // is why the word travels rather than the whole template).
  const cameraWord = labels.camera
  const [names, setNames] = useState<Record<number, { name: string; online: boolean }>>({})
  useEffect(() => {
    let cancelled = false
    // Gli id di cui la griglia ha bisogno li CONOSCE gia' (`config.devices`).
    // Questa query chiedeva la flotta INTERA — 1017 righe misurate sull'hub —
    // per costruire una mappa di nomi di una manciata di riquadri, mentre il
    // suo gemello in `events-client.ts` filtra da tempo con la stessa forma.
    // Il censimento del boot 1.2.174 mostra ~1017 righe per chiamata sul
    // percorso senza chiamante, cioe' proprio questa firma.
    void system.trpcClient.deviceManager.listAll
      .query({ deviceIds: [...devices], projection: 'slim' })
      .then((rows: readonly DeviceRow[]) => {
        if (cancelled) return
        const map: Record<number, { name: string; online: boolean }> = {}
        for (const d of rows)
          map[d.id] = { name: d.name ?? `${cameraWord} ${d.id}`, online: d.online ?? false }
        setNames(map)
      })
      .catch(() => {
        /* names are best-effort; the tile composes the same fallback itself */
      })
    return () => {
      cancelled = true
    }
    // `devices` entra fra le dipendenze perche' adesso la query lo LEGGE: una
    // griglia che cambia insieme di riquadri deve ri-risolvere i nomi.
    // `cameraWord` is injected once at the handshake and never pushed hot, so
    // it is constant for the life of the document: listing it is honest about
    // the read without costing a re-query.
  }, [system, devices, cameraWord])

  useEffect(() => {
    window.__camstackGrid = {
      // Replace the whole combinable audio set (host-owned). Back-compat:
      // setMutedAll(true) clears it (silence all).
      setAudioOn: (ids) => setAudioOnIds(new Set(ids)),
      setMutedAll: (b) => {
        if (b) setAudioOnIds(new Set())
      },
      setActiveMic: (deviceId) => setActiveMicRef.current(deviceId),
      setHighlight: (h) => setHighlight(h),
      setActiveOnly: (b) => setActiveOnly(b),
      setShowBoxes: (b) => setShowBoxes(b),
      setOverlays: (next) => setOverlays(next),
      setPaused: (ids) => setPausedIds(new Set(ids)),
      setDevices: (ids) => setDevices((prev) => (sameIds(prev, ids) ? prev : [...ids])),
      setSpans: (next) => setSpans(next),
      setQuality: (q) => setQuality(q),
      setLayout: (l) => setLayout(l),
      setShowName,
      setShowBadges: () => {
        /* event badges land in a follow-up (Plan 1b) — accepted as a no-op */
      },
      setSnapshots: (next) => setSnapshots(next),
      fit: fitBox,
      reconnect: () => setReconnectNonce((n) => n + 1),
    }
    postToHost(gridStateMsg('ready', undefined, IMPLEMENTED_COMMANDS))
    return () => {
      if (window.__camstackGrid) delete window.__camstackGrid
    }
  }, [fitBox])

  useEffect(
    () =>
      onHostCommand((command) => {
        const api = window.__camstackGrid
        if (!api) return
        const kind = command.kind as string
        switch (kind) {
          case 'setAudioOn':
            api.setAudioOn(command.value as readonly number[])
            break
          case 'setMutedAll':
            api.setMutedAll(command.value as boolean)
            break
          case 'setActiveMic':
            api.setActiveMic(command.value as number | null)
            break
          case 'setHighlight':
            api.setHighlight(command.value as Parameters<typeof api.setHighlight>[0])
            break
          case 'setActiveOnly':
            api.setActiveOnly(command.value as boolean)
            break
          case 'setShowBoxes':
            api.setShowBoxes(command.value === true)
            break
          case 'setOverlays':
            api.setOverlays(command.value as Record<string, TileOverlayConfig>)
            break
          case 'setPaused':
            api.setPaused(command.value as readonly number[])
            break
          case 'setDevices':
            api.setDevices(command.value as readonly number[])
            break
          case 'setSpans':
            api.setSpans(command.value as Record<string, CellSpan>)
            break
          case 'setQuality':
            // PARSED, not cast. The host on the other side of this bridge is a
            // different artifact on a different release chain: an app still
            // running the pre-2026-09-02 scale pushes `medium`, and cast
            // through, that word reaches the broker as a profile it does not
            // have. The schema normalises an unknown tier to `auto`
            // (`gridQualitySchema`), which is the same rule the initial config
            // and the share link follow.
            api.setQuality(gridQualitySchema.parse(command.value))
            break
          case 'setLayout':
            api.setLayout(command.value as Parameters<typeof api.setLayout>[0])
            break
          case 'setShowName':
            api.setShowName(command.value as boolean)
            break
          case 'setShowBadges':
            api.setShowBadges(command.value as boolean)
            break
          case 'setSnapshots':
            api.setSnapshots(command.value as Parameters<typeof api.setSnapshots>[0])
            break
          case 'fit':
            api.fit(command.w as number, command.h as number)
            break
          case 'reconnect':
            api.reconnect()
            break
          default:
            break
        }
      }),
    [],
  )

  // The wall, resolved. With no custom span this is the evenly distributed wall
  // that ships, value for value — see `resolveWall`.
  const wall = useMemo(
    () => resolveWall(visibleDevices, box.w, box.h, layout, spans),
    [visibleDevices, box.w, box.h, layout, spans],
  )
  // Report tile layout to the host after paint so it can anchor native overlays.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const root = wrapRef.current
    if (!root) return
    const tiles: { deviceId: number; rect: TileRect }[] = []
    root.querySelectorAll<HTMLElement>('[data-device-id]').forEach((el) => {
      const id = Number(el.dataset.deviceId)
      const r = el.getBoundingClientRect()
      tiles.push({ deviceId: id, rect: { x: r.x, y: r.y, w: r.width, h: r.height } })
    })
    if (tiles.length) postToHost(layoutMsg(tiles))
  }, [wall, visibleDevices])

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        display: 'flex',
        // The ONE place leftover space lives: this centres the block below, so
        // the black is a border. Deliberately NOT `flex-wrap` — a wrap container
        // hands leftover cross-axis space to its lines, which is what put a band
        // between the rows instead of around them.
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {activeOnly && visibleDevices.length === 0 && (
        <div
          style={{
            color: '#a1a1aa',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            padding: 24,
            textAlign: 'center',
          }}
        >
          {labels.noActiveCameras}
        </div>
      )}
      {/* The CONTIGUOUS block: exactly its cells (cols×cellW by rows×cellH), so
          no gap is expressible inside it. A partial last row centres on its own
          within the block's width. Every tile is a SIBLING under one parent and
          keyed by device id — see `GridWallSurface` for why the rows this
          replaced could not survive a camera joining the wall. */}
      <GridWallSurface
        wall={wall}
        renderTile={(deviceId, cellW, cellH) => (
          <GridTilePlayer
            system={system}
            probeAuthToken={config.token}
            deviceId={deviceId}
            name={names[deviceId]?.name ?? `${labels.camera} ${deviceId}`}
            online={names[deviceId]?.online ?? false}
            quality={quality}
            muted={!audioOnIds.has(deviceId)}
            paused={pausedIds.has(deviceId)}
            showName={showName}
            audioActive={audioOnIds.has(deviceId)}
            micActive={intercom.activeMicId === deviceId}
            onTogglePause={(id) => postToHost(pauseToggleMsg(id))}
            onToggleAudio={(id) => postToHost(audioToggleMsg(id))}
            onToggleMic={intercom.toggleMic}
            onOpen={(id) => postToHost(tileOpenMsg(id))}
            ptzSupported={ptzSet.has(deviceId)}
            onPtz={(id) => postToHost(ptzOpenMsg(id))}
            // The tile's secondary actions are HOST panels (linked devices, the
            // shared per-camera view-options menu, or — on a cell too small for
            // both buttons — the list that offers them). The cell size decides
            // which of those the tile draws.
            cellW={cellW}
            cellH={cellH}
            // Withheld when the host said it has nowhere to show those
            // panels: the tile draws the discs only when the callback exists.
            onCellPanel={
              config.cellPanels === false
                ? undefined
                : (id, panel) => postToHost(cellPanelOpenMsg(id, panel))
            }
            highlight={highlight}
            showBoxes={showBoxes}
            overlay={overlays[String(deviceId)]}
            reconnectSignal={reconnectNonce}
            posterUrl={snapshots[String(deviceId)]}
            // The wall is the operator's VIEW only when the host says so: a
            // saved grid's membership and arrangement belong to the grid, and a
            // control whose message that host ignores is dead chrome.
            editable={config.editable === true}
            span={spans[String(deviceId)]}
            onRemove={(id) => postToHost(tileRemoveMsg(id))}
            onResize={(id, cw, ch) => postToHost(tileResizeMsg(id, cw, ch))}
            labels={labels}
          />
        )}
      />
    </div>
  )
}

export function EmbedGridPage() {
  // Config sources, in order: host-injected global (native WebView) → iframe
  // handshake (web host) → standalone share URL (top-level window; params in
  // the query, token in the stripped `#t=` fragment — see embed-url-config).
  const configResult = useEmbedConfig(
    'grid',
    () => (window as unknown as { __CAMSTACK_GRID__?: unknown }).__CAMSTACK_GRID__,
    parseGridConfig,
    readGridUrlConfig,
  )
  const built = useMemo(() => {
    if (configResult === null || !configResult.ok) return null
    const system = createSystem({
      serverUrl: configResult.config.serverUrl,
      token: configResult.config.token,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })
    return { system, queryClient }
  }, [configResult])

  useEffect(() => {
    if (!built) return
    return () => built.system.close()
  }, [built])

  if (configResult === null) return null
  if (!configResult.ok) return <FatalError message={configResult.error} />
  if (!built) return <FatalError message="Failed to initialise the grid embed" />

  return (
    <SystemProvider system={built.system}>
      <QueryClientProvider client={built.queryClient}>
        <trpc.Provider client={built.system.trpcClient} queryClient={built.queryClient}>
          <PaletteBridge system={built.system} />
          <Grid system={built.system} config={configResult.config} />
        </trpc.Provider>
      </QueryClientProvider>
    </SystemProvider>
  )
}
