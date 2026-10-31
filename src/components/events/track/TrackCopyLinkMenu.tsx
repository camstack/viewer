/**
 * TrackCopyLinkMenu — the choice behind "Copy link" on the track detail:
 * the app link (opens the CamStack app) or the public link (the hub's public
 * web viewer). The public entry is disabled with its reason when the hub has no
 * public address, and says it is checking while the hub has not answered.
 */
import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Globe, Smartphone } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useHubPublicEndpoint } from '../../../data/use-hub-public-endpoint.js'
import { AnchoredMenu } from '../../ui/AnchoredMenu.js'
import type { AnchorRect } from '../../ui/dropdown-placement.js'
import { MenuRow } from '../../ui/MenuRow.js'

export const TRACK_COPY_APP_LINK_TEST_ID = 'track-copy-app-link'
export const TRACK_COPY_PUBLIC_LINK_TEST_ID = 'track-copy-public-link'

const MENU_WIDTH = 260
const MENU_HEIGHT = 2 * 48 + 8

export interface TrackCopyLinkMenuProps {
  readonly visible: boolean
  readonly anchor: AnchorRect | null
  readonly onClose: () => void
  readonly onCopyApp: () => void
  /** Receives the hub's public address. */
  readonly onCopyPublic: (publicEndpoint: string) => void
}

export function TrackCopyLinkMenu(props: TrackCopyLinkMenuProps): React.JSX.Element | null {
  if (!props.visible) return null
  return <OpenMenu {...props} />
}

function OpenMenu({ anchor, onClose, onCopyApp, onCopyPublic }: TrackCopyLinkMenuProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const endpoint = useHubPublicEndpoint(true)
  const reason =
    endpoint.status === 'pending'
      ? t('v2.tracks.publicLinkPending', 'Checking…')
      : endpoint.status === 'absent'
        ? t('v2.tracks.publicLinkAbsent', 'No public address set on the hub')
        : null
  return (
    <AnchoredMenu visible onRequestClose={onClose} anchor={anchor} width={MENU_WIDTH} estimatedHeight={MENU_HEIGHT}>
      <MenuRow
        testID={TRACK_COPY_APP_LINK_TEST_ID}
        icon={Smartphone}
        label={t('v2.tracks.appLink', 'App link')}
        onPress={onCopyApp}
      />
      <MenuRow
        testID={TRACK_COPY_PUBLIC_LINK_TEST_ID}
        icon={Globe}
        label={t('v2.tracks.publicLink', 'Public link')}
        disabled={endpoint.status !== 'present'}
        onPress={() => {
          if (endpoint.status === 'present') onCopyPublic(endpoint.url)
        }}
      />
      {reason !== null ? (
        <Text style={[styles.reason, { color: colors.foregroundSubtle }]}>{reason}</Text>
      ) : null}
    </AnchoredMenu>
  )
}

const styles = StyleSheet.create({
  reason: { fontSize: 12, paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
})
