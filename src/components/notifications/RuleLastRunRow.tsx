/**
 * RuleLastRunRow — the "last run" line under a rule card's title, and the door
 * to that rule's delivery history.
 *
 * The line IS the "History" action: pressing it opens
 * `/notifications/rule/[id]/history`. That keeps the card's ONE action row
 * (Enabled · Edit · Delete) as it is, and it puts the action exactly where the
 * question it answers is asked — "when did this last fire?" → "show me".
 * It exists only for an admin viewer (both reads are admin), so a non-admin's
 * card has neither the line nor the door.
 *
 * What the line may claim is decided by the pure {@link ruleLastRunLine}
 * (D315); this component only draws it.
 */
import React, { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronRight, History } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, type ColorTokens } from '../../theme/tokens.js'
import { capturedLabel } from '../../data/nc-artifact-format.js'
import type { NcHistoryStatus } from '@camstack/types'
import type { RuleLastRunLine } from './rule-last-run.js'

export interface RuleLastRunRowProps {
  readonly ruleId: string
  readonly line: RuleLastRunLine
  /** The list's clock — "5m ago" is measured against it. */
  readonly nowMs: number
  readonly onOpenHistory: () => void
}

/** How often a list of "5m ago" labels is re-measured. */
const CLOCK_MS = 60_000

/**
 * One clock for a whole list of relative times. Read once per list, never per
 * row, so a card re-renders because the minute turned and not on a timer of
 * its own.
 */
export function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_MS)
    return () => clearInterval(id)
  }, [])
  return nowMs
}

/** The colour a delivery's status word is drawn in. */
export function deliveryStatusColor(status: NcHistoryStatus, colors: ColorTokens): string {
  if (status === 'dead') return colors.danger
  if (status === 'pending') return colors.warning
  return colors.success
}

export function RuleLastRunRow({ ruleId, line, nowMs, onOpenHistory }: RuleLastRunRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Pressable
      testID={`rule-history-open-${ruleId}`}
      accessibilityRole="button"
      accessibilityLabel={t('v2.nc.rules.history.action')}
      onPress={onOpenHistory}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        paddingHorizontal: SPACING.xl,
        paddingBottom: SPACING.lg,
        backgroundColor: pressed ? colors.surfaceHover : 'transparent',
      })}
    >
      <View testID={`rule-last-run-${ruleId}`} style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
          {`${t('v2.nc.rules.lastRun.label')}: `}
          <LastRunValue line={line} nowMs={nowMs} />
        </Text>
        {line.kind === 'failed' ? (
          <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>{t(line.hintKey)}</Text>
        ) : null}
      </View>
      <History size={14} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: '600' }}>
        {t('v2.nc.rules.history.action')}
      </Text>
      <ChevronRight size={14} color={colors.foregroundSubtle} />
    </Pressable>
  )
}

interface LastRunValueProps {
  readonly line: RuleLastRunLine
  readonly nowMs: number
}

/** The value after "Last run:" — nothing at all while the read is in flight. */
function LastRunValue({ line, nowMs }: LastRunValueProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (line.kind === 'blank') return null
  if (line.kind === 'failed') return <Text style={{ color: colors.foregroundMuted }}>—</Text>
  if (line.kind === 'absent') {
    return (
      <Text style={{ color: colors.foregroundMuted }}>
        {line.count === undefined ? t(line.key) : t(line.key, { count: line.count })}
      </Text>
    )
  }
  return (
    <Text style={{ color: colors.foregroundMuted }}>
      {`${capturedLabel(line.lastAt, nowMs, t)} · `}
      <Text style={{ color: deliveryStatusColor(line.status, colors), fontWeight: '600' }}>{t(line.statusKey)}</Text>
    </Text>
  )
}
