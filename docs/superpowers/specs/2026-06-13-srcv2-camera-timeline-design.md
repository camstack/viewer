# srcV2 — Foundations (SDK/connection) + Camera·Timeline page — design

**Date:** 2026-06-13
**Status:** Approved design (pending user review)
**Repo:** `camstack-viewer` (the `camstack/` submodule)
**Area:** new `src/` rewrite namespace (`srcV2`), camstack-only client
**Related (server):**
- `camstack-server/docs/superpowers/specs/2026-06-09-recording-system-design.md`
- `camstack-server/docs/superpowers/specs/2026-06-13-viewer-scrub-client-design.md` (the backend agent's scrub-engine design — **partially superseded here**, see §2.1)
- `camstack-server/docs/superpowers/specs/2026-06-11-recording-timeline-phase2-design.md` (motion/audio density source)

---

## 0. One-paragraph summary

srcV2 is a clean, **camstack-only** reimplementation of the viewer (no Separate NVR/External hub/RTSP
adapters). It **keeps the current app's structure and layout** (vertical-scroll scrubber, grids,
camera grid) and **restyles** it to the camstack **Warm Amber / Stone** design language. The app
stays **fully React Native / Expo (no WebView)**. The first sub-project delivers (a) a **connection
foundation** built entirely on `@camstack/sdk`'s `System` (continuous LAN→remote endpoint
evaluation, reconnect, scoped-JWT data-plane access) and (b) the **camera·timeline page** — live,
VOD playback, frame-accurate **scrub**, and motion/audio/recording **activity bands** (heatmap).
Events (a list/tab, clickable detection markers, object detection) are **out of scope**.

## 1. Decomposition of srcV2

srcV2 is too large for one spec. It decomposes into sequenced sub-projects, each with its own
spec → plan → implementation cycle:

1. **Foundations: SDK/connection + Camera·Timeline page** ← *this spec*.
2. **Grids + Camera grid** — port the existing structure, restyle to camstack.
3. **Onboarding / Settings / app shell** — server management, auth, navigation chrome.
4. **Events macro-block** (timeline events tab, detection markers, videoclips) — explicitly later.

This spec covers **sub-project 1 only**. It deliberately includes the connection foundation
because every media surface depends on it and it is the stated robustness priority.

## 2. Locked decisions (with rationale)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Fully RN/Expo native; no WebView.** | Confirmed by product owner + the `rn-hybrid-expert` evaluation. WebView+WebCodecs (the server scrub design's assumption) costs more GPU/memory, is harder to debug on mobile, and makes **HEVC** decode fragile on web/desktop. Native VideoToolbox/MediaCodec decode HEVC robustly. |
| D2 | **Scrub via a platform-swappable `ScrubEngine`.** Native backend = `AVAssetImageGenerator` (iOS) / `MediaMetadataRetriever` (Android); web backend = WebCodecs. | One engine, one timeline UI; only the low-level decode differs behind an interface. The all-keyframe image-extraction primitives decode-forward internally given a time, so they satisfy frame-accuracy on a long-GOP source. |
| D3 | **Reuse-low scrub source.** Scrub off the recorded **LOW substream** (HEVC 640×360, GOP≈4s, fMP4 segments each ≈1 GOP starting on a keyframe). No dedicated server-side scrub track. | Matches the backend agent's reuse-low decision; the dedicated all-keyframe `scrubPlaylistUrl` track (implemented on `feat/recorder-scrub-track`) is **shelved as fallback** and NOT consumed by srcV2. |
| D4 | **Live = native WebRTC recvonly; VOD = native HLS ABR.** Scrub interacts with live only at the now-edge boundary. | Reuses the viewer's existing WebRTC path; standard players handle ABR playback. |
| D5 | **Keep current structure/layout; restyle to camstack.** Vertical-scroll scrubber with fixed cursor (~70%), overlay controls, day picker; grids & camera grid unchanged structurally. | Product owner: "use exactly the structure we already have… applying camstack styles." |
| D6 | **camstack Warm Amber / Stone palette**, amber cursor, **semantic activity bands**. | Product owner chose option A. Tokens below. |
| D7 | **New RN components on camstack theme tokens; `@camstack/ui-library` NOT used on native** (it is DOM-only: react-dom/react-konva). Theme tokens shared/extracted from `@camstack/ui-library` `./theme`. | ui-library cannot run on RN native; only its design tokens are portable. |
| D8 | **Connection on `@camstack/sdk` `System`.** | The SDK already implements the exact resilience required (see §3). Do not reinvent. |
| D9 | **Dark + Light themes.** | camstack defines both; the current viewer ships neon + lightNeon. |

