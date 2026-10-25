import React, { useMemo } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  Moon,
  ImageOff,
  Lightbulb,
  PictureInPicture2,
  Power,
  Siren,
  Plug,
  Activity,
  Clock,
  Heart,
  type LucideIcon,
} from '../lib/icons.js'
import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, RADIUS, type ColorTokens } from '../theme/tokens.js'
import { FEATURE, type CameraInfo } from '../data/use-cameras.js'
import { useCameraBadgeRow } from '../data/CameraBadgesProvider.js'
import { useSnapshot } from '../data/use-snapshot.js'
import { SkeletonBox } from './ui/SkeletonBox.js'
import { useBattery } from '../data/use-battery.js'
import { useSettings } from '../data/use-settings.js'
import { BatteryBadge } from './camera/BatteryBadge.js'
import { NetworkLinkBadge, networkLinkBadgeVisible } from './camera/NetworkLinkBadge.js'
import {
  StatusBadgeButton,
  StatusDetailPopover,
  useStatusDetail,
} from './camera/StatusDetailPopover.js'
import { batteryDetailLines, networkLinkDetailLines } from './camera/status-detail-lines.js'
import { StreamBadge, streamBadgeVisible } from './camera/StreamBadge.js'
import { useNetworkLink } from '../data/use-network-link.js'
import { useMotionHighlight } from '../data/use-motion.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { useCardSnapshotWidth } from '../hooks/use-responsive.js'
import { SnapshotImage } from './camera/SnapshotImage.js'
import { MotionBorder } from './camera/MotionBorder.js'
import { CameraStatusDot } from './camera/CameraStatusDot.js'
import { isLiveEdge, shouldRequestSnapshot, type TileCameraState } from './camera/tile-snapshot-gate.js'
import { OccupancyBadge } from './camera/OccupancyBadge.js'
import {
  useCameraChildrenStates,
  type ChildDeviceState,
  type ChildDeviceKind,
} from '../data/use-children-states.js'

interface CameraCardProps {
  readonly camera: CameraInfo
  readonly onPress: () => void
  /** Opens the per-camera controls sheet (PTZ / linked devices / function
   *  switches) — `CameraControlsOverlay`, mounted once by the screen. */
  readonly onOpenControls: () => void
  /**
   * Open this camera in the on-demand overlay instead of navigating to it.
   *
   * A separate press and not a mode of {@link CameraCardProps.onPress}: the
   * card's primary action is "go to this camera", and the operator asked for a
   * way to summon the movable player WITHOUT leaving the list.
   */
  readonly onOpenOverlay: () => void
  /** Whether this camera is on the operator's shortlist. */
  readonly isFavourite: boolean
  /** Star / unstar. The card does not own the shortlist — it only shows it. */
  readonly onToggleFavourite: () => void
}

/** Compact age for the stale chip: `45s`, `3m`, `2h`. */
function formatSnapshotAge(ageMs: number | null): string {
  if (ageMs === null) return '—'
  const s = Math.round(ageMs / 1000)
  if (s < 60) return `${String(s)}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${String(m)}m`
  return `${String(Math.round(m / 60))}h`
}

/** Rich camera card: a 16:9 snapshot thumbnail (live `useSnapshot`, expo-image
 *  for memory/disk caching) with sleeping / unavailable / loading states, plus
 *  a footer row carrying the name, online dot, a battery badge (battery cams
 *  only), and small PTZ / two-way-audio feature hints. camstack-themed. */
