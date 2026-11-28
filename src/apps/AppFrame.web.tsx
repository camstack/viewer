/**
 * AppFrame (web) — the same-origin `<iframe>` an embedded app is shown in on the
 * hub-served viewer. The session is the browser's own (the hub cookie), so
 * nothing is injected; a viewer that is not on the hub's origin never reaches
 * this component (`planAdminFrame` sends it to a new tab).
 *
 * The page talks to the shell over `postMessage` (the `app-bridge` envelope,
 * `bridge-host.ts`): only a message from THIS frame's window, from the frame's
 * own origin, is passed on.
 */
import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '../theme/theme-provider.js'
import { frameOriginOf, type AppFrameProps } from './app-frame-types.js'
import { bridgeChannel } from './bridge-channel.js'
import { frameController } from './frame-controller.js'
import { goBackInFrame } from './frame-back.js'

export function AppFrame({ uri, reloadKey, testID, onAppMessage, onFrameLoad }: AppFrameProps): React.JSX.Element {
  const { colors } = useTheme()
  const frame = useRef<HTMLIFrameElement | null>(null)
  const origin = frameOriginOf(uri)
  const onMessage = useRef(onAppMessage)
  onMessage.current = onAppMessage

  useEffect(() => {
    if (origin === null) return undefined
    const listener = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      onMessage.current?.(event.data)
    }
    window.addEventListener('message', listener)
    const release = bridgeChannel.attach((message) => frame.current?.contentWindow?.postMessage(message, origin))
    const releaseBack = frameController.attach(({ navigatedSinceLoad }) => goBackInFrame(frame.current?.contentWindow ?? null, navigatedSinceLoad))
    return () => {
      window.removeEventListener('message', listener)
      release()
      releaseBack()
    }
  }, [origin])

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID={testID}>
      {React.createElement('iframe', {
        key: reloadKey,
        ref: frame,
        src: uri,
        title: 'Dominevo',
        onLoad: () => onFrameLoad?.(),
        style: { flex: 1, width: '100%', height: '100%', border: 0 },
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
