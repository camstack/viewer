/**
 * SummaryAiSection — the digest rule's AI section: a vision model looks at the
 * window's pictures TOGETHER and its answer goes into the message as `{{ai}}`.
 *
 * Every field of the addon's `NcSummaryAiSchema` has a control here, because a
 * change sends the section whole (`summary-form.ts`) and a field without a
 * home would be deleted by it. The configuration stays visible while the
 * switch is off: pausing the model keeps the question where it was.
 *
 * The profile list is D315-honest: `isError` (an older hub) reads as "cannot
 * tell", never as the empty list, and a stored profile the list does not carry
 * is still shown — as its id — rather than silently becoming "hub default".
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SPACING } from '../../../theme/tokens.js'
import { Section } from '../../../components/ui/Section.js'
import { SegmentedControl, type SegmentOption } from '../../../components/ui/SegmentedControl.js'
import { SelectRow, type SelectOption } from '../../../components/ui/SelectRow.js'
import { StepperRow } from '../../../components/ui/StepperRow.js'
import { ToggleRow } from '../../../components/ui/ToggleRow.js'
import { Hint } from '../../../components/notifications/FieldHint.js'
import { NumericStepper } from '../../../components/notifications/NumericStepper.js'
import { LabeledInput } from '../../../components/notifications/RuleFormFields.js'
import { ruleAiProfileLabel } from '../../../components/notifications/rule-ai-form.js'
import {
  effectiveSummaryBudget,
  summaryAiImagesShown,
  SUMMARY_AI_IMAGE_PX_MAX,
  SUMMARY_AI_IMAGE_PX_MIN,
  SUMMARY_AI_IMAGES_MAX,
  SUMMARY_AI_IMAGES_MIN,
  SUMMARY_AI_TIMEOUT_MAX_SEC,
  SUMMARY_AI_TIMEOUT_MIN_SEC,
  SUMMARY_HUB_DEFAULTS,
  type SummaryFormProblem,
  type SummaryFormState,
} from '../../../components/notifications/summary-form.js'
import {
  NcSummaryAiLanguageSchema,
  type NcSummaryAiOnFailure,
} from '../../../data/notification-center.js'
import { useNcAiProfiles } from '../../../data/use-notification-center.js'
import { LabeledControl, Problem } from './FamilyFormBits.js'
import { SectionLabel } from '../../../components/ui/SectionLabel.js'

const S = 'v2.nc.summary'
/** The "unset" value of the two selects that can be unset — never a real id. */
const UNSET = ''
const IMAGE_PX_STEP = 64
const TIMEOUT_STEP_SEC = 10
const ON_FAILURE_VALUES: readonly NcSummaryAiOnFailure[] = ['deliver-without-text', 'skip']

export interface SummaryAiSectionProps {
  readonly form: SummaryFormState
  readonly update: (patch: Partial<SummaryFormState>) => void
  readonly shows: (problem: SummaryFormProblem) => boolean
}

