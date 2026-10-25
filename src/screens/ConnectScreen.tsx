/**
 * `/connect?hub=<origin>` — the link that adds or opens a hub.
 *
 * Lives OUTSIDE the `(app)` auth group, so it renders while logged out and
 * survives its own login: the sign-in it shows saves the server, the decision
 * then reads `active`, and the screen moves on to the cameras.
 *
 * A link offers; it never replaces (`hub-link.ts`). An already-saved hub asks
 * before switching; an unknown one opens the login prefilled — and the login
 * is itself the confirmation, because nothing changes until the operator signs
 * in.
 */
import React from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useServer } from '../app/ServerProvider.js'
import { decideHubLink, hubParamOf } from '../connection/hub-link.js'
import { sameHubOrigin } from '../connection/hub-origin.js'
import { serverLabelForUrl, serverLabelOf } from '../connection/server-name.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import type { ColorTokens } from '../theme/tokens.js'
import { BrandLogo } from '../theme/brand-logo.js'
import { LoginScreen } from './LoginScreen.js'

/** Where "stay" and "continue" land: the auth gate, which knows whether that
 *  is the cameras or the login. */
const HOME_HREF = '/'

export function ConnectScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const params = useLocalSearchParams<Record<string, string | string[]>>()
  const { loading, servers, server, token, switchServer } = useServer()

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  const hub = hubParamOf(params)
  const signedIn = server !== null && token !== null
  const decision = decideHubLink({
    hub,
    servers,
    activeServerId: signedIn ? server.id : null,
  })

  if (decision.kind === 'active') return <Redirect href="/cameras" />

  if (decision.kind === 'invalid') {
    return (
      <ConnectCard
        colors={colors}
        title={t('v2.connect.invalidTitle')}
        body={t('v2.connect.invalidBody')}
        primaryLabel={t('v2.connect.continue')}
        onPrimary={() => router.replace(HOME_HREF)}
      />
    )
  }

  if (decision.kind === 'switch') {
    const name = serverLabelForUrl(servers, decision.serverUrl)
    const body = signedIn
      ? t('v2.connect.switchBody', { current: serverLabelOf(server) })
      : t('v2.connect.switchBodyNoCurrent')
    return (
      <ConnectCard
        colors={colors}
        title={t('v2.connect.switchTitle', { name })}
        body={body}
        primaryLabel={t('v2.connect.switch')}
        onPrimary={() => {
          void switchServer(decision.serverId).then((outcome) => {
            // `needs-login` re-renders this screen as the prefilled login.
            if (outcome.status === 'switched' || outcome.status === 'already-active') {
              router.replace('/cameras')
            }
          })
        }}
        secondaryLabel={t('v2.connect.stay')}
        onSecondary={() => router.replace(HOME_HREF)}
      />
    )
  }

  const known = servers.some((s) => sameHubOrigin(s.serverUrl, decision.serverUrl))
  const name = serverLabelForUrl(servers, decision.serverUrl)
  return (
    <LoginScreen
      key={decision.serverUrl}
      initialServerUrl={decision.serverUrl}
      {...(known ? {} : { heading: t('v2.connect.addTitle', { name }) })}
      {...(signedIn ? { subheading: t('v2.connect.addBody') } : {})}
      {...(signedIn ? { onCancel: () => router.replace(HOME_HREF) } : {})}
    />
  )
}

interface ConnectCardProps {
  readonly colors: ColorTokens
  readonly title: string
  readonly body: string
  readonly primaryLabel: string
  readonly onPrimary: () => void
  readonly secondaryLabel?: string
  readonly onSecondary?: () => void
}

function ConnectCard({
  colors,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: ConnectCardProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING['2xl'] }}
    >
      <View style={{ width: '100%', maxWidth: 420, gap: SPACING['2xl'] }}>
        <View style={{ alignItems: 'center' }}>
          <BrandLogo width={220} />
        </View>
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.lg,
            padding: SPACING['2xl'],
            gap: SPACING.xl,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{body}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onPrimary}
            style={{
              backgroundColor: colors.primary,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.lg,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>{primaryLabel}</Text>
          </Pressable>
          {secondaryLabel !== undefined && onSecondary !== undefined && (
            <Pressable accessibilityRole="button" onPress={onSecondary} style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{secondaryLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScrollView>
  )
}
