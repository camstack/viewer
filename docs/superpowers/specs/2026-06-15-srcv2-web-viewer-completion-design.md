# srcV2 Web Viewer Completion — Design

**Date:** 2026-06-15
**Repos:** `camstack-viewer` (srcV2, primary) + `camstack-server` (`addon-pipeline/embed`)
**Status:** Design — approved in brainstorming, pending spec review.

## Goal

Make the Web/PWA build of `@camstack/viewer` a first-class platform by reusing the
**stream-broker embed** (the same surface the iOS `WKWebView` loads) inside a browser
`<iframe>`, and giving the web app a **desktop shell** (persistent sidebar + fluid
content). Recording/VOD/scrub web UI is explicitly **out of scope** (parked).

## Scope

In scope:
- **Live single-camera** on web (`LiveView.web.tsx` → real iframe player).
- **Grid** on web (`GridLiveEmbed.web.tsx` → iframe grid; `GridViewScreen` already gates
  `USE_EMBED = ios || web` but currently crashes on web because it imports
  `react-native-webview`, which has no web implementation).
- **Intercom (talk-back)** on web for **both** grid and single-camera, reusing the embed
  (grid embed already has it; the **player embed gains intercom**).
- **Responsive desktop shell** (sidebar + fluid content; fullscreen via the browser
  Fullscreen API).
- `npm run build:web` (+ PWA) verified end-to-end against a hub.

Out of scope:
- Recording/VOD/coarse-scrub web UI (the recording embed still receives the bridge for
  consistency, but no web recording surface is built now).
- Deep redesign of non-streaming screens (login, cameras list, events, settings, grids
  list, grid builder) — they already render via `react-native-web`.

## Non-streaming surfaces — already working

Login, cameras list, events, settings, grids list, and the grid builder
(`GridBuilderScreen.web.tsx`, @dnd-kit) already render on web via `react-native-web`.
The two gaps are the **streaming** surfaces, both because `react-native-webview` (v13)
has no web build and crashes at import.

## Architecture

The web reuses the **same** stream-broker embed (`/addon/stream-broker/embed/?mode=grid|player`)
as the iOS WebView. The only difference is the **transport**: a `WKWebView` exposes
`window.ReactNativeWebView` + `injectedJavaScript*`, whereas a browser iframe exposes a
real `window.parent` + `window.postMessage`/`message` events. These are different host
primitives — a WebView page is the top frame (`window.parent === window`), so it cannot
post to a parent.

**Decision (unification depth):** unify the **protocol** (one message vocabulary, one
bridge module, shared command handlers, one OUT function). Keep platform-specific only:
1. the 2–3 physical send/recv lines, and
2. config delivery — **sync inject-before-load on native** (better: no async boot flash),
   **postMessage handshake on web**.

The native path stays **nearly untouched** (low regression risk to the hard-won native
live/grid transport).

### The three host↔embed seams

| Seam | Native (iOS, unchanged) | Web (new) |
|------|-------------------------|-----------|
| **Config IN** | `injectedJavaScriptBeforeContentLoaded` sets `window.__CAMSTACK_GRID__` / `__CAMSTACK_EMBED__` before boot; read synchronously | Handshake: embed posts `embed-ready` → host replies `embed-config{config}` via `postMessage` → embed boots (async) |
| **Commands IN** (live) | `webViewRef.injectJavaScript("window.__camstackGrid.fit(...)")` | A `message` listener routes `embed-command{kind,…}` to the **same** `window.__camstackGrid.*` handlers |
| **Events OUT** | `window.ReactNativeWebView.postMessage(...)` | `window.parent.postMessage(...)` |

### Unified vs platform-specific

Shared (one copy, both platforms):
- The message schema / vocabulary (aligned with existing `grid-messages.ts` /
  `embed-messages.ts`).
- `embed/src/embed/host-bridge.ts` (server) — the embed-side transport centraliser.
- The command handler object (`window.__camstackGrid = { fit, setQuality, setAudioOn,
  setActiveMic, setPaused, setLayout, setShowName, setShowBadges, … }`) — unchanged names.
- The single OUT function (`postToHost`).

Platform-specific (a few lines):
- Physical send/recv (`ReactNativeWebView` vs `parent.postMessage` / `message`).
- Config delivery (sync inject on native, handshake on web).

## Embed changes (`camstack-server` / `addon-pipeline/embed`)

1. **New `src/embed/host-bridge.ts`** — transport centraliser:
   - `emitHost(msg)`: post via `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`
     if present, else `window.parent.postMessage(msg, hostOrigin)` (only when
     `window.parent !== window`).
   - `onHostCommand(handler)`: add a `window` `message` listener that validates origin and
     dispatches `embed-command` payloads to the shared handlers. (Native keeps calling the
     `window.__camstackGrid.*` handlers directly via injected JS; web routes through this
     listener to the same handlers.)
   - `acquireConfig(mode)`: returns the sync global if set; otherwise, when in an iframe,
     posts `embed-ready{mode}` to the parent and resolves a Promise on `embed-config`.
2. **Refactor the OUT emit to a single path.** `EmbedGridPage` already uses `postToHost`;
   `EmbedPlayerPage` and `EmbedRecordingPage` currently inline
   `window.ReactNativeWebView?.postMessage(...)` — route them through `emitHost` so the
   `parent` fallback applies uniformly.
3. **Make the 3 pages read config via `acquireConfig`** with a loading state until config
   arrives (grid/player already render a `connecting` state; reuse it).
