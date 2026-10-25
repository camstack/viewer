/**
 * Exclusive intercom (mic / talk-back) for the grid embed — AT MOST ONE camera
 * talking at a time. Mirrors admin-ui's `useDeviceIntercom` WebRTC flow against
 * the `intercom` cap (startSession → answer), but adds single-session
 * exclusivity: toggling the mic on camera B transparently stops camera A.
 *
 * Gesture note: `getUserMedia` is the FIRST await in `toggleMic`, so it stays
 * within the originating tap — iOS WKWebView only grants mic capture from a user
 * gesture. (The host must also grant the WKWebView mic permission natively +
 * inject an admin-scoped token, since the intercom cap is `auth:'admin'`.)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useIntercomStartSession,
  useIntercomHandleAnswer,
  useIntercomStopSession,
} from '@camstack/ui-library'

export type MicState = 'idle' | 'starting' | 'talking' | 'error'

export interface ExclusiveIntercom {
  readonly activeMicId: number | null
  readonly micState: MicState
  /** Toggle the mic for a device (start it, or stop it if already active). */
  readonly toggleMic: (deviceId: number) => void
  /** Imperative set (host command) — null stops any active session. */
  readonly setActiveMic: (deviceId: number | null) => void
}

interface ActiveSession {
  readonly deviceId: number
  readonly sessionId: string
}

export function useExclusiveIntercom(): ExclusiveIntercom {
  const [activeMicId, setActiveMicId] = useState<number | null>(null)
  const [micState, setMicState] = useState<MicState>('idle')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<ActiveSession | null>(null)
  // Monotonic generation token: bumped on every transition so a stale async
  // continuation (old getUserMedia / SDP exchange) detects it lost the race.
  const genRef = useRef(0)
  const activeIdRef = useRef<number | null>(null)

  const startM = useIntercomStartSession()
  const answerM = useIntercomHandleAnswer()
  const stopM = useIntercomStopSession()
  // Capture the (per-render) mutate fns in a ref so the callbacks below stay
  // stable without listing the unstable mutation objects as deps.
  const apiRef = useRef({
    start: startM.mutateAsync,
    answer: answerM.mutateAsync,
    stop: stopM.mutateAsync,
  })
  apiRef.current = {
    start: startM.mutateAsync,
    answer: answerM.mutateAsync,
    stop: stopM.mutateAsync,
  }

  const teardownLocal = useCallback((): void => {
    if (pcRef.current) {
      try {
        pcRef.current.close()
      } catch {
        /* swallow */
      }
      pcRef.current = null
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) {
        try {
          t.stop()
        } catch {
          /* swallow */
        }
      }
      streamRef.current = null
    }
  }, [])

  const stopCurrent = useCallback(async (): Promise<void> => {
    const s = sessionRef.current
    sessionRef.current = null
    teardownLocal()
    if (s) {
      try {
        await apiRef.current.stop({ deviceId: s.deviceId, sessionId: s.sessionId })
      } catch {
        /* swallow */
      }
    }
  }, [teardownLocal])

  const toggleMic = useCallback(
    async (deviceId: number): Promise<void> => {
      // Turn OFF if this camera is already the active one.
      if (activeIdRef.current === deviceId) {
        genRef.current += 1
        activeIdRef.current = null
        setActiveMicId(null)
        setMicState('idle')
        await stopCurrent()
        return
      }

      // Switch ON (and off any previous). Bump the generation up front.
      genRef.current += 1
      const gen = genRef.current
      activeIdRef.current = deviceId
      setActiveMicId(deviceId)
      setMicState('starting')

      // 1. Mic capture FIRST — keeps us inside the user gesture (iOS requirement).
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      } catch {
        if (gen === genRef.current) {
          activeIdRef.current = null
          setActiveMicId(null)
          setMicState('error')
        }
        return
      }
      if (gen !== genRef.current) {
        for (const t of stream.getTracks()) t.stop()
        return
      }

      // 2. Stop any prior session now that we have the new mic.
      await stopCurrent()
      if (gen !== genRef.current) {
        for (const t of stream.getTracks()) t.stop()
        return
      }

      // 3. Server session + WebRTC answer.
      let pc: RTCPeerConnection | null = null
      try {
        streamRef.current = stream
        const offer = await apiRef.current.start({ deviceId })
        if (gen !== genRef.current) {
          try {
            await apiRef.current.stop({ deviceId, sessionId: offer.sessionId })
          } catch {
            /* swallow */
          }
          teardownLocal()
          return
        }
        sessionRef.current = { deviceId, sessionId: offer.sessionId }

        pc = new RTCPeerConnection()
        pcRef.current = pc
        pc.oniceconnectionstatechange = () => {
          if (gen !== genRef.current || !pc) return
          const st = pc.iceConnectionState
          if (st === 'connected' || st === 'completed') setMicState('talking')
          else if (st === 'failed' || st === 'closed' || st === 'disconnected') {
            activeIdRef.current = null
            setActiveMicId(null)
            setMicState('idle')
            void stopCurrent()
          }
        }
        for (const tr of stream.getAudioTracks()) pc.addTrack(tr, stream)
        await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdpOffer })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        if (gen !== genRef.current) return
        await apiRef.current.answer({
          deviceId,
          sessionId: offer.sessionId,
          sdpAnswer: pc.localDescription?.sdp ?? answer.sdp ?? '',
        })
        // State flips to 'talking' from the ICE callback once connected.
      } catch {
        if (pc) {
          try {
            pc.close()
          } catch {
            /* swallow */
          }
        }
        teardownLocal()
        const s = sessionRef.current
        sessionRef.current = null
        if (s) {
          try {
            await apiRef.current.stop({ deviceId: s.deviceId, sessionId: s.sessionId })
          } catch {
            /* swallow */
          }
        }
        if (gen === genRef.current) {
          activeIdRef.current = null
          setActiveMicId(null)
          setMicState('error')
        }
      }
    },
    [stopCurrent, teardownLocal],
  )

  const setActiveMic = useCallback(
    (deviceId: number | null): void => {
      if (deviceId === null) {
        genRef.current += 1
        activeIdRef.current = null
        setActiveMicId(null)
        setMicState('idle')
        void stopCurrent()
        return
      }
      if (activeIdRef.current !== deviceId) void toggleMic(deviceId)
    },
    [stopCurrent, toggleMic],
  )

  // Release the mic + server session on unmount.
  useEffect(
    () => () => {
      genRef.current += 1
      void stopCurrent()
    },
    [stopCurrent],
  )

  return {
    activeMicId,
    micState,
    toggleMic: (deviceId: number) => {
      void toggleMic(deviceId)
    },
    setActiveMic,
  }
}
