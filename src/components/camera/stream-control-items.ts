/**
 * stream-control-items — what a STREAM control IS, defined once.
 *
 * Volume, talk-back and system PiP belong to the picture, not to a screen.
 * They are needed on the single-camera screen's on-video disc cluster
 * (`StreamOverlayControls` → `OverlayDiscGroup`) and on the on-demand
 * overlay's picture (`OnDemandPlayer`), and a second audio button that
 * disagrees with the one that owns the function is worse than no button
 * (D62) — so the icon, the label, the active state and the id live here and
 * both surfaces call the same builder.
 *
 * What a SURFACE still decides is only where the disc lands: the cluster is a
 * parameter, because the screen splits audio left / PiP right across a whole
 * window and the 256pt overlay has one row.
 *
 * Absences are absences. A camera with no two-way audio gets NO talk disc, and
 * a platform with no system PiP gets NO PiP disc — not a greyed one. The
 * overlay's padlock was removed for exactly the opposite shape: a control that
 * accepts a press and throws the result away.
 *
 * Pure — no React, no `Platform`. {@link systemPipSupported} takes the OS name
 * so the rule is asserted by value in node.
 */
import {
  Volume2, VolumeX, Mic, MicOff, PictureInPicture2, History, Layers, PanelRight, Move,
} from '../../lib/icons.js'
import {
  nextTimelineDock,
  timelineDockLabelKey,
  type TimelineDock,
} from './theater/timeline-dock.js'
import type { OverlayDisc, OverlayDiscCluster } from './OverlayDiscGroup.js'
import type { ClipAudioNotice } from '../../clips/clip-audio-notice.js'
import { formatRateLabel } from './recorded-transport.js'

/** Translator slice these builders need — `t` as i18next hands it over. */
export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

export interface MuteDiscArgs {
  readonly muted: boolean
  readonly onToggleMute: () => void
  readonly cluster: OverlayDiscCluster
  readonly t: TranslateFn
  /**
   * Why the clip on the frame is silent, when the SPEED is why
   * (`clip-audio-notice.ts`, D621). Omitted on every surface that has no clip
   * stage — the on-demand overlay, and the single camera while it is live.
   */
  readonly audio?: ClipAudioNotice
}

/**
 * The picture's own volume. ACTIVE means audible, which is why `active` is
 * the negation: an active mute button reads as "muted" to nobody.
 *
 * When the broker has silenced the clip because of the RATE, the disc grows an
 * `N×` badge and says so. Three things it deliberately does NOT do, each of
 * them the obvious alternative:
 *
 *  - it does not swap the glyph for an error or a warning. The silence is what
 *    the operator asked for; a disabled thing must never look broken (D62).
 *  - it does not flip `active`. That reads the operator's OWN mute, and a
 *    second authority writing the same field would make the button lie about
 *    what a press will do.
 *  - it does not disable the press. Returning to 1× brings the sound back and
 *    his mute choice has to have survived the trip.
 *
 * The badge shows even while he has it muted as well: both are true, and the
 * one he did not choose is the one worth saying.
 */
export function muteDisc({ muted, onToggleMute, cluster, t, audio }: MuteDiscArgs): OverlayDisc {
  // The rate is spelled by the ONE rate formatter this app has, so the badge
  // and the speed chip can never disagree about what 0.25 looks like.
  const rateLabel = audio == null ? null : formatRateLabel(audio.rate)
  return {
    id: 'mute',
    icon: muted ? VolumeX : Volume2,
    // The disc's `label` IS its accessibility label (`OverlayDiscButton`), and
    // the badge is a bare `<Text>` a screen reader inside a Pressable never
    // announces. So the sentence has to be the label: a badge nobody can hear
    // is the same silent-and-unexplained state this change exists to end.
    label:
      rateLabel === null
        ? muted
          ? t('v2.streamBar.unmute')
          : t('v2.streamBar.mute')
        : t('v2.streamBar.silentBySpeed', { rate: rateLabel }),
    active: !muted,
    onPress: onToggleMute,
    ...(rateLabel === null ? {} : { badge: rateLabel }),
    cluster,
  }
}

export interface TalkDiscArgs {
  /** From the camera's features — the disc is omitted, never disabled. */
  readonly hasTwoWayAudio: boolean
  readonly talking: boolean
  readonly onToggleTalk: () => void
  readonly cluster: OverlayDiscCluster
  readonly t: TranslateFn
}

/** Talk-back. `null` on a camera that has no two-way audio. */
export function talkDisc({
  hasTwoWayAudio, talking, onToggleTalk, cluster, t,
}: TalkDiscArgs): OverlayDisc | null {
  if (!hasTwoWayAudio) return null
  return {
    id: 'talk',
    icon: talking ? Mic : MicOff,
    label: talking ? t('v2.streamBar.talkStop') : t('v2.streamBar.talkStart'),
    active: talking,
    onPress: onToggleTalk,
    cluster,
  }
}

export interface SystemPipDiscArgs {
  /** {@link systemPipSupported} of the running platform. */
  readonly supported: boolean
  readonly onStartSystemPip: () => void
  readonly cluster: OverlayDiscCluster
  readonly t: TranslateFn
}

/** System Picture-in-Picture. `null` where the platform has none. */
export function systemPipDisc({
  supported, onStartSystemPip, cluster, t,
}: SystemPipDiscArgs): OverlayDisc | null {
  if (!supported) return null
  return {
    id: 'pip',
    icon: PictureInPicture2,
    label: t('v2.streamBar.pip'),
    onPress: onStartSystemPip,
    cluster,
  }
}

/**
 * Where system PiP exists at all. iOS only: the window is WebKit's, started
 * from the embed's `<video>` (`live/pip-request.ts`), and no other platform
 * this app ships on answers that request.
 */
export function systemPipSupported(os: string): boolean {
  return os === 'ios'
}

const TIMELINE_DOCK_ICON = { off: History, overlay: Layers, side: PanelRight } as const

/**
 * The landscape timeline button: ONE disc that cycles off → overlay → side. A
 * distinct glyph and label per state (the label names the state and what a
 * press does next); lit whenever a timeline is on screen.
 */
export function timelineDockDisc(args: {
  readonly dock: TimelineDock
  readonly onSet: (next: TimelineDock) => void
  readonly cluster: OverlayDiscCluster
  readonly t: TranslateFn
}): OverlayDisc {
  const { dock, onSet, cluster, t } = args
  return {
    id: 'timeline',
    icon: TIMELINE_DOCK_ICON[dock],
    label: t(timelineDockLabelKey(dock)),
    active: dock !== 'off',
    onPress: () => onSet(nextTimelineDock(dock)),
    cluster,
  }
}

/**
 * The fullscreen PTZ disc: opens and closes the PTZ pad over the picture
 * (`PtzOverlay`). It wears the toolbar's own PTZ glyph (`Move`), so the same
 * function looks the same on both surfaces. The caller builds it only for a
 * camera the session may steer — a camera without PTZ gets no disc at all.
 */
export function ptzDisc(args: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly cluster: OverlayDiscCluster
  readonly t: TranslateFn
}): OverlayDisc {
  const { open, onToggle, cluster, t } = args
  return {
    id: 'ptz',
    icon: Move,
    label: open ? t('v2.ptz.hideControls') : t('v2.ptz.showControls'),
    active: open,
    onPress: onToggle,
    cluster,
  }
}
