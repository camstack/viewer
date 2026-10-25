/**
 * SummaryFormSections — the body of the digest editor: every field a
 * multi-camera digest rule has, in the admin editor's tab order (Rule · Window
 * · What goes in · Mosaic · AI · Delivery — `NC_SUMMARY_TABS`), as one scroll.
 *
 * `rank` and `maxTiles` sit under Mosaic, as in the admin.
 *
 * A DEFAULTED field (`summary-form.ts`) shows the hub's default until the
 * operator touches it, and only a touched one is saved — so a control that
 * merely DISPLAYS "12 pictures" never writes 12 into a rule.
 *
 * The window is a discriminated union in the schema, so the screen shows a
 * segmented control and exactly one set of controls under it — and the OTHER
 * branch's draft is kept in the form state, so looking at the one you did not
 * choose costs nothing.
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
import { ZoneMultiSelect } from '../../../components/notifications/ZoneMultiSelect.js'
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
  SUMMARY_BARRIER_MAX_SEC,
  SUMMARY_BARRIER_MIN_SEC,
  SUMMARY_DWELL_MAX_SEC,
  SUMMARY_DWELL_MIN_SEC,
  SUMMARY_HUB_DEFAULTS,
  SUMMARY_IMPORTANCE_MAX,
  SUMMARY_IMPORTANCE_MIN,
  SUMMARY_MAX_WINDOW_MAX_SEC,
  SUMMARY_MAX_WINDOW_MIN_SEC,
  SUMMARY_PRIORITY_MAX,
  SUMMARY_PRIORITY_MIN,
  SUMMARY_QUIET_MAX_SEC,
  SUMMARY_QUIET_MIN_SEC,
  SUMMARY_TILES_MAX,
  SUMMARY_TILES_MIN,
  summaryMaxTilesChange,
  type SummaryFormProblem,
  type SummaryFormState,
  type SummaryWindowKind,
} from '../../../components/notifications/summary-form.js'
import { useNcConditionTaxonomy, useNcTemplateCatalog } from '../../../data/use-notification-center.js'
import type {
  NcSummaryCaptions,
  NcSummaryRank,
  NcTemplateField,
  NcTemplateVarContext,
  NcTemplateVarDescriptor,
} from '../../../data/notification-center.js'
import { LabeledControl, Problem } from './FamilyFormBits.js'
import { SummaryAiSection } from './SummaryAiSection.js'
import { SectionLabel } from '../../../components/ui/SectionLabel.js'

const S = 'v2.nc.summary'
/** The tracker's MACRO classes (`person`, `vehicle`, …): a digest matches on
 *  them, which is why the picker is borrowed from the occupancy condition. */
const CLASSES_PICKER_ID = 'occupancy'
const BARRIER_STEP_SEC = 30
const IMPORTANCE_STEP = 0.05
const DWELL_STEP_SEC = 1
const RANKS: readonly NcSummaryRank[] = ['importance', 'recency', 'dwell']
const CAPTIONS: readonly NcSummaryCaptions[] = ['none', 'tiles', 'all']

export interface SummaryFormSectionsProps {
  readonly form: SummaryFormState
  readonly update: (patch: Partial<SummaryFormState>) => void
  /** Whether a refused save has asked for this problem to be shown. */
  readonly shows: (problem: SummaryFormProblem) => boolean
  readonly targets: readonly RuleTargetOption[]
  readonly targetsReadState: TargetsReadState
  /** What to say about stored targets not in the caller's list; `undefined` = nothing, or not known. */
  readonly unlisted: UnlistedTargetNote | undefined
  /** The stored rule says "no caption at all" (`captionText: ''`). */
  readonly storedNoCaption: boolean
}

