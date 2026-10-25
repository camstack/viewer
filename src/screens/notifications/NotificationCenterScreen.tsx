/**
 * NotificationCenterScreen — the hub for the user's notifications. Reached two
 * ways: as a bottom-bar tab (after Library), and as a stacked alias at
 * `/settings/notifications` so an old bookmark does not 404.
 *
 * Laid out like the other tabs split into sections (Library, Settings): the
 * glass `ScopeBar` on top, one scroll per section under it, the shared
 * `SCREEN_GUTTER` (operator, 2026-10-23: "la pagina notifiche deve essere
 * allineata allo stile glass"). The sections (`nc-tabs.ts`):
 *
 *   • Rules   — admin/global rules (read-only) + the caller's personal rules.
 *   • Targets — the caller's own delivery destinations.
 *   • Snooze  — what is silenced right now, and the control to silence more.
 *   • Alarm   — a CONFIRMED admin only: the alarm panel's configuration
 *               (`AlarmSettingsSection`). It used to be an entry row above the
 *               selector pushing `/settings/alarm`; that route stays for the
 *               links that open it directly.
 *
 * Each section stays mounted once visited (hidden, not unmounted), as the
 * Settings tab does: switching back lands where the operator left it, and an
 * unsaved alarm draft is not thrown away by a look at Rules.
 *
 * Rules is the default section. All server access goes through the `useNc*`
 * hooks — this shell owns navigation and section state only.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useTheme } from '../../theme/theme-provider.js'
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { ScopeBar } from '../../components/ui/ScopeBar.js'
import { useAdminVerdict } from '../../data/use-me.js'
import { SCREEN_GUTTER, SPACING } from '../../theme/tokens.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { RulesTab } from './RulesTab.js'
import { SnoozeTab } from './SnoozeTab.js'
import { TargetsTab } from './TargetsTab.js'
import { AlarmSettingsSection } from './AlarmSettingsScreen.js'
import { buildNcTabs, DEFAULT_NC_TAB, ncTabsFor, visibleNcTab, type NcTabKey } from './nc-tabs.js'
import { KeyboardAwareScrollView } from '../../components/ui/KeyboardInset.js'

interface NotificationCenterScreenProps {
  /**
   * Rendered as the Notifications tab rather than the stacked
   * `/settings/notifications` route. The tab has no app bar — the `ScopeBar`
   * carries the safe-area inset, as on Library and Settings. The stacked alias
   * has somewhere to go BACK to, so it keeps a `ScreenHeader` with the
   * selector under it.
   */
  readonly embedded?: boolean
}

export function NotificationCenterScreen({ embedded = false }: NotificationCenterScreenProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const bottomPadding = useTabScrollPadding(SPACING['3xl'])
  const verdict = useAdminVerdict()
  const [selected, setSelected] = useState<NcTabKey>(DEFAULT_NC_TAB)
  const tab = visibleNcTab(selected, verdict)

  // Sections mounted so far. Grown DURING render (React's "adjust state while
  // rendering" pattern) so the newly selected section is in the very first
  // commit that shows it — an effect would paint one empty frame first.
  const [visited, setVisited] = useState<ReadonlySet<NcTabKey>>(() => new Set([tab]))
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]))

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {embedded ? null : <ScreenHeader title={t('v2.nc.title')} onBack={() => router.back()} />}
      <ScopeBar options={buildNcTabs(t, verdict)} value={tab} onChange={setSelected} safeArea={embedded} />

      {ncTabsFor(verdict)
        .filter((key) => visited.has(key) || key === tab)
        .map((key) => (
          <View key={key} testID={`nc-section-${key}`} style={{ flex: 1, display: key === tab ? 'flex' : 'none' }}>
            {/* `handled`: a template variable chip and the alarm's delay
                fields must take the FIRST tap while the keyboard is up — not
                spend it dismissing the keyboard. */}
            <KeyboardAwareScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: SCREEN_GUTTER,
                paddingTop: SPACING.xl,
                paddingBottom: bottomPadding,
                gap: SPACING.xl,
              }}
            >
              <SectionBody section={key} />
            </KeyboardAwareScrollView>
          </View>
        ))}
    </View>
  )
}

function SectionBody({ section }: { readonly section: NcTabKey }) {
  switch (section) {
    case 'rules':
      return <RulesTab />
    case 'targets':
      return <TargetsTab />
    case 'snooze':
      return <SnoozeTab />
    case 'alarm':
      return <AlarmSettingsSection guardLeave={false} />
  }
}
