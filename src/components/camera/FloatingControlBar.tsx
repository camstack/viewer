/**
 * FloatingControlBar — the floating control surface of the grid wall
 * (`GridControlBar`), and its ONE consumer today.
 *
 * `GridControlBar` itself has two hosts: the grid page, where the bar FLOATS
 * over a full-bleed wall and collapses to a handle, and camera-detail's wall,
 * where it is DOCKED (`docked`) in a strip of its own under the cells. There
 * the wall shares the screen with the timeline and the reel, and a bar floating
 * over the bottom row would cover live picture, so it takes its own row, never
 * hides (a collapsed bar would leave an empty strip — or, sized to the handle,
 * resize the wall on every auto-hide), and opens its popovers upward over the
 * cells as transient sheets.
 *
 * It was written as the shared bar for the wall AND the single-camera stream
 * (`StreamControlBar`), which is where the "SHARED" in its name came from. That
 * second consumer no longer exists: camera-detail's controls moved into the
 * timeline's own chrome on 2026-08-01 (the toolbar, the playback bar, the
 * footer band), because a floating card has to guess a space it does not own.
 * Saying "shared" here read as a live contract and sent people looking for a
 * component that is not in the tree.
 *
 * Extracted from the grid's control bar (the operator-chosen source of truth
 * for the control set's look & behaviour): a compact, ICON-ONLY, COLLAPSIBLE
 * bottom bar that auto-hides after inactivity and re-opens from an edge handle.
 * Actions are descriptors: a direct `onPress` OR a `panel` render-prop that
 * opens a popover ABOVE the bar (quality/layout/audio pickers, menus).
 *
 * Every button carries a localized `tip`: a hover tooltip on web (`Tooltip`)
 * and the `accessibilityLabel` on every platform. Purely presentational —
 * state lives in the owning surface; differences between surfaces (title,
 * back, the action set itself) are props.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { ChevronLeft, ChevronDown, ChevronUp, Check, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { Tooltip } from '../ui/Tooltip.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'

/** Ms of inactivity before the bar auto-collapses to its edge handle. */
const AUTO_HIDE_MS = 4500

/** One bar button: a direct action (`onPress`) or a popover (`panel`). */
export interface ControlBarAction {
  /** Stable key — also identifies the open popover. */
  readonly key: string
  readonly icon: LucideIcon
  /** Localized tooltip / accessibility label. */
  readonly tip: string
  readonly active?: boolean
  /** Small text badge beside the icon (e.g. quality tier letter). */
  readonly badge?: string
  /** Disable the button (e.g. while a snapshot is in flight). */
  readonly disabled?: boolean
  /** Direct action — closes any open popover and re-arms auto-hide. */
  readonly onPress?: () => void
  /** Popover content ABOVE the bar; pressing the button toggles it. The render
   *  prop receives `close` so option rows can dismiss on select. */
  readonly panel?: (close: () => void) => React.ReactNode
  /** Wrap the popover content in a capped ScrollView (long lists). */
  readonly panelScroll?: boolean
}

export interface FloatingControlBarProps {
  /** Optional leading back button. */
  readonly onBack?: () => void
  readonly backTip?: string
  /** Optional title beside the back button (truncated on phones). */
  readonly title?: string
  readonly actions: readonly ControlBarAction[]
  /** Localized tips for the collapse/expand affordances. */
  readonly hideTip: string
  readonly showTip: string
  /**
   * The open popover's action key — CONTROLLED by the host.
   *
   * It used to be this component's own `useState`, which meant the page hosting
   * the bar could not tell whether a menu was up, let alone close it: a tap on
   * the grid left the popover standing and went through to a tile. "What is
   * open" is a fact about the PAGE (`grid/panel-dismiss`), not about the bar,
   * and only one surface can own it.
   */
  readonly panelKey: string | null
  readonly onPanelKey: (key: string | null) => void
  /**
   * In the flow instead of floating: the bar sits in the row its host gives it,
   * never auto-hides and draws no collapse button. Absent ⇒ the floating bar
   * the grid page has always had.
   */
  readonly docked?: boolean
}

