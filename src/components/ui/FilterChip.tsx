/**
 * FilterChip — one facet of a filter bar, drawn as a pill that states its own
 * selection and opens a menu on itself.
 *
 * Extracted from `EventsFilterBar` on 2026-09-13 so the Library's merged gallery
 * filters the SAME way rather than a vaguely similar way. It is the shape the
 * operator asked for by name: every selected point visible and split out, one
 * chip per question, the answer on the chip. A single "Filters" button hiding a
 * full-page sheet — which is what the artifacts gallery used to draw — states
 * only how MANY facets are narrowed, never which, and the two screens then
 * disagreed about what a filter even looks like.
 *
 * The chip owns the anchor View: an {@link AnchoredMenu} measures the control it
 * belongs to, and a caller holding its own wrapper would be free to measure
 * something other than the pill the operator pressed.
 */
import React, { memo, type ComponentType, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { ChevronDown } from '../../lib/icons.js'

/** The shape every lucide glyph in this app satisfies. */
export type FilterChipIcon = ComponentType<{ size: number; color: string }>

export interface FilterChipProps {
  /** The question this facet answers ("Cameras", "Types"). */
  readonly label: string
  /**
   * The ANSWER, shown after the label ("Cameras · 3", "Types · All").
   * Omitted for a chip that is an action rather than a facet (Reset).
   */
  readonly value?: string
  /**
   * The Library bar's form ("Cameras 3 ▾"): how many answers are picked,
   * written after the label only when there is one — an unnarrowed facet reads
   * as just its question. Takes the place of `value`.
   */
  readonly count?: number
  /** Draw the ▾ that says "this opens a menu". */
  readonly menu?: boolean
  /** True when this facet is actually narrowing something. */
  readonly active: boolean
  readonly onPress: () => void
  readonly icon?: FilterChipIcon
  /** The wrapper an `AnchoredMenu` measures. Omit for a chip with no menu. */
  readonly anchorRef?: RefObject<View | null>
  readonly accessibilityLabel?: string
  /**
   * Inert: rendered, dimmed, and unpressable.
   *
   * For a chip whose PLACE must not move — Reset sits first on every filter
   * bar so it is always in the same spot, and a chip that vanished when there
   * was nothing to clear would shift every other chip left exactly when the
   * operator went to press it.
   */
  readonly disabled?: boolean
  /**
   * `tab` for a chip that SWITCHES the list under it rather than narrowing a
   * facet (the Notification Center's rule-kind strip): announced as a tab,
   * with `active` as its selected state. Default `button`.
   */
  readonly role?: 'button' | 'tab'
}

export const FilterChip = memo(function FilterChip({
  label,
  value,
  active,
  onPress,
  icon: Icon,
  anchorRef,
  accessibilityLabel,
  disabled = false,
  count,
  menu = false,
  role = 'button',
}: FilterChipProps) {
  const { colors } = useTheme()
  const background = active ? colors.primary : colors.surface
  const foreground = active ? colors.primaryForeground : colors.foregroundMuted
  const text =
    count !== undefined
      ? count > 0
        ? `${label} ${String(count)}`
        : label
      : value === undefined
        ? label
        : `${label} · ${value}`

  return (
    // `collapsable={false}` keeps the View in the native hierarchy: a collapsed
    // one has nothing to `measureInWindow`, and the menu opens at 0,0.
    <View ref={anchorRef} collapsable={false}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={role}
        accessibilityState={role === 'tab' ? { disabled, selected: active } : { disabled }}
        accessibilityLabel={accessibilityLabel ?? text}
        style={[
          styles.chip,
          Icon !== undefined || menu ? styles.iconChip : null,
          { backgroundColor: background, opacity: disabled ? 0.4 : 1 },
        ]}
      >
        {Icon !== undefined ? <Icon size={14} color={foreground} /> : null}
        <Text style={[styles.chipText, { color: foreground }]}>{text}</Text>
        {menu ? <ChevronDown size={12} color={foreground} /> : null}
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  // SPACING.md vertical: a chip is as tall as the day cursor's 30 pt buttons beside it.
  chip: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.pill },
  iconChip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  chipText: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
})
