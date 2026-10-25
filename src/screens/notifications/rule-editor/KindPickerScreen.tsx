/**
 * KindPickerScreen — `/rule/new`: a new rule picks its KIND first.
 *
 * The kind is the unit (see `rule-kind-nav.ts`): the editor it opens offers
 * only that kind's sections and conditions. The three system-event families
 * are offered to an admin only, and `mixed` to nobody (D637). `replace`, not `push`, so back from the editor returns to the
 * list rather than to this picker.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { ChevronRight } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import { creatableKinds, kindLabelKey } from '../../../components/notifications/rule-kind-nav.js'
import { kindBlurbKey } from '../../../components/notifications/rule-editor-sections.js'
import { ruleHref } from '../../../navigation/rule-routes.js'
import { EditorNotice } from './EditorNotice.js'
import { EditorScroll } from './EditorScroll.js'

export function KindPickerScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  // Wait for the answer: an unanswered `auth.me` is not "not an admin" (D315).
  const verdict = useAdminVerdict()

  return (
    <EditorScroll title={t('v2.nc.rules.kindPicker.title')} onBack={() => router.back()}>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 14, paddingHorizontal: SPACING.xs }}>
        {t('v2.nc.rules.kindPicker.subtitle')}
      </Text>
      {verdict === 'pending' ? (
        <EditorNotice />
      ) : (
        <View style={{ borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {creatableKinds(verdict === 'admin').map((kind, index) => {
            const blurb = t(kindBlurbKey(kind), { defaultValue: '' })
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => router.replace(ruleHref('new', kind))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SPACING.md,
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
                    {t(kindLabelKey(kind))}
                  </Text>
                  {blurb.length > 0 ? (
                    <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>{blurb}</Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={colors.foregroundSubtle} />
              </Pressable>
            )
          })}
        </View>
      )}
    </EditorScroll>
  )
}
