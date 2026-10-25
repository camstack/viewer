/**
 * EventsScreen — the track-centric events page. The page owns the CHROME and the
 * query; `EventsGallery` draws the grid, natively (also on the web build).
 *
 * What the page owns and hands the feed: day navigation, cameras, classes, the
 * Faces/Plates attribute chips, newest-first order (no sort control) — the shared
 * events-filter-store (remembered on this device; the day and the search are not) — plus the confirmed semantic search and the density
 * control. All of it is ONE query object (`useEventsGalleryFeed`), and the feed
 * logic behind it — paging, the live delta, the day window — is `shared/events`,
 * the same code the hub-hosted embed runs for external iframes.
 *
 * It also owns the DETAIL: a tapped row opens `TrackDetailModal` (phone) or the
 * right pane (split) from the row it already holds, upgraded in place by
 * `useOpenTrack`; prev/next walks the rows the gallery shows, in the order it
 * shows them. A track opened from a deep link and one opened from a tile are the
 * same view.
 *
 * Responsive (use-events-layout):
 *   • phone / grid — filter chips (each opens an anchored menu); tapping a tile opens the modal detail.
 *   • split       — same chip bar; detail fills the right pane.
 *
 * The track detail keeps its full surface (crop, full frame + boxes, metadata)
 * and adds the face→person assignment (face-gallery cap).
 */
import React, { useEffect, useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTheme } from '../theme/theme-provider.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { SPACING } from '../theme/tokens.js'
import {
  resolveEventsClasses,
  resolveEventsExcludeSources,
  useEventsFilterStore,
} from '../store/events-filter-store.js'
import { useEventKinds } from '../data/use-event-kinds.js'
import { useDebugStatusStore } from '../store/debug-status-store.js'
import { useSettings } from '../data/use-settings.js'
import type { EventsTrackRow } from '../../shared/events/events-track-row.js'
import { useOpenTrack, type OpenIntent } from '../hooks/use-open-track.js'
import { useEventsGalleryFeed } from '../data/use-events-gallery-feed.js'
import { EventsGallery } from '../components/events/gallery/EventsGallery.js'
import { GalleryFaceAssign } from '../components/events/gallery/GalleryFaceAssign.js'
import { useSeekToMoment } from '../live/use-seek-to-moment.js'
import { useCameras } from '../data/use-cameras.js'
import { useKnownCameraIds } from '../hooks/use-library-filter.js'
import { useEventsLayout } from '../hooks/use-events-layout.js'
import { useHasFeature, useIsAdmin } from '../data/use-me.js'
import { useTrackListNavigation } from '../hooks/use-track-list-navigation.js'
import { EventsFilterBar } from '../components/events/EventsFilterBar.js'
import { eventsCountSummary } from '../components/events/events-count.js'
import { EventsShareDialog } from '../components/events/EventsShareDialog.js'
import { SemanticSearchBar } from '../components/events/track/SemanticSearchBar.js'
import { TrackDetailModal } from '../components/events/track/TrackDetailModal.js'
import { TrackDetailView } from '../components/events/track/TrackDetailView.js'
import { useTrackById } from '../data/use-track-by-id.js'
import { dayStartForOffset, localDayOffset } from '../lib/local-day.js'

const SPLIT_PANE_WIDTH = 420
/** Stable empty fallback for the class picker (see `availableClasses`). */
const EMPTY_CLASSES: readonly string[] = []

interface EventsScreenProps {
  /**
   * Rendered inside the Library shell rather than as a standalone tab. The
   * shell already spent the top safe-area inset on the scope bar; the empty
   * ScreenHeader here exists only to spend that same inset when this page
   * is mounted on its own. Do NOT zero insets via context — TrackDetailModal
   * reads insets.top for its full-screen header.
   */
  readonly embedded?: boolean
}

