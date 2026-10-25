/**
 * ActionStepEditor — one inline step (a hook's "Do" binding): Wait (a pause)
 * or Do (one method of one capability of one device, with its arguments).
 *
 * The capability is picked from the device's OWN bindings
 * (`deviceManager.getBindings`), as the admin does — the executor refuses a cap
 * the device does not hold, so a typed one would fail only when the alarm
 * should sound. The method is free text (no method catalogue is reachable from
 * the phone), and the save refuses it blank. When the bindings cannot be read
 * the cap falls back to free text too, and says why.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SegmentedControl, type SegmentOption } from '../../../../../components/ui/SegmentedControl.js'
import { StepperRow } from '../../../../../components/ui/StepperRow.js'
import { SelectRow, type SelectOption } from '../../../../../components/ui/SelectRow.js'
import { capChoices, withStepKind } from '../../../../../components/notifications/rule-action-edit.js'
import type { NcActionStepForm } from '../../../../../components/notifications/rule-action-form.js'
import { NC_ACTION_WAIT_MAX_SEC } from '../../../../../data/notification-center.js'
import { useDeviceBoundCaps } from '../../../../../data/use-device-bound-caps.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { ActionArgRows } from './ActionArgRows.js'
import { ActionDevicePicker } from './ActionDevicePicker.js'
import { ActionLinkButton, ActionTextField } from './action-controls.js'

const UI = 'v2.nc.rules.editor.actions'
const WAIT_STEP_SEC = 5
/** The select's "nothing picked" value — never a real cap name. */
const UNSET = ''

type StepKind = NcActionStepForm['kind']

export interface ActionStepEditorProps {
  /** The line above the step, e.g. "Single action". */
  readonly title: string
  /** The remove control's label. */
  readonly removeLabel: string
  readonly step: NcActionStepForm
  readonly onChange: (next: NcActionStepForm) => void
  readonly onRemove: () => void
}

export function ActionStepEditor({ title, removeLabel, step, onChange, onRemove }: ActionStepEditorProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const set = (next: Partial<NcActionStepForm>): void => onChange({ ...step, ...next })
  const kindOptions: readonly SegmentOption<StepKind>[] = [
    { value: 'wait', label: t(`${UI}.stepKind.wait`) },
    { value: 'cap', label: t(`${UI}.stepKind.cap`) },
  ]

  return (
    <View style={{ gap: SPACING.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg }}>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600' }}>
        {title}
      </Text>
      <SegmentedControl<StepKind> options={kindOptions} value={step.kind} onChange={(kind) => onChange(withStepKind(step, kind))} />
      {step.kind === 'wait' ? (
        <StepperRow
          label={t(`${UI}.waitSecondsLabel`)}
          value={step.seconds}
          min={0}
          max={NC_ACTION_WAIT_MAX_SEC}
          step={WAIT_STEP_SEC}
          onChange={(seconds) => set({ seconds })}
          last
        />
      ) : (
        <CapStepFields step={step} set={set} />
      )}
      <ActionLinkButton kind="remove" label={removeLabel} onPress={onRemove} />
    </View>
  )
}

interface CapStepFieldsProps {
  readonly step: NcActionStepForm
  readonly set: (next: Partial<NcActionStepForm>) => void
}

function CapStepFields({ step, set }: CapStepFieldsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const caps = useDeviceBoundCaps(step.deviceId)
  const hint = (text: string) => <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>{text}</Text>

  const capField = (() => {
    if (step.deviceId === undefined) return hint(t(`${UI}.capPickDeviceFirst`))
    if (caps.isError) {
      return (
        <>
          <ActionTextField
            label={t(`${UI}.capLabel`)}
            value={step.cap}
            onChangeText={(cap) => set({ cap })}
          />
          {hint(t(`${UI}.capUnavailable`))}
        </>
      )
    }
    if (caps.data === undefined) return hint(t(`${UI}.capLoading`))
    const choices = capChoices(caps.data, step.cap)
    if (choices.length === 0) return hint(t(`${UI}.capEmpty`))
    const options: readonly SelectOption<string>[] = [
      { value: UNSET, label: t(`${UI}.capNone`) },
      ...choices.map((cap) => ({ value: cap, label: cap })),
    ]
    return (
      <SelectRow<string>
        label={t(`${UI}.capLabel`)}
        options={options}
        value={step.cap}
        // A different cap has different methods: the old method would be a
        // call that cannot exist. Picking one where none was set (after a
        // device change) keeps the method typed so far.
        onChange={(cap) => set(cap === step.cap ? {} : step.cap === UNSET ? { cap } : { cap, method: '' })}
        last
      />
    )
  })()

  return (
    <View style={{ gap: SPACING.md }}>
      <ActionDevicePicker
        deviceId={step.deviceId}
        // Another device may not bind the same cap; the method is kept for
        // one that does (a second siren of the same model).
        onPick={(deviceId) => set(deviceId === step.deviceId ? {} : { deviceId, cap: UNSET })}
      />
      {capField}
      <ActionTextField
        label={t(`${UI}.methodLabel`)}
        value={step.method}
        onChangeText={(method) => set({ method })}
        placeholder="setState"
        invalid={step.method.trim().length === 0}
      />
      {hint(t(`${UI}.methodHint`))}
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{t(`${UI}.argsLabel`)}</Text>
      {hint(t(`${UI}.argsHint`))}
      <ActionArgRows rows={step.args} onChange={(args) => set({ args })} />
    </View>
  )
}
