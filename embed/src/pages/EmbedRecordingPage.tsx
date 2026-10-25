/**
 * EmbedRecordingPage — chrome-less recorded-footage HLS VOD player.
 *
 * Served with the Viewer at `/viewer/camstack/embed/index.html?mode=recording`
 * (see EmbedApp), loaded inside the native WKWebView. The native app draws the
 * timeline/chrome and drives this page via `window.__camstackRecording`; the page
 * is purely the recorded-video surface (mirrors EmbedPlayerPage for live).
 *
 * Contract:
 *   IN  (set before load):  window.__CAMSTACK_RECORDING__ = { serverUrl, token, deviceId, startMs? }
 *   OUT (postMessage):      { type:'state', state, message? } / { type:'position', positionMs }
 *   IN  (once mounted):     window.__camstackRecording = { seekTo, play, pause, setRate, fit }
 *
 * Each seekTo(epochMs) fetches a fresh HLS master for [epochMs, epochMs+WINDOW_MS]
 * via recording.getPlayback (the `hls` arm) and plays from the window start.
 * This legacy
 * route has no RecordedTrackSession, so scrub commands report that gap instead
 * of starting a second media engine. Playhead epoch = windowStart + currentTime.
 */
import { useEffect, useMemo, useRef } from 'react'
import { createSystem, type System } from '@camstack/sdk'
import {
  RECORDING_PROVIDER_DEFAULT,
  parseRecordingConfig,
  type RecordingConfig,
} from '../embed/embed-recording-config'
import { emitHost, onHostCommand, setLogDeviceTag, useEmbedConfig } from '../embed/host-bridge'
import { resumeOffsetSec } from '../embed/resume-offset.js'
import { useHostBox } from '../embed/use-host-box.js'

/** A 6h window per loaded master keeps playlists small; re-seek loads a new one. */
const WINDOW_MS = 6 * 60 * 60 * 1000
const SCRUB_UNAVAILABLE = 'scrub unavailable: no open RecordedTrackSession'

type RecState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

interface RecMessage {
  readonly type: 'state' | 'position'
  readonly state?: RecState
  readonly message?: string
  /** Playhead in epoch ms (for the host timeline cursor). */
  readonly positionMs?: number
}

declare global {
  /** WebKit/Safari native-HLS extension (not in lib.dom): the media timeline's
   *  start as a `Date`, derived from the playlist's `EXT-X-PROGRAM-DATE-TIME`.
   *  For our VOD windows this is the first segment's wall-clock start — i.e. the
   *  epoch of `currentTime = 0` — for the ACTUAL variant the player chose. */
  interface HTMLMediaElement {
    getStartDate?(): Date
  }
  interface Window {
    __CAMSTACK_RECORDING__?: unknown
    __camstackRecording?: {
      seekTo: (epochMs: number) => void
      play: () => void
      pause: () => void
      setRate: (rate: number) => void
      fit: (w: number, h: number) => void
      scrubStart: () => void
      scrubTo: (epochMs: number) => void
      scrubEnd: (epochMs: number) => void
    }
  }
}

/** Post to the host (RN WebView or browser iframe). No-op outside both. */
function post(msg: RecMessage): void {
  emitHost(msg)
}

/** Diagnostic log channel → host. Rides the same ReactNativeWebView postMessage
 *  path as state/position; the native host (`RecordingPlayerWebView`) feeds these
 *  into the app's unified logger (Settings → Logs + server ingest). Mirrored to
 *  console for web. Emitted at `debug` verbosity — the host decides whether to
 *  keep/ship based on the app's debug-mode flag. */
function dbg(scope: string, msg: string, data?: unknown): void {
  try {
    emitHost({ type: 'log', scope, msg, data })
  } catch {
    /* non-serialisable payload — drop */
  }
  try {
    console.debug(`[rec-embed:${scope}] ${msg}`, data ?? '')
  } catch {
    /* noop */
  }
}

interface PlayerProps {
  readonly system: System
  readonly config: RecordingConfig
}

