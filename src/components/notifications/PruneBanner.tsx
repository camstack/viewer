/**
 * "Disabled on <date>: its last device (#id) was deleted."
 *
 * On a rule / timelapse / digest the hub's deleted-device prune switched off
 * (`src/data/nc-prunes.ts` has the why). The picker already shows the kept id
 * as "Device #id — removed"; this line says why the rule is off, so the kept
 * id reads as intentional rather than as a broken rule.
 *
 * Renders NOTHING while pending, on a refused or failed read, for a non-admin,
 * and when there is no such prune — a bonus sentence, never a claim of absence
 * (D315).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNcPrunes } from '../../data/use-notification-center.js'
import { type NcPruneRuleKind, pruneBannerFor } from '../../data/nc-prunes.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

export interface PruneBannerProps {
  readonly kind: NcPruneRuleKind
  readonly ruleId: string
  /** The SAVED rule's switch — the banner is about the rule, not the draft. */
  readonly enabled: boolean
  /** The SAVED rule's `updatedAt` — a rule touched since the prune gets none. */
  readonly updatedAt: number
}

export function PruneBanner({ kind, ruleId, enabled, updatedAt }: PruneBannerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const query = useNcPrunes(!enabled)
  const prune = query.data === undefined ? null : pruneBannerFor(query.data, kind, ruleId, enabled, updatedAt)
  if (prune === null) return null
  const date = new Date(prune.at).toLocaleDateString(locale)
  const key = prune.subjectKind === 'device' ? 'v2.nc.prune.device' : 'v2.nc.prune.target'
  return (
    <View
      testID="nc-prune-banner"
      style={{
        backgroundColor: `${colors.warning}1a`,
        borderColor: colors.warning,
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
        {t(key, { date, id: prune.subject })}
      </Text>
    </View>
  )
}
