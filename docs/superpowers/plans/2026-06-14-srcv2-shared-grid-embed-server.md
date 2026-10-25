# Shared Grid Embed — stream-broker-hosted Server Bundle (Plan 1, retargeted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Host history:** v1 targeted an admin-ui React Router route (obsolete). v2 targeted `addon-webrtc-native` (obsolete — that addon is DEPRECATED). **This v3 targets the `stream-broker` addon inside `addon-pipeline`**, which actually owns the live `webrtc-session` capability. See spec `2026-06-14-srcv2-shared-grid-embed-design.md` → "Serving revision (host corrected)".

**Goal:** Ship a chrome-less embed web bundle, hosted by the `stream-broker` addon and served at `/addon/stream-broker/embed/`, that renders either a single camera (`?mode=player`) or an N-camera grid (`?mode=grid`) — one SPA boot, N WebRTC peers — with name/status overlays, tap/long-press routing to the hosting app, and a grid command API. This is the dependency root the viewer (Plan 2) consumes.

**Architecture:** The embed app lives INSIDE `packages/addon-pipeline/embed/` with its own vite build (React bundled, base `'./'`) → `embed-dist/` at the addon root. It is a SINGLE html entry; `EmbedApp` dispatches on `?mode=` — `player` → `EmbedPlayerPage` (ported from admin-ui), `grid` → `EmbedGridPage` (new). Each page reads its config from an injected `window` global (`__CAMSTACK_EMBED__` / `__CAMSTACK_GRID__`), builds one `System` SDK from `{serverUrl, token}` (Bearer-token-only; injected in the page body, NOT the URL), and renders `CameraStreamPlayer` + `useDeviceWebrtc` peers. The `stream-broker` addon serves `embed-dist/` via `ctx.dataPlane.serve({prefix:'embed', access:'authenticated'})` using `createFileDataPlaneHandler` (from `@camstack/core`) wrapped for SPA fallback.

**Tech Stack:** React 19, `@camstack/ui-library`, `@camstack/sdk`, `@camstack/types`, `zod`, `@tanstack/react-query`, vite 6, Vitest + jsdom. **Repo:** `camstack-server`, branch `feat/admin-ui-embed-player`, worktree `/private/tmp/camstack-embed-player`, package `packages/addon-pipeline`, app under `embed/`.

**Reference:**
- `packages/addon-admin-ui/src/pages/EmbedPlayerPage.tsx` — the single-camera embed to PORT.
- `packages/addon-pipeline/src/recorder/index.ts:256` — `ctx.dataPlane.serve` precedent (same bundle).
- `packages/addon-pipeline/src/stream-broker/embed-file-handler.ts` — the SPA-fallback handler (DONE).
- Already-built + tested files to RELOCATE: `addon-admin-ui/src/pages/embed/{embed-grid-config,grid-layout,grid-messages}.ts` (+ `__tests__`) and `addon-admin-ui/src/components/shared/GridTilePlayer.tsx`.

---

## Phase 0 — Serving spike (DONE in addon-pipeline)

The serving foundation is implemented and build-verified on `stream-broker`:
- ✅ `packages/addon-pipeline/embed/` scaffold (index.html, vite.config.ts → `embed-dist/`, src/main.tsx, src/EmbedApp.tsx placeholder showing `mode` + device count). `npm run build:embed` works (React bundled, 195 kB, relative `./assets`).
- ✅ `src/stream-broker/embed-file-handler.ts` — `createEmbedSpaHandler(root)` wrapping `createFileDataPlaneHandler` with SPA fallback (`/` + extension-less → `/index.html`, query preserved).
- ✅ `src/stream-broker/addon.ts` — `dataPlane.serve({prefix:'embed', access:'authenticated'})` in `onInitialize` (resolves `path.resolve(__dirname,'../../embed-dist')`), handle stored + `dispose()` in `onShutdown`.
- ✅ `package.json` — `build:embed` script (chained into `build`), `embed-dist` added to `files`.
- ✅ Typecheck clean for the changed files (`embed-file-handler.ts`, `stream-broker/addon.ts`); `build:server` produces `dist/stream-broker/index.js` with the serve wiring intact (`__dirname` + `resolve(...,"../../embed-dist")` + `prefix:"embed"` present in the CJS).
- ✅ **Runtime VERIFIED (2026-06-14):** deployed `addon-pipeline` to the local hub (`camstack deploy . --no-build`); `https://localhost:4443/addon/stream-broker/embed/?mode=grid&devices=7` renders the scaffold ("CamStack embed scaffold / mode: grid / no config") in-browser. Found + fixed two issues during verification: (a) core's `DEFAULT_CONTENT_TYPES` lacked web MIME types → HTML downloaded instead of rendering → added `.html`/`.js`/`.css`/… to `packages/core/src/http/authenticated-file-server.ts` (consumers can still override). (b) the wrong-origin/wrong-addon traps from the earlier webrtc-native attempt. **Auth note:** the browser admin-ui session satisfies the data-plane `access:'authenticated'` for a raw navigation (page rendered); an upload-scoped CLI token does NOT (curl → 403). The iOS WebView will present a Bearer `Authorization` header instead.

