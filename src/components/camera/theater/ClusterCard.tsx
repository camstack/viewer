/**
 * ClusterCard — a cluster, shown directly as its gallery panel.
 *
 * A dark rounded panel with a horizontal row of one thumbnail per subject
 * (`carouselEvents`), each with its class border and a bottom caption
 * ("● Persona 18:44"). It is the look the gallery overlay used to open on a
 * button; it is now the card itself, always open, so there is no key image,
 * no paging arrows, no "1/N" chip, no gallery toggle and no close button.
 *
 * - Tap on a thumbnail → `onPress(event)` (the timeline seeks to its start − 2 s,
 *   `memberSeekMs`). The tapped one is the panel's SELECTED thumbnail and wears
 *   the accent border; with no tap yet, none is selected. Playback never lights
 *   or scrolls a thumbnail.
 * - The lens (panel top-right) opens the detail on the SELECTED thumbnail, else
 *   the first one.
 * - Clips mode (`paging` false): the panel holds the visit's one thumbnail, its
 *   caption carries the clip's start/end label, the lens slot is the save button.
 * - Camera count chip when the group spans cameras; per-thumbnail importance
 *   badge under the same setting as before.
 * - Memoized via React.memo.
 */

import React, { memo, useMemo, useState } from 'react'
import { dayRelativeLabel } from '../../../lib/day-relative-label.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Download, Search, Video } from '../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { useSettings } from '../../../data/use-settings.js'
import { RADIUS, SPACING, TABULAR } from '../../../theme/tokens.js'
import { useKindPaint } from '../../../../shared/palette.js'
import { EventThumb } from './EventThumb.js'
import { ClipRowProgress } from './ClipRowProgress.js'
import type { ClipRowPlayback } from '../../../clips/clip-row-playback.js'
import { useEventKindResolver } from '../../../data/use-event-kind-resolver.js'
import {
  CLUSTER_PANEL_ITEM_HEIGHT,
  CLUSTER_PANEL_THUMB_HEIGHT,
  CLUSTER_CLIP_CAPTION_HEIGHT,
  clusterClipThumbWidth,
  clusterPanelItemWidth,
} from './cluster-frame-box.js'
import { thumbCaptionLabel } from './thumb-caption-label.js'
import { clusterDeviceIds, type PositionedCluster, type ObjectEvent } from './event-cluster.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The camera-count chip, published as a marker.
 *
 * `react-native-web` compiles styles into opaque class names, so a mount test
 * cannot read the chip off its look — and the digit alone appears in the page
 * counter too. See `mount-test-observability`: one id per claim.
 */
export const CLUSTER_CAMERA_COUNT_TEST_ID = 'cluster-camera-count'

/** The card itself — the POSITIVE control every "the chip is absent" assertion
 *  needs, so a card that failed to render cannot pass for a card that decided
 *  not to draw the chip. */
export const CLUSTER_CARD_TEST_ID = 'cluster-card'

