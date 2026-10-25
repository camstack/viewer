/**
 * GridLiveEmbed (iOS/native) — the shared multi-camera grid rendered inside ONE
 * `WKWebView` loading the OTA-bundled embed page (N WebRTC peers, one SPA boot).
 * Mirrors `LiveViewWebView` but for the
 * grid: it injects `window.__CAMSTACK_GRID__`, forwards grid-wide commands via
 * `window.__camstackGrid`, and routes per-tile tap/long-press back to the host.
 *
 * AUTH: the embed bundle is served `access:'public'` (a non-sensitive app shell).
 * It loads the public app shell with no token on the navigation or cookie. The
 * token lives ONLY in the injected body config (`window.__CAMSTACK_GRID__`) and
 * gates the actual data at the SDK/tRPC layer; with no token the page renders a
 * config-error and fetches nothing.
 *
 * TLS caveat (same as LiveViewWebView): WKWebView rejects untrusted certs — the
 * operator must use a trusted cert (or http) for the hub origin.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  AppState,
  type AppStateStatus,
  type LayoutChangeEvent,
} from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { useTranslation } from 'react-i18next'
import { RotateCw } from '../lib/icons.js'
import { useServer } from '../app/ServerProvider.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { useTheme } from '../theme/theme-provider.js'
import { GridDeviceInfo } from '../components/grid/GridDeviceInfo.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import type { GridQuality, GridLayout } from '../store/grid-store.js'
import {
  buildGridEmbedConfig,
  type GridHighlightEmbedConfig,
  type TileOverlayEmbedConfig,
} from './embed-config.js'
import { buildTileLabels } from './tile-labels.js'
import { useNativeEmbedSource } from '../live/use-native-embed-source.js'
import {
  parseGridHostMessage,
  gridCommandScript,
  GRID_HOT_DEVICES_COMMAND,
  GRID_SPANS_COMMAND,
  type CellPanelRequest,
  type GridCellSpan,
  type GridCommand,
  type GridReportState,
  type TileRect,
} from './embed-messages.js'
import { useGridEmbedPlaybackSink } from './use-grid-embed-playback.js'

interface GridLiveEmbedProps {
  readonly devices: readonly number[]
  readonly quality: GridQuality
  readonly layout: GridLayout
  readonly showName: boolean
  /** Combinable audio: device ids whose audio is ON (host-owned set). */
  readonly audioOnIds: readonly number[]
  /** Paused tiles — host-owned set (drives the bar's mass play/pause). */
  readonly pausedIds: readonly number[]
  /** Per-grid highlight config (enabled + triggers); omit to disable. */
  readonly highlight?: GridHighlightEmbedConfig
  /** Show only currently-active cameras (motion/audio/detection per highlight). */
  readonly activeOnly?: boolean
  /** Live detection bounding-box overlay on every tile (session toggle). */
  readonly showBoxes?: boolean
  /** Device ids that support PTZ → tiles show an in-tile PTZ button. */
  readonly ptzIds?: readonly number[]
  /** Per-device indicators (motion regions, motion pill, audio meter,
   *  occupancy, stats) as each camera's own view-options menu set them. The
   *  page draws them per tile — the cell menu may only offer what something
   *  paints, and on this platform that is the embed. */
  readonly overlays?: Readonly<Record<string, TileOverlayEmbedConfig>>
  readonly onTileTap?: (deviceId: number, rect: TileRect) => void
  readonly onTileLongPress?: (deviceId: number, rect: TileRect) => void
  /** The in-tile "open" button → navigate to the camera detail. */
  readonly onTileOpen?: (deviceId: number) => void
  /** The in-tile audio button → host toggles this camera in the audio set. */
  readonly onAudioToggle?: (deviceId: number) => void
  /** The in-tile pause button → host toggles this camera in the paused set. */
  readonly onPauseToggle?: (deviceId: number) => void
  /** The in-tile PTZ button → host opens the native PTZ controls for this camera. */
  readonly onPtzOpen?: (deviceId: number) => void
  /** An in-tile secondary button (linked devices / view options), or a row of
   *  the compact "more" list → the host mounts the matching panel. The page
   *  hosts none of these: they are the app's own components, shared with the
   *  single-camera view. */
  readonly onCellPanelOpen?: (panel: CellPanelRequest, deviceId: number) => void
  /**
   * This wall is a VIEW the operator is building, not a saved grid: its cells
   * carry a remove control and resize grips. Only pass it where this host
   * actually answers `onTileRemove` / `onTileResize` — a control whose message
   * nobody acts on is dead chrome, and the page cannot tell from here.
   */
  readonly editable?: boolean
  /** Per-camera size in TRACKS, keyed by device id (string). Reaches the page
   *  only once it has named the command — see {@link GRID_SPANS_COMMAND}. */
  readonly spans?: Readonly<Record<string, GridCellSpan>>
  /** A cell's remove control → drop THIS camera and keep the others. */
  readonly onTileRemove?: (deviceId: number) => void
  /** A cell's resize grip → this camera should be `cw × ch` tracks. The host
   *  owns the value; pushing the result back is what the page draws. */
  readonly onTileResize?: (deviceId: number, cw: number, ch: number) => void
  readonly onStateChange?: (state: GridReportState) => void
}

