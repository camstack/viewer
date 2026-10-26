/**
 * The one place the app says the hub palette could not be read (D939).
 * Mounted once, beside the hub-status pill. Hidden while that pill is the
 * thing the operator needs, and hidden until a read has actually failed —
 * a palette still in flight is the bundled preset with nothing to announce.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useConnection } from '../connection/ConnectionProvider.js'
import { usePalette } from '../data/use-palette.js'
import { useTheme } from '../theme/theme-provider.js'
import { ConnectingIndicator } from './ui/ConnectingIndicator.js'

export function PaletteUnknownNote(): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { state } = useConnection()
  const view = usePalette()
  const reason = view.reason ?? ''
  const visible = state === 'connected' && view.origin === 'unknown' && view.reason !== null
  return (
    <ConnectingIndicator
      visible={visible}
      label={t('v2.palette.unknown', { reason })}
      dotColor={colors.warning}
      pulse={false}
    />
  )
}
