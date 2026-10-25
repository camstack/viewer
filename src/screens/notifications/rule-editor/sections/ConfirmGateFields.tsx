/**
 * ConfirmGateFields — the AI confirm gate (`NcRule.confirm`): a vision model
 * judges the picture about to ship, and the notification fires only if it
 * agrees.
 *
 * The configuration is drawn only while the gate is ON, but switching it off
 * keeps what was written — `formToConfirm` writes a paused gate back whole, so
 * an admin pausing it does not lose the prompt.
 *
 * The profile list is D315-honest: `isError` (an older hub, or no vision
 * consumer) reads as "cannot tell", never as the empty list.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../components/ui/Section.js'
import { SelectRow, type SelectOption } from '../../../../components/ui/SelectRow.js'
import { StepperRow } from '../../../../components/ui/StepperRow.js'
import { ToggleRow } from '../../../../components/ui/ToggleRow.js'
import { LabeledInput } from '../../../../components/notifications/RuleFormFields.js'
import { ruleAiProfileLabel } from '../../../../components/notifications/rule-ai-form.js'
import type { NcConfirmFormState, NcConfirmOnTimeout } from '../../../../components/notifications/rule-confirm-form.js'
import { NC_CONFIRM_OPS, parseConfirmOp } from '../../../../components/notifications/rule-field-choices.js'
import {
  NC_CONFIRM_MAX_TIMEOUT_MS,
  NC_CONFIRM_MIN_TIMEOUT_MS,
} from '../../../../data/notification-center.js'
import { useNcAiProfiles } from '../../../../data/use-notification-center.js'
import { Hint } from './SectionHint.js'

const CONFIRM = 'v2.nc.rules.editor.confirm'
/** The "unset" value of the two selects that can be unset — never a real id or op. */
const UNSET = ''
const MS_PER_SEC = 1_000
/** A new expectation starts at "at least one". */
const NEW_EXPECT_COUNT = 1
const COUNT_MAX = 1_000
const ON_TIMEOUT_VALUES: readonly NcConfirmOnTimeout[] = ['fire', 'suppress']

export interface ConfirmGateFieldsProps {
  readonly confirm: NcConfirmFormState
  readonly onChange: (next: NcConfirmFormState) => void
}

export function ConfirmGateFields({ confirm, onChange }: ConfirmGateFieldsProps) {
  const { t } = useTranslation()
  const profilesQuery = useNcAiProfiles()
  const set = (next: Partial<NcConfirmFormState>): void => onChange({ ...confirm, ...next })

  const profiles = profilesQuery.data ?? []
  const storedProfileMissing =
    confirm.profileId !== undefined && !profiles.some((p) => p.id === confirm.profileId)
  const profileOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${CONFIRM}.profileDefault`) },
    ...profiles.map((p) => ({ value: p.id, label: ruleAiProfileLabel(p) })),
    // A pinned profile the list does not carry still shows — as its id.
    ...(storedProfileMissing && confirm.profileId !== undefined
      ? [{ value: confirm.profileId, label: confirm.profileId }]
      : []),
  ]
  const opOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${CONFIRM}.expectNone`) },
    ...NC_CONFIRM_OPS.map((op) => ({ value: op, label: op })),
  ]
  const onTimeoutOptions: readonly SelectOption<NcConfirmOnTimeout>[] = ON_TIMEOUT_VALUES.map((value) => ({
    value,
    label: t(`${CONFIRM}.onTimeout.${value}`),
  }))

  return (
    <Section title={t(`${CONFIRM}.title`)}>
      <ToggleRow
        label={t(`${CONFIRM}.enabledLabel`)}
        description={t(`${CONFIRM}.enabledHint`)}
        value={confirm.enabled}
        onValueChange={(next) => set({ enabled: next })}
        last={!confirm.enabled}
      />
      {confirm.enabled ? (
        <>
          <SelectRow<string>
            label={t(`${CONFIRM}.profileLabel`)}
            options={profileOptions}
            value={confirm.profileId ?? UNSET}
            onChange={(next) => set({ profileId: next === UNSET ? undefined : next })}
          />
          {profilesQuery.isError ? <Hint text={t(`${CONFIRM}.profilesUnavailable`)} /> : null}
          <LabeledInput
            label={t(`${CONFIRM}.promptLabel`)}
            value={confirm.prompt}
            onChangeText={(next) => set({ prompt: next })}
            placeholder={t(`${CONFIRM}.promptPlaceholder`)}
            multiline
          />
          <SelectRow<string>
            label={t(`${CONFIRM}.expectLabel`)}
            options={opOptions}
            value={confirm.expect?.op ?? UNSET}
            onChange={(next) => {
              const op = parseConfirmOp(next)
              set({
                expect:
                  op === undefined ? undefined : { op, count: confirm.expect?.count ?? NEW_EXPECT_COUNT },
              })
            }}
          />
          {confirm.expect !== undefined ? (
            <StepperRow
              label={t(`${CONFIRM}.countLabel`)}
              value={confirm.expect.count}
              min={0}
              max={COUNT_MAX}
              onChange={(next) =>
                set({ expect: confirm.expect !== undefined ? { ...confirm.expect, count: next } : undefined })
              }
            />
          ) : null}
          <StepperRow
            label={t(`${CONFIRM}.timeoutLabel`)}
            value={Math.round(confirm.timeoutMs / MS_PER_SEC)}
            min={NC_CONFIRM_MIN_TIMEOUT_MS / MS_PER_SEC}
            max={NC_CONFIRM_MAX_TIMEOUT_MS / MS_PER_SEC}
            onChange={(next) => set({ timeoutMs: next * MS_PER_SEC })}
          />
          <SelectRow<NcConfirmOnTimeout>
            label={t(`${CONFIRM}.onTimeoutLabel`)}
            options={onTimeoutOptions}
            value={confirm.onTimeout}
            onChange={(next) => set({ onTimeout: next })}
          />
          <Hint text={t(`${CONFIRM}.onTimeoutHint`)} last />
        </>
      ) : null}
    </Section>
  )
}
