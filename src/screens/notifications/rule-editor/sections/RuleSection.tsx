/**
 * RuleSection — name, trigger and targets.
 *
 * The trigger is a choice only on a DETECTION rule: Immediate, Immediate
 * grouped (D692 — one message with a mosaic, one picture per subject) or Track
 * end. `device-event` is the sensor kind now, so a sensor rule shows it fixed,
 * and every other kind's trigger is its definition — offering anything else
 * offers a way to break the rule silently. The grouped choice is UI-only: it is
 * saved as `immediate` plus `groupingSec` (`applyDeliveryChoice`), and offered
 * only where `ruleGroupingApplies` allows it (`deliveryChoicesFor`).
 *
 * "Notify users" is ADMIN-ONLY (the hub refuses a non-admin's change of
 * `targetUsers`), so it is drawn only once `auth.me` has CONFIRMED an admin.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../components/ui/Section.js'
import { ChipMultiselect, type ChipOption } from '../../../../components/ui/ChipMultiselect.js'
import { ToggleRow } from '../../../../components/ui/ToggleRow.js'
import { SegmentedControl, type SegmentOption } from '../../../../components/ui/SegmentedControl.js'
import { StepperRow } from '../../../../components/ui/StepperRow.js'
import { LabeledInput, TargetPicker } from '../../../../components/notifications/RuleFormFields.js'
import { editorSectionLabelKey } from '../../../../components/notifications/rule-editor-sections.js'
import {
  applyDeliveryChoice,
  deliveryChoiceOf,
  deliveryChoicesFor,
  parseDeliveryChoice,
  type NcDeliveryChoice,
} from '../../../../components/notifications/rule-editor.js'
import { ruleHasRecognitionScope } from '../../../../components/notifications/recognition-scope.js'
import { formScopedConditions } from '../../../../components/notifications/rule-scope-form.js'
import { NC_GROUPING_DEFAULT_SEC } from '@camstack/types/client'
import { NC_GROUPING_STEPPER } from '../../../../components/notifications/rule-field-choices.js'
import { useNcTargets } from '../../../../data/use-notification-center.js'
import {
  savedTargetIds,
  targetSaveContext,
  unlistedTargetNote,
} from '../../../../components/notifications/target-ownership.js'
import { targetsReadState } from '../../../../components/notifications/save-gate.js'
import { useAdminVerdict } from '../../../../data/use-me.js'
import { useUsers, type NcUserOption } from '../../../../data/use-users.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'
import type { RuleSectionProps } from './section-props.js'
import { Hint } from './SectionHint.js'

const EDITOR = 'v2.nc.rules.editor'

export function RuleSection({ draft, patch, kind, rule }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const targetsQuery = useNcTargets()
  const verdict = useAdminVerdict()
  const isAdmin = verdict === 'admin'
  const form = draft.form
  // A rule addressed only to users is valid — the red border is for NEITHER.
  // Targets are counted as the save will SEND them (m3): a non-admin's foreign
  // ids are dropped by it, so they do not address anyone.
  const targetContext = targetSaveContext(verdict, targetsQuery.data?.map((tgt) => tgt.id), rule?.targets ?? [])
  const noAddressee =
    draft.saveAttempted && savedTargetIds(form.targetIds, targetContext).length === 0 && form.targetUsers.length === 0

  // The trigger CHOICES (D692). A stored detection rule on another trigger
  // (package-event) still shows it: a rule the operator cannot read is worse
  // than one they cannot re-author.
  const choice = deliveryChoiceOf(form)
  const grouped = choice === 'immediate-grouped'
  const choiceOptions: readonly SegmentOption<NcDeliveryChoice>[] = deliveryChoicesFor(form).map((option) => ({
    value: option.value,
    label: t(`${EDITOR}.${option.labelKey}`),
  }))
  const groupingSec = form.groupingSec ?? NC_GROUPING_DEFAULT_SEC
  const awaitsRecognition = ruleHasRecognitionScope(formScopedConditions(form))

  return (
    <View style={{ gap: SPACING.xl }}>
      <Section title={t(editorSectionLabelKey('rule', kind))}>
        <LabeledInput
          label={t('v2.nc.rules.editor.nameLabel')}
          value={form.name}
          onChangeText={(next) => patch({ name: next })}
          placeholder={t('v2.nc.rules.editor.namePlaceholder')}
          invalid={draft.saveAttempted && form.name.trim().length === 0}
        />
        <ToggleRow
          label={t('v2.nc.rules.editor.enabledLabel')}
          description={t('v2.nc.rules.editor.enabledHint')}
          value={form.enabled}
          onValueChange={(next) => patch({ enabled: next })}
          last
        />
      </Section>

      {kind === 'detection' ? (
        <Section title={t(`${EDITOR}.triggerLabel`)}>
          <View style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md }}>
            <SegmentedControl<NcDeliveryChoice>
              options={choiceOptions}
              value={choice}
              // Through `applyDeliveryChoice` → `withDeliveryChange`: the
              // detection seed's pipeline source never follows the rule onto a
              // non-detection trigger, and a trigger that cannot group forgets
              // the window.
              onChange={(next) => patch(applyDeliveryChoice(form, parseDeliveryChoice(next) ?? choice))}
            />
          </View>
          {grouped ? (
            <>
              <Hint text={t(`${EDITOR}.grouping.hint`, { n: groupingSec })} />
              <StepperRow
                label={t(`${EDITOR}.grouping.seconds`)}
                value={groupingSec}
                min={NC_GROUPING_STEPPER.min}
                max={NC_GROUPING_STEPPER.max}
                step={NC_GROUPING_STEPPER.step}
                onChange={(next) => patch({ groupingSec: next })}
                last
              />
              <Hint text={t(`${EDITOR}.grouping.minNote`)} last={!awaitsRecognition} />
              {awaitsRecognition ? (
                <Hint text={t(`${EDITOR}.grouping.scopedHint`, { n: groupingSec })} last />
              ) : null}
            </>
          ) : choice === 'immediate' && awaitsRecognition ? (
            // Plain Immediate with a name scope fires only on an event written
            // after recognition (D692 §3.7): said here, not discovered.
            <Hint text={t(`${EDITOR}.grouping.plainRecognitionHint`)} last />
          ) : null}
        </Section>
      ) : null}

      {kind === 'sensor' ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.xs }}>
          {t('v2.nc.rules.editor.fixedTrigger', { trigger: t('v2.nc.rules.editor.delivery.deviceEvent') })}
        </Text>
      ) : null}

      <Section title={t('v2.nc.rules.editor.targetsLabel')}>
        <TargetPicker
          targets={(targetsQuery.data ?? []).map((tgt) => ({ id: tgt.id, name: tgt.name }))}
          readState={targetsReadState(targetsQuery)}
          selected={form.targetIds}
          invalid={noAddressee}
          unlisted={
            rule
              ? unlistedTargetNote(rule.targets, targetsQuery.data?.map((tgt) => tgt.id), verdict)
              : undefined
          }
          onToggle={(id) =>
            patch({
              targetIds: form.targetIds.includes(id)
                ? form.targetIds.filter((x) => x !== id)
                : [...form.targetIds, id],
            })
          }
        />
      </Section>

      {isAdmin ? (
        <UsersPicker
          isAdmin={isAdmin}
          selected={form.targetUsers}
          invalid={noAddressee}
          onChange={(next) => patch({ targetUsers: next })}
        />
      ) : null}
    </View>
  )
}

interface UsersPickerProps {
  /** The query's own guard: `listUsers` is admin-only on the hub. */
  readonly isAdmin: boolean
  readonly selected: readonly string[]
  readonly invalid: boolean
  readonly onChange: (next: readonly string[]) => void
}