4. **Add intercom to the player embed** (single-cam): factor `useExclusiveIntercom` into a
   reusable single-device intercom (or instantiate it for one device), expose a
   `setMic(on)` command + emit a `micState` event. Talk-back now lives in the iframe for
   both grid and single-cam.
5. **Origin handling:** host→embed `postMessage` uses `targetOrigin = hub origin`; embed
   validates `event.origin` against its own `serverUrl` origin (the bundle is a public
   shell; all data stays token-gated, so origin checks are defence-in-depth, not the auth
   boundary).

## Viewer changes (`camstack-viewer` / `srcV2`)

1. **New `grid-embed/iframe-bridge.ts`** (web host side): mounts/queries the `<iframe>`,
   runs the handshake (listen `embed-ready` → post `embed-config`), sends
   `embed-command`s, receives events. Mirrors the native command set built by
   `embed-messages.ts` `gridCommandScript` (the web variant posts instead of injecting).
2. **`LiveView.web.tsx`** — replace the placeholder with a real `<iframe>` `mode=player`
   wired through the bridge. Implements `LiveViewHandle` (`getStats` from the iframe via a
   command/response; `startPip` = browser PiP or no-op).
3. **`GridLiveEmbed.web.tsx`** (new) — `<iframe>` `mode=grid` via the bridge, **same props
   and callbacks** as the native `GridLiveEmbed` (`onTileTap/LongPress/Open`,
   `onAudioToggle`, `onPauseToggle`, `onPtzOpen`, `onStateChange`, `audioOnIds`,
   `pausedIds`, `quality`, `layout`, `showName`, `highlight`, `activeOnly`, `ptzIds`).
   Metro auto-selects it on web → `GridViewScreen` works unchanged.
4. **`use-intercom.web.ts`** — delegate to the iframe via the bridge: talk toggle →
   `setMic` command; read `micState` events. Covers grid and single-cam.
5. **Desktop shell (option B):** the sidebar already exists (`TabsNavigator` keys off the
   shortest side ≥768). On wide web: persistent left sidebar, fluid full-width content,
   grid + camera-detail use the available space. Add **browser Fullscreen API** on the
   iframe container for camera-detail and grid.

## Bridge protocol (the contract)

Naming stays aligned with the existing `grid-messages.ts` / `embed-messages.ts` so native
and web share one vocabulary.

- **Host → Embed:** `embed-config{config}`, `embed-command{kind, …}` where `kind ∈`
  `fit | setQuality | setLayout | setMuted/setAudioOn | setPaused | setShowName |
  setHighlight | setActiveOnly | reconnect | setTarget | setMic`.
- **Embed → Host:** `embed-ready{mode}`, then existing events: `state`, `tileTap`,
  `tileLongPress`, `tileOpen`, `audioToggle`, `pauseToggle`, `ptzOpen`, `layout`,
  `micState`, `position`.

## Testing

- **Unit (vitest, both repos):** transport selection (`ReactNativeWebView` vs `parent`);
  handshake state machine; config parse from `embed-config`; command serialization
  round-trip. Extend the existing `embed-grid-config` / `grid-messages` specs.
- **Manual / E2E:** `npm run build:web` → load the PWA against a hub → verify grid loads N
  tiles, single-cam live plays, talk-back works (grid + single-cam), fullscreen toggles,
  and the embed self-heals on a network transition. Verify the native iOS path still works
  (no regression in inject-before-load + `ReactNativeWebView`).

## Risks / gotchas

- **Cross-origin:** the PWA/HA-addon is often served from a different origin than the hub →
  the iframe is cross-origin. `postMessage` works, but the host must validate `event.origin`
  against the `serverUrl` origin and post with an explicit `targetOrigin`.
- **TLS / mixed content:** an https PWA loading an http hub (or a self-signed cert) is
  blocked by the browser, mirroring WKWebView ATS. Operators need a trusted cert (same
  caveat as native).
- **Async config on web** → the 3 pages need a loading state until `embed-config` arrives.
- **Do not break native:** the sync-global + `ReactNativeWebView` path stays the default;
  the `parent`/handshake branch activates only when the global is absent **and**
  `window.parent !== window`.
- **Pre-commit eslint:** no `react-hooks/*` eslint-disable in `embed/` or `ui-library`
  files (pre-commit fails). Build workspace dep dists first (`@camstack/types`, `core`,
  `kernel`, `sdk`, `ui-library`) before type-aware lint.
- **Two-repo coordination:** the embed change must be **deployed to the hub** for web to
  work (`addon-pipeline` full `npm run build` then `camstack deploy . --no-build`);
  `build:web` is independent but useless without the embed change live. Re-check
  `camstack-server` main HEAD before committing (concurrent backend writer).
- **Never `git add -A`** in agents (stages `node_modules`/`.expo` symlinks) — stage explicit
  paths.

## Sequencing (for the implementation plan)

1. **Embed bridge (server):** `host-bridge.ts` + unify OUT + `acquireConfig` in the 3
   pages, behind the iframe branch (native untouched). Unit tests.
2. **Player-embed intercom (server):** add single-cam intercom + `setMic`/`micState`.
3. **Viewer web bridge:** `iframe-bridge.ts` + `LiveView.web.tsx` + `GridLiveEmbed.web.tsx`
   + `use-intercom.web.ts`. Unit tests.
4. **Desktop shell:** sidebar persistence + fluid content + fullscreen.
5. **Verify:** `ts-check`, `test:v2`, embed build, deploy to hub, `build:web`, manual PWA
   pass + native regression check.
