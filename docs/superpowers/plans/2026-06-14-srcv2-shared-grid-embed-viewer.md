# Shared Grid Embed — Viewer Integration (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. TDD the pure helpers (write the failing test first). Steps use `- [ ]` checkboxes.
>
> **Depends on Plan 1 (DONE):** the embed is served by the `stream-broker` addon at `https://<hub>/addon/stream-broker/embed/?mode=grid` (and `?mode=player`). See spec `2026-06-14-srcv2-shared-grid-embed-design.md`.

**Goal:** Consume the shared grid embed in the srcV2 viewer. iOS/web load ONE `WebView`/iframe pointing at the stream-broker embed (one SPA boot, N peers); Android keeps the existing native wall. The native app injects the grid config, wires the existing control bar to the embed, adds immersive full-screen + auto-hide bar, routes tap→camera detail and long-press→accessory-controls, and adds "Copy embed URL".

**Repo:** `camstack-viewer`, code under `srcV2/`. Tests: Vitest (`srcV2/**/__tests__/*.spec.ts`).

---

## Key facts (from code map, 2026-06-14)

- **Mirror** `srcV2/live/LiveViewWebView.tsx` (single-cam embed): `injectedJavaScriptBeforeContentLoaded` sets `window.__CAMSTACK_EMBED__`; `onMessage` parses `{type:'state'}`; `injectJavaScript(...)` drives `window.__camstackEmbed.setX`; `AppState` → `reload()` self-heal; error/retry overlay with `ActivityIndicator`/`RotateCw`.
- **Token + serverUrl:** `useServer()` (`srcV2/app/ServerProvider.tsx`) → `{ server: { serverUrl }, token }`. `token` is the hub session JWT.
- **AUTH (FINAL: embed bundle served `access:'public'`).** The embed bundle is a non-sensitive app shell (HTML/JS, no secrets); it carries NO data without a host-injected token (renders a config-error + fetches nothing). ALL data stays token-gated at the SDK/tRPC layer. So the stream-broker serves the embed prefix **`access:'public'`** (committed `15f9256b`), and `GridLiveEmbed` loads the embed URL **DIRECTLY** (`buildGridEmbedUrl(serverUrl,'grid')`) with NO Authorization header / no cookie — the token rides only in the injected body config. Runtime-verified: index.html + JS asset both 200 WITHOUT auth; page shows config-error (no data) without a token. This eliminated the earlier cookie/`@react-native-cookies`/`/api/embed-auth` approaches. (The `GET /api/embed-auth` endpoint added earlier — `648efbe3` — is now UNUSED dead code; remove or keep as a fallback for any future authenticated embed.)
- **Grid store** (`srcV2/store/grid-store.ts`): `Grid { id, name, cameraIds[], hiddenCameraIds?, options? }`, `GridOptions { showName?, quality?: 'auto'|'high'|'medium'|'low', layout?: 'auto'|number }`. `resolveGridOptions(grid.options, globalDefaults)`. Pure reducers tested in `__tests__/grid-store.spec.ts` (immutability pattern).
- **GridViewScreen** (`srcV2/screens/GridViewScreen.tsx`): resolves cameras, `computeGridLayout(n,w,h,layout)`, renders `<GridWall>` + `<GridControlBar>` with `paused/muteAll/quality/layout` + `onTogglePause/onToggleMute/onCycleQuality/onCycleLayout` (cycles via `nextInCycle`).
- **Accessories:** `useAccessories(deviceId)` (`srcV2/data/use-accessories.ts`), `useCapMutator(deviceId)` + `useSwitchStatus`/`useLockStatus`/… (`use-accessory-controls.ts`). Camera detail nav: `router.push('/camera/'+id)` (expo-router). Fullscreen precedent: `expo-status-bar` `<StatusBar hidden/>` + `expo-screen-orientation` `lockAsync` (see `CameraDetailScreen.tsx`).
- **Platform dispatch:** `Platform.OS` (`'ios'|'android'|'web'`); `.web.tsx` auto-selected by Metro. `qualityToTarget` in `srcV2/live/quality-target.ts`.

---

## Phase A — Pure helpers (TDD first)