function RecordingPlayer({ system, config }: PlayerProps) {
  // Stamp the camera onto every outgoing log message (→ tags.deviceId on the hub).
  useEffect(() => setLogDeviceTag(config.deviceId), [config.deviceId])
  const videoRef = useRef<HTMLVideoElement>(null)
  /** Epoch start of the currently-loaded master (for position mapping). */
  const windowStartRef = useRef<number>(0)
  /** performance.now() captured at the start of each loadAt call for VOD-start latency. */
  const loadStartRef = useRef<number>(0)
  /** Monotonic load token. Each loadAt bumps it; async continuations (manifest
   *  resolve, `loadedmetadata` seek) bail when superseded so a slow older seek
   *  can never overwrite a newer seekTo position. */
  const loadGenRef = useRef<number>(0)
  const { box, fit: fitBox } = useHostBox()

  // Load + play a master covering [epochMs, epochMs+WINDOW_MS]; map media→epoch.
  const loadAt = useMemo(
    () =>
      async (epochMs: number): Promise<void> => {
        const video = videoRef.current
        if (!video) return
        const gen = ++loadGenRef.current
        loadStartRef.current = performance.now()
        dbg('loadAt', 'start', { epochMs, window: WINDOW_MS })
        post({ type: 'state', state: 'loading' })
        try {
          // `getPlayback`, named per source. It was `getPlaybackManifest` until
          // D625 split `recording` into a collection: a "manifest" is an HLS
          // master playlist, which is a property of OUR recorder and of nothing
          // else, so the name would be a lie in every onboard implementation.
          // The old shape survives verbatim inside the union's `hls` arm.
          const playback = await system.trpcClient.recording.getPlayback.query({
            deviceId: config.deviceId,
            provider: config.provider ?? RECORDING_PROVIDER_DEFAULT,
            fromMs: epochMs,
            toMs: epochMs + WINDOW_MS,
          })
          // A newer loadAt/seekTo superseded this one while the manifest
          // was in flight — abandon so we don't clobber the newer src/seek.
          if (gen !== loadGenRef.current) {
            dbg('loadAt', 'superseded', { epochMs })
            return
          }
          // This route drives ONE <video> off an HLS master and has no
          // RecordedTrackSession. A `clip` arm is a delegation to the
          // `videoclips` transport, which it cannot drive — so it says which
          // arm came back rather than reporting "no footage" for a source that
          // answered perfectly well (D391: a branch that produces no media
          // names WHY).
          if (playback?.kind !== 'hls') {
            const why =
              playback?.kind === 'clip'
                ? 'this source serves clips, not a playable HLS window'
                : (playback?.reason ?? 'no footage')
            dbg('loadAt', 'not-playable-here', { kind: playback?.kind ?? null, why })
            post({ type: 'state', state: 'error', message: why })
            return
          }
          const manifest = playback.manifest
          dbg('loadAt', 'manifest', {
            playbackUrl: manifest?.playbackUrl ?? null,
            endpoints: manifest?.playbackEndpoints?.length ?? 0,
            localMaster: !!manifest?.localMasterPath,
          })
          if (!manifest?.playbackUrl) {
            post({ type: 'state', state: 'error', message: 'no footage' })
            return
          }
          // The recorder serves WHOLE segments overlapping [from, to), so the
          // window's media-time-0 is the covering segment's head — at or before
          // `epochMs`. Seek INTO the window by the exact delta so playback
          // rejoins at the released epoch (not the segment head). The true
          // media-0 wall-clock comes from the playlist's EXT-X-PROGRAM-DATE-TIME
          // via getStartDate() once metadata is parsed (native HLS / WKWebView);
          // fall back to `epochMs` (legacy behaviour) when it's unavailable.
          video.src = manifest.playbackUrl // Safari/WKWebView native HLS (multi-variant)
          const startPlayback = (): void => {
            if (gen !== loadGenRef.current) return // superseded before metadata landed
            const startDate = typeof video.getStartDate === 'function' ? video.getStartDate() : null
            const media0Ms =
              startDate instanceof Date && !Number.isNaN(startDate.getTime())
                ? startDate.getTime()
                : epochMs
            windowStartRef.current = media0Ms
            const offsetSec = resumeOffsetSec(epochMs, media0Ms)
            if (offsetSec > 0) {
              try {
                video.currentTime = offsetSec
              } catch (e) {
                dbg('loadAt', 'seek-failed', { msg: String(e) })
              }
            }
            void video.play().catch((e) => {
              dbg('loadAt', 'play-rejected', { msg: String(e) })
            })
            dbg('loadAt', 'seek', { epochMs, media0Ms, offsetSec })
          }
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) startPlayback()
          else
            video.addEventListener('loadedmetadata', startPlayback, {
              once: true,
            })
          dbg('loadAt', 'src-set', { src: manifest.playbackUrl })
        } catch (err) {
          dbg('loadAt', 'error', {
            msg: err instanceof Error ? err.message : String(err),
          })
          post({
            type: 'state',
            state: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      },
    [system, config.deviceId],
  )

  useEffect(() => {
    dbg('init', 'mounted', {
      deviceId: config.deviceId,
      startMs: config.startMs ?? null,
      ua: navigator.userAgent,
    })
    const reportScrubUnavailable = (command: string, epochMs?: number): void => {
      dbg('scrub', 'unavailable', {
        command,
        ...(epochMs === undefined ? {} : { epochMs }),
      })
      post({ type: 'state', state: 'error', message: SCRUB_UNAVAILABLE })
    }
    window.__camstackRecording = {
      seekTo: (epochMs) => {
        dbg('cmd', 'seekTo', { epochMs })
        void loadAt(epochMs)
      },
      play: () => {
        dbg('cmd', 'play')
        void videoRef.current?.play().catch(() => {})
      },
      pause: () => {
        dbg('cmd', 'pause')
        videoRef.current?.pause()
      },
      setRate: (rate) => {
        dbg('cmd', 'setRate', { rate })
        if (videoRef.current) videoRef.current.playbackRate = rate
      },
      fit: (w, h) => {
        dbg('cmd', 'fit', { w, h })
        fitBox(w, h)
      },
      scrubStart: () => {
        dbg('cmd', 'scrubStart')
        reportScrubUnavailable('scrubStart')
      },
      scrubTo: (epochMs) => {
        dbg('cmd', 'scrubTo', { epochMs })
        reportScrubUnavailable('scrubTo', epochMs)
      },
      scrubEnd: (epochMs) => {
        dbg('cmd', 'scrubEnd', { epochMs })
        reportScrubUnavailable('scrubEnd', epochMs)
      },
    }
    if (config.startMs && config.startMs > 0) void loadAt(config.startMs)
    return () => {
      if (window.__camstackRecording) delete window.__camstackRecording
    }
  }, [loadAt, config.startMs, config.deviceId, fitBox])

  // Web (iframe) command channel: route `embed-command` messages to the SAME
  // window.__camstackRecording handlers the native host drives via injected JS.
  // Dormant on native (no embed-command messages are posted there).
  useEffect(
    () =>
      onHostCommand((command) => {
        const api = window.__camstackRecording
        if (!api) return
        const kind = command.kind as string
        switch (kind) {
          case 'seekTo':
            api.seekTo(command.value as number)
            break
          case 'play':
            api.play()
            break
          case 'pause':
            api.pause()
            break
          case 'setRate':
            api.setRate(command.value as number)
            break
          case 'scrubStart':
            api.scrubStart()
            break
          case 'scrubTo':
            api.scrubTo(command.value as number)
            break
          case 'scrubEnd':
            api.scrubEnd(command.value as number)
            break
          case 'fit':
            api.fit(command.w as number, command.h as number)
            break
          default:
            break
        }
      }),
    [],
  )

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: box.w,
        height: box.h,
        background: '#000',
      }}
    >
      <video
        ref={videoRef}
        playsInline
        controls={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
        }}
        onLoadedMetadata={(e) =>
          dbg('video', 'loadedmetadata', {
            w: e.currentTarget.videoWidth,
            h: e.currentTarget.videoHeight,
            dur: e.currentTarget.duration,
          })
        }
        onPlaying={() => {
          dbg('video', 'playing', {
            vodStartMs: Math.round(performance.now() - loadStartRef.current),
          })
          post({ type: 'state', state: 'playing' })
        }}
        onPause={() => post({ type: 'state', state: 'paused' })}
        onEnded={() => post({ type: 'state', state: 'ended' })}
        onError={(e) => {
          const err = e.currentTarget.error
          dbg('video', 'error', {
            code: err?.code ?? null,
            message: err?.message ?? null,
          })
          post({
            type: 'state',
            state: 'error',
            message: err?.message || 'video error',
          })
        }}
        onTimeUpdate={(e) =>
          post({
            type: 'position',
            positionMs: windowStartRef.current + e.currentTarget.currentTime * 1000,
          })
        }
      />
    </div>
  )
}

