/**
 * useIntercom (web) — talk-back delegated to the player iframe. The single-camera
 * `LiveView.web` registers an `EmbedChannel` for the device; this hook posts
 * `setMic` and mirrors the embed's `micState`. The actual getUserMedia + WebRTC
 * runs INSIDE the embed (`EmbedPlayerPage`), so no react-native-webrtc here.
 */
import { useCallback, useEffect, useState } from 'react'
import type { IntercomController } from './use-intercom.js'
import { getEmbedChannel } from './embed-channel.js'
import type { MicState } from './embed-player-messages.js'

export function useIntercom(deviceId: number): IntercomController {
  const [micState, setMicState] = useState<MicState>('idle')

  useEffect(() => {
    const channel = getEmbedChannel(deviceId)
    if (!channel) return
    setMicState(channel.getMicState())
    return channel.subscribeMicState(setMicState)
  }, [deviceId])

  const toggle = useCallback(() => {
    const channel = getEmbedChannel(deviceId)
    if (!channel) return
    const state = channel.getMicState()
    if (state === 'starting') return
    channel.postCommand({ kind: 'setMic', value: state !== 'talking' })
  }, [deviceId])

  return {
    talking: micState === 'talking',
    busy: micState === 'starting',
    error: micState === 'error' ? 'intercom error' : null,
    toggle,
  }
}
