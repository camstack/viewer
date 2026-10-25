/**
 * The sections of the admin alarm screen (`AlarmSettingsScreen.tsx`): State,
 * one card per mode (its sensor table, D697) and Delays — the
 * content of the admin UI's Alarm tab (`NotificationAlarm.tsx`,
 * `alarm-mode-card.tsx`, `alarm-live-card.tsx`), in the viewer's own components.
 *
 * Every section here renders what it is given and reports edits upward; the
 * screen owns the draft and the one Save.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { AlarmArmMode, NcAlarmModeCoverage } from '@camstack/types'
import { Section } from '../../components/ui/Section.js'
import { AlarmControl } from '../../components/camera/accessory-controls/controls-alarm.js'
import {
  alarmSensorTableState,
  type AlarmSensorRow,
  type AlarmSwitchWrite,
} from '../../components/notifications/alarm-sensor-table-model.js'
import type { PickerZonesRead } from '../../components/notifications/device-picker-model.js'
import type { NcAlarmLive } from '../../data/nc-alarm.js'
import {
  ALARM_DELAY_MAX,
  openingsSummary,
  nonBlockingEmptyLine,
  type AlarmDelayField,
  type AlarmDeviceLabel,
  type AlarmModeDelayView,
  type NonBlockingOptionsView,
} from '../../components/notifications/alarm-settings-model.js'
import { LabeledInput } from '../../components/notifications/RuleFormFields.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { AlarmSensorTable } from './AlarmSensorTable.js'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Where a supporting read is: answered, still asked, or failed. */
export type AlarmReadState = 'answered' | 'pending' | 'failed'

/** Names one device id for display (see `alarmDeviceLabel`). */
export type AlarmNameOf = (id: number) => AlarmDeviceLabel

export function labelText(label: AlarmDeviceLabel, id: number, t: Translate): string {
  if (label.kind === 'named') return label.name
  if (label.kind === 'removed') return t('v2.nc.rules.editor.deviceRemoved', { id })
  return t('v2.nc.rules.editor.deviceUnknown', { id })
}

function modeLabel(mode: AlarmArmMode, t: Translate): string {
  return t(`v2.accessories.armMode.${mode}`)
}

// ── Atoms ───────────────────────────────────────────────────────────

interface NoteProps {
  readonly text: string
  readonly tone?: 'muted' | 'warning' | 'danger'
  readonly testID?: string
}

export function AlarmNote({ text, tone = 'muted', testID }: NoteProps) {
  const { colors } = useTheme()
  const color = tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.foregroundSubtle
  return (
    <Text testID={testID} style={{ color, fontSize: 13, lineHeight: 18 }}>
      {text}
    </Text>
  )
}

interface RetryNoteProps {
  readonly text: string
  readonly onRetry: () => void
}