/** Chips for the users the rule addresses. Mounted for a confirmed admin only,
 *  so `listUsers` (admin-only) is never asked by anyone it would refuse. */
function UsersPicker({ isAdmin, selected, invalid, onChange }: UsersPickerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const usersQuery = useUsers(isAdmin)
  const users: readonly NcUserOption[] = usersQuery.data ?? []
  const known = new Set(users.map((u) => u.id))
  // A chosen user the list does not carry (deleted, or the list is unreadable)
  // stays on screen by id, so it can still be removed.
  const options: readonly ChipOption<string>[] = [
    ...users.map((u) => ({ value: u.id, label: u.username })),
    ...selected.filter((id) => !known.has(id)).map((id) => ({ value: id, label: id })),
  ]
  const status = usersQuery.isPending
    ? t('v2.nc.rules.editor.usersLoading')
    : usersQuery.isError
      ? t('v2.nc.rules.editor.usersUnavailable')
      : users.length === 0
        ? t('v2.nc.rules.editor.usersEmpty')
        : null

  return (
    <Section title={t('v2.nc.rules.editor.usersLabel')}>
      <View style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, gap: SPACING.sm }}>
        <Text style={{ color: invalid ? colors.danger : colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>
          {t('v2.nc.rules.editor.usersHint')}
        </Text>
        {status !== null ? (
          <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>{status}</Text>
        ) : null}
        {options.length > 0 ? (
          <ChipMultiselect<string>
            options={options}
            selected={selected}
            onToggle={(id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])}
          />
        ) : null}
      </View>
    </Section>
  )
}
