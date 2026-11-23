/**
 * AppFrame (web) — the same-origin `<iframe>` the Admin UI is shown in on the
 * hub-served viewer. The session is the browser's own (the hub cookie), so
 * nothing is injected; a viewer that is not on the hub's origin never reaches
 * this component (`planAdminFrame` sends it to a new tab).
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '../theme/theme-provider.js'
import type { AppFrameProps } from './app-frame-types.js'

export function AppFrame({ uri, reloadKey, testID }: AppFrameProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID={testID}>
      {React.createElement('iframe', {
        key: reloadKey,
        src: uri,
        title: 'CamStack',
        style: { flex: 1, width: '100%', height: '100%', border: 0 },
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
