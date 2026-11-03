/**
 * The remote of a media player (an infrared TV) in a sheet: the device's saved
 * remote layout, drawn as a grid, where a press sends that button's command
 * (`remote.sendCommand`). The admin hero opens the same layout in a modal.
 *
 * Geometry comes from the pure `remote-layout.ts`; colours from the theme.
 * A button whose role the remote has no command for is drawn as an outline and
 * does nothing.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Gamepad2 } from '../../../lib/icons.js'
import { CatalogIcon } from '../../CatalogIcon.js'
import { SheetHeader } from '../../ui/SheetHeader.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useRemoteCommands, useRemoteLayout, useRemotePress } from '../../../data/use-remote.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY, withAlpha, type ColorTokens } from '../../../theme/tokens.js'
import {
  isBound,
  isDividerFrame,
  keyIcon,
  keyLegend,
  keyName,
  vocabLocale,
  rowSpanBox,
  totalRows,
  type RemoteLayout,
  type RemoteLayoutButton,
  type RemoteLayoutGroup,
} from './remote-layout.js'

/** Height of one full grid row, pt. */
const ROW_HEIGHT = 44
/** A divider-only row, in full rows. */
const SLIM_UNIT = 0.4
const GRID_MAX_WIDTH = 320
const ICON_SIZE = 18

export interface RemoteSheetProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly onClose: () => void
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

function cellStyle(layout: RemoteLayout, box: { row: number; col: number; rowSpan: number; colSpan: number }) {
  const { top, height } = rowSpanBox(layout, box.row, box.rowSpan, SLIM_UNIT)
  return {
    position: 'absolute' as const,
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

function GroupFrame({ layout, group }: { readonly layout: RemoteLayout; readonly group: RemoteLayoutGroup }) {
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
  readonly onPress: (role: string) => void
}

function Key({ layout, button, bound, onPress }: KeyProps) {
  const { colors } = useTheme()
  const { i18n } = useTranslation()
  const look = keyLook(button.tone, bound, colors)
  const name = keyName(button, vocabLocale(i18n.language))
  const legend = keyLegend(button)
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
        {legend === undefined ? (
          <CatalogIcon iconKey={keyIcon(button)} size={ICON_SIZE} color={look.foreground} />
        ) : (
          <Text numberOfLines={1} style={[styles.keyText, { color: look.foreground }]}>
            {legend}
          </Text>
        )}
        {button.label === undefined ? null : (
          <Text numberOfLines={1} style={[styles.keyText, { color: look.foreground }]}>
            {name}
          </Text>
        )}
      </Pressable>
    </View>
  )
}

function RemoteGrid({
  layout,
  bound,
  onPress,
}: {
  readonly layout: RemoteLayout
  readonly bound: ReadonlySet<string>
  readonly onPress: (role: string) => void
}) {
  return (
    <View testID="remote-grid" style={[styles.grid, { height: totalRows(layout, SLIM_UNIT) * ROW_HEIGHT }]}>
      {layout.groups.map((group) => (
        <GroupFrame key={group.id} layout={layout} group={group} />
      ))}
      {layout.buttons.map((button) => (
        <Key key={button.id} layout={layout} button={button} bound={isBound(button, bound)} onPress={onPress} />
      ))}
    </View>
  )
}

export function RemoteSheet({ deviceId, deviceName, onClose }: RemoteSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const commands = useRemoteCommands(deviceId, true)
  const templateId = commands.data?.layoutTemplateId ?? null
  const layout = useRemoteLayout(templateId, true)
  const { press, failure } = useRemotePress(deviceId)
  const bound = new Set(commands.data?.roles ?? [])
  const answered = !commands.isLoading && !layout.isLoading
  return (
    <SheetModal
      visible
      onClose={onClose}
      backdropLabel={t('v2.common.close')}
      testID="remote-sheet"
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <SheetHeader title={t('v2.remote.title', { name: deviceName })} icon={Gamepad2} onClose={onClose} />
      {layout.data != null ? (
        <RemoteGrid layout={layout.data} bound={bound} onPress={(role) => void press(role)} />
      ) : answered ? (
        <Text style={[styles.note, { color: colors.foregroundMuted }]}>{t('v2.remote.noLayout')}</Text>
      ) : null}
      {failure !== null ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
          {t(`v2.remote.failure.${failure}`)}
        </Text>
      ) : null}
    </SheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    padding: SPACING.xl,
    gap: SPACING.md,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  grid: { width: '100%', maxWidth: GRID_MAX_WIDTH, alignSelf: 'center' },
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
  note: { fontSize: TYPOGRAPHY.size.sm, textAlign: 'center' },
})
