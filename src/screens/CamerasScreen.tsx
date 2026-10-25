import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import {
  nextSweepSlice,
  SWEEP_SLICE_SIZE,
  SWEEP_TICK_MS,
} from '../data/snapshot-rotation.js'
import { useSnapshotRefreshStore } from '../store/snapshot-refresh-store.js'
import { hapticTap } from '../lib/haptics.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { CameraCard } from '../components/CameraCard.js'
import { openOnDemandPlayer } from '../store/ondemand-player-store.js'
import { liveOnDemandRequest } from '../live/ondemand-player.js'
import { CamerasGridSkeleton } from '../components/CameraCardSkeleton.js'
import { CamerasDisplaySheet } from '../components/camera/CamerasDisplaySheet.js'
import { ReelFilterSheet } from '../components/events/track/ReelFilterSheet.js'
import {
  reelFilterCondition,
  type ReelFilterCondition,
  useReelFilterStore,
} from '../store/reel-filter-store.js'
import { CameraControlsOverlay } from '../components/camera/CameraControlsOverlay.js'
import { RecentReelBlock } from '../components/events/track/RecentReelBlock.js'
import { CameraLocationBar } from '../components/cameras/CameraLocationBar.js'
import {
  camerasInBucket,
  locationsOf,
  type LocationBucket,
} from '../components/cameras/camera-locations.js'
import { useLocationIcons } from '../data/use-location-icons.js'
import { useSiteZones } from '../data/use-site-zones.js'
import { useMotionRecency } from '../data/use-motion-recency.js'
import { orderByMotionRecency } from '../data/motion-recency.js'
import { useCameraFavouritesStore } from '../store/camera-favourites-store.js'
import { CamerasFab } from '../components/cameras/CamerasFab.js'
import { CAMERAS_LIST_TEST_ID } from './cameras-reel-placement.js'
import { useCameras, type CameraInfo } from '../data/use-cameras.js'
import { isQueryDeadlineError } from '../data/query-deadline.js'
import { CameraBadgesProvider } from '../data/CameraBadgesProvider.js'
import {
  CAMERAS_VIEWPORT_OWNER,
  listViewportReport,
  SNAPSHOT_VIEWABILITY_CONFIG,
  snapshotViewport,
} from '../data/snapshot-viewport.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { useGridColumns } from '../hooks/use-responsive.js'
import { useUserScope } from '../hooks/use-user-scope.js'
import { useSettings } from '../data/use-settings.js'
import { reelThumbSizePx } from '../store/settings-store.js'
import { SPACING } from '../theme/tokens.js'
import { useSeekToMoment } from '../live/use-seek-to-moment.js'
import { useBottomNavInset } from '../navigation/bottom-nav-inset.js'

/** Has the opening sweep already run in this app process? Module scope, not
 *  state: it has to survive this screen unmounting when the operator moves
 *  tabs, and it must NOT survive a relaunch — a fresh launch wants fresh
 *  tiles, which is the whole point of the sweep. */
let openingSweepDone = false

/** Cameras list: a responsive grid of rich camera cards
 *  (snapshot thumbnail, online/sleeping state, battery badge, feature hints).
 *  Live `useCameras` query (authoritative via `deviceManager.listAll`) with
 *  local prefs applied (rename / custom order / hidden excluded). Tap → live
 *  detail. Column count scales with width: 1–2 (phone) → 3 (tablet) → 4+
 *  (desktop). A header action opens the cameras-management screen. */
