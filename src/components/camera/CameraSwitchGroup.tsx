/**
 * CameraSwitchGroup — the viewer half of the per-camera FUNCTION SWITCHES
 * ([D62](../../../../camstack-server/docs/decisions/adr-0062.md)).
 *
 * The same group the admin UI renders, from the same server-composed payload.
 * Two properties are not negotiable and each has a matching test:
 *
 *  - **Nothing here is hardcoded.** Rows come from
 *    `pipelineOrchestrator.getCameraSwitches`. Label, cost line and
 *    availability all travel on the wire, so a switch the hub gains tomorrow
 *    renders tomorrow, with its own label and its own cost line, from a
 *    viewer released today — a row this component has never heard of still
 *    gets a tile, just with the generic {@link DEFAULT_SWITCH_ICON} instead of
 *    a bespoke one (see "Icons are decoration" below).
 *  - **An unavailable switch is EXPLAINED, never a dead control.** A toggle
 *    that does nothing tells the operator a feature exists.
 *
 * ## Compact grid (Task C.3, variant B — operator-approved 2026-08-26)
 *
 * The row-per-switch list this used to be put the cost sentence permanently
 * on screen, which was right for five rows and wrong for eight: two whole
 * screens of prose an operator did not ask to read to find one toggle. This
 * is a GRID of icon tiles instead — filled circle = on, hollow circle = off,
 * the function's name always visible underneath. That last part is not a
 * nicety: `CameraSwitchGroup` is `admin`-only, so a NON-admin's only signal
 * that a function is off is `SwitchedOffBadge` — an icon-only strip would
 * have been unreadable to someone who opens this sheet once a week.
 *
 * The cost sentence and the unavailable reason did not disappear, they moved
 * off the permanently-rendered surface: long-press any tile for the cost
 * line, tap an unavailable tile for the reason (still never a dead control),
 * and both travel as `accessibilityHint`/`accessibilityLabel` for a screen
 * reader that cannot long-press to find out.
 *
 * ## Icons are decoration, not a second catalog
 *
 * {@link matchIconRule} guesses a glyph from `row.label` — not `row.id`. See
 * that function's own doc for why: `camera-switches.spec.ts` guards against
 * any file branching on a switch id, and an id-keyed icon map is exactly
 * that. Nothing ABOUT a switch — whether it renders, what it does, what it
 * costs — comes from this lookup; a label it does not recognise (a switch
 * this viewer predates, a hub that reworded one, or the `detection` id this
 * file's own tests use) still renders a complete, functional tile with
 * {@link DEFAULT_SWITCH_ICON}.
 *
 * ## Admin gate
 *
 * `setCameraSwitch` is `auth: 'admin'` on the hub, so a non-admin is shown
 * nothing here rather than a row of controls that always fail. They still see
 * WHICH functions are off, on the camera card's badge — the hub publishes
 * `getCameraSwitches` at `auth: 'view'` for exactly that reason.
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  AudioLines,
  Bell,
  Camera,
  EyeOff,
  Mic,
  Scan,
  TriangleAlert,
  Video,
  Volume2,
  ToggleRight,
  type LucideIcon,
} from '../../lib/icons.js'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useNotice } from '../ui/confirm.js'
import { SPACING, TYPOGRAPHY, type ColorTokens } from '../../theme/tokens.js'
import { useIsAdmin } from '../../data/use-me.js'
import { useCameraSwitches, useSetCameraSwitch } from '../../data/use-camera-switches.js'
import {
  canOperateSwitches,
  switchWarningKey,
  switchControlKind,
  unavailableReasonKey,
  type CameraSwitchRow,
} from '../../data/camera-switches.js'

export interface CameraSwitchGroupProps {
  readonly deviceId: number
}

/**
 * A glyph for a row, guessed from its LABEL — never from `row.id`.
 *
 * `camera-switches.spec.ts` has a guard test asserting no shipped file
 * contains four of the switch ids (stream-broker, object-detection,
 * audio-analysis, device-audio) as a quoted string literal: "the moment a
 * file branches on an id, the next switch the hub adds renders wrong — or
 * not at all". A per-id icon
 * map is exactly that branch, so this keys off `label` instead — text the
 * hub already sends and this component already has to render unconditionally
 * (`camera-switches.ts`: "there is no i18n for label/costWhenOff: they are
 * server copy"). A label this viewer has no keyword for still renders a
 * complete, functional tile with {@link DEFAULT_SWITCH_ICON} — a rename on
 * the hub only ever costs a glyph, never a row, and a wholly new switch is
 * exactly as safe as one this file was written against.
 *
 * Rule order matters where one label's words are a superset of another's:
 * "Audio detection & classification" (`audio-analysis`) contains "detection",
 * which is also `object-detection`'s word, so the more specific
 * "classification" is checked first. Icons are picked from what
 * `src/lib/icons.ts` exports and, where one already existed, what the rest of
 * the app already uses for the same concept — `Bell` is the notifications
 * icon everywhere in `screens/notifications/*`. `device-audio` (the camera's
 * own microphone, "Camera microphone") is `Mic`; `broker-audio` (THIS
 * SERVER's distribution of that audio, "Audio distribution") is `Volume2`,
 * deliberately a different glyph — they are two functions, not two knobs
 * (D83), and looking identical would quietly relitigate that.
 */
