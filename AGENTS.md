# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` is a one-line `@AGENTS.md` import for Claude Code; edit only this file.

## UI work

<!-- camstack-ui-pointer:begin — written by `node scripts/ui/cli.mjs pointers`; edit the generator, not this block -->
**UI work here** (a screen, sheet, row, the embed player): follow the `camstack-ui` then `camstack-ui-viewer` skills. They live in the server repository — `../.claude/skills/camstack-ui/SKILL.md` and `../.claude/skills/camstack-ui-viewer/SKILL.md` when this repo is its `camstack/` submodule, else https://github.com/camstack/server/blob/main/.claude/skills/camstack-ui-viewer/SKILL.md — with the rules in `docs/ui/viewer.md` there.

- **Layout changes are co-designed with the operator: ask before restructuring a screen.**
- Search before building: `npm run ui:find -- "<need>"`, `npm run ui:show -- <Name>`, `npm run ui:tokens`.
- Colours only from `src/theme/tokens.ts` via `useTheme().colors`; no hex or named colours, no raw `Modal` (→ `SheetModal`), no `Alert.alert` (→ `useConfirm`).
- Every user-facing string is `t(…)` with a key in `locales/en.json` AND `locales/it.json`.
- Done = `npm run ui:check -- <files>` with 0 new findings, **`npm run verify:push` GREEN** (same gates as TypeScript Check: ts-check + test:v2 + embed when touched), and the screen seen on a simulator and the web build (≈390 px and desktop), dark and light.
- **Before every commit (and before push) — `npm run verify:push` GREEN.** It grades the changed set against `origin/main` (working tree included). A single green vitest file is NOT the CI gate.
<!-- camstack-ui-pointer:end -->

## Shipping a release

**Shipping a release** (OTA `update:*`, `release:ios:*` / `release:android:*`, a version bump, `build:orchestrator`, the submodule pin): load `.claude/skills/camstack-viewer-release/SKILL.md` first.

- **Write the `src/app/whats-new.ts` entry FIRST** — one short line per change, en + it, under 90 characters. The ship scripts run `scripts/lib/check-whats-new.js` and refuse to bump without it.
- Check viewer CI (`gh run list --repo camstack/viewer`) before shipping; a red CI does not stop an OTA.
- `runtimeVersion` stays fixed on an OTA and moves only on a native release.

## Project Overview

CamStack Viewer is the universal client (iOS, Android, Web/PWA) for the CamStack hub, built with Expo ~54 / React Native 0.81.5 / React 19 / TypeScript 5.9. It talks to the hub exclusively over the `@camstack/sdk` tRPC client and owns the WebRTC embed player used by native, web, and external iframe integrations.

`src/` is the live app (renamed from `srcV2` on 2026-07-17; the legacy multi-backend app that previously lived in `src/` — adapters for an external hub and a separate NVR, sharedRtcConnection, SQLite/IndexedDB layer — was deleted the same day; recover it from git history if ever needed).

## Common Commands

### Development
```bash
npm run start:dev          # Start with expo-dev-client (required for WebRTC)
npm run web                # Start web platform
npm run run:ios            # Build and run on iOS simulator
npm run run:android        # Build and run on Android emulator/device
```

### Code Quality & Tests
```bash
npm run verify:push        # BEFORE every commit/push — TypeScript Check gates on the changed set + ui:check
npm run ts-check           # guards + tsc, resolving @camstack/* like the APP does (CI runs this)
npx tsc -p tsconfig.workspace.json --noEmit   # same, but against the server SOURCE next door
npm run lint               # ESLint via expo lint
npm run test:v2            # Vitest unit suite (src/**/__tests__/*.spec.ts, scripts/**/__tests__/*.spec.ts)
npm run test:embed         # Browser embed suite (embed/src/**/*.spec.ts)
npm run ui:find -- "<need>"   # kit components for a need (built live from src/components/ui)
npm run ui:show -- <Name>     # one kit export: props, call sites
npm run ui:tokens             # tokens.ts colours, dark / light
npm run ui:check -- <files>   # off-system UI (raw hex, raw Modal, …) — also run by verify:push on changed files
npm run ui:pointers           # regenerate the UI block above + .cursor/rules (ts-check verifies it)
```

**Before every commit (and before push):** `npm run verify:push` must be GREEN.
It mirrors camstack-server's `verify:push` for this repo: changed files vs
`origin/main` (working tree included) → `ts-check` + full `test:v2` + embed
build when `embed/` moved + `ui:check` on touched UI sources. One green vitest
file is not the CI gate.

### Building & Releases
```bash
npm run build:web          # Export PWA to dist/
npm run sync:embed         # Build web + self-contained OTA embed artifacts
npm run build:orchestrator # Web build with /viewer base path + copy into addon-pipeline-orchestrator assets
npm run prebuild:clean     # Regenerate ios/ and android/ from scratch
npm run update:patch       # Bump patch version + EAS OTA push + git push
npm run release:ios:patch  # Full iOS release (bump + EAS build + submit)
npm run release:android:patch  # Full Android release
```

The proven ship chain for an app change: whats-new entry → `npm run update:patch` (OTA) → `npm run build:orchestrator` → `camstack deploy packages/addon-pipeline-orchestrator` (from camstack-server) → commit the submodule pin + embedded bundle in camstack-server and push. Details: `.claude/skills/camstack-viewer-release/SKILL.md`.

## Architecture

### Path Aliases
- `@/*` maps to `./src/*` (tsconfig only; the codebase uses relative NodeNext-style `.js` import specifiers that point at TS sources — metro strips the `.js` for relative imports inside `src/`)
- `@camstack/sdk` maps to `../camstack-server/packages/sdk/src/index.ts`

