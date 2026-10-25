/**
 * GridLiveEmbed (web) — the shared multi-camera grid in an `<iframe>` loading the
 * stream-broker embed (`?mode=grid`). Same props/callbacks as the native
 * `GridLiveEmbed.tsx`; uses the web postMessage bridge instead of RN
 * injectedJavaScript. Reconnect self-heals on browser online/visibility events.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RotateCw } from '../lib/icons.js'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { GridDeviceInfo } from '../components/grid/GridDeviceInfo.js'
import { SPACING } from '../theme/tokens.js'
import type { GridQuality, GridLayout } from '../store/grid-store.js'
import { buildGridEmbedConfig, type GridHighlightEmbedConfig } from './embed-config.js'
import { buildTileLabels } from './tile-labels.js'
import {
  coerceGridHostMessage,
  GRID_HOT_DEVICES_COMMAND,
  GRID_SPANS_COMMAND,
  type CellPanelRequest,
  type GridCellSpan,
  type GridReportState,
  type TileRect,
} from './embed-messages.js'
import { useGridEmbedPlaybackSink } from './use-grid-embed-playback.js'
import { useEmbedIframe } from '../live/use-embed-iframe.js'
import { useScreenWakeLock } from '../live/use-screen-wake-lock.js'

interface GridLiveEmbedProps {
  readonly devices: readonly number[]
  readonly quality: GridQuality
  readonly layout: GridLayout
  readonly showName: boolean
  readonly audioOnIds: readonly number[]
  readonly pausedIds: readonly number[]
  readonly highlight?: GridHighlightEmbedConfig
  readonly activeOnly?: boolean
  /** Live detection bounding-box overlay on every tile (session toggle). */
  readonly showBoxes?: boolean
  readonly ptzIds?: readonly number[]
  readonly onTileTap?: (deviceId: number, rect: TileRect) => void
  readonly onTileLongPress?: (deviceId: number, rect: TileRect) => void
  readonly onTileOpen?: (deviceId: number) => void
  readonly onAudioToggle?: (deviceId: number) => void
  readonly onPauseToggle?: (deviceId: number) => void
  readonly onPtzOpen?: (deviceId: number) => void
  /** An in-tile secondary button (linked devices / view options), or a row of
   *  the compact "more" list → the host mounts the matching panel. */
  readonly onCellPanelOpen?: (panel: CellPanelRequest, deviceId: number) => void
  /** This wall is the operator's VIEW: cells carry a remove control and resize
   *  grips. Pass it only where this host answers the two callbacks below. */
  readonly editable?: boolean
  /** Per-camera size in TRACKS, keyed by device id (string). Reaches the page
   *  only once it has named the command — see {@link GRID_SPANS_COMMAND}. */
  readonly spans?: Readonly<Record<string, GridCellSpan>>
  readonly onTileRemove?: (deviceId: number) => void
  readonly onTileResize?: (deviceId: number, cw: number, ch: number) => void
  readonly onStateChange?: (state: GridReportState) => void
}

