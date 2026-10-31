/**
 * CursorFramesGrid — the Library timeline's "picture": one still per camera,
 * cut from the recording at the instant the cursor is on.
 *
 * It sits in `TheaterTimeline`'s stream slot, the place the player occupies on
 * camera-detail, and draws nothing live: each tile is the recorder's on-demand
 * still route (`data/still-media-url.ts`) for ITS camera at `instant`. Which
 * cameras get a tile, and when the instant is allowed to change, are
 * `cursor-frames.ts`'s — this file only lays them out and says what each tile
 * is (name, time) or why it has no picture (no footage at that instant).
 *
 * While a drag is in flight the grid keeps what it has: `instant` it receives
 * is already the settled one (`use-settled-instant.ts`), so no image request
 * leaves the device until the cursor has been released.
 */
import React, { useMemo, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'

import { useServer } from '../../app/ServerProvider.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { computeGridLayout, splitIntoRows } from '../../grid/auto-layout.js'
import { ImageOff } from '../../lib/icons.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { buildStillMediaUrl, isStillPreviewFailed } from '../../data/still-media-url.js'
import { frameTileCap, planFrameTiles } from './cursor-frames.js'

export interface FrameCamera {
  readonly id: number
  readonly name: string
}

export interface CursorFramesGridProps {
  /** The scope, in order. The grid cuts it at the cap. */
  readonly cameras: readonly FrameCamera[]
  /** The settled instant (epoch ms) every tile is cut at. */
  readonly instant: number
}

/** The grid's own padding around the tiles, and between them. */
const GAP = SPACING.sm

/** Test id of the whole grid, and of one tile (suffixed by the camera id). */
export const CURSOR_FRAMES_TEST_ID = 'timeline-cursor-frames'
export const CURSOR_FRAME_TILE_TEST_ID = 'timeline-cursor-frame'

/** The caption line of a tile (name + clock) — a fixed height so the layout
 *  can subtract it from the box before it computes the picture size. */
const CAPTION_HEIGHT = 22

function clock(atMs: number, locale: string): string {
  return new Date(atMs).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function CursorFramesGrid({ cameras, instant }: CursorFramesGridProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [box, setBox] = useState({ width: 0, height: 0 })

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  const plan = useMemo(() => planFrameTiles(cameras, frameTileCap(box.width)), [cameras, box.width])

  // The note under the grid ("+3 more") takes a line when the cap bit.
  const noteHeight = plan.hidden > 0 ? CAPTION_HEIGHT : 0
  const layout = useMemo(() => {
    const innerW = Math.max(0, box.width - GAP * 2)
    const innerH = Math.max(0, box.height - GAP * 2 - noteHeight)
    // The caption is part of the tile, so the picture's aspect is the tile's
    // (16:9 picture + one caption line), found by asking for a wider cell.
    return computeGridLayout(plan.shown.length, innerW, innerH, 'auto', 16 / 9)
  }, [plan.shown.length, box.width, box.height, noteHeight])
  const rows = useMemo(() => splitIntoRows(plan.shown, layout.cols), [plan.shown, layout.cols])

  return (
    <View testID={CURSOR_FRAMES_TEST_ID} style={styles.fill} onLayout={onLayout}>
      <View style={[styles.wall, { padding: GAP, gap: GAP }]}>
        {rows.map((row) => (
          <View key={row[0]?.id ?? 0} style={[styles.row, { gap: GAP }]}>
            {row.map((camera) => (
              <FrameTile
                key={camera.id}
                camera={camera}
                instant={instant}
                width={Math.max(0, layout.cellW - GAP)}
                height={Math.max(0, layout.cellH - GAP)}
              />
            ))}
          </View>
        ))}
        {plan.hidden > 0 ? (
          <Text style={[styles.note, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            {t('v2.timelineLibrary.moreCameras', { count: plan.hidden })}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

interface FrameTileProps {
  readonly camera: FrameCamera
  readonly instant: number
  readonly width: number
  readonly height: number
}

function FrameTile({ camera, instant, width, height }: FrameTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const { token } = useServer()
  const { controller, state } = useConnection()
  // Failure is latched to the instant that 204'd: a new instant retries.
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const failed = isStillPreviewFailed(failedAt, instant)

  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const uri = serverUrl !== null ? buildStillMediaUrl(serverUrl, camera.id, instant) : null
  const headers: Record<string, string> | undefined = token ? { Authorization: `Bearer ${token}` } : undefined

  return (
    <View
      testID={`${CURSOR_FRAME_TILE_TEST_ID}-${camera.id}`}
      style={[
        styles.tile,
        { width, height, backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.picture, { backgroundColor: colors.surfaceHover }]}>
        {uri !== null && !failed ? (
          <Image
            key={uri}
            source={headers ? { uri, headers } : { uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            onError={() => setFailedAt(instant)}
          />
        ) : (
          <View style={styles.placeholder}>
            <ImageOff size={18} color={colors.foregroundSubtle} />
            <Text style={[styles.placeholderText, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              {t('v2.timelineLibrary.noFootage')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.caption}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {camera.name}
        </Text>
        <Text style={[styles.time, { color: colors.foregroundMuted }]} numberOfLines={1}>
          {clock(instant, locale)}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  wall: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center' },
  tile: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  picture: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: SPACING.xs },
  placeholderText: { fontSize: 11 },
  caption: {
    height: CAPTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  name: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  time: { fontSize: 11, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, textAlign: 'center' },
})
