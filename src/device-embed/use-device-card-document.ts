/**
 * One device-card document. The first URL loads it; a later device, theme,
 * language or access token is a message. The WebView key is the reload nonce
 * alone — a token refresh used to be a new document.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceEmbedCardReady, markDeviceEmbed } from './device-embed-timing.js'

export type DeviceCardTheme = 'light' | 'dark'
export type DeviceCardLang = 'en' | 'it'

export type DeviceCardHostCommand =
  | {
      readonly type: 'show-device'
      readonly deviceId: number
      readonly theme: DeviceCardTheme
      readonly lang: DeviceCardLang
    }
  | { readonly type: 'set-token'; readonly token: string }

/** The WebView key. A token or a device id in here reloads the document. */
export function deviceCardWebViewKey(reloadNonce: number): string {
  return `device-card:${String(reloadNonce)}`
}

/**
 * The script `injectJavaScript` runs. It dispatches the same `MessageEvent`
 * the WebView's `postMessage` does, on both `window` (iOS) and `document`
 * (Android). Ends truthy, which `injectJavaScript` requires.
 */
export function deviceCardCommandScript(command: DeviceCardHostCommand): string {
  const payload = JSON.stringify(JSON.stringify(command))
  return (
    `(function(){try{var d=${payload};` +
    `var ev=new MessageEvent('message',{data:d});` +
    `window.dispatchEvent(ev);document.dispatchEvent(ev);}catch(e){}})();true;`
  )
}

export type CardDocumentState = 'loading' | 'ready' | 'failed'

export interface DeviceCardDocumentInput {
  readonly deviceId: number
  readonly uri: string | null
  readonly token: string | null
  readonly theme: DeviceCardTheme
  readonly lang: DeviceCardLang
  readonly deliver: (command: DeviceCardHostCommand) => void
}

export interface DeviceCardDocument {
  readonly documentUri: string | null
  readonly webViewKey: string
  readonly state: CardDocumentState
  readonly fail: () => void
  readonly retry: () => void
  readonly onLoadStart: () => void
  readonly onLoadEnd: () => void
  readonly onPageMessage: (raw: string) => void
}

interface ShownDevice {
  readonly deviceId: number
  readonly theme: DeviceCardTheme
  readonly lang: DeviceCardLang
}

function uriShowsDevice(uri: string, deviceId: number, theme: DeviceCardTheme, lang: DeviceCardLang): boolean {
  try {
    const url = new URL(uri)
    const match = /\/embed\/device\/([0-9]+)/.exec(url.pathname)
    if (match?.[1] !== String(deviceId)) return false
    return url.searchParams.get('theme') === theme && url.searchParams.get('lang') === lang
  } catch {
    return false
  }
}

function sameShown(shown: ShownDevice | null, next: ShownDevice): boolean {
  return shown !== null && shown.deviceId === next.deviceId && shown.theme === next.theme && shown.lang === next.lang
}

export function useDeviceCardDocument(input: DeviceCardDocumentInput): DeviceCardDocument {
  const { deviceId, uri, token, theme, lang } = input
  const deliverRef = useRef(input.deliver)
  deliverRef.current = input.deliver
  const deviceRef = useRef(deviceId)
  deviceRef.current = deviceId

  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<CardDocumentState>('loading')
  const [loadGeneration, setLoadGeneration] = useState(0)
  const initialUri = useRef<string | null>(null)
  const loaded = useRef(false)
  const tokenAtDocument = useRef<string | null | undefined>(undefined)
  const shown = useRef<ShownDevice | null>(null)
  if (initialUri.current === null && uri !== null) initialUri.current = uri

  const reloadDocument = useCallback((): void => {
    loaded.current = false
    shown.current = null
    initialUri.current = null
    setState('loading')
    setNonce((n) => n + 1)
  }, [])

  const hasUri = uri !== null
  useEffect(() => {
    if (!hasUri) return
    markDeviceEmbed('webview-created', deviceRef.current)
  }, [hasUri, nonce])

  useEffect(() => {
    if (uri === null || initialUri.current === null) return
    try {
      if (new URL(uri).origin !== new URL(initialUri.current).origin) reloadDocument()
    } catch {
      reloadDocument()
    }
  }, [reloadDocument, uri])

  useEffect(() => {
    if (uri === null) return
    if (!loaded.current) {
      if (tokenAtDocument.current === undefined) {
        tokenAtDocument.current = token
        return
      }
      if (tokenAtDocument.current === token) return
      tokenAtDocument.current = token
      reloadDocument()
      return
    }
    if (token === null || token.length === 0) {
      tokenAtDocument.current = token
      reloadDocument()
      return
    }
    if (tokenAtDocument.current === token) return
    tokenAtDocument.current = token
    deliverRef.current({ type: 'set-token', token })
    markDeviceEmbed('token-refresh', deviceRef.current)
  }, [reloadDocument, token, uri])

  useEffect(() => {
    if (uri === null || !loaded.current || initialUri.current === null) return
    const next: ShownDevice = { deviceId, theme, lang }
    const prev = shown.current
    if (sameShown(prev, next)) return
    shown.current = next
    // The document's URL is already this device: nothing to send until it changes.
    if (prev === null && uriShowsDevice(initialUri.current, deviceId, theme, lang)) return
    // Theme or language on the device already showing: the card is up, so it
    // stays visible while the page applies the query.
    if (prev !== null && prev.deviceId === deviceId) {
      deliverRef.current({ type: 'show-device', deviceId, theme, lang })
      markDeviceEmbed('show-device', deviceId)
      return
    }
    setState('loading')
    deliverRef.current({ type: 'show-device', deviceId, theme, lang })
    markDeviceEmbed('show-device', deviceId)
  }, [deviceId, lang, loadGeneration, theme, uri])

  const onLoadStart = useCallback((): void => {
    markDeviceEmbed('load-start', deviceRef.current)
  }, [])

  const onLoadEnd = useCallback((): void => {
    loaded.current = true
    markDeviceEmbed('load-end', deviceRef.current)
    setLoadGeneration((n) => n + 1)
  }, [])

  const onPageMessage = useCallback((raw: string): void => {
    const ready = deviceEmbedCardReady(raw)
    if (ready === null || ready.deviceId !== deviceRef.current) return
    markDeviceEmbed('card-ready', ready.deviceId)
    setState((current) => (current === 'failed' ? current : 'ready'))
  }, [])

  const fail = useCallback((): void => {
    setState('failed')
  }, [])

  return {
    documentUri: initialUri.current,
    webViewKey: deviceCardWebViewKey(nonce),
    state,
    fail,
    retry: reloadDocument,
    onLoadStart,
    onLoadEnd,
    onPageMessage,
  }
}
