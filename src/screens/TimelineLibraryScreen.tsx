/**
 * TimelineLibraryScreen — the Library's "Timeline" section: the events of EVERY
 * camera on ONE timeline.
 *
 * It is `TheaterTimeline` again, the host the single-camera page and the grid
 * wall already mount, scoped to N cameras (`scopeIds`): the same filter panel,
 * date panel, clusters, density bands, cursor and selection tools, so nothing
 * here is a second timeline. What this page supplies is only what the host
 * takes from its parent:
 *
 *   • the picture — a grid of stills cut at the cursor (`CursorFramesGrid`),
 *     loaded when the drag ends, never during it;
 *   • the camera scope — "all" by default, a multi-select in the camera panel
 *     (`CameraSwitcherPanel` in scope mode);
 *   • the playback machine, with a sink that reaches no player: the cursor IS
 *     the playhead here;
 *   • the selection → one export or one delete per camera in scope
 *     (`useScopeExportSelection`, the same confirm and admin gate as one camera).
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useRouter } from 'expo-router'

import { TheaterTimeline } from '../components/camera/theater/TheaterTimeline.js'
import { gridWallSlotStyle, gridWallStackHeight } from '../grid/grid-timeline-surface.js'
import { useCameras } from '../data/use-cameras.js'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { useScreenMinSide } from '../hooks/use-responsive.js'
import {
  selectActiveEpoch,
  selectScrubDirection,
  usePlaybackMachine,
  type PlaybackControlSink,
} from '../recording/playback-machine.js'
import { useWallTransport } from '../recording/use-wall-transport.js'
import { useScopeExportSelection } from '../recording/use-export-selection.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { resolveDetailLayoutMode, type DetailLayoutMode } from './camera-detail/detail-layout.js'
import { computeWideDetailSizes } from './camera-detail/wide-detail-sizes.js'
import { CursorFramesGrid, type FrameCamera } from './timeline-library/CursorFramesGrid.js'
import { cursorInstant } from './timeline-library/cursor-frames.js'
import {
  pickFromIds,
  resolveCameraScope,
  ticksFor,
  type CameraPick,
} from './timeline-library/camera-scope.js'
import { useSettledInstant } from './timeline-library/use-settled-instant.js'

/** The filter's key. The activity filter is kept per camera id; the Library's
 *  belongs to no camera, so it gets one that no camera can have. */
const LIBRARY_FILTER_KEY = -1

/** No player to reach: the machine moves the cursor and the cursor is all. */
const NO_PLAYER_SINK: PlaybackControlSink = {
  scrubStart: () => {},
  scrubTo: () => {},
  scrubCommit: () => {},
  seek: () => {},
  goLive: () => {},
}

function onRetryNothing(): void {}
function setNoRate(): void {}

