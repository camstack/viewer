/**
 * TimelapseFormSections — the body of the timelapse editor: every field a
 * scheduled timelapse rule has, in the admin editor's order (Rule · Cameras ·
 * Window · Sampling · Message · Notification · Targets).
 *
 * A timelapse is a different animal from an `NcRule` and the form says so: it
 * has no trigger, no conditions and no media policy, because it fires on a
 * SCHEDULE WINDOW BOUNDARY and produces a video it assembled itself from
 * recorded footage. What it shares is the shape of the screen — the same
 * section headings, the same target picker, the same template field — because
 * the complaint that started this work was that the app's surfaces did not
 * resemble each other.
 *
 * Three optional fields have an ABSENT state that is a value (see
 * `timelapse-form.ts`): the dense cadence and the minimum dwell use the
 * clearable stepper, whose "—" is "automatic"/"no minimum"; an empty caption is
 * the hub's default caption; no counted class is every class.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SPACING } from '../../../theme/tokens.js'
import { Section } from '../../../components/ui/Section.js'
import { SegmentedControl, type SegmentOption } from '../../../components/ui/SegmentedControl.js'
import { StepperRow } from '../../../components/ui/StepperRow.js'
import { ToggleRow } from '../../../components/ui/ToggleRow.js'
import { DevicePicker } from '../../../components/notifications/DevicePicker.js'
import { Hint } from '../../../components/notifications/FieldHint.js'
import {
  ScheduleField,
  TagsInput,
  TaxonomyMultiSelect,
} from '../../../components/notifications/ConditionField.js'
import { NumericStepper } from '../../../components/notifications/NumericStepper.js'
import { pickerForCondition } from '../../../components/notifications/condition-taxonomy.js'
import {
  LabeledInput,
  TargetPicker,
  type RuleTargetOption,
} from '../../../components/notifications/RuleFormFields.js'
import type { UnlistedTargetNote } from '../../../components/notifications/target-ownership.js'
import type { TargetsReadState } from '../../../components/notifications/save-gate.js'
import { TemplateField, TemplatePreview } from '../../../components/notifications/TemplateField.js'
import { varsForContext } from '../../../components/notifications/template-field.js'
import {
  timelapseDerivedDenseCadence,
  TIMELAPSE_CADENCE_MAX_SEC,
  TIMELAPSE_CADENCE_MIN_SEC,
  TIMELAPSE_DENSE_MIN_SEC,
  TIMELAPSE_FRAMERATE_MAX,
  TIMELAPSE_FRAMERATE_MIN,
  TIMELAPSE_MIN_DWELL_MAX_SEC,
  TIMELAPSE_MIN_DWELL_MIN_SEC,
  TIMELAPSE_PRIORITY_MAX,
  TIMELAPSE_PRIORITY_MIN,
  type TimelapseFormProblem,
  type TimelapseFormState,
} from '../../../components/notifications/timelapse-form.js'
import { useNcConditionTaxonomy, useNcTemplateCatalog } from '../../../data/use-notification-center.js'
import type {
  NcTemplateField,
  NcTemplateVarContext,
  NcTemplateVarDescriptor,
} from '../../../data/notification-center.js'
import { LabeledControl, Problem } from './FamilyFormBits.js'
import { DEFAULT_TIMELAPSE_PREVIEW_TEXT } from '@camstack/types/client'
import type { TimelapsePreviewMode } from '@camstack/types'
import { SectionLabel } from '../../../components/ui/SectionLabel.js'

/**
 * The taxonomy picker whose vocabulary is the tracker's MACRO classes
 * (`person`, `vehicle`, `animal`, …) — exactly the names `reportClasses`
 * counts, which is why it is borrowed from the occupancy condition.
 */
const REPORT_CLASSES_PICKER_ID = 'occupancy'

/** The admin editor's steps: 0.1 s for the dense cadence (its floor is the
 *  recording's frame interval), 0.5 s for the dwell. */
const DENSE_STEP_SEC = 0.1
const MIN_DWELL_STEP_SEC = 0.5

export interface TimelapseFormSectionsProps {
  readonly form: TimelapseFormState
  readonly update: (patch: Partial<TimelapseFormState>) => void
  /** Whether a refused save has asked for this problem to be shown. */
  readonly shows: (problem: TimelapseFormProblem) => boolean
  readonly targets: readonly RuleTargetOption[]
  readonly targetsReadState: TargetsReadState
  /** What to say about stored targets not in the caller's list; `undefined` = nothing, or not known. */
  readonly unlisted: UnlistedTargetNote | undefined
  /** The stored rule says "no caption at all" (`previewText: ''`). */
  readonly storedNoCaption: boolean
}

