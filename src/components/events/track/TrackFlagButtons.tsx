/**
 * TrackFlagButtons — the two per-track operator flags, as ICON TOGGLES in the
 * track detail HEADER (immediately beside the info button).
 *
 * `markForTrain` marks a track as training material AND pins it against
 * retention ([D81]): the track and its media stop ageing out until the mark is
 * removed. `debug` is attention, not durability, and pins nothing.
 *
 * **Turning `debug` on asks WHAT to check.** The flag alone says "look at this"
 * and nothing about what for, and a debug set read hours later is a list of
 * tracks with no question attached. Three rules govern the note, and the first
 * is structural rather than a promise:
 *
 *  - The flag write is dispatched FIRST and the prompt opens on its answer, so
 *    a cancelled prompt cannot reach it. Refusing to write a note must never
 *    cost the operator the flag they asked for.
 *  - The note is EDITABLE while debug stays on, by a long press on the lit
 *    button (the `CameraSwitchGroup` idiom). Without it the only way to change
 *    a note would be the off/on cycle that clears the note being changed.
 *  - Turning debug OFF prompts for nothing: the hub clears the note in the same
 *    write, because a note outliving its flag reads as a live request.
 *
 * The note travels as its OWN patch (`{ debugNote }`), never bundled with the
 * flag — see rule 1 below, and `askForNote`.
 *
 * These used to be two labelled `ToggleRow`s at the BOTTOM of the detail body,
 * where the operator had to scroll past every media tile to reach them. They
 * are header controls now because they are things you do WHILE looking at the
 * track, not after reading it — the same reasoning that keeps `setTrackFlags`
 * `auth: 'protected'` instead of admin-gated.
 *
 * Losing the labels costs discoverability, so it is bought back three ways: a
 * lit background for the on state (never colour alone), an
 * `accessibilityLabel` + `accessibilityState.checked` carrying the full text,
 * and a long-press hint for what the mark actually costs (disk, forever).
 *
 * Rendering rules, all three of which are about the same hazard — several
 * surfaces writing one pair of booleans with no shared state:
 *
 *  1. **One key per patch** (`apply({ markForTrain: !trainOn })`).
 *  2. **The server's answer is the state.** `confirmed` starts null and the
 *     feed row's value is authoritative until a write lands. It is deliberately
 *     NOT synced from the props in an effect: a stale refetch arriving after a
 *     fresh write would undo it on screen.
 *  3. **Absent renders OFF** — `flag === true`, never `flag !== false`.
 *  4. **The pressed button wears a spinner while its write runs.** All three
 *     used to only dim to 0.5 — invisible enough that the operator reported
 *     "no loader appears when I activate a flag". One patch carries one key
 *     (rule 1), so `pendingFlagKey` names exactly one button; its icon becomes
 *     an inline `ActivityIndicator` (the same pending idiom as the face-assign
 *     confirm buttons) and the siblings keep the dim.
 *
 * The pin budget is enforced SERVER-side, so a mark can be refused. That
 * refusal arrives as a thrown mutation, which rule 2 already handles (the icon
 * does not light) — and is reported two further ways it cannot be missed: an
 * error haptic, and the hub's own message lifted to `onError` for the owning
 * view to display. A refusal that only failed to light would read exactly like
 * a tap that missed.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  pendingFlagKey,
  useSetTrackFlags,
  type TrackFlagsPatch,
  type TrackFlagsResult,
} from '../../../data/use-track-flags.js'
import { Bug, Check, GraduationCap, Star, type LucideIcon } from '../../../lib/icons.js'
import { hapticResult, hapticTap } from '../../../lib/haptics.js'
import { useIsAdmin } from '../../../data/use-me.js'
import { usePrompt } from '../../ui/confirm.js'
import { debugNotePresets } from './debug-note-presets.js'
import { useDebugStatusStore } from '../../../store/debug-status-store.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'

export interface TrackFlagButtonsProps {
  readonly deviceId: number
  readonly trackId: string
  /** Flag as the feed row carries it. Absent = never touched, renders OFF. */
  readonly markForTrain?: boolean
  readonly debug?: boolean
  /** The stored note, as the feed row carries it. Absent = none. Seeds the
   *  editor so an edit starts from what is actually on the hub. */
  readonly debugNote?: string
  readonly favourited?: boolean
  /** Notified with the RESOLVED pair after a write lands. */
  readonly onChange?: (flags: TrackFlagsResult) => void
  /**
   * The hub's refusal message (e.g. the per-camera pin budget), or null once
   * cleared. Lifted out because the header is a single flex row with no space
   * for a message — the owning view renders it beneath. A control that can be
   * refused must say WHY somewhere.
   */
  readonly onError?: (message: string | null) => void
}

