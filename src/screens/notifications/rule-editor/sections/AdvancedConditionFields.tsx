/**
 * AdvancedConditionFields — the two conditions the Advanced section holds
 * (operator, 2026-10-01): the detection source and the zone-crossing
 * direction. Both are rarely touched and both have a default that is right
 * for almost every rule (a new detection rule is seeded on the pipeline; an
 * absent crossing is "entering"), so they left the always-visible conditions.
 *
 * Drawn only where this kind and trigger can use them
 * (`advancedConditionsFor`) — a sound rule has neither — with the same widget
 * the conditions use, writing the same `conditions` keys.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { systemFamilyOfKind } from '@camstack/types/client'
import { Section } from '../../../../components/ui/Section.js'
import { ConditionField, type SetConditionField } from '../../../../components/notifications/ConditionField.js'
import { advancedConditionsFor } from '../../../../components/notifications/rule-editor-sections.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'
import type { NcConditions } from '../../../../data/notification-center.js'
import { isStateSummaryForm } from '../../../../components/notifications/system-event-delivery.js'
import type { RuleSectionProps } from './section-props.js'

const EDITOR = 'v2.nc.rules.editor'

/** Nothing here reads cameras. */
const NO_DEVICE_IDS: readonly number[] = []

export function AdvancedConditionFields({ draft, patch, kind, catalog }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const form = draft.form
  const descriptors = advancedConditionsFor(kind, form.delivery, catalog)
  if (descriptors.length === 0) return null

  const setField: SetConditionField = (key, value) => {
    const next: NcConditions = { ...form.conditions }
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
    patch({ conditions: next })
  }

  return (
    <Section title={t(`${EDITOR}.advancedConditionsTitle`)}>
      <View style={{ gap: SPACING.xl, padding: SPACING.lg }} testID="rule-advanced-conditions">
        {descriptors.map((descriptor) => (
          <View key={descriptor.id} style={{ gap: SPACING.sm }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>
              {t(`${EDITOR}.condition.${descriptor.id}`, { defaultValue: descriptor.label })}
            </Text>
            <ConditionField
              descriptor={descriptor}
              conditions={form.conditions}
              savedConditions={draft.baseline.conditions}
              schedule={form.schedule}
              taxonomy={undefined}
              onFieldChange={setField}
              onScheduleChange={(next) => patch({ schedule: next })}
              systemFamily={systemFamilyOfKind(kind)}
              deviceIds={NO_DEVICE_IDS}
              alarmActions={undefined}
              summary={isStateSummaryForm(form)}
            />
          </View>
        ))}
      </View>
    </Section>
  )
}
