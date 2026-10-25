# srcV2 Shared Grid Embed — Design

- **Date:** 2026-06-14
- **Status:** Approved (brainstorm). **Serving architecture revised twice on 2026-06-14** (see "Serving revision") — re-targeted off the admin-ui onto an addon data-plane, then off the (deprecated) `addon-webrtc-native` onto the **`stream-broker`** addon inside `addon-pipeline`.
- **Repos:** `camstack-viewer` (consumer), `camstack-server` (embed bundle hosted by the **`stream-broker`** addon in `packages/addon-pipeline`, branch `feat/admin-ui-embed-player`)
- **Related:** [[project-viewer-srcv2]] grid backlog; the deep per-event "highlights" project (separate); the unmerged embed branch.

## Serving revision (2026-06-14, host corrected)

> **Host correction (2026-06-14, second revision):** the first revision targeted
> `addon-webrtc-native`. That addon is **deprecated** (to be deleted) — the live
> `webrtc-session` capability is provided by the **`stream-broker`** addon inside the
> `addon-pipeline` bundle (`packages/addon-pipeline/src/stream-broker/`). The embed is
> therefore hosted by `stream-broker`, NOT `addon-webrtc-native`. The recorder — which uses
> the same `dataPlane.serve` mechanism — lives in the SAME bundle, so the precedent is
> right next door, and `addon-pipeline` is already allowed to import `@camstack/core`
> (the recorder does), so we use the real `createFileDataPlaneHandler` (wrapped for SPA
> fallback) rather than an inline handler.

The embed is NOT a route in the admin-ui SPA. It is a static web bundle **hosted by the
`stream-broker` addon** (id `stream-broker`, in `packages/addon-pipeline`, hub-only, owns the
`webrtc-session` cap) and served through the hub via the **addon data-plane** —
`ctx.dataPlane.serve({ prefix: 'embed', access: 'authenticated', handler })`, the same
mechanism the recorder uses to serve clips/thumbnails (`prefix: 'playback'`). The hub
reverse-proxies `/addon/stream-broker/embed/*` to a `127.0.0.1` listener in the addon
(protected by the hub↔addon secret header), on the **hub's own origin/cert** as the admin-ui.

Consequences (these override the original Contracts/Security/Components below):
- **Auth (RESOLVED 2026-06-14): the viewer injects the Bearer token into the page BODY**
  (`window.__CAMSTACK_GRID__ = { serverUrl, token, ... }`), exactly as the existing
  single-camera embed does — NOT in the URL. The SDK authenticates tRPC/WS via
  `Authorization: Bearer <token>` only (it does NOT send cookies — confirmed in
  `sdk/system.ts`), so a token is required for the data layer; a same-origin cookie alone
  cannot drive the calls. Token **scope** is whatever the viewer mints (can be scoped to
  webrtc) — that is the "precise scope" goal, met without a URL token.
- **Page-load auth:** the WebView loads `/addon/stream-broker/embed/...` presenting the same
  token as an `Authorization` header on the navigation `URLRequest` (WKWebView supports custom
  request headers); the hub's data-plane `access:'authenticated'` check passes on that. No
  token in the URL.
- **Config KEEPS `serverUrl` + `token`** (injected into the body). The already-built
  `embed-grid-config` schema (serverUrl, token, devices, layout, quality, showName,
  showBadges, muted, paused) is therefore correct as-is — `serverUrl` may also default to
  `window.location.origin` when omitted, but the injected token is required.
- **Both** the existing `/embed/player` and the new grid move into this addon-hosted bundle.
- The already-built pure logic (`embed-grid-config`, `grid-layout`, `grid-messages`) and
  `GridTilePlayer` **relocate** from `addon-admin-ui` into the embed bundle; reused as-is
  (no schema change needed), not rewritten.
- **Build location:** the embed web app lives INSIDE `addon-pipeline` at `embed/` with its own
  `vite` build (React bundled, base `'./'`) → `embed-dist/` at the addon root (packed via the
  `files` allowlist). `addon-pipeline` already ships React widgets, so react/vite are present.
  The `stream-broker` addon serves `embed-dist/` via `ctx.dataPlane.serve` using
  `createFileDataPlaneHandler` (from `@camstack/core`, allowed in this bundle) wrapped with an
  SPA fallback (map `/` and extension-less paths → `index.html`; see
  `src/stream-broker/embed-file-handler.ts`). The embed is a SINGLE html entry; player-vs-grid
  mode + view params come from the query string / injected global
  (e.g. `/addon/stream-broker/embed/?mode=grid&devices=7,8`). At runtime the addon resolves
  `path.resolve(__dirname, '../../embed-dist')` from `dist/stream-broker/`.
- **Open risk (auth):** resolved — the viewer injects a Bearer token in the body (see above);
  the SDK is Bearer-only. The remaining un-verified item is the **page-load** auth: whether the
  data-plane `access:'authenticated'` is satisfied by an admin-ui session cookie (browser test)
  vs. requires the `Authorization` header the WebView sends. Confirm during runtime verification.

