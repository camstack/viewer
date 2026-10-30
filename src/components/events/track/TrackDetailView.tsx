/**
 * TrackDetailView — the ONE track-centric detail surface, shared by every events
 * surface (theater cluster modal, events page split-pane, reel, search). It is
 * the "single track in isolation" view: one tracked object's best shot, all of
 * its media, its metadata, and — only when a face exists — its identity panel.
 *
 * Layout (operator-driven):
 *   1. BEST SHOT (hero) — the EXACT image the timeline card shows for the track:
 *      rendered through the shared {@link EventThumb} against the track's
 *      `bestEventId` with the server's DEFAULT kind resolver. Reusing the same
 *      component guarantees the modal hero and the timeline card can never
 *      diverge (same id, same URL, same kind resolution).
 *   2. ALL MEDIA — every media file the pipeline actually stored for the track
 *      (crop / faceCrop / plateCrop / fullFrame / keyFrame / …), in one strip.
 *      Tapping a tile enlarges it. Bounding boxes are burned server-side now
 *      (first/last/snapshot arrive pre-boxed; the clean keyFrame carries none),
 *      so there is NO client-side box toggle — old tracks that stored a
 *      `fullFrameBoxed` file simply expose it as its own selectable tile.
 *      Nothing is shown for a kind the server did not store.
 *   3. PERSON — rendered ONLY when the track carries a detected face
 *      ({@link shouldRenderFaceSection}); omitted entirely otherwise.
 *   4. METADATA + "go to this moment".
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, FlatList, ActivityIndicator, StyleSheet, type ListRenderItem } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Image } from 'expo-image'
import * as Linking from 'expo-linking'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, Crosshair, ImageOff, Star, UserRound, UserRoundPlus, Info, Share2, Link2, Check, Maximize2, Route, ChevronLeft, ChevronRight, TriangleAlert } from '../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, mediaScrim } from '../../../theme/tokens.js'
import { MediaBadge } from '../../ui/MediaBadge.js'
import { useKindPaint } from '../../../../shared/palette.js'
import { ZoomableImage } from '../../camera/theater/detail/ZoomableImage.js'
import { EventThumb } from '../../camera/theater/EventThumb.js'
import { FaceAssignSheet } from './FaceAssignSheet.js'
import { FaceConfidenceBadge } from '../../ui/FaceConfidenceBadge.js'
import { FaceSuggestionRow } from '../../ui/FaceSuggestionRow.js'
import { TrackFlagButtons } from './TrackFlagButtons.js'
import { TrackDetailSkeleton } from './TrackDetailSkeleton.js'
import { TrackMetadataSheet } from './TrackMetadataSheet.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTrackDetailMedia } from '../../../data/use-track-detail-media.js'
import { useShareTrackMedia } from '../../../data/use-share-track-media.js'
import { mediaFileUri, mediaImageSource } from '../../../data/track-media-uri.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { useServer } from '../../../app/ServerProvider.js'
import { useTrackBestDetection } from '../../../data/use-track-best-detection.js'
import { useTrackFace, useIdentities, useAssignFace, faceHasPerson, faceCropUri } from '../../../data/use-face-gallery.js'
import { useHasFeature, useIsAdmin } from '../../../data/use-me.js'
import { useEventKindResolver } from '../../../data/use-event-kind-resolver.js'
import { cleanFrameId, shouldRenderFaceSection, trackCameraName, trackTitle, resolveZoneLabels, mediaFileId } from '../../../data/track-events.js'
import { useZoneNames } from '../../../data/use-occupancy.js'
import { useCameras } from '../../../data/use-cameras.js'
import type { TrackSummary, MediaFileLite } from '../../../data/track-events.js'
import type { TrackDetailNavigation } from '../../../data/track-navigation.js'
import {
  groupTrackMedia, groupForKey, logicalMediaKindLabel, formatResolution,
  mergePlateFallback, mergeFaceFallback, type FaceFallback, type MediaGroup,
} from '../../../data/track-media-groups.js'
import { useTrackPlate, mediaIdFromCropUrl } from '../../../data/use-track-plate.js'
import { useTrackGeometry } from '../../../data/use-track-geometry.js'
import {
  buildTrackTrajectory,
  pickTrajectoryBase,
  trajectorySampleCount,
  trajectorySpanMs,
  type TrackTrajectory,
} from '../../camera/theater/detail/track-trajectory.js'
import { TrajectoryOverlay } from '../../camera/theater/detail/TrajectoryOverlay.js'
import { trackShareTarget, shareImageFilename } from '../../../data/track-share.js'
import { copyText } from '../../../lib/copy-text.js'
import type { ObjectEvent } from '../../camera/theater/event-cluster.js'
import { SectionLabel } from '../../ui/SectionLabel.js'

export interface TrackDetailViewProps {
  /**
   * What the operator asked for when they opened this.
   *
   * `assign-face` comes from the "?" chip on an events card — tapped ON the
   * thing that says a face is waiting for a name. Opening the detail and making
   * them find the assignment again answers a question they already asked.
   *
   * Honoured ONCE per opened track, never re-applied: a sheet that reopened
   * itself every render would be impossible to close.
   */
  readonly openIntent?: 'assign-face'

  readonly track: TrackSummary
  /** Seek the owning surface to the track's best moment. Omit to hide the action. */
  readonly onSeek?: (epochMs: number) => void
  /** Close affordance in the header. Omit to hide (always-mounted pane). */
  readonly onClose?: () => void
  readonly bottomInset?: number
  /** Prev/next over the collection the caller opened this detail from (a
   *  cluster's subjects, the events page's gallery order). Omit to hide the
   *  controls — the view never owns the collection, only the caller does. */
  readonly navigation?: TrackDetailNavigation
}

const FRAME_ASPECT = 16 / 9