/** A failed read, said in words, with the way out. */
export function RetryNote({ text, onRetry }: RetryNoteProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={{ gap: SPACING.sm, alignItems: 'flex-start' }}>
      <AlarmNote text={text} tone="danger" />
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={{
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>{t('v2.nc.alarm.retry')}</Text>
      </Pressable>
    </View>
  )
}

interface SensorsFailedNoteProps {
  readonly onRetry: () => void
}

/**
 * The failed sensors read, said ONCE for the whole screen: it is one read for
 * every mode's table, so it is drawn above the cards, not inside each.
 */
export function SensorsFailedNote({ onRetry }: SensorsFailedNoteProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View testID="alarm-sensors-failed" style={{ gap: SPACING.sm, alignItems: 'flex-start' }}>
      <Text style={{ color: colors.warning, fontSize: 13 }}>{t('v2.nc.alarm.table.sensorsFailed')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={{
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>{t('v2.nc.alarm.retry')}</Text>
      </Pressable>
    </View>
  )
}

interface PaddedProps {
  readonly children: React.ReactNode
}

function Padded({ children }: PaddedProps) {
  return <View style={{ padding: SPACING.xl, gap: SPACING.sm }}>{children}</View>
}

// ── State ───────────────────────────────────────────────────────────

function stateLine(live: NcAlarmLive, t: Translate): string {
  const word = live.state.startsWith('armed_') ? 'armed' : live.state
  const state = t(`v2.nc.alarm.stateWord.${word}`)
  if (live.state === 'disarmed' || live.targetMode === null) return state
  return t('v2.nc.alarm.stateWithMode', { state, mode: modeLabel(live.targetMode, t) })
}

interface StateSectionProps {
  readonly panelId: number
  readonly live: NcAlarmLive | undefined
}

/** The panel now, and the arm / Arm anyway / disarm flow of Task 11. */
export function StateSection({ panelId, live }: StateSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Section title={t('v2.nc.alarm.sections.state')}>
      <Padded>
        {live === undefined ? (
          <AlarmNote text={t('v2.nc.alarm.liveUnknown')} tone="warning" />
        ) : (
          <Text testID="alarm-state" style={{ color: colors.foreground, fontSize: 16, fontWeight: '600' }}>
            {stateLine(live, t)}
          </Text>
        )}
        {(live?.exclusions ?? []).map((ex) => (
          <AlarmNote
            key={ex.deviceId}
            text={t(ex.phase === 'open' ? 'v2.nc.alarm.exclusionOpen' : 'v2.nc.alarm.exclusionClosed', {
              name: ex.name !== '' ? ex.name : t('v2.nc.rules.editor.deviceUnknown', { id: ex.deviceId }),
            })}
          />
        ))}
        <AlarmControl deviceId={panelId} online />
      </Padded>
    </Section>
  )
}

// ── Modes ───────────────────────────────────────────────────────────

interface OpenCountProps {
  readonly live: NcAlarmLive | undefined
  readonly mode: AlarmArmMode
}

/** One line: how many covered openings refuse the arm now. The row's State says which. */
function OpenCount({ live, mode }: OpenCountProps) {
  const { t } = useTranslation()
  const summary = openingsSummary(live, mode)
  // No row: the hub did not say. That is NOT "nothing open" (D315).
  if (summary === null) return <AlarmNote text={t('v2.nc.alarm.openingsUnknown')} />
  if (summary.blocking === 0) return null
  return (
    <View testID={`alarm-openings-${mode}`}>
      <AlarmNote tone="warning" text={t('v2.nc.alarm.openRefuse', { count: summary.blocking })} />
    </View>
  )
}

interface ModeCardProps {
  readonly coverage: NcAlarmModeCoverage
  readonly live: NcAlarmLive | undefined
  /** What the mode's table has rows for, and whether the household scan answered. */
  readonly options: NonBlockingOptionsView
  readonly openingsState: AlarmReadState
  readonly onRetryOpenings: () => void
  readonly nameOf: AlarmNameOf
  /** One row per candidate opening (`alarmSensorRows`). */
  readonly rows: readonly AlarmSensorRow[]
  /** The switch write in flight anywhere on the screen. */
  readonly inFlight: AlarmSwitchWrite | null
  readonly onSwitch: (
    row: AlarmSensorRow,
    kind: 'blocks' | 'secureOnArm',
    nextValue: boolean,
  ) => void
  readonly zones: PickerZonesRead
  /** This mode's three delays as the draft shows them. */
  readonly delays: Readonly<Record<AlarmDelayField, AlarmModeDelayView>>
  readonly onDelayType: (field: AlarmDelayField, raw: string) => void
  readonly onDelayCommit: (field: AlarmDelayField) => void
  readonly onDelayDefault: (field: AlarmDelayField) => void
  readonly disabled: boolean
}

export function ModeCard(props: ModeCardProps) {
  const { coverage, live, options, openingsState, nameOf, disabled } = props
  const { t } = useTranslation()
  const emptyLine = nonBlockingEmptyLine(options)
  const tableState = alarmSensorTableState({ rowCount: props.rows.length, candidatesComplete: !options.unresolved })
  const mode = modeLabel(coverage.mode, t)
  const skipped = coverage.skippedDevices
    .map((s) => `${labelText(nameOf(s.deviceId), s.deviceId, t)} (${t(`v2.nc.alarm.skipReason.${s.reason}`)})`)
    .join(', ')
  return (
    <Section title={mode}>
      <Padded>
        <AlarmNote
          text={
            coverage.ruleCount === 0
              ? t('v2.nc.alarm.coverageNone')
              : t('v2.nc.alarm.checks', { count: props.rows.filter((r) => r.coverage.kind !== 'not-covered' && r.coverage.kind !== 'unscoped').length })
          }
          tone={coverage.ruleCount === 0 ? 'warning' : 'muted'}
          testID={`alarm-coverage-${coverage.mode}`}
        />
        {skipped !== '' ? (
          <AlarmNote text={t('v2.nc.alarm.skippedCount', { count: coverage.skippedDevices.length })} tone="warning" />
        ) : null}
        <OpenCount live={live} mode={coverage.mode} />
      </Padded>
      <ModeDelays
        mode={coverage.mode}
        views={props.delays}
        disabled={disabled}
        onType={props.onDelayType}
        onCommit={props.onDelayCommit}
        onUseDefault={props.onDelayDefault}
      />
      <Padded>
        {options.unresolved && openingsState === 'pending' ? (
          <AlarmNote text={t('v2.nc.alarm.openingsChecking')} />
        ) : null}
        {options.unresolved && openingsState === 'failed' ? (
          <RetryNote text={t('v2.nc.alarm.openingsCheckFailed')} onRetry={props.onRetryOpenings} />
        ) : null}
        {emptyLine !== null ? (
          <AlarmNote testID={`alarm-nonblocking-empty-${coverage.mode}`} text={t('v2.nc.alarm.nonBlockingEmpty')} />
        ) : tableState === 'none' ? (
          // "None" is a claim only a whole candidate list can make (D315).
          <AlarmNote testID={`alarm-sensors-none-${coverage.mode}`} text={t('v2.nc.alarm.table.none')} />
        ) : null}
      </Padded>
      {emptyLine === null && tableState === 'rows' ? (
        <AlarmSensorTable
          mode={coverage.mode}
          rows={props.rows}
          inFlight={props.inFlight}
          onSwitch={props.onSwitch}
          zones={props.zones}
          disabled={disabled}
        />
      ) : null}
    </Section>
  )
}

// ── Delays ──────────────────────────────────────────────────────────

function durationText(seconds: number, zeroKey: string, t: Translate): string {
  if (seconds <= 0) return t(zeroKey)
  if (seconds < 60) return t('v2.nc.alarm.seconds', { seconds })
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? t('v2.nc.alarm.minutes', { minutes }) : t('v2.nc.alarm.minutesSeconds', { minutes, seconds: rest })
}

interface DelayRowProps {
  readonly field: AlarmDelayField
  readonly labelKey: string
  /** The long hint under the label; a per-mode row leaves it out (its footer says more). */
  readonly hintKey?: string
  readonly zeroKey: string
  /** The value the draft resolves to (typed and clamped, else stored). */
  readonly value: number
  /** The box's text as typed; undefined = untouched, shows `value`. */
  readonly raw: string | undefined
  readonly disabled: boolean
  readonly onType: (field: AlarmDelayField, raw: string) => void
  /** The box was left: show what Save will send. */
  readonly onCommit: (field: AlarmDelayField) => void
  /** Test id prefix of the box (`<prefix>-<field>`); defaults to `alarm-delay`. */
  readonly testIdPrefix?: string
  /** A per-mode row adds "Default (n s)" / "Use default" under the readout. */
  readonly footer?: React.ReactNode
  readonly last?: boolean
}

/**
 * One duration, as the labelled box the other editors use (`LabeledInput`).
 * What is typed IS the draft, keystroke by keystroke — never held until the
 * field is left, because iOS's number pad has no return key and a tap on Save
 * does not blur it. The draft clamps it; an emptied box resolves to the stored
 * value, never to 0.
 */
function DelayRow({
  field,
  labelKey,
  hintKey,
  zeroKey,
  value,
  raw,
  disabled,
  onType,
  onCommit,
  testIdPrefix = 'alarm-delay',
  footer,
  last = false,
}: DelayRowProps) {
  const { t } = useTranslation()
  return (
    <LabeledInput
      label={t(labelKey)}
      {...(hintKey !== undefined ? { description: t(hintKey) } : {})}
      testID={`${testIdPrefix}-${field}`}
      value={raw ?? String(value)}
      onChangeText={(text) => onType(field, text)}
      onBlur={() => onCommit(field)}
      editable={!disabled}
      numeric
      returnKeyType="done"
      last={last}
      footer={
        <View style={{ gap: SPACING.xs }}>
          <AlarmNote text={`${durationText(value, zeroKey, t)} · ${t('v2.nc.alarm.delayRange', { max: ALARM_DELAY_MAX[field] })}`} />
          {footer}
        </View>
      }
    />
  )
}

interface DelaysSectionProps {
  readonly values: Readonly<Record<AlarmDelayField, number>>
  readonly raw: Readonly<Partial<Record<AlarmDelayField, string>>>
  readonly disabled: boolean
  readonly onType: (field: AlarmDelayField, raw: string) => void
  readonly onCommit: (field: AlarmDelayField) => void
}

interface DelaySpec {
  readonly field: AlarmDelayField
  readonly labelKey: string
  readonly hintKey: string
  readonly zeroKey: string
}

const DELAY_SPECS: readonly DelaySpec[] = [
  { field: 'exitDelaySec', labelKey: 'v2.nc.alarm.exitDelay', hintKey: 'v2.nc.alarm.exitHint', zeroKey: 'v2.nc.alarm.exitZero' },
  { field: 'entryDelaySec', labelKey: 'v2.nc.alarm.entryDelay', hintKey: 'v2.nc.alarm.entryHint', zeroKey: 'v2.nc.alarm.entryZero' },
  {
    field: 'triggeredDurationSec',
    labelKey: 'v2.nc.alarm.triggeredFor',
    hintKey: 'v2.nc.alarm.triggeredHint',
    zeroKey: 'v2.nc.alarm.triggeredZero',
  },
]

interface ModeDelaysProps {
  readonly mode: AlarmArmMode
  readonly views: Readonly<Record<AlarmDelayField, AlarmModeDelayView>>
  readonly disabled: boolean
  readonly onType: (field: AlarmDelayField, raw: string) => void
  readonly onCommit: (field: AlarmDelayField) => void
  readonly onUseDefault: (field: AlarmDelayField) => void
}

/**
 * One mode's three delays (D697): its own value, or the default it inherits -
 * said which. "Use default" is offered exactly when the mode HAS an override.
 */
export function ModeDelays({ mode, views, disabled, onType, onCommit, onUseDefault }: ModeDelaysProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View testID={`alarm-delays-${mode}`}>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 14,
          fontWeight: '600',
          paddingHorizontal: SPACING.xl,
          paddingTop: SPACING.md,
        }}
      >
        {t('v2.nc.alarm.modeDelays.title', { mode: modeLabel(mode, t) })}
      </Text>
      {DELAY_SPECS.map((spec) => {
        const view = views[spec.field]
        return (
          <DelayRow
            key={spec.field}
            field={spec.field}
            labelKey={spec.labelKey}
            zeroKey={spec.zeroKey}
            value={view.value}
            raw={view.raw}
            disabled={disabled}
            onType={onType}
            onCommit={onCommit}
            testIdPrefix={`alarm-delay-${mode}`}
            footer={
              view.inherited ? (
                <AlarmNote
                  testID={`alarm-delay-${mode}-${spec.field}-inherited`}
                  text={t('v2.nc.alarm.modeDelays.inherited', { seconds: view.defaultValue })}
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  testID={`alarm-delay-${mode}-${spec.field}-default`}
                  disabled={disabled}
                  onPress={() => onUseDefault(spec.field)}
                  style={{
                    alignSelf: 'flex-start',
                    paddingHorizontal: SPACING.lg,
                    paddingVertical: SPACING.xs,
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                    {t('v2.nc.alarm.modeDelays.useDefault')}
                  </Text>
                </Pressable>
              )
            }
          />
        )
      })}
    </View>
  )
}

export function DelaysSection({ values, raw, disabled, onType, onCommit }: DelaysSectionProps) {
  const { t } = useTranslation()
  return (
    <Section title={t('v2.nc.alarm.sections.delays')}>
      {DELAY_SPECS.map((spec, index) => (
        <DelayRow
          key={spec.field}
          {...spec}
          value={values[spec.field]}
          raw={raw[spec.field]}
          disabled={disabled}
          onType={onType}
          onCommit={onCommit}
          last={index === DELAY_SPECS.length - 1}
        />
      ))}
    </Section>
  )
}
