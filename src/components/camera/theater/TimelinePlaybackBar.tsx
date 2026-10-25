/**
 * TimelinePlaybackBar — the PERMANENT playback band, docked directly under the
 * timeline's main toolbar.
 *
 * It replaces `TimelineTransportControls`, which floated a pill above the
 * now-line and therefore had to guess how much room sat above that line. It
 * guessed wrong on every short landscape drawer and painted over the activity
 * strip; the fit-to-headroom squeeze that followed made the miss smaller
 * without removing the guess. A band laid out by the column owns its space, so
 * there is nothing left to guess.
 *
 * The BAR is always present. Its CONTROLS vary with the playback mode
 * (`playbackBarLayout`): at the live edge it carries the LIVE badge and
 * play/pause; in recorded modes it carries go-to-live · −10s · frame-step ·
 * play/pause · frame-step · +10s · speed.
 *
 * The LIVE LOCK is that same leading control at the live edge (tap toggles
 * it). Off live the slot is return-to-live and the lock is gone — two chips
 * that both speak for the live edge is the defect. A surface that binds no
 * lock at all gets the badge without it (see `onToggleLiveLock`).
 *
 * The trailing slot holds ONE record control with the same SHAPE in both
 * modes: a dot, then Discard + Accept-with-the-duration. What it records is the
 * mode's business, not the bar's — the live picture from now onwards at the
 * live edge, a period of the archive off it (`timeline-layout.ts` decides,
 * once). The two used to be separate controls drawing the same red dot in the
 * same place, and the operator could not tell them apart.
 *
 * Play/pause moved here off the video surface, and the connecting/seeking ring
 * came with it — the ring describes that control, not the picture. During a
 * scrub that same disc shows the DIRECTION of the drag instead (see
 * `scrubDirection`).
 *
 * What it no longer carries is a failure REPORT. Every "this did not load" in
 * the theater — stream, recordings, events — is rendered by
 * `TimelineFaultNotice`, docked immediately under this band.
 *
 * The ROOM decides the arrangement (`playback-bar-fit.ts`): one row where it
 * fits; two rows where it does not and the host can grow (`canWrap`); else
 * tighter gaps and record + speed behind one overflow button. The play button
 * is the centre of the bar in every arrangement. The dropdowns are
 * `PlaybackBarPopover` — portalled to the window on web, so the timeline
 * toolbar above can never paint over them.
 *
 * Presentational + controlled: the parent owns every piece of state except
 * which dropdown is open.
 */
