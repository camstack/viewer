/**
 * ClipStageView — where a clip that lives on the CAMERA plays.
 *
 * ## Why this is a sheet again, and what would remove the sheet for good
 *
 * 1.0.512 put this INSIDE the camera's frame, with the playback machine held in
 * a `clip` mode that refused every action. That mode was the direct cause of a
 * hard regression on device 3629 ("Camera porta retro"): `isLive` is
 * `mode === 'live' && …`, and `use-timeline-scrub`'s go-live echo has exactly
 * one brake — `if (!isLiveRef.current) onGoLive()`. A mode that could not be
 * left by GO_LIVE removed the brake, so the echo ran on every scroll
 * evaluation and `goLiveFelt`'s `hapticTap()` buzzed on every pass, with the
 * scroller re-anchored each time. *"Sento la vibrazione continua e non posso
 * più muovere."* `go-live-terminator.spec.ts` is the guard.
 *
 * The operator's own diagnosis was the right one:
 *
 * > *"Si deve staccare completamente la parte Clips dal playback… Anche il
 * > player non è lo stesso ma un video al di sopra. Non riusciamo ad
 * > utilizzare la stessa macchina di playback tramite WebRTC?"*
 *
 * He is right on both counts. This IS a `<video>` over the camera's surface,
 * which is why it needed detaching at all — and detaching by convention is what
 * broke. The real answer is to stop overlaying: recorded playback is ONE WebRTC
 * track with a moving source pointer owned by the broker's per-viewer
 * `TimelineSession`, and a clip whose bytes the provider has already minted to
 * the hub's scratch could be another position of that pointer. Then there is no
 * overlay, no second player and nothing to detach.
 *
 * That is server work and it is not done (see D570's revision for the costing:
 * the broker has no file source kind at all, and the feeder's only byte source
 * is `recording.locateSegment/readGopBytes`, all keyed `(deviceId, profile,
 * epoch)`). Until it lands, a clip plays HERE — in a sheet, which is honest
 * about being a second player, and which cannot starve the app because it holds
 * no opinion about the machine at all.
 *
 * ## What survived from 1.0.512, because none of it was the bug
 *
 * The loop read off the row (`repeat={stage.loop}`), the in-progress clip that
 * plays once and says why, and prev/next stepping that skips rows the provider
 * refused.
 */
import React, { useCallback, useMemo } from 'react'
// ui-check-ok: full-screen clip player; SheetModal is a layout change (pre-existing)
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Video from 'react-native-video'
import { useTranslation } from 'react-i18next'

import { ChevronLeft, ChevronRight, X } from '../../../lib/icons.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { useServer } from '../../../app/ServerProvider.js'
import { absoluteMediaPath } from '../../../data/event-media-url.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { log } from '../../../lib/logger.js'
import type { ClipStage } from '../../../clips/clip-stage.js'
import { clipSheetShows } from '../../../clips/clip-stage.js'
import type { ClipPlaybackState } from '../../../clips/use-clip-playback.js'

export interface ClipStageViewProps {
  readonly stage: ClipStage
  readonly playback: ClipPlaybackState
  /** Null when there is no clip that way in the list. The control is then
   *  rendered DISABLED rather than removed: a button that appears and
   *  disappears as you step is harder to aim at than one that greys out, and
   *  its absence would read as "this build has no stepping". */
  readonly onPrev: (() => void) | null
  readonly onNext: (() => void) | null
  readonly onClose: () => void
}

/** The test hook for "a clip owns the frame right now". */
export const CLIP_STAGE_TEST_ID = 'clip-stage'

export function ClipStageView({
  stage,
  playback,
  onPrev,
  onNext,
  onClose,
}: ClipStageViewProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { controller, state: connection } = useConnection()
  const { token } = useServer()
  const serverUrl = connection === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null

  const headers = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const url = useMemo<string | null>(() => {
    if (playback.kind !== 'ready') return null
    // The address is hub-relative and the plane is authenticated: rendered
    // without the session Bearer it comes back 401 and the frame stays black.
    return absoluteMediaPath(serverUrl, playback.playback.playbackUrl)
  }, [playback, serverUrl])

  const onVideoError = useCallback(
    (e: unknown): void => {
      // A branch that produces no media names the reason, and it carries the
      // deviceId, because "why is 102 worse than 101" is the only question
      // ever asked of this.
      log.warn('clips', 'clip stage playback failed', {
        deviceId: stage.kind === 'clip' ? stage.deviceId : null,
        clipId: stage.kind === 'clip' ? stage.clipId : null,
        error: String(e),
      })
    },
    [stage],
  )

  // One authority for whether this sheet exists at all — `clipSheetShows`.
  if (!clipSheetShows(stage)) return null

  const notice =
    stage.kind === 'refused'
      ? (stage.reason ?? t('v2.clips.playFailed'))
      : playback.kind === 'failed'
        ? (playback.reason ?? t('v2.clips.playFailed'))
        : playback.kind === 'resolving'
          ? t('v2.clips.loading')
          : null

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <View
        testID={CLIP_STAGE_TEST_ID}
        style={[StyleSheet.absoluteFill, styles.stage, { backgroundColor: colors.background }]}
      >
      {url !== null && stage.kind === 'clip' ? (
        <Video
          source={headers === undefined ? { uri: url } : { uri: url, headers }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          controls
          paused={false}
          // The whole ask, and it is read off the row rather than set here.
          repeat={stage.loop}
          onError={onVideoError}
        />
      ) : null}

      {notice !== null ? (
        <View style={styles.noticeBox}>
          <Text style={[styles.notice, { color: colors.foregroundMuted }]}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.topRow} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('v2.clips.closeClip')}
          onPress={onClose}
          hitSlop={8}
          style={[styles.btn, { backgroundColor: colors.background + 'CC' }]}
        >
          <X size={14} color={colors.foreground} />
        </Pressable>
        {stage.kind === 'clip' && stage.inProgress ? (
          // The one thing an operator would otherwise file as a bug: this clip
          // did not repeat, and every other one does.
          <Text style={[styles.badge, { color: colors.foregroundMuted }]}>
            {t('v2.clips.stillRecordingNoLoop')}
          </Text>
        ) : null}
        {playback.kind === 'ready' && playback.playback.mismatch !== null ? (
          // Never swallowed: on a phone on cellular it is 30x the bytes.
          <Text style={[styles.badge, { color: colors.foregroundMuted }]}>
            {t('v2.clips.servedInstead', {
              asked: playback.playback.mismatch.asked,
              served: playback.playback.mismatch.served,
            })}
          </Text>
        ) : null}
      </View>

      <View style={styles.navRow} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: onPrev === null }}
          accessibilityLabel={t('v2.clips.previousClip')}
          disabled={onPrev === null}
          onPress={() => onPrev?.()}
          hitSlop={8}
          style={[styles.btn, { backgroundColor: colors.background + 'CC', opacity: onPrev === null ? 0.35 : 1 }]}
        >
          <ChevronLeft size={16} color={colors.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: onNext === null }}
          accessibilityLabel={t('v2.clips.nextClip')}
          disabled={onNext === null}
          onPress={() => onNext?.()}
          hitSlop={8}
          style={[styles.btn, { backgroundColor: colors.background + 'CC', opacity: onNext === null ? 0.35 : 1 }]}
        >
          <ChevronRight size={16} color={colors.foreground} />
        </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  stage: { justifyContent: 'center', zIndex: 60 },
  noticeBox: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  notice: { fontSize: 13, textAlign: 'center' },
  topRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    gap: 8,
  },
  btn: { padding: 6, borderRadius: 14 },
  badge: { fontSize: 11 },
})