### Prerequisite gate (USER-driven — PASSED ✅)

`stream-broker` is a hub-only **core pipeline** addon, so it should already be enabled on the dev hub. Deploy the rebuilt bundle and load through the hub:
```bash
cd /private/tmp/camstack-embed-player/packages/addon-pipeline
npm run build:embed && npm run build:server      # embed-dist/ + dist/stream-broker
# deploy the pipeline bundle to the LOCAL hub (camstack deploy / scripts/deploy-addon.sh),
# then load on the HUB origin (port 4443), NOT the admin-ui vite dev server:
#   https://localhost:4443/addon/stream-broker/embed/?mode=grid&devices=7
```
Expected: the scaffold page loads (data-plane `access:'authenticated'` passes) and shows `mode: grid`. Watch the hub log for `stream-broker: embed served`. **If 401/403:** the data-plane auth isn't satisfied by the browser session — present the Bearer token via an `Authorization` header (as the WebView will) or resolve the auth model. **If it falls through to the admin-ui SPA (React Router "No routes matched"):** you hit the wrong origin (admin-ui vite port) or the bundle wasn't redeployed.

---

## Target file layout (inside `packages/addon-pipeline/`)

```
embed/
  index.html                         # DONE (entry → src/main.tsx)
  vite.config.ts                     # DONE (base './', outDir ../embed-dist)
  vitest.config.ts                   # NEW (jsdom, for grid-messages + component tests)
  tsconfig.json                      # NEW (jsx react-jsx, lib DOM — typecheck the embed app)
  src/
    main.tsx                         # DONE
    EmbedApp.tsx                     # REWRITE: dispatch on ?mode= (player|grid)
    embed/{embed-grid-config,grid-layout,grid-messages}.ts + __tests__   # RELOCATED
    components/GridTilePlayer.tsx    # RELOCATED (imports → ../embed/*)
    pages/EmbedPlayerPage.tsx        # PORTED from admin-ui
    pages/EmbedGridPage.tsx          # NEW
src/stream-broker/embed-file-handler.ts   # DONE
src/stream-broker/addon.ts                # DONE (serve wired)
```

---

## Task 0: Wire the embed app's deps + test toolchain

**Files:** `packages/addon-pipeline/package.json`, `embed/vitest.config.ts`, `embed/tsconfig.json`.

- [ ] **Step 1: Add embed deps.** `addon-pipeline` already has `react`/`react-dom` (peerDeps), `zod`, `@vitejs/plugin-react`, vite, vitest. Add as devDeps (versions from `addon-admin-ui`): `@camstack/ui-library` (`*`), `@camstack/sdk` (`*`), `@tanstack/react-query` (`^5.90.0`), `@trpc/react-query` (`^11.16.0`), `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@types/react`, `@types/react-dom`. Then `npm install` at the repo root.
- [ ] **Step 2: `embed/vitest.config.ts`** — `environment: 'jsdom'`, include `embed/src/**/*.spec.{ts,tsx}`. Add `"test:embed": "vitest run -c embed/vitest.config.ts"` to package.json.
- [ ] **Step 3: `embed/tsconfig.json`** — extend base, `jsx: react-jsx`, `lib: ["DOM","ESNext"]`, include `embed/src`. (Keeps the embed app OUT of the package `tsc --noEmit`, which is `rootDir: src` — embed/ is already excluded.) Add `"typecheck:embed": "tsc --noEmit -p embed/tsconfig.json"`.
- [ ] **Step 4: Verify + commit** — `npm run build:embed` still builds; `npx tsc --noEmit -p embed/tsconfig.json` resolves the new deps. Commit.

