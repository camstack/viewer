/**
 * The two URIs a native embed can be loaded from, and the shape of each.
 *
 * ## The local one carries its mode in the FRAGMENT, not the query
 *
 * `react-native-webview` loads a `file://` source through
 * `loadFileURL:allowingReadAccessToURL:` (its iOS branch takes that path for
 * any URL with no host). A file URL with a QUERY is the fragile case: on the
 * Mac — where the app runs as an iOS app on Apple Silicon, from
 * `…/Wrapper/CamStack.app` — the load does not render and the URL escapes to
 * the system, which opens the raw HTML in a browser. That is what the operator
 * saw: no stream, then Safari on
 * `file:///…/.expo-internal/<hash>.html`.
 *
 * A fragment is not part of the path a file loader resolves, so `#mode=player`
 * asks the same question without touching the filename. The embed reads both
 * (`EmbedApp.tsx`), and the injected `window.__CAMSTACK_EMBED_MODE__` still
 * wins over either.
 *
 * ## The remote one is a FALLBACK, never the default
 *
 * The asset is bundled in the OTA for cold-start (`perf: bundle native embed in
 * viewer OTA`, 2026-08-10): loading it from the hub costs a network round trip
 * on every player open, which is exactly what that change removed. So the hub
 * copy is reached only after the local one has actually failed to load — the
 * fast path is untouched and the slow path exists so a WebView that cannot read
 * a local file still shows video.
 */
import type { NativeEmbedMode } from './use-native-embed-source.js'

/** Where the hub serves the same embed. Query is fine over http(s). */
export function buildRemoteEmbedUri(serverUrl: string, mode: NativeEmbedMode): string {
  return `${serverUrl.replace(/\/+$/, '')}/viewer/camstack/embed/index.html?mode=${mode}`
}

/** The bundled asset, with the mode in the fragment. */
export function buildLocalEmbedUri(assetUri: string, mode: NativeEmbedMode): string {
  const [withoutFragment] = assetUri.split('#')
  return `${withoutFragment ?? assetUri}#mode=${mode}`
}

/**
 * The directory the WebView is granted read access to.
 *
 * Without it `loadFileURL:` grants access to the single file only. The embed is
 * self-contained so that is usually enough — but "usually" is what the Mac
 * failure was made of, and the directory costs nothing: it is the app's own
 * asset folder, not a wider grant.
 */
export function embedReadAccessUri(assetUri: string): string | null {
  const [withoutFragment] = assetUri.split('#')
  const path = (withoutFragment ?? assetUri).split('?')[0] ?? ''
  const slash = path.lastIndexOf('/')
  if (slash <= 0) return null
  const folder = path.slice(0, slash)
  // `file://` is a scheme, not a folder: granting it would name nothing and
  // read as a grant that was made.
  return folder.endsWith('//') ? null : folder
}
