/**
 * Settings tab — a thin shell over four segments (`settings/settings-segments.ts`):
 * Account, Viewing, App, Advanced. The selector is the Library tab's
 * `ScopeBar`, so the two tabs split into sections read as one control.
 *
 * Each segment is its OWN scroll view and stays mounted once visited (hidden,
 * not unmounted), so switching back lands where the operator left it rather
 * than at the top. A segment never visited is never mounted — the Account
 * segment's share-link list costs nothing to an operator who only opens App.
 *
 * The segment last shown is remembered per device (`device-settings-store`),
 * read straight from the store so a late hydration simply moves the selector.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/theme-provider.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { SCREEN_GUTTER, SPACING } from '../theme/tokens.js'
import { useTabScrollPadding } from '../navigation/bottom-nav-inset.js'
import { ScopeBar } from '../components/ui/ScopeBar.js'
import { useDeviceSettingsStore } from '../store/device-settings-store.js'
import {
  SETTINGS_SEGMENT_ORDER,
  buildSettingsSegments,
  type SettingsSegmentKey,
} from './settings/settings-segments.js'
import { AccountSegment } from './settings/AccountSegment.js'
import { ViewingSegment } from './settings/ViewingSegment.js'
import { AppSegment } from './settings/AppSegment.js'
import { AdvancedSegment } from './settings/AdvancedSegment.js'
import { KeyboardAwareScrollView } from '../components/ui/KeyboardInset.js'

export function SettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const bottomPadding = useTabScrollPadding(SPACING['3xl'])
  const screenActive = useScreenActive()
  const segment = useDeviceSettingsStore((s) => s.settings.settingsSegment)
  const setSegment = useDeviceSettingsStore((s) => s.setSettingsSegment)

  // Segments mounted so far. Grown DURING render (React's "adjust state while
  // rendering" pattern) so the newly selected segment is in the very first
  // commit that shows it — an effect would paint one empty frame first.
  const [visited, setVisited] = useState<ReadonlySet<SettingsSegmentKey>>(() => new Set([segment]))
  if (!visited.has(segment)) setVisited(new Set([...visited, segment]))

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScopeBar options={buildSettingsSegments(t)} value={segment} onChange={setSegment} />
      {SETTINGS_SEGMENT_ORDER.filter((key) => visited.has(key) || key === segment).map((key) => (
        <View
          key={key}
          testID={`settings-segment-${key}`}
          style={{ flex: 1, display: key === segment ? 'flex' : 'none' }}
        >
          <KeyboardAwareScrollView
            contentContainerStyle={{
              paddingHorizontal: SCREEN_GUTTER,
              paddingTop: SPACING.xl,
              paddingBottom: bottomPadding,
              gap: SPACING['2xl'],
            }}
          >
            <SegmentBody segment={key} active={screenActive && key === segment} />
          </KeyboardAwareScrollView>
        </View>
      ))}
    </View>
  )
}

function SegmentBody({ segment, active }: { readonly segment: SettingsSegmentKey; readonly active: boolean }) {
  switch (segment) {
    case 'account':
      return <AccountSegment />
    case 'viewing':
      return <ViewingSegment />
    case 'app':
      return <AppSegment />
    case 'advanced':
      return <AdvancedSegment active={active} />
  }
}