export function SummaryFormSections(props: SummaryFormSectionsProps) {
  const { form, update, shows } = props
  return (
    <View style={{ gap: SPACING.xl }}>
      <RuleSection form={form} update={update} shows={shows} />
      <WindowSection form={form} update={update} shows={shows} />
      <ContentSection form={form} update={update} shows={shows} />
      <MosaicSection form={form} update={update} shows={shows} storedNoCaption={props.storedNoCaption} />
      <SummaryAiSection form={form} update={update} shows={shows} />
      <DeliverySection {...props} />
    </View>
  )
}

/** What every section needs. */
interface SectionProps {
  readonly form: SummaryFormState
  readonly update: (patch: Partial<SummaryFormState>) => void
  readonly shows: (problem: SummaryFormProblem) => boolean
}

function RuleSection({ form, update, shows }: SectionProps) {
  const { t } = useTranslation()
  return (
    <>
      <Section title={t('v2.nc.rules.editor.section.rule')}>
        <LabeledInput
          label={t('v2.nc.rules.editor.nameLabel')}
          value={form.name}
          onChangeText={(next) => update({ name: next })}
          placeholder={t(`${S}.namePlaceholder`)}
          invalid={shows('name')}
        />
        <ToggleRow
          label={t(`${S}.enabledLabel`)}
          value={form.enabled}
          onValueChange={(next) => update({ enabled: next })}
          last
        />
      </Section>
      <View style={{ gap: SPACING.lg }}>
        <SectionLabel inset>{t('v2.nc.rules.editor.section.devices')}</SectionLabel>
        <Hint text={t(`${S}.camerasHint`)} />
        <DevicePicker source={{ kind: 'cameras' }} value={form.deviceIds} onChange={(next) => update({ deviceIds: next })} />
        {shows('devices') ? <Problem text={t(`${S}.problem.devices`)} /> : null}
      </View>
    </>
  )
}

function WindowSection({ form, update, shows }: SectionProps) {
  const { t } = useTranslation()
  const windowOptions: readonly SegmentOption<SummaryWindowKind>[] = [
    { value: 'motion', label: t(`${S}.window.motion`) },
    { value: 'schedule', label: t(`${S}.window.schedule`) },
  ]
  return (
    <View style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t(`${S}.windowLabel`)}</SectionLabel>
      <SegmentedControl<SummaryWindowKind>
        options={windowOptions}
        value={form.windowKind}
        onChange={(next) => update({ windowKind: next })}
      />
      {form.windowKind === 'motion' ? (
        <>
          <Hint text={t(`${S}.motionHint`)} />
          <Section>
            <StepperRow
              label={t(`${S}.quietLabel`)}
              value={form.quietSeconds}
              min={SUMMARY_QUIET_MIN_SEC}
              max={SUMMARY_QUIET_MAX_SEC}
              step={30}
              onChange={(next) => update({ quietSeconds: next })}
            />
            <StepperRow
              label={t(`${S}.maxWindowLabel`)}
              value={form.maxWindowSeconds}
              min={SUMMARY_MAX_WINDOW_MIN_SEC}
              max={SUMMARY_MAX_WINDOW_MAX_SEC}
              step={300}
              onChange={(next) => update({ maxWindowSeconds: next })}
              last
            />
          </Section>
        </>
      ) : (
        <>
          <Hint text={t(`${S}.scheduleHint`)} />
          <ScheduleField value={form.schedule} onChange={(next) => update({ schedule: next })} />
        </>
      )}
      {shows('window') ? <Problem text={t(`${S}.problem.window`)} /> : null}
      <Section>
        <StepperRow
          label={t(`${S}.barrierLabel`)}
          value={form.barrierSeconds ?? SUMMARY_HUB_DEFAULTS.barrierSeconds}
          min={SUMMARY_BARRIER_MIN_SEC}
          max={SUMMARY_BARRIER_MAX_SEC}
          step={BARRIER_STEP_SEC}
          onChange={(next) => update({ barrierSeconds: next })}
          last
        />
      </Section>
      <Hint text={t(`${S}.barrierHint`)} />
      {shows('barrier') ? <Problem text={t(`${S}.problem.barrier`)} /> : null}
    </View>
  )
}

