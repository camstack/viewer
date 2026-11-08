/**
 * The saved remote layout, drawn as a grid. The sheet and the full-screen route
 * both use this: one look, one press callback. Geometry comes from
 * `remote-layout.ts`; colours from the theme. A button whose role the remote
 * has no command for is an outline and does nothing. Group titles are never
 * drawn — a group is a frame or a gap.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native'
import { useTranslation } from 'react-i18next'
import { CatalogIcon } from '../../CatalogIcon.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY, withAlpha, type ColorTokens } from '../../../theme/tokens.js'
import {
  colourKeyOf,
  isBound,
  isDividerFrame,
  keyIcon,
  keyLegend,
  keyName,
  vocabLocale,
  rowSpanBox,
  totalRows,
  type ColourKey,
  type RemoteLayout,
  type RemoteLayoutButton,
  type RemoteLayoutGroup,
} from './remote-layout.js'

/** Height of one full grid row, pt. */
const ROW_HEIGHT = 44
/** A divider-only row, in full rows. */
const SLIM_UNIT = 0.4
const ICON_SIZE = 18

/** The sheet stays hand-sized. */
export const REMOTE_SHEET_MAX_WIDTH = 320
/** The full-screen route can grow, then stops: a remote is still a hand-sized thing. */
export const REMOTE_SCREEN_MAX_WIDTH = 420

export interface RemoteKeyPadProps {
  readonly layout: RemoteLayout
  readonly bound: ReadonlySet<string>
  readonly onPress: (role: string) => void
  readonly maxWidth: number
  /** Command names by role (`RemoteCommandList.names`), for the colour keys. */
  readonly names?: ReadonlyMap<string, string>
}

interface KeyLook {
  readonly background: string
  readonly border: string
  readonly foreground: string
}

/** A key's colours from its tone and whether it does anything. */
function keyLook(tone: string | undefined, bound: boolean, colors: ColorTokens): KeyLook {
  switch (tone) {
    case 'accent':
      return { background: colors.primary, border: colors.primary, foreground: colors.primaryForeground }
    case 'danger':
      return { background: colors.dangerFill, border: colors.danger, foreground: colors.dangerOn }
    case 'red':
      return toned(colors.danger)
    case 'green':
      return toned(colors.success)
    case 'yellow':
      return toned(colors.warning)
    case 'blue':
      return toned(colors.info)
    default:
      return bound
        ? { background: colors.surface, border: colors.border, foreground: colors.foreground }
        : { background: 'transparent', border: colors.border, foreground: colors.foregroundSubtle }
  }
}

function toned(color: string): KeyLook {
  return { background: withAlpha(color, 0.15), border: withAlpha(color, 0.4), foreground: color }
}

function pct(part: number, whole: number): DimensionValue {
  return `${(part / whole) * 100}%`
}

interface CellBox {
  readonly row: number
  readonly col: number
  readonly rowSpan: number
  readonly colSpan: number
}

function cellStyle(layout: RemoteLayout, box: CellBox): {
  position: 'absolute'
  left: DimensionValue
  width: DimensionValue
  top: number
  height: number
} {
  const { top, height } = rowSpanBox(layout, box.row, box.rowSpan, SLIM_UNIT)
  return {
    position: 'absolute',
    left: pct(box.col, layout.columns),
    width: pct(box.colSpan, layout.columns),
    top: top * ROW_HEIGHT,
    height: height * ROW_HEIGHT,
  }
}

function frameRadius(frame: string): number {
  switch (frame) {
    case 'dpad':
      return RADIUS.xl * 2
    case 'rocker-v':
    case 'rocker-h':
      return RADIUS.pill
    default:
      return RADIUS.lg
  }
}

interface GroupFrameProps {
  readonly layout: RemoteLayout
  readonly group: RemoteLayoutGroup
}

function GroupFrame({ layout, group }: GroupFrameProps): React.JSX.Element | null {
  const { colors } = useTheme()
  if (isDividerFrame(group.frame) || group.frame === 'none') return null
  return (
    <View
      testID={`remote-group-${group.id}`}
      style={[
        cellStyle(layout, group),
        styles.frame,
        styles.inert,
        {
          borderRadius: frameRadius(group.frame),
          borderColor: group.frame === 'keypad' ? colors.borderSubtle : colors.border,
          backgroundColor: group.frame === 'panel' ? withAlpha(colors.surface, 0.4) : colors.surface,
        },
      ]}
    />
  )
}

