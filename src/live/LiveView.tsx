/**
 * LiveView — the camera live player (native targets).
 *
 * The player is the server-hosted embed in a WKWebView (`LiveViewWebView`),
 * which decodes H.265 and owns the recorded-playback control surface. This is
 * the ONLY player: the legacy native react-native-webrtc implementation was
 * removed (it had no recorded-control surface, which silently broke
 * seek/scrub/go-live).
 *
 * Consumers (`CameraDetailScreen`, `GridTile`) import `LiveView` +
 * `type LiveViewHandle` from here and compile unchanged. On WEB, Metro resolves
 * `LiveView.web.tsx` instead of this file.
 */
import React, { forwardRef } from 'react'
import { LiveViewWebView } from './LiveViewWebView.js'
import type { LiveViewHandle, LiveViewProps } from './live-view-types.js'

export type { LiveViewHandle, LiveViewProps } from './live-view-types.js'

export const LiveView = forwardRef<LiveViewHandle, LiveViewProps>(function LiveView(props, ref) {
  return <LiveViewWebView ref={ref} {...props} />
})
