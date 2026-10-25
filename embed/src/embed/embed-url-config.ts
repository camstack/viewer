/**
 * embed-url-config — the THIRD grid-config source: a standalone share URL.
 *
 * A shared grid link opened directly in a browser tab is a top-level window
 * with no host — no injected `window.__CAMSTACK_GRID__` and no parent frame to
 * run the `embed-ready` handshake. This module turns the URL itself (v1 schema
 * in `share-url.ts` + `#t=<token>` fragment) into the SAME `GridConfig` shape a
 * host would inject, so `EmbedGridPage` renders the frozen shared view.
 *
 * Because the page is chrome-less and no host exists to push runtime commands,
 * "a shared view has no toolbar and its URL settings are fixed" holds by
 * construction — no extra gating needed.
 *
 * `parseGridUrlConfig` is pure (search/hash/origin passed in). `readGridUrlConfig`
 * is the thin browser wrapper that also STRIPS the fragment from the address
 * bar (`history.replaceState`) so the token doesn't linger in history.
 */
import { parseGridConfig, type GridConfigResult } from './embed-grid-config'
import { decodeGridShareUrl, isShareUrl } from './share-url'

/**
 * Parse a standalone share URL into a full grid config.
 *
 * Returns `null` when the URL does not look like a share link at all (no `v=`,
 * no `#t=`) — the caller then falls through to the classic "config global is
 * not set" error. Returns a distinct `ok:false` for share links that are
 * malformed or missing their token.
 */
export function parseGridUrlConfig(
  search: string,
  hash: string,
  origin: string,
): GridConfigResult | null {
  if (!isShareUrl(search, hash)) return null
  const decoded = decodeGridShareUrl(search, hash)
  if (!decoded.ok) return { ok: false, error: decoded.error }
  if (decoded.token === null) {
    return { ok: false, error: 'share token missing — the link must end with #t=<token>' }
  }
  const p = decoded.params
  // Same defaults a host would inject for the fields the URL doesn't carry.
  const candidate = {
    serverUrl: origin,
    token: decoded.token,
    devices: [...p.devices],
    layout: p.layout,
    quality: p.quality,
    showName: p.showName,
    showBadges: true,
    muted: true,
    paused: false,
    ...(p.highlight !== undefined ? { highlight: p.highlight } : {}),
    ...(p.activeOnly === true ? { activeOnly: true } : {}),
    ...(p.boxes === true ? { showBoxes: true } : {}),
    ...(p.audioOnIds !== undefined && p.audioOnIds.length > 0
      ? { audioOnIds: [...p.audioOnIds] }
      : {}),
  }
  return parseGridConfig(candidate)
}

/**
 * Browser wrapper used by `EmbedGridPage` as `acquireConfig`'s URL source.
 * After reading a share URL (valid OR invalid), the `#t=` fragment is stripped
 * via `history.replaceState` so the token never lingers in the address bar or
 * browser history. Settings are fixed for the session — runtime commands only
 * arrive from a host, which doesn't exist standalone.
 */
export function readGridUrlConfig(): GridConfigResult | null {
  const result = parseGridUrlConfig(location.search, location.hash, location.origin)
  if (result !== null && location.hash !== '') {
    history.replaceState(null, '', location.pathname + location.search)
  }
  return result
}
