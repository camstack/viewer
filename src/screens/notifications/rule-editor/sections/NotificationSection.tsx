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
import {
  useNcTargetKinds,
  useNcTargets,
  useNcTemplateCatalog,
} from '../../../../data/use-notification-center.js'
import { fieldSupportForSelection } from '../../../../components/notifications/rule-field-support.js'
import type {
  NotificationField,
  NcTemplateField,
  NcTemplateVarContext,
  NcTemplateVarDescriptor,
} from '../../../../data/notification-center.js'
import { useRuleAiState } from '../use-rule-draft.js'
import { MediaPolicyFields } from './MediaPolicyFields.js'
import {
  isStateSummaryForm,
  summaryBodyWarning,
  summaryDeliveryOffered,
  summarySplitBodyWarning,
} from '../../../../components/notifications/system-event-delivery.js'
import { Hint } from './SectionHint.js'
import { SystemEventDeliveryField } from './SystemEventDeliveryField.js'
import type { RuleSectionProps } from './section-props.js'

export function NotificationSection({ draft, patch, kind }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const templateCatalog = useNcTemplateCatalog()
  const ai = useRuleAiState(draft)
  const form = draft.form
  const kindSpec = ruleKindSpec(kind)
  // What the selected targets can deliver (#483), from each kind's declaration.
  // Unanswered queries narrow nothing: not-yet-known is not unsupported.
  const targetsQuery = useNcTargets()
  const targetKindsQuery = useNcTargetKinds()
  const fieldSupport = fieldSupportForSelection(form.targetIds, targetsQuery.data ?? [], targetKindsQuery.data)
  const shows = (field: NotificationField): boolean => fieldSupport.get(field)?.shown ?? true
  const droppedHint = (field: NotificationField): string | undefined => {
    const droppedBy = fieldSupport.get(field)?.droppedBy ?? []
    return droppedBy.length > 0
      ? t('v2.nc.rules.editor.droppedBy', { targets: droppedBy.join(', ') })
      : undefined
  }
  const priorityDropped = droppedHint('priority')
  const mediaDropped = droppedHint('attachments')
  const titleDropped = droppedHint('title')
  const bodyDropped = droppedHint('body')
  const bodyWarning = summaryBodyWarning(form)
  const splitBodyWarning = summarySplitBodyWarning(form)

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
      {shows('priority') ? (
        <Section>
          <StepperRow
            label={t('v2.nc.rules.editor.priorityLabel')}
            value={form.priority}
            min={NC_PRIORITY_MIN}
            max={NC_PRIORITY_MAX}
            onChange={(next) => patch({ priority: next })}
            last={priorityDropped === undefined}
          />
          {priorityDropped !== undefined ? <Hint text={priorityDropped} last /> : null}
        </Section>
      ) : null}

      {/* When a system rule speaks: its start, its resolution, a scheduled
          summary. Offered for the families that may summarise only. */}
      {summaryDeliveryOffered(kind) ? (
        <SystemEventDeliveryField
          value={form.systemEventDelivery}
          kinds={form.conditions.systemEvent?.kinds ?? []}
          onChange={(next) => patch({ systemEventDelivery: next })}
        />
      ) : null}

      {/* A subject that freezes no frame gets no media controls: `formToInput`
          writes `image: 'none'` for it either way. */}
      {kindSpec.carriesMedia && shows('attachments') ? (
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
          {mediaDropped !== undefined ? <Hint text={mediaDropped} last /> : null}
        </Section>
      ) : null}

      <Section title={t('v2.nc.rules.editor.templateLabel')}>
        {shows('title') ? (
          <TemplateField
            label={t('v2.nc.rules.editor.templateTitleLabel')}
            value={form.templateTitle}
            onChangeText={(next) => patch({ templateTitle: next })}
            vars={templateVarsFor('title')}
            testID="rule-template-title"
            last={titleDropped === undefined && !shows('body')}
          />
        ) : null}
        {shows('title') && titleDropped !== undefined ? <Hint text={titleDropped} last={!shows('body')} /> : null}
        {shows('body') ? (
          <TemplateField
            label={t('v2.nc.rules.editor.templateBodyLabel')}
            value={form.templateBody}
            onChangeText={(next) => patch({ templateBody: next })}
            vars={templateVarsFor('body')}
            placeholder={t('v2.nc.rules.editor.templateHint')}
            multiline
            last={bodyDropped === undefined && !bodyWarning && !splitBodyWarning}
            testID="rule-template-body"
          />
        ) : null}
        {shows('body') && bodyDropped !== undefined ? (
          <Hint text={bodyDropped} last={!bodyWarning && !splitBodyWarning} />
        ) : null}
        {shows('body') && bodyWarning ? (
          <Hint
            text={t('v2.nc.rules.editor.systemDelivery.bodyWarning', {
              token: '{{summaryText}}',
            })}
            last
          />
        ) : null}
        {shows('body') && splitBodyWarning ? (
          <Hint
            text={t('v2.nc.rules.editor.systemDelivery.splitBodyWarning', {
              token: '{{summaryText}}',
            })}
            last
          />
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