export function SummaryAiSection({ form, update, shows }: SummaryAiSectionProps) {
  const { t } = useTranslation()
  const profilesQuery = useNcAiProfiles()

  const profiles = profilesQuery.data ?? []
  const storedProfile = form.aiProfileId
  const storedProfileMissing = storedProfile !== undefined && !profiles.some((p) => p.id === storedProfile)
  const profileOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${S}.aiProfileDefault`) },
    ...profiles.map((p) => ({ value: p.id, label: ruleAiProfileLabel(p) })),
    ...(storedProfileMissing ? [{ value: storedProfile, label: storedProfile }] : []),
  ]
  const languageOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${S}.aiLanguage.default`) },
    ...NcSummaryAiLanguageSchema.options.map((lang) => ({ value: lang, label: t(`${S}.aiLanguage.${lang}`) })),
  ]
  const onFailureOptions: readonly SegmentOption<NcSummaryAiOnFailure>[] = ON_FAILURE_VALUES.map((value) => ({
    value,
    label: t(`${S}.aiOnFailure.${value}`),
  }))
  const onFailure = form.aiOnFailure ?? SUMMARY_HUB_DEFAULTS.aiOnFailure
  const budget = effectiveSummaryBudget(form)

  return (
    <View style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t(`${S}.section.ai`)}</SectionLabel>
      <Section>
        <ToggleRow
          label={t(`${S}.aiEnabledLabel`)}
          description={t(`${S}.aiEnabledHint`)}
          value={form.aiEnabled}
          onValueChange={(next) => update({ aiEnabled: next })}
        />
        <SelectRow<string>
          label={t(`${S}.aiProfileLabel`)}
          options={profileOptions}
          value={storedProfile ?? UNSET}
          onChange={(next) => update({ aiProfileId: next === UNSET ? undefined : next })}
        />
        <LabeledInput
          label={t(`${S}.aiPromptLabel`)}
          value={form.aiPrompt}
          onChangeText={(next) => update({ aiPrompt: next })}
          placeholder={t(`${S}.aiPromptPlaceholder`)}
          multiline
        />
        <SelectRow<string>
          label={t(`${S}.aiLanguageLabel`)}
          options={languageOptions}
          value={form.aiLanguage ?? UNSET}
          onChange={(next) => {
            const parsed = NcSummaryAiLanguageSchema.safeParse(next)
            update({ aiLanguage: parsed.success ? parsed.data : undefined })
          }}
        />
        <StepperRow
          label={t(`${S}.maxAiImagesLabel`)}
          value={summaryAiImagesShown(form)}
          min={SUMMARY_AI_IMAGES_MIN}
          max={Math.max(SUMMARY_AI_IMAGES_MIN, Math.min(SUMMARY_AI_IMAGES_MAX, budget.tiles))}
          onChange={(next) => update({ maxAiImages: next })}
          last
        />
      </Section>
      {profilesQuery.isError ? <Hint text={t(`${S}.aiProfilesUnavailable`)} /> : null}
      <Hint text={t(`${S}.maxAiImagesHint`)} />
      {shows('budget') ? <Problem text={t(`${S}.problem.budget`)} /> : null}
      <LabeledControl label={t(`${S}.aiMaxImagePxLabel`)} hint={t(`${S}.aiMaxImagePxHint`)}>
        <NumericStepper
          value={form.aiMaxImagePx}
          min={SUMMARY_AI_IMAGE_PX_MIN}
          max={SUMMARY_AI_IMAGE_PX_MAX}
          step={IMAGE_PX_STEP}
          decimals={0}
          onChange={(next) => update({ aiMaxImagePx: next })}
        />
      </LabeledControl>
      <LabeledControl label={t(`${S}.aiTimeoutLabel`)} hint={t(`${S}.aiTimeoutHint`)}>
        <NumericStepper
          value={form.aiTimeoutSeconds}
          min={SUMMARY_AI_TIMEOUT_MIN_SEC}
          max={SUMMARY_AI_TIMEOUT_MAX_SEC}
          step={TIMEOUT_STEP_SEC}
          decimals={0}
          onChange={(next) => update({ aiTimeoutSeconds: next })}
        />
      </LabeledControl>
      <LabeledControl label={t(`${S}.aiOnFailureLabel`)}>
        <SegmentedControl<NcSummaryAiOnFailure>
          options={onFailureOptions}
          value={onFailure}
          onChange={(next) => update({ aiOnFailure: next })}
        />
      </LabeledControl>
      {/* The one AI setting that can lose a window for good — said out loud,
          because "hold" reads as "hold the text" and it is not. */}
      {form.aiEnabled && onFailure === 'skip' ? <Problem text={t(`${S}.aiSkipWarning`)} /> : null}
      {shows('ai') ? <Problem text={t(`${S}.problem.ai`)} /> : null}
    </View>
  )
}
