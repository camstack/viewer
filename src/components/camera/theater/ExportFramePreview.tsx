/**
 * ExportFramePreview — a small still preview of ONE export-range extreme
 * (start or end). Fetches a single JPEG from the recorder's on-demand still
 * data-plane (`/addon/recorder/still/<deviceId>/<epochSec>`): the server decodes
 * the frame nearest the given instant from the recorded LOW footage (a stateless
 * ffmpeg one-shot). No client video decode — works on every platform.
 *
 * Falls back to a labelled placeholder when the still fails to load (footage
 * absent → the route replies 204 → image error) so the export dialog always
 * shows both extremes.
 */
import React, { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { ImageOff } from '../../../lib/icons.js'
import { useServer } from '../../../app/ServerProvider.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import {
  buildStillMediaUrl,
  isStillPreviewFailed,
  type StillBound,
} from '../../../data/still-media-url.js'

export interface ExportFramePreviewProps {
  readonly deviceId: number
  /** The epoch (ms) to preview — an export-range extreme. */
  readonly atMs: number
  /** Inclusive start vs exclusive end — end snaps inward to avoid a 204. */
  readonly bound?: StillBound
  /** Caption above the frame (e.g. localized "Start" / "End"). */
  readonly caption: string
  /** Shorter frame so two stills + two heatmaps fit the export panel. */
  readonly compact?: boolean
}

/** Height of a compact still (export panel). Full stills keep 16:9. */
export const COMPACT_STILL_HEIGHT_PX = 96

/** Clock label (HH:MM:SS) for the previewed epoch. */
function clockLabel(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function ExportFramePreview({
  deviceId,
  atMs,
  bound = 'start',
  caption,
  compact = false,
}: ExportFramePreviewProps) {
  const { colors } = useTheme()
  const { token } = useServer()
  const { controller, state } = useConnection()
  const [failedAtMs, setFailedAtMs] = useState<number | null>(null)
  const failed = isStillPreviewFailed(failedAtMs, atMs)

  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const uri = serverUrl !== null ? buildStillMediaUrl(serverUrl, deviceId, atMs, bound) : null
  const headers: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined

  return (
    <View style={styles.col}>
      <Text style={[styles.caption, { color: colors.foregroundMuted }]} numberOfLines={1}>
        {caption}
      </Text>
      <View
        style={[
          styles.frame,
          compact ? styles.frameCompact : styles.frameDefault,
          { backgroundColor: colors.surfaceHover, borderColor: colors.border },
        ]}
      >
        {uri !== null && !failed ? (
          <Image
            key={uri}
            source={headers ? { uri, headers } : { uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            onError={() => setFailedAtMs(atMs)}
          />
        ) : (
          <View style={styles.placeholder}>
            <ImageOff size={20} color={colors.foregroundSubtle} />
          </View>
        )}
      </View>
      <Text style={[styles.time, { color: colors.foregroundSubtle }]} numberOfLines={1}>
        {clockLabel(atMs)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  col: { flex: 1, gap: SPACING.xs },
  caption: { fontSize: 11, fontWeight: '600' },
  frame: {
    width: '100%',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameDefault: { aspectRatio: 16 / 9 },
  frameCompact: { height: COMPACT_STILL_HEIGHT_PX },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 11, fontVariant: ['tabular-nums'] },
})