export function GridLiveEmbed({
  devices,
  quality,
  layout,
  showName,
  audioOnIds,
  pausedIds,
  highlight,
  activeOnly,
  showBoxes,
  ptzIds,
  overlays,
  onTileTap,
  onTileLongPress,
  onTileOpen,
  onAudioToggle,
  onPauseToggle,
  onPtzOpen,
  onCellPanelOpen,
  editable,
  spans,
  onTileRemove,
  onTileResize,
  onStateChange,
}: GridLiveEmbedProps) {
  const { token } = useServer()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const webViewRef = useRef<WebView>(null)
  const [state, setState] = useState<GridReportState>('connecting')

  const serverUrl = useLiveHubUrl()

  // Auth rides in the injected body config, never on the local asset URI.
  const { source, readAccessUri, reportLoadFailure, reportEmbedAlive } = useNativeEmbedSource(serverUrl, 'grid')

  // The embed injects `window.__CAMSTACK_GRID__` (incl. the device list) ONCE,
  // before content loads — so the set the CURRENT document booted with is the
  // set at its last (re)load, not the current prop. `setDevices` moves the
  // difference across without touching the document: the tiles that stay keep
  // their peers, and only the added camera negotiates.
  //
  // The reload path is kept, not deleted, for the one case that still needs it:
  // a page too old to have named the command. `gridCommandScript` probes the
  // METHOD, so an unknown command is a silent no-op — harmless for an option,
  // and for the device set it would mean the wall shows the wrong cameras until
  // something else happens to remount it. So: hot when the page said it can,
  // a clean reload (exactly what shipped before) when it did not.
  const devicesKey = devices.join(',')
  const [hotDevices, setHotDevices] = useState(false)
  /** Whether the page named the SPAN command. Its absence is deliberately NOT a
   *  reload: an evenly distributed wall is a correct wall, and blanking every
   *  peer to deliver an arrangement would cost more than the arrangement. */
  const [hotSpans, setHotSpans] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  /** The set the document on screen right now was booted or updated with. */
  const bootedDevicesRef = useRef(devicesKey)

  // The page's words, translated HERE — the embed has no i18n and is not
  // getting one (`tile-labels.ts`). Memoised on `t`, whose identity moves when
  // the language does and only then.
  const labels = useMemo(() => buildTileLabels(t), [t])

  // The injected config seeds the INITIAL grid state; later changes flow in as
  // commands (below) without reloading. Built once per (serverUrl, token,
  // devices) identity — option changes are pushed via commands, not re-injection.
  const injectedBefore =
    serverUrl !== null
      ? `window.__CAMSTACK_EMBED_MODE__ = 'grid'; window.__CAMSTACK_GRID__ = ${JSON.stringify(
          buildGridEmbedConfig({
            serverUrl,
            token: token ?? '',
            deviceIds: devices,
            options: { showName, quality, layout },
            // Audio is driven by audioOnIds; pause by pausedIds. The legacy
            // `muted`/`paused` flags are ignored by the embed (config-shape compat).
            muted: true,
            paused: false,
            highlight,
            activeOnly,
            showBoxes,
            audioOnIds,
            pausedIds,
            ptzIds,
            overlays,
            editable,
            spans,
            labels,
          }),
        )}; true;`
      : undefined

  // RN-measured WebView frame → the embed's `fit(w,h)` (WKWebView innerHeight is
  // stale on rotation; the host is authoritative for sizing). Kept in a ref so we
  // can re-apply after (re)load.
  const frameRef = useRef<{ w: number; h: number } | null>(null)
  const applyFrame = useCallback((): void => {
    const f = frameRef.current
    if (!f) return
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'fit', w: f.w, h: f.h }))
  }, [])
  const handleLayout = useCallback(
    (e: LayoutChangeEvent): void => {
      const w = Math.round(e.nativeEvent.layout.width)
      const h = Math.round(e.nativeEvent.layout.height)
      const prev = frameRef.current
      if (prev && prev.w === w && prev.h === h) return
      frameRef.current = { w, h }
      applyFrame()
    },
    [applyFrame],
  )

  // Grid-wide commands — pushed on prop changes WITHOUT reloading the page.
  // Audio set: re-push when membership changes (keyed by the joined ids so a new
  // array identity with the same contents doesn't re-inject).
  const audioKey = audioOnIds.join(',')
  const pausedKey = pausedIds.join(',')
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setAudioOn', value: audioOnIds }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setPaused', value: pausedIds }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedKey])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setQuality', value: quality }))
  }, [quality])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setLayout', value: layout }))
  }, [layout])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setShowName', value: showName }))
  }, [showName])
  useEffect(() => {
    if (highlight) {
      webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setHighlight', value: highlight }))
    }
  }, [highlight])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setActiveOnly', value: activeOnly ?? false }))
  }, [activeOnly])
  useEffect(() => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'setShowBoxes', value: showBoxes ?? false }))
  }, [showBoxes])
  // Per-device indicators. Keyed by the SERIALISED map, not its identity: the
  // host rebuilds it from the prefs store on every render, and re-injecting an
  // identical map on each one would cross the bridge for nothing.
  const overlaysKey = JSON.stringify(overlays ?? {})
  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      gridCommandScript({ kind: 'setOverlays', value: overlays ?? {} }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlaysKey])

  // Fast reconnect WITHOUT reloading the WebView: the embed bumps every tile's
  // reconnectSignal, so each player tears down + reconnects while keeping its
  // last decoded frame on screen (no black flash, no covering loader). A reload
  // would blank every tile + re-boot the SPA — only used as the manual retry.
  // The grid TIMELINE's player surface. One sink for the whole wall: the page
  // applies a grid-wide playback command to every tile itself, so this is one
  // channel, not N. Registered for as long as the embed is mounted.
  const sendCommand = useCallback((cmd: GridCommand): void => {
    webViewRef.current?.injectJavaScript(gridCommandScript(cmd))
  }, [])
  useGridEmbedPlaybackSink(sendCommand)

  // Keyed by the SERIALISED map for the same reason `overlays` is: the host
  // rebuilds it from the store on every render, and re-injecting an identical
  // arrangement on each one would cross the bridge for nothing — on a path that
  // fires on every frame of a resize drag.
  const spansKey = JSON.stringify(spans ?? {})
  useEffect(() => {
    if (!hotSpans) return
    sendCommand({ kind: 'setSpans', value: spans ?? {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spansKey, hotSpans])

  useEffect(() => {
    if (devicesKey === bootedDevicesRef.current) return
    bootedDevicesRef.current = devicesKey
    if (hotDevices) {
      sendCommand({ kind: 'setDevices', value: devices })
      return
    }
    // No hot channel on this page: re-run the injected config, which this
    // render already rebuilt with the fresh set.
    // The cascade is the point: a device set this page cannot take hot has
    // to reach it through a fresh document, and the injected config this
    // render already rebuilt is what carries it. One extra render, only on
    // the path that used to remount on EVERY change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReloadNonce((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicesKey, hotDevices, sendCommand])

  const reconnect = useCallback((): void => {
    webViewRef.current?.injectJavaScript(gridCommandScript({ kind: 'reconnect' }))
  }, [])

  // Self-heal after backgrounding (iOS suspends the WKWebView + kills peers).
  // Reconnect (keep the last frame) rather than reload (blank) — the SPA itself
  // survives the suspend; only the WebRTC peers need re-establishing.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current
      appStateRef.current = next
      if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        reconnect()
      }
    })
    return () => sub.remove()
  }, [reconnect])

  // Self-heal on a network transition (Wi-Fi↔cellular, or offline→online): the
  // old ICE path is dead after the interface changes, so trigger a fast
  // reconnect (keep the last frame). We act only on a MEANINGFUL transition —
  // becoming reachable, or the transport type changing — so steady-state
  // NetInfo chatter (signal-strength updates etc.) doesn't churn the peers.
  const netRef = useRef<{ isConnected: boolean | null; type: string } | null>(null)
  useEffect(() => {
    const onChange = (s: NetInfoState): void => {
      const prev = netRef.current
      const cur = { isConnected: s.isConnected, type: s.type }
      netRef.current = cur
      if (!prev) return // seed the baseline on the first emission; don't reconnect
      const becameReachable = prev.isConnected !== true && cur.isConnected === true
      const transportChanged = cur.isConnected === true && prev.type !== cur.type
      if (becameReachable || transportChanged) reconnect()
    }
    const sub = NetInfo.addEventListener(onChange)
    return () => sub()
  }, [reconnect])

  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      // Proof the page's script is running — see `reportEmbedAlive`.
      reportEmbedAlive()
      const msg = parseGridHostMessage(event.nativeEvent.data)
      if (!msg) return
      switch (msg.type) {
        case 'state':
          setState(msg.state)
          // The page names the commands it implements when it reports ready.
          // Absent = an older build; the host keeps reloading for it.
          if (msg.commands?.includes(GRID_HOT_DEVICES_COMMAND)) setHotDevices(true)
          if (msg.commands?.includes(GRID_SPANS_COMMAND)) setHotSpans(true)
          onStateChange?.(msg.state)
          break
        case 'tileTap':
          onTileTap?.(msg.deviceId, msg.rect)
          break
        case 'tileLongPress':
          onTileLongPress?.(msg.deviceId, msg.rect)
          break
        case 'tileOpen':
          onTileOpen?.(msg.deviceId)
          break
        case 'audioToggle':
          onAudioToggle?.(msg.deviceId)
          break
        case 'pauseToggle':
          onPauseToggle?.(msg.deviceId)
          break
        case 'ptzOpen':
          onPtzOpen?.(msg.deviceId)
          break
        case 'cellPanelOpen':
          onCellPanelOpen?.(msg.panel, msg.deviceId)
          break
        case 'tileRemove':
          onTileRemove?.(msg.deviceId)
          break
        case 'tileResize':
          onTileResize?.(msg.deviceId, msg.cw, msg.ch)
          break
        case 'layout':
          // Tile rects (for native overlay anchoring) — consumed by the screen
          // if it tracks them; no-op here.
          break
      }
    },
    [
      onTileTap,
      onTileLongPress,
      onTileOpen,
      onAudioToggle,
      onPauseToggle,
      onPtzOpen,
      onCellPanelOpen,
      onTileRemove,
      onTileResize,
      onStateChange,
    ],
  )

  const handleLoadError = useCallback((): void => {
    // The page never rendered: point the next attempt at the hub's copy so a
    // WebView that cannot read the bundled file still shows video.
    reportLoadFailure()
    setState('error')
  }, [reportLoadFailure])

  const handleRetry = useCallback((): void => {
    setState('connecting')
    webViewRef.current?.reload()
  }, [])

  if (!source) {
    return (
      <View style={[styles.container, { borderColor: colors.border }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.container, { borderColor: colors.border }]} onLayout={handleLayout}>
      <WebView
        // NOT keyed on the device set: that is what `setDevices` replaced. The
        // nonce only moves when a page that cannot take the set hot needs the
        // injected config re-run — see the effect above.
        key={reloadNonce}
        ref={webViewRef}
        source={source}
        {...(readAccessUri === null ? {} : { allowingReadAccessToURL: readAccessUri })}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        onMessage={handleMessage}
        onLoadEnd={applyFrame}
        onError={handleLoadError}
        onHttpError={handleLoadError}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Auto-grant the WebView's getUserMedia (mic) request for talk-back —
        // the OS-level mic permission prompt (NSMicrophoneUsageDescription) is
        // still shown once; this only suppresses the per-page WebKit gate.
        mediaCapturePermissionGrantType="grant"
        style={styles.web}
        containerStyle={styles.web}
      />

      {state !== 'ready' && (
        <View style={styles.overlay} pointerEvents={state === 'error' ? 'auto' : 'none'}>
          {state === 'connecting' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                {t('v2.live.connecting')}
              </Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
              <Pressable
                onPress={handleRetry}
                style={[styles.retryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t('v2.live.retry')}
              >
                <RotateCw size={16} color={colors.foreground} />
                <Text style={[styles.retryLabel, { color: colors.foreground }]}>
                  {t('v2.live.retry')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {/* The embed is one WebView/iframe: the app draws the device pill OVER it. */}
      <GridDeviceInfo />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  web: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
})
