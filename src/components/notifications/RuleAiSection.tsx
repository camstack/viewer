/**
 * RuleAiSection — the AI block of the rule editor.
 *
 * ONE section, and that is the operator's decision rather than a layout
 * preference: the AI properties were reachable only through `nc.setRuleAi` from
 * a terminal, and scattering them across the form (a prompt near the template, a
 * language near the notification section) would leave nobody able to answer
 * "what will this rule say?" from one place.
 *
 * Everything that DECIDES anything is in `rule-ai-form.ts`. This file draws
 * rows.
 *
 * Two labels here carry a claim, and both exist because the honest wording is
 * not the obvious one:
 *
 *  - the word cap is an INSTRUCTION to the model, not a cut. The hub states it
 *    in the system turn (`Use at most N words of prose.`) and only trims
 *    afterwards as a backstop, marking the cut with an ellipsis. An operator
 *    told "limit: 24" who counts 25 concludes the feature is broken, so the
 *    hint says "about".
 *  - on an OCCUPANCY rule the prompt is GUIDANCE inside a contract it cannot
 *    replace. The answer stays `{confirmed, count, reason}` and the addon
 *    composes the verdict sentence from it — the operator's text reaches the
 *    first line of the user turn and nothing else. Saying so is what stops
 *    somebody typing "answer in one sentence of prose" and reporting that the
 *    feature stopped working.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../ui/Section.js'
import { SelectRow, type SelectOption } from '../ui/SelectRow.js'
import { StepperRow } from '../ui/StepperRow.js'
import { ToggleRow } from '../ui/ToggleRow.js'
import { SPACING } from '../../theme/tokens.js'
import { LabeledInput } from './RuleFormFields.js'
import {
  NC_RULE_AI_DEFAULT_PROMPT,
  ruleAiDefaultPromptKey,
  NC_RULE_AI_LANGUAGES,
  type NcRuleAiFormState,
  type NcRuleAiShape,
  type NcRuleAiWordDefault,
  ruleAiLanguageKey,
  ruleAiProfileLabel,
  ruleAiPromptValue,
  ruleAiWordsValue,
} from './rule-ai-form.js'
import {
  NC_RULE_AI_WORDS_MAX,
  NC_RULE_AI_WORDS_MIN,
  type NcAiProfile,
  type NcRuleAiLanguage,
} from '../../data/notification-center.js'
import { SectionLabel } from '../ui/SectionLabel.js'

/** The empty option's value for the two selects that can be UNSET. `''` is not
 *  a profile id and not a language, so it cannot collide with a real one. */
const UNSET = ''

/** The section's root, so a mount test can assert its presence — and, for the
 *  kinds that carry no frame, its ABSENCE. */
export const RULE_AI_SECTION_TEST_ID = 'rule-ai-section'

export interface RuleAiSectionProps {
  readonly form: NcRuleAiFormState
  readonly shape: NcRuleAiShape
  /** What the word cap resolves to while the operator has authored none. */
  readonly wordDefault: NcRuleAiWordDefault
  readonly profiles: readonly NcAiProfile[]
  /** The profile list could not be read — an older hub, or no `llm` consumer.
   *  Rendered as "cannot tell", never as the empty list that means "create
   *  one": not-yet-known must not look like not-installed (D315). */
  readonly profilesUnavailable: boolean
  readonly onChange: (patch: Partial<NcRuleAiFormState>) => void
}

export function RuleAiSection({
  form,
  shape,
  wordDefault,
  profiles,
  profilesUnavailable,
  onChange,
}: RuleAiSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const profileOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t('v2.nc.rules.editor.ai.profileAuto') },
    ...profiles.map((profile) => ({ value: profile.id, label: ruleAiProfileLabel(profile) })),
  ]

  const languageOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t('v2.nc.rules.editor.ai.languageAuto') },
    ...NC_RULE_AI_LANGUAGES.map((language) => ({
      value: language,
      label: t(ruleAiLanguageKey(language)),
    })),
  ]

  const parseLanguage = (value: string): NcRuleAiLanguage | undefined =>
    NC_RULE_AI_LANGUAGES.find((language) => language === value)

  return (
    <View testID={RULE_AI_SECTION_TEST_ID} style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t('v2.nc.rules.editor.ai.sectionLabel')}</SectionLabel>
      <Text
        style={{
          color: colors.foregroundSubtle,
          fontSize: 12,
          lineHeight: 17,
          paddingHorizontal: SPACING.xs,
        }}
      >
        {t(`v2.nc.rules.editor.ai.blurb.${shape}`)}
      </Text>

      <Section>
        <ToggleRow
          label={t('v2.nc.rules.editor.ai.enabledLabel')}
          description={t('v2.nc.rules.editor.ai.enabledHint')}
          value={form.enabled}
          onValueChange={(next) => onChange({ enabled: next })}
          last={!form.enabled}
        />

        {/* Everything below is inert while the switch is off — and it is HIDDEN
            rather than disabled, because a greyed-out prompt box invites the
            operator to type into it. What they already authored is not lost:
            the form keeps it, and a section that carries an authored value is
            saved with `enabled: false` rather than cleared. */}
        {form.enabled ? (
          <>
            {profilesUnavailable ? null : (
              <SelectRow<string>
                label={t('v2.nc.rules.editor.ai.profileLabel')}
                options={profileOptions}
                value={form.profileId}
                onChange={(next) => onChange({ profileId: next })}
              />
            )}

            <SelectRow<string>
              label={t('v2.nc.rules.editor.ai.languageLabel')}
              options={languageOptions}
              value={form.language ?? UNSET}
              onChange={(next) => onChange({ language: parseLanguage(next) })}
            />

            {/* Seeded with the target-derived default rather than left empty,
                so the operator reads the number that is already in force. */}
            <StepperRow
              label={t('v2.nc.rules.editor.ai.maxWordsLabel')}
              value={ruleAiWordsValue(form, wordDefault.words)}
              min={NC_RULE_AI_WORDS_MIN}
              max={NC_RULE_AI_WORDS_MAX}
              onChange={(next) => onChange({ maxWords: next })}
            />

            <LabeledInput
              label={t('v2.nc.rules.editor.ai.promptLabel')}
              value={ruleAiPromptValue(form, shape)}
              onChangeText={(next) => onChange({ prompt: next })}
              placeholder={t(ruleAiDefaultPromptKey(shape), { defaultValue: NC_RULE_AI_DEFAULT_PROMPT[shape] })}
              multiline
              last
            />
          </>
        ) : null}
      </Section>

      {form.enabled ? (
        <View style={{ gap: SPACING.sm, paddingHorizontal: SPACING.xs }}>
          {profilesUnavailable ? (
            <AiHint text={t('v2.nc.rules.editor.ai.profilesUnavailable')} />
          ) : profiles.length === 0 ? (
            <AiHint text={t('v2.nc.rules.editor.ai.noProfiles')} />
          ) : null}
          <AiHint
            text={
              wordDefault.varies
                ? t('v2.nc.rules.editor.ai.maxWordsVaries', { words: wordDefault.words })
                : t('v2.nc.rules.editor.ai.maxWordsHint', { words: wordDefault.words })
            }
          />
          {/* The occupancy contract, stated where it is authored. */}
          {shape === 'occupancy' ? (
            <AiHint text={t('v2.nc.rules.editor.ai.occupancyContract')} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** One muted line under the card. */
function AiHint({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 16 }}>{text}</Text>
  )
}