### Routing (Expo Router)
File-based routing in `app/`:
- `app/index.tsx` — login → redirect into the tab navigator
- `app/(app)/(tabs)/{cameras,events,grids,settings}.tsx` — main tabs
- `app/(app)/camera/[id].tsx` — single camera live view
- `app/(app)/grid/[id]/index.tsx` + `edit.tsx`, `app/(app)/grid/adhoc.tsx` — grids (adhoc via `?devices=`)
- `app/(app)/settings/cameras.tsx` — camera settings
- `app/(app)/rule/new.tsx`, `app/(app)/rule/[id]/index.tsx`, `app/(app)/rule/[id]/[section].tsx` — notification rule editor: kind picker / summary / one section (memory-only draft in `src/store/nc-rule-draft-store.ts`; hrefs only from `src/navigation/rule-routes.ts`)
- `app/(app)/timelapse-rule/[id].tsx`, `app/(app)/summary-rule/[id].tsx` — timelapse and digest editors (`id` = `new` to create). Why routes: D631 in camstack-server `docs/decisions/`
- `app/embed/` — embedded player routes

### `src/` layout
- `connection/` — ConnectionProvider, SystemController (WS lifecycle), OfflineDebouncer, endpoint discovery/failover
- `data/` — TanStack React Query hooks over the hub tRPC API (cameras, tracks, detections, accessories, snapshots, scrub thumbnails, …)
- `live/` — live view + Viewer-owned embed integration
- `timeline/`, `recording/` — events timeline and recorded playback
- `grid/`, `grid-embed/` — multi-camera grids
- `auth/`, `navigation/`, `screens/`, `components/`, `hooks/`, `store/` (Zustand), `theme/`, `lib/`

### Embed application
- `embed/` owns the browser player, grid, Events, recording and scrub sources.
- `npm run sync:embed` produces `assets/embed/camstack-embed.html` for native OTA and `public/embed/` for web/iframe use.
- Server-hosted iframe URLs use `/viewer/camstack/embed/index.html?mode=...`; the Pipeline addon has no embed source or route.

### State & Data
- **Zustand** for client state, **TanStack React Query** for server state (all data comes from the hub tRPC API; no local database)
- **Settings live at TWO levels** (operator decision 2026-10-21), each setting in exactly one, no overrides: **device** (this install: servers, tokens, per-camera/per-grid quality, audio and layout, favourites, debug, caches, the Library pages' filter bars — `src/store/library-filters.ts`, never the picked day — and the screen-dependent half of `settings-store`) and **account** (per user, per hub: stored on the hub, cached here as `<key>@<serverId>`, synced by `src/account/account-settings-sync.ts` in the namespaces `viewer.app` / `viewer.cameras` / `viewer.grids`). A few fields are **ephemeral** (memory only). Every persisted key is declared in `src/store/storage-levels.ts` and every settings field in `src/store/settings-levels.ts` — `storage-levels.spec.ts` fails on an undeclared key. The hub contract is filled in at ONE adapter, `src/account/hub-account-port.ts`; until then the account layer is local-only.
- Streaming: the Viewer-owned embed connects to the hub's WebRTC/API data planes.

## Key Conventions

- **New Architecture** is enabled (`newArchEnabled: true`); React Compiler enabled (experimental)
- **expo-dev-client** is required for development — Expo Go won't work (native modules: WebRTC, react-native-video)
- After changing `app.config.ts` or plugins, run `npm run prebuild:clean` and rebuild
- Open iOS project via **camstack.xcworkspace**, not .xcodeproj
- i18n: English + Italian (`locales/en.json`, `locales/it.json`) via i18next + react-i18next
- CI runs `npm run ts-check` on every push/PR to main
- **This checkout can see types it does not declare, because it usually lives
  INSIDE camstack-server.** Two separate leaks, and only one is closed:
  - `@camstack/*` — **CLOSED.** `tsconfig.json` now resolves them from
    `node_modules`, the PUBLISHED packages, exactly as metro, vitest and CI do.
    The old default mapped them to `../camstack-server/packages/*/src`, so
    anything written in the workspace and not yet published type-checked green
    and threw on first evaluation. To develop a server type and its consumer
    here together, use **`tsconfig.workspace.json`** by name — and when the
    plain `ts-check` then goes red on that symbol, the answer is to publish the
    server package, never to re-point the alias.
  - `@types/*` — **STILL OPEN.** TypeScript finds them for an explicit import
    by walking `node_modules` upwards, and nothing in a tsconfig stops that
    (`typeRoots` governs ambient globals, not import resolution — measured
    2026-09-16). `@types/react-dom` was borrowed that way and CI went red on a
    commit that was clean locally. Every `@types/*` an import needs must be in
    THIS `package.json`; CI catches a miss because it checks the repo
    standalone, and that remains the only thing that does.
- **Values from `@camstack/types` come from `@camstack/types/client`** (or
  `/enums`); the bare entry is for `import type` only. The bare entry is the
  whole ~2.7 MB barrel and Metro does not tree-shake it. Enforced by
  `scripts/check-types-client-imports.mjs` (in `ts-check`), ESLint and
  `src/__tests__/types-client-entry.spec.ts`; specs are exempt. A value missing
  from `/client` is added to `packages/types/src/client.ts` in camstack-server
  and published — never imported from the root.
- Custom native modules: `modules/camstack-webrtc-audio/`, `plugins/withAudioSessionControl`, `plugins/withNativeLogCapture`