function ContentSection({ form, update, shows }: SectionProps) {
  const { t } = useTranslation()
  const taxonomyQuery = useNcConditionTaxonomy()
  const classesPicker = pickerForCondition(CLASSES_PICKER_ID, taxonomyQuery.data)
  const classField = (value: readonly string[], onChange: (next: string[]) => void): React.ReactNode =>
    // Free text only when the hub has no vocabulary to offer.
    classesPicker ? (
      <TaxonomyMultiSelect picker={classesPicker} value={value} onChange={onChange} />
    ) : (
      <TagsInput value={value} onChange={onChange} />
    )
  return (
    <View style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t(`${S}.section.content`)}</SectionLabel>
      <LabeledControl label={t(`${S}.classesLabel`)} hint={t(`${S}.classesHint`)}>
        {classField(form.classes, (next) => update({ classes: next }))}
      </LabeledControl>
      <LabeledControl label={t(`${S}.classesExcludeLabel`)} hint={t(`${S}.classesExcludeHint`)}>
        {classField(form.classesExclude, (next) => update({ classesExclude: next }))}
      </LabeledControl>
      <LabeledControl label={t(`${S}.zonesLabel`)} hint={t(`${S}.zonesHint`)}>
        <ZoneMultiSelect deviceIds={form.deviceIds} value={form.zones} onChange={(next) => update({ zones: next })} />
      </LabeledControl>
      <LabeledControl label={t(`${S}.minImportanceLabel`)} hint={t(`${S}.minImportanceHint`)}>
        <NumericStepper
          value={form.minImportance}
          min={SUMMARY_IMPORTANCE_MIN}
          max={SUMMARY_IMPORTANCE_MAX}
          step={IMPORTANCE_STEP}
          decimals={2}
          onChange={(next) => update({ minImportance: next })}
        />
      </LabeledControl>
      <LabeledControl label={t(`${S}.minDwellLabel`)} hint={t(`${S}.minDwellHint`)}>
        <NumericStepper
          value={form.minDwellSeconds}
          min={SUMMARY_DWELL_MIN_SEC}
          max={SUMMARY_DWELL_MAX_SEC}
          step={DWELL_STEP_SEC}
          decimals={0}
          onChange={(next) => update({ minDwellSeconds: next })}
        />
      </LabeledControl>
      <Section>
        <ToggleRow
          label={t(`${S}.includeStationaryLabel`)}
          description={t(`${S}.includeStationaryHint`)}
          value={form.includeStationary}
          onValueChange={(next) => update({ includeStationary: next })}
          last
        />
      </Section>
      {shows('filters') ? <Problem text={t(`${S}.problem.filters`)} /> : null}
    </View>
  )
}

interface MosaicSectionProps extends SectionProps {
  readonly storedNoCaption: boolean
}

