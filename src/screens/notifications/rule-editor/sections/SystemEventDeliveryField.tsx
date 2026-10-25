/**
 * SystemEventDeliveryField — the Delivery control of a `device-events` /
 * `system` rule (D647): Instant (a notification per event) or Summary (the
 * current state of the rule's kinds, at set times; nothing sent when there is
 * nothing to report).
 *
 * The admin's `NotificationSystemEventDelivery.tsx`, on the phone: the same two
 * choices, the same default (every day at 08:00), the same guards — a summary
 * keeps at least one send time and every send time at least one day — and a
 * stored schedule that is not a list of send times is shown as its windows,
 * with the rule it follows said out loud. The pure half is
 * `system-event-delivery.ts`. Rendered for nothing else: the alarm stays
 * instant and a `mixed` rule is read-only.
 */
import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from '../../../../lib/icons.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { Section } from '../../../../components/ui/Section.js'
import { SegmentedControl, type SegmentOption } from '../../../../components/ui/SegmentedControl.js'
import { ScheduleField } from '../../../../components/notifications/ConditionField.js'
import {
  defaultSummaryDelivery,
  hhmmOfMinute,
  minuteOfHhmm,
  NC_SUMMARY_DEFAULT_SEND_TIME,
  NC_SUMMARY_WEEKDAYS,
  scheduleForSendTimes,
  sendTimesOfSchedule,
  summarySplitOf,
  withSummarySchedule,
  withSummarySplit,
  type NcSummaryDelivery,
  type NcSummarySendTime,
} from '../../../../components/notifications/system-event-delivery.js'
import type {
  NcStateSummarySplit,
  NcSystemEventDelivery,
  NcSystemEventDeliveryMode,
} from '../../../../data/notification-center.js'
import { Hint } from './SectionHint.js'

const KEY = 'v2.nc.rules.editor.systemDelivery'

export interface SystemEventDeliveryFieldProps {
  readonly value: NcSystemEventDelivery | undefined
  readonly onChange: (next: NcSystemEventDelivery) => void
}

export function SystemEventDeliveryField({ value, onChange }: SystemEventDeliveryFieldProps) {
  const { t } = useTranslation()
  const summary = value?.mode === 'summary' ? value : null
  const options: readonly SegmentOption<NcSystemEventDeliveryMode>[] = [
    { value: 'instant', label: t(`${KEY}.instant`) },
    { value: 'summary', label: t(`${KEY}.summary`) },
  ]
  const choose = (mode: NcSystemEventDeliveryMode): void => {
    if (mode === (summary === null ? 'instant' : 'summary')) return
    onChange(mode === 'summary' ? defaultSummaryDelivery() : { mode: 'instant' })
  }
  return (
    <Section title={t(`${KEY}.label`)}>
      <View testID="rule-delivery" style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.md }}>
        <SegmentedControl<NcSystemEventDeliveryMode>
          options={options}
          value={summary === null ? 'instant' : 'summary'}
          onChange={choose}
        />
      </View>
      {summary === null ? (
        <Hint text={t(`${KEY}.instantHint`)} last />
      ) : (
        <SummarySchedule value={summary} onChange={onChange} />
      )}
    </Section>
  )
}

interface SummaryScheduleProps {
  readonly value: NcSummaryDelivery
  readonly onChange: (next: NcSystemEventDelivery) => void
}