export function CamerasScreen() {
  const { t } = useTranslation()
  const { state, startingUp } = useConnection()
  const { colors } = useTheme()
  const router = useRouter()
  const numColumns = useGridColumns()
  const { data: allCameras = [], error, isLoading, refetch } = useCameras()
  const [bucket, setBucket] = useState<LocationBucket>(null)
  const locationIcons = useLocationIcons()
  const siteZones = useSiteZones()
  const favouriteIds = useCameraFavouritesStore((st) => st.ids)
  const toggleFavourite = useCameraFavouritesStore((st) => st.toggle)
  const hydrateFavourites = useCameraFavouritesStore((st) => st.hydrate)
  useEffect(() => { void hydrateFavourites() }, [hydrateFavourites])
  // The picker offers what the cameras HAVE; the list shows what it selects.
  const locations = useMemo(() => locationsOf(allCameras), [allCameras])
  const bucketCameras = useMemo(
    () => camerasInBucket(allCameras, bucket, favouriteIds, siteZones.data ?? []),
    [allCameras, bucket, favouriteIds, siteZones.data],
  )
  // The Motion chip: an ORDER toggle on top of the bucket — most recent motion
  // first, re-applied at most once per `MOTION_REORDER_INTERVAL_MS` so the
  // tiles do not jump on every flip. Session state on purpose: a relaunch opens
  // on the usual order.
  const [motionOrder, setMotionOrder] = useState(false)
  const toggleMotionOrder = useCallback(() => setMotionOrder((on) => !on), [])
  const allIds = useMemo(() => allCameras.map((c) => c.id), [allCameras])
  const motionRecency = useMotionRecency(allIds, motionOrder)
  const cameras = useMemo(
    () => (motionOrder ? orderByMotionRecency(bucketCameras, motionRecency) : bucketCameras),
    [motionOrder, bucketCameras, motionRecency],
  )
  const bumpSnapshots = useSnapshotRefreshStore((s) => s.bumpSnapshots)
  const { settings } = useSettings()

  // Pull-to-refresh: re-query the authoritative camera list AND bump the snapshot
  // cache epoch so every tile's thumbnail cache-busts to a fresh frame (the
  // bucketed URL is otherwise stable within its 30s window). Light haptic to
  // match the app's gesture-feedback idiom.
  //
  // `refreshing` rides a LOCAL flag, never the query's `isRefetching` — the
  // cameras query reconciles every `RECONCILE_MS` (5 min) plus live events, so
  // binding the control to the query state made the spinner appear already
  // pulled on every tab entry. Same idiom as EventsScreen's `pulling`. Cleared
  // when the refetch settles (success OR error), so a failed pull can't strand
  // the spinner.
  const [pulling, setPulling] = useState(false)
  const onPullRefresh = useCallback(() => {
    hapticTap()
    bumpSnapshots()
    setPulling(true)
    void refetch().finally(() => setPulling(false))
  }, [bumpSnapshots, refetch])
  // The floating tab bar covers the window's bottom edge; the list scrolls under
  // it and the FAB sits above it.
  const navInset = useBottomNavInset()
  const reelCardWidth = reelThumbSizePx(settings.events.reelThumbSize)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [reelFilterOpen, setReelFilterOpen] = useState(false)
  // The reel's OWN filter, so the fan action can say what it is doing
  // before it is opened. A closed control cannot explain a short strip.
  const reelCondition = reelFilterCondition(useReelFilterStore((st) => st.filter))
  // Corner FAB speed-dial replaces the old header settings button: it expands to
  // two actions — appearance (reel/tile presentation) + edit list (reorder /
  // rename via the cameras-management screen). Keeps the header uncluttered.
  const [fabOpen, setFabOpen] = useState(false)

  // Which camera's controls sheet is open, or none. ONE overlay instance for
  // the whole screen (mounted below) rather than one per card — see
  // `CameraControlsOverlay`'s own header comment for why.
  const [controlsCameraId, setControlsCameraId] = useState<number | null>(null)
  const controlsCamera = useMemo<CameraInfo | null>(
    () => cameras.find((c) => c.id === controlsCameraId) ?? null,
    [cameras, controlsCameraId],
  )

  // Every card's battery and recording mode in ONE call, when the hub has the
  // batch procedure. Gated exactly like the cards' own polls — an unfocused or
  // backgrounded list asks for nothing. Where the aggregate is absent the cards
  // fall back to their per-camera queries, unchanged.
  const badgeIds = useMemo(() => cameras.map((c) => c.id), [cameras])
  const screenActive = useScreenActive()

  // Recent-tracks reel, FIXED above the camera grid (crop per track → track
  // detail). Not the list's `ListHeaderComponent`: that is a cell inside the
  // scroll content, so the reel scrolled away with the cameras — see
  // `cameras-reel-placement.ts`.
  //
  // The block itself is unconditional so its space is reserved from the first
  // frame.
  //
  // `live` is CONNECTION only — deliberately no longer `&& screenActive`.
  // This tab stays mounted under Settings and under a camera detail
  // (`freezeOnBlur: false`). The reel is mounted for the connection's whole
  // life, so a return costs nothing and keeps its rows and scroll position;
  // what must stop while nobody looks is the FETCHING, and `TrackReel`'s feed
  // gates every trigger (live announcements, the focus delta) on
  // `useScreenActive` itself.
  const seekToMoment = useSeekToMoment()
  const recentReel = (
    <RecentReelBlock
      cardWidth={reelCardWidth}
      live={state === 'connected'}
      // "Go to this moment" (D483): the on-demand player over this screen where
      // there is room for it, the `?at=` navigation otherwise. One decision,
      // in `live/use-seek-to-moment.ts`.
      onSeek={(track, epochMs) => seekToMoment(track.deviceId, epochMs)}
    />
  )

  // ── Which cameras this screen can actually see ─────────────────────────
  //
  // Snapshot demand used to follow MOUNT, and this list is the surface where
  // that diverges most: a `FlatList` realises cells well past the fold, and
  // Expo keeps this tab mounted while the operator is on Events. After D108 a
  // demanded camera is a camera the hub captures every five seconds, so the
  // whole install stayed enrolled for a screen nobody was looking at.
  //
  // Reported, not enforced, here: `snapshot-viewport.ts` owns the rule and why
  // it defaults to visible.
  //
  // An INACTIVE screen withdraws its vote entirely rather than reporting its
  // whole list hidden. Two reasons, and the second is the one that bites: the
  // cards already stop asking on their own (`shouldRequestSnapshot` is
  // `screenActive`), so a hidden vote buys nothing; and this list stays mounted
  // while the operator is inside ONE camera, so voting its cameras hidden would
  // vote against the very camera the detail screen is painting — which reports
  // no viewport of its own and so could not outvote it.
  // `null` until the list has measured its viewport once — it then knows what is
  // on screen; before that it knows nothing and casts no vote (see
  // `listViewportReport`).
  const [viewableIds, setViewableIds] = useState<readonly number[] | null>(null)
  // Stable identity: `FlatList` refuses a changing `onViewableItemsChanged`,
  // and `setViewableIds` is itself stable, so an empty dependency list is both
  // sufficient and honest.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: readonly { key?: string | null }[] }) => {
      setViewableIds(
        viewableItems
          .map((entry) => Number(entry.key))
          .filter((id) => Number.isFinite(id) && id > 0),
      )
    },
    [],
  )

  // ── The opening sweep ──────────────────────────────────────────────────
  //
  // A camera below the fold is captured only when it scrolls INTO view, so the
  // frame it opens onto can be hours old. On the FIRST opening this screen
  // walks the whole list two cameras at a time and then stops — one recent
  // frame per camera, a bounded cost, paid once. `snapshot-rotation.ts` owns
  // the rule and the arithmetic; `openingSweepDone` is what makes it once.
  //
  // Deliberately not a standing rotation: that is the perpetual capture D108
  // removed. If hours-old tiles ever come back on a long-lived session, the
  // re-arm belongs here as a staleness check on the overview — not as a timer
  // that never stops.
  const [warmIds, setWarmIds] = useState<readonly number[]>([])
  // The tick reads the CURRENT list and viewport through a ref rather than
  // closing over them: depending on `viewableIds` would rebuild the interval on
  // every scroll frame, and each rebuild fires a tick immediately — a slice per
  // scroll instead of one per twelve seconds.
  const sweepInputs = useRef<{ all: readonly number[]; visible: readonly number[] }>({
    all: [],
    visible: [],
  })
  useEffect(() => {
    sweepInputs.current = { all: badgeIds, visible: viewableIds ?? [] }
  }, [badgeIds, viewableIds])
  useEffect(() => {
    if (!screenActive || openingSweepDone) return
    let covered: ReadonlySet<number> = new Set()
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = (): void => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const tick = (): void => {
      const next = nextSweepSlice({
        all: sweepInputs.current.all,
        visible: sweepInputs.current.visible,
        covered,
        size: SWEEP_SLICE_SIZE,
      })
      covered = next.covered
      setWarmIds(next.warm)
      if (!next.done) return
      // An empty list is not a finished sweep — the hub had simply not answered
      // yet, and marking it done there would spend the app's one sweep on
      // nothing.
      if (sweepInputs.current.all.length > 0) openingSweepDone = true
      stop()
      setWarmIds([])
    }
    timer = setInterval(tick, SWEEP_TICK_MS)
    tick()
    return () => {
      stop()
      setWarmIds([])
    }
  }, [screenActive])

  useEffect(() => {
    if (!screenActive) {
      snapshotViewport.forget(CAMERAS_VIEWPORT_OWNER)
      return
    }
    const report = listViewportReport(badgeIds, viewableIds, warmIds)
    if (report === null) snapshotViewport.forget(CAMERAS_VIEWPORT_OWNER)
    else snapshotViewport.report(CAMERAS_VIEWPORT_OWNER, report)
  }, [screenActive, viewableIds, warmIds, badgeIds])

  // Unmounting without this leaves a vote nothing can retract — every camera
  // this screen last called hidden would stay undemandable app-wide.
  useEffect(
    () => () => {
      snapshotViewport.forget(CAMERAS_VIEWPORT_OWNER)
    },
    [],
  )
  // Only used to word the empty state — the LIST itself is already filtered by
  // the hub, so there is nothing here to hide.
  const { hasNoViewableDevices } = useUserScope()

  return (
    <CameraBadgesProvider deviceIds={badgeIds} enabled={screenActive}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader />
      <CamerasDisplaySheet visible={displayOpen} onClose={() => setDisplayOpen(false)} />
      <ReelFilterSheet visible={reelFilterOpen} onClose={() => setReelFilterOpen(false)} />
      {/* PTZ / linked devices / function switches for ONE camera at a time —
          opened by the card's own controls button. Mounted once here rather
          than per card; see `CameraControlsOverlay`'s header comment for why,
          and for where the retired switched-off tile badge's signal (D62)
          moved to. */}
      <CameraControlsOverlay
        visible={controlsCameraId !== null}
        camera={controlsCamera}
        onClose={() => setControlsCameraId(null)}
      />
      {/* The central area below shows CONTENT only — the hub connection is
          stated once, by the overlay at the app root. (FIX 5) */}
      {/* THE FLEET, not the chosen bucket. Branching the whole page on the
          filtered list meant that pressing Favourites with nothing starred
          replaced the reel, the selector and the list with "no cameras
          configured" — and took away the control that would have undone it.
          "Does this hub have cameras" and "does this chip match any" are
          different questions. */}
      {allCameras.length > 0 ? (
        <>
        {/* Fixed page chrome: the cameras scroll UNDER this, and a tap on a
            reel card keeps working while they do — the block is a SIBLING of
            the list, not an overlay over it, so there is no hit-test to
            arbitrate and no absolute positioning to keep in sync with the
            header's safe-area inset (`ScreenHeader` owns that, above).
            ONE branch with the list, so the two can never disagree about
            whether the page has a reel. */}
        {recentReel}
        {/* BETWEEN the reel and the list, as asked. A sibling of both, so it
            scrolls with neither: the picker must stay reachable while the
            list below it is scrolled. */}
        <CameraLocationBar
          locations={locations}
          bucket={bucket}
          onSelect={setBucket}
          favouriteCount={favouriteIds.size}
          icons={locationIcons.data}
          zones={siteZones.data}
          motionOrder={motionOrder}
          onToggleMotionOrder={toggleMotionOrder}
        />
        {/* The wrapper carries the marker: `FlatList` does not forward `testID`
            to the scroller it renders, and the placement test has to be able
            to ask "is the reel inside the thing that scrolls". */}
        <View testID={CAMERAS_LIST_TEST_ID} style={styles.listWrap}>
        <FlatList
          data={cameras}
          // The bucket matched nothing. Said HERE, inside the page, so the reel
          // and the selector stay put and the chip that caused it is one press
          // from undoing itself.
          ListEmptyComponent={
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 13,
                textAlign: 'center',
                paddingVertical: SPACING.xl,
              }}
            >
              {t('v2.cameras.bucketEmpty')}
            </Text>
          }
          // Remount the list when column count flips so FlatList rebuilds its
          // cell layout cleanly (RN requires a fresh key on numColumns change).
          key={`cols-${numColumns}`}
          numColumns={numColumns}
          keyExtractor={(item) => String(item.id)}
          // Snapshot demand follows what is on screen, not what is mounted —
          // see the effect above and `snapshot-viewport.ts`.
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={SNAPSHOT_VIEWABILITY_CONFIG}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onPullRefresh}
              tintColor={colors.foregroundMuted}
              colors={[colors.primary]}
            />
          }
          // Extra bottom padding so the corner FAB never covers the last row.
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.md + 88 + navInset, gap: SPACING.md }}
          columnWrapperStyle={numColumns > 1 ? { gap: SPACING.md } : undefined}
          renderItem={({ item }) => (
            <View style={{ flex: 1 / numColumns }}>
              <CameraCard
                camera={item}
                isFavourite={favouriteIds.has(item.id)}
                onToggleFavourite={() => { toggleFavourite(item.id) }}
                // A NAVIGATION press that deliberately buzzes — one of the two
                // documented exceptions in `lib/haptics-policy.ts`. Opening a
                // camera is the primary action of the app, not incidental
                // traversal, and it is the one press most often made without
                // looking at the screen.
                onPress={() => { hapticTap(); router.push(`/camera/${item.id}`) }}
                // Summon the movable player WITHOUT leaving the list, LIVE — the
                // overlay's own controls take it back in time from there. Never
                // `atMs: Date.now()`: that is a recorded seek past the archive's
                // edge, and the window sat still until pause → play.
                onOpenOverlay={() => {
                  hapticTap()
                  openOnDemandPlayer(liveOnDemandRequest(item.id))
                }}
                onOpenControls={() => { hapticTap(); setControlsCameraId(item.id) }}
              />
            </View>
          )}
        />
        </View>
        </>
      ) : startingUp || isLoading ? (
        // Cold launch (initial dial still racing) or first cameras query in
        // flight: shimmer skeletons in the final grid geometry — content
        // replaces the boxes in place, and no "offline" ever flashes here.
        <CamerasGridSkeleton numColumns={numColumns} reelCardWidth={reelCardWidth} />
      ) : state !== 'connected' ? (
        // No cached content AND not connected past the startup grace: the root
        // hub-status overlay conveys "connecting/offline" — keep the centre
        // empty so status shows once.
        null
      ) : (
        <Centered>
          {/* Two very different empty screens wear the same shape. "No cameras
              are configured" sends the operator to the hub to add one; "none
              are in YOUR access profile" sends them to whoever owns the
              grants. The hub filters the list server-side, so from here they
              are indistinguishable — `scope.viewableDeviceCount` is the only
              thing that can tell them apart, and only when it CONFIRMED zero.
              An unknown scope keeps the original wording. */}
          <Text style={{ color: colors.foregroundMuted, fontSize: 15 }}>
            {t(hasNoViewableDevices ? 'v2.cameras.emptyOutOfScope' : 'v2.cameras.empty')}
          </Text>
          {hasNoViewableDevices ? (
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12, textAlign: 'center' }}>
              {t('v2.cameras.emptyOutOfScopeHint')}
            </Text>
          ) : null}
          {error ? (
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12, textAlign: 'center' }}>
              {/* A deadline expiry is a SLOW hub (typically one cluster node not
                  answering), not a broken app — and saying so is the difference
                  between "wait, it degrades" and "it's dead, force-quit it".
                  Before the deadline existed this case had no message at all:
                  the query never settled, so the screen showed a skeleton
                  forever with nothing to read. */}
              {isQueryDeadlineError(error)
                ? t('v2.cameras.hubNotAnswering')
                : error instanceof Error
                  ? error.message
                  : t('v2.common.loadError')}
            </Text>
          ) : null}
        </Centered>
      )}

      {/* Corner FAB speed-dial — appearance + edit-list actions. Only while
          connected (the actions act on the live camera list). */}
      {state === 'connected' ? (
        <CamerasFab
          open={fabOpen}
          onToggle={() => setFabOpen((o) => !o)}
          onClose={() => setFabOpen(false)}
          onAppearance={() => {
            setFabOpen(false)
            setDisplayOpen(true)
          }}
          onEditList={() => {
            setFabOpen(false)
            router.push('/settings/cameras')
          }}
          reelCondition={reelCondition}
          onReelFilter={() => {
            setFabOpen(false)
            setReelFilterOpen(true)
          }}
        />
      ) : null}
    </View>
    </CameraBadgesProvider>
  )
}

const styles = StyleSheet.create({
  listWrap: { flex: 1 },
})

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING['2xl'],
        gap: SPACING.sm,
      }}
    >
      {children}
    </View>
  )
}