export function EventsScreen({ embedded = false }: EventsScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const layout = useEventsLayout()

  const hydrate = useEventsFilterStore((s) => s.hydrate)
  const hydrateDebug = useDebugStatusStore((s) => s.hydrate)
  const reviewedTrackIds = useDebugStatusStore((s) => s.reviewedIds)
  const filter = useEventsFilterStore((s) => s.filter)
  const isAdmin = useIsAdmin()
  const canAssignFaces = useHasFeature('face-assignment')

  const { settings } = useSettings()
  const density = settings.events.gridDensity

  useEffect(() => { void hydrate(); void hydrateDebug() }, [hydrate, hydrateDebug])

  // The filter bar is remembered on this device; a remembered camera the hub
  // no longer has is dropped once the camera list has answered (and once the
  // remembered filter has been read — the store refuses before that).
  const knownCameraIds = useKnownCameraIds()
  const pruneCameras = useEventsFilterStore((s) => s.pruneCameras)
  const filterHydrated = useEventsFilterStore((s) => s.hydrated)
  useEffect(() => { pruneCameras(knownCameraIds) }, [pruneCameras, knownCameraIds, filterHydrated])

  // Per-day navigation: offset 0 = live (now); >0 = N days back. The "now" is
  // seeded ONCE in state (pure during render — no Date.now() in the render
  // body) so the anchor, and with it the feed's query key, stays stable.
  const [mountNow] = useState(() => Date.now())
  const [dayOffset, setDayOffset] = useState(0)
  const onNextDay = useCallback(() => setDayOffset((d) => Math.max(0, d - 1)), [])
  // The date chip picks a day; the feed thinks in days back from the mount.
  const onPickDay = useCallback(
    (dayMs: number | null) => setDayOffset(dayMs === null ? 0 : localDayOffset(dayMs, mountNow)),
    [mountNow],
  )

  // The open detail.
  const { selected, open: openTrack, select: setSelected, close: closeTrack } = useOpenTrack()
  // The "?" chip goes to the assignment sheet DIRECTLY — never through the detail.
  const [assignRow, setAssignRow] = useState<EventsTrackRow | null>(null)
  const closeAssign = useCallback(() => setAssignRow(null), [])
  const onSelectRow = useCallback(
    (row: EventsTrackRow, intent?: OpenIntent): void => {
      if (intent === 'assign-face' && canAssignFaces) setAssignRow(row)
      else openTrack(row)
    },
    [openTrack, canAssignFaces],
  )
  const [shareOpen, setShareOpen] = useState(false)
  // The DRAFT the field holds, and the query actually APPLIED. They diverge
  // while the operator types: the search runs on confirm (magnifier / keyboard
  // submit), never per keystroke. Clearing collapses both at once.
  const [searchText, setSearchText] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const submitSearch = useCallback((text: string) => {
    setAppliedSearch(text.trim())
  }, [])
  const clearSearch = useCallback(() => {
    setSearchText('')
    setAppliedSearch('')
  }, [])

  const { data: cameras } = useCameras()
  const cameraList = useMemo(() => (cameras ?? []).map((c) => ({ id: c.id, name: c.name })), [cameras])
  const cameraNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of cameraList) m.set(c.id, c.name)
    return m
  }, [cameraList])
  const cameraName = useCallback((id: number) => cameraNameById.get(id) ?? `#${id}`, [cameraNameById])


  // Private deep-link open: an authenticated `camstack://events?trackId&deviceId`
  // link (copied from the detail's Share → Copy link) reopens the track detail —
  // even for a track that isn't in the currently-loaded feed page (a different
  // day). Resolves the track by id via `getTrack`, then clears the params so a
  // later close doesn't immediately reopen it.
  const linkParams = useLocalSearchParams<{ trackId?: string; deviceId?: string }>()
  const linkTrackId = typeof linkParams.trackId === 'string' && linkParams.trackId.length > 0 ? linkParams.trackId : null
  const linkDeviceRaw = typeof linkParams.deviceId === 'string' ? Number(linkParams.deviceId) : Number.NaN
  const linkDeviceId = Number.isFinite(linkDeviceRaw) ? linkDeviceRaw : null
  const { track: linkedTrack } = useTrackById(
    linkDeviceId,
    linkTrackId,
    linkDeviceId !== null ? cameraName(linkDeviceId) : '',
  )
  useEffect(() => {
    if (linkedTrack !== null && selected === null) {
      setSelected(linkedTrack)
      router.setParams({ trackId: undefined, deviceId: undefined, ts: undefined })
    }
  }, [linkedTrack, selected, router, setSelected])

  /**
   * The ONE selection, in the TWO dimensions the hub can answer it in.
   *
   * The kind tree lists Motion, Audio, Person, Vehicle, Animal, Package,
   * Control and Sensor as eight equal rows and the operator ticks whichever
   * they want. Underneath they are not the same kind of thing: a pipeline node
   * rides `classes`, and a synthetic one (Audio / Sensor / Control) rides
   * `excludeSources`, because those rows carry no accumulated class at all and
   * the hub's class filter is a superset that keeps every row it cannot read.
   *
   * Both come out of the same stored ticks — `resolveEventsExcludeSources` is
   * a DERIVATION, not a second preference — so the two can never disagree, and
   * there is nothing else on this page for the operator to set.
   *
   * The taxonomy query is the same one `EventsFilterBar` issues (same key,
   * same devices), so React Query serves it from cache rather than fetching it
   * twice.
   */
  const scopedDeviceIds = useMemo(
    () => (filter.cameraIds.length > 0 ? filter.cameraIds : cameraList.map((c) => c.id)),
    [filter.cameraIds, cameraList],
  )
  const eventKinds = useEventKinds(scopedDeviceIds)
  const resolvedClasses = resolveEventsClasses(filter.classes, eventKinds.data)
  const excludeSources = resolveEventsExcludeSources(filter.classes, eventKinds.data)

  // Which classes the filter panel offers as a FALLBACK when the taxonomy
  // query has nothing. The picker's primary source (`listEventKindsBatch`) is
  // unaffected.
  const availableClasses: readonly string[] = EMPTY_CLASSES

  // The ONE query behind the grid, the detail's prev/next and the "any filter on"
  // hint. The feed is `shared/events`; this page only says what to ask.
  const feed = useEventsGalleryFeed({
    view: 'gallery',
    deviceIds: filter.cameraIds,
    classes: resolvedClasses,
    attrs: filter.attributes,
    search: appliedSearch,
    searchMode: appliedSearch.length > 0 ? 'semantic' : 'text',
    sort: 'time',
    filterDebug: filter.filterDebug,
    filterTrain: filter.filterTrain,
    filterFavourited: filter.filterFavourited,
    showStationary: filter.showStationary,
    excludeSources,
    reviewedTrackIds,
    dayOffset,
    anchorMs: mountNow,
  })
  const filtered =
    appliedSearch.length > 0 ||
    filter.cameraIds.length > 0 ||
    (filter.classes?.length ?? 0) > 0 ||
    filter.attributes.length > 0 ||
    filter.filterDebug === true ||
    filter.filterTrain === true ||
    filter.filterFavourited === true

  // Prev/next inside the open detail, over the rows the gallery shows, in the
  // order it shows them. The hook opens the neighbour instantly from its row and
  // upgrades it in place once `getTrack` resolves — the modal never closes
  // between tracks. Prev/next is an ordinary open: the face-assign intent
  // belonged to the track the "?" was tapped on, and `select` clears it.
  const detailNavigation = useTrackListNavigation({
    tracks: feed.rows,
    selected,
    cameraNameFor: cameraName,
    onSelect: setSelected,
  })

  // "Go to this moment" (D483). On a tablet or a wide web window this opens the
  // on-demand player OVER this screen, so the track detail the operator is
  // reading is not replaced by the moment it describes. Below that gate it
  // still navigates with `?at=`, exactly as it always has —
  // `live/use-seek-to-moment.ts` owns the choice.
  const seekToMoment = useSeekToMoment()
  const onSeek = useCallback((epochMs: number) => {
    if (selected) seekToMoment(selected.deviceId, epochMs)
    closeTrack()
  }, [seekToMoment, selected, closeTrack])

  const filterBar = (
    <EventsFilterBar
      cameras={cameraList}
      availableClasses={availableClasses}
      date={{ dayMs: dayStartForOffset(dayOffset, mountNow), nowMs: mountNow, onPick: onPickDay, testID: 'events-date' }}
      onOpenShare={() => setShareOpen(true)}
      summary={eventsCountSummary(
        { rows: feed.rows.length, loading: feed.loading, error: feed.error, tail: feed.tail },
        (key, options) => t(key, options),
      )}
    />
  )

  const tileDetails = useMemo(
    () => ({
      camera: settings.events.tileDetailCamera,
      zone: settings.events.tileDetailZone,
    }),
    [settings.events.tileDetailCamera, settings.events.tileDetailZone],
  )

  const displaySheet = <EventsShareDialog visible={shareOpen} onClose={() => setShareOpen(false)} />

  const searchBar = (
    <SemanticSearchBar
      value={searchText}
      onChange={setSearchText}
      onSubmit={submitSearch}
      onClear={clearSearch}
      dirty={searchText.trim() !== appliedSearch}
    />
  )

  const body = (
    <EventsGallery
      feed={feed}
      density={density}
      anchorMs={mountNow}
      dayOffset={dayOffset}
      filtered={filtered}
      showAdminFlags={isAdmin}
      canAssignFaces={canAssignFaces}
      labelMode={settings.events.tileLabelMode}
      details={tileDetails}
      onSelect={onSelectRow}
      onRollNewerDay={onNextDay}
    />
  )

  const galleryColumn = (
    <View style={styles.galleryColumn}>
      <View style={[styles.centered, { maxWidth: layout.maxContentWidth }]}>
        {filterBar}
        {searchBar}
        {body}
      </View>
      {displaySheet}
      <GalleryFaceAssign row={assignRow} onClose={closeAssign} />
    </View>
  )

  const header = !embedded ? <ScreenHeader /> : null

  // ── Split: same chip bar as phone + right detail pane ───────────────────────
  if (layout.mode === 'split') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <View style={styles.splitRow}>
          {galleryColumn}
          <View style={styles.detailColumn}>
            {selected ? (
              <TrackDetailView
                track={selected}
                onSeek={onSeek}
                onClose={closeTrack}
                bottomInset={0}
                navigation={detailNavigation}
              />
            ) : (
              <View style={styles.center}>
                <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>
                  {t('v2.events.selectHint', 'Select an event')}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    )
  }

  // ── Phone / grid: filter chips + grid + modal detail ────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {galleryColumn}
      <TrackDetailModal
        track={selected}
        onSeek={onSeek}
        onClose={closeTrack}
        navigation={detailNavigation}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splitRow: { flex: 1, flexDirection: 'row' },
  galleryColumn: { flex: 1, alignItems: 'center' },
  centered: { flex: 1, width: '100%' },
  detailColumn: { width: SPLIT_PANE_WIDTH, padding: SPACING.md },
})