function hhmmss(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface MediaGroupTileProps {
  readonly group: MediaGroup
  readonly selected: boolean
  readonly onPress: () => void
  /** The hub base a URL-backed tile resolves against. Threaded as a prop
   *  rather than read from context: this tile is memoised, and a context read
   *  would re-render every tile on any connection change. */
  readonly serverUrl: string | null
  /** The media data plane is AUTHENTICATED. A URL-backed tile without this
   *  renders a broken image — the whole strip went blank the first time this
   *  shipped without it. */
  readonly mediaHeaders: Record<string, string> | undefined
}

/** A media-strip tile for ONE logical media group. Shows the SMALL (fast)
 *  variant, its logical label, and an "HD" corner badge when a higher-resolution
 *  native variant exists behind it. Own failed state → placeholder, selectable. */
const MediaGroupTile = memo(function MediaGroupTile({ group, selected, onPress, serverUrl, mediaHeaders }: MediaGroupTileProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [mediaFileId(group.display)])
  const border = {
    borderColor: selected ? colors.primary : colors.border,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
  }
  return (
    <Pressable onPress={onPress} hitSlop={4} style={styles.tileWrap}>
      <View style={[styles.tile, border, { backgroundColor: colors.surface }]}>
        {failed ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <ImageOff size={18} color={colors.foregroundSubtle} />
          </View>
        ) : (
          <Image
            source={mediaImageSource(mediaFileUri(group.display, serverUrl, { thumbSize: 320 }), mediaHeaders)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            onError={() => setFailed(true)}
          />
        )}
        {group.hasFullVariant ? (
          <View style={[styles.hdBadge, { backgroundColor: colors.primary }]} pointerEvents="none">
            <Text style={[styles.hdBadgeText, { color: colors.primaryForeground }]}>HD</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.tileLabel, { color: selected ? colors.foreground : colors.foregroundMuted }]}>
        {logicalMediaKindLabel(group, t)}
      </Text>
    </Pressable>
  )
})

/** What the large viewer shows: a stored media group, or the track's PATH
 *  (every position drawn over its best full frame). A discriminated union
 *  rather than a sentinel id — every consumer must handle both. */
type ViewerSelection =
  | { readonly kind: 'group'; readonly id: string }
  | { readonly kind: 'path' }

/** One tile in the media strip: a media group, or the synthetic path tile. */
type DetailTile =
  | { readonly kind: 'group'; readonly group: MediaGroup }
  | { readonly kind: 'path'; readonly base: MediaGroup }

interface PathTileProps {
  /** The base frame the path is drawn on — its thumb identifies the tile. */
  readonly base: MediaGroup
  readonly selected: boolean
  readonly onPress: () => void
  /** See {@link MediaGroupTileProps.serverUrl}. */
  readonly serverUrl: string | null
  /** See {@link MediaGroupTileProps.mediaHeaders}. */
  readonly mediaHeaders: Record<string, string> | undefined
}

/** The trajectory tile: the base full frame with a Route badge, selectable like
 *  any media tile. The operator opts INTO the path view — it never replaces
 *  the crop. */
const PathTile = memo(function PathTile({ base, selected, onPress, serverUrl, mediaHeaders }: PathTileProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const border = {
    borderColor: selected ? colors.primary : colors.border,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
  }
  return (
    <Pressable onPress={onPress} hitSlop={4} style={styles.tileWrap}>
      <View style={[styles.tile, border, { backgroundColor: colors.surface }]}>
        <Image
          source={mediaImageSource(mediaFileUri(base.display, serverUrl, { thumbSize: 320 }), mediaHeaders)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
        />
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: mediaScrim(colors) }]} pointerEvents="none">
          <Route size={22} color={colors.foreground} />
        </View>
      </View>
      <Text numberOfLines={1} style={[styles.tileLabel, { color: selected ? colors.foreground : colors.foregroundMuted }]}>
        {t('v2.tracks.path', 'Path')}
      </Text>
    </Pressable>
  )
})