export const CameraCard = React.memo(function CameraCard({
  camera,
  onPress,
  onOpenControls,
  onOpenOverlay,
  isFavourite,
  onToggleFavourite,
}: CameraCardProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The footer's two glyphs are buttons; one layer, opened over the picture.
  const status = useStatusDetail()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const isBattery = camera.features.includes(FEATURE.battery)

  // Nothing on this card is worth a request while the card cannot be seen. The
  // detail screen is pushed OVER the tabs, so without this every card keeps
  // polling underneath it — ~8 tRPC calls a second on a ten-camera install,
  // competing with the live stream's signaling on the very same WebSocket
  // (the client runs `wsLink`; there is no batching link to absorb them).
  const active = useScreenActive()

  // What this card draws over its thumbnail — global camera-list overlay
  // settings (Cameras page → Display). Only overlays the list already pays for
  // are offered; turning one OFF also stops its per-card query.
  const { settings } = useSettings()
  const listOverlays = settings.cameraList

  // A disabled camera is OUT OF SERVICE at the hub: the stream, the detections
  // and the recording have all stopped there. Polling it would ask a device
  // that has been told to be quiet, and would draw a battery or an occupancy
  // count that no longer refreshes — a stale number reads as a live one.
  const off = camera.disabled

  // Battery: prefer the screen's ONE aggregate call. Its own query stays as
  // the fallback and is genuinely disabled — not merely ignored — when the
  // aggregate answers, or the saving would be a second request instead of none.
  const badges = useCameraBadgeRow(camera.id)
  // Own queries run only once the aggregate has ANSWERED without this camera —
  // never while it is still in flight, or every card asks at every boot.
  const askSelf = !badges.supported && !badges.pending
  const { data: ownBattery = null } = useBattery(
    camera.id,
    isBattery && active && !off && askSelf,
  )
  const battery = badges.supported ? badges.row.battery : ownBattery
  const isSleeping = isBattery && battery?.sleeping === true
  // The camera's own link, same aggregate-first rule as the battery.
  const { data: ownLink = null } = useNetworkLink(camera.id, active && !off && askSelf)
  const networkLink = badges.supported ? badges.row.networkLink : ownLink

  // Child-device states (per accessory) — only while online.
  const { data: childStates = [] } = useCameraChildrenStates(camera.id, camera.online && active && !off)

  // Two questions, not one flag (`tile-snapshot-gate.ts`): what may poll live,
  // and whether to ask for an image. The second one no longer looks at the
  // camera at all — the hub owns the tile for EVERY camera state (D190) and
  // answers a disabled, sleeping, waking, unreachable or offline camera with the
  // last good frame, the state painted into it, and the state named in the
  // metadata beside it. So the tile asks for every camera it is showing and
  // paints whatever came back.
  const tileState: TileCameraState = {
    screenActive: active,
    online: camera.online,
    disabled: off,
    sleeping: isSleeping,
  }
  const liveEdge = isLiveEdge(tileState)
  const snapshotEnabled = shouldRequestSnapshot(tileState)
  // Ask for a card-sized thumbnail rather than the full capture — a 4K frame
  // in a 180-390pt tile was ~756 KB and an 8.3-Mpx decode, twelve times over.
  const cardSnapshotWidth = useCardSnapshotWidth()
  const snapshot = useSnapshot(camera.id, snapshotEnabled, cardSnapshotWidth)
  const {
    uri: snapshotUri,
    isLoading: snapshotLoading,
    refreshing: snapshotRefreshing,
  } = snapshot

  // Live motion (with the configurable linger) — only for online, awake cams
  // (skip offline / sleeping). Graceful when the `motion` cap isn't registered
  // (stays inactive). Shared with the grid tile + detail via useMotionHighlight.
  const motionActive = useMotionHighlight(camera.id, liveEdge && listOverlays.motionBorder)

  // Surface state: once a frame has painted it stays put (the platform image
  // cache keeps the last frame across refreshes/transient errors, so this never
  // blanks).
  //
  // Every camera takes the SAME path, because the hub answers every camera the
  // same way (D190): the last good frame with its state — disabled, sleeping,
  // waking, unreachable, offline — painted into it. The tile used to fork here
  // three ways and cover itself with a panel explaining the 404 it used to get;
  // that panel now hides the very frame that explains the state.
  //
  // The hub timeout outranks the skeleton — a surface that is still "loading"
  // after fifteen seconds is not loading, it is waiting on something that is not
  // coming.
  const showLoading = snapshotLoading && !snapshot.hubUnresponsive
  // The ONE verdict this card still reaches on its own, and it is about the HUB.
  // Nothing painted, nothing pending, and a generous wait already spent
  // (`SNAPSHOT_HUB_TIMEOUT_MS`) — so this is not "the camera is broken", which
  // is a thing only the hub could know, it is "nobody answered".
  //
  // Deliberately not `neverCaptured` and not one failed request: right after a
  // hub restart every camera reports never-captured and every one of them is
  // about to be captured, and that is what used to flash a grid of failure
  // messages over frames that were seconds away.
  const showHubTimeout = snapshot.hubUnresponsive
  // The age of the photograph, over a painted frame. The only thing a picture
  // cannot say about itself — the state it is IN, it says, because the hub drew
  // it there. `stale` is true whenever the hub named a state for the frame or
  // the frame is simply old.
  const showStaleChip = snapshot.stale && snapshotUri !== null && !showLoading

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.media}>
        <SnapshotImage source={snapshot} deviceId={camera.id} style={StyleSheet.absoluteFill} />

        {showLoading ? (
          // Shadow box over the whole media area (not a spinner) — the
          // snapshot fills this exact box when it lands.
          <SkeletonBox />
        ) : showHubTimeout ? (
          <View style={styles.overlay} pointerEvents="none">
            <ImageOff size={22} color={colors.foregroundSubtle} />
            <Text style={styles.overlaySubtleText}>{t('v2.cameras.hubNotProvisioning')}</Text>
          </View>
        ) : null}

        {/* Snapshot refresh in flight behind the painted frame — a subtle
            top-right chip so the periodic update is visible without blanking
            or dimming the current image. */}
        {snapshotRefreshing && !showLoading ? (
          <View
            style={styles.refreshChip}
            pointerEvents="none"
            accessibilityLabel={t('v2.cameras.refreshing')}
          >
            <ActivityIndicator size="small" color="#fff" style={styles.refreshSpinner} />
          </View>
        ) : null}

        {/* The frame's age, honestly labelled: the tile always paints the frame
            the hub names (blanking the grid on every resume from background was
            worse), and this chip is what keeps an old photograph from
            masquerading as live. ONE chip for every reason a frame is not
            current — old, asleep, offline, disabled — because the reason itself
            is already in the picture, drawn there by the service that composed
            it. */}
        {/* TOP-LEFT, as ONE row. The heart was asked for in this corner and the
            stale chip already lived here; stacking two absolutely-positioned
            children in the same corner would overlap them exactly on the
            cameras that need both. A row puts the heart first — the thing the
            operator presses — and lets the chip follow only when it exists. */}
        <View style={styles.topLeft} pointerEvents="box-none">
          <Pressable
            onPress={() => { hapticTap(); onToggleFavourite() }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: isFavourite }}
            accessibilityLabel={
              isFavourite
                ? t('v2.cameras.unfavourite', 'Remove from favourites')
                : t('v2.cameras.favourite', 'Add to favourites')
            }
            style={styles.heartChip}
          >
            {/* FILLED when starred: a heart that only changes colour is a
                state two operators read differently in bright sun. */}
            <Heart
              size={13}
              color={isFavourite ? '#ff4d6d' : '#fff'}
              fill={isFavourite ? '#ff4d6d' : 'transparent'}
            />
          </Pressable>
          {showStaleChip ? (
            <View
              style={styles.staleChip}
              pointerEvents="none"
              accessibilityLabel={t('v2.cameras.snapshotStale', {
                age: formatSnapshotAge(snapshot.ageMs),
              })}
            >
              <Clock size={10} color="#fff" />
              <Text style={styles.staleChipText}>{formatSnapshotAge(snapshot.ageMs)}</Text>
            </View>
          ) : null}
        </View>

        {/* Live occupancy — compact class chips, bottom-left over the thumbnail
            (only at the live edge for online, awake cams). Renders nothing when
            the scene is empty or the analytics cap is absent. */}
        <OccupancyBadge
          deviceId={camera.id}
          enabled={liveEdge && listOverlays.occupancy !== 'off'}
          corner={listOverlays.occupancy === 'off' ? 'bottom-left' : listOverlays.occupancy}
        />

        {/* Live motion — a pulsing ring around the whole card. Mounted only
            while motion (with linger) is active AND the list setting asks
            for it. The "Motion" pill was retired: the overlay (ring / regions)
            is the motion treatment. */}
        {motionActive && !off && listOverlays.motionBorder ? <MotionBorder /> : null}

        {/* The figures behind the footer's glyphs. Inside the PICTURE, at its
            bottom edge and directly above the badges that open it: the card
            clips (`overflow: 'hidden'`), so a layer anchored to a 14pt glyph
            in a two-column grid would be cut off at the card's edge. Here the
            width budget is the card itself. */}
        <StatusDetailPopover
          controller={status}
          battery={battery}
          link={networkLink}
          deviceId={camera.id}
          colors={colors}
          placement="insideBottom"
        />
      </View>

      <View style={styles.footer}>
        <View style={styles.dot}>
          {isSleeping && !camera.disabled ? (
            <Moon size={12} color={colors.foregroundMuted} />
          ) : (
            <CameraStatusDot
              deviceId={camera.id}
              online={camera.online}
              disabled={camera.disabled}
              enabled={!isSleeping}
            />
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {camera.name}
        </Text>
        <View style={styles.hints}>
          {/* Child-device state — one icon PER device (lit/dim by on-state), plus
              a separate motion icon for on-motion children. No counts. */}
          {childStates.map((child) => (
            <ChildStateIcons key={child.id} child={child} colors={colors} />
          ))}
          {isBattery && battery ? (
            <StatusBadgeButton subject="battery" lines={batteryDetailLines(battery)} controller={status}>
              <BatteryBadge battery={battery} colors={colors} />
            </StatusBadgeButton>
          ) : null}
          {networkLinkBadgeVisible(networkLink) && networkLink ? (
            <StatusBadgeButton subject="link" lines={networkLinkDetailLines(networkLink)} controller={status}>
              <NetworkLinkBadge link={networkLink} colors={colors} />
            </StatusBadgeButton>
          ) : null}
          {/* Neither of the two above: the card would have no way to be opened,
              and with it the stream numbers would be unreachable on exactly the
              cameras most likely to be debugged — the wired ones. */}
          {streamBadgeVisible({
            batteryVisible: Boolean(isBattery && battery),
            linkVisible: Boolean(networkLinkBadgeVisible(networkLink) && networkLink),
          }) ? (
            <StatusBadgeButton subject="stream" lines={[]} controller={status}>
              <StreamBadge colors={colors} />
            </StatusBadgeButton>
          ) : null}
        </View>
        {/* Opens `CameraControlsOverlay`: PTZ (when the camera has it), linked
            devices, and the function switches. Where an operator now learns a
            switched-off function moved to (D62) — the badge that used to sit
            in `hints` above reported the same fact and now lives inside that
            sheet instead. Nested inside the card's own navigate-`Pressable`,
            so the tap must not also open the camera. */}
        {/* Same rule as the controls button below: the card itself navigates,
            so this tap must not also open the camera. */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation()
            onOpenOverlay()
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.cameras.overlayA11y')}
          style={({ pressed }) => [
            styles.controlsBtn,
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <PictureInPicture2 size={18} color={colors.foregroundMuted} />
        </Pressable>
        <Pressable
          onPress={(e) => {
            e.stopPropagation()
            onOpenControls()
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.cameras.controlsA11y')}
          style={({ pressed }) => [
            styles.controlsBtn,
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Lightbulb size={18} color={colors.foregroundMuted} />
        </Pressable>
      </View>
    </Pressable>
  )
})

/** The lucide icon for a child accessory kind. */
const KIND_ICON: Record<ChildDeviceKind, LucideIcon> = {
  light: Lightbulb,
  switch: Power,
  siren: Siren,
  other: Plug,
}

/** Per-device child icons: the accessory's own icon (colored by on/off) and, for
 *  on-motion children, a separate motion icon (colored by armed state). An icon
 *  is dimmed (muted) when inactive, accented when active. No counts/labels. */
function ChildStateIcons({ child, colors }: { child: ChildDeviceState; colors: ColorTokens }) {
  const Icon = KIND_ICON[child.kind]
  const onColor = child.kind === 'siren' ? colors.danger : colors.warning
  return (
    <View style={badgeStyles.row}>
      {child.hasSwitch ? (
        <Icon size={14} color={child.on ? onColor : colors.foregroundMuted} />
      ) : null}
      {child.hasMotion ? (
        <Activity size={14} color={child.motionOn ? colors.primary : colors.foregroundMuted} />
      ) : null}
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  text: { fontSize: 11, fontWeight: '600' },
})

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: RADIUS.lg,
      overflow: 'hidden',
    },
    cardPressed: { backgroundColor: colors.surfaceHover },
    media: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: colors.backgroundElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overlay: { alignItems: 'center', justifyContent: 'center', gap: SPACING.xs },
    refreshChip: {
      position: 'absolute',
      top: SPACING.sm,
      right: SPACING.sm,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    refreshSpinner: { transform: [{ scale: 0.65 }] },
    topLeft: {
      position: 'absolute',
      top: SPACING.sm,
      left: SPACING.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    heartChip: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    staleChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    staleChipText: { color: '#fff', fontSize: 10, fontWeight: '500' },
    overlaySubtleText: { color: colors.foregroundSubtle, fontSize: 12 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.lg,
    },
    dot: { width: 8, alignItems: 'center' },
    name: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: '600' },
    hints: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
    controlsBtn: {
      width: 28,
      height: 28,
      borderRadius: RADIUS.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
  })
}
