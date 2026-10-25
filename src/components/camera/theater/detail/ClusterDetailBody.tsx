/**
 * ClusterDetailBody — the detail UI for one cluster, WITHOUT window chrome.
 * `TimelineClusterPanel` hosts it as a panel that takes over the timeline body.
 *
 * It used to be wrapped in a slide-up `<Modal>` (`ClusterDetailModal`, deleted
 * 2026-08-01) whose docblock also claimed a split-view `EventsDetailPane` shared
 * this body. No such file has ever existed in this tree — the events UI has its
 * own `TrackDetailModal`. That sentence is the reason this one says where the
 * single caller is by name.
 *
 * A cluster is a bag of TRACKS (one tracked object each). This body is a track
 * PICKER over the SAME track-shaped events the timeline card renders
 * (`cluster.carouselEvents` — one per distinct subject, `id = bestEventId`), and
 * it delegates the per-track detail to the shared {@link TrackDetailView} — the
 * one detail surface used across the whole events UI. Consequences:
 *
 *   • The per-track hero is the EXACT best shot the timeline shows (same
 *     `EventThumb` over the same `bestEventId`) — the two never diverge.
 *   • Below the hero, TrackDetailView shows ALL of the track's stored media.
 *   • The face/identity panel appears ONLY when the track has a face.
 *   • Tapping a track chip opens THAT track's dedicated detail in isolation.
 *   • The operator FLAGS come from the track row, not from the timeline event,
 *     which has no flag fields — see `detailTrack` below.
 *
 * The picker row is shown only when the cluster holds more than one subject.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { X } from '../../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { EventThumb } from '../EventThumb.js'
import { TrackDetailView } from '../../../events/track/TrackDetailView.js'
import { timelineEventToTrackSummary } from '../../../../data/use-device-tracks.js'
import { useTrackById } from '../../../../data/use-track-by-id.js'
import { planTrackNavigation, type TrackDetailNavigation } from '../../../../data/track-navigation.js'
import { useEventKindResolver } from '../../../../data/use-event-kind-resolver.js'
import type { TrackSummary } from '../../../../data/track-events.js'
import type { PositionedCluster, ObjectEvent } from '../event-cluster.js'

const TRACK_CHIP = 56

export interface ClusterDetailBodyProps {
  readonly deviceId: number
  readonly cluster: PositionedCluster | null
  readonly onSeek: (epochMs: number) => void
  /** Close affordance in the header. Omit to hide the close button. */
  readonly onClose?: () => void
  /** Bottom inset for the seek button. Defaults to the safe-area inset (modal). */
  readonly bottomInset?: number
  /** Hide the "go to this moment" action when the owning surface KNOWS there is
   *  no recording at the cluster's moment. Default true (visible). */
  readonly seekAvailable?: boolean
}

/** Stable identity for a track-shaped event (its track, else its id). */
function trackKey(ev: ObjectEvent): string {
  return ev.trackId ?? ev.id
}

/**
 * Short label for a track chip: the tier-1 sub-class (`van`), else the raw
 * class — TAXONOMY either way (`ObjectEvent.label` only ever carries the
 * server's tier-1 column, via `trackToTimelineEvent`), so both are resolved.
 * `resolveLabel` is threaded in because translation is a React-hook resolver.
 */
function chipLabel(ev: ObjectEvent, resolveLabel: (id: string) => string): string {
  return resolveLabel(ev.label ?? ev.className)
}