## Problem

The srcV2 live grid mounts **one `LiveView` per tile**. On iOS the default player is a
`WKWebView` loading the full admin-ui SPA (`/embed/player`) plus its own WebRTC peer
(`webrtcSession.handleOffer`, one `sessionId` per camera). So an N-camera grid =
**N WebViews each booting the whole SPA + N peers**. This is why a grid "doesn't load":
iOS throttles/stalls under that load. Each tile is an independent session — nothing is shared.

A native single-peer multiplex (V1 `sharedRtcConnection`) is the lightest but renders
natively, and native `react-native-webrtc` has **no H265 decoder** → H265 cameras render
black (the very reason iOS uses a WebView). So native multiplex is not a viable default.

## Goals

- A grid that actually loads on iOS with several cameras.
- **One shared, reusable embed** so the same grid can be consumed by the iOS viewer, the
  web app, and HomeAssistant (an embeddable URL — "one grid for all systems").
- Per-camera interaction (tap → camera detail; long-press → controls) and grid-wide
  controls (mute / pause / quality / layout).
- Immersive full-screen and a self-hiding control bar.
- Live event indication (motion / audio / object) per tile.
- Works in **portrait and landscape**.

## Non-goals (v1)

- Per-camera setting overrides (highlights/quality per single camera) — **grid-wide only**
  for now; extend later.
- Deep highlight configuration (event types, colors, thresholds, global+override) — that is
  the separate "highlights" project; this design leaves the hook ready.
- Single-peer WebRTC multiplex — **N peers in one page** for v1 (no new server capability).
- Android using the embed grid — Android keeps the existing native per-tile wall (iOS-first).
- The cameras-list device-state runtime bug — tracked + fixed as a **separate** debug task.

## Key decisions (from brainstorm)

1. **Approach:** Option 2 — a single WebView loads a new server embed page `/embed/grid`.
2. **Overlay split: hybrid (C).** The embed renders video + *passive* overlays (name, online
   dot, event badges); the native app renders the *interactive* chrome (control bar,
   full-screen, tap routing, per-camera controls panel).
3. **Streaming:** N peers in one page (one SPA boot, one peer per `deviceId`). Big win over
   N WebViews; reuses the existing `webrtcSession` backend unchanged.
4. **Single source of truth:** the grid definition the user builds (ordered `cameraIds` +
   grid-wide options) *is* what parameterizes the embed URL. Export gains a **"Copy embed URL"**
   alongside the JSON, so web/HA embed the identical grid.
5. **Settings are grid-wide** (quality, layout, show-name, show-badges, mute, pause).
6. **Full-screen** = immersive whole-grid (hide nav + status bar, free orientation).
7. **Per-camera controls** = full, reusing the srcV2 accessory-controls registry.
8. **Event badges** = motion + audio + object.
9. **Orientation:** portrait + landscape, with layout recompute + video refit on rotation.
10. **No pixel alignment:** the embed reports the tapped tile's `rect`, so native overlays can
    anchor to that exact tile without fragile measurement.

## Architecture

| Concern | Embed server (`/embed/grid`) | Native app (RN, around the one WebView) |
|---|---|---|
| Video | N WebRTC players (N peers, 1 SPA boot), auto/fixed layout | the shell |
| Passive overlays | camera name + online dot + event badges | — |
| Interaction | captures tap / long-press per tile → `postMessage` | receives → navigates / opens panels |
| Grid commands | applies injected commands to all tiles | sends commands to the WebView |
| Per-camera controls | — | accessory-controls panel (lights/siren/cover/lock/PTZ + on-motion) |
| Navigation / chrome | — | tap → camera detail; immersive full-screen; auto-hide bar |

### Per-platform

- **iOS** → embed grid in WKWebView (decodes H265). Primary target.
- **Web** → same embed via iframe.
- **Android** → existing native per-tile wall (with the control bar already built). Embed on
  Android is a best-effort future item (H265 in Android WebView is unreliable).
- `GridViewScreen` dispatches the renderer the way `LiveView` already dispatches its player.
  Grid-wide controls, full-screen, auto-hide bar, tap→detail and the controls panel work on
  **both** renderers — only the video layer differs.

## Contracts

### Embed config (input)

Injected as `window.__CAMSTACK_GRID__` before content load, mirrored on URL query params for
the iframe/web case:

```
{ serverUrl, token, devices: number[], layout: 'auto'|number,
  quality, showName: boolean, showBadges: boolean, muted: boolean, paused: boolean }
```

All grid-wide. `token` must be a **scoped / short-lived** token in the URL (never the admin
token) — mirrors the single-camera embed contract.

### Embed → RN (`postMessage`, JSON)