interface LabelIconRule {
  readonly keyword: string
  readonly icon: LucideIcon
}

const LABEL_ICON_RULES: readonly LabelIconRule[] = [
  { keyword: 'microphone', icon: Mic },
  { keyword: 'distribution', icon: Volume2 },
  { keyword: 'classification', icon: AudioLines },
  { keyword: 'privacy', icon: EyeOff },
  { keyword: 'tracking', icon: Scan },
  { keyword: 'notif', icon: Bell },
  { keyword: 'record', icon: Video },
  { keyword: 'camera', icon: Camera },
]

/** A label matching none of the rules above still gets a working tile. */
const DEFAULT_SWITCH_ICON: LucideIcon = ToggleRight
const DEFAULT_ICON_RULE: LabelIconRule = { keyword: '', icon: DEFAULT_SWITCH_ICON }

function matchIconRule(label: string): LabelIconRule {
  const lower = label.toLowerCase()
  return LABEL_ICON_RULES.find((candidate) => lower.includes(candidate.keyword)) ?? DEFAULT_ICON_RULE
}

/** Circle diameter — large enough to stay a comfortable tap target. */
const TILE_CIRCLE_SIZE = 48
const TILE_ICON_SIZE = 22

/** Below this measured grid width, three columns leaves too little room for
 *  a long Italian label ("Registrazione") to wrap predictably — drop to two. */
const NARROW_GRID_WIDTH = 300

