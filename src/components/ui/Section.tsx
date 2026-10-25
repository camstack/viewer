import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TYPOGRAPHY } from '../../theme/tokens.js'
import { SectionLabel } from './SectionLabel.js'

interface SectionProps {
  /** Optional section title above the card, drawn by {@link SectionLabel}. */
  readonly title?: string
  /**
   * The title folds the card away: tapping it hides or shows the rows, with a
   * chevron saying which. Needs a `title`; ignored without one.
   */
  readonly collapsible?: boolean
  /** Start folded (only with `collapsible`). */
  readonly defaultCollapsed?: boolean
  /** A short value beside a collapsible title (a count), visible while folded. */
  readonly titleValue?: string
  readonly testID?: string
  readonly children: React.ReactNode
}

/** A settings section: an optional uppercase muted title followed by a single
 *  `surface` card (bordered, rounded) that wraps its rows. Rows draw their own
 *  dividers; the card just frames them. `collapsible` makes the title fold
 *  the card. */
export function Section({ title, collapsible, defaultCollapsed, titleValue, testID, children }: SectionProps) {
  const { colors } = useTheme()
  const foldable = collapsible === true && title !== undefined && title.length > 0
  const [collapsed, setCollapsed] = useState(foldable && defaultCollapsed === true)
  // The foldable title is a button, so it draws the label's look inline; the
  // static title IS the kit's SectionLabel.
  const titleStyle = {
    color: colors.foregroundSubtle,
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.medium,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  }
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <View style={{ gap: SPACING.md }} testID={testID}>
      {foldable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={title}
          onPress={() => setCollapsed((c) => !c)}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.xs }}
        >
          <Chevron size={14} color={colors.foregroundSubtle} />
          <Text style={[titleStyle, { flex: 1 }]}>{title}</Text>
          {titleValue !== undefined ? <Text style={titleStyle}>{titleValue}</Text> : null}
        </Pressable>
      ) : title ? (
        <SectionLabel inset>{title}</SectionLabel>
      ) : null}
      {collapsed ? null : (
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.lg,
            overflow: 'hidden',
          }}
        >
          {children}
        </View>
      )}
    </View>
  )
}
