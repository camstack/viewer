/**
 * OverlayLayer — every informational overlay of ONE stream, in one stack.
 *
 * The single composer both stream surfaces use (the single-camera view and a
 * grid tile): it reads nothing itself, it turns the global overlay document
 * (`OverlayConfig`), what the host knows (which gates are open, the camera
 * name, the control groups) and the `fade` flags into the entries of an
 * `OverlayStack`. So "which overlay is where, in which order, and when it
 * hides" is decided in `overlay-config.ts` / `overlay-stack.ts` and drawn here,
 * once — never per host.
 *
 * Must be mounted inside an `OverlayFrame` (it supplies the size multiplier
 * every badge reads).
 */
import React, { useMemo } from 'react'
import Animated from 'react-native-reanimated'
import { useControlsTransitions } from '../../../theme/motion.js'
import { AudioLevelMeter } from '../AudioLevelMeter.js'
import { DeviceInfoOverlay } from '../DeviceInfoOverlay.js'
import { DoorbellBadge } from '../DoorbellBadge.js'
import { MotionBadge } from '../MotionBadge.js'
import { LiveViewersBadge } from '../LiveViewersBadge.js'
import { OccupancyBadge } from '../OccupancyBadge.js'
import { StreamStatsOverlay } from '../StreamStatsOverlay.js'
import type { OccupancyClassCount } from '../../../data/occupancy.js'
import type { StreamStats } from '../../../live/live-view-types.js'
import type { DiscClusters } from '../OverlayDiscGroup.js'
import { isOverlayShown, sizeStepOf, type OverlayConfig, type OverlayItemId } from './overlay-config.js'
import type { OverlayPosition } from './overlay-position.js'
import { OverlayStepScale } from './OverlayFrame.js'
import { OverlayStack, type OverlayStackEntry } from './OverlayStack.js'
import { stackItems } from './overlay-stack.js'
import { useReadoutEntries } from './OverlayReadouts.js'

/** Which live data overlays may draw right now — the host's answer, one flag
 *  per overlay, because the hosts gate them differently (the single view draws
 *  the stats panel whatever the transport; a tile only while it plays). */
export interface OverlayGates {
  readonly audioMeter: boolean
  /** Motion right now (live, lingered) or at the playback time. */
  readonly motion: boolean
  readonly occupancy: boolean
  readonly stats: boolean
  readonly viewers: boolean
  readonly readouts: boolean
  readonly doorbell: boolean
}

/** What recorded playback feeds the live overlays (`PlaybackOverlaySource`).
 *  Absent = the live feeds. */
export interface OverlayPlayback {
  readonly occupancy: readonly OccupancyClassCount[]
  readonly audioDbfs: number | null
}

export interface OverlayLayerProps {
  readonly deviceId: number
  readonly config: OverlayConfig
  readonly gates: OverlayGates
  /** Recorded playback's data for the occupancy badge and the audio meter. */
  readonly playback?: OverlayPlayback
  /** The auto-hiding controls are showing — what every `fade` flag follows. A
   *  host without auto-hiding controls passes `true`: nothing fades. */
  readonly controlsVisible: boolean
  readonly hasDoorbell?: boolean
  /** The device-info pill's position (a device-level setting). */
  readonly deviceInfo: OverlayPosition
  readonly getStats: () => Promise<StreamStats | null>
  /** One-line stats read-out — a cell too small for the panel. */
  readonly statsCompact?: boolean
  /** Safe-area insets (fill / landscape). */
  readonly edgePad?: { readonly left: number; readonly right: number; readonly bottom: number; readonly top?: number }
  /** The camera-name pill. Absent = this host has none (a tile draws its own). */
  readonly name?: React.ReactNode
  /** The two control groups. Absent = this host has none. */
  readonly controls?: DiscClusters
  /** Tap on the audio meter (opens the inline position picker). Absent = the
   *  meter is read-only. */
  readonly onPressAudioMeter?: () => void
}

/** The control groups follow the auto-hide with the same fade the group always
 *  had; they are mounted only while visible. */
function FadingControls({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const fade = useControlsTransitions()
  return (
    <Animated.View entering={fade.entering} exiting={fade.exiting} pointerEvents="box-none">
      {children}
    </Animated.View>
  )
}

export function OverlayLayer({
  deviceId,
  config,
  gates,
  playback,
  controlsVisible,
  hasDoorbell = false,
  deviceInfo,
  getStats,
  statsCompact = false,
  edgePad,
  name,
  controls,
  onPressAudioMeter,
}: OverlayLayerProps): React.JSX.Element {
  const readouts = useReadoutEntries({
    deviceId,
    config,
    enabled: gates.readouts,
    controlsVisible,
  })

  const entries = useMemo<readonly OverlayStackEntry[]>(() => {
    const nodeFor = (id: OverlayItemId): React.ReactNode => {
      switch (id) {
        case 'cameraName':
          return name ?? null
        case 'controlsLeft':
          return controlsVisible && controls?.left ? <FadingControls>{controls.left}</FadingControls> : null
        case 'controlsRight':
          return controlsVisible && controls?.right ? <FadingControls>{controls.right}</FadingControls> : null
        case 'doorbell':
          return <DoorbellBadge deviceId={deviceId} enabled={gates.doorbell} />
        case 'audioMeter':
          return gates.audioMeter ? (
            <AudioLevelMeter
              deviceId={deviceId}
              position={config.audioMeter}
              onPress={onPressAudioMeter}
              playbackDbfs={playback?.audioDbfs ?? undefined}
            />
          ) : null
        case 'occupancy':
          return <OccupancyBadge deviceId={deviceId} enabled={gates.occupancy} playbackCounts={playback?.occupancy} />
        case 'stats':
          return gates.stats ? <StreamStatsOverlay getStats={getStats} compact={statsCompact} /> : null
        case 'viewers':
          return <LiveViewersBadge deviceId={deviceId} enabled={gates.viewers} />
        case 'deviceInfo':
          return <DeviceInfoOverlay />
        case 'motionBadge':
          return gates.motion ? <MotionBadge /> : null
        default:
          return null
      }
    }
    const named = stackItems({ ...config, readouts: [] }, { hasDoorbell, deviceInfo })
      .filter((item) => isOverlayShown(config, item.id, controlsVisible))
      .filter((item) => item.id !== 'cameraName' || name !== undefined)
      .filter((item) => (item.id !== 'controlsLeft' && item.id !== 'controlsRight') || controls !== undefined)
      .map((item) => {
        const step = sizeStepOf(config, item.id)
        const node = nodeFor(item.id)
        return {
          ...item,
          node: step === 0 || node === null ? node : <OverlayStepScale step={step}>{node}</OverlayStepScale>,
        }
      })
    return [...named, ...readouts.entries]
  }, [
    config,
    hasDoorbell,
    deviceInfo,
    controlsVisible,
    name,
    controls,
    gates,
    playback,
    deviceId,
    getStats,
    statsCompact,
    onPressAudioMeter,
    readouts.entries,
  ])

  return (
    <>
      {readouts.probes}
      <OverlayStack entries={entries} userOrder={config.order} edgePad={edgePad} />
    </>
  )
}