function SummarySchedule({ value, onChange }: SummaryScheduleProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const times = sendTimesOfSchedule(value.schedule)
  const timezone = value.schedule.timezone
  const commit = (next: readonly NcSummarySendTime[]): void => {
    if (next.length === 0) return // a summary needs at least one send time
    onChange(withSummarySchedule(value, scheduleForSendTimes(next, timezone)))
  }
  // One message, or one notification per category (D698).
  const splitOptions: readonly SegmentOption<NcStateSummarySplit>[] = [
    { value: 'rule', label: t(`${KEY}.splitRule`) },
    { value: 'section', label: t(`${KEY}.splitSection`) },
  ]
  return (
    <View style={{ gap: SPACING.sm, paddingBottom: SPACING.lg }}>
      <Hint text={t(`${KEY}.summaryHint`)} />
      {times === null ? (
        <View testID="rule-delivery-custom" style={{ gap: SPACING.sm, paddingHorizontal: SPACING.xl }}>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>
            {t(`${KEY}.customSchedule`)}
          </Text>
          <ScheduleField
            value={value.schedule}
            onChange={(next) => {
              // Removing the last window would leave a summary never sent.
              if (next !== undefined) onChange(withSummarySchedule(value, next))
            }}
          />
        </View>
      ) : (
        <View style={{ gap: SPACING.sm, paddingHorizontal: SPACING.xl }}>
          {times.map((time, index) => (
            <SendTimeRow
              // Keyed on the value, so a refused entry snaps back to it.
              key={`${String(index)}:${String(time.minute)}`}
              index={index}
              time={time}
              onChange={(next) => commit(times.map((other, i) => (i === index ? next : other)))}
              onRemove={times.length > 1 ? () => commit(times.filter((_, i) => i !== index)) : undefined}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            testID="rule-delivery-add-time"
            onPress={() => commit([...times, NC_SUMMARY_DEFAULT_SEND_TIME])}
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACING.xs,
              paddingVertical: SPACING.sm,
              paddingHorizontal: SPACING.md,
              borderRadius: RADIUS.md,
              backgroundColor: colors.surfaceHover,
            }}
          >
            <Plus size={14} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, fontWeight: '600' }}>
              {t(`${KEY}.addTime`)}
            </Text>
          </Pressable>
        </View>
      )}
      <View testID="rule-delivery-split" style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm }}>
        <SegmentedControl<NcStateSummarySplit>
          options={splitOptions}
          value={summarySplitOf(value)}
          onChange={(split) => {
            if (split !== summarySplitOf(value)) onChange(withSummarySplit(value, split))
          }}
        />
      </View>
      <Hint text={t(`${KEY}.splitHint`)} last />
    </View>
  )
}

interface SendTimeRowProps {
  readonly time: NcSummarySendTime
  readonly index: number
  readonly onChange: (next: NcSummarySendTime) => void
  readonly onRemove: (() => void) | undefined
}

function SendTimeRow({ time, index, onChange, onRemove }: SendTimeRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [text, setText] = useState(() => hhmmOfMinute(time.minute))
  const commitText = (): void => {
    const minute = minuteOfHhmm(text)
    // Not a time: back to the stored one, never a guessed 00:00.
    if (minute === null) setText(hhmmOfMinute(time.minute))
    else if (minute !== time.minute) onChange({ ...time, minute })
  }
  const toggleDay = (day: number): void => {
    const days = time.days.includes(day) ? time.days.filter((d) => d !== day) : [...time.days, day]
    if (days.length === 0) return // a send time needs at least one day
    onChange({ ...time, days })
  }
  return (
    <View
      testID={`rule-delivery-time-${String(index)}`}
      style={{ gap: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.md, padding: SPACING.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>{t(`${KEY}.sendAt`)}</Text>
        <TextInput
          testID={`rule-delivery-time-input-${String(index)}`}
          value={text}
          onChangeText={setText}
          onEndEditing={commitText}
          onBlur={commitText}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="HH:MM"
          placeholderTextColor={colors.foregroundSubtle}
          style={{
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm,
            fontSize: 15,
            minWidth: 68,
            textAlign: 'center',
          }}
        />
        <View style={{ flex: 1 }} />
        {onRemove !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${KEY}.removeTime`)}
            onPress={onRemove}
            hitSlop={6}
          >
            <Trash2 size={16} color={colors.danger} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {NC_SUMMARY_WEEKDAYS.map((d) => {
          const on = time.days.includes(d.value)
          return (
            <Pressable
              key={d.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggleDay(d.value)}
              style={{
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                borderRadius: RADIUS.sm,
                backgroundColor: on ? colors.primary : colors.surfaceHover,
              }}
            >
              <Text style={{ color: on ? colors.primaryForeground : colors.foregroundSubtle, fontSize: 11, fontWeight: '600' }}>
                {t(d.labelKey)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