## Task 1: Relocate the 4 built files (pure logic + GridTilePlayer)

**RELOCATE, do not re-author.** Source: `addon-admin-ui`. Target: `addon-pipeline/embed/src/`.

- [ ] **Step 1:** `git mv packages/addon-admin-ui/src/pages/embed packages/addon-pipeline/embed/src/embed` (moves the dir as a unit → test relative imports `../embed-grid-config` stay valid).
- [ ] **Step 2:** `git mv packages/addon-admin-ui/src/components/shared/GridTilePlayer.tsx packages/addon-pipeline/embed/src/components/GridTilePlayer.tsx`; rewrite its imports `../../pages/embed/embed-grid-config` → `../embed/embed-grid-config` and `../../pages/embed/grid-messages` → `../embed/grid-messages`.
- [ ] **Step 3:** `npm run test:embed` → 18 tests PASS in the new home.
- [ ] **Step 4:** Commit `refactor(embed): relocate grid config/layout/messages + GridTilePlayer into addon-pipeline`.

## Task 2: Port EmbedPlayerPage

**Files:** Create `embed/src/pages/EmbedPlayerPage.tsx` (port of `addon-admin-ui/src/pages/EmbedPlayerPage.tsx`). Contract FIXED: IN `window.__CAMSTACK_EMBED__`; OUT `postMessage({type:'state'})`; mounted `window.__camstackEmbed`. Copy verbatim, adjust only relative import paths (package imports unchanged). Typecheck + commit.

## Task 3: Build EmbedGridPage (N players)

**Files:** Create `embed/src/pages/EmbedGridPage.tsx` — reads `readGridConfig()`, one `System`, names via `deviceManager.listAll`, layout via `computeGridLayout`, N `GridTilePlayer`, `window.__camstackGrid` API (`setMutedAll/setPaused/setQuality/setLayout/setShowName/setShowBadges(stub)/fit`), reports `state`/`layout`/`tileTap`/`tileLongPress`. (Logic per the earlier draft; imports → `./embed/*`, `../components/GridTilePlayer`.) Typecheck + commit.

## Task 4: EmbedApp dispatcher on `?mode=`

**Files:** Rewrite `embed/src/EmbedApp.tsx` — read `?mode=` and render `EmbedGridPage` (`grid`, default) or `EmbedPlayerPage` (`player`); each page reads its own injected global. Build (`build:embed`) + `test:embed` + `typecheck:embed`, commit.

## Task 5: Runtime verification through the hub

`npm run build:embed && npm run build:server`, redeploy pipeline to the local hub, load `?mode=player` (with `__CAMSTACK_EMBED__`) then `?mode=grid` (with `__CAMSTACK_GRID__`, `devices:[7,8,9]`) at `https://localhost:4443/addon/stream-broker/embed/...`. Confirm: video plays, ONE document + N `RTCPeerConnection`s, `setMutedAll/setLayout/setPaused` live, tap/long-press post (stub `window.ReactNativeWebView.postMessage`).

---

## Self-Review

- **Host correct:** `stream-broker` (owns `webrtc-session`), in `addon-pipeline`, served via the recorder's `dataPlane.serve` precedent in the same bundle; `@camstack/core` import allowed → real file handler + SPA wrapper.
- **No re-authoring:** Tasks 1-3 reuse already-tested code; only homes + import paths change. Net-new = EmbedGridPage + the EmbedApp dispatcher + toolchain wiring.
- **Phase-0 done:** serving wired + build-verified; only runtime verification remains (the gate).
- **Deferred:** event badges (`setShowBadges` stub → Plan 1b); viewer integration → Plan 2; deleting the deprecated `addon-webrtc-native` (incl. its abandoned `embed/` scaffold + serve wiring, commit `78850564`) → separate cleanup.

## Out of scope (tracked elsewhere)

- Event badges → **Plan 1b**. Viewer integration (`GridLiveEmbed`, dispatcher, full-screen, auto-hide bar, controls panel, "Copy embed URL") → **Plan 2**. Cameras-list device-state runtime bug → separate debug task. Deleting `addon-webrtc-native` → separate cleanup.