export function TimelineLibraryScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const camerasQuery = useCameras()
  const cameras = useMemo(() => camerasQuery.data ?? [], [camerasQuery.data])
  const known = useMemo(() => cameras.map((c) => c.id), [cameras])

  const [pick, setPick] = useState<CameraPick>(null)
  const scope = useMemo(() => resolveCameraScope(known, pick), [known, pick])
  const selectedIds = useMemo(() => ticksFor(known, pick), [known, pick])
  const onScopeChange = useCallback(
    (ids: readonly number[]) => {
      // Never an empty scope: unticking the last camera is ignored, because a
      // timeline of nothing says "no events" about cameras nobody looked at.
      if (ids.length === 0) return
      setPick(pickFromIds(known, ids))
    },
    [known],
  )

  const playback = usePlaybackMachine(NO_PLAYER_SINK)
  const transport = useWallTransport(playback, setNoRate)
  const activeEpoch = selectActiveEpoch(playback.state)

  const targets = useMemo(
    () =>
      scope.map((id) => ({
        deviceId: id,
        name: cameras.find((c) => c.id === id)?.name ?? String(id),
      })),
    [scope, cameras],
  )
  const exportSelection = useScopeExportSelection(targets, playback)

  // The stills follow the cursor, but only once it is released.
  const [nowMs] = useState(() => Date.now())
  const instant = cursorInstant(activeEpoch, nowMs)
  const settled = useSettledInstant(instant, playback.state.mode === 'seeking')
  const frameCameras = useMemo<readonly FrameCamera[]>(() => targets.map((c) => ({ id: c.deviceId, name: c.name })), [targets])

  // Shape: the theater's own rule, with `fill` (a fullscreen player) mapped to
  // `stack` — this page has no fullscreen picture.
  const { width: winW, height: winH } = useViewportSize()
  const screenMinSide = useScreenMinSide()
  const [boxHeight, setBoxHeight] = useState(0)
  const viewport = useMemo(
    () => ({ width: winW, height: winH, screenMinSide, isWeb: isWebPlatform(), fullscreen: false }),
    [winW, winH, screenMinSide],
  )
  const resolved = resolveDetailLayoutMode(viewport)
  const shape: DetailLayoutMode = resolved === 'fill' ? 'stack' : resolved
  const wideSizes = useMemo(
    () => computeWideDetailSizes({ containerWidth: winW, viewportHeight: winH }),
    [winW, winH],
  )
  const stackHeight = gridWallStackHeight(boxHeight > 0 ? boxHeight : winH)
  const slot = useMemo(() => gridWallSlotStyle(shape, stackHeight, false), [shape, stackHeight])
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h > 0) setBoxHeight((prev) => (prev === h ? prev : h))
  }, [])

  const title = t('v2.library.sections.timeline')

  if (camerasQuery.isLoading || camerasQuery.isPending) {
    return <StateNote text={t('v2.timelineLibrary.loading')} />
  }
  if (scope.length === 0) {
    return <StateNote text={t('v2.timelineLibrary.noCameras')} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={onLayout}>
      <TheaterTimeline
        layoutMode={shape}
        railWidth={wideSizes.railWidth}
        chromeHidden={false}
        hideBack
        stream={
          <View testID="timeline-library-slot" style={slot}>
            <CursorFramesGrid cameras={frameCameras} instant={settled} />
          </View>
        }
        deviceId={scope[0] ?? 0}
        scopeIds={scope}
        filterKeyId={LIBRARY_FILTER_KEY}
        name={title}
        onBack={() => router.back()}
        deviceBinding={{
          cameraName: title,
          hasPtz: false,
          hasBattery: false,
          hasNetworkLink: false,
          hasNavigation: false,
          cameraScope: { selectedIds, onChange: onScopeChange },
        }}
        mode={playback.state.mode}
        activeEpoch={activeEpoch}
        seekAnchor={playback.state.seekAnchor}
        onSeek={playback.seek}
        onScrubBegin={playback.beginScrub}
        onScrubMove={playback.moveScrub}
        onScrubCommit={playback.commitScrub}
        onGoLive={playback.goLive}
        liveLocked={playback.state.liveLocked}
        onToggleLiveLock={playback.toggleLiveLock}
        playbackRate={transport.rate}
        paused={transport.paused}
        loading={false}
        streamFault={{ failed: false, fetching: false, reason: null, onRetry: onRetryNothing }}
        scrubDirection={selectScrubDirection(playback.state)}
        onTogglePlayPause={transport.onTogglePlayPause}
        onJogBack={transport.onJogBack}
        onJogForward={transport.onJogForward}
        onSelectRate={transport.onSelectRate}
        exportSelection={exportSelection}
      />
    </View>
  )
}

function isWebPlatform(): boolean {
  return Platform.OS === 'web'
}

function StateNote({ text }: { readonly text: string }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.lg,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ fontSize: TYPOGRAPHY.size.md, color: colors.foregroundMuted }}>{text}</Text>
    </View>
  )
}