interface FlagButtonProps {
  readonly icon: LucideIcon
  readonly on: boolean
  readonly busy: boolean
  /** THIS button's write is the one in flight — its icon becomes the spinner.
   *  The siblings only dim: one patch carries one key, so exactly one button
   *  can be pending at a time. */
  readonly pending: boolean
  readonly label: string
  readonly hint: string
  readonly onPress: () => void
  /** A SECOND action on the same control, offered only where it applies (the
   *  debug button, once lit, edits its note). Absent = no long press. */
  readonly onLongPress?: (() => void) | undefined
}

/** One header flag toggle. On = filled with the accent; off = the same neutral
 *  surface as the neighbouring info/close buttons, so the row reads as one set.
 *  While its own write runs the icon is replaced by an inline spinner (the
 *  app's pending idiom — see FaceAssignPanel's confirm button): the operator
 *  report behind it was "no loader appears", because dim-only was invisible. */
function FlagButton({
  icon: Icon,
  on,
  busy,
  pending,
  label,
  hint,
  onPress,
  onLongPress,
}: FlagButtonProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: on, disabled: busy }}
      style={[
        styles.iconBtn,
        { backgroundColor: on ? colors.primary : colors.surface, opacity: busy && !pending ? 0.5 : 1 },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={on ? colors.primaryForeground : colors.foregroundMuted} />
      ) : (
        <Icon size={18} color={on ? colors.primaryForeground : colors.foregroundMuted} />
      )}
    </Pressable>
  )
}

