import React, { useState } from 'react'
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TYPOGRAPHY } from '../../theme/tokens.js'
import { MenuGlassFill } from './GlassPanel.js'
import { SlidingGlassPill } from './SlidingGlassPill.js'
import { segmentPillTarget } from './segment-pill.js'

export interface SegmentOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  /**
   * `solid` (default): the track on the page background, for a control inside
   * a card. `glass`: the track is the menus' glass (`MenuGlassFill`) — the
   * tab-level section selector (`ScopeBar`), operator 2026-10-22. The chosen
   * segment is marked by the tab bar's sliding glass pill (`SlidingGlassPill`),
   * with `RADIUS.md` corners — more rectangular than the tab bar's capsule.
   */
  readonly variant?: 'solid' | 'glass'
  /**
   * `md` (default): the settings screens' segments. `sm`: the type scale of
   * the Library's filter row (`TYPOGRAPHY.size.sm`, the chips' size) — for a
   * control inside an anchored menu (`DisplayMenu`).
   */
  readonly size?: 'md' | 'sm'
}

/** A simple equal-width segmented control. The active segment is filled with the
 *  primary color; the track sits on the elevated background so it reads as a
 *  control inside a `surface` card. Generic over the option value type. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'solid',
  size = 'md',
}: SegmentedControlProps<T>) {
  const { colors } = useTheme()
  const glass = variant === 'glass'
  const [trackWidth, setTrackWidth] = useState(0)
  const onLayout = (e: LayoutChangeEvent): void => setTrackWidth(e.nativeEvent.layout.width)
  const pill = segmentPillTarget(
    options.findIndex((o) => o.value === value),
    options.length,
    trackWidth,
    SPACING.xs,
    SPACING.xs,
  )
  return (
    <View
      onLayout={glass ? onLayout : undefined}
      testID={glass ? 'segmented-control-glass' : undefined}
      style={{
        flexDirection: 'row',
        borderRadius: RADIUS.lg,
        padding: SPACING.xs,
        gap: SPACING.xs,
        ...(glass
          ? { overflow: 'hidden' }
          : { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }),
      }}
    >
      {glass ? <MenuGlassFill radius={RADIUS.lg} /> : null}
      {glass && trackWidth > 0 ? (
        <SlidingGlassPill
          target={pill}
          radius={RADIUS.md}
          style={{ top: SPACING.xs, bottom: SPACING.xs }}
          testID="segmented-control-pill"
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // Re-picking the ALREADY active segment still answers the touch:
            // the press happened, and silence would read as a missed tap.
            onPress={() => { hapticTap(); onChange(option.value) }}
            style={{
              flex: 1,
              // A segment may shrink below its label's width: the label then
              // ellipsizes inside it instead of pushing the track past its card.
              minWidth: 0,
              alignItems: 'center',
              paddingVertical: size === 'sm' ? SPACING.sm : SPACING.md,
              paddingHorizontal: SPACING.xs,
              borderRadius: RADIUS.md,
              backgroundColor: active && !glass ? colors.primary : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: active ? (glass ? colors.primaryFill : colors.primaryForeground) : colors.foregroundMuted,
                fontSize: size === 'sm' ? TYPOGRAPHY.size.sm : TYPOGRAPHY.size.md,
                fontWeight: active ? TYPOGRAPHY.weight.bold : TYPOGRAPHY.weight.regular,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