export function TimelapseFormSections({
  form,
  update,
  shows,
  targets,
  targetsReadState,
  unlisted,
  storedNoCaption,
}: TimelapseFormSectionsProps) {
  const { t } = useTranslation()
  const templateCatalog = useNcTemplateCatalog()
  const taxonomyQuery = useNcConditionTaxonomy()

  const templateContext = (field: NcTemplateField): NcTemplateVarContext => ({ family: 'timelapse', field })
  const templateVarsFor = (field: NcTemplateField): readonly NcTemplateVarDescriptor[] | undefined =>
    templateCatalog.data ? varsForContext(templateCatalog.data, templateContext(field)) : undefined
  const classesPicker = pickerForCondition(REPORT_CLASSES_PICKER_ID, taxonomyQuery.data)
  // What the frame will carry: the typed caption, else the hub's default —
  // except on a rule stored with NO caption, which an empty box keeps.
  const typedCaption = form.previewText.trim()
  const captionShown = typedCaption.length > 0 ? typedCaption : storedNoCaption ? '' : DEFAULT_TIMELAPSE_PREVIEW_TEXT

  const previewOptions: readonly SegmentOption<TimelapsePreviewMode>[] = [
    { value: 'image', label: t('v2.nc.timelapse.preview.image') },
    { value: 'gif', label: t('v2.nc.timelapse.preview.gif') },
  ]

  return (
    <View style={{ gap: SPACING.xl }}>
      {/* ── Rule ─────────────────────────────────────────────────── */}
      <Section title={t('v2.nc.rules.editor.section.rule')}>
        <LabeledInput
          label={t('v2.nc.rules.editor.nameLabel')}
          value={form.name}
          onChangeText={(next) => update({ name: next })}
          placeholder={t('v2.nc.timelapse.namePlaceholder')}
          invalid={shows('name')}
        />
        <ToggleRow
          label={t('v2.nc.timelapse.enabledLabel')}
          value={form.enabled}
          onValueChange={(next) => update({ enabled: next })}
          last
        />
      </Section>

      {/* ── Cameras ──────────────────────────────────────────────── */}
      {/* One video per camera, so this is a real fan-out and not a filter —
          hence REQUIRED, unlike a rule's `devices` condition. */}
      <View style={{ gap: SPACING.lg }}>
        <SectionLabel inset>{t('v2.nc.rules.editor.section.devices')}</SectionLabel>
        <Hint text={t('v2.nc.timelapse.camerasHint')} />
        <DevicePicker source={{ kind: 'cameras' }} value={form.deviceIds} onChange={(next) => update({ deviceIds: next })} />
        {shows('devices') ? <Problem text={t('v2.nc.timelapse.problem.devices')} /> : null}
      </View>

      {/* ── Window ───────────────────────────────────────────────── */}
      {/* REQUIRED: the boundaries ARE the rule — open clears the scratch,
          close assembles and delivers. */}
      <View style={{ gap: SPACING.lg }}>
        <SectionLabel inset>{t('v2.nc.timelapse.windowLabel')}</SectionLabel>
        <Hint text={t('v2.nc.timelapse.windowHint')} />
        <ScheduleField value={form.schedule} onChange={(next) => update({ schedule: next })} />
        {shows('schedule') ? <Problem text={t('v2.nc.timelapse.problem.schedule')} /> : null}
      </View>

      {/* ── Sampling ─────────────────────────────────────────────── */}
      <View style={{ gap: SPACING.lg }}>
        <Section title={t('v2.nc.timelapse.samplingLabel')}>
          <StepperRow
            label={t('v2.nc.timelapse.cadenceLabel')}
            value={form.cadenceSec}
            min={TIMELAPSE_CADENCE_MIN_SEC}
            max={TIMELAPSE_CADENCE_MAX_SEC}
            step={5}
            onChange={(next) => update({ cadenceSec: next })}
          />
          <StepperRow
            label={t('v2.nc.timelapse.framerateLabel')}
            value={form.framerate}
            min={TIMELAPSE_FRAMERATE_MIN}
            max={TIMELAPSE_FRAMERATE_MAX}
            onChange={(next) => update({ framerate: next })}
            last
          />
        </Section>
        <LabeledControl
          label={t('v2.nc.timelapse.denseCadenceLabel')}
          hint={t('v2.nc.timelapse.denseCadenceHint')}
        >
          {/* Capped just under the base cadence: the hub refuses a dense rate
              that is not denser, and the stepper should not walk into that. */}
          <NumericStepper
            value={form.denseCadenceSec}
            min={TIMELAPSE_DENSE_MIN_SEC}
            max={Math.max(TIMELAPSE_DENSE_MIN_SEC, form.cadenceSec - TIMELAPSE_DENSE_MIN_SEC)}
            step={DENSE_STEP_SEC}
            start={timelapseDerivedDenseCadence(form.cadenceSec)}
            decimals={1}
            onChange={(next) => update({ denseCadenceSec: next })}
          />
          {shows('denseCadence') ? <Problem text={t('v2.nc.timelapse.problem.denseCadence')} /> : null}
        </LabeledControl>
        <LabeledControl label={t('v2.nc.timelapse.minDwellLabel')} hint={t('v2.nc.timelapse.minDwellHint')}>
          <NumericStepper
            value={form.minDwellSec}
            min={TIMELAPSE_MIN_DWELL_MIN_SEC}
            max={TIMELAPSE_MIN_DWELL_MAX_SEC}
            step={MIN_DWELL_STEP_SEC}
            decimals={1}
            onChange={(next) => update({ minDwellSec: next })}
          />
          {shows('minDwell') ? <Problem text={t('v2.nc.timelapse.problem.minDwell')} /> : null}
        </LabeledControl>
      </View>

      {/* ── Message ──────────────────────────────────────────────── */}
      <View style={{ gap: SPACING.lg }}>
        <Section title={t('v2.nc.timelapse.messageLabel')}>
          <TemplateField
            label={t('v2.nc.rules.editor.templateTitleLabel')}
            value={form.template.title}
            onChangeText={(next) => update({ template: { ...form.template, title: next } })}
            vars={templateVarsFor('title')}
            testID="timelapse-template-title"
          />
          <TemplateField
            label={t('v2.nc.rules.editor.templateBodyLabel')}
            value={form.template.body}
            onChangeText={(next) => update({ template: { ...form.template, body: next } })}
            vars={templateVarsFor('body')}
            multiline
            testID="timelapse-template-body"
          />
          <TemplateField
            label={t('v2.nc.timelapse.previewTextLabel')}
            value={form.previewText}
            onChangeText={(next) => update({ previewText: next })}
            vars={templateVarsFor('previewText')}
            last
            testID="timelapse-preview-text"
          />
          <TemplatePreview
            context={templateContext('body')}
            title={form.template.title}
            body={form.template.body}
          />
          <TemplatePreview
            context={templateContext('previewText')}
            title=""
            body={captionShown}
            label={t('v2.nc.timelapse.captionPreviewLabel')}
          />
        </Section>
        <Hint text={t('v2.nc.timelapse.messageHint')} />
        {/* A rule stored with NO caption shows a blank box too — the hint must
            not claim the default caption for it. */}
        <Hint
          text={t(
            storedNoCaption && typedCaption.length === 0
              ? 'v2.nc.timelapse.previewTextNoneHint'
              : 'v2.nc.timelapse.previewTextHint',
          )}
        />
        {shows('template') ? <Problem text={t('v2.nc.timelapse.problem.template')} /> : null}
        {shows('previewText') ? <Problem text={t('v2.nc.timelapse.problem.previewText')} /> : null}
        <LabeledControl
          label={t('v2.nc.timelapse.reportClassesLabel')}
          hint={t('v2.nc.timelapse.reportClassesHint')}
        >
          {/* Free text only when the hub has no vocabulary to offer — an
              unknown class name is not an error, it simply counts nothing. */}
          {classesPicker ? (
            <TaxonomyMultiSelect
              picker={classesPicker}
              value={form.reportClasses}
              onChange={(next) => update({ reportClasses: next })}
            />
          ) : (
            <TagsInput value={form.reportClasses} onChange={(next) => update({ reportClasses: next })} />
          )}
          {shows('reportClasses') ? <Problem text={t('v2.nc.timelapse.problem.reportClasses')} /> : null}
        </LabeledControl>
      </View>

      {/* ── Notification ─────────────────────────────────────────── */}
      <View style={{ gap: SPACING.lg }}>
        <SectionLabel inset>{t('v2.nc.rules.editor.section.notification')}</SectionLabel>
        <Section>
          <StepperRow
            label={t('v2.nc.rules.editor.priorityLabel')}
            value={form.priority}
            min={TIMELAPSE_PRIORITY_MIN}
            max={TIMELAPSE_PRIORITY_MAX}
            onChange={(next) => update({ priority: next })}
            last
          />
        </Section>
        <Hint text={t('v2.nc.timelapse.previewHint')} />
        <SegmentedControl<TimelapsePreviewMode>
          options={previewOptions}
          value={form.previewMode}
          onChange={(next) => update({ previewMode: next })}
        />
      </View>

      <Section title={t('v2.nc.rules.editor.targetsLabel')}>
        <TargetPicker
          targets={targets}
          readState={targetsReadState}
          selected={form.targetIds}
          invalid={shows('targets')}
          unlisted={unlisted}
          onToggle={(id) =>
            update({
              targetIds: form.targetIds.includes(id)
                ? form.targetIds.filter((x) => x !== id)
                : [...form.targetIds, id],
            })
          }
        />
      </Section>
    </View>
  )
}
