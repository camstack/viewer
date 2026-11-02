/**
 * FirstConnectOverlay — the screen behind is dimmed and a centred card says
 * "Connecting to <server>…" while the app connects for the first time.
 *
 * Mounted once under `ConnectionProvider` (which is keyed by server), so a
 * server switch is a new initial connection. It never returns after the first
 * `connected`: later reconnects keep the `HubConnectionOverlay` pill. After
 * 10 s it adds Retry and Change server (the Settings server list); the spinner
 * stays. The first 300 ms paint nothing, so a quick connect is never flashed.
 */
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { useServer } from '../app/ServerProvider.js'
import { serverDisplayName } from '../connection/hub-origin.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { firstConnectPhase } from '../connection/first-connect.js'
import { serverLabelOf } from '../connection/server-name.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { Button } from './ui/Button.js'
import { SheetModal } from './ui/SheetModal.js'

const TICKS_MS = [300, 10_000] as const
const SETTINGS_HREF = '/settings'

export function FirstConnectOverlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { controller, state } = useConnection()
  const { server } = useServer()
  const [hasConnected, setHasConnected] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (state === 'connected') setHasConnected(true)
  }, [state])

  // Two timers from mount — the paint delay and the "stuck" mark — and none
  // once connected.
  useEffect(() => {
    if (hasConnected) return undefined
    const start = Date.now()
    const timers = TICKS_MS.map((ms) => setTimeout(() => setElapsedMs(Math.max(ms, Date.now() - start)), ms))
    return () => timers.forEach(clearTimeout)
  }, [hasConnected])

  const phase = firstConnectPhase({ hasConnected, dismissed, elapsedMs })
  if (hasConnected) return null

  const name =
    server === null
      ? ''
      : server.name !== undefined
        ? serverLabelOf(server)
        : server.label !== ''
          ? server.label
          : serverDisplayName(server.serverUrl)
  const label = t('v2.firstConnect.connecting', { name })

  const changeServer = (): void => {
    setDismissed(true)
    router.push(SETTINGS_HREF)
  }

  return (
    <SheetModal
      centered
      visible={phase !== 'hidden'}
      onClose={() => undefined}
      onBackdropPress={() => undefined}
      testID="first-connect-card"
      sheetStyle={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
    >
      <View accessibilityRole="alert" accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.body}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.text, { color: colors.foreground }]}>{label}</Text>
        {phase === 'stuck' ? (
          <View style={styles.actions}>
            <Button label={t('v2.firstConnect.retry')} kind="secondary" grow onPress={() => controller.retryNow()} testID="first-connect-retry" />
            <Button label={t('v2.firstConnect.changeServer')} grow onPress={changeServer} testID="first-connect-change-server" />
          </View>
        ) : null}
      </View>
    </SheetModal>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.xl, padding: SPACING['2xl'] },
  body: { alignItems: 'center', gap: SPACING.xl },
  text: { fontSize: TYPOGRAPHY.size.lg, fontWeight: '600', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: SPACING.md, alignSelf: 'stretch' },
})