All in `srcV2/grid-embed/` with `__tests__`. No React. These are the testable core.

### Task A1: embed config builder
- Create `srcV2/grid-embed/embed-config.ts` + test.
- `buildGridEmbedConfig(input: { serverUrl, token, deviceIds: number[], options: ResolvedGridOptions, muted, paused }): GridEmbedConfig` returning `{ serverUrl, token, devices, layout, quality, showName, showBadges, muted, paused }` — the EXACT shape the server `embed-grid-config` zod schema validates (devices = ordered visible cameraIds; showBadges default true).
- [ ] Failing test: builds correct shape, filters hidden cameras, maps `options.layout/quality/showName`.
- [ ] Implement. [ ] Test green. [ ] Commit.

### Task A2: embed URL builder
- Create `srcV2/grid-embed/embed-url.ts` + test.
- `buildGridEmbedUrl(serverUrl: string, mode: 'grid'|'player', params?: {devices?: number[]}): string` → `${serverUrl}/addon/stream-broker/embed/?mode=grid[&devices=7,8]`. NO token in the URL (security: token goes in body + cookie). Used by the WebView `uri` and by "Copy embed URL".
- [ ] Failing test (trailing-slash handling, mode, devices csv). [ ] Implement. [ ] Green. [ ] Commit.

### Task A3: page→host message parser + host→page command serializer
- Create `srcV2/grid-embed/embed-messages.ts` + test. Mirror the server `grid-messages` contract.
- `parseGridHostMessage(raw: string): GridHostMessage | null` for `{type:'state'|'layout'|'tileTap'|'tileLongPress', …}` (rect = `{x,y,w,h}`).
- `gridCommandScript(cmd)` → the `window.__camstackGrid.setX(...)` / `fit(w,h)` JS string for `injectJavaScript` (one per command: setMutedAll/setPaused/setQuality/setLayout/setShowName/setShowBadges/fit).
- [ ] Failing tests (valid/invalid parse; each command serializes; rejects junk). [ ] Implement. [ ] Green. [ ] Commit.

---

## Phase B — GridLiveEmbed (the WebView wrapper)