function MosaicSection({ form, update, shows, storedNoCaption }: MosaicSectionProps) {
  const { t } = useTranslation()
  const templateCatalog = useNcTemplateCatalog()
  const context: NcTemplateVarContext = { family: 'summary', field: 'captionText' }
  const captionOptions: readonly SegmentOption<NcSummaryCaptions>[] = CAPTIONS.map((value) => ({
    value,
    label: t(`${S}.captions.${value}`),
  }))
  const rankOptions: readonly SegmentOption<NcSummaryRank>[] = RANKS.map((value) => ({
    value,
    label: t(`${S}.rank.${value}`),
  }))
  const typedCaption = form.captionText.trim()
  return (
    <View style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t(`${S}.section.mosaic`)}</SectionLabel>
      {/* Tile budget and ranking sit with the mosaic, as in the admin's
          NC_SUMMARY_TABS. Lowering the tiles drags an AI budget that would no
          longer fit down with it (`summaryMaxTilesChange`). */}
      <Section>
        <StepperRow
          label={t(`${S}.maxTilesLabel`)}
          value={form.maxTiles ?? SUMMARY_HUB_DEFAULTS.maxTiles}
          min={SUMMARY_TILES_MIN}
          max={SUMMARY_TILES_MAX}
          onChange={(next) => update(summaryMaxTilesChange(form, next))}
          last
        />
      </Section>
      <LabeledControl label={t(`${S}.rankLabel`)}>
        <SegmentedControl<NcSummaryRank>
          options={rankOptions}
          value={form.rank ?? SUMMARY_HUB_DEFAULTS.rank}
          onChange={(next) => update({ rank: next })}
        />
      </LabeledControl>
      <LabeledControl label={t(`${S}.captionsLabel`)} hint={t(`${S}.captionsHint`)}>
        <SegmentedControl<NcSummaryCaptions>
          options={captionOptions}
          value={form.captions ?? SUMMARY_HUB_DEFAULTS.captions}
          onChange={(next) => update({ captions: next })}
        />
      </LabeledControl>
      <Section>
        <TemplateField
          label={t(`${S}.captionTextLabel`)}
          value={form.captionText}
          onChangeText={(next) => update({ captionText: next })}
          vars={templateCatalog.data ? varsForContext(templateCatalog.data, context) : undefined}
          last
          testID="summary-caption-text"
        />
        {typedCaption.length > 0 ? <TemplatePreview context={context} title="" body={typedCaption} /> : null}
      </Section>
      {/* A rule stored with NO caption shows a blank box too — the hint must
          not claim the default caption for it. */}
      <Hint
        text={t(storedNoCaption && typedCaption.length === 0 ? `${S}.captionTextNoneHint` : `${S}.captionTextHint`)}
      />
      {shows('caption') ? <Problem text={t(`${S}.problem.caption`)} /> : null}
    </View>
  )
}

function DeliverySection({
  form,
  update,
  shows,
  targets,
  targetsReadState,
  unlisted,
}: SummaryFormSectionsProps) {
  const { t } = useTranslation()
  const templateCatalog = useNcTemplateCatalog()
  const contextFor = (field: NcTemplateField): NcTemplateVarContext => ({ family: 'summary', field })
  const varsFor = (field: NcTemplateField): readonly NcTemplateVarDescriptor[] | undefined =>
    templateCatalog.data ? varsForContext(templateCatalog.data, contextFor(field)) : undefined
  return (
    <View style={{ gap: SPACING.lg }}>
      <SectionLabel inset>{t(`${S}.section.delivery`)}</SectionLabel>
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
      <Section>
        <StepperRow
          label={t('v2.nc.rules.editor.priorityLabel')}
          value={form.priority}
          min={SUMMARY_PRIORITY_MIN}
          max={SUMMARY_PRIORITY_MAX}
          onChange={(next) => update({ priority: next })}
        />
        <ToggleRow
          label={t(`${S}.deliverEmptyLabel`)}
          description={t(`${S}.deliverEmptyHint`)}
          value={form.deliverEmpty ?? SUMMARY_HUB_DEFAULTS.deliverEmpty}
          onValueChange={(next) => update({ deliverEmpty: next })}
          last
        />
      </Section>
      <Section>
        <TemplateField
          label={t('v2.nc.rules.editor.templateTitleLabel')}
          value={form.template.title}
          onChangeText={(next) => update({ template: { ...form.template, title: next } })}
          vars={varsFor('title')}
          testID="summary-template-title"
        />
        <TemplateField
          label={t('v2.nc.rules.editor.templateBodyLabel')}
          value={form.template.body}
          onChangeText={(next) => update({ template: { ...form.template, body: next } })}
          vars={varsFor('body')}
          multiline
          last
          testID="summary-template-body"
        />
        <TemplatePreview context={contextFor('body')} title={form.template.title} body={form.template.body} />
      </Section>
      <Hint text={t(`${S}.messageHint`)} />
      {shows('template') ? <Problem text={t(`${S}.problem.template`)} /> : null}
    </View>
  )
}
