import React, { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useConnection } from '../connection/ConnectionProvider.js'
import {
  HUB_STATUS_GRACE_MS,
  HUB_STATUS_INITIAL,
  HUB_STATUS_RESTORED_MS,
  nextHubStatus,
  visibleHubStatus,
  type HubStatusVisible,
} from '../connection/hub-status.js'
import { useTheme } from '../theme/theme-provider.js'
import type { ColorTokens } from '../theme/tokens.js'
import { ConnectingIndicator } from './ui/ConnectingIndicator.js'

const LABEL_KEY: Readonly<Record<HubStatusVisible, string>> = {
  connecting: 'v2.hubStatus.connecting',
  offline: 'v2.hubStatus.offline',
  restored: 'v2.hubStatus.restored',
}

function dotColorFor(phase: HubStatusVisible, colors: ColorTokens): string {
  if (phase === 'offline') return colors.danger
  if (phase === 'restored') return colors.success
  return colors.primary
}

/**
 * THE hub-connection status of the app — mounted ONCE, at the root of the
 * signed-in tree (`app/(app)/_layout.tsx`), after the navigator so it floats
 * over every route. Screens never render a connection state of their own:
 * they keep what they already have on screen and this pill says why it is
 * not updating. A camera's OWN stream state (the live view's connecting /
 * failed) is a different fact and stays with the player.
 *
 * States and timing live in the pure `hub-status.ts`: nothing during a grace
 * period (a normal cold start or resume connects inside it), then
 * "Connecting…", "Hub unreachable" with Retry, and a short "Back online".
 */
export function HubConnectionOverlay(): React.JSX.Element {
  const { t } = useTranslation()
  const { controller, state, startingUp } = useConnection()
  const { colors } = useTheme()
  const [status, dispatch] = useReducer(nextHubStatus, HUB_STATUS_INITIAL)

  useEffect(() => {
    dispatch({ type: 'connection', state, startingUp })
  }, [state, startingUp])

  useEffect(() => {
    if (status.phase === 'waiting') {
      const timer = setTimeout(() => dispatch({ type: 'graceElapsed' }), HUB_STATUS_GRACE_MS)
      return () => clearTimeout(timer)
    }
    if (status.phase === 'restored') {
      const timer = setTimeout(() => dispatch({ type: 'restoredElapsed' }), HUB_STATUS_RESTORED_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [status.phase])

  const visible = visibleHubStatus(status)
  // Keep the last words while the pill animates out, so it never blanks.
  const shown = visible ?? 'restored'
  return (
    <ConnectingIndicator
      visible={visible !== null}
      label={t(LABEL_KEY[shown])}
      dotColor={dotColorFor(shown, colors)}
      pulse={shown === 'connecting'}
      action={
        shown === 'offline'
          ? { label: t('v2.hubStatus.retry'), onPress: () => controller.retryNow(), testID: 'hub-status-retry' }
          : undefined
      }
    />
  )
}
