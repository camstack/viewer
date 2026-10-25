import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Platform } from 'react-native'
import localEmbedAsset from '../../assets/embed/camstack-embed.html'
import { buildLocalEmbedUri, buildRemoteEmbedUri, embedReadAccessUri } from './embed-source-uri.js'
import { log } from '../lib/logger.js'

export type NativeEmbedMode = 'grid' | 'player' | 'recording' | 'events'

interface EmbedSource {
  readonly uri: string
}

interface NativeEmbedSource {
  readonly source: EmbedSource | null
  /**
   * What the WebView should be granted read access to while the source is the
   * bundled file. Null for the hub copy, which is not a file at all.
   */
  readonly readAccessUri: string | null
  /**
   * Call when the WebView reports it could not load. The next render serves the
   * hub's copy instead — see `embed-source-uri.ts` for why that is a fallback
   * and not the default.
   */
  readonly reportLoadFailure: () => void
  /**
   * Call on the FIRST sign that the embed's own script is running — any
   * message from the page.
   *
   * The failure this exists for reports nothing: on the Mac, WebKit declines
   * the `file://` navigation and the system opens the page in a browser
   * instead. From the host's side that is silence — no `onError`, no
   * `onHttpError`, nothing to hang a fallback on — which is why the
   * error-driven fallback shipped in 1.0.473 did not fire and the operator saw
   * the same browser window again.
   *
   * So the trigger is the absence of life: no message within
   * {@link EMBED_ALIVE_TIMEOUT_MS} of mounting means the page never ran, and
   * the hub's copy is tried instead.
   */
  readonly reportEmbedAlive: () => void
}

/**
 * How long a mounted embed has to say ANYTHING before the local asset is
 * declared unusable.
 *
 * Long enough that a cold WebView boot on a slow device is never mistaken for a
 * dead one (the measured mount→loadEnd on this fleet is well under two
 * seconds), short enough that a Mac operator is not staring at a black box.
 */
export const EMBED_ALIVE_TIMEOUT_MS = 6_000

function resolveLocalUri(): string | null {
  if (Platform.OS === 'web') return null
  return Image.resolveAssetSource(localEmbedAsset)?.uri ?? null
}

export function useNativeEmbedSource(
  serverUrl: string | null,
  mode: NativeEmbedMode,
): NativeEmbedSource {
  // Per mount, not per app: a host that failed once keeps the remote copy for
  // its own life, and a fresh player starts on the fast local path again.
  const [localFailed, setLocalFailed] = useState<boolean>(false)
  const localUri = useMemo(() => resolveLocalUri(), [])
  const aliveRef = useRef<boolean>(false)

  const reportLoadFailure = useCallback(() => {
    setLocalFailed((already) => {
      if (already) return already
      log.warn('embed', 'local embed failed to load — falling back to the hub copy', { mode })
      return true
    })
  }, [mode])

  const reportEmbedAlive = useCallback(() => {
    aliveRef.current = true
  }, [])

  // The silence watchdog. Armed only while the LOCAL asset is the source and a
  // server is known: there is nowhere to fall back to otherwise, and the hub
  // copy needs no watching — a page served over http fails loudly.
  useEffect(() => {
    if (serverUrl === null || localFailed || localUri === null) return
    aliveRef.current = false
    const timer = setTimeout(() => {
      if (aliveRef.current) return
      log.warn('embed', 'the local embed never spoke — falling back to the hub copy', {
        mode,
        afterMs: EMBED_ALIVE_TIMEOUT_MS,
      })
      setLocalFailed(true)
    }, EMBED_ALIVE_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [serverUrl, localFailed, localUri, mode])

  useEffect(() => {
    if (serverUrl !== null) {
      log.info('embed', 'source selected', { mode, source: localFailed ? 'hub' : 'local' })
    }
  }, [mode, serverUrl, localFailed])

  if (serverUrl === null) {
    return { source: null, readAccessUri: null, reportLoadFailure, reportEmbedAlive }
  }
  if (localFailed || localUri === null) {
    return {
      source: { uri: buildRemoteEmbedUri(serverUrl, mode) },
      readAccessUri: null,
      reportLoadFailure,
      reportEmbedAlive,
    }
  }
  return {
    source: { uri: buildLocalEmbedUri(localUri, mode) },
    readAccessUri: embedReadAccessUri(localUri),
    reportLoadFailure,
    reportEmbedAlive,
  }
}
