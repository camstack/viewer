/**
 * useIntercom — two-way audio (talk-back) for a camera, native implementation.
 *
 * Intercom is a SEPARATE, audio-only WebRTC session from the live video and
 * uses the SERVER-OFFER pattern (the dual of the video client-offer flow):
 *   1. `intercom.startSession({ deviceId })` → the server returns an SDP offer
 *      whose single audio m-line wants the CLIENT's mic (client → server).
 *   2. The client captures the mic (`getUserMedia`), adds the track, answers,
 *      and — because the cap exposes NO trickle methods — waits for ICE to
 *      gather into the answer SDP before posting it.
 *   3. `intercom.handleAnswer({ deviceId, sessionId, sdpAnswer })` completes it.
 *      The server decodes the Opus uplink and transcodes to the camera's talk
 *      codec. `intercom.stopSession` (or 30s idle) tears it down.
 *
 * react-native-webrtc is native-only, so this module has a `.web` stub.
 *
 * Audio routing: talk-back captures the mic via react-native-webrtc, which
 * flips the shared AVAudioSession to a record category. On the iOS WebView
 * player the live video+audio plays in a SEPARATE WKWebView audio engine, so we
 * must explicitly `configureForIntercom()` (PlayAndRecord + MixWithOthers) on
 * start and `configureForPlayback()` on stop — otherwise the WebView's stream
 * audio gets interrupted ("audio output stops reaching the phone").
 *
 * Lifecycle is logged via `[intercom]` console.warn lines (captured by the
 * native log bridge) so talk-back can be diagnosed on-device.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RTCPeerConnection, RTCSessionDescription, type MediaStream } from 'react-native-webrtc'
import { useConnection } from '../connection/ConnectionProvider.js'
import {
  configureForIntercom,
  configureForPlayback,
  hasAudioSessionControl,
} from './audio-session.js'
import { captureMicStream } from './mic-capture.js'

/** Diagnostic tag for the native-captured logs. */
const LOG = '[intercom]'

export interface IntercomController {
  /** True while a talk session is open (mic live). */
  readonly talking: boolean
  /** True while starting/stopping (toggle is a no-op until it settles). */
  readonly busy: boolean
  /** Last error message, or null. */
  readonly error: string | null
  /** Toggle the talk session on/off. */
  readonly toggle: () => void
}

interface PcIceTarget {
  readonly iceGatheringState: string
  addEventListener(type: 'icegatheringstatechange', listener: () => void): void
  removeEventListener(type: 'icegatheringstatechange', listener: () => void): void
  readonly localDescription: { sdp: string } | null
}

/** Resolve once ICE has gathered enough for a non-trickle answer: as soon as a
 *  host candidate is in the SDP (LAN/direct needs only that), else when
 *  gathering completes, with a hard cap so a slow relay can't hang the toggle. */
function waitForIceGathering(pc: PcIceTarget): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const finish = (): void => {
      if (settled) return
      settled = true
      if (poll) clearInterval(poll)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    const start = Date.now()
    poll = setInterval(() => {
      const sdp = pc.localDescription?.sdp ?? ''
      if (/ typ host/.test(sdp) && Date.now() - start >= 400) finish()
    }, 100)
    setTimeout(finish, 2500)
  })
}

export function useIntercom(deviceId: number): IntercomController {
  const { controller } = useConnection()
  const [talking, setTalking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<string | null>(null)

  const stop = useCallback(async (): Promise<void> => {
    const system = controller.getSystem()
    const sid = sessionRef.current
    console.warn(LOG, 'stop: tearing down', { deviceId, sessionId: sid })
    micRef.current?.getTracks().forEach((t) => t.stop())
    micRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    sessionRef.current = null
    if (system && sid) {
      try {
        await system.trpcClient.intercom.stopSession.mutate({ deviceId, sessionId: sid })
      } catch (e) {
        // best-effort — the server also auto-closes on idle
        console.warn(LOG, 'stop: stopSession failed', e instanceof Error ? e.message : String(e))
      }
    }
    // Restore the playback-only session so the live stream audio resumes.
    try {
      await configureForPlayback()
      console.warn(LOG, 'stop: audio session restored to playback')
    } catch (e) {
      console.warn(LOG, 'stop: configureForPlayback failed', e instanceof Error ? e.message : String(e))
    }
  }, [controller, deviceId])

  const start = useCallback(async (): Promise<void> => {
    const system = controller.getSystem()
    if (!system) throw new Error('no-connection')
    console.warn(LOG, 'start: opening talk-back', { deviceId, audioCtrl: hasAudioSessionControl() })

    // Switch the shared audio session to intercom (PlayAndRecord + speaker +
    // mix-with-others) BEFORE opening the mic, so the WebView's stream audio
    // keeps playing and talk-back routes to the speaker.
    try {
      await configureForIntercom()
      console.warn(LOG, 'start: audio session set to intercom')
    } catch (e) {
      console.warn(LOG, 'start: configureForIntercom failed', e instanceof Error ? e.message : String(e))
    }

    // TURN/STUN so a remote/CGNAT client can reach the server (best-effort).
    const turn = await system.trpcClient.turnProvider.getTurnServers.query().catch(() => [])
    const iceServers = turn.map((s) => ({
      urls: typeof s.urls === 'string' ? s.urls : [...s.urls],
      ...(s.username !== undefined ? { username: s.username } : {}),
      ...(s.credential !== undefined ? { credential: s.credential } : {}),
    }))

    const { sessionId, sdpOffer } = await system.trpcClient.intercom.startSession.mutate({ deviceId })
    sessionRef.current = sessionId
    console.warn(LOG, 'start: server offer received', { sessionId })

    const pc = new RTCPeerConnection({ iceServers })
    pcRef.current = pc
    // Diagnostic: log ICE transitions (talk-back never pairing = black-audio).
    const pcEvents = pc as unknown as {
      addEventListener(type: 'iceconnectionstatechange', listener: () => void): void
      readonly iceConnectionState: string
    }
    pcEvents.addEventListener('iceconnectionstatechange', () => {
      console.warn(LOG, 'iceConnectionState', pcEvents.iceConnectionState)
    })

    // Apply the server's offer first so the audio transceiver exists, then
    // attach the mic to send on it and answer.
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdpOffer }))
    // Capture via the native path directly — the library's JS getUserMedia
    // permission gate is unreliable under the New Architecture and spuriously
    // rejects granted mics (see mic-capture.ts).
    const mic = await captureMicStream()
    micRef.current = mic
    mic.getTracks().forEach((track) => pc.addTrack(track, mic))
    console.warn(LOG, 'start: mic captured + added', { tracks: mic.getTracks().length })

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGathering(pc as unknown as PcIceTarget)

    await system.trpcClient.intercom.handleAnswer.mutate({
      deviceId,
      sessionId,
      sdpAnswer: pc.localDescription?.sdp ?? '',
    })
    console.warn(LOG, 'start: answer posted — talk-back live')
  }, [controller, deviceId])

  const toggle = useCallback((): void => {
    if (busy) return
    setError(null)
    setBusy(true)
    if (talking) {
      void stop().finally(() => {
        setTalking(false)
        setBusy(false)
      })
    } else {
      void start()
        .then(() => setTalking(true))
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'intercom-failed')
          void stop()
          setTalking(false)
        })
        .finally(() => setBusy(false))
    }
  }, [busy, talking, start, stop])

  // Tear the session down on unmount (leaving the screen ends talk-back).
  useEffect(() => {
    return () => {
      void stop()
    }
  }, [stop])

  return { talking, busy, error, toggle }
}