export function CameraSwitchGroup({ deviceId }: CameraSwitchGroupProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const isAdmin = useIsAdmin()
  const admin = canOperateSwitches(isAdmin)

  // Not merely hidden — genuinely not fetched. A non-admin's detail screen must
  // not pay a five-source per-camera fan-out for a section it will not draw.
  const { data, isLoading, isError } = useCameraSwitches(deviceId, admin)
  const setSwitch = useSetCameraSwitch(deviceId)
  const [gridWidth, setGridWidth] = useState(0)

  if (!admin) return null

  const columns = gridWidth > 0 && gridWidth < NARROW_GRID_WIDTH ? 2 : 3
  const onGridLayout = (event: LayoutChangeEvent): void => {
    setGridWidth(event.nativeEvent.layout.width)
  }

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
        {t('v2.cameraSwitches.title')}
      </Text>

      {isLoading ? (
        <View style={styles.stateRow}>
          <ActivityIndicator size="small" color={colors.foregroundMuted} />
          <Text style={[styles.stateText, { color: colors.foregroundSubtle }]}>
            {t('v2.cameraSwitches.loading')}
          </Text>
        </View>
      ) : null}

      {/* Read failure shows NO switches rather than switches with a guessed
          state. A group drawn from a failed read is how an operator learns a
          function was off a week after they believed they turned it on. */}
      {isError || (!isLoading && data === undefined) ? (
        <View style={styles.stateRow}>
          <TriangleAlert size={14} color={colors.warning} />
          <Text style={[styles.stateText, { color: colors.foregroundSubtle }]}>
            {t('v2.cameraSwitches.readFailed')}
          </Text>
        </View>
      ) : null}

      {data !== undefined ? (
        <View style={styles.grid} onLayout={onGridLayout}>
          {data.switches.map((row) => (
            <SwitchTile
              key={row.id}
              row={row}
              columns={columns}
              gridWidth={gridWidth}
              busy={setSwitch.isPending}
              pending={setSwitch.isPending && setSwitch.variables?.switchId === row.id}
              onToggle={(next) => setSwitch.mutate({ switchId: row.id, enabled: next })}
            />
          ))}
        </View>
      ) : null}

      {/* The write failed and the row has already sprung back. Saying so is the
          difference between "the hub refused this" and "the app is broken". */}
      {setSwitch.isError ? (
        <View style={styles.stateRow}>
          <TriangleAlert size={14} color={colors.danger} />
          <Text style={[styles.stateText, { color: colors.danger }]}>
            {t('v2.cameraSwitches.writeFailed', {
              reason: setSwitch.error instanceof Error ? setSwitch.error.message : '',
            })}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

interface SwitchTileProps {
  readonly row: CameraSwitchRow
  readonly columns: number
  /** Measured grid width; `0` before the first layout pass. */
  readonly gridWidth: number
  /** A write is in flight for SOME row — every tile stops responding to a tap
   *  so a second flip cannot race the first (mirrors the old row list). */
  readonly busy: boolean
  /** A write is in flight for THIS row specifically — shows the spinner. */
  readonly pending: boolean
  readonly onToggle: (enabled: boolean) => void
}

/**
 * One tile: a circular glyph (filled = on, hollow = off, dashed = not
 * offered) and the function's name underneath, always visible. Presentation
 * only — `switchControlKind` still decides whether a tap can write anything.
 */
function SwitchTile({ row, columns, gridWidth, busy, pending, onToggle }: SwitchTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const notice = useNotice()
  const { colors } = useTheme()
  // `isAdmin` here is always true: `CameraSwitchGroup` already returned null
  // otherwise, so the only two shapes a tile ever renders are the live toggle
  // and the explained-unavailable one.
  const kind = switchControlKind(row, true)
  const available = kind !== 'unavailable'
  // A LIVE control that still has something to say — today only the privacy
  // mask with no zone drawn. It stays a toggle (the button is how the feature
  // starts) and wears the warning badge; the hint names what is missing.
  const warningKey = switchWarningKey(row)
  const warning = warningKey !== null ? t(warningKey) : null
  // Not `const Icon = matchIconRule(row.label).icon` in one expression: the
  // react-compiler lint rule flags a capitalised variable initialised
  // straight from a call expression as "a component created during render"
  // (it cannot see the call always returns one of the module-level constants
  // above). One extra property access sidesteps the false positive without
  // hiding the lookup.
  const iconMatch = matchIconRule(row.label)
  const Icon = iconMatch.icon
  const tileStyle = tileGeometry(columns, gridWidth)
  const visuals = tileVisuals(kind, row.enabled, colors, warning !== null)

  const showReason = (): void => {
    hapticTap()
    notice({ title: row.label, message: t(unavailableReasonKey(row.unavailableReason, row.id)) })
  }
  const showCost = (): void => {
    hapticTap()
    notice({
      title: row.label,
      message: warning !== null ? `${warning}\n\n${row.costWhenOff}` : row.costWhenOff,
    })
  }

  return (
    <Pressable
      accessibilityRole={available ? 'switch' : 'button'}
      accessibilityState={available ? { checked: row.enabled, disabled: busy } : { disabled: true }}
      accessibilityLabel={row.label}
      accessibilityHint={
        available
          ? (warning ?? row.costWhenOff)
          : t(unavailableReasonKey(row.unavailableReason, row.id))
      }
      disabled={busy && available}
      onPress={() => {
        if (!available) { showReason(); return }
        // A per-camera FUNCTION switch (D62): it turns recording, detection or
        // notification off for a real camera. The heavier weight is the point
        // — this must not feel like changing a display preference.
        hapticAction()
        onToggle(!row.enabled)
      }}
      onLongPress={available ? showCost : showReason}
      style={tileStyle}
    >
      <View style={[styles.circle, visuals.circle]}>
        {pending ? (
          <ActivityIndicator size="small" color={visuals.iconColor} />
        ) : (
          <Icon size={TILE_ICON_SIZE} color={visuals.iconColor} />
        )}
        {!available || warning !== null ? (
          <View style={[styles.unavailableBadge, { backgroundColor: colors.warning }]}>
            <TriangleAlert size={9} color={colors.background} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color: visuals.labelColor }]} numberOfLines={2} ellipsizeMode="tail">
        {row.label}
      </Text>
    </Pressable>
  )
}

interface TileVisuals {
  readonly circle: { backgroundColor: string; borderColor: string; borderStyle: 'solid' | 'dashed' }
  readonly iconColor: string
  readonly labelColor: string
}

/**
 * Filled = on, hollow (outlined) = off, dashed + muted = not offered here.
 *
 * A live control with a WARNING is drawn exactly like a plain off control,
 * differing only by the ring colour and the badge — see the `warned` branch
 * for why it must never be dimmer. Exported for the test that pins that rule;
 * a colour is the only thing this screen says about whether a button works.
 */
export function tileVisuals(
  kind: ReturnType<typeof switchControlKind>,
  enabled: boolean,
  colors: ColorTokens,
  warned: boolean,
): TileVisuals {
  if (kind === 'unavailable') {
    return {
      circle: { backgroundColor: 'transparent', borderColor: colors.borderSubtle, borderStyle: 'dashed' },
      iconColor: colors.foregroundDisabled,
      labelColor: colors.foregroundDisabled,
    }
  }
  // The state FIRST — on or off — because a warning is something to say about
  // a control, never a replacement for what it is doing.
  const base: TileVisuals = enabled
    ? {
        circle: { backgroundColor: colors.primary, borderColor: colors.primary, borderStyle: 'solid' },
        iconColor: colors.primaryForeground,
        labelColor: colors.foreground,
      }
    : {
        circle: { backgroundColor: 'transparent', borderColor: colors.border, borderStyle: 'solid' },
        iconColor: colors.foregroundMuted,
        labelColor: colors.foregroundMuted,
      }
  if (!warned) return base
  // An OVERLAY: it recolours the ring and touches nothing else.
  //
  // This branch used to return outright, above the `enabled` check, so a
  // warned control could never be drawn ON. The privacy mask on a camera with
  // no zone drawn ALWAYS carries the warning — so it always looked off, the
  // hub happily recorded `enabled: true`, and the tile did not move. The
  // operator pressed it, saw nothing change, and reported it three times as
  // "disabled, I cannot activate it". Measured 2026-09-24 on camera 101: hub
  // `enabled: true` for 32 s, tile still hollow.
  //
  // A control that WORKS is also never drawn dimmer than a plain off one —
  // `foregroundSubtle` measured #78716c in the dark theme against #a8a29e for
  // an off tile and #57534e for a disabled one. That is why the base carries
  // the colours and this branch carries only the ring.
  return { ...base, circle: { ...base.circle, borderColor: colors.warning } }
}

/**
 * Pixel width for one tile, computed from the MEASURED grid width rather than
 * a flex-basis percentage — a percentage plus `gap` overflows its row in RN's
 * flexbox, which is exactly the "pushes the grid out of shape" failure mode
 * the operator asked to avoid. Before the first `onLayout` (`gridWidth === 0`)
 * falls back to a percentage so the first frame is not zero-width.
 */
function tileGeometry(columns: number, gridWidth: number): { width: number | `${number}%` } {
  if (gridWidth <= 0) return { width: `${100 / columns}%` }
  const gap = SPACING.md * (columns - 1)
  return { width: (gridWidth - gap) / columns }
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  stateText: { flex: 1, fontSize: 12, lineHeight: 16 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.sm,
  },
  circle: {
    width: TILE_CIRCLE_SIZE,
    height: TILE_CIRCLE_SIZE,
    borderRadius: TILE_CIRCLE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  unavailableBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: SPACING.xs,
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '500',
    textAlign: 'center',
  },
})