export function FloatingControlBar({
  onBack,
  backTip,
  title,
  actions,
  hideTip,
  showTip,
  panelKey,
  onPanelKey,
  docked = false,
}: FloatingControlBarProps) {
  const { colors } = useTheme()
  const { width: winW } = useViewportSize()
  // Centered + width-capped on every viewport; wide screens can afford a
  // longer title than phones.
  const titleMaxWidth = winW >= 900 ? 260 : 100
  const [expanded, setExpanded] = useState(true)
  // Every interaction bumps the epoch; the effect below (re)arms the auto-hide
  // timeout keyed on it. Pure state (no timer refs) so render-prop panels can
  // safely call `close` — and the countdown SUSPENDS while a popover is open.
  const [interactionEpoch, setInteractionEpoch] = useState(0)
  const bump = useCallback(() => setInteractionEpoch((v) => v + 1), [])

  useEffect(() => {
    if (docked || !expanded || panelKey !== null) return
    const t = setTimeout(() => setExpanded(false), AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [docked, expanded, panelKey, interactionEpoch])

  const closePanel = useCallback(() => { onPanelKey(null); setInteractionEpoch((v) => v + 1) }, [onPanelKey])

  if (!expanded && !docked) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={showTip}
        style={[styles.handle, { backgroundColor: colors.surface, borderColor: colors.border }]}
        hitSlop={10}
      >
        <ChevronUp size={18} color={colors.foreground} />
      </Pressable>
    )
  }

  const openAction = actions.find((a) => a.key === panelKey && a.panel !== undefined)

  return (
    <>
      {openAction?.panel ? (
        <View style={[styles.popover, docked && styles.popoverDocked, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {openAction.panelScroll ? (
            <ScrollView style={{ maxHeight: 220 }}>{openAction.panel(closePanel)}</ScrollView>
          ) : (
            <View>{openAction.panel(closePanel)}</View>
          )}
        </View>
      ) : null}

      <View
        style={[styles.bar, docked && styles.barDocked, { backgroundColor: colors.surface, borderColor: colors.border }]}
        pointerEvents="box-none"
      >
        {onBack ? <BarButton icon={ChevronLeft} tip={backTip ?? ''} onPress={onBack} /> : null}
        {title !== undefined ? (
          <Text style={[styles.title, { color: colors.foreground, maxWidth: titleMaxWidth }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {onBack || title !== undefined ? <View style={[styles.sep, { backgroundColor: colors.border }]} /> : null}

        {actions.map((action) => (
          <BarButton
            key={action.key}
            icon={action.icon}
            tip={action.tip}
            active={(action.active ?? false) || (action.panel !== undefined && panelKey === action.key)}
            badge={action.badge}
            disabled={action.disabled}
            onPress={() => {
              if (action.panel !== undefined) {
                onPanelKey(panelKey === action.key ? null : action.key)
              } else {
                action.onPress?.()
                onPanelKey(null)
              }
              bump()
            }}
          />
        ))}

        {docked ? null : (
          <>
            <View style={[styles.sep, { backgroundColor: colors.border }]} />
            <BarButton icon={ChevronDown} tip={hideTip} onPress={() => { onPanelKey(null); setExpanded(false) }} />
          </>
        )}
      </View>
    </>
  )
}

/** One selectable row inside a bar popover (label + check). */
export function ControlBarOption({
  label,
  selected,
  onPress,
}: {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.optionRow, { backgroundColor: pressed ? colors.surfaceHover : 'transparent' }]}
    >
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 14 }}>{label}</Text>
      {selected ? <Check size={16} color={colors.primary} /> : null}
    </Pressable>
  )
}

/** A leading icon+label row for popovers (master rows like mute-all). */
export function ControlBarLeadRow({
  icon: Icon,
  label,
  onPress,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.optionRow, { backgroundColor: pressed ? colors.surfaceHover : 'transparent' }]}
    >
      <Icon size={16} color={colors.primary} />
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}

/** Thin divider between popover sections. */
export function ControlBarDivider() {
  const { colors } = useTheme()
  return <View style={[styles.popoverDivider, { backgroundColor: colors.border }]} />
}

/** One icon-only bar button. `tip` is both the web hover tooltip and the
 *  accessibility label on every platform. */
function BarButton({
  icon: Icon,
  tip,
  onPress,
  active = false,
  badge,
  disabled = false,
}: {
  readonly icon: LucideIcon
  readonly tip: string
  readonly onPress: () => void
  readonly active?: boolean
  readonly badge?: string
  readonly disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Tooltip label={tip}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={tip}
        accessibilityState={{ selected: active, disabled }}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: active ? colors.primary : pressed ? colors.surfaceHover : 'transparent',
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <Icon size={18} color={active ? colors.primaryForeground : colors.foreground} />
        {badge ? (
          <Text style={[styles.badge, { color: active ? colors.primaryForeground : colors.foreground }]}>{badge}</Text>
        ) : null}
      </Pressable>
    </Tooltip>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: SPACING.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs / 2,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    maxWidth: '96%',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  /** Docked: in the host's row, centred, no lift off the edge. */
  barDocked: {
    position: 'relative',
    bottom: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  popover: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    minWidth: 220,
    maxWidth: '92%',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xs,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  /** Docked: opens upward from the top of the host's row, over the cells. */
  popoverDocked: {
    bottom: '100%',
    marginBottom: SPACING.xs,
    zIndex: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  popoverDivider: {
    height: 1,
    marginVertical: SPACING.xs / 2,
    marginHorizontal: SPACING.sm,
  },
  handle: {
    position: 'absolute',
    bottom: SPACING.lg,
    alignSelf: 'center',
    width: 56,
    height: 28,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: SPACING.xs,
  },
  sep: {
    width: 1,
    height: 20,
    marginHorizontal: 2,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
  },
})