export const TrackDetailView = memo(function TrackDetailView({
  track, onSeek, onClose, bottomInset, navigation, openIntent,
}: TrackDetailViewProps) {
  const { colors } = useTheme()
  const paint = useKindPaint()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  // The hub base a URL-backed media tile resolves against. Track media arrives
  // as a manifest now, so most tiles have no bytes and this is where their
  // pixels come from.
  const { controller } = useConnection()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  // The media data plane is authenticated — a URL-backed tile without this
  // header renders a broken image, which is exactly how the strip went blank
  // the first time this shipped.
  const { token } = useServer()
  const mediaHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )
  const accent = paint(track.className)
  // The tier-2 identity (`track.subLabel`) is a proper noun and stays
  // verbatim; the tier-1 sub-class (`track.label`) and the detection class are
  // TAXONOMY and go through the resolver. A SYNTHETIC (sensor-linked) track
  // titles with its producing DEVICE name instead of the bare type label —
  // see {@link trackTitle}, which owns the whole precedence + tier split.
  const resolver = useEventKindResolver([track.deviceId])
  const displayTitle = trackTitle(track, resolver.resolveLabel)
  // The subtitle names the CAMERA — the one fact the title never carries (the
  // title is the identity/class, or the producing SENSOR for a synthetic
  // track). Resolved through the camera directory rather than the summary's
  // own `cameraName`: a summary built from a cluster event or an embed click
  // carries '' there, which is exactly how this modal used to name no camera
  // at all. Deduplicated against the title on the (degenerate) chance the two
  // ever coincide.
  const { data: cameras } = useCameras({ includeHidden: true })
  const resolvedCameraName = useMemo(
    () => trackCameraName({ deviceId: track.deviceId, cameraName: track.cameraName }, cameras ?? []),
    [track.deviceId, track.cameraName, cameras],
  )
  const subtitleLocation =
    resolvedCameraName !== null && resolvedCameraName !== displayTitle ? resolvedCameraName : ''

  const [contentWidth, setContentWidth] = useState(0)
  // The body ScrollView as a gesture the two zoomable pictures can BLOCK: on
  // iOS the UIScrollView's own pan takes two fingers as readily as one, and
  // with no relation declared it scrolled the page under a pinch. See
  // `ZoomableImage.hostScroll`.
  const hostScroll = useMemo(() => Gesture.Native(), [])
  /**
   * Open on the FIRST render when the detail was opened to assign a face.
   *
   * It used to be `false` plus an effect, so the bare detail painted once
   * before the sheet arrived — the operator asked for the "?" to open the
   * associator and "not go through the detail", and that flash is what going
   * through it looks like.
   */
  const [assignOpen, setAssignOpen] = useState(openIntent === 'assign-face')
  // Assigning a face to a person is the `face-assignment` feature; the NAME is
  // shown to everyone who sees the track. Where the track was inferred is
  // diagnostic and shown to an admin only.
  const canAssignFaces = useHasFeature('face-assignment')
  const isAdmin = useIsAdmin()
  /**
   * Honour the opening intent ONCE per track.
   *
   * Keyed on the track id and not on a boolean, because the detail navigates
   * prev/next without unmounting: a flag would fire on the first track and
   * never again, and re-running on every render would make the sheet
   * impossible to close.
   */
  const intentAppliedFor = useRef<string | null>(track?.trackId ?? null)
  useEffect(() => {
    const id = track?.trackId ?? null
    if (id === null || openIntent !== 'assign-face') return
    if (intentAppliedFor.current === id) return
    intentAppliedFor.current = id
    setAssignOpen(true)
  }, [track?.trackId, openIntent])
  const [metaOpen, setMetaOpen] = useState(false)
  // What the large viewer shows. null → default (clean frame group).
  const [selection, setSelection] = useState<ViewerSelection | null>(null)
  // Whether the large viewer shows the group's NATIVE full-resolution variant
  // (opt-in — the small variant is shown first for decode speed).
  const [showFull, setShowFull] = useState(false)
  // Pixel size of the large media image from onLoad — authoritative once the
  // image has decoded (and the ONLY source for the native full-res variant, whose
  // multi-MB buffer we deliberately never parse on the JS thread).
  const [loadedSize, setLoadedSize] = useState<{ readonly width: number; readonly height: number } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  // The hub's refusal message from the header flag buttons (e.g. the per-camera
  // pin budget). Lifted out of the buttons because the header is one flex row
  // with nowhere to put a sentence — see {@link TrackFlagButtons}.
  const [flagError, setFlagError] = useState<string | null>(null)
  // A different track is a different pair of flags — never carry a refusal
  // about the previous one onto this one.
  useEffect(() => { setFlagError(null) }, [track.trackId])

  const media = useTrackDetailMedia(track.deviceId, track.bestEventId, track.trackId)

  // A track's plate crop can live ONLY in the plate gallery (no `plateCrop`
  // event/track-media row). Fetch it and merge it into the gallery as a synthetic
  // `plateCrop` tile when no real one exists — so the pinned plate tile shows.
  const { plate } = useTrackPlate(track.deviceId, track.trackId, true)
  // The face crop lives under its OWN media owner (`face-<trackId>`), exactly
  // like the plate — so on a hub whose `listTrackMedia` reads only the track
  // owner it is missing from the strip for the same reason. Same gallery row,
  // same media key, same synthetic tile. (This read also drives the Person
  // section further down; React Query serves both from one fetch.)
  const { data: face = null } = useTrackFace(track.deviceId, track.trackId, true)
  const faceFallback = useMemo<FaceFallback | null>(() => {
    if (face === null) return null
    const mediaId = face.cropUrl !== undefined ? mediaIdFromCropUrl(face.cropUrl) : undefined
    return {
      faceId: face.faceId,
      timestamp: face.timestamp,
      ...(face.cropUrl !== undefined ? { cropUrl: face.cropUrl } : {}),
      ...(face.base64 !== undefined ? { base64: face.base64 } : {}),
      ...(mediaId !== undefined ? { mediaId } : {}),
    }
  }, [face])
  // Both detail crops folded into the strip. Each merge is a NO-OP once the hub
  // publishes the real row (a newer `listTrackMedia` covers the face and plate
  // owners), so this is the old-hub path and never a second tile.
  const gallery = useMemo(
    () => mergeFaceFallback(mergePlateFallback(media.gallery, plate), faceFallback),
    [media.gallery, plate, faceFallback],
  )

  // Resolve the track's visited zone IDS to their NAMES (falls back to the id for
  // a zone that no longer exists). Only fetched when the track visited a zone.
  const zoneNames = useZoneNames(track.deviceId, track.zonesVisited.length > 0)
  const zoneLabels = useMemo(
    () => resolveZoneLabels(track.zonesVisited, zoneNames),
    [track.zonesVisited, zoneNames],
  )

  // ONE tile per LOGICAL kind (best shot / key frame / first / last / snapshot …)
  // — the native+small variant pairs collapse so the strip never shows the same
  // shot twice at two resolutions.
  const groups = useMemo<MediaGroup[]>(() => groupTrackMedia(gallery), [gallery])
  const cleanId = useMemo(() => cleanFrameId(gallery), [gallery])
  const defaultGroup = useMemo<MediaGroup | null>(
    () => groupForKey(groups, cleanId) ?? groups[0] ?? null,
    [groups, cleanId],
  )

  // The track's TRAJECTORY: positions fetched off the full track row (the
  // timeline's slim events carry no per-position timestamps), modelled by the
  // pure track-trajectory module, drawn over the best stored FULL frame
  // (keyFrame — the clean full frame of the track's best detection; a crop
  // cannot host frame-normalised points). Both must exist for the tile to show.
  const { geometry } = useTrackGeometry(track.deviceId, track.trackId)
  const trajectory = useMemo<TrackTrajectory | null>(
    () => (geometry !== null ? buildTrackTrajectory(geometry.positions, geometry.envelope) : null),
    [geometry],
  )
  const pathBase = useMemo<MediaGroup | null>(() => pickTrajectoryBase(groups), [groups])
  const pathAvailable = trajectory !== null && pathBase !== null

  const pathSelected = selection?.kind === 'path' && pathAvailable
  const activeGroup = pathSelected
    ? pathBase
    : selection?.kind === 'group'
      ? (groups.find((g) => g.id === selection.id) ?? defaultGroup)
      : defaultGroup

  // The best shot is the SAME image the timeline card renders: an EventThumb
  // over the track. `trackId` is what EventThumb actually addresses media
  // against (D482 — an owner is (table, id), and `bestEventId` alone cannot
  // say which table); `id` stays `bestEventId` only because EventThumb keys
  // its own internal state off it. Built once per track.
  const heroEvent = useMemo<ObjectEvent>(() => ({
    id: track.bestEventId,
    deviceId: track.deviceId,
    trackId: track.trackId,
    timestamp: track.firstSeen,
    className: track.className,
    ...(track.label !== undefined ? { label: track.label } : {}),
  }), [track.bestEventId, track.deviceId, track.trackId, track.firstSeen, track.className, track.label])

  // The "Person" section + the assign-to-person flow, off the SAME `face` read
  // the strip's face tile is built from (fetched above). Graceful null when the
  // track has no face or the hub has no face-gallery cap.
  const showFace = shouldRenderFaceSection(face)
  const personCropUri = face !== null ? faceCropUri(face, serverUrl) : null
  // Identities (name lookup for the suggestion row) + assign mutation so CONFERMA
  // takes the SAME assignFace path as a manual pick. React Query dedupes the
  // identities fetch with the FaceAssignSheet's, so this adds no extra request.
  const { data: identities = [] } = useIdentities(showFace)
  const assignFace = useAssignFace()

  // Reset the selected media when the track changes.
  useEffect(() => { setSelection(null); setShowFull(false) }, [track.trackId])

  // The file the large viewer renders: the group's native variant only when the
  // user opted into full-res AND one exists, else the fast small variant. The
  // path view always uses the base group's fast small variant (the overlay is
  // resolution-independent — it projects onto the rendered rect).
  const effectiveFile =
    activeGroup === null
      ? null
      : !pathSelected && showFull && activeGroup.hasFullVariant
        ? activeGroup.full
        : activeGroup.display
  const effectiveKey = effectiveFile !== null ? mediaFileId(effectiveFile) : null
  // A different media file is a fresh image → drop the last onLoad size until the
  // new one loads (avoids clamping the new image against the old box).
  useEffect(() => { setLoadedSize(null) }, [effectiveKey])

  // The bytes of the SELECTED entry, and nothing else — `getTrackMedia` with
  // `kinds` restricted to this one kind. The block fetch is what made the modal
  // look empty on a busy hub: the manifest answered 7 rows in 0.25 s while the
  // unfiltered byte read ran into the 60 s ceiling, and an empty modal reads as
  // "this track has no media". Keyed per entry, so a slow or broken one leaves
  // every other tile selectable.
  // The hero is the selected file AS A URL: the platform fetches it once,
  // caches it on disk and decodes it off the JS thread. No bytes are read for
  // display — the base64 read (`useTrackMediaEntry`) runs ONLY when the
  // operator asks to share, which is rare; opening a track is not.
  const heroFile: MediaFileLite | null = effectiveFile
  const shareMedia = useShareTrackMedia(track.deviceId, track.trackId)

  // What the IMAGE says about itself: loading until its first paint, error on a
  // failed fetch (with a retry that asks for a fresh copy), ready after. These
  // replace the byte-read states the hero used to have.
  const [heroLoad, setHeroLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [heroAttempt, setHeroAttempt] = useState(0)
  useEffect(() => { setHeroLoad('loading') }, [effectiveKey, heroAttempt])
  const shownSize = loadedSize
  const resolutionLabel = formatResolution(shownSize)
  const largeAspect =
    shownSize !== null ? shownSize.width / shownSize.height : undefined

  // The best detection feeds the metadata sheet's confidence row — a single lazy
  // query, fetched only while that sheet is open.
  const { detection } = useTrackBestDetection(
    track.deviceId, track.trackId, track.bestEventId,
    track.firstSeen, track.lastSeen, metaOpen,
  )

  const onContentLayout = useCallback((w: number) => { if (w > 0) setContentWidth(w) }, [])
  const frameHeight = contentWidth > 0 ? Math.round(contentWidth / FRAME_ASPECT) : 0
  const footerBottom = (bottomInset ?? insets.bottom) + SPACING.md

  const onSelectGroup = useCallback((id: string): void => {
    hapticTap()
    setSelection({ kind: 'group', id })
    setShowFull(false) // a fresh tile always starts on the fast small variant
  }, [])
  const onSelectPath = useCallback((): void => {
    hapticTap()
    setSelection({ kind: 'path' })
    setShowFull(false)
  }, [])

  // The strip's tiles: every media group, plus — when the track HAS a drawable
  // trajectory and a full frame to host it — the synthetic PATH tile, placed
  // right after the frame it draws on.
  const tiles = useMemo<DetailTile[]>(() => {
    const out: DetailTile[] = groups.map((group) => ({ kind: 'group', group }))
    if (pathAvailable && pathBase !== null) {
      const at = out.findIndex((tile) => tile.kind === 'group' && tile.group.id === pathBase.id)
      const pathTile: DetailTile = { kind: 'path', base: pathBase }
      return at >= 0
        ? [...out.slice(0, at + 1), pathTile, ...out.slice(at + 1)]
        : [...out, pathTile]
    }
    return out
  }, [groups, pathAvailable, pathBase])

  // Virtualized strip renderer — the FlatList mounts (and thus DECODES) only the
  // tiles near the viewport, so opening the modal never decodes every media file
  // at once. Each tile always shows the SMALL variant (`group.display`).
  const activeGroupId = activeGroup?.id ?? null
  const renderTile = useCallback<ListRenderItem<DetailTile>>(
    ({ item }) =>
      item.kind === 'path' ? (
        <PathTile
          base={item.base}
          selected={pathSelected}
          onPress={onSelectPath}
          serverUrl={serverUrl}
          mediaHeaders={mediaHeaders}
        />
      ) : (
        <MediaGroupTile
          group={item.group}
          selected={!pathSelected && item.group.id === activeGroupId}
          onPress={() => onSelectGroup(item.group.id)}
          serverUrl={serverUrl}
          mediaHeaders={mediaHeaders}
        />
      ),
    [activeGroupId, onSelectGroup, onSelectPath, pathSelected, serverUrl, mediaHeaders],
  )
  const tileKey = useCallback(
    (tile: DetailTile): string => (tile.kind === 'path' ? 'path' : tile.group.id),
    [],
  )

  // Copy an authenticated deep link into the viewer (opens this track's detail).
  const onCopyLink = useCallback((): void => {
    hapticTap()
    const target = trackShareTarget(track)
    const url = Linking.createURL(target.path, { queryParams: target.queryParams })
    void copyText(url).then((ok) => {
      if (!ok) return
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    })
  }, [track])

  // Share the CURRENTLY SHOWN media image via the OS share sheet (native) / Web
  // Share (web). Public single-event links are not a server capability yet, so
  // sharing the image file itself is the portable "send this out" affordance.
  const onShareImage = useCallback((): void => {
    if (heroFile === null) return
    hapticTap()
    // The bytes are read now and handed to the share sheet when they land.
    // Sharing is the one moment the base64 read is worth it.
    shareMedia.share(heroFile, shareImageFilename(track, heroFile.kind))
  }, [heroFile, shareMedia.share, track])

  // The large viewer renders the selected media file verbatim — boxes (when any)
  // are already burned into the server-stored frame; the client never draws them.
  // No thumb variant: this is the surface the operator zooms into.
  //
  // MEMOISED, and that is not a micro-optimisation. When the bytes are in hand
  // `mediaFileUri` builds a `data:image/jpeg;base64,…` STRING of the whole
  // buffer — up to ~3 MB once the operator asks for the native full-resolution
  // variant. This component re-renders on every unrelated nudge the open detail
  // receives (the events embed reporting its row collection, a camera-list
  // observer notification, a zone-name refetch), and rebuilding a multi-megabyte
  // string on each of those is JS-thread time nobody asked for.
  const largeUri = useMemo<string | null>(() => {
    const uri = mediaFileUri(heroFile, serverUrl)
    // A retry after a failed fetch asks for a fresh copy, not the cached failure.
    if (uri === null || heroAttempt === 0) return uri
    return `${uri}${uri.includes('?') ? '&' : '?'}attempt=${heroAttempt}`
  }, [heroFile, serverUrl, heroAttempt])
  // One `source` object per URI, for the same reason: a fresh object literal on
  // every render hands `expo-image` a prop it has to diff a multi-megabyte
  // string inside, every render.
  const largeSource = useMemo(
    () => mediaImageSource(largeUri, mediaHeaders),
    [largeUri, mediaHeaders],
  )

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <View style={[styles.classDot, { backgroundColor: accent }]} />
            <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
              {displayTitle}
            </Text>
            {typeof track.importance === 'number' ? (
              <View style={[styles.importance, { backgroundColor: colors.primary }]}>
                <Star size={9} color={colors.primaryForeground} fill={colors.primaryForeground} />
                <Text style={[styles.importanceText, { color: colors.primaryForeground }]}>
                  {Math.round(track.importance * 100)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.subtitle, { color: colors.foregroundMuted }]}>
            {subtitleLocation.length > 0 ? `${subtitleLocation} · ` : ''}
            {hhmmss(track.firstSeen)}
            {track.lastSeen > track.firstSeen ? ` – ${hhmmss(track.lastSeen)}` : ''}
          </Text>
        </View>
        {/* Per-track operator flags, as icon toggles RIGHT BESIDE info. They
            live here — not at the bottom of the body they used to sit under —
            because marking a track is something you do while looking at it,
            without scrolling past every media tile first. Mounted on this
            shared body, so the events modal, the wide events pane, the reel,
            semantic search and the theater cluster detail all get them from
            one edit. */}
        <TrackFlagButtons
          key={track.trackId}
          deviceId={track.deviceId}
          trackId={track.trackId}
          {...(track.markForTrain !== undefined ? { markForTrain: track.markForTrain } : {})}
          {...(track.favourited !== undefined ? { favourited: track.favourited } : {})}
          {...(track.debug !== undefined ? { debug: track.debug } : {})}
          {...(track.debugNote !== undefined ? { debugNote: track.debugNote } : {})}
          onError={setFlagError}
        />
        <Pressable
          onPress={() => { hapticTap(); setMetaOpen(true) }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.metadata')}
          style={[styles.iconBtn, { backgroundColor: colors.surface }]}
        >
          <Info size={18} color={colors.foreground} />
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
            <X size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {/* Prev/next over the caller's collection (cluster subjects, events
          gallery order). The track swaps IN PLACE — the surface stays mounted
          and its per-track state resets off `track.trackId` as usual. Ends are
          DISABLED, never hidden: a control that vanishes mid-walk moves the
          other arrow under the operator's finger. */}
      {navigation !== undefined ? (
        <View style={styles.navRow}>
          <Pressable
            onPress={() => { hapticTap(); navigation.onPrev() }}
            disabled={!navigation.hasPrev}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.tracks.prevTrack', 'Previous event')}
            style={[styles.navBtn, { backgroundColor: colors.surface, opacity: navigation.hasPrev ? 1 : 0.35 }]}
          >
            <ChevronLeft size={18} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.navCounter, { color: colors.foregroundMuted }]}>
            {navigation.position}/{navigation.count}
          </Text>
          <Pressable
            onPress={() => { hapticTap(); navigation.onNext() }}
            disabled={!navigation.hasNext}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.tracks.nextTrack', 'Next event')}
            style={[styles.navBtn, { backgroundColor: colors.surface, opacity: navigation.hasNext ? 1 : 0.35 }]}
          >
            <ChevronRight size={18} color={colors.foreground} />
          </Pressable>
        </View>
      ) : null}

      {/* A flag write the hub REFUSED (pin budget). Its own message, verbatim —
          it names the camera and the limit, and is the only failure here an
          operator can act on. */}
      {flagError !== null ? (
        <Text style={[styles.flagError, { color: colors.danger }]}>{flagError}</Text>
      ) : null}

      <GestureDetector gesture={hostScroll}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* While the media manifest is in flight the body wears the SHAPE of
            what is coming (hero, share row, viewer, strip, metadata) rather
            than a spinner or a blank pane — see {@link TrackDetailSkeleton}.
            `loading` is first-load only: a cached re-open keeps painting the
            real content and never flashes the skeleton. */}
        {media.loading ? <TrackDetailSkeleton /> : (
        <>
        {/* 1 — the BEST SHOT (same resolution as the timeline card). */}
        <SectionLabel style={styles.sectionLabel}>
          {t('v2.tracks.bestShot', 'Best shot')}
        </SectionLabel>
        <View
          // ui-check-ok: a picture's letterbox stays black on every theme, like the player's
          style={[styles.hero, { backgroundColor: '#000' }]}
          onLayout={(e) => onContentLayout(e.nativeEvent.layout.width)}
        >
          {contentWidth > 0 && frameHeight > 0 ? (
            <ZoomableImage
              width={contentWidth}
              height={frameHeight}
              resetKey={`hero:${track.bestEventId}`}
              hostScroll={hostScroll}
              // The hero is shown `contain` (a crop may be square, not 16:9) → its
              // rendered aspect isn't known up front, so the pan clamp degrades to
              // the box bound rather than assuming 16:9.
            >
              <EventThumb event={heroEvent} width={contentWidth} height={frameHeight} contentFit="contain" />
            </ZoomableImage>
          ) : null}
        </View>

        {/* Share actions — copy an authenticated deep link into the viewer (opens
            this track's detail) + share the SHOWN image via the OS share sheet.
            Public single-event links are not a server capability yet (only
            grid-view share tokens exist), so the portable share is the image
            file itself. */}
        <View style={styles.shareRow}>
          <Pressable
            onPress={onCopyLink}
            accessibilityRole="button"
            accessibilityLabel={t('v2.tracks.copyLink', 'Copy link')}
            style={[styles.shareBtn, { backgroundColor: colors.surface }]}
          >
            {linkCopied ? <Check size={15} color={colors.primary} /> : <Link2 size={15} color={colors.foreground} />}
            <Text style={[styles.shareBtnText, { color: linkCopied ? colors.primary : colors.foreground }]}>
              {linkCopied ? t('v2.tracks.linkCopied', 'Link copied') : t('v2.tracks.copyLink', 'Copy link')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onShareImage}
            disabled={effectiveFile === null}
            accessibilityRole="button"
            accessibilityLabel={t('v2.tracks.shareImage', 'Share image')}
            style={[styles.shareBtn, { backgroundColor: colors.surface, opacity: effectiveFile === null ? 0.4 : 1 }]}
          >
            <Share2 size={15} color={colors.foreground} />
            <Text style={[styles.shareBtnText, { color: colors.foreground }]}>
              {t('v2.tracks.shareImage', 'Share image')}
            </Text>
          </Pressable>
        </View>

        {/* 2 — ALL media the pipeline stored for the track, ONE tile per LOGICAL
             kind (native+small variants collapsed). Only rendered when at least
             one file exists (no placeholders for missing kinds). */}
        {groups.length > 0 ? (
          <>
            <SectionLabel style={styles.sectionLabel}>
              {t('v2.tracks.media', 'Media')}
            </SectionLabel>

            {/* Large viewer for the selected group's shown variant. */}
            {/* ui-check-ok: a picture's letterbox stays black on every theme, like the player's */}
            <View style={[styles.frame, { height: frameHeight, backgroundColor: '#000' }]}>
              {/* THREE states, and they are never allowed to look alike.
                  A read that failed painted as an empty frame once, and an
                  empty frame is indistinguishable from "the pipeline stored
                  nothing" — the reading that sent an audit after a track whose
                  every row and blob the hub was holding. `loading` says the
                  bytes are coming, `error` says the read failed and offers the
                  retry, `absent` says the index lists nothing. The strip below
                  is outside this box, so a stuck entry never traps the
                  operator on it. */}
              {largeUri !== null && frameHeight > 0 ? (
                <ZoomableImage
                  width={contentWidth}
                  height={frameHeight}
                  resetKey={`${pathSelected ? 'path' : 'media'}:${effectiveKey ?? 'none'}`}
                  // The media is `contain` (arbitrary aspect: crop/face/plate/
                  // frame) → clamp against the natural aspect (from the JPEG
                  // header, else onLoad).
                  contentAspect={largeAspect}
                  hostScroll={hostScroll}
                >
                  <Image
                    source={largeSource}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    // Memory-safe zoom: a native keyFrame can be 3840×2160 (~2.2MB
                    // JPEG). `allowDownscaling` decodes to the ~display size (not the
                    // full bitmap) and `recyclingKey` frees the previous decode when
                    // the selected media changes — together they keep the zoomable
                    // hero from OOM-crashing on huge frames.
                    allowDownscaling
                    recyclingKey={effectiveKey ?? undefined}
                    onError={() => setHeroLoad('error')}
                    onLoad={(e) => {
                      setHeroLoad('ready')
                      const { width: iw, height: ih } = e.source
                      if (iw <= 0 || ih <= 0) return
                      // A fresh object here re-rendered the whole detail on
                      // every `onLoad`, including the ones that report a size
                      // already held. Same size ⇒ same state.
                      setLoadedSize((prev) =>
                        prev !== null && prev.width === iw && prev.height === ih
                          ? prev
                          : { width: iw, height: ih },
                      )
                    }}
                  />
                  {/* PATH view: every track position drawn over the full frame.
                      Inside the zoom node so the path scales/pans with the
                      image (same trick as the scene bbox overlay). */}
                  {pathSelected && trajectory !== null ? (
                    <TrajectoryOverlay
                      trajectory={trajectory}
                      width={contentWidth}
                      height={frameHeight}
                      imageSize={shownSize}
                      color={accent}
                    />
                  ) : null}
                </ZoomableImage>
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.center]}>
                  <ImageOff size={40} color={colors.foregroundSubtle} />
                  <Text style={[styles.heroNotice, { color: colors.foregroundSubtle }]}>
                    {t('v2.tracks.mediaEntryAbsent')}
                  </Text>
                </View>
              )}
              {largeUri !== null && heroLoad === 'loading' ? (
                <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
                  <ActivityIndicator color={colors.foregroundMuted} />
                  <Text style={[styles.heroNotice, { color: colors.foregroundMuted }]}>
                    {t('v2.tracks.mediaEntryLoading')}
                  </Text>
                </View>
              ) : largeUri !== null && heroLoad === 'error' ? (
                <View style={[StyleSheet.absoluteFill, styles.center]}>
                  <TriangleAlert size={32} color={colors.danger} />
                  <Text style={[styles.heroNotice, { color: colors.danger }]}>
                    {t('v2.tracks.mediaEntryError')}
                  </Text>
                  <Pressable
                    onPress={() => { hapticTap(); setHeroAttempt((n) => n + 1) }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                    style={[styles.heroRetryBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.heroRetryText, { color: colors.primaryForeground }]}>
                      {t('common.retry')}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Type + ACTUAL resolution badge, bottom-left. In the PATH view
                  it reports the trajectory honestly instead: sample count +
                  time span, and — when NO sample carried a fine position (the
                  degenerate full-frame boxes) — says so. */}
              {activeGroup !== null && largeUri !== null ? (
                <MediaBadge
                  style={styles.badge}
                  label={
                    pathSelected && trajectory !== null
                      ? `${t('v2.tracks.path', 'Path')} · ${t('v2.tracks.pathSummary', {
                          count: trajectorySampleCount(trajectory),
                          seconds: Math.max(1, Math.round(trajectorySpanMs(trajectory) / 1000)),
                        })}${trajectory.nodes.length === 0 ? ` · ${t('v2.tracks.pathNoLocalization')}` : ''}`
                      : `${logicalMediaKindLabel(activeGroup, t)}${resolutionLabel !== null ? ` · ${resolutionLabel}` : ''}`
                  }
                />
              ) : null}

              {/* Full-resolution switch, bottom-right — only when a native
                  higher-res variant sits behind the shown small one (hidden in
                  the path view, which pins the fast small variant). */}
              {!pathSelected && activeGroup?.hasFullVariant && largeUri !== null ? (
                <MediaBadge
                  style={styles.fullBtn}
                  icon={Maximize2}
                  active={showFull}
                  onPress={() => { hapticTap(); setShowFull((v) => !v) }}
                  accessibilityLabel={t('v2.tracks.viewFullRes', 'Full resolution')}
                  label={showFull ? t('v2.tracks.fullResBadge', 'Full') : t('v2.tracks.viewFullRes', 'Full resolution')}
                />
              ) : null}
            </View>

            {/* Position counter + strip of grouped media (incl. the path tile). */}
            {tiles.length > 1 ? (
              <Text style={[styles.counter, { color: colors.foregroundMuted }]}>
                {Math.max(
                  0,
                  tiles.findIndex((tile) =>
                    pathSelected
                      ? tile.kind === 'path'
                      : tile.kind === 'group' && tile.group.id === activeGroup?.id,
                  ),
                ) + 1}/{tiles.length}
              </Text>
            ) : null}
            <FlatList
              horizontal
              data={tiles}
              keyExtractor={tileKey}
              renderItem={renderTile}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
              // Virtualization: decode at most the visible few tiles on open.
              removeClippedSubviews
              initialNumToRender={6}
              maxToRenderPerBatch={4}
              windowSize={3}
            />
          </>
        ) : media.failed ? (
          /* The media READ failed (saturated runner, dead node, deadline). A
             silently absent section painted this exact failure as "this track
             has no media" — twice, on tracks whose rows and blobs were all on
             the hub. Say it failed, and give the operator the retry. */
          <>
            <SectionLabel style={styles.sectionLabel}>
              {t('v2.tracks.media', 'Media')}
            </SectionLabel>
            <View style={[styles.mediaNotice, { backgroundColor: colors.surface }]}>
              <Text style={[styles.mediaNoticeText, { color: colors.danger }]}>
                {t('v2.tracks.mediaLoadError', 'Media could not be loaded')}
              </Text>
              <Pressable
                onPress={() => { hapticTap(); media.retry() }}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry', 'Retry')}
                style={[styles.mediaRetryBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.mediaRetryText, { color: colors.primaryForeground }]}>
                  {t('common.retry', 'Retry')}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          /* Both legs answered and there is truly nothing stored. Distinct
             from the failure above: this is a real answer, so it gets a real
             sentence instead of a vanished section. */
          <>
            <SectionLabel style={styles.sectionLabel}>
              {t('v2.tracks.media', 'Media')}
            </SectionLabel>
            <View style={[styles.mediaNotice, { backgroundColor: colors.surface }]}>
              <Text style={[styles.mediaNoticeText, { color: colors.foregroundMuted }]}>
                {t('v2.tracks.noMedia', 'No media stored for this track')}
              </Text>
            </View>
          </>
        )}

        {/* 3 — Person: shown ONLY when the track carries a detected face. */}
        {showFace && face !== null ? (
          <>
            <SectionLabel style={styles.sectionLabel}>
              {t('v2.tracks.person')}
            </SectionLabel>
            <View style={[styles.personCard, { backgroundColor: colors.surface }]}>
              {personCropUri ? (
                <Image
                  source={mediaImageSource(personCropUri, mediaHeaders)}
                  style={[styles.personFace, { backgroundColor: colors.backgroundElevated }]}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.personFace, styles.personFaceEmpty, { backgroundColor: colors.backgroundElevated }]}>
                  <UserRound size={20} color={colors.foregroundMuted} />
                </View>
              )}
              <View style={styles.personNameCol}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.personName,
                    { color: face.identityName ? colors.foreground : colors.foregroundMuted },
                  ]}
                >
                  {face.identityName ?? t('v2.tracks.notAssigned')}
                </Text>
                {/* Auto-assigned (recognizer pick, not manual) → show WHY: the
                    match score + native face size. Legacy/manual rows carry no
                    score, so the badge self-hides. */}
                {faceHasPerson(face.identityId) && !face.assigned ? (
                  <FaceConfidenceBadge score={face.bestMatchScore} px={face.nativeFaceShortSidePx} />
                ) : null}
              </View>
              {canAssignFaces ? (
                <Pressable
                  onPress={() => { hapticTap(); setAssignOpen(true) }}
                  accessibilityRole="button"
                  accessibilityLabel={t('v2.tracks.assignFaceTitle')}
                  style={[styles.assignBtn, { backgroundColor: colors.primary }]}
                >
                  <UserRoundPlus size={14} color={colors.primaryForeground} />
                  <Text style={[styles.assignBtnText, { color: colors.primaryForeground }]}>
                    {/* "Change" whenever a person is linked (auto-recognized OR
                        manual) — a pre-assigned face already has one, so it must
                        not read "Assign to person". */}
                    {faceHasPerson(face.identityId) ? t('v2.tracks.changePerson') : t('v2.tracks.assignPerson')}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Recognizer suggested a person but wasn't confident enough to
                assign → confirm (same assignFace as a manual pick) or dismiss
                (device-local). Self-hides when the face has a person / there's
                no suggestion / it was dismissed. */}
            {canAssignFaces ? (
              <FaceSuggestionRow
                faceId={face.faceId}
                hasPerson={faceHasPerson(face.identityId)}
                suggestedIdentityId={face.suggestedIdentityId}
                suggestedMatchScore={face.suggestedMatchScore}
                identities={identities}
                onConfirm={(identityId) => { void assignFace.mutateAsync({ faceId: face.faceId, identityId }) }}
                busy={assignFace.isPending}
              />
            ) : null}
          </>
        ) : null}

        {/* Metadata. */}
        <View style={styles.meta}>
          {zoneLabels.length > 0 ? (
            <MetaRow label={t('v2.tracks.zones', 'Zones')} value={zoneLabels.join(', ')} colors={colors} />
          ) : null}
          {track.audioLabels.length > 0 ? (
            <MetaRow label={t('v2.tracks.audio', 'Audio')} value={track.audioLabels.join(', ')} colors={colors} />
          ) : null}
        </View>

        </>
        )}
      </ScrollView>
      </GestureDetector>

      {/* Face → person assignment sheet. */}
      <FaceAssignSheet
        face={assignOpen && canAssignFaces ? face : null}
        onClose={() => {
          setAssignOpen(false)
          // Opened ONLY to assign ⇒ closing the sheet leaves the screen, it
          // does not drop the operator into a detail they never asked for.
          // The other half of "do not go through the detail".
          if (openIntent === 'assign-face') onClose?.()
        }}
      />

      {/* Metadata sheet — ids / timestamps / importance ("why notable") /
          confidence / media keys, each row with a copy button. */}
      <TrackMetadataSheet
        track={metaOpen ? track : null}
        cameraName={resolvedCameraName ?? undefined}
        confidence={detection?.confidence}
        mediaIds={media.mediaIds}
        zoneLabels={zoneLabels}
        showPlacement={isAdmin}
        onClose={() => setMetaOpen(false)}
      />

      {/* "Go to this moment". ALWAYS visible here: on the multi-camera events
          surfaces there is NO zero-cost recording-availability signal (tracks
          don't carry a hasRecording flag and there is no batched coverage
          overview cap — a per-item getAvailability call is forbidden). SERVER
          GAP (documented): stamp `hasRecording: boolean` on listTracks rows,
          or add a batched `recording.getCoverageOverview({deviceIds, from, to})`;
          then this can gate like the timeline detail (recordingKnownAt). */}
      {onSeek ? (
        <Pressable
          onPress={() => { hapticTap(); onSeek(track.firstSeen) }}
          style={[styles.seekBtn, { backgroundColor: colors.primary, marginBottom: footerBottom }]}
        >
          <Crosshair size={18} color={colors.primaryForeground} />
          <Text style={[styles.seekText, { color: colors.primaryForeground }]}>
            {t('v2.theater.detailSeek', 'Go to this moment')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
})

interface MetaRowProps {
  readonly label: string
  readonly value: string
  readonly colors: { foreground: string; foregroundMuted: string }
}

const MetaRow = memo(function MetaRow({ label, value, colors }: MetaRowProps) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, paddingVertical: SPACING.sm },
  headerText: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  classDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  importance: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  importanceText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subtitle: { fontSize: 12, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: SPACING.xs },
  navBtn: { width: 64, height: 32, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  navCounter: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  flagError: { fontSize: 12, lineHeight: 16, marginBottom: SPACING.xs },
  scroll: { paddingBottom: SPACING.md },
  sectionLabel: { marginTop: SPACING.sm, marginBottom: SPACING.xs },
  hero: { width: '100%', aspectRatio: FRAME_ASPECT, borderRadius: RADIUS.md, overflow: 'hidden' },
  frame: { width: '100%', borderRadius: RADIUS.md, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  shareRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
  },
  shareBtnText: { fontSize: 13, fontWeight: '600' },
  badge: { position: 'absolute', left: SPACING.sm, bottom: SPACING.sm, maxWidth: '60%' },
  fullBtn: { position: 'absolute', right: SPACING.sm, bottom: SPACING.sm },
  hdBadge: {
    position: 'absolute', top: 2, right: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4,
  },
  hdBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.3 },
  counter: { fontSize: 11, fontVariant: ['tabular-nums'], textAlign: 'center', marginTop: SPACING.xs },
  // The hero's own notice text — the three states share it so they read as
  // three answers to the same question rather than three unrelated screens.
  heroNotice: {
    marginTop: SPACING.sm,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: SPACING.md,
  },
  heroRetryBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
  },
  heroRetryText: { fontSize: 12, fontWeight: '600' },
  mediaNotice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderRadius: RADIUS.md,
  },
  mediaNoticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  mediaRetryBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.md },
  mediaRetryText: { fontSize: 13, fontWeight: '700' },
  strip: { gap: SPACING.sm, paddingVertical: SPACING.sm, paddingRight: SPACING.md },
  tileWrap: { width: 64, alignItems: 'center', gap: 2 },
  tile: { width: 64, height: 64, borderRadius: RADIUS.sm, overflow: 'hidden' },
  tileLabel: { fontSize: 10, maxWidth: 72, textAlign: 'center' },
  personCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.sm, borderRadius: RADIUS.md },
  personFace: { width: 44, height: 44, borderRadius: RADIUS.md },
  personFaceEmpty: { alignItems: 'center', justifyContent: 'center' },
  personNameCol: { flex: 1, gap: 4 },
  personName: { fontSize: 14, fontWeight: '600' },
  assignBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md },
  assignBtnText: { fontSize: 12, fontWeight: '700' },
  meta: { marginTop: SPACING.md, gap: SPACING.xs },
  metaRow: { flexDirection: 'row', gap: SPACING.sm },
  metaLabel: { fontSize: 12, width: 92 },
  metaValue: { fontSize: 12, flex: 1, fontWeight: '500' },
  seekBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md },
  seekText: { fontSize: 15, fontWeight: '700' },
})