### Task B1: GridLiveEmbed component
- Create `srcV2/grid-embed/GridLiveEmbed.tsx` (native) — mirror `LiveViewWebView` structure.
- Props: `{ devices: number[]; options: ResolvedGridOptions; muted; paused; onTileTap(deviceId, rect); onTileLongPress(deviceId, rect); onState(state); onLayout(tiles) }`.
- Behavior:
  - **Auth cookie:** on mount (and token change), `await CookieManager.set(serverUrl, {name:'camstack_session', value: token, httpOnly:true, secure:true, path:'/'})` BEFORE rendering the WebView (gate rendering on a `cookieReady` state). Add dep `@react-native-cookies/cookies` (verify it's installed; if not, add to package.json + prebuild note).
  - `uri = buildGridEmbedUrl(serverUrl,'grid')`; `injectedJavaScriptBeforeContentLoaded = window.__CAMSTACK_GRID__ = ${JSON.stringify(buildGridEmbedConfig(...))}; true;`.
  - `onMessage` → `parseGridHostMessage` → dispatch `onState/onLayout/onTileTap/onTileLongPress`.
  - `useEffect` on muted/paused/quality/layout/showName → `injectJavaScript(gridCommandScript(...))` (no reload).
  - `onLayout` (RN View) → `injectJavaScript(gridCommandScript({fit, w, h}))` on size/rotation change (anti-stale-innerHeight, like the single-cam fit).
  - `AppState active` → `reload()` self-heal; error/retry overlay (reuse the LiveViewWebView pattern).
- [ ] Implement. [ ] `npm run ts-check` clean. [ ] Manual: loads on a real hub, tiles render, commands work. [ ] Commit.

### Task B2: GridLiveEmbed.web.tsx (iframe variant)
- Create `srcV2/grid-embed/GridLiveEmbed.web.tsx` — an `<iframe src={buildGridEmbedUrl(...)} >`; inject config via `iframe.contentWindow` postMessage handshake OR a query-less same-origin body inject (web is same-origin → cookie already present from the admin session; still pass token in body via postMessage). Commands via `iframe.contentWindow.postMessage`. (If web parity is deferred, render a "use native" placeholder and note it.)
- [ ] Implement (or stub + note). [ ] ts-check. [ ] Commit.

---

## Phase C — GridViewScreen dispatch + control-bar wiring

### Task C1: renderer dispatch
- Modify `srcV2/screens/GridViewScreen.tsx`: `const useEmbed = Platform.OS === 'ios' || Platform.OS === 'web'`. If `useEmbed` render `<GridLiveEmbed devices={visibleIds} options={options} muted={muteAll} paused={paused} … />`; else the existing `<GridWall>`. Keep ONE `<GridControlBar>` above both.
- [ ] Implement. [ ] ts-check. [ ] Commit.

### Task C2: wire control bar to the embed
- The existing `GridControlBar` callbacks (`onTogglePause/onToggleMute/onCycleQuality/onCycleLayout`) already mutate local state; for the embed path that state flows into `GridLiveEmbed` props → which injects commands. Persisted fields (quality/layout) still call `setGridOptions` as today. Confirm the wall path is unchanged on Android.
- [ ] Implement. [ ] ts-check + existing grid tests green. [ ] Commit.

---

## Phase D — Immersive full-screen + auto-hide control bar

### Task D1: immersive full-screen
- Add a full-screen toggle (control-bar button): hide tab bar + `<StatusBar hidden />`, free orientation (`ScreenOrientation.unlockAsync()` in FS, restore on exit). The embed just fills. Mirror `CameraDetailScreen` fullscreen.
- [ ] Implement. [ ] Commit.

### Task D2: auto-hide bar + edge handle
- Bar visible on entry, auto-hides after ~4s inactivity; a small edge handle stays; tapping the handle OR the grid reveals the bar + resets the timer. Extract the timer logic into a tested pure hook/helper where feasible.
- [ ] Implement (+ test the timer reducer). [ ] Commit.

---

## Phase E — Tap → detail, long-press → accessory controls

### Task E1: tap → camera detail
- On `onTileTap(deviceId, rect)` → `router.push('/camera/'+deviceId)`.
- [ ] Implement. [ ] Commit.

### Task E2: long-press → accessory-controls panel anchored to rect
- On `onTileLongPress(deviceId, rect)` → open a native panel reusing `useAccessories(deviceId)` + `useCapMutator` (+ the status hooks), anchored near `rect`. Reuse the existing controls UI from `CameraDetailScreen`'s DevicesPanel if extractable.
- [ ] Implement. [ ] ts-check. [ ] Commit.

---

## Phase F — Copy embed URL

### Task F1: export "Copy embed URL"
- In the grid export UI (`srcV2/data/grid-export.ts` / `GridBuilderHeader`), add "Copy embed URL" using `buildGridEmbedUrl(serverUrl,'grid',{devices})` + `Clipboard`/`Share`. Note: the URL has NO token — the consumer must supply auth (web/HA reuse). Document this.
- [ ] Implement. [ ] Commit.

---

## Verification

- `npm run ts-check` clean; `npx vitest run` green (Phase A/D pure helpers + existing grid tests).
- Device: iOS dev build vs the remote hub — grid loads in ONE WebView, N peers, control bar drives all tiles, fullscreen + auto-hide work, tap→detail, long-press→controls, rotation refits. Android still uses the native wall.

## Open risks / decisions

- **`@react-native-cookies/cookies`** must be installed + included in the dev build (native module → `prebuild` + rebuild). If not present, add it (Task B1 prerequisite). Verify it can set an httpOnly+secure cookie for an https origin in WKWebView.
- **TLS:** WKWebView rejects untrusted certs (existing constraint) — operators use a trusted cert for the hub.
- **Web parity** (iframe) may lag native; acceptable for v1 (iOS-first).
- **Event badges** (`setShowBadges`) are a server-side stub (Plan 1b) — the command is wired but no-ops until then.

## Out of scope
- Server embed (Plan 1, DONE). Event badges (Plan 1b). Deleting addon-webrtc-native. Cameras-list device-state bug (separate).
