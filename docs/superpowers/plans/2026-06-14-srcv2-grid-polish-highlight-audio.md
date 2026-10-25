# Plan — srcV2 Grid Polish: per-tile controls, audio/mic, zoom, highlight, active-only, immersive UI

**Date:** 2026-06-14
**Repos:** `camstack-server` (`packages/addon-pipeline/embed`, `packages/ui-library`) + `camstack-viewer` (`srcV2`)
**Builds on:** `2026-06-14-srcv2-shared-grid-embed-{server,viewer}.md` (Plan 1 + Plan 2). Phase 0 (Tailwind/crop fix) already shipped (`fix(embed): wire Tailwind v4 …`).

**STATUS (2026-06-14): ALL PHASES IMPLEMENTED + DEPLOYED.** F1–F9 landed on `main` in both repos (typecheck/lint/tests green; embed built + `camstack deploy`ed to the local hub, host-API symbols verified in the served bundle). **F10 (per-camera highlight in the single detail view) also done** — native border overlay over `LiveView` (the detail isn't the embed) driven by `useMotion`/`useDetections`/`useAudioActive` + `useHeld`, with per-camera settings in `camera-prefs-store` edited from the camera view-options menu. So highlight now works on BOTH grid (per-grid) and single (per-camera), as requested.

Device-only behaviors (overlay/zoom/mic/immersive/highlight/active-only live signals) still need on-device verification on the iOS build. Mic also needs a native rebuild (`prebuild`) for the new Info.plist mic permission, and an admin-scoped token for the `intercom` cap.

## Architecture split (locked decisions)

- **Embed (shared bundle) owns:** tile rendering & layout, per-tile zoom, the in-tile control overlay, audio exclusivity, mic/intercom, highlight borders, active-cameras-only filtering, name overlay. Works uniformly on iOS / web / HA.
- **Native viewer owns:** the shared control bar, screen chrome (immersive), navigation, and ALL persisted settings (grid store) which it injects into the embed config.
- **Highlight settings scope:** per-camera in Camera Detail; **per-grid** in grid mode (one set applied to every camera in the grid, saved at grid level).
- **Tap UX:** a tap on a tile reveals an in-tile overlay — center = pause/play (per-tile), bottom-left = audio + mic, bottom-right = open (→ detail). Audio and mic are **exclusive** (one camera at a time).

## Key findings driving the plan

- **Audio bug root cause:** `CameraStreamPlayer` (`packages/ui-library/src/composites/camera-stream-player.tsx:299`) reads `muted` only as `useState(initialMuted)` — no effect syncs the `muted` prop after mount, so `setMutedAll(false)` re-renders the tile but the live `<video>` stays muted. Audio never propagates.
- **Backend already supports everything (no server-cap changes):**
  - `intercom` cap (`packages/types/src/capabilities/intercom.cap.ts`) — exclusive (one WebRTC OR raw-PCM session per device) two-way audio; WebRTC `audioDir` becomes `sendrecv` when intercom is on (`stream-broker/webrtc/session.ts:1296`).
  - `motion` cap + `motion.on-motion-changed` event; `audio-metrics` cap (`getCurrentSnapshot` dBFS + class scores) + `pipeline.audio-inference-result` event.
  - Live subscription via `live.onEvent` (`server/backend/src/api/core/live-events.router.ts`), pattern in `useDeviceDetections`.
- **V1 highlight reference** (`camstack-viewer/src`): per-camera settings — motion toggle; audio `off|sensor|level` with `windowSeconds/decibelThreshold/hitPercentage/holdSeconds`; detection toggle with `classnames[]/holdSeconds`; global appearance `color`+`borderWidth` per type (motion red / audio blue / detection green). Audio level presets (Crying/Alarm/Dog/Doorbell/Glass/Custom). V1 had **no** active-only grid mode — new, reuses the same thresholds.
- **Zoom:** grid has none today; `srcV2/live/use-stream-zoom.ts` is single-camera native only. Per-tile zoom must live in the embed.

## Current message protocol (to extend)

- Host→embed (`window.__camstackGrid`): `setMutedAll`, `setPaused`, `setQuality`, `setLayout`, `setShowName`, `setShowBadges`(no-op), `fit`.
- Embed→host (`grid-messages.ts`): `state`, `tileTap`, `tileLongPress`, `layout`.
- Config (`embed-grid-config.ts`): `serverUrl, token, devices[], layout, quality, showName, showBadges, muted, paused`.

---

## Phases

### Phase 1 — Audio correctness + exclusivity  *(embed + ui-library)*
- Fix `CameraStreamPlayer`: add an effect syncing the `muted` prop → `isMuted`/`video.muted` after mount (keep the toolbar toggle working).
- Embed grid: introduce `activeAudioDeviceId` (default `null` = all muted). Exactly one tile unmuted. Bar "mute" = master mute / clears active audio.
- Wire host→embed `setActiveAudio(deviceId|null)`.
- Rebuild ui-library + embed, redeploy `addon-pipeline` (full build: server+widgets+embed).
- **Acceptance:** selecting one camera plays only its audio; others silent; master mute silences all.

### Phase 2 — Per-tile control overlay + tap behavior  *(embed)*
- `GridTilePlayer`: tap → overlay (auto-hide ~3s): center pause/play (per-tile), bottom-left audio+mic, bottom-right open. Replace tap=navigate.
- New embed→host message `tileOpen{deviceId}`; native navigates to detail. Per-tile pause handled in-embed.
- Compact, touch-target-safe (≥44px) icon buttons; passive when overlay hidden.
- **Acceptance:** tap reveals the three controls; open navigates; pause freezes only that tile.

### Phase 3 — Mic one-at-a-time  *(embed + intercom + native perms)*
- Embed: `getUserMedia(audio)` in the WebView + `intercom` cap session (start/answer/pushTalkAudio or WebRTC `sendrecv`). Exclusive: starting mic on one camera stops any other; mic button reflects talking state.
- Native: `NSMicrophoneUsageDescription` in Info.plist; WKWebView mic permission grant.
- **Risk:** WebView mic permission UX; codec negotiation (server transcodes). **Acceptance:** push-to-talk reaches the camera; switching cameras hands off the mic.

### Phase 4 — Per-tile zoom  *(embed)*
- Pinch/pan within a tile → CSS transform on the video wrapper (scale 1–4×, focal-point), double-tap reset, clamp pan to content. Only the touched tile zooms; gestures isolated from the host scroll.
- **Acceptance:** pinch zooms a single camera, not the whole grid.

### Phase 5 — Name overlay default off  *(store + builder + embed)*
- `grid-store.ts`: `GRID_OPTION_DEFAULTS.showName = false`. Builder toggle already exists; embed already honors `showName`.
- **Acceptance:** new grids hide names; toggle re-enables.

### Phase 6 — Shared bar redesign  *(viewer)*
- `GridControlBar`: icon-only, compact (drop text labels).
- Collapsible: auto-hide after ~4s + edge handle to reveal (mirror immersive auto-hide).
- Absorb grid actions previously in the header: grid title chip, edit entry, **highlight toggle**, **active-only toggle**.
- **Acceptance:** bar is compact icon-only and collapses; all grid actions reachable from it.

### Phase 7 — Immersive screen restructure  *(viewer)*
- `GridViewScreen`: remove the nav header (grid name + reorder/edit buttons). Immersive: `StatusBar hidden`, hide tab bar, free orientation (reuse `CameraDetailScreen` pattern).
- Drop the separate reorder mode; consolidate management into the single Edit/Builder flow ("teniamo tutto in edit").
- Handle `tileOpen` → `router.push('/camera/:id')`.
- **Acceptance:** no wrapper/header; full-bleed grid; editing/reordering live only in the builder.

### Phase 8 — Highlight  *(embed render + settings)*
- Embed: subscribe per device via `system.trpcClient.live.onEvent` to `motion.on-motion-changed` + audio (`audio-metrics` snapshot / `pipeline.audio-inference-result`); compute highlight state per settings (motion; audio `sensor|level` with window/dB/hit%/hold; detection classes/hold; priority detection>audio>motion); render border glow (color/width per type).
- Config: inject highlight settings into embed config (per-grid). Grid store: per-grid highlight settings + appearance; builder UI (port V1 controls + audio presets).
- Camera Detail (single): per-camera highlight settings + rendering. **Design point:** detail currently uses native `LiveView` — either (a) render highlight natively in detail from the same subscription, or (b) move the single view to embed `?mode=player`. Decide at Phase 8 start.
- **Acceptance:** a camera in motion/audio/detection shows the configured border; per-grid in grid, per-camera in detail.

### Phase 9 — Active-cameras-only grid mode  *(embed)*
- Embed: when enabled, filter `devices` to those currently active (motion or audio-above-threshold, reusing the per-grid highlight thresholds), reflow layout; empty-state placeholder when none. Hysteresis via the hold seconds to avoid flicker.
- Bar toggle (Phase 6) → host→embed `setActiveOnly(boolean)`.
- **Acceptance:** only active cameras render and the grid reflows; inactivity timeout removes a tile smoothly.

### Phase 10 — Protocol/config plumbing  *(cross-cutting, lands with each phase)*
- Extend `embed-grid-config.ts`: `showName` default, `highlight` settings, `activeOnly`, `activeAudioDeviceId`.
- Extend `grid-messages.ts` + `gridCommandScript` + `GridLiveEmbed`:
  - host→embed: `setActiveAudio`, `setActiveMic`, `setHighlight`, `setActiveOnly` (plus existing).
  - embed→host: `tileOpen`, `audioState`, `micState`.

---

## Recommended order
Phase 1 (confirmed bug, fits the current deploy loop) → 5 → 2 → 6 → 7 → 3 → 4 → 8 → 9. Phase 10 plumbing lands incrementally with the phase that needs it.

## Risks / open points
- WebView **microphone** permission + secure-context + autoplay-with-sound gesture rules (iOS WKWebView).
- **Subscription load**: N devices × (motion+audio) live subscriptions in one embed — batch/share where possible.
- **Detail-view highlight surface** (native LiveView vs embed player) — decide at Phase 8.
- Embed **bundle size** already >1.5 MB; watch growth (intercom + highlight logic).
- Device-only verification (iOS dev build) for overlay/zoom/mic/immersive — cannot be validated in the agent env.