interface KeyProps {
  readonly layout: RemoteLayout
  readonly button: RemoteLayoutButton
  readonly bound: boolean
  readonly commandName?: string
  readonly onPress: (role: string) => void
}

function barColour(key: ColourKey, colors: ColorTokens): string {
  switch (key) {
    case 'red': return colors.remoteKeyRed
    case 'green': return colors.remoteKeyGreen
    case 'yellow': return colors.remoteKeyYellow
    case 'blue': return colors.remoteKeyBlue
  }
}

function Key({ layout, button, bound, commandName, onPress }: KeyProps): React.JSX.Element {
  const { colors } = useTheme()
  const { i18n } = useTranslation()
  const look = keyLook(button.tone, bound, colors)
  const name = keyName(button, vocabLocale(i18n.language))
  const legend = keyLegend(button)
  const colourKey = button.tone === undefined ? colourKeyOf(button, commandName) : null
  const round = button.shape === 'round'
  const radius = button.shape === 'pill' || round ? RADIUS.pill : button.shape === 'rect' ? RADIUS.sm : RADIUS.lg
  return (
    <View style={[cellStyle(layout, button), styles.cell, round && styles.cellRound]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ disabled: !bound }}
        testID={`remote-key-${button.id}`}
        disabled={!bound}
        onPress={() => {
          hapticTap()
          onPress(button.role)
        }}
        style={({ pressed }) => [
          styles.key,
          round ? styles.keyRound : styles.keyFill,
          {
            backgroundColor: pressed && bound ? colors.surfaceHover : look.background,
            borderColor: look.border,
            borderRadius: radius,
          },
        ]}
      >
        {colourKey !== null ? (
          // The bar stands for the colour, so the key prints its name above it, not the generic glyph.
          <Text numberOfLines={1} style={[styles.keyText, styles.colourKeyText, { color: look.foreground }]}>
            {button.label ?? commandName ?? name}
          </Text>
        ) : (
          <>
          {legend === undefined ? (
            <CatalogIcon iconKey={keyIcon(button)} size={ICON_SIZE} color={look.foreground} />
          ) : (
            <Text numberOfLines={1} style={[styles.keyText, { color: look.foreground }]}>
              {legend}
            </Text>
          )}
          {button.label !== undefined && button.label !== legend ? (
            <Text numberOfLines={1} style={[styles.keyText, { color: look.foreground }]}>
              {name}
            </Text>
          ) : null}
          </>
        )}
        {colourKey === null ? null : (
          <View
            testID={`remote-key-${button.id}-colour-${colourKey}`}
            pointerEvents="none"
            style={[styles.colourBar, { backgroundColor: barColour(colourKey, colors), opacity: bound ? 1 : 0.45 }]}
          />
        )}
      </Pressable>
    </View>
  )
}

export function RemoteKeyPad({ layout, bound, onPress, maxWidth, names }: RemoteKeyPadProps): React.JSX.Element {
  return (
    <View
      testID="remote-grid"
      style={[styles.grid, { height: totalRows(layout, SLIM_UNIT) * ROW_HEIGHT, maxWidth }]}
    >
      {layout.groups.map((group) => (
        <GroupFrame key={group.id} layout={layout} group={group} />
      ))}
      {layout.buttons.map((button) => (
        <Key key={button.id} layout={layout} button={button} bound={isBound(button, bound)} commandName={names?.get(button.role)} onPress={onPress} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  colourKeyText: { paddingBottom: SPACING.md },
  colourBar: { position: 'absolute', left: SPACING.lg, right: SPACING.lg, bottom: SPACING.sm, height: 4, borderRadius: RADIUS.pill },
  grid: { width: '100%', alignSelf: 'center' },
  frame: { borderWidth: 1 },
  inert: { pointerEvents: 'none' },
  cell: { padding: SPACING.sm },
  cellRound: { alignItems: 'center' },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderWidth: 1,
    paddingHorizontal: SPACING.xs,
    overflow: 'hidden',
  },
  keyFill: { flex: 1, width: '100%' },
  keyRound: { aspectRatio: 1, height: '100%' },
  keyText: { fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.medium },
})