export interface ClusterCardProps {
  readonly cluster: PositionedCluster
  readonly width: number
  readonly selected?: boolean
  /** A thumbnail was tapped: the seek target. */
  readonly onPress: (event: ObjectEvent) => void
  /** The LENS: open the cluster detail on the active thumbnail. */
  readonly onOpenDetail?: (event: ObjectEvent) => void
  /**
   * Whether the panel lists every subject. OFF in clips mode: a clips card is a
   * VISIT and a tap plays it from its start, so it holds one thumbnail.
   */
  readonly paging?: boolean
  /**
   * Clips mode only: the instant a tap on this card plays from
   * ({@link clusterCardTimeLabel} makes it the card's time). Absent in normal
   * mode, where the tap seeks the visible page instead.
   */
  readonly clipStartMs?: number
  /**
   * Clips mode only: the instant the clip's footage ends
   * ({@link clusterCardEndLabel} appends it to the card's time). Absent in
   * normal mode, which has no clip to bound.
   */
  readonly clipEndMs?: number
  /**
   * Clips mode only: keep this clip's file.
   *
   * > *"Il pulsante download può essere messo sulla thumbnail dove di solito
   * > mostriamo la lente del cluster group."* — the operator, 2026-09-20.
   *
   * It takes the MAGNIFIER's corner, which clips mode leaves empty because
   * `onClusterOpenDetail` is undefined there — same row, same button style,
   * same hit area. Inventing a second corner treatment for a second kind of
   * card is how one of them falls behind.
   *
   * Null means the provider REFUSED this clip: the control is still drawn,
   * disabled, and `saveClipRefusedReason` carries the words. A hidden control
   * would make "cannot be served" and "this build has no save" the same blank
   * corner; a live one that fails when pressed is the other half of the same
   * defect. Absent (undefined) means there is nothing to save at all — a clip
   * of our own recording, which is collected through the export path.
   */
  readonly onSaveClip?: (() => void) | null
  /**
   * This card's clip is being fetched right now.
   *
   * The control had no state at all, so a press on a 4 MB file looked exactly
   * like a press that did nothing — the operator's report of 2026-09-21. The
   * work is a resolve plus a download; on a phone that is seconds.
   */
  readonly savingClip?: boolean
  /** The provider's own words, beside a disabled {@link onSaveClip}. Rendered
   *  verbatim as the control's accessibility label, never parsed. */
  readonly saveClipRefusedReason?: string | null
  /**
   * THIS card's clip is the one running — and how far through it is.
   *
   * Two independent facts, and the card draws them as two things: the
   * highlight says which row is playing, the strip along the bottom says how
   * far. Absent (the common case) is "not playing", which is decided by the
   * surface off its own state and is never a read that failed.
   *
   * The progress arm may be `unknown`, and that is not a small number: a
   * streamed clip's length is routinely never measured, so the strip goes
   * INDETERMINATE rather than sitting at 0 % (D393, `ClipRowProgress`). A clip
   * can be the running one while nothing at all is known about its length —
   * which is why this is not a `progress?: number`.
   */
  readonly clipPlayback?: ClipRowPlayback
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format epoch ms as "HH:MM". */
function formatHHMM(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The card's time label: WHERE THE TAP GOES, first.
 *
 * `clipStartMs` is supplied only in clips mode, where a tap plays the visit
 * from its start ({@link clipStartByCardId}); in normal mode the tap seeks the
 * visible page and the page's own time is already the whole truth, so the
 * argument is absent and nothing changes.
 *
 * The operator reported the divergence this removes: a card labelled 10:39
 * whose tap landed at 10:37:49. The label was the cluster's NEWEST subject and
 * the tap is its OLDEST, clamped to the footage — two ends of the same
 * cluster, guaranteed to disagree on every card holding more than one subject.
 *
 * The subject's own time is not thrown away, because it is how the operator
 * finds the card in the first place ("the 10:39 one"): when it renders as a
 * different minute it follows the start, after a separator. Leftmost is always
 * the tap. Same minute → one time, because a second copy of "10:39" on a 9pt
 * row is noise.
 */
export interface ClusterCardTimeOptions {
  /** Now, so a card from another day can say which one. */
  readonly nowMs: number
  /** The app's language (`useDateLocale()`), never the runtime's. */
  readonly locale: string
}

export function clusterCardTimeLabel(
  activeEventMs: number,
  clipStartMs: number | undefined,
  time?: ClusterCardTimeOptions,
): string {
  // THE DAY, on the leftmost time only.
  //
  // `HH:MM` alone is the whole truth while the body shows one day — and clips
  // mode widens the window backwards by itself now, so a card from three days
  // ago used to be indistinguishable from this morning's. The operator chose
  // the shape: three-letter weekday back to a week, then a short date
  // (`lib/day-relative-label.ts`).
  //
  // Only the leftmost: the subject and the end belong to the SAME clip as the
  // start, so repeating the date beside them would be noise, which is the
  // lesson `clusterCardEndLabel` below already paid for.
  //
  // `time` is optional so a caller that has not been taught keeps exactly the
  // label it had — an absent option must never start rendering a day nobody
  // asked for.
  const lead = (ms: number): string =>
    time === undefined ? formatHHMM(ms) : dayRelativeLabel(ms, time.nowMs, { locale: time.locale })
  if (clipStartMs === undefined) return lead(activeEventMs)
  const start = lead(clipStartMs)
  const subject = formatHHMM(activeEventMs)
  // Compared on the TIME, not on the rendered lead: a day prefix would make
  // every same-minute card print its time twice.
  return formatHHMM(clipStartMs) === subject ? start : `${start} · ${subject}`
}

/**
 * The card's END time, appended after {@link clusterCardTimeLabel}.
 *
 * `clipEndMs` is supplied only in clips mode, alongside `clipStartMs` — the
 * card already showed where a tap goes and (via its on-axis height) how long
 * the clip runs; the one thing missing was where it stops. Absent in normal
 * mode, where a cluster card has no clip to bound.
 */
export function clusterCardEndLabel(
  clipEndMs: number | undefined,
  clipStartMs?: number,
): string {
  if (clipEndMs === undefined) return ''
  // ⚠ An end time that reads the same as the start is not information, it is
  // noise — and that is what shipped in v1.0.396: real clips on this fleet last
  // SECONDS, so the card said `05:57 – 05:57` and the operator reported the
  // times as broken. They were not broken; they were rendered at a resolution
  // that cannot tell them apart.
  //
  // So when both land in the same minute, say the DURATION instead. It is the
  // question the end time was standing in for ("how long does this run"), and
  // unlike a repeated clock reading it is always true at any resolution.
  if (clipStartMs !== undefined && formatHHMM(clipStartMs) === formatHHMM(clipEndMs)) {
    const seconds = Math.max(1, Math.round((clipEndMs - clipStartMs) / 1_000))
    return seconds < 60 ? ` · ${seconds}s` : ''
  }
  return ` – ${formatHHMM(clipEndMs)}`
}

/**
 * Screen-reader narration for the time label.
 *
 * The visible label leans on glyphs a screen reader cannot voice usefully — a
 * "·" between two times, a "–" before a third — the same reasoning that
 * already spelled out start/subject in prose ("legible to an eye, meaningless
 * to a screen reader"). Extended here to the end time rather than duplicated,
 * so the two disambiguations can never drift apart.
 *
 * `undefined` when nothing needs spelling out, so RN falls back to reading the
 * visible text itself — already the whole truth in normal mode, and in clips
 * mode whenever the clip's start lands in the same minute as its subject and
 * carries no end time to announce.
 */
export function clusterCardAccessibilityLabel(
  activeEventMs: number,
  clipStartMs: number | undefined,
  clipEndMs: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  if (clipStartMs === undefined) return undefined
  const clauses: string[] = []
  if (formatHHMM(activeEventMs) !== formatHHMM(clipStartMs)) {
    clauses.push(
      t('v2.theater.clipStartsAtSubjectAt', {
        start: formatHHMM(clipStartMs),
        subject: formatHHMM(activeEventMs),
      }),
    )
  }
  if (clipEndMs !== undefined) {
    clauses.push(t('v2.theater.clipEndsAt', { end: formatHHMM(clipEndMs) }))
  }
  return clauses.length > 0 ? clauses.join(' ') : undefined
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ClusterCard = memo(function ClusterCard({
  cluster,
  width,
  selected = false,
  onPress,
  onOpenDetail,
  paging = true,
  clipStartMs,
  clipEndMs,
  onSaveClip,
  savingClip = false,
  saveClipRefusedReason,
  clipPlayback,
}: ClusterCardProps) {
  const { colors } = useTheme()
  const paint = useKindPaint()
  const { t } = useTranslation()
  const resolver = useEventKindResolver()
  const { settings } = useSettings()
  const dateLocale = useDateLocale()
  const nowMs = Date.now()

  const events: readonly ObjectEvent[] = !paging
    ? [cluster.anchorEvent]
    : cluster.carouselEvents.length > 0
      ? cluster.carouselEvents
      : [cluster.anchorEvent]

  // The SELECTED thumbnail is the last one tapped, else none. The lens opens it,
  // or the first one when nothing is selected.
  const [tappedId, setTappedId] = useState<string | null>(null)
  const selectedIndex = tappedId === null ? -1 : events.findIndex((e) => e.id === tappedId)
  const activeEvent = events[Math.max(selectedIndex, 0)] ?? cluster.anchorEvent

  const itemWidth = paging ? clusterPanelItemWidth(width) : clusterClipThumbWidth(width)
  const clipThumbHeight = paging ? CLUSTER_PANEL_THUMB_HEIGHT : Math.round((itemWidth * 9) / 16)
  const step = itemWidth + SPACING.sm
  const contentOffset = useMemo(() => ({ x: Math.max(selectedIndex, 0) * step, y: 0 }), [selectedIndex, step])

  const clipLabel =
    clipStartMs === undefined
      ? undefined
      : clusterCardTimeLabel(activeEvent.timestamp, clipStartMs, { nowMs, locale: dateLocale }) +
        clusterCardEndLabel(clipEndMs, clipStartMs)
  const cameraCount = useMemo(() => clusterDeviceIds(cluster).length, [cluster])
  const playing = clipPlayback !== undefined

  const renderThumb = (event: ObjectEvent, index: number, active: boolean): React.JSX.Element => {
    const rotation = index % 3 === 0 ? '-2deg' : index % 3 === 2 ? '2deg' : '0deg'
    const accent = paint(event.className)
    const caption = thumbCaptionLabel(event, resolver)
    return (
      <Pressable
        key={event.id}
        accessibilityRole="button"
        accessibilityLabel={`${formatHHMM(event.timestamp)} ${caption}`}
        accessibilityState={{ selected: active }}
        onPress={() => {
          setTappedId(event.id)
          onPress(event)
        }}
        style={[
          styles.item,
          paging ? null : styles.clipItem,
          {
            width: itemWidth,
            height: paging ? CLUSTER_PANEL_ITEM_HEIGHT : clipThumbHeight + CLUSTER_CLIP_CAPTION_HEIGHT,
            borderColor: active ? colors.primary : accent,
            transform: [{ rotate: rotation }, { scale: selectedIndex < 0 || active ? 1 : 0.94 }],
          },
        ]}
      >
        <EventThumb event={event} width={itemWidth} height={clipThumbHeight} />
        <View style={[styles.caption, { backgroundColor: colors.background + 'E6' }]}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.className, { color: colors.foreground }]}
          >
            {caption}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.time, TABULAR, { color: colors.foregroundMuted }]}
            accessibilityLabel={
              clipLabel === undefined
                ? undefined
                : clusterCardAccessibilityLabel(event.timestamp, clipStartMs, clipEndMs, t)
            }
          >
            {clipLabel ?? formatHHMM(event.timestamp)}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    <View
      testID={CLUSTER_CARD_TEST_ID}
      style={[
        styles.container,
        {
          width,
          height: cluster.heightPx,
          backgroundColor: paging ? colors.surface : 'transparent',
          borderColor: playing || selected ? colors.primary : colors.border,
        },
      ]}
    >
      {paging ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentOffset={contentOffset}
          decelerationRate="fast"
          snapToInterval={step}
          contentContainerStyle={styles.content}
        >
          {events.map((event, index) => renderThumb(event, index, index === selectedIndex))}
        </ScrollView>
      ) : (
        <View style={styles.clipBody}>
          {renderThumb(events[0]!, 0, selectedIndex === 0 || selectedIndex < 0)}
        </View>
      )}

      <View style={styles.actions}>
        {cameraCount > 1 ? (
          <View
            testID={CLUSTER_CAMERA_COUNT_TEST_ID}
            style={[styles.cameraPill, { backgroundColor: colors.background + 'E6', borderColor: colors.border }]}
            accessibilityLabel={t('v2.theater.clusterCameras', { count: cameraCount })}
          >
            <Video size={10} color={colors.foregroundMuted} />
            <Text style={[styles.cameraCount, TABULAR, { color: colors.foregroundMuted }]}>
              {cameraCount}
            </Text>
          </View>
        ) : null}
        {onOpenDetail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.theater.clusterOpenDetail')}
            onPress={() => onOpenDetail(activeEvent)}
            hitSlop={8}
            style={[styles.action, { backgroundColor: colors.background + 'E6' }]}
          >
            <Search size={14} color={colors.foreground} />
          </Pressable>
        ) : null}
        {onSaveClip !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: onSaveClip === null }}
            accessibilityLabel={
              onSaveClip === null
                ? (saveClipRefusedReason ?? t('v2.clips.saveUnavailable'))
                : t('v2.clips.saveClip')
            }
            disabled={onSaveClip === null || savingClip}
            onPress={() => onSaveClip?.()}
            hitSlop={8}
            style={[
              styles.action,
              { backgroundColor: colors.background + 'E6', opacity: onSaveClip === null ? 0.4 : 1 },
            ]}
          >
            {savingClip ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Download size={14} color={colors.foreground} />
            )}
          </Pressable>
        ) : null}
      </View>

      {clipPlayback !== undefined ? <ClipRowProgress playback={clipPlayback} width={width} /> : null}
    </View>
  )
})

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingRight: 70,
  },
  clipBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  clipItem: {
    alignSelf: 'center',
  },
  item: {
    height: CLUSTER_PANEL_ITEM_HEIGHT,
    overflow: 'hidden',
    borderWidth: 2,
    borderRadius: RADIUS.md,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  className: { flex: 1, fontSize: 9, fontWeight: '700' },
  time: { fontSize: 9, flexShrink: 1 },
  importancePill: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  importanceText: { fontSize: 8, fontWeight: '700', fontVariant: ['tabular-nums'] },
  actions: {
    position: 'absolute',
    top: SPACING.xs,
    right: SPACING.xs,
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  action: {
    width: 25,
    height: 25,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    height: 25,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  cameraCount: { fontSize: 9, fontWeight: '700' },
})
