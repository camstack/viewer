/**
 * NotificationSection — what the notification says and carries: priority, the
 * media policy, the title/body templates, and the AI sentence (part of the
 * message, so it lives here).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ruleKindSpec } from '@camstack/types/client'
import { Section } from '../../../../components/ui/Section.js'
import { StepperRow } from '../../../../components/ui/StepperRow.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'
import { NC_PRIORITY_MAX, NC_PRIORITY_MIN } from '../../../../components/notifications/rule-editor.js'
import { mediaBlurbKey } from '../../../../components/notifications/rule-editor-sections.js'
import { TemplateField, TemplatePreview } from '../../../../components/notifications/TemplateField.js'
import { varsForContext } from '../../../../components/notifications/template-field.js'
import { formScopedConditions } from '../../../../components/notifications/rule-scope-form.js'
import { RuleAiSection } from '../../../../components/notifications/RuleAiSection.js'
import { useNcTemplateCatalog } from '../../../../data/use-notification-center.js'
import type {
  NcTemplateField,
  NcTemplateVarContext,
  NcTemplateVarDescriptor,
} from '../../../../data/notification-center.js'
import { useRuleAiState } from '../use-rule-draft.js'
import { MediaPolicyFields } from './MediaPolicyFields.js'
import {
  isStateSummaryForm,
  summaryBodyWarning,
  summarySplitBodyWarning,
} from '../../../../components/notifications/system-event-delivery.js'
import { Hint } from './SectionHint.js'
import type { RuleSectionProps } from './section-props.js'

export function NotificationSection({ draft, patch, kind }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const templateCatalog = useNcTemplateCatalog()
  const ai = useRuleAiState(draft)
  const form = draft.form
  const kindSpec = ruleKindSpec(kind)

  const templateContext = (field: NcTemplateField): NcTemplateVarContext => ({
    family: 'rule',
    field,
    kind,
    delivery: form.delivery,
    systemEventKinds: form.conditions.systemEvent?.kinds,
    // A summary row speaks its own vocabulary (D647): `{{summaryText}}` and
    // the section variables, never one device's `{{deviceName}}`.
    ...(isStateSummaryForm(form) ? { systemEventDelivery: 'summary' as const } : {}),
  })
  const templateVarsFor = (field: NcTemplateField): readonly NcTemplateVarDescriptor[] | undefined =>
    templateCatalog.data ? varsForContext(templateCatalog.data, templateContext(field)) : undefined

  return (
    <View style={{ gap: SPACING.xl }}>
      <Section>
        <StepperRow
          label={t('v2.nc.rules.editor.priorityLabel')}
          value={form.priority}
          min={NC_PRIORITY_MIN}
          max={NC_PRIORITY_MAX}
          onChange={(next) => patch({ priority: next })}
          last
        />
      </Section>

      {/* A subject that freezes no frame gets no media controls: `formToInput`
          writes `image: 'none'` for it either way. */}
      {kindSpec.carriesMedia ? (
        <Section title={t('v2.nc.rules.editor.mediaLabel')}>
          {kindSpec.mediaBlurb !== undefined ? (
            <Text
              style={{
                color: colors.foregroundSubtle,
                fontSize: 11,
                lineHeight: 16,
                paddingHorizontal: SPACING.xl,
                paddingTop: SPACING.md,
              }}
            >
              {t(mediaBlurbKey(kind), { defaultValue: kindSpec.mediaBlurb })}
            </Text>
          ) : null}
          <MediaPolicyFields
            media={form.media}
            kind={kind}
            conditions={formScopedConditions(form)}
            onChange={(next) => patch({ media: next })}
          />
        </Section>
      ) : null}

      <Section title={t('v2.nc.rules.editor.templateLabel')}>
        <TemplateField
          label={t('v2.nc.rules.editor.templateTitleLabel')}
          value={form.templateTitle}
          onChangeText={(next) => patch({ templateTitle: next })}
          vars={templateVarsFor('title')}
          testID="rule-template-title"
        />
        <TemplateField
          label={t('v2.nc.rules.editor.templateBodyLabel')}
          value={form.templateBody}
          onChangeText={(next) => patch({ templateBody: next })}
          vars={templateVarsFor('body')}
          placeholder={t('v2.nc.rules.editor.templateHint')}
          multiline
          last={!summaryBodyWarning(form) && !summarySplitBodyWarning(form)}
          testID="rule-template-body"
        />
        {summaryBodyWarning(form) ? <Hint text={t('v2.nc.rules.editor.systemDelivery.bodyWarning', { token: '{{summaryText}}' })} last /> : null}
        {summarySplitBodyWarning(form) ? (
          <Hint text={t('v2.nc.rules.editor.systemDelivery.splitBodyWarning', { token: '{{summaryText}}' })} last />
        ) : null}
        <TemplatePreview context={templateContext('body')} title={form.templateTitle} body={form.templateBody} />
      </Section>

      {/* Absent for a kind whose subject freezes no frame — the hub refuses the
          pass for those, so the section would be a switch that never runs. */}
      {ai.applies ? (
        <RuleAiSection
          form={ai.form}
          shape={ai.shape}
          wordDefault={ai.wordDefault}
          profiles={ai.profiles}
          profilesUnavailable={ai.profilesUnavailable}
          onChange={ai.onChange}
        />
      ) : null}
    </View>
  )
}