| Message | When |
|---|---|
| `{type:'state', state:'connecting'\|'ready'\|'error', message?}` | overall grid state |
| `{type:'tileState', deviceId, state}` | per-tile player state (optional, per-tile spinner) |
| `{type:'tileTap', deviceId, rect}` | short tap → RN opens camera detail |
| `{type:'tileLongPress', deviceId, rect}` | long-press → RN opens accessory-controls panel |
| `{type:'layout', tiles:[{deviceId, rect}]}` | on (re)layout / rotation → RN can anchor overlays |

`rect` = `{x, y, w, h}` in WebView CSS px.

### RN → Embed (injected API `window.__camstackGrid`)

`setMutedAll(b)` · `setPaused(b)` · `setQuality(q)` · `setLayout(l)` · `setShowName(b)` ·
`setShowBadges(b)` · `fit(w, h)` (size on rotation).

## Data flow

1. `GridViewScreen` builds the config from the **grid store** + settings → loads
   `/embed/grid` → injects `__CAMSTACK_GRID__`.
2. The embed boots: creates N peers (`webrtcSession.handleOffer` per `deviceId`), subscribes
   to events for badges, computes the layout (shared `computeGridLayout` logic), renders.
3. The native **control bar** calls `window.__camstackGrid.setX(...)`; the embed applies to all
   tiles. Persisted fields (quality, layout) are saved to the grid store as today.
4. **Tap** → `tileTap` → RN navigates to camera detail. **Long-press** → `tileLongPress` → RN
   opens the native controls panel (`pickAccessoryControl` / `use-accessories`), anchorable to
   `rect`.

### Orientation

On rotation, RN measures the WebView (`onLayout`) and calls `fit(w, h)`; the embed recomputes
the layout (auto = area-maximizing columns; fixed = N columns) and refits the videos. Same
mechanism as the single-camera embed's anti-stale-`innerHeight` fit. In immersive full-screen
the orientation is free; outside it the page follows the device.

## UX features

- **Immersive full-screen:** control-bar toggle → hide tab bar + status bar
  (`expo-status-bar setHidden`), free orientation; exit restores. Embed just fills.
- **Auto-hide control bar:** visible on entry, auto-hides after ~4s of inactivity. A small
  **edge handle** stays visible; tapping the handle *or* the grid reveals the bar and resets
  the timer. Applies in full-screen too.
- **Tap routing:** short tap → camera detail (theater); long-press → native controls panel.
- **Event badges:** in the embed (iOS/web). On the Android native wall, badges are added only
  if cheap, else deferred.

## Components

### Server (`camstack-server`, embed branch)

- New Expo route `camstack/app/embed/grid.tsx` (sibling of `player.tsx`): reads
  `__CAMSTACK_GRID__`, computes layout, renders N players (reuse the single-player component),
  passive overlays (name + dot + badges via the system event subscription), tap/long-press →
  `postMessage` with `rect`, the `window.__camstackGrid` command API, and `fit`.

### Viewer (`camstack-viewer` srcV2)

- `srcV2/live/GridLiveEmbed.tsx` — wraps one `WebView` to `/embed/grid`; injects config;
  parses embed→RN messages; forwards commands; `fit` on layout; self-heal on foreground;
  themed error/retry. Mirrors `LiveViewWebView` patterns.
- `GridViewScreen` — dispatcher: iOS/web → `GridLiveEmbed`; Android → existing native wall.
  Wires the existing `GridControlBar` to the active renderer (embed commands or wall props).
- Immersive full-screen + auto-hide bar + edge handle (native).
- Per-camera controls panel (long-press) reusing accessory-controls; tap → camera detail.
- Export: add **"Copy embed URL"** in `grid-export` (builds `/embed/grid?…` from the grid).
- Pure helpers (config builder, message parser, embed-URL builder) extracted for unit tests.

## Phasing

1. **Server** — `/embed/grid` page (players, layout, passive overlays, tap/long-press +
   command API + fit).
2. **Viewer** — `GridLiveEmbed` + `GridViewScreen` dispatch + control-bar wiring.
3. **Viewer** — immersive full-screen + auto-hide bar + edge handle.
4. **Viewer** — per-camera controls panel + tap→detail + export embed URL.
- **Separate** — cameras-list device-state runtime bug (debug task; suspect
  `use-children-states` gated on `online` or `getChildren` returning nothing on device).

## Testing

- Vitest (pure logic): embed config builder, embed-URL builder, embed→RN message parser,
  `computeGridLayout` (already tested).
- Embed page: integration / manual on device.
- Reuse the verified `LiveViewWebView` patterns for the WebView wrapper.

## Security

- Scoped, short-lived token in the embed URL — never the admin token. Same model as the
  existing single-camera embed.

## Dependencies & caveats

- Depends on the **unmerged** embed branch `feat/admin-ui-embed-player`; this work extends it.
- TLS: WKWebView rejects untrusted certs (existing constraint) — operators use a trusted cert
  or http for the embed.
- One SPA boot for the whole grid is a large win over N WebViews, but N peers still cost CPU;
  single-peer multiplex remains a future optimization (separate server capability).