import type { ServedProfileReport } from '../../../recording/recording-messages.js'
import React, { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native'
import Animated from 'react-native-reanimated'
import { useDockTransitions } from '../../../theme/motion.js'
import { useTranslation } from 'react-i18next'
import {
  Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward, StepBack, StepForward, ChevronDown, ArrowUp,
  FastForward, Rewind, Lock, LockOpen, Check, X, Repeat, MoreHorizontal, Camera, Clapperboard, Trash2, Download,
} from '../../../lib/icons.js'

import { useTimelineScale } from './TimelineScaleProvider.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, TABULAR } from '../../../theme/tokens.js'
import { GlassSurface } from '../../ui/GlassSurface.js'
import { playbackBarLayout } from './timeline-layout.js'
import {
  acceptMeasuredWidth,
  playbackBarFit,
  playbackBarGapSet,
  playbackBarSideWidths,
  type PlaybackBarMeasured,
} from './playback-bar-fit.js'
import { PlaybackBarPopover } from './PlaybackBarPopover.js'
import type { PopoverDirection } from './popover-placement.js'
import { TransportSpinnerRing } from './TransportSpinnerRing.js'
import { ClipProgressBar } from './ClipProgressBar.js'
import type { ClipProgressBinding } from '../../../clips/clip-progress.js'
import type { ClipLoopBinding } from '../../../clips/clip-loop.js'
import type { PlaybackMode } from '../../../recording/playback-machine.js'
import type { RecordMenuAction } from '../../../recording/record-menu.js'
import type { RecordControlBinding } from '../../../recording/record-control.js'
import type { ScrubDirection } from '../../../recording/scrub-direction.js'
import { playbackRateMenuOrder, formatRateLabel } from '../recorded-transport.js'
import {
  clipControlDisabled,
  clipRateAllowed,
  clipRateChoices,
  clipRateMenuShown,
  clipStepBackAllowed,
  LEGACY_CONTROLS_VIEW,
  type ClipControlsView,
} from '../../../clips/clip-controls.js'

export interface TimelinePlaybackBarProps {
  /** Machine mode — decides which controls the band carries. */
  readonly mode: PlaybackMode
  /**
   * The selected play rate (never 0 — pause is a separate control).
   *
   * **The menu says nothing about sound, and that is a decision, not a gap.**
   * The hub's recorded transport re-paces frames it has already decoded and
   * drops audio at any rate but 1x (`clip-stream-feeder.ts`: `if (this.rate
   * !== 1) { this.audioDroppedRate += 1; return true }`). This menu used to
   * carry a footer saying so. The operator asked for it gone, was told in as
   * many words that it was the only place the viewer stated the fact and that
   * un-muting at 2x would then be silence with no explanation, and answered
   * *"non fa niente, lasciamolo muto e' ok"* (2026-09-23).
   *
   * So do not re-add it as a D62 fix. Silence at a non-1x rate is known,
   * accepted and deliberately unexplained here; if it is ever to be said
   * again, the mute control is the place, because that control already owns
   * the question the operator is asking when he notices.
   */
  readonly rate: number
  /** Effective pause: the live poster pause, or the recorded rate-0 hold. */
  readonly paused: boolean
  /**
   * The recorded tier the player is really on, next to the one it asked for.
   * Drawn as one small letter beside play — H, M or L — muted when it is the
   * tier asked for, warm when the hub had to serve a lower one. Never a
   * message: the operator asked for that. Hidden while live.
   */
  readonly servedTier?: ServedProfileReport | null
  /** The picture is not there yet (live connecting / recorded seek in flight) —
   *  drawn as a ring around play/pause, which stays fully tappable. */
  readonly loading: boolean
  /**
   * The player reported a HARD failure — the ring around play/pause turns
   * danger-coloured.
   *
   * A BOOLEAN, not the reason: the reason (and its retry) belong to
   * `TimelineFaultNotice`, the one slot under this bar where every failure in
   * the theater is reported. This bar used to carry both, in its trailing slot,
   * where it fought the speed selector for the space and gave the operator a
   * second grammar for "something broke".
   */
  readonly faulted?: boolean
  /**
   * Which way an in-flight scrub is heading, or null when no drag is active.
   *
   * While it is set, the play/pause control shows that direction instead —
   * during a drag the button cannot be pressed anyway (the finger is on the
   * timeline), and what the operator needs from it is the answer to "which way
   * am I going", which nothing else on screen states.
   */
  readonly scrubDirection?: ScrubDirection | null
  readonly onTogglePause: () => void
  readonly onJogBack: () => void
  readonly onJogForward: () => void
  /**
   * The previous / next CLIP, when one holds the frame (D575). The jog pair
   * carries them — see `PlaybackBarLayout.jogMeans` for why that pair and not
   * a new one. Absent ⟺ there is no clip to step between, and then the pair
   * keeps its ±10 s meaning.
   */
  readonly onClipPrev?: (() => void) | null
  readonly onClipNext?: (() => void) | null
  /** A clip holds the frame. Drives `jogMeans`, nothing else. */
  readonly clipHeld?: boolean
  /**
   * The held clip's position inside its file, and the drag that moves it
   * (`clip-progress.ts`). Drawn as the band's SECOND ROW while `clipHeld`.
   * Absent ⟺ this surface has nothing to say about the file's inside — the
   * row is then not drawn, never drawn empty.
   */
  readonly clipProgress?: ClipProgressBinding
  /**
   * The LOOP switch: at the end of the held file, play it again from the
   * start (`clip-loop.ts`).
   *
   * ABSENT ⟺ this surface has no clip to loop — the same rule
   * {@link clipProgress} and {@link record} follow, and the bar reads it
   * through the SAME statement that a file is on screen, so a visible switch
   * with nothing to loop cannot be built out of two flags.
   *
   * Never DISABLED: a loop iteration is the same dispatch the tap makes
   * (`useClipStage.replay`), so there is no camera, provider or surface that
   * can refuse it — and D62 asks for a control's REASON, not for a disabled
   * state invented to look thorough.
   */
  readonly clipLoop?: ClipLoopBinding
  /** Frame-step. Absent ⟺ the surface cannot step (a wall of N), and then the
   *  two step buttons are not drawn at all. */
  readonly onStepFrame?: (dir: 1 | -1) => void
  readonly onSelectRate: (rate: number) => void
  /** Return the player to the live edge (remounts the WebRTC session). */
  readonly onGoLive: () => void
  /**
   * The live lock, drawn as part of the leading control.
   *
   * Armed, the operator can browse the timeline while the picture stays where
   * it is; the transport keeps controlling that picture. It is deliberately NOT
   * a second Live button: the bar has one leading slot for the live edge, and
   * two controls speaking for it is what the layout model forbids.
   *
   * `onToggleLiveLock` ABSENT ⟺ this surface has no live lock, and then the
   * leading slot is a LIVE badge that takes no press — never a padlock that
   * does nothing. The handler is the ONE authority for that (`onStepFrame`'s
   * rule on this same bar); `liveLocked` without it is meaningless and the
   * layout is fed from the handler, so the two cannot disagree.
   *
   * Absent on the on-demand overlay: browsing a tape while the picture stays
   * put needs somewhere to browse INTO, and that window has a day strip, a
   * picture and no preview.
   */
  readonly liveLocked?: boolean
  readonly onToggleLiveLock?: () => void
  /**
   * The ONE record control. ABSENT ⟺ this surface cannot record — a wall of N
   * has neither a decoded picture of its own nor a single camera to export, and
   * an absent binding means an absent control, not a disabled one (the rule
   * every other per-camera control on this bar follows).
   */
  readonly record?: RecordControlBinding
  /**
   * What the hub says this camera's clips can be driven to do, and how well
   * that is known (`clip-controls.ts`, D612).
   *
   * It decides the rate LADDER and the backward frame-step. Absent ⟺ this
   * surface has no clip source to ask about (the on-demand overlay, a wall),
   * and then every control is live — {@link LEGACY_CONTROLS_VIEW}, which is
   * the freedom this app always had and not the safest answer.
   *
   * A rate this camera cannot serve is drawn DISABLED and never dropped: a
   * menu that silently stopped at 1× would be indistinguishable from a viewer
   * that never built 2×, and the operator files a missing feature instead of
   * a camera limitation (D62). Only a `present` answer may disable anything —
   * a pending read claims nothing (D315).
   */
  readonly clipControls?: ClipControlsView
  /**
   * The host's chrome may grow a SECOND ROW when one row cannot hold the bar
   * (`playback-bar-fit.ts`). False — the default — for a host whose chrome
   * height is fixed (the on-demand overlay's `ONDEMAND_CHROME_HEIGHT`); such
   * a host compresses the gaps and moves record + speed into the overflow
   * menu instead.
   */
  readonly canWrap?: boolean
  /**
   * Admin training collect, beside the leading Live / go-live control.
   * Absent ⟺ hidden — never an empty reservation.
   */
  readonly trainingCollect?: React.ReactNode
  /**
   * The bar is docked OVER the video (the landscape / fill drawer): drawn as
   * glass, which lets the picture through, instead of the opaque `background`
   * it wears when it sits below the picture. Default false.
   */
  readonly overlay?: boolean
}

/** Corner radius of the bar when it floats over the video as glass. */
const OVERLAY_RADIUS = RADIUS.xl + RADIUS.lg

/** Which of the bar's dropdowns is open — one at a time. */
type OpenMenu = 'none' | 'rate' | 'overflow' | 'record'

/** The overflow button that holds record + speed when the row has no room for them. */
export const OVERFLOW_TEST_ID = 'playback-bar-overflow'

/** Start recording: a live capture at the live edge, a selection off it. ONE
 *  control and ONE test id, because there is exactly one way to arm either. */
export const RECORD_TEST_ID = 'playback-bar-record'
/** Keep it: share the clip, or create the export. The irreversible press. */
export const RECORD_ACCEPT_TEST_ID = 'playback-bar-record-accept'
/** Throw it away. Creates nothing and cancels nothing — for the selection there
 *  is nothing on the hub yet, which is the whole reason it is made on Accept. */
export const RECORD_DISCARD_TEST_ID = 'playback-bar-record-discard'

export function TimelinePlaybackBar({
  mode,
  rate,
  paused,
  servedTier = null,
  loading,
  faulted = false,
  scrubDirection = null,
  onTogglePause,
  onJogBack,
  onJogForward,
  onClipPrev = null,
  onClipNext = null,
  clipHeld = false,
  clipProgress,
  clipLoop,
  onStepFrame,
  onSelectRate,
  onGoLive,
  liveLocked = false,
  onToggleLiveLock,
  record,
  clipControls = LEGACY_CONTROLS_VIEW,
  canWrap = false,
  trainingCollect = null,
  overlay = false,
}: TimelinePlaybackBarProps) {
  const { t } = useTranslation()
  const dock = useDockTransitions()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const [openMenu, setOpenMenu] = useState<OpenMenu>('none')
  const rateAnchorRef = useRef<View>(null)
  const overflowAnchorRef = useRef<View>(null)
  const recordAnchorRef = useRef<View>(null)
  const closeMenu = (): void => setOpenMenu('none')
  /**
   * The text-sized controls as they REALLY drew (`PlaybackBarMeasured`). The
   * fit prices them from constants until the first layout reports, and from
   * these afterwards — a constant that drifts from the chip it describes is
   * how a bar that fitted came to wrap. Each is measured on the control
   * itself, never on a group whose width the tier decides, so a measurement
   * cannot flip the tier that produced it.
   */
  const [measured, setMeasured] = useState<PlaybackBarMeasured>({})
  const measure =
    (key: keyof PlaybackBarMeasured) =>
    (e: LayoutChangeEvent): void => {
      const next = e.nativeEvent.layout.width
      setMeasured((current) =>
        acceptMeasuredWidth(current[key], next) ? { ...current, [key]: next } : current,
      )
    }
  const onLeadingLayout = measure('leading')
  const onRateLayout = measure('rate')

  const layout = playbackBarLayout(
    mode,
    paused,
    // `null` ⟺ no lock on this surface. Derived from the HANDLER, which is the
    // one authority for that — a `liveLocked` with nothing to toggle cannot
    // contradict it.
    onToggleLiveLock === undefined ? null : liveLocked,
    onStepFrame !== undefined,
    record?.active ?? false,
    clipHeld,
  )
  // The bar draws the pair from the SAME flag it handed the layout, so "the
  // transport is withdrawn" and "Accept/Discard are up" cannot disagree.
  /**
   * What the ROOM allows, as distinct from what the mode offers
   * (`playback-bar-fit.ts`). `ui.width` is the container width the scale
   * provider was given, so a surface that wraps its chrome in one — the
   * theater, the landscape drawer, the on-demand overlay — is judged at ITS
   * width, and anything outside a provider is judged at the reference width
   * and loses nothing.
   *
   * The two are intersected, never OR'd: a control is drawn when the mode has
   * a meaning for it AND there is room. Neither half may resurrect what the
   * other withdrew.
   */
  const fitHost = {
    // The scale the tokens are REALLY drawn at — density included. Pricing at
    // the width-only scale is how a `medium` bar (×1.2) came to overlap.
    scale: ui.scale,
    canWrap,
    trailingIcon: record !== undefined || clipLoop !== undefined,
    canStep: onStepFrame !== undefined,
    measured,
  }
  const fit = playbackBarFit(ui.width, fitHost)
  const gapSet = playbackBarGapSet(fit.gaps)
  const gap = ui.px(gapSet.gap)
  const rowPad = ui.px(gapSet.pad)
  const showJog = layout.showJog && fit.allowJog
  // The pair is drawn once; what it MEANS comes from the layout, so a visible
  // control that does nothing cannot be built out of two disagreeing flags.
  const steppingClips = layout.jogMeans === 'clip'
  const showStep = layout.showStep && fit.allowStep
  // …and there is no rate CONTROL on a camera with one rate. A chip that opens
  // onto a single row is furniture; its absence says "this one plays at one
  // speed" more plainly than a list explaining itself (`clipRateMenuShown`).
  const rateOffered = layout.showRate && clipRateMenuShown(clipControls)
  // Read off `steppingClips` — the SAME statement that a file is on screen
  // which the clip's progress row is drawn from. One statement, read twice:
  // the bar never decides for itself whether a clip is held.
  const loopOffered = steppingClips && clipLoop !== undefined
  const recording = record !== undefined && layout.record !== 'hidden' && record.active
  const recordIdle = record !== undefined && layout.record !== 'hidden' && !record.active
  // The OVERFLOW only when it holds the speed list: a lone record dot (or
  // loop) is one icon button either way, and a menu of one row is a detour.
  const overflow = fit.secondary === 'overflow' && rateOffered
  const showRate = rateOffered && !overflow
  const showLoop = loopOffered && !overflow
  const showRecordDot = recordIdle && !overflow
  // What the running thing is (a live clip, or a selection to export / delete)
  // is the BINDING's statement, not the layout's: the idle button is the same
  // in both modes and opens a menu either way.
  const captureFlow = record?.kind === 'capture'
  const deleting = record?.kind === 'delete'
  // An armed SELECTION keeps the jog beside a wider confirm chip ("Save 1m20s").
  // The `bar` shape gives both sides the width of the wider one, which at phone
  // width would push the chip off the row — so while armed the transport is
  // centred in what the sides leave (`between`) instead. Only while armed: the
  // idle bar keeps the shape its tier chose.
  const selectionArmed = recording && !captureFlow
  // The confirm chip is filled (accent, or danger for a delete) only when it can
  // be pressed and nothing is off; a partial selection or a busy one is outlined.
  const acceptable = record !== undefined && record.canAccept && !record.busy
  const acceptOn =
    acceptable && record !== undefined && !record.warn
      ? deleting
        ? colors.dangerOn
        : colors.primaryForeground
      : colors.foreground
  const locked = layout.liveLock === 'locked'
  const rateActive = rate !== 1
  const rateMenuOpen = openMenu === 'rate'
  // The rows the menu DRAWS, and which of them this camera can actually be
  // played at. Two lists, deliberately: the second is a subset of the first,
  // and the difference is what gets drawn disabled rather than dropped.
  const rateChoices = clipRateChoices(clipControls)
  const stepBackDisabled = clipControlDisabled(clipControls, clipStepBackAllowed(clipControls.controls))
  const scrubbing = scrubDirection !== null
  const primaryLabel = scrubbing
    ? scrubDirection === 'forward'
      ? t('v2.streamBar.scrubForward')
      : t('v2.streamBar.scrubBackward')
    : paused
      ? t('v2.streamBar.play')
      : t('v2.streamBar.pause')

  const chip = {
    height: ui.control.button,
    borderRadius: ui.radius.lg,
    paddingHorizontal: ui.space.md,
    gap: ui.space.xs,
  }
  const iconBtn = {
    ...chip,
    width: ui.control.button,
    paddingHorizontal: 0,
    backgroundColor: colors.surfaceHover,
    borderColor: colors.border,
  }
  const primary = {
    width: ui.control.primary,
    height: ui.control.primary,
    borderRadius: ui.control.primary / 2,
  }
  /**
   * Reserved footprint for a control that comes and goes with the mode, so the
   * band never reflows around the play button.
   *
   * The reservation exists so the band does not reflow around the play button
   * as a mode CHANGES UNDER the operator (loading→playing, paused→playing).
   * It is withdrawn in exactly two cases, and both are "there is no room for a
   * courtesy":
   *
   *  - while a selection is ARMED — a deliberate press that visibly repurposes
   *    the whole row, and in landscape the drawer is 240pt at its narrowest
   *    (`landscape-drawer-geometry.ts`), where four empty reservations plus a
   *    two-control trailing side is what would push Save off the end;
   *  - when the bar is already SHEDDING controls (`fit.reserveSlots`) — space
   *    held for a control that is not there is indefensible on a row that is
   *    dropping controls it has.
   *
   * A slot that HOLDS a control always has its width, reservation or not.
   */
  const reserveSlots = fit.reserveSlots && !(recording && !captureFlow)
  const slotFor = (shown: boolean): { width: number; height: number } => ({
    width: shown || reserveSlots ? ui.control.button : 0,
    height: ui.control.button,
  })
  // A `between` row holds its sides at the priced idle width, so the play
  // button stays put as the trailing side changes — the same courtesy, under
  // the same condition, as the reserved slots.
  const heldSides = reserveSlots ? playbackBarSideWidths(fit, fitHost) : { leading: 0, trailing: 0 }
  const jogSlot = slotFor(showJog)
  const stepSlot = slotFor(showStep)

  /** The speed rows, ordered by the direction the menu REALLY opened in. */
  const rateRows = (direction: PopoverDirection): React.ReactNode =>
    // Fastest furthest from the chip: a menu opening UPWARD lists the fastest
    // at the top, one flipped DOWNWARD at the bottom (`playbackRateMenuOrder`,
    // which is a function of that direction and of the camera's OWN ladder —
    // never a rate list this file owns).
    playbackRateMenuOrder(direction, rateChoices).map((option) => {
      const active = option === rate
      // Every row here is one this camera can serve: the menu is built from
      // its own ladder now, not from a union with a local one
      // (`clipRateChoices`). The flag survives because a `pending` answer
      // still draws the legacy ladder, and a rate in THAT list may turn out
      // not to be allowed.
      const unavailable = clipControlDisabled(
        clipControls,
        clipRateAllowed(clipControls.controls, option),
      )
      return (
        <Pressable
          key={option}
          disabled={unavailable}
          onPress={() => {
            hapticTap()
            onSelectRate(option)
            closeMenu()
          }}
          style={[
            styles.menuItem,
            { paddingHorizontal: ui.space.lg, paddingVertical: ui.space.sm },
            active ? { backgroundColor: colors.primary } : null,
            unavailable ? styles.disabled : null,
          ]}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: active, disabled: unavailable }}
          accessibilityLabel={formatRateLabel(option)}
          {...(unavailable ? { accessibilityHint: t('v2.playback.rateUnavailable') } : {})}
        >
          <Text
            style={[
              styles.chipStrong,
              TABULAR,
              {
                fontSize: ui.font.sm,
                color: active ? colors.primaryForeground : colors.foreground,
              },
            ]}
          >
            {formatRateLabel(option)}
          </Text>
        </Pressable>
      )
    })
  // No note at the foot of the list. It used to explain WHY the dead rows
  // were dead — there are none now, because the menu is built from this
  // camera's own ladder. The operator on the sentence it drew: "non ha alcun
  // senso proprio per niente". `clipRateChoices`.

  /** A verb row in the overflow menu: icon + its own accessibility label as text. */
  const verbRow = (
    key: string,
    label: string,
    icon: React.ReactNode,
    onPress: () => void,
    selected = false,
    testID?: string,
  ): React.ReactNode => (
    <Pressable
      key={key}
      {...(testID === undefined ? {} : { testID })}
      onPress={() => {
        hapticTap()
        closeMenu()
        onPress()
      }}
      style={[
        styles.menuItem,
        styles.menuVerb,
        { paddingHorizontal: ui.space.lg, paddingVertical: ui.space.sm, gap: ui.space.sm },
        selected ? { backgroundColor: colors.primary } : null,
      ]}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={{ fontSize: ui.font.sm, color: selected ? colors.primaryForeground : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  )

  /** The icon a REC menu entry wears. */
  const recordActionIcon = (action: RecordMenuAction): React.ReactNode => {
    switch (action) {
      case 'snapshot':
        return <Camera size={ui.px(15)} color={colors.foreground} />
      case 'selectExport':
        return <Clapperboard size={ui.px(15)} color={colors.foreground} />
      case 'deleteRecording':
        return <Trash2 size={ui.px(15)} color={colors.danger} />
      case 'recordLive':
        return <View style={[styles.recDot, { backgroundColor: colors.danger }]} />
    }
  }

  /** The REC button's menu: one row per action the mode and role allow. */
  const recordRows = (): React.ReactNode =>
    record?.menu.map((action) =>
      verbRow(
        action,
        t(`v2.recordMenu.${action}`),
        recordActionIcon(action),
        () => record.onMenuAction(action),
        false,
        `${RECORD_TEST_ID}-${action}`,
      ),
    )

  /** Record + loop + speed, when the row had no room for them. */
  const overflowRows = (direction: PopoverDirection): React.ReactNode => {
    const verbs: React.ReactNode[] = []
    if (recordIdle && record !== undefined) {
      for (const action of record.menu) {
        verbs.push(
          verbRow(
            `record-${action}`,
            t(`v2.recordMenu.${action}`),
            recordActionIcon(action),
            () => record.onMenuAction(action),
            false,
            `${RECORD_TEST_ID}-${action}`,
          ),
        )
      }
    }
    if (loopOffered && clipLoop !== undefined) {
      verbs.push(
        verbRow(
          'loop',
          clipLoop.enabled ? t('v2.clips.loopOn') : t('v2.clips.loopOff'),
          <Repeat size={ui.px(15)} color={clipLoop.enabled ? colors.primaryForeground : colors.foreground} />,
          clipLoop.onToggle,
          clipLoop.enabled,
        ),
      )
    }
    const divider =
      verbs.length > 0 ? (
        <View key="divider" style={[styles.menuDivider, { backgroundColor: colors.border }]} />
      ) : null
    // The verbs sit next to the button whichever way the menu opened.
    return direction === 'up' ? (
      <>
        {rateRows(direction)}
        {divider}
        {verbs}
      </>
    ) : (
      <>
        {verbs}
        {divider}
        {rateRows(direction)}
      </>
    )
  }

  const leadingEl = (
    <>
      {layout.leading === 'goLive' ? (
        /* leading:goLive */
        <Pressable
          onPress={() => {
            hapticTap()
            onGoLive()
          }}
          style={[styles.chip, chip, { backgroundColor: colors.danger }]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t('v2.theater.goToLive')}
        >
          <ArrowUp size={ui.icon.sm} color={colors.primaryForeground} />
          <Text
            numberOfLines={1}
            style={[styles.chipStrong, { color: colors.primaryForeground, fontSize: ui.font.xs }]}
          >
            {t('v2.theater.live')}
          </Text>
        </Pressable>
      ) : onToggleLiveLock === undefined ? (
        /* leading:liveBadge, no lock binding */
        /* ABSENT rather than greyed out: the badge states the mode and
           offers nothing, because there is nothing here it could offer.
           (The guard reads this branch for the opposite word, and it is
           right to — a comment cannot be told from a prop.) */
        <View
          style={[styles.chip, chip, { backgroundColor: colors.live }]}
          accessibilityRole="text"
        >
          <Text
            numberOfLines={1}
            style={[styles.chipStrong, { color: colors.primaryForeground, fontSize: ui.font.xs }]}
          >
            {t('v2.theater.live')}
          </Text>
        </View>
      ) : (
        /* leading:liveBadge + lock */
        <Pressable
          onPress={() => {
            hapticTap()
            onToggleLiveLock()
          }}
          style={[
            styles.chip,
            chip,
            locked
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.live },
          ]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityState={{ selected: locked }}
          accessibilityLabel={locked ? t('v2.theater.liveLockOn') : t('v2.theater.liveLockOff')}
        >
          <Text
            numberOfLines={1}
            style={[styles.chipStrong, { color: colors.primaryForeground, fontSize: ui.font.xs }]}
          >
            {t('v2.theater.live')}
          </Text>
          {locked ? (
            <Lock size={ui.px(15)} color={colors.primaryForeground} />
          ) : (
            <LockOpen size={ui.px(15)} color={colors.primaryForeground} />
          )}
        </Pressable>
      )}
    </>
  )

  const centreEl = (
    <View style={[styles.centre, { gap }]}>
      <View style={jogSlot}>
        {showJog ? (
          <Pressable
            onPress={() => {
              hapticTap()
              if (steppingClips) onClipPrev?.()
              else onJogBack()
            }}
            disabled={steppingClips && onClipPrev === null}
            style={[
              styles.chip,
              iconBtn,
              styles.bordered,
              steppingClips && onClipPrev === null ? styles.disabled : null,
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={steppingClips ? t('v2.clips.previousClip') : '−10s'}
          >
            {steppingClips ? (
              <SkipBack size={ui.px(15)} color={colors.foreground} />
            ) : (
              <RotateCcw size={ui.px(15)} color={colors.foreground} />
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={stepSlot}>
        {showStep ? (
          <Pressable
            onPress={() => {
              hapticTap()
              onStepFrame?.(-1)
            }}
            // A forward-only transport never kept the frames behind the
            // picture. DISABLED and still drawn: the forward twin beside
            // it stays live, and a pair that lost one half would read as a
            // control this app never built (D62).
            disabled={stepBackDisabled}
            style={[
              styles.chip,
              iconBtn,
              styles.bordered,
              stepBackDisabled ? styles.disabled : null,
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ disabled: stepBackDisabled }}
            accessibilityLabel={t('v2.playback.prevFrame')}
            {...(stepBackDisabled ? { accessibilityHint: t('v2.playback.stepBackUnavailable') } : {})}
          >
            <StepBack size={ui.px(15)} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      <View style={[primary, styles.primaryAnchor]}>
        {/* During a drag this disc stops being a control and becomes the
            readout of which way the scrub is going. It is DISABLED while it
            does: the operator's finger is on the timeline, so a press here
            is a stray touch, and toggling pause mid-scrub is the one thing
            it could do that they did not ask for. No new haptic either —
            a disabled Pressable never fires one. */}
        <Pressable
          onPress={() => {
            hapticTap()
            onTogglePause()
          }}
          disabled={scrubbing}
          style={[styles.chip, primary, { backgroundColor: colors.primary }]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityState={{ disabled: scrubbing }}
          accessibilityLabel={primaryLabel}
        >
          {scrubDirection === 'forward' ? (
            <FastForward size={ui.icon.md} color={colors.primaryForeground} fill={colors.primaryForeground} />
          ) : scrubDirection === 'backward' ? (
            <Rewind size={ui.icon.md} color={colors.primaryForeground} fill={colors.primaryForeground} />
          ) : paused ? (
            <Play size={ui.icon.md} color={colors.primaryForeground} fill={colors.primaryForeground} />
          ) : (
            <Pause size={ui.icon.md} color={colors.primaryForeground} fill={colors.primaryForeground} />
          )}
        </Pressable>
        {mode !== 'live' && servedTier !== null ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={
              servedTier.profile === servedTier.requested
                ? t('v2.playback.servedTier', { tier: t(`v2.playback.tier.${servedTier.profile}`) })
                : t('v2.playback.servedTierDegraded', {
                    served: t(`v2.playback.tier.${servedTier.profile}`),
                    requested: t(`v2.playback.tier.${servedTier.requested}`, {
                      defaultValue: servedTier.requested,
                    }),
                  })
            }
            style={[
              styles.tierBadge,
              {
                borderColor:
                  servedTier.profile === servedTier.requested ? colors.border : colors.warning,
              },
            ]}
          >
            <Text
              style={[
                styles.tierBadgeText,
                {
                  color:
                    servedTier.profile === servedTier.requested
                      ? colors.foregroundMuted
                      : colors.warning,
                  fontSize: ui.font.xs,
                },
              ]}
            >
              {servedTier.profile.charAt(0).toUpperCase()}
            </Text>
          </View>
        ) : null}
        {loading || faulted ? (
          // AROUND the button, not inside it and not beside it. Inside, an
          // indicator smaller than the disc hides behind the glyph; beside,
          // it reads as a second object competing with the control it
          // describes. See TransportSpinnerRing for both failed attempts.
          //
          // A FAILING stream rings the same button in the danger colour:
          // the auto-retry loop that is running behind it is exactly what
          // "busy" means here. The ring is a STATUS on this control, not a
          // second report — the reason and the retry live in the fault
          // notice docked under this bar.
          <TransportSpinnerRing
            size={ui.control.primary}
            color={faulted ? colors.danger : colors.primary}
          />
        ) : null}
      </View>

      <View style={stepSlot}>
        {showStep ? (
          <Pressable
            onPress={() => {
              hapticTap()
              onStepFrame?.(1)
            }}
            style={[styles.chip, iconBtn, styles.bordered]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('v2.playback.nextFrame')}
          >
            <StepForward size={ui.px(15)} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      <View style={jogSlot}>
        {showJog ? (
          <Pressable
            onPress={() => {
              hapticTap()
              if (steppingClips) onClipNext?.()
              else onJogForward()
            }}
            disabled={steppingClips && onClipNext === null}
            style={[
              styles.chip,
              iconBtn,
              styles.bordered,
              steppingClips && onClipNext === null ? styles.disabled : null,
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={steppingClips ? t('v2.clips.nextClip') : '+10s'}
          >
            {steppingClips ? (
              <SkipForward size={ui.px(15)} color={colors.foreground} />
            ) : (
              <RotateCw size={ui.px(15)} color={colors.foreground} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  )

  /** The leading control at the width it draws — measured, in every layout. */
  const leadingGroup = (
    <View style={[styles.group, { gap: ui.space.xs }]} onLayout={onLeadingLayout}>
      {leadingEl}
      {trainingCollect}
    </View>
  )

  const trailingEl = (
    <>
      {showRecordDot && record ? (
        <View style={styles.speedAnchor}>
          {/* Pressing REC opens its menu (snapshot / export / delete); nothing
              starts on the press itself. The dot stays where it always was. */}
          <Pressable
            ref={recordAnchorRef}
            testID={RECORD_TEST_ID}
            onPress={() => {
              hapticTap()
              setOpenMenu((m) => (m === 'record' ? 'none' : 'record'))
            }}
            style={[styles.chip, iconBtn, styles.bordered]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ expanded: openMenu === 'record' }}
            accessibilityLabel={t('v2.recordMenu.open')}
          >
            <View style={[styles.recDot, { backgroundColor: colors.danger }]} />
          </Pressable>
          <PlaybackBarPopover open={openMenu === 'record'} onClose={closeMenu} anchorRef={recordAnchorRef}>
            {recordRows}
          </PlaybackBarPopover>
        </View>
      ) : null}
      {recording && record ? (
        <>
          {/* Discard first (left of Accept): the destructive-but-safe one is
              the one a thumb reaches by accident, and here that is the one
              that keeps nothing. */}
          <Pressable
            testID={RECORD_DISCARD_TEST_ID}
            onPress={() => {
              hapticTap()
              record.onDiscard()
            }}
            style={[styles.chip, iconBtn, styles.bordered]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={
              captureFlow ? t('v2.theater.discardClip') : t('v2.exportSelection.discard')
            }
          >
            <X size={ui.px(15)} color={colors.foreground} />
          </Pressable>
          <Pressable
            testID={RECORD_ACCEPT_TEST_ID}
            disabled={!record.canAccept || record.busy}
            onPress={() => {
              hapticTap()
              record.onAccept()
            }}
            style={[
              styles.chip,
              chip,
              styles.bordered,
              acceptable
                ? record.warn
                  ? { backgroundColor: colors.surfaceHover, borderColor: colors.warning }
                  : deleting
                    ? { backgroundColor: colors.danger, borderColor: colors.danger }
                    : { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: colors.surfaceHover, borderColor: colors.border },
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ disabled: !record.canAccept || record.busy }}
            accessibilityLabel={
              captureFlow
                ? t('v2.theater.keepClip')
                : deleting
                  ? t('v2.deleteSelection.confirmA11y', { span: record.spanLabel })
                  : t(record.warn ? 'v2.exportSelection.savePartialA11y' : 'v2.exportSelection.saveA11y', {
                      span: record.spanLabel,
                    })
            }
          >
            {deleting ? (
              <Trash2 size={ui.px(14)} color={acceptOn} />
            ) : captureFlow ? (
              <Check size={ui.px(14)} color={acceptOn} />
            ) : (
              <Download size={ui.px(14)} color={acceptOn} />
            )}
            <Text
              style={[styles.chipStrong, TABULAR, { fontSize: ui.font.sm, color: acceptOn }]}
            >
              {/* No verb: the icon and the colour say which act, the figure says
                  how much (the full meaning is the accessibility label). */}
              {captureFlow ? record.durationLabel : record.spanLabel}
            </Text>
          </Pressable>
        </>
      ) : null}
      {showLoop && clipLoop !== undefined ? (
        /* In the slot the record control occupies off a clip — the two are
           mutually exclusive by `playbackBarLayout` (a held clip is not
           recordable), which is what keeps the trailing side one icon
           button wide for the fit estimator. */
        <Pressable
          onPress={() => {
            hapticTap()
            clipLoop.onToggle()
          }}
          style={[
            styles.chip,
            iconBtn,
            styles.bordered,
            clipLoop.enabled
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : null,
          ]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityState={{ selected: clipLoop.enabled }}
          accessibilityLabel={clipLoop.enabled ? t('v2.clips.loopOn') : t('v2.clips.loopOff')}
        >
          <Repeat
            size={ui.px(15)}
            color={clipLoop.enabled ? colors.primaryForeground : colors.foreground}
          />
        </Pressable>
      ) : null}
      {showRate ? (
        <View style={styles.speedAnchor} onLayout={onRateLayout}>
          <Pressable
            ref={rateAnchorRef}
            onPress={() => setOpenMenu((m) => (m === 'rate' ? 'none' : 'rate'))}
            style={[
              styles.chip,
              chip,
              styles.bordered,
              rateActive
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: colors.surfaceHover, borderColor: colors.border },
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ expanded: rateMenuOpen }}
            accessibilityLabel={t('v2.playback.speed')}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.chipStrong,
                TABULAR,
                {
                  fontSize: ui.font.sm,
                  color: rateActive ? colors.primaryForeground : colors.foreground,
                },
              ]}
            >
              {formatRateLabel(rate)}
            </Text>
            <ChevronDown
              size={ui.px(13)}
              color={rateActive ? colors.primaryForeground : colors.foregroundMuted}
            />
          </Pressable>
          <PlaybackBarPopover open={rateMenuOpen} onClose={closeMenu} anchorRef={rateAnchorRef}>
            {rateRows}
          </PlaybackBarPopover>
        </View>
      ) : null}
      {overflow ? (
        <View style={styles.speedAnchor}>
          {/* Record + speed (and the clip loop) behind ONE button: the row had
              no room for them beside the transport, and losing them outright
              was the old answer. The chip shows the rate when it is not 1×,
              so a changed speed is still visible without opening the menu. */}
          <Pressable
            ref={overflowAnchorRef}
            testID={OVERFLOW_TEST_ID}
            onPress={() => setOpenMenu((m) => (m === 'overflow' ? 'none' : 'overflow'))}
            style={[
              styles.chip,
              iconBtn,
              styles.bordered,
              rateActive ? { backgroundColor: colors.primary, borderColor: colors.primary } : null,
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ expanded: openMenu === 'overflow' }}
            accessibilityLabel={t('v2.playback.moreControls')}
          >
            <MoreHorizontal
              size={ui.px(15)}
              color={rateActive ? colors.primaryForeground : colors.foreground}
            />
          </Pressable>
          <PlaybackBarPopover open={openMenu === 'overflow'} onClose={closeMenu} anchorRef={overflowAnchorRef}>
            {overflowRows}
          </PlaybackBarPopover>
        </View>
      ) : null}
    </>
  )

  const rows = (
    <>
      {fit.wrap ? (
        <>
          {/* TWO rows (`playback-bar-fit.ts`): the transport alone, centred on
              the full width — the play button stays the centre of the bar —
              and LIVE + the secondaries under it. */}
          <View style={[styles.row, styles.rowCentred, { paddingHorizontal: rowPad, paddingTop: ui.space.sm }]}>
            {centreEl}
          </View>
          <View
            style={[
              styles.row,
              styles.rowSpread,
              { paddingHorizontal: rowPad, paddingTop: gap, paddingBottom: ui.space.sm, gap },
            ]}
          >
            {leadingGroup}
            <View style={[styles.group, { gap }]}>{trailingEl}</View>
          </View>
        </>
      ) : fit.centring === 'between' || selectionArmed ? (
        <View style={[styles.row, { paddingHorizontal: rowPad, paddingVertical: ui.space.sm, gap }]}>
          {/* One row, the sides as wide as they draw and the transport centred
              in what they leave (`playback-bar-fit.ts`): the play button sits
              a little off the bar's centre, which costs less than a row. */}
          <View style={{ minWidth: heldSides.leading }}>{leadingGroup}</View>
          <View style={styles.centreSpace}>{centreEl}</View>
          <View style={[styles.group, styles.sideEnd, { gap, minWidth: heldSides.trailing }]}>
            {trailingEl}
          </View>
        </View>
      ) : (
        <View style={[styles.row, { paddingHorizontal: rowPad, paddingVertical: ui.space.sm, gap }]}>
          {/* Leading: ONE control. At the live edge it is LIVE — carrying the
              lock when the surface binds one (tap toggles it), and a plain badge
              when it does not. Off live it is return-to-live, with no lock
              sibling. */}
          <View style={styles.side}>{leadingGroup}</View>
          {/* Centre: the transport cluster. */}
          {centreEl}
          {/* Trailing: the ONE record control (dot, or Discard + Accept) and the
              speed selector — or the overflow that holds them. The stream fault
              used to win this slot; it now reports in the fault notice under
              this bar, with every other failure. */}
          <View style={[styles.side, styles.sideEnd, { gap }]}>{trailingEl}</View>
        </View>
      )}
      {/* The clip's own track, under the transport row, from the SAME flag
          that turned the jog pair into prev/next: one statement that a file
          is on screen, read twice. */}
      {steppingClips && clipProgress !== undefined ? <ClipProgressBar {...clipProgress} /> : null}
    </>
  )

  // Over the video the glass is a BACKGROUND layer, not the parent of the rows:
  // a surface that clips would cut off the speed / record menus, which open
  // upward as children of this bar on a device.
  if (overlay) {
    return (
      <View
        style={[styles.container, styles.overlayContainer]}
        accessibilityRole="toolbar"
        accessibilityLabel={t('v2.theater.playbackBar')}
      >
        <Animated.View entering={dock.entering} exiting={dock.exiting} style={styles.dockGlass} pointerEvents="none">
          <GlassSurface fill radius={OVERLAY_RADIUS} pointerEvents="none" />
        </Animated.View>
        {rows}
      </View>
    )
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
      accessibilityRole="toolbar"
      accessibilityLabel={t('v2.theater.playbackBar')}
    >
      {rows}
    </View>
  )
}

const styles = StyleSheet.create({
  // The overlay bar's glass layer: the bar's own box, behind its rows.
  dockGlass: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  /** A clip verb with nowhere to go — drawn, and visibly not pressable. */
  disabled: { opacity: 0.35 },
  /** Docked over video: no hairline, a gap to the drawer's edge. */
  overlayContainer: { borderBottomWidth: 0, margin: 8 },
  tierBadge: {
    position: 'absolute',
    right: -6,
    top: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tierBadgeText: { fontWeight: '700', includeFontPadding: false },
  container: {
    borderBottomWidth: 1,
    // The speed dropdown overlaps the body, which is a later sibling in the
    // column: without an explicit rank the body paints over the menu. The
    // menu's own anchor carries a higher rank for the siblings INSIDE this
    // container (the clip progress track), which this rank does not reach.
    zIndex: 15,
    elevation: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Equal-weight ends, so the transport cluster stays optically centred
   *  whatever the leading/trailing controls resolve to. */
  side: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideEnd: {
    justifyContent: 'flex-end',
  },
  /** Wrapped: the transport row, centred on the bar's full width. */
  rowCentred: {
    justifyContent: 'center',
  },
  /** Wrapped: LIVE at the start, the secondaries at the end. */
  rowSpread: {
    justifyContent: 'space-between',
  },
  /** A side group at the width it draws: wrapped rows, `between` centring,
   *  and the measured box around the leading control. */
  group: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** `between`: the room the sides leave, with the transport centred in it. */
  centreSpace: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    /** A chip has a FIXED height (`ui.control.button`), so it is the one thing
     *  in this row that must never be squeezed: a narrowed chip wraps its word
     *  onto a second line inside a pill that cannot grow to hold it, which is
     *  exactly what the on-demand overlay reported on a phone. `playback-bar-fit.ts`
     *  makes the row fit; this makes the failure mode impossible rather than
     *  merely unlikely, and `numberOfLines={1}` at each label is the third
     *  guard. */
    flexShrink: 0,
  },
  bordered: {
    borderWidth: 1,
  },
  chipStrong: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  /** The slot is the positioning context for the ring drawn around it. */
  primaryAnchor: { position: 'relative' },
  speedAnchor: {
    position: 'relative',
    alignItems: 'flex-end',
    // The container's rank (below) beats the BODY. It does not beat a sibling
    // added later INSIDE the container — and `ClipProgressBar` is exactly
    // that, rendered under the transport row when a clip is on screen. So the
    // anchor carries its own rank, or the speed menu paints beneath the clip's
    // own track.
    zIndex: 20,
    elevation: 20,
  },
  menuItem: {
    alignItems: 'center',
  },
  /** A verb in the overflow menu: icon then label, left-aligned. */
  menuVerb: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  recDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
})