### 2.1 Relationship to the server `viewer-scrub-client-design.md`

That doc designed the ScrubEngine for a **full-WebView WebCodecs** client. srcV2 **adopts its
engine decomposition** (TimelineModel · SegmentSource · Demuxer · DecoderPool · ScrubQueue ·
Renderer) and its server-contract reading (reuse-low, ranges, `playbackEndpoints`, Range/206) but
**replaces the decode/render layer with a native backend** (D1/D2). The WebCodecs backend remains
the **web/PWA** implementation only.

## 3. Connection foundation (`@camstack/sdk` `System`)

All server access goes through one `System` instance.

- **Init:** `createSystem({ serverUrl, token, useWebSocket, onConnectionChange, retryDelayMs, maxRetryDelayMs })`.
  WS transport with keepalive ping/pong, reconnect with exponential backoff
  (`WS_RECONNECT_RETRY_DELAY_MS` 2s → `…MAX…` 30s).
- **Continuous local/remote evaluation:** `raceFastestEndpoint(candidates, timeoutMs)` probes each
  candidate URL (short timeout, first 2xx wins) and `switchServerUrl()` pivots the live transport
  onto the winner (e.g. bootstrap on the public URL, then pivot to a LAN candidate). srcV2 re-runs
  the race on connect, on `BackendConnectionState` transitions, and on network-change events.
- **Connection state in UI:** subscribe `onConnectionChange` → a connection banner (connecting /
  online-LAN / online-remote / reconnecting / offline). All media surfaces react to it (pause
  scrub fetches when offline, resume + re-race on recovery).
- **Typed access:** `DeviceProxy` (auto-injects `deviceId`/`nodeId`), `subscribeEvent` for live
  events.

### 3.1 Data-plane access (recordings)
- `recording.getPlaybackManifest({ deviceId, fromMs, toMs })` → `{ ranges?, playbackUrl,
  playbackEndpoints[], scrubPlaylistUrl }`.
  - `playbackEndpoints[]` are candidate master-playlist URLs **in order (LAN first, then relay —
    Tailscale/Cloudflare)**, each carrying a **scoped JWT in the URL path** (not a header).
  - srcV2 tries endpoints in order with failover on 401/timeout; surfaces a single user error only
    if all fail.
  - **Token is in the path**, so a native `AVURLAsset` / `react-native-video` source can load the
    playlist/segment URL **directly** — no custom-header forwarding problem (the key advantage the
    `rn-hybrid-expert` flagged).
- srcV2 **ignores** `scrubPlaylistUrl` and `localMasterPath`. Scrub uses the **LOW variant** of the
  master playlist (D3).

## 4. ScrubEngine (RN-native)

```
TimelineUI ─(seekTo(epochMs), setMode(live|vod), drag start/move/end)─▶ ScrubEngine
  ├─ TimelineModel   ranges + density → segment index; epoch↔segment(+in-segment offset) map
  ├─ SegmentSource   resolve LOW variant playlist; pick endpoint (LAN→relay); prefetch N±1; LRU
  ├─ DecodeBackend   PLATFORM-SWAPPABLE behind one interface:
  │                    • iOS:     AVAssetImageGenerator (zero tolerance, batched async)
  │                    • Android: MediaMetadataRetriever (getFrameAtTime, CLOSEST_SYNC + forward)
  │                    • Web:     mp4box.js demux → WebCodecs VideoDecoder
  ├─ ScrubQueue      latest-wins; coalesce on rAF/display-link; flush stale in-flight decodes
  └─ Renderer        decoded frame → native Image/SkImage / canvas (web); live = WebRTC <video>
ScrubEngine ─(onFrame(epochMs, frame), onState)─▶ TimelineUI
```

- **Two-tier scrub:** during drag → nearest **keyframe** of T's segment (instant, ~GOP/4s
  granularity); on settle/dwell → **decode-forward** to the exact frame at T (≤1 GOP).
- **Epoch↔media mapping:** keep a per-segment `epochBase → mediaTime` offset; never assume a global
  media clock across segments (segment names encode `<epochSec>`).
- **Edge cases:** recording gaps (snap to nearest range edge); live-edge segment not yet finalized
  (clamp scrubbable edge to last finalized `.m4s`); endpoint/token failover; bound memory (release
  frames after paint, LRU segment cache, idle-decoder teardown).

