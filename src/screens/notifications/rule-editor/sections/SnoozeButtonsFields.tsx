/**
 * SnoozeButtonsFields — the snooze BUTTONS a rule's notification carries, and
 * whether anyone may snooze the rule for everyone.
 *
 * On an ALARM rule (about the panel, or actuating it) no snooze can silence it
 * — the hub ignores every window there — so the controls are drawn DISABLED
 * with the reason, never offered as if they did something (the admin's
 * `isRuleSnoozeExempt`, see `isSnoozeExempt`).
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../components/ui/Section.js'
import { ToggleRow } from '../../../../components/ui/ToggleRow.js'
import { ChipMultiselect, type ChipOption } from '../../../../components/ui/ChipMultiselect.js'
import { NC_DEFAULT_SNOOZE_MINUTES, NC_SNOOZE_OPTIONS_MAX } from '../../../../data/notification-center.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'
import {
  NC_SNOOZE_BUTTON_CHOICES,
  snoozeMinuteLabel,
  snoozeToggleRefused,
  toggleSnoozeMinute,
} from '../../snooze-options.js'
import { Hint } from './SectionHint.js'

const EDITOR = 'v2.nc.rules.editor'

export interface SnoozeButtonsFieldsProps {
  readonly snoozeOptions: readonly number[] | undefined
  readonly snoozeAllowGlobal: boolean
  /** An alarm rule: every control is disabled, with the reason. */
  readonly exempt: boolean
  readonly onSnoozeOptions: (next: readonly number[] | undefined) => void
  readonly onSnoozeAllowGlobal: (next: boolean) => void
}

export function SnoozeButtonsFields({
  snoozeOptions,
  snoozeAllowGlobal,
  exempt,
  onSnoozeOptions,
  onSnoozeAllowGlobal,
}: SnoozeButtonsFieldsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // Set by a tap that would add a fifth: the toggle refuses it, and silence
  // would read as a broken chip.
  const [refused, setRefused] = useState(false)

  const minuteLabel = (minutes: number): string => {
    const label = snoozeMinuteLabel(minutes)
    return t(`v2.nc.snooze.remaining.${label.key}`, label.params)
  }
  const chosen = snoozeOptions ?? NC_DEFAULT_SNOOZE_MINUTES
  const chips: readonly ChipOption<string>[] = NC_SNOOZE_BUTTON_CHOICES.map((minutes) => ({
    value: String(minutes),
    label: minuteLabel(minutes),
  }))
  const hint = exempt
    ? t(`${EDITOR}.snoozeExemptHint`)
    : snoozeOptions === undefined
      ? t(`${EDITOR}.snoozeDefaultsHint`, { defaults: NC_DEFAULT_SNOOZE_MINUTES.map(minuteLabel).join(', ') })
      : snoozeOptions.length === 0
        ? t(`${EDITOR}.snoozeNoneHint`)
        : t(`${EDITOR}.snoozeChosenHint`)

  const toggle = (value: string): void => {
    const minutes = Number(value)
    setRefused(snoozeToggleRefused(snoozeOptions, minutes))
    onSnoozeOptions(toggleSnoozeMinute(snoozeOptions, minutes))
  }

  return (
    <Section title={t(`${EDITOR}.snoozeButtonsLabel`)}>
      <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.md }}>
        <ChipMultiselect<string>
          options={chips}
          selected={chosen.map(String)}
          onToggle={toggle}
          disabled={exempt}
        />
      </View>
      {refused && !exempt ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.danger, fontSize: 12, paddingHorizontal: SPACING.xl }}
        >
          {t(`${EDITOR}.snoozeMaxReached`, { max: NC_SNOOZE_OPTIONS_MAX })}
        </Text>
      ) : null}
      <Hint text={hint} />
      {snoozeOptions !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: exempt }}
          disabled={exempt}
          onPress={() => {
            setRefused(false)
            onSnoozeOptions(undefined)
          }}
          style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, opacity: exempt ? 0.4 : 1 }}
        >
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
            {t(`${EDITOR}.snoozeResetDefaults`)}
          </Text>
        </Pressable>
      ) : null}
      <ToggleRow
        label={t(`${EDITOR}.snoozeAllowGlobalLabel`)}
        description={t(`${EDITOR}.snoozeAllowGlobalHint`)}
        value={snoozeAllowGlobal}
        onValueChange={onSnoozeAllowGlobal}
        disabled={exempt}
        last
      />
    </Section>
  )
}
