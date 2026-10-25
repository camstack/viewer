/**
 * EmbedWarmup — one-shot hidden WebView that pre-warms the live player.
 *
 * Measured cold-start breakdowns put the FIRST camera open behind later ones
 * because WKWebView must spin up and parse the embed application. Loading the
 * OTA-bundled player once, invisibly, as soon as the persisted server is known
 * moves both costs off the user's first tap.
 *
 * It does NOT wait for the WebSocket: it reads `ServerProvider`, not
 * `ConnectionProvider`, so it starts during the connection handshake rather
 * than after it.
 *
 * The page is loaded WITHOUT an injected config: it just sits in its config
 * handshake (it never reaches signaling), and we unmount the WebView as soon
 * as the load settles — nothing stays resident.
 */
import React, { useState } from 'react'
import { Platform, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { log } from '../lib/logger.js'
import { markBoot } from '../connection/boot-timeline.js'
import { useServer } from './ServerProvider.js'
import { useNativeEmbedSource } from '../live/use-native-embed-source.js'

export function EmbedWarmup() {
  const { server } = useServer()
  const [done, setDone] = useState(false)
  const serverUrl = server?.serverUrl ?? null
  const { source, readAccessUri, reportLoadFailure } = useNativeEmbedSource(serverUrl, 'player')
  // Web renders the embed in an iframe with its own cache semantics — nothing
  // to warm. Native-only, once per server connect.
  if (done || source === null || Platform.OS === 'web') return null
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: -10, top: -10, width: 1, height: 1, opacity: 0 }}
    >
      <WebView
        source={source}
        {...(readAccessUri === null ? {} : { allowingReadAccessToURL: readAccessUri })}
        javaScriptEnabled
        onLoadEnd={() => {
          log.info('live:warmup', 'embed player pre-warmed')
          markBoot('embedLoaded', { via: 'local-warmup' })
          setDone(true)
        }}
        onError={() => {
          // The warm-up is the first thing that ever loads the embed, so it is
          // where a WebView that cannot read the local file says so first.
          reportLoadFailure()
          setDone(true)
        }}
      />
    </View>
  )
}
