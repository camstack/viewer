/**
 * HeroControlView — the one drawing of a hero control, in a list row and in the
 * hero card. The mapping from the model is `controlView` (pure, `hero-view.ts`);
 * this file only paints it with the theme and sends the press.
 *
 * A power button wears `powerPaint`: accented ONLY while on. Off and unknown are
 * neutral on every device type, so a heater, a TV and an air conditioner read
 * the same.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { HeroAction } from '@camstack/types'
import { CatalogIcon } from '../components/CatalogIcon.js'
import { fireControlHaptic } from '../components/camera/accessory-controls/control-atoms.js'
import { Minus, Plus, Power } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { controlView, heroText, powerPaint, type ControlView, type HeroLocale } from './hero-view.js'
import type { HeroCaller } from './use-hero.js'
import type { HeroControl } from '@camstack/types'
import { HeroValueEditor } from './HeroValueEditor.js'

export const ROW_BUTTON = 40
export const CARD_POWER_BUTTON = 96

export interface HeroControlViewProps {
  readonly control: HeroControl
  readonly locale: HeroLocale
  readonly caller: HeroCaller
  readonly online: boolean
  /** Hero card: the power button is large. */
  readonly large?: boolean
  /** Asked before an action that declares `confirm`; absent = send (a row lives in a sheet, where a dialog can hang). */
  readonly confirmAction?: (action: HeroAction) => Promise<boolean>
}

export function HeroControlView({ control, locale, caller, online, large = false, confirmAction }: HeroControlViewProps): React.JSX.Element | null {
  const view = controlView(control)
  if (view === null) return null
  const disabled = !online || caller.pending
  const send = async (action: HeroAction): Promise<void> => {
    if (action.confirm !== null && confirmAction !== undefined && !(await confirmAction(action))) return
    fireControlHaptic('action')
    await caller.runAction(action)
  }
  switch (view.kind) {
    case 'power':
      return <PowerButton view={view} locale={locale} disabled={disabled} large={large} onPress={() => void send(view.press)} />
    case 'action':
      return <ActionPill action={view.action} locale={locale} disabled={disabled} onPress={() => void send(view.action)} />
    case 'stepper':
      return <Stepper view={view} locale={locale} disabled={disabled} onValue={(v) => void caller.runValue(view.call, v)} />
    case 'value':
      return (
        <HeroValueEditor
          spec={{ ...view, label: heroText(view.label, locale), kind: view.valueKind }}
          caller={caller}
          disabled={disabled}
        />
      )
    case 'picker':
      return (
        <Pill
          label={view.current ?? heroText(view.label, locale)}
          disabled={disabled || view.next === null}
          onPress={() => view.next !== null && void caller.runValue(view.call, view.next)}
          testID={`hero-picker-${view.id}`}
        />
      )
  }
}

function PowerButton({
  view,
  locale,
  disabled,
  large,
  onPress,
}: {
  readonly view: Extract<ControlView, { kind: 'power' }>
  readonly locale: HeroLocale
  readonly disabled: boolean
  readonly large: boolean
  readonly onPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  const paint = powerPaint(view.look, colors)
  const size = large ? CARD_POWER_BUTTON : ROW_BUTTON
  const iconSize = large ? 40 : 18
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={heroText(view.press.label, locale)}
      accessibilityState={{ selected: view.look === 'on', disabled }}
      testID={`hero-power-${view.id}`}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.round,
        {
          width: size,
          height: size,
          backgroundColor: paint.background,
          borderColor: paint.border,
          borderStyle: paint.dashed ? 'dashed' : 'solid',
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {view.id === 'own-power' || view.id === 'automation.enabled' ? (
        <Power size={iconSize} color={paint.foreground} />
      ) : (
        <CatalogIcon iconKey={view.press.icon} size={iconSize} color={paint.foreground} />
      )}
    </Pressable>
  )
}

function Pill({
  label,
  icon,
  filled = false,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string
  readonly icon?: string
  readonly filled?: boolean
  readonly disabled: boolean
  readonly onPress: () => void
  readonly testID?: string
}): React.JSX.Element {
  const { colors } = useTheme()
  const fg = filled ? colors.primaryForeground : colors.foreground
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={() => {
        fireControlHaptic('tap')
        onPress()
      }}
      style={[
        styles.pill,
        { backgroundColor: filled ? colors.primary : colors.backgroundElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {icon !== undefined ? <CatalogIcon iconKey={icon} size={14} color={fg} /> : null}
      <Text style={[styles.pillLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

function ActionPill({
  action,
  locale,
  disabled,
  onPress,
}: {
  readonly action: HeroAction
  readonly locale: HeroLocale
  readonly disabled: boolean
  readonly onPress: () => void
}): React.JSX.Element {
  return (
    <Pill
      label={heroText(action.label, locale)}
      icon={action.icon}
      filled={action.emphasis === 'primary'}
      disabled={disabled}
      onPress={onPress}
      testID={`hero-action-${action.id}`}
    />
  )
}

function Stepper({
  view,
  locale,
  disabled,
  onValue,
}: {
  readonly view: Extract<ControlView, { kind: 'stepper' }>
  readonly locale: HeroLocale
  readonly disabled: boolean
  readonly onValue: (value: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const label = heroText(view.label, locale)
  const value = view.value === null ? '—' : `${Math.round(view.value)}${view.unit}`
  return (
    <View style={[styles.stepper, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} testID={`hero-stepper-${view.id}`}>
      <StepButton
        icon={Minus}
        label={t('v2.hero.stepDown', { name: label })}
        disabled={disabled || view.down === null}
        onPress={() => view.down !== null && onValue(view.down)}
      />
      <Text style={[styles.stepValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
      <StepButton
        icon={Plus}
        label={t('v2.hero.stepUp', { name: label })}
        disabled={disabled || view.up === null}
        onPress={() => view.up !== null && onValue(view.up)}
      />
    </View>
  )
}

function StepButton({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  readonly icon: React.ComponentType<{ readonly size: number; readonly color: string }>
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        fireControlHaptic('tap')
        onPress()
      }}
      style={[styles.stepButton, { opacity: disabled ? 0.35 : 1 }]}
    >
      <Icon size={16} color={colors.foreground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  round: { borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    height: 32,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    maxWidth: 140,
  },
  pillLabel: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium, flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: RADIUS.pill, borderWidth: 1 },
  stepButton: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 36, textAlign: 'center', fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
})