export const ClusterDetailBody = memo(function ClusterDetailBody({
  deviceId, cluster, onSeek, onClose, bottomInset, seekAvailable = true,
}: ClusterDetailBodyProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const resolver = useEventKindResolver([deviceId])

  // One item per DISTINCT subject — exactly what the timeline card carousel
  // pages over (tracker fragments already collapsed). Fall back to the raw event
  // set on the (degenerate) chance the carousel is empty.
  const tracks = useMemo<ObjectEvent[]>(() => {
    if (cluster === null) return []
    const list = cluster.carouselEvents.length > 0 ? cluster.carouselEvents : cluster.events
    return [...list]
  }, [cluster])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Default / reset the selection when the track set changes (new cluster).
  useEffect(() => {
    setSelectedKey((prev) =>
      prev !== null && tracks.some((ev) => trackKey(ev) === prev)
        ? prev
        : (tracks[0] !== undefined ? trackKey(tracks[0]) : null),
    )
  }, [tracks])

  const selectedEvent = useMemo<ObjectEvent | null>(
    () => tracks.find((ev) => trackKey(ev) === selectedKey) ?? tracks[0] ?? null,
    [tracks, selectedKey],
  )

  // Build the shared TrackSummary from the selected track-shaped event — the same
  // `bestEventId` the timeline resolves media against.
  const selectedTrack = useMemo(
    () => (selectedEvent !== null
      ? timelineEventToTrackSummary(selectedEvent, selectedEvent.deviceId ?? deviceId)
      : null),
    [selectedEvent, deviceId],
  )

  // The three operator flags are the one thing that summary CANNOT carry: a
  // timeline `ObjectEvent` has no flag fields, so `timelineEventToTrackSummary`
  // hands the detail a row with all three absent and every toggle renders off —
  // permanently, on a surface that can SET them. Setting one worked and looked
  // like it had not, and reopening the cluster showed it off again.
  //
  // So the flags are read off the authoritative track row, the same
  // `useTrackById` the embed surfaces upgrade a clicked card with, and — since
  // `useSetTrackFlags` publishes its answer to that key — a write made right
  // here lands in the same cache this reads.
  const { track: authoritative } = useTrackById(deviceId, selectedTrack?.trackId ?? null, '')

  // ONLY the flags are adopted, deliberately. The rest of `authoritative` is
  // "better" data, but this body's contract is that its hero is the EXACT shot
  // the timeline card shows — same `bestEventId`, same `EventThumb` — and
  // taking the row wholesale would let the picker and the card describe
  // different moments, which is the one thing this surface must never do.
  // Spread per key, never defaulted: absent must stay absent so "never marked"
  // and "explicitly un-marked" survive all the way to the toggle.
  const detailTrack = useMemo<TrackSummary | null>(() => {
    if (selectedTrack === null) return null
    if (authoritative === null || authoritative.trackId !== selectedTrack.trackId) return selectedTrack
    return {
      ...selectedTrack,
      ...(authoritative.markForTrain !== undefined ? { markForTrain: authoritative.markForTrain } : {}),
      ...(authoritative.debug !== undefined ? { debug: authoritative.debug } : {}),
      ...(authoritative.favourited !== undefined ? { favourited: authoritative.favourited } : {}),
    }
  }, [selectedTrack, authoritative])

  // Prev/next over the SAME collection the picker chips show, via the shared
  // pure planner — an arrow move and a chip tap are the one selection write.
  // Self-hides (undefined) for a single-subject cluster.
  const keys = useMemo(() => tracks.map((ev) => trackKey(ev)), [tracks])
  const currentKey = selectedEvent !== null ? trackKey(selectedEvent) : null
  const plan = planTrackNavigation(keys, currentKey)
  const prevKey = plan?.prevId ?? null
  const nextKey = plan?.nextId ?? null
  const onPrev = useCallback((): void => {
    if (prevKey !== null) setSelectedKey(prevKey)
  }, [prevKey])
  const onNext = useCallback((): void => {
    if (nextKey !== null) setSelectedKey(nextKey)
  }, [nextKey])
  const navigation = useMemo<TrackDetailNavigation | undefined>(
    () =>
      plan === null
        ? undefined
        : {
            position: plan.index + 1,
            count: plan.count,
            hasPrev: plan.hasPrev,
            hasNext: plan.hasNext,
            onPrev,
            onNext,
          },
    // `plan` is re-derived every render; its FIELDS are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan?.index, plan?.count, plan?.hasPrev, plan?.hasNext, onPrev, onNext],
  )

  return (
    <View style={styles.root}>
      {/* Track picker + close. Chips render the timeline best shot per subject. */}
      <View style={styles.pickerBar}>
        {tracks.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trackRow}
            style={styles.trackRowFlex}
          >
            {tracks.map((ev) => {
              const key = trackKey(ev)
              const sel = key === (selectedEvent !== null ? trackKey(selectedEvent) : null)
              return (
                <Pressable key={key} onPress={() => setSelectedKey(key)} style={styles.trackChip}>
                  <View
                    style={[
                      styles.chipImage,
                      { borderColor: sel ? colors.primary : 'transparent', borderWidth: sel ? 2 : 0 },
                    ]}
                  >
                    <EventThumb event={ev} width={TRACK_CHIP} height={TRACK_CHIP} />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.trackChipLabel, { color: sel ? colors.foreground : colors.foregroundMuted }]}
                  >
                    {chipLabel(ev, resolver.resolveLabel)}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : (
          <View style={styles.trackRowFlex} />
        )}
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
            <X size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {/* The selected track's dedicated detail (best shot + all media + face
          when present + metadata + seek). onClose omitted here — the picker bar
          above owns the close affordance. */}
      {detailTrack !== null ? (
        <TrackDetailView
          track={detailTrack}
          onSeek={seekAvailable ? onSeek : undefined}
          bottomInset={bottomInset}
          navigation={navigation}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={{ color: colors.foregroundMuted }}>{t('v2.theater.detailEmpty')}</Text>
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { flex: 1 },
  pickerBar: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  trackRowFlex: { flex: 1 },
  trackRow: { gap: SPACING.sm, paddingVertical: SPACING.xs, paddingRight: SPACING.md, alignItems: 'center' },
  trackChip: { width: TRACK_CHIP, alignItems: 'center', gap: 2 },
  chipImage: { width: TRACK_CHIP, height: TRACK_CHIP, borderRadius: RADIUS.md, overflow: 'hidden' },
  trackChipLabel: { fontSize: 10, maxWidth: TRACK_CHIP + 8, textAlign: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
