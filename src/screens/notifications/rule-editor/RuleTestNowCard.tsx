/**
 * RuleTestNowCard — fire the SAVED rule for real (`nc.testRule`).
 *
 * Distinct from the dry-run in the one way that matters: this DELIVERS, to
 * every target the rule addresses, marked [TEST] — so it asks first, through
 * the app's confirm (a browser dialog is mute on react-native-web). The hub
 * plans the event from the rule's STORED conditions, which is why there is no
 * test for an unsaved rule and why an unsaved edit is not what gets tested.
 *
 * Mounted by the caller for a CONFIRMED admin and a saved rule only.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../../../components/ui/confirm.js'
import { RuleErrorBanner } from '../../../components/notifications/RuleFormFields.js'
import { useNcErrorText } from '../../../components/notifications/use-nc-error-text.js'
import { ruleTestNowLines } from '../../../components/notifications/rule-test-result.js'
import type { NcViewerRule } from '../../../data/notification-center.js'
import { useNcTestRule } from '../../../data/use-nc-rule-test.js'
import { RuleTestCard } from './RuleTestCard.js'
import { RuleTestLines } from './RuleTestLines.js'

export interface RuleTestNowCardProps {
  readonly rule: NcViewerRule
}

export function RuleTestNowCard({ rule }: RuleTestNowCardProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const testRule = useNcTestRule()
  const errorText = useNcErrorText()

  const run = async (): Promise<void> => {
    const ok = await confirm({
      title: t('v2.nc.rules.test.now.confirmTitle'),
      message: t('v2.nc.rules.test.now.confirmBody', { name: rule.name }),
      confirmLabel: t('v2.nc.rules.test.now.confirm'),
    })
    if (!ok) return
    testRule.mutate({ ruleId: rule.id })
  }

  return (
    <RuleTestCard
      title={t('v2.nc.rules.test.now.title')}
      hint={t('v2.nc.rules.test.now.hint')}
      buttonLabel={t('v2.nc.rules.test.now.button')}
      busy={testRule.isPending}
      disabled={false}
      onPress={() => void run()}
    >
      {testRule.error ? (
        <RuleErrorBanner message={t('v2.nc.rules.test.unavailable', { message: errorText(testRule.error) })} />
      ) : null}
      {testRule.data !== undefined ? <RuleTestLines lines={ruleTestNowLines(testRule.data)} /> : null}
    </RuleTestCard>
  )
}
