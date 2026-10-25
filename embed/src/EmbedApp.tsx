/// <reference types="vite/client" />
/**
 * EmbedApp — the single entry for the stream-broker embed bundle.
 *
 * One html entry, no router: dispatch on the `?mode=` query param.
 *   ?mode=grid   (default) → EmbedGridPage     (reads window.__CAMSTACK_GRID__)
 *   ?mode=player           → EmbedPlayerPage    (reads window.__CAMSTACK_EMBED__)
 *   ?mode=recording        → EmbedRecordingPage (reads window.__CAMSTACK_RECORDING__)
 *   ?mode=events           → EmbedEventsPage    (reads window.__CAMSTACK_EVENTS__,
 *                                                or the v1 query params + `#t=`)
 *
 * Each page reads + validates its own injected config global; EmbedApp only routes.
 */

import { EmbedEventsPage } from './pages/EmbedEventsPage'
import { EmbedGridPage } from './pages/EmbedGridPage'
import { EmbedPlayerPage } from './pages/EmbedPlayerPage'
import { EmbedRecordingPage } from './pages/EmbedRecordingPage'

export function EmbedApp() {
  const mode =
    (window as Window & { __CAMSTACK_EMBED_MODE__?: string }).__CAMSTACK_EMBED_MODE__ ??
    new URLSearchParams(location.search).get('mode') ??
    // The FRAGMENT, for the bundled copy. A native host cannot put the mode in
    // the query: the WebView loads that file through `loadFileURL:`, and a file
    // URL carrying `?mode=` did not render on the Mac — it escaped to the
    // system, which opened the raw HTML in a browser. A fragment asks the same
    // question without touching the path the loader resolves.
    new URLSearchParams(location.hash.replace(/^#/, '')).get('mode') ??
    'grid'
  if (mode === 'player') return <EmbedPlayerPage />
  if (mode === 'recording') return <EmbedRecordingPage />
  if (mode === 'events') return <EmbedEventsPage />
  return <EmbedGridPage />
}
