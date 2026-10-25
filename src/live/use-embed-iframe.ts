/**
 * Web-only iframe bridge for the stream-broker embed. Loads
 * `/viewer/camstack/embed/index.html?mode=…`, runs the `embed-ready`→`embed-config`
 * handshake, posts `embed-command` messages, and forwards inbound host data.
 * Imported ONLY by `.web.tsx` files (uses DOM APIs). Mirrors the native
 * injectedJavaScript/onMessage plumbing.
 */
import { useCallback, useEffect, useRef } from 'react'
import { buildGridEmbedUrl, type EmbedMode } from '../grid-embed/embed-url.js'

export interface EmbedLocation {
  /** The iframe `src`. */
  readonly src: string
  /** The embed document's origin — the postMessage target and the only
   *  origin whose messages are accepted. */
  readonly origin: string
}

export interface EmbedLocationInput {
  readonly serverUrl: string
  readonly mode: EmbedMode
  /** `window.location.origin` of the host page, or null off-browser. */
  readonly pageOrigin: string | null
  /** The path this web build is mounted at, with a trailing slash (`/` for the
   *  hosted PWA, `/viewer/camstack/` on a hub). */
  readonly mountPrefix: string
}

/**
 * Where the embed document comes from.
 *
 * On the hub (page origin = hub origin) it is the hub's own copy, as it always
 * was. Anywhere else — the hosted PWA at camstack.zentik.app talking to the
 * operator's hub — it is THIS build's bundled copy (`public/embed`, shipped in
 * every web export), on the page's own origin: the hub refuses to be framed by
 * another origin (`frame-ancestors 'self'`) and its cookie is not sent
 * cross-site. The embed then reaches the hub cross-origin with the bearer token
 * the `embed-config` handshake hands it (the hub's CORS allowlist, D707).
 */
export function resolveEmbedLocation(input: EmbedLocationInput): EmbedLocation {
  const hubOrigin = new URL(input.serverUrl).origin
  if (input.pageOrigin === null || input.pageOrigin === hubOrigin) {
    return { src: buildGridEmbedUrl(input.serverUrl, input.mode), origin: hubOrigin }
  }
  const prefix = input.mountPrefix.endsWith('/') ? input.mountPrefix : `${input.mountPrefix}/`
  return {
    src: `${input.pageOrigin}${prefix}embed/index.html?mode=${input.mode}`,
    origin: input.pageOrigin,
  }
}

/** This web build's mount — the same rule as `config-web-base.js`. */
function webMountPrefix(): string {
  const base = (process.env.EXPO_PUBLIC_WEB_BASE_PATH ?? '').replace(/\/+$/, '')
  return base === '' ? '/' : `${base}/camstack/`
}

function currentPageOrigin(): string | null {
  return typeof window !== 'undefined' && typeof window.location !== 'undefined' ? window.location.origin : null
}

interface BridgeDeps {
  readonly postToEmbed: (msg: unknown) => void
  readonly onHostMessage: (data: unknown) => void
  readonly buildConfig: () => unknown
}

/** Pure message router: reply to `embed-ready`, else forward. Unit-tested. */
export function handleBridgeMessage(data: unknown, deps: BridgeDeps): void {
  if (typeof data !== 'object' || data === null) return
  const m = data as Record<string, unknown>
  if (m.type === 'embed-ready') {
    deps.postToEmbed({ type: 'embed-config', config: deps.buildConfig() })
    return
  }
  deps.onHostMessage(data)
}

export interface EmbedIframeParams {
  readonly serverUrl: string | null
  readonly mode: EmbedMode
  readonly buildConfig: () => unknown
  readonly onHostMessage: (data: unknown) => void
}

export interface EmbedIframeApi {
  readonly iframeRef: React.RefObject<HTMLIFrameElement | null>
  readonly src: string | null
  readonly postCommand: (command: unknown) => void
  readonly reload: () => void
}

export function useEmbedIframe(params: EmbedIframeParams): EmbedIframeApi {
  const { serverUrl, mode } = params
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const location = serverUrl
    ? resolveEmbedLocation({ serverUrl, mode, pageOrigin: currentPageOrigin(), mountPrefix: webMountPrefix() })
    : null
  const hostOrigin = location?.origin ?? null
  const src = location?.src ?? null

  const buildConfigRef = useRef(params.buildConfig)
  buildConfigRef.current = params.buildConfig
  const onHostMessageRef = useRef(params.onHostMessage)
  onHostMessageRef.current = params.onHostMessage

  const postToEmbed = useCallback(
    (msg: unknown): void => {
      iframeRef.current?.contentWindow?.postMessage(msg, hostOrigin ?? '*')
    },
    [hostOrigin],
  )

  useEffect(() => {
    const listener = (e: MessageEvent): void => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (hostOrigin && e.origin !== hostOrigin) return
      handleBridgeMessage(e.data, {
        postToEmbed,
        onHostMessage: (d) => onHostMessageRef.current(d),
        buildConfig: () => buildConfigRef.current(),
      })
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [hostOrigin, postToEmbed])

  const postCommand = useCallback(
    (command: unknown): void => {
      postToEmbed({ type: 'embed-command', command })
    },
    [postToEmbed],
  )

  const reload = useCallback((): void => {
    if (iframeRef.current && src) iframeRef.current.src = src
  }, [src])

  return { iframeRef, src, postCommand, reload }
}
