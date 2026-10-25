/**
 * AdvancedSection — how often the rule may speak, how it can be silenced, and
 * the gates between a match and a notification:
 *
 *  - the detection source and the zone-crossing direction, where the kind
 *    uses them ({@link AdvancedConditionFields}, operator 2026-10-01);
 *  - the cooldown (`throttle.cooldownSec`; scope and granularity ride along);
 *  - the snooze BUTTONS the notification carries, and whether anyone may
 *    snooze the rule for everyone;
 *  - the AI confirm gate (`confirm`) — offered where the rule carries a picture
 *    to judge, or where one is already stored so it is never invisible.
 *
 * Burst grouping and wait-for-recognition are gone (D692): both are now the
 * trigger's "Immediate, grouped" choice, in the Rule section.
 *
 * Every rule of every kind has a cooldown, so this sub-screen is never empty.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ruleKindSpec } from '@camstack/types/client'
import { Section } from '../../../../components/ui/Section.js'
import { StepperRow } from '../../../../components/ui/StepperRow.js'
import { AdvancedConditionFields } from './AdvancedConditionFields.js'
import {
  NC_COOLDOWN_STEP_SEC,
  NC_COOLDOWN_UI_MAX_SEC,
  isSnoozeExempt,
  sequenceResolver,
} from '../../../../components/notifications/rule-field-choices.js'
import { formActionSteps } from '../../../../components/notifications/rule-action-form.js'
import { useAdminVerdict } from '../../../../data/use-me.js'
import { useSharedSequences } from '../../../../data/use-shared-sequences.js'
import { SPACING } from '../../../../theme/tokens.js'
import { ConfirmGateFields } from './ConfirmGateFields.js'
import { Hint } from './SectionHint.js'
import { SnoozeButtonsFields } from './SnoozeButtonsFields.js'
import type { RuleSectionProps } from './section-props.js'

const EDITOR = 'v2.nc.rules.editor'

export function AdvancedSection(props: RuleSectionProps) {
  const { draft, patch, kind } = props
  const { t } = useTranslation()
  const form = draft.form
  const offersConfirm = ruleKindSpec(kind).carriesMedia || form.confirm.enabled
  // Sequence bindings resolve through the shared list (admin-only read); for
  // anyone else only the inline Do steps count, as on the admin's list.
  const sequences = useSharedSequences(useAdminVerdict() === 'admin').data ?? []

  return (
    <View style={{ gap: SPACING.xl }}>
      <AdvancedConditionFields {...props} />

      <Section title={t(`${EDITOR}.throttleLabel`)}>
        <StepperRow
          label={t(`${EDITOR}.cooldownLabel`)}
          value={form.cooldownSec}
          min={0}
          max={Math.max(NC_COOLDOWN_UI_MAX_SEC, form.cooldownSec)}
          step={NC_COOLDOWN_STEP_SEC}
          onChange={(next) => patch({ cooldownSec: next })}
        />
        <Hint text={t(`${EDITOR}.cooldownHint`)} last />
      </Section>

      <SnoozeButtonsFields
        snoozeOptions={form.snoozeOptions}
        snoozeAllowGlobal={form.snoozeAllowGlobal}
        exempt={isSnoozeExempt(form.conditions, formActionSteps(form.actions, sequenceResolver(sequences)))}
        onSnoozeOptions={(next) => patch({ snoozeOptions: next })}
        onSnoozeAllowGlobal={(next) => patch({ snoozeAllowGlobal: next })}
      />

      {offersConfirm ? (
        <ConfirmGateFields confirm={form.confirm} onChange={(next) => patch({ confirm: next })} />
      ) : null}
    </View>
  )
}
