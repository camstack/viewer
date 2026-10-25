import React, { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronsUpDown, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { AnchoredDropdown, type AnchoredDropdownOption } from './AnchoredDropdown.js'
import type { AnchorRect } from './dropdown-placement.js'

export type SelectOption<T extends string | number> = AnchoredDropdownOption<T>

interface SelectRowProps<T extends string | number> {
  /** Primary label on the left. */
  readonly label: string
  /** Optional leading lucide icon component. */
  readonly icon?: LucideIcon
  /** Discrete options listed in the anchored menu. */
  readonly options: readonly SelectOption<T>[]
  /** Currently selected value. */
  readonly value: T
  /** Called with the chosen value when an option is tapped. */
  readonly onChange: (value: T) => void
  /** Hide the bottom hairline (e.g. for the last row in a card). */
  readonly last?: boolean
}

/** A settings row that opens the shared anchored dropdown. Tapping used to
 *  cycle to the next value — that is a wizard, not a selector. The menu
 *  shows the full list (label + optional detail) attached to THIS row, not
 *  a full-screen bottom sheet. */
export function SelectRow<T extends string | number>({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  last = false,
}: SelectRowProps<T>) {
  const { colors } = useTheme()
  const valueRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const active = options[index]

  const openMenu = () => {
    valueRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setOpen(true)
    })
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={openMenu}
        android_ripple={{ color: colors.surfaceHover }}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHover : 'transparent' })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.lg,
            paddingHorizontal: SPACING.xl,
            paddingVertical: SPACING.lg,
            borderBottomWidth: last ? 0 : 1,
            borderBottomColor: colors.borderSubtle,
          }}
        >
          {Icon ? <Icon size={18} color={colors.foregroundMuted} /> : null}
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
            {label}
          </Text>
          <View ref={valueRef} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600', maxWidth: 160 }} numberOfLines={1}>
              {active?.label ?? ''}
            </Text>
            <ChevronsUpDown size={16} color={colors.foregroundSubtle} />
          </View>
        </View>
      </Pressable>

      <AnchoredDropdown
        visible={open}
        onRequestClose={() => { setOpen(false) }}
        anchor={anchor}
        options={options}
        value={value}
        onChange={onChange}
      />
    </>
  )
}
