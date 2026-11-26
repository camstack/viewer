/**
 * Settings → Account → Tokens (operator-approved layout, 2026-10-21): the
 * tokens this user minted — label, what each may do, created, expiry
 * (highlighted under three days), last used — a tap opens one to Extend or
 * Revoke, and "New token" mints another.
 *
 * A token is a privilege handoff: whoever holds it acts within its scopes
 * with no further sign-in. The one place that lists them is the place that
 * can take them back. A hub without the token surface (`null`) draws nothing.
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { KeyRound, Plus } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useMe } from '../../../data/use-me.js'
import { useCameras } from '../../../data/use-cameras.js'
import { useTokens } from '../../../data/use-sign-in-methods.js'
import { ownTokens, tokenExpiry, type AccountToken, type TokenPermission } from '../../../data/account-tokens.js'
import { useTokenText, type TokenText } from '../../../components/tokens/token-text.js'
import { NewTokenSheet } from '../../../components/tokens/NewTokenSheet.js'
import { TokenDetailSheet } from '../../../components/tokens/TokenDetailSheet.js'
import { EmptyState, ErrorState } from '../../../components/ui/EmptyState.js'

const VIEWER_PERMISSIONS: readonly TokenPermission[] = ['view', 'view-talk']
const ADMIN_PERMISSIONS: readonly TokenPermission[] = ['view', 'view-talk', 'admin']

export function TokensSection() {
  const { t } = useTranslation()
  const text = useTokenText()
  const { data: me } = useMe()
  const tokens = useTokens()
  const { data: cameras } = useCameras()
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<AccountToken | null>(null)
  // "Expires soon" is judged against the moment the list was opened.
  const [now] = useState(Date.now)
  if (tokens.data === null) return null
  const mine = me !== undefined && tokens.data !== undefined ? ownTokens(tokens.data, me.id) : null
  const cameraChoices = (cameras ?? []).map((c) => ({ id: c.id, name: c.name }))

  return (
    <>
      <Section
        title={t('v2.tokens.title')}
        collapsible
        titleValue={mine !== null && mine.length > 0 ? String(mine.length) : undefined}
        testID="tokens-section"
      >
        {mine === null ? (
          tokens.isError ? (
            <ErrorState fill={false} title={t('v2.tokens.loadFailed')} onRetry={() => { void tokens.refetch() }} />
          ) : (
            <Row icon={KeyRound} label={t('v2.tokens.loading')} />
          )
        ) : mine.length === 0 ? (
          <EmptyState fill={false} icon={KeyRound} title={t('v2.tokens.empty')} />
        ) : (
          mine.map((token) => (
            <TokenRow key={token.id} token={token} now={now} text={text} onPress={() => setOpened(token)} />
          ))
        )}
        <Row icon={Plus} label={t('v2.tokens.new')} onPress={() => setCreating(true)} last />
      </Section>
      <NewTokenSheet
        visible={creating}
        onClose={() => setCreating(false)}
        cameras={cameraChoices}
        permissions={me?.isAdmin === true ? ADMIN_PERMISSIONS : VIEWER_PERMISSIONS}
      />
      <TokenDetailSheet token={opened} onClose={() => setOpened(null)} />
    </>
  )
}

interface TokenRowProps {
  readonly token: AccountToken
  readonly now: number
  readonly text: TokenText
  readonly onPress: () => void
}

function TokenRow({ token, now, text, onPress }: TokenRowProps) {
  const { colors } = useTheme()
  const expiry = tokenExpiry(token, now)
  const warn = expiry === 'soon'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={token.label}
      onPress={onPress}
      testID={`token-row-${token.id}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
        backgroundColor: pressed ? colors.surfaceHover : 'transparent',
        opacity: expiry === 'expired' ? 0.6 : 1,
      })}
    >
      <KeyRound size={18} color={warn ? colors.warning : colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
          {token.label}
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }} numberOfLines={1}>
          {text.scopes(token)}
        </Text>
        <Text style={{ color: warn ? colors.warning : colors.foregroundSubtle, fontSize: 12 }} numberOfLines={2}>
          {text.dates(token, now)}
        </Text>
      </View>
    </Pressable>
  )
}