export function TrackFlagButtons({
  deviceId,
  trackId,
  markForTrain,
  debug,
  debugNote,
  favourited,
  onChange,
  onError,
}: TrackFlagButtonsProps) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const prompt = usePrompt()
  const mutation = useSetTrackFlags()
  const [confirmed, setConfirmed] = useState<TrackFlagsResult | null>(null)
  // WHICH button's write is in flight — that one wears the spinner, the other
  // two only dim. Set with the mutate, cleared when it settles either way.
  const [pending, setPending] = useState<keyof TrackFlagsPatch | 'reviewed' | null>(null)
  const trackIdRef = useRef(trackId)
  trackIdRef.current = trackId
  const hydrateDebug = useDebugStatusStore((s) => s.hydrate)
  const markOpen = useDebugStatusStore((s) => s.markOpen)
  const markReviewed = useDebugStatusStore((s) => s.markReviewed)
  const markNone = useDebugStatusStore((s) => s.markNone)
  const statusOf = useDebugStatusStore((s) => s.statusOf)

  useEffect(() => {
    void hydrateDebug()
  }, [hydrateDebug])

  // A different track is a different pair of flags. `confirmed` is the last
  // write's answer and is deliberately NOT synced from props (a stale refetch
  // must not undo a fresh write) — but it IS bound to THIS trackId. Leaving it
  // across a picker/prev-next swap painted the previous track's flags on the
  // next one until another write happened to hide it.
  useEffect(() => {
    setConfirmed(null)
    setPending(null)
  }, [trackId, deviceId])

  const trainOn = confirmed?.markForTrain ?? markForTrain === true
  const debugOn = confirmed?.debug ?? debug === true
  const favOn = confirmed?.favourited ?? favourited === true
  // The note as the hub last reported it. Same precedence as the flags: the
  // last write's answer wins over the feed row, which may be a stale refetch.
  const noteValue = confirmed?.debugNote ?? debugNote ?? ''
  const status = statusOf(trackId, debugOn)
  const reviewedOn = status === 'reviewed'
  const busy = mutation.isPending

  const apply = (flags: TrackFlagsPatch, after?: (next: TrackFlagsResult) => void): void => {
    if (busy) return
    // The press is acknowledged IMMEDIATELY — the write is a round trip, and a
    // header icon that stays dark for 200ms is indistinguishable from a miss.
    hapticTap()
    onError?.(null)
    setPending(pendingFlagKey(flags))
    mutation.mutate(
      { deviceId, trackId, flags },
      {
        onSuccess: (next, variables) => {
          if (variables.trackId !== trackIdRef.current) return
          setConfirmed(next)
          after?.(next)
          onChange?.(next)
        },
        // No success haptic: the icon lighting up is the confirmation, and a
        // second buzz on the happy path would make the ONE buzz that matters —
        // the refusal below — stop meaning anything.
        onError: (err) => {
          hapticResult(false)
          onError?.(err.message)
        },
        onSettled: () => setPending(null),
      },
    )
  }

  /**
   * Ask the operator WHAT should be checked, and store the answer.
   *
   * Deliberately NOT part of the flag write. The flag is dispatched first and
   * this runs after it has landed, which is what makes the rule structural
   * rather than a promise: a cancelled prompt cannot reach a write that has
   * already gone. `null` (backed out) and `''` (deliberately blank) stay
   * distinct — collapsing them would let a cancel wipe the previous note.
   *
   * An answer equal to what is already stored writes nothing: re-opening the
   * editor and pressing Confirm is not an edit, and a round trip that changes
   * no byte would still make the icon blink.
   */
  const askForNote = async (initial: string): Promise<void> => {
    const answer = await prompt({
      title: t('v2.tracks.debugNotePromptTitle'),
      message: t('v2.tracks.debugNotePromptBody'),
      placeholder: t('v2.tracks.debugNotePlaceholder'),
      initialValue: initial,
      multiline: true,
      // The eight questions this fleet keeps asking, one tap each. They INSERT
      // their phrase into the note rather than replacing it, so the field below
      // still takes whatever the presets cannot say.
      presets: debugNotePresets(t),
    })
    if (answer === null) return
    const note = answer.trim()
    if (note === initial) return
    onError?.(null)
    setPending('debugNote')
    mutation.mutate(
      { deviceId, trackId, flags: { debugNote: note } },
      {
        onSuccess: (next, variables) => {
          if (variables.trackId !== trackIdRef.current) return
          setConfirmed(next)
          onChange?.(next)
        },
        onError: (err) => {
          hapticResult(false)
          onError?.(err.message)
        },
        onSettled: () => setPending(null),
      },
    )
  }

  /**
   * The debug toggle. Turning it ON asks what to look for; turning it OFF asks
   * nothing, because the hub clears the note in the same write — a note that
   * outlived its flag is a leftover that reads as a live request.
   */
  const toggleDebug = (): void => {
    const turningOn = !debugOn
    apply({ debug: turningOn }, (next) => {
      if (next.debug) markOpen(trackId)
      else markNone(trackId)
      if (turningOn) void askForNote(next.debugNote)
    })
  }

  const toggleReviewed = (): void => {
    if (busy) return
    if (reviewedOn) {
      hapticTap()
      onError?.(null)
      setPending('reviewed')
      mutation.mutate(
        { deviceId, trackId, flags: { debug: true } },
        {
          onSuccess: (next, variables) => {
            if (variables.trackId !== trackIdRef.current) return
            markOpen(trackId)
            setConfirmed(next)
            onChange?.(next)
          },
          onError: (err) => {
            hapticResult(false)
            onError?.(err.message)
          },
          onSettled: () => setPending(null),
        },
      )
      return
    }
    if (status !== 'open') return
    hapticTap()
    onError?.(null)
    setPending('reviewed')
    mutation.mutate(
      { deviceId, trackId, flags: { debug: false } },
      {
          onSuccess: (next, variables) => {
            if (variables.trackId !== trackIdRef.current) return
            markReviewed(trackId)
            setConfirmed(next)
            onChange?.(next)
          },
        onError: (err) => {
          hapticResult(false)
          onError?.(err.message)
        },
        onSettled: () => setPending(null),
      },
    )
  }

  return (
    <View style={styles.row}>
      {isAdmin ? (
        <FlagButton
          icon={GraduationCap}
          on={trainOn}
          busy={busy}
          pending={busy && pending === 'markForTrain'}
          label={t('v2.tracks.markForTraining', 'Mark for training')}
          hint={t('v2.tracks.markForTrainingHint', 'Keeps this track and its media past retention')}
          onPress={() => apply({ markForTrain: !trainOn })}
        />
      ) : null}
      {isAdmin ? (
        <FlagButton
          icon={Bug}
          on={debugOn && !reviewedOn}
          busy={busy}
          pending={busy && (pending === 'debug' || pending === 'debugNote')}
          label={t('v2.tracks.debugFlag', 'Debug')}
          hint={t(
            'v2.tracks.debugFlagHint',
            'Flag this track for diagnostic attention. Hold to edit what should be checked.',
          )}
          onPress={toggleDebug}
          // Only while the flag is ON. Editing the note is the ONE thing the
          // operator cannot otherwise do without turning debug off and on
          // again — which is exactly the cycle that clears the note they were
          // trying to edit. Offering it while debug is OFF would send the hub
          // a note it drops, so the affordance simply is not there.
          onLongPress={debugOn ? () => { void askForNote(noteValue) } : undefined}
        />
      ) : null}
      {isAdmin ? (
        <FlagButton
          icon={Check}
          on={reviewedOn}
          busy={busy || (status !== 'open' && !reviewedOn)}
          pending={busy && pending === 'reviewed'}
          label={t('v2.tracks.debugReviewed', 'Analyzed')}
          hint={t(
            'v2.tracks.debugReviewedHint',
            'Mark this debug track as analyzed so it drops out of the debug filter and export',
          )}
          onPress={toggleReviewed}
        />
      ) : null}
      <FlagButton
        icon={Star}
        on={favOn}
        busy={busy}
        pending={busy && pending === 'favourited'}
        label={t('v2.tracks.favourited', 'Favourited')}
        hint={t('v2.tracks.favouritedHint', 'Keeps this track and its media past retention')}
        onPress={() => apply({ favourited: !favOn })}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  // Matches TrackDetailView's header `iconBtn` so the flags, info and close
  // buttons form one evenly-sized row.
  iconBtn: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
