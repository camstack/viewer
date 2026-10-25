# srcV2 Runnable Shell — Implementation Plan

> **For agentic workers:** RN-glue/integration. Verified by `npm run ts-check` (no runtime test env). NOT runtime-verified here — the user runs the app to confirm. The one pure-logic edit (SystemController widening) is covered by the existing connection vitest suite.

**Goal:** Make srcV2 launchable at the Expo Router route `/v2`: provider stack mounts, a minimal "connect to server" form bootstraps a camstack server, and a Cameras screen lists the server's cameras with live connection state. (Live video tiles + grid rendering + settings are the next increments.)

**Architecture:** `app/v2/` Expo Router group → `AppRoot` → if no saved server, `ConnectServerForm`; else `RootProviders` (GestureHandler→SafeArea→QueryClient→Theme) wrapping `ConnectionProvider` (config from the saved server) wrapping `CamerasScreen`. Cameras come from the SDK `System` (exposed via the existing `ConnectionProvider`'s controller), filtered to cameras.

**Tech Stack:** Expo Router ~6, @tanstack/react-query 5, @react-native-async-storage/async-storage 2.2, react-native-safe-area-context, react-native-gesture-handler. All already installed.

**Spec:** `docs/superpowers/specs/2026-06-13-srcv2-camera-timeline-design.md`.

---

## Tasks (single cohesive shell; ts-check gate)

1. **Widen `SystemController` to expose the SDK `System`** so screens can call device APIs.
   - `srcV2/connection/system-controller.ts`: `import { createSystem, raceFastestEndpoint, type System } from '@camstack/sdk'`; change the private field + `getSystem()` from the internal `SystemLike` to `System | null`; drop the `as SystemLike` cast (createSystem returns `System`). Remove the now-unused `SystemLike` interface. Behaviour unchanged. **Re-run `npm run test:v2 -- system-controller` and the full suite — must stay green** (the mock returns `{switchServerUrl, close}`, still satisfied at runtime).

2. **`srcV2/app/query-client.ts`** — `export function createQueryClient(): QueryClient` (sensible defaults: `staleTime` ~5s, `retry: 1`).

3. **`srcV2/app/kv-async-storage.ts`** — export `asyncKvStore: KvStore` backed by `@react-native-async-storage/async-storage` (implements the `ServerStore`'s `KvStore` interface: getItem/setItem/removeItem).

4. **`srcV2/app/RootProviders.tsx`** — compose `GestureHandlerRootView(flex:1) > SafeAreaProvider > QueryClientProvider(createQueryClient()) > ThemeProvider > children`.

5. **`srcV2/app/useActiveServer.ts`** — hook over `new ServerStore(asyncKvStore)`: loads `{ server, token }` on mount (loading state), exposes `save(server, token)` (upsert + setActive + setToken) and `signOut()`. Returns `{ loading, server, token, save, signOut }`.

6. **`srcV2/screens/ConnectServerForm.tsx`** — minimal camstack-styled form: `serverUrl` + `token` text inputs + "Connetti" button → `save({ id: serverUrl, label: serverUrl, serverUrl }, token)`. (Username/password login is a later Settings task; v1 takes a token.)

7. **`srcV2/screens/CamerasScreen.tsx`** — uses `useConnection()` (state + controller) and `useTheme()`. On `state === 'connected'`: `const system = controller.getSystem(); await system.init(); const cams = system.listDevices(...)` filtered to cameras; subscribe `onDeviceAdded/onDeviceRemoved` to refresh; render the `ConnectionBanner` + a `FlatList` of camera names + per-camera status text. **Read the SDK `DeviceProxy`/`Device` types** (`@camstack/sdk` `devices.ts` / `system.ts` + `@camstack/types` DeviceProxy) to map the correct fields (id, display name, canonical type) and to filter cameras — do not guess field names. Show loading/empty/offline states.

8. **`srcV2/app/AppRoot.tsx`** — `useActiveServer()`; while loading → spinner; no server → `ConnectServerForm`; else build `SystemControllerConfig { serverUrl: server.serverUrl, token, candidates: [server.serverUrl] }` and render `RootProviders > ConnectionProvider(config) > CamerasScreen` (with `ConnectionBanner`).

9. **Expo Router mount** — `app/v2/_layout.tsx` (a `Stack` with header hidden) and `app/v2/index.tsx` (renders `<AppRoot/>`). Additive — does NOT touch the legacy `app/(tabs)` or `app/_layout.tsx`.

## Gate
- `npm run test:v2` — all green (still 48; SystemController widening must not regress).
- `npm run ts-check` — no NEW errors in any `srcV2/` or `app/v2/` path (pre-existing legacy `src/` + `@camstack/sdk` source errors acceptable).

## Run (for the user — not part of CI)
`npx expo start` (dev client) → open the app → navigate to `/v2` → enter a camstack server URL + token → the Cameras screen should list cameras and the banner reflect connection state.

## Out of scope (next increments)
Live video tiles (`LiveView` + `react-native-webrtc` factory + `SignalingClient` SDK adapter — uses the merged `webrtc-live-session` orchestrator), grid screen rendering (uses `grid/auto-layout`), Settings, username/password login, timeline UI (spike-gated).

## Self-Review
- Mount is additive (`app/v2/`), legacy untouched. ✓
- Reuses merged cores: `ThemeProvider`, `ConnectionProvider`/`SystemController`, `ServerStore`. ✓
- Only one change to tested code (SystemController type widening) — guarded by re-running the connection suite. ✓
- Device mapping delegated to reading real SDK types (avoids guessing). ✓
