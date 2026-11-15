/**
 * CursorFramesGrid — the Library timeline's "picture": one still per camera,
 * cut from the recording at the instant the cursor is on.
 *
 * It sits in `TheaterTimeline`'s stream slot, the place the player occupies on
 * camera-detail, and draws nothing live: each tile is the recorder's on-demand
 * still route (`data/still-media-url.ts`) for ITS camera at `instant`. Which
 * cameras get a tile, and when the instant is allowed to change, are
 * `cursor-frames.ts`'s — this file only lays them out and says what each tile
 * is (name, time) or why it has no picture (no footage at that instant, or a
 * camera past the {@link CURSOR_STILLS_MAX} still bound).
 *
 * While a drag is in flight the grid keeps what it has: `instant` it receives
 * is already the settled one (`use-settled-instant.ts`), so no image request
 * leaves the device until the cursor has been released.
 */
import React, { useMemo, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
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
import { CURSOR_STILLS_MAX, drawsStill, fillFrameGrid } from './cursor-frames.js'

export interface FrameCamera {
  readonly id: number
  readonly name: string
}

export interface CursorFramesGridProps {
  /** The scope, in order: every camera gets a tile. */
  readonly cameras: readonly FrameCamera[]
  /** The settled instant (epoch ms) every tile is cut at. */
  readonly instant: number
  /** `grid` (default) lays the tiles out to fill the box; `strip` is one
   *  horizontally scrolling row of small tiles, as tall as the box. */
  readonly variant?: 'grid' | 'strip'
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

export function CursorFramesGrid({ cameras, instant, variant = 'grid' }: CursorFramesGridProps): React.JSX.Element {
  const [box, setBox] = useState({ width: 0, height: 0 })

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  // The wall's own column split (16:9 area-maximising), then cells stretched
  // over the whole box: no band of empty space around the tiles.
  const layout = useMemo(() => {
    const innerW = Math.max(0, box.width - GAP * 2)
    const innerH = Math.max(0, box.height - GAP * 2)
    const cols = computeGridLayout(cameras.length, innerW, innerH, 'auto', 16 / 9).cols
    return fillFrameGrid(cameras.length, innerW, innerH, GAP, cols)
  }, [cameras.length, box.width, box.height])
  // Each camera keeps its scope position, which decides whether it draws a still.
  const indexed = useMemo(() => cameras.map((camera, index) => ({ camera, index, id: camera.id })), [cameras])
  const rows = useMemo(() => splitIntoRows(indexed, layout.cols), [indexed, layout.cols])

  if (variant === 'strip') {
    const tileH = Math.max(0, box.height - GAP * 2)
    const tileW = Math.round(Math.max(0, tileH - CAPTION_HEIGHT) * (16 / 9))
    return (
      <View testID={CURSOR_FRAMES_TEST_ID} style={styles.fill} onLayout={onLayout}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.strip, { padding: GAP, gap: GAP }]}>
          {cameras.map((camera, index) => (
            <FrameTile
              key={camera.id}
              camera={camera}
              instant={instant}
              width={tileW}
              height={tileH}
              showStill={drawsStill(index)}
            />
          ))}
        </ScrollView>
      </View>
    )
  }

  return (
    <View testID={CURSOR_FRAMES_TEST_ID} style={styles.fill} onLayout={onLayout}>
      <View style={[styles.wall, { padding: GAP, gap: GAP }]}>
        {rows.map((row) => (
          <View key={row[0]?.id ?? 0} style={[styles.row, { gap: GAP }]}>
            {row.map(({ camera, index }) => (
              <FrameTile
                key={camera.id}
                camera={camera}
                instant={instant}
                width={layout.cellW}
                height={layout.cellH}
                showStill={drawsStill(index)}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

interface FrameTileProps {
  readonly camera: FrameCamera
  readonly instant: number
  readonly width: number
  readonly height: number
  /** False past the still bound: the tile shows the camera, not a picture. */
  readonly showStill: boolean
}

function FrameTile({ camera, instant, width, height, showStill }: FrameTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const { token } = useServer()
  const { controller, state } = useConnection()
  // Failure is latched to the instant that 204'd: a new instant retries.
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const failed = isStillPreviewFailed(failedAt, instant)

  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const uri = serverUrl !== null && showStill ? buildStillMediaUrl(serverUrl, camera.id, instant) : null
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
        {!showStill ? (
          <View style={styles.placeholder}>
            <ImageOff size={18} color={colors.foregroundSubtle} />
            <Text style={[styles.placeholderText, { color: colors.foregroundSubtle }]} numberOfLines={2}>
              {t('v2.timelineLibrary.noPreviewAboveMax', { max: CURSOR_STILLS_MAX })}
            </Text>
          </View>
        ) : uri !== null && !failed ? (
          // NOT keyed by the URI: a live scrub changes it several times a
          // second, and a remount would blank the tile between two stills.
          <Image
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
        {showStill ? (
          <Text style={[styles.time, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {clock(instant, locale)}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  wall: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center' },
  strip: { alignItems: 'flex-start' },
  tile: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  picture: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: SPACING.xs },
  placeholderText: { fontSize: 11, textAlign: 'center' },
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
})
