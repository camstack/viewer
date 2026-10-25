# srcV2 iOS Scrub De-risk Spike — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove (or kill) the native scrub premise before building the full ScrubEngine: drive frame-accurate scrubbing of a real recorded LOW segment (HEVC 640×360, GOP≈4s) on iOS via `AVAssetImageGenerator`, and measure finger-move→frame latency on a fast drag.

**Architecture:** A throwaway Expo dev-client screen with a horizontal pan gesture mapped to a time T; on drag it requests the keyframe of T's segment, on settle it requests the exact frame at T. Backed by `AVAssetImageGenerator` with `requestedTimeToleranceBefore/After = .zero`, batched async generation, latest-wins cancellation.

**Tech Stack:** Expo dev-client, `expo-video` (`generateThumbnailsAsync`) OR a tiny native module wrapping `AVAssetImageGenerator`, `react-native-gesture-handler`, a real signed LOW segment URL from a running camstack-server.

**Status:** Investigation spike — NOT product code. Output is a go/no-go + measured numbers recorded in this file's "Findings" section. Do not merge the spike screen.

---

## Prerequisites

- A running camstack-server with at least one camera that has recorded LOW footage.
- A signed playback manifest: call `recording.getPlaybackManifest({deviceId, fromMs, toMs})` (admin auth) and capture the LOW variant segment URLs from `playbackUrl`/`playbackEndpoints` (token is in the URL path). Save 3–5 real `.m4s` segment URLs (or the LOW media playlist URL) to test against.
- iOS device or simulator running the Expo dev-client (the project already requires `expo-dev-client`).

---

### Task 1: Spike screen scaffold + segment fixtures

**Files:**
- Create: `srcV2/_spike/ScrubSpikeScreen.tsx`
- Create: `srcV2/_spike/fixtures.ts` (the captured real segment/playlist URLs + a deviceId + a known time window)

- [ ] **Step 1: Capture fixtures** — using the server's live tRPC helper, fetch a manifest and paste the LOW media-playlist URL + 3 segment URLs + their `<epochSec>` start times into `fixtures.ts` as exported constants (`SCRUB_PLAYLIST_URL`, `SCRUB_SEGMENTS: {url:string; epochStartMs:number; durMs:number}[]`).

- [ ] **Step 2: Build the screen shell** — a full-screen black view with an `<Image>`/`expo-image` target at top and a `GestureDetector` (pan) strip at the bottom. Map panX (0…width) linearly to T within `[windowStart, windowEnd]`. Show the current T as `HH:MM:SS.mmm` and the measured last-frame latency in ms.

- [ ] **Step 3: Run the dev-client**, confirm the screen renders, the time label tracks the drag, and no frame is shown yet. (Manual.)

---

### Task 2: Native keyframe + exact-frame extraction

**Files:**
- Modify: `srcV2/_spike/ScrubSpikeScreen.tsx`
- Create (only if `expo-video` thumbnails prove insufficient): `modules/camstack-frame-extractor/` (a minimal native module exposing `frameAt(url, timeSec): Promise<base64|uri>` over `AVAssetImageGenerator`).

- [ ] **Step 1: Try `expo-video` first** — install `expo-video`; for a given segment URL, create a player/asset and call `generateThumbnailsAsync([timeSec])`. Wire it so dragging requests the segment's first-keyframe time (coarse) and settling requests the exact in-segment offset for T.

- [ ] **Step 2: Configure for frame-accuracy** — if using a custom module, set `generator.requestedTimeToleranceBefore = .zero` and `…After = .zero`, `appliesPreferredTrackTransform = true`. Use `generateCGImagesAsynchronously` for batched requests.

- [ ] **Step 3: Latest-wins** — keep only the latest pending T; cancel/ignore in-flight results that are superseded (track a monotonically increasing request id; drop results whose id < latest).

- [ ] **Step 4: Render** — set the extracted image as the target's source; stamp `latencyMs = now - requestStart` and display it.

- [ ] **Step 5: Run + observe** — drag slowly and fast; confirm the frame updates and lands on the correct instant.

---

### Task 3: Measure and decide

**Files:**
- Modify: this plan's "Findings" section.

- [ ] **Step 1: Measure** — record median + p90 finger-move→frame latency during a sustained fast drag (coarse keyframe phase) and the exact-frame latency on settle. Record peak memory (Xcode Instruments) over 60s of continuous scrubbing. Record whether frames are exact (compare to expected timestamps).

- [ ] **Step 2: Decide** — fill the go/no-go below.
  - **GO** if coarse drag feels fluid (p90 ≲ 100–150ms with prefetch) and exact-frame ≲ 0.5s and memory is flat.
  - **NO-GO** → fall back: (a) try a custom `AVAssetImageGenerator` module if `expo-video` was the bottleneck, else (b) reconsider the shelved all-keyframe `scrubPlaylistUrl` track + WebCodecs-on-web, else (c) coarse-only native seek via `react-native-video`.

- [ ] **Step 3: Commit the findings only** (not the spike screen):

```bash
git add docs/superpowers/plans/2026-06-13-srcv2-ios-scrub-spike.md
git commit -m "docs(spike): record iOS native scrub de-risk findings"
```

---

## Findings (fill during Task 3)

- Coarse drag latency (median / p90): __ / __ ms
- Exact-frame latency on settle: __ ms
- Frame-accuracy: exact? __
- Peak memory over 60s scrub: __ MB (flat? __)
- `expo-video` sufficient, or custom module needed: __
- Android note (if tested via `MediaMetadataRetriever`): __
- **Decision: GO / NO-GO** → __
- If NO-GO, chosen fallback: __

---

## Self-Review

- **Spec coverage:** Implements spec §6 "De-risk spike (iOS)" — validates D1/D2 (native premise) before the full build. ✓
- **Placeholder scan:** The "Findings" blanks are intentional measurement outputs, not unwritten steps. ✓
- **Scope:** Throwaway investigation; explicitly not merged. Gates Plan C (ScrubEngine + UI). ✓
