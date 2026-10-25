/**
 * OverlayPositionPicker — THE position selector for anything drawn on the
 * picture. One component for every `OverlayPosition` value: the audio meter,
 * the occupancy strip, each pinned readout.
 *
 * It replaced two same-day twins: `AudioMeterPositionPicker` (a 3×3 grid,
 * nine kebab-case values) and `CornerSelect` (a 2×2 grid, four camelCase
 * values). Two pickers meant two vocabularies, and an occupancy strip that
 * could never sit at `top-center` because its picker had no such cell.
 *
 * ## A drop-down, like every other selector in the app
 *
 * It renders as a compact label + chevron that opens the option list — the
 * same shape as the playback-speed control. The 3×3 grid it used to default to
 * showed the spatial metaphor nicely but cost three rows of height in every
 * settings list it appeared in, and with a badge, a meter, an occupancy strip
 * and N readouts each owning one, the panel became mostly grid. Operator,
 * 2026-08-02: "il selettore di posizione deve essere un componente usuale con
 * drop-down, quello attuale utilizza troppo spazio".
 *
 * `variant="grid"` keeps the 3×3 for a caller that has the room and wants the
 * spatial picture; nothing ships it today, and it is retained because the grid
 * IS the better control when height is free.
 *
 * Presentational: value + change handler are owned by the caller.
 */
import React, { useCallback, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { EyeOff, ChevronsUpDown } from '../../../lib/icons.js'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../../theme/tokens.js'
import { AnchoredDropdown } from '../../ui/AnchoredDropdown.js'
import type { AnchorRect } from '../../ui/dropdown-placement.js'
import {
  OVERLAY_ANCHORS,
  OVERLAY_POSITION_GRID,
  type OverlayPosition,
} from './overlay-position.js'

export interface OverlayPositionPickerProps {
  readonly value: OverlayPosition
  readonly onChange: (position: OverlayPosition) => void
  /** Offer the `off` centre cell. Callers whose value space has no `off`
   *  (a pinned readout always sits somewhere) leave this false: the centre
   *  renders inert and the drop-down list omits `off`. */
  readonly allowOff?: boolean
  /** Cell edge in pt — only meaningful for `variant="grid"`. */
  readonly cellSize?: number
  /** `dropdown` (default) matches the app's other selectors; `grid` shows the
   *  3×3 spatial picker for a caller with height to spare. */
  readonly variant?: 'dropdown' | 'grid'
}

const GRID_GAP = 4

export function OverlayPositionPicker({
  value,
  onChange,
  allowOff = false,
  cellSize = 28,
  variant = 'dropdown',
}: OverlayPositionPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [width, setWidth] = useState<number | null>(null)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width)
  }, [])

  // A caller that asks for the grid still gets the drop-down when the row is
  // too narrow to render cells above the ~24pt tappable floor.
  const gridWidth = 3 * cellSize + 2 * GRID_GAP
  const asDropdown = variant === 'dropdown' || (width !== null && width < gridWidth)

  return (
    <View style={styles.root} onLayout={onLayout}>
      {asDropdown ? (
        <PositionDropdown value={value} onChange={onChange} allowOff={allowOff} />
      ) : (
        <View style={styles.grid} accessibilityRole="radiogroup">
          {OVERLAY_POSITION_GRID.map((row, r) => (
            <View key={r} style={styles.gridRow}>
              {row.map((position) => (
                <GridCell
                  key={position}
                  position={position}
                  active={position === value}
                  inert={position === 'off' && !allowOff}
                  size={cellSize}
                  onPress={() => onChange(position)}
                  label={positionLabel(t, position)}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** The i18n `t` as this module needs it — named so the helper below carries no
 *  inline signature type. */
type Translator = ReturnType<typeof useTranslation>['t']

/** The translated name of a position — shared by the cells' accessibility
 *  labels and the drop-down rows, so both renderings speak identically. */
function positionLabel(t: Translator, position: OverlayPosition): string {
  return t(`v2.overlay.positions.${position}`, { defaultValue: position })
}

interface GridCellProps {
  readonly position: OverlayPosition
  readonly active: boolean
  /** The centre cell when `off` is not offered — keeps the 3×3 geometry
   *  without pretending to be an option. */
  readonly inert: boolean
  readonly size: number
  readonly onPress: () => void
  readonly label: string
}

function GridCell({ position, active, inert, size, onPress, label }: GridCellProps): React.JSX.Element {
  const { colors } = useTheme()
  if (inert) {
    return <View style={{ width: size, height: size }} />
  }
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.cell,
        {
          width: size,
          height: size,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primary : colors.background,
        },
      ]}
    >
      {position === 'off' ? (
        <EyeOff size={14} color={active ? colors.primaryForeground : colors.foregroundSubtle} />
      ) : (
        <View
          style={[
            styles.dot,
            { backgroundColor: active ? colors.primaryForeground : colors.foregroundSubtle },
          ]}
        />
      )}
    </Pressable>
  )
}

/**
 * The tight-space rendering: the current position as a compact button, opening
 * a modal option list. A real list, not a cycling row — nine options cycled
 * blind is the guessing loop the inline grids were built to kill.
 */
interface PositionDropdownProps {
  readonly value: OverlayPosition
  readonly onChange: (position: OverlayPosition) => void
  readonly allowOff: boolean
}

function PositionDropdown({ value, onChange, allowOff }: PositionDropdownProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const options: readonly OverlayPosition[] = allowOff ? ['off', ...OVERLAY_ANCHORS] : OVERLAY_ANCHORS

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={positionLabel(t, value)}
          onPress={() => {
            triggerRef.current?.measureInWindow((x, y, width, height) => {
              setAnchor({ x, y, width, height })
              setOpen(true)
            })
          }}
          style={[styles.trigger, { borderColor: colors.border }]}
        >
          <Text style={[styles.triggerText, { color: colors.primary }]} numberOfLines={1}>
            {positionLabel(t, value)}
          </Text>
          <ChevronsUpDown size={14} color={colors.foregroundSubtle} />
        </Pressable>
      </View>
      <AnchoredDropdown
        visible={open}
        onRequestClose={() => { setOpen(false) }}
        anchor={anchor}
        options={options.map((position) => ({ value: position, label: positionLabel(t, position) }))}
        value={value}
        onChange={onChange}
        minWidth={200}
      />
    </>
  )
}

const styles = StyleSheet.create({
  // Stretch into the host row's leftover width so `onLayout` reports the space
  // AVAILABLE, not the space the current child happens to occupy.
  root: { flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: 'flex-end' },
  grid: { gap: GRID_GAP },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  cell: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    maxWidth: '100%',
  },
  triggerText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
})