export function EmbedRecordingPage() {
  // Config IN: native resolves synchronously from the injected global; web does
  // the `embed-ready`→`embed-config` handshake (null while in flight).
  const result = useEmbedConfig(
    'recording',
    () => (window as unknown as { __CAMSTACK_RECORDING__?: unknown }).__CAMSTACK_RECORDING__,
    parseRecordingConfig,
  )
  const built = useMemo(() => {
    if (result === null || !result.ok) return null
    // Auth for the HLS playback sub-resources requested by `<video src>`: they
    // are same-origin HTTP requests that can only carry a cookie (no Bearer
    // header). Mirror the injected token into the hub session cookie so the
    // `authenticated` recorder playback data-plane lets them through. WKWebView
    // shares this JS-set cookie with its network stack for same-origin requests.
    document.cookie = `camstack_session=${result.config.token}; path=/; SameSite=Lax`
    return createSystem({
      serverUrl: result.config.serverUrl,
      token: result.config.token,
    })
  }, [result])
  useEffect(() => () => built?.close(), [built])

  // Web handshake in flight — render nothing (the host shows its own loader).
  if (result === null) return null
  if (!result.ok) {
    post({ type: 'state', state: 'error', message: result.error })
    return null
  }
  if (!built) {
    post({ type: 'state', state: 'error', message: 'init failed' })
    return null
  }
  return <RecordingPlayer system={built} config={result.config} />
}