### 4.1 Live ↔ recorded handoff
- Default live = WebRTC at the edge, playhead pinned to "now". Dragging left of now switches the
  surface to the ScrubEngine on the recorded LOW tail; releasing within ε of "now" hands back to
  WebRTC. Keep the last decoded frame painted until WebRTC produces its first frame (no black
  flash).

## 5. Camera·timeline page — data & UI

### 5.1 Data sources
| Surface | Source | Notes |
|---|---|---|
| Recorded coverage (footage bands, gaps) | `recording.getAvailability({ deviceId, fromMs, toMs })` → `{ ranges: { profile, startMs, endMs }[] }` (per-profile; union for "has footage"). | drives "has footage" + gap snapping. |
| **Motion/audio activity bands (heatmap)** | `pipeline-analytics.getEventDensity({ deviceId, since, until, bucketMs })` → `readonly { bucketStart, motion, object, audio }[]` (one entry per non-empty bucket). **CONFIRMED + implemented** in `addon-post-analysis` (tested). | render **motion + audio** only; `object` ignored (bands-only scope). |
| Recording band | `recording.getAvailability` `ranges` | red/danger. |
| Live | WebRTC broker + `subscribeEvent` | existing path. |

### 5.2 Structure (unchanged from current app)
- Mobile portrait: video (≤50% height) + **vertical-scroll scrubber** with fixed red→**amber**
  cursor at ~70%; overlay controls (quality Auto/High/Mid/Sub, mute, snapshot/export, PTZ if
  supported, live/playback toggle); day picker + zoom.
- Tablet/desktop: the existing responsive behavior (sidebar nav, larger video) is **preserved**;
  only the visual style changes.

### 5.3 Style (camstack Warm Amber / Stone)
Dark tokens (light mirror defined too):
```
background #0c0a09  background-elevated/surface #1c1917  surface-hover #292524
border #292524  border-subtle #1c1917
foreground #fafaf9  muted #a8a29e  subtle #78716c  disabled #57534e
primary/accent #f59e42 (light: #e67e22)  primary-foreground #0c0a09
success #4ade80  warning #fbbf24  danger #f87171  info #60a5fa
radius sm4 md6 lg8 xl12 · type base 12px · icons Lucide (no emoji)
```
- **Scrub cursor:** amber `#f59e42`.
- **Activity bands (semantic):** recording = `#f87171` (danger), motion = `#60a5fa` (info),
  audio = gradient `#4ade80 → #fbbf24 → #f87171`.
- New RN components on these tokens; tokens shared/extracted from `@camstack/ui-library` `./theme`
  (no DOM components on native).

## 6. Testing (TDD)

- **ScrubEngine (unit):** epoch↔media mapping; latest-wins flush under fast drag; gap snap;
  live-edge clamp (never fetch a growing segment); LRU/prefetch; endpoint/token failover.
- **Connection (unit):** `raceFastestEndpoint` ordering + first-2xx; `switchServerUrl` pivot;
  reconnect/backoff; offline→online re-race.
- **Bands (unit):** density → band mapping; semantic colors.
- **De-risk spike (iOS, 1–2 days):** drive `AVAssetImageGenerator` (zero tolerance, batched async)
  from a pan gesture against **real signed LOW segments**; measure finger-move→frame latency on a
  fast drag, frame-accuracy, and memory. This validates or kills the native premise (D1/D2) before
  full build.

## 7. Risks / open points

- ~~**Motion/audio density contract** (§5.1)~~ **RESOLVED 2026-06-13** — `pipeline-analytics.getEventDensity`
  is confirmed + implemented (tested) in `addon-post-analysis`; coverage via `recording.getAvailability`.
  Band implementation is unblocked.
- **HEVC on web/PWA** — WebCodecs HEVC needs hw support; the web backend must `isConfigSupported`
  and degrade to coarse `<video>` seek when unavailable. (Native is robust.)
- **Android frame-stepping fluidity** — `MediaMetadataRetriever` per-frame cost; validate in the
  spike's Android leg or accept coarser Android scrub initially.
- **react-native-video + per-segment Range** — confirm direct `AVURLAsset` load of token-in-path
  segment URLs and `AVAssetImageGenerator` against an HLS/segment URL; otherwise the native backend
  does its own Range-GET into an in-memory asset.
- **Theme token sharing** — decide whether to extract a platform-agnostic `@camstack/design-tokens`
  package now or vendor the `./theme` values into srcV2 (cheaper first step).

## 8. Out of scope (this sub-project)
Events tab/list, clickable detection markers, object-detection overlays, videoclips; grids/camera
grid restyle (sub-project 2); onboarding/settings/app-shell (sub-project 3). Android is supported
but iOS is the priority platform for the de-risk spike.
