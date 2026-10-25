/**
 * StreamStatsOverlay — a compact live read-out of stream health over the video.
 *
 * Polls the player's `getStats()` (~1 Hz) and renders the available fields. The
 * native WebRTC player reports the full set (bitrate / packet loss / jitter /
 * fps / resolution / codec, `source:'webrtc'`); the WebView player can only read
 * HTMLVideo playback quality (resolution / fps / dropped frames,
 * `source:'playback'`) because the embed's RTCPeerConnection isn't exposed — in
 * that case a hint row notes that full WebRTC stats need the native player.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { StreamStats } from '../../live/live-view-types.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useStyleScaler } from './overlay/OverlayFrame.js'
import { ANCHOR_PLACEMENT, type OverlayAnchor } from './overlay/overlay-position.js'

export interface StreamStatsOverlayProps {
  readonly getStats: () => Promise<StreamStats | null>
  /** Where the read-out sits — the operator's per-camera choice, placed by the
   *  same `ANCHOR_PLACEMENT` map as every other overlay. */
  readonly position: OverlayAnchor
  /** ONE line instead of the panel — for a GRID CELL, where the 150-220pt card
   *  would cover the picture it is describing. The knob stays alive at every
   *  cell size: shrinking the read-out is an answer, hiding it is not. */
  readonly compact?: boolean
}

/** The one-line form: the three numbers an operator scanning a wall reads. */
function compactLine(stats: StreamStats | null): string | null {
  if (!stats) return null
  const parts: string[] = []
  if (stats.resolution) parts.push(stats.resolution)
  if (stats.fps !== undefined) parts.push(`${stats.fps}fps`)
  if (stats.bitrateKbps !== undefined) parts.push(`${stats.bitrateKbps}k`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Poll cadence for the stats read-out. */
const POLL_MS = 1000

export function StreamStatsOverlay({ getStats, position, compact = false }: StreamStatsOverlayProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const [stats, setStats] = useState<StreamStats | null>(null)
  const backdrop = { backgroundColor: `${colors.background}B3` }

  useEffect(() => {
    let active = true
    const tick = async (): Promise<void> => {
      const s = await getStats().catch(() => null)
      if (active) setStats(s)
    }
    void tick()
    const iv = setInterval(() => void tick(), POLL_MS)
    return () => {
      active = false
      clearInterval(iv)
    }
  }, [getStats])

  if (compact) {
    const line = compactLine(stats)
    return (
      <View
        style={[styles.anchor, ANCHOR_PLACEMENT[position]]}
        pointerEvents="none"
        testID="stream-stats-overlay"
      >
        <View style={[sx(styles.compact), backdrop]}>
          <Text style={[sx(styles.compactText), { color: colors.foreground }]} numberOfLines={1}>
            {line ?? t('v2.stats.waiting')}
          </Text>
        </View>
      </View>
    )
  }

  const rows: { label: string; value: string }[] = []
  if (stats) {
    if (stats.resolution) rows.push({ label: t('v2.stats.resolution'), value: stats.resolution })
    if (stats.fps !== undefined) rows.push({ label: t('v2.stats.fps'), value: String(stats.fps) })
    if (stats.bitrateKbps !== undefined)
      rows.push({ label: t('v2.stats.bitrate'), value: `${stats.bitrateKbps} kbps` })
    if (stats.packetsLost !== undefined)
      rows.push({ label: t('v2.stats.packetLoss'), value: String(stats.packetsLost) })
    if (stats.jitterMs !== undefined)
      rows.push({ label: t('v2.stats.jitter'), value: `${stats.jitterMs} ms` })
    if (stats.codec) rows.push({ label: t('v2.stats.codec'), value: stats.codec })
    if (stats.source === 'playback' && (stats.dropped !== undefined || stats.total !== undefined))
      rows.push({
        label: t('v2.stats.frames'),
        value: `${stats.dropped ?? 0}/${stats.total ?? 0}`,
      })
  }

  return (
    <View
      style={[styles.anchor, ANCHOR_PLACEMENT[position]]}
      pointerEvents="none"
      testID="stream-stats-overlay"
    >
      <View style={[sx(styles.panel), backdrop]}>
        <Text style={[sx(styles.title), { color: colors.warning }]}>{t('v2.stats.title')}</Text>
        {rows.length === 0 ? (
          <Text style={[sx(styles.dim), { color: colors.foregroundMuted }]}>{t('v2.stats.waiting')}</Text>
        ) : (
          rows.map((r) => (
            <View key={r.label} style={sx(styles.row)}>
              <Text style={[sx(styles.label), { color: colors.foregroundMuted }]}>{r.label}</Text>
              <Text style={[sx(styles.value), { color: colors.foreground }]}>{r.value}</Text>
            </View>
          ))
        )}
        {stats?.source === 'playback' ? (
          <Text style={[sx(styles.hint), { color: colors.foregroundDisabled }]}>
            {t('v2.stats.playbackHint')}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // The positioned box; the corner's edges come from `ANCHOR_PLACEMENT`.
  anchor: {
    position: 'absolute',
  },
  panel: {
    minWidth: 150,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  title: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 1,
  },
  // The grid-cell form: a single pill at the chosen anchor, never wider than
  // the cell it sits in.
  compact: {
    maxWidth: '100%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  compactText: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  label: { fontSize: 11 },
  value: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dim: { fontSize: 11 },
  hint: { fontSize: 9, marginTop: 4, maxWidth: 200 },
})