export function GridLiveEmbed(props: GridLiveEmbedProps) {
  const { devices, quality, layout, showName, audioOnIds, pausedIds, highlight, activeOnly, showBoxes, ptzIds, editable, spans } = props
  const { server, token } = useServer()
  const { colors } = useTheme()
  const { t } = useTranslation()
  // A wall of live pictures keeps the screen on — same reason as the single
  // player host (`LiveView.web.tsx`).
  useScreenWakeLock()
  const [state, setState] = useState<GridReportState>('connecting')
  // Whether the page in the iframe named `setDevices` in its ready report, and
  // the nonce that reloads it when it did not. Same contract as the native
  // twin — see `GridLiveEmbed.tsx`.
  const [hotDevices, setHotDevices] = useState(false)
  /** Whether the page named the SPAN command. Its absence is NOT a reload — an
   *  evenly distributed wall is a correct wall. */
  const [hotSpans, setHotSpans] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  // The page's words, translated HERE — the embed has no i18n and is not
  // getting one (`tile-labels.ts`). Memoised on `t`, whose identity moves when
  // the language does and only then: the iframe re-runs its config handshake on
  // a fresh config object, and rebuilding sixteen strings per render would make
  // it do so for nothing.
  const labels = useMemo(() => buildTileLabels(t), [t])

  const serverUrl = server?.serverUrl ?? null

  const buildConfig = useCallback(
    () =>
      serverUrl
        ? buildGridEmbedConfig({
            serverUrl,
            token: token ?? '',
            deviceIds: devices,
            options: { showName, quality, layout },
            muted: true,
            paused: false,
            highlight,
            activeOnly,
            showBoxes,
            audioOnIds,
            pausedIds,
            ptzIds,
            editable,
            spans,
            labels,
          })
        : {},
    [serverUrl, token, devices, showName, quality, layout, highlight, activeOnly, showBoxes, audioOnIds, pausedIds, ptzIds, editable, spans, labels],
  )

  const onHostMessage = useCallback(
    (data: unknown): void => {
      const msg = coerceGridHostMessage(data)
      if (!msg) return
      switch (msg.type) {
        case 'state':
          setState(msg.state)
          if (msg.commands?.includes(GRID_HOT_DEVICES_COMMAND)) setHotDevices(true)
          if (msg.commands?.includes(GRID_SPANS_COMMAND)) setHotSpans(true)
          props.onStateChange?.(msg.state)
          break
        case 'tileTap':
          props.onTileTap?.(msg.deviceId, msg.rect)
          break
        case 'tileLongPress':
          props.onTileLongPress?.(msg.deviceId, msg.rect)
          break
        case 'tileOpen':
          props.onTileOpen?.(msg.deviceId)
          break
        case 'audioToggle':
          props.onAudioToggle?.(msg.deviceId)
          break
        case 'pauseToggle':
          props.onPauseToggle?.(msg.deviceId)
          break
        case 'ptzOpen':
          props.onPtzOpen?.(msg.deviceId)
          break
        case 'cellPanelOpen':
          props.onCellPanelOpen?.(msg.panel, msg.deviceId)
          break
        case 'tileRemove':
          props.onTileRemove?.(msg.deviceId)
          break
        case 'tileResize':
          props.onTileResize?.(msg.deviceId, msg.cw, msg.ch)
          break
        case 'layout':
          break
      }
    },
    [props],
  )

  const { iframeRef, src, postCommand, reload } = useEmbedIframe({
    serverUrl,
    mode: 'grid',
    buildConfig,
    onHostMessage,
  })

  // The grid TIMELINE's player surface — same single-sink reasoning as the
  // native embed; the transport here is the iframe postMessage bridge.
  useGridEmbedPlaybackSink(postCommand)

  // The iframe runs the `embed-ready`→`embed-config` handshake ONCE on load, so
  // the set the CURRENT document booted with is the set at its last load.
  // `setDevices` moves a later change across without a fresh boot: the tiles
  // that stay keep their peers. The reload is kept only for a page too old to
  // have named the command (an unknown command is a silent no-op, and for the
  // device set that means the wrong cameras for ever).
  const devicesKey = devices.join(',')
  /** The set the document in the iframe right now was booted or updated with. */
  const bootedDevicesRef = useRef(devicesKey)
  useEffect(() => {
    if (devicesKey === bootedDevicesRef.current) return
    bootedDevicesRef.current = devicesKey
    if (hotDevices) {
      postCommand({ kind: 'setDevices', value: devices })
      return
    }
    // The cascade is the point: a device set this page cannot take hot has
    // to reach it through a fresh document, and the injected config this
    // render already rebuilt is what carries it. One extra render, only on
    // the path that used to remount on EVERY change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReloadNonce((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicesKey, hotDevices, postCommand])

  // Serialised rather than by identity: the host rebuilds the map every render,
  // and this fires on every frame of a resize drag.
  const spansKey = JSON.stringify(spans ?? {})
  useEffect(() => {
    if (!hotSpans) return
    postCommand({ kind: 'setSpans', value: spans ?? {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spansKey, hotSpans])

  const audioKey = audioOnIds.join(',')
  const pausedKey = pausedIds.join(',')
  useEffect(() => postCommand({ kind: 'setAudioOn', value: audioOnIds }), [audioKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postCommand({ kind: 'setPaused', value: pausedIds }), [pausedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postCommand({ kind: 'setQuality', value: quality }), [quality, postCommand])
  useEffect(() => postCommand({ kind: 'setLayout', value: layout }), [layout, postCommand])
  useEffect(() => postCommand({ kind: 'setShowName', value: showName }), [showName, postCommand])
  useEffect(() => {
    if (highlight) postCommand({ kind: 'setHighlight', value: highlight })
  }, [highlight, postCommand])
  useEffect(() => postCommand({ kind: 'setActiveOnly', value: activeOnly ?? false }), [activeOnly, postCommand])
  useEffect(() => postCommand({ kind: 'setShowBoxes', value: showBoxes ?? false }), [showBoxes, postCommand])

  useEffect(() => {
    const onOnline = (): void => postCommand({ kind: 'reconnect' })
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') postCommand({ kind: 'reconnect' })
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [postCommand])

  const handleRetry = useCallback((): void => {
    setState('connecting')
    reload()
  }, [reload])

  if (!src) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      { }
      <iframe
        // NOT keyed on the device set: that is what `setDevices` replaced. The
        // nonce only moves when a page that cannot take the set hot needs the
        // config handshake re-run — see the effect above.
        key={reloadNonce}
        ref={iframeRef}
        src={src}
        title="camera-grid"
        allow="microphone; autoplay; fullscreen"
        style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      />
      {state !== 'ready' && (
        <View style={styles.overlay} pointerEvents={state === 'error' ? 'auto' : 'none'}>
          {state === 'connecting' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{t('v2.live.connecting')}</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
              <Pressable onPress={handleRetry} style={[styles.retryButton, { borderColor: colors.border }]}>
                <RotateCw size={16} color={colors.foreground} />
                <Text style={[styles.retryLabel, { color: colors.foreground }]}>{t('v2.live.retry')}</Text>
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
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  hint: { fontSize: 13, textAlign: 'center' },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryLabel: { fontSize: 13, fontWeight: '600' },
})
