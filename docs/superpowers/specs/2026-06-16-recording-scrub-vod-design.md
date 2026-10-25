# Recording Scrub + VOD — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) — ready for implementation plan
**Repos:** `camstack-viewer` (timeline/heatmap/controller — native RN) + `camstack-server` `packages/addon-pipeline/embed` (decode/preview/VOD — WebView)

## Goal (one sentence)

Make recorded-footage navigation first-class: a **continuous live-preview scrub** (a decoded keyframe updates as you drag) on **both** the vertical timeline and the heatmap, kept in sync on a single shared position, that settles into reliable HLS VOD playback.

## Background / current state

The recording embed (`?mode=recording`) already plays HLS VOD and has a coarse WebCodecs scrub (decode the first IDR of a `low` fMP4 segment onto a canvas). It is driven by the native `TheaterTimeline` over the WebView bridge. During bring-up we found and fixed several issues and uncovered the real gaps:

- **Coverage never reached the app** — `use-recording.ts` `capQuery` guarded the tRPC router with `isRecord(...)`, but `system.trpcClient` is a tRPC v11 proxy whose nodes are *functions*, so the guard reported the `recording` cap as "missing" and never called it. **Fixed** (call the path directly in try/catch). Coverage now loads (cam 99: 15 ranges).
- **Scrub decode crashed** — `low-index.ts` resolved variant/segment URLs with `new URL(ref, base)` where `base` was the *relative* manifest path (`/addon/recorder/playback/...`) → throws. **Fixed** (`toAbsolute` against the page origin).
- **Scrub had no preload/cancel** — every `scrubTo` re-ran `ensureLowIndex` + fetched a whole segment + spun up a **fresh `VideoDecoder`**; with no debounce/cancel this spammed fetches/decodes and the repeated `loadAt`/`play()` produced `AbortError`, which likely caused the "plays one tick then freezes" VOD symptom.
- **Heatmap drag felt unresponsive** — because coverage was empty, `nearestCoveredEdge` returned `null`, so taps/drags resolved to nothing.
- **Vertical timeline not wired** — its scroll only toggles the "LIVE" pill; rows come from `mock-data` (no real time geometry), so it never drove playback.
- **`onPosition` not connected** — the embed reports playhead position, but `CameraDetailScreen` ignores it, so no cursor could follow playback.

A unified app logger (Settings → Debug mode → ships to the hub winston via `/addon/stream-broker/clientlog`) was built during this work and is the verification tool for the plan.

## Architecture

The hard constraint: **timeline + heatmap are native (React Native)**, **decode/preview/VOD live in the WebView (embed)**. We keep that split and make the seam continuous + cancellable.

```
 NATIVE (camstack-viewer)                         EMBED (addon-pipeline/embed, WebView)
 ┌─────────────────────────────────────┐         ┌───────────────────────────────────┐
 │ scrub-controller (single truth)      │  bridge │ scrub renderer                    │
 │  scrubEpoch / scrubbing / playhead   │ ──────▶ │  persistent VideoDecoder          │
 │   ▲ writes        ▲ writes           │ scrubTo │  segment-byte LRU + frame LRU     │
 │   │ (scroll/drag) │ (drag/tap)       │ (throttled, cancellable)                    │
 │ ┌──────────────┐ ┌──────────────┐    │         │  prefetch neighbours (drag dir)   │
 │ │vertical      │ │ HeatmapBar    │    │ ◀────── │  latest-wins draw → canvas        │
 │ │timeline      │ │ (minimap)     │    │ {type:  │                                   │
 │ │(scroll+tap)  │ │ (drag+tap)    │    │  log/   │ VOD <video> (HLS) + position OUT  │
 │ └──────────────┘ └──────────────┘    │  state/ │                                   │
 │   cursor ◀── playheadEpoch ◀─────────│  pos}   │                                   │
 └─────────────────────────────────────┘         └───────────────────────────────────┘
```

### Bridge protocol (unchanged vocabulary, made continuous)

Host → embed (existing): `scrubStart` / `scrubTo(epochMs)` / `scrubEnd(epochMs)` / `seekTo(epochMs)` / `play` / `pause` / `setRate` / `fit`.
Embed → host (existing): `{type:'state'}` / `{type:'position', positionMs}` / `{type:'log'}`.

Change: the host emits `scrubTo` **continuously** during a drag/scroll (throttled), and the embed treats each as **latest-wins with cancellation** of in-flight work. No new message types.

## Components

### A. Native — `scrub-controller` (new, `srcV2/recording/`)
A small hook/store owning the single source of truth:
- State: `scrubEpoch: number | null` (target while scrubbing), `scrubbing: boolean`, `playheadEpoch: number | null` (from `onPosition`).
- `beginScrub(source)` / `updateScrub(epoch, source)` / `endScrub(epoch, source)` / `seek(epoch)` / `setPlayhead(epoch)`.
- **Echo guard:** each mutation records its `source` ('timeline' | 'heatmap'); when a surface re-renders from state it must NOT re-emit a gesture if it was the source of the current value (prevents scroll→state→scroll loops).
- **Throttle:** `updateScrub` coalesces to ~rAF / 60–80 ms before emitting `recRef.scrubTo`.
- Pure reducers (unit-tested) for the epoch math + echo decision; the React/store glue is thin.

### B. Native — vertical timeline geometry (`TheaterTimeline`)
Today the list is `mock-data` rows with no time mapping. We introduce a **deterministic offset↔epoch geometry**:
- A pure module `timeline-geometry.ts`: `offsetToEpoch(offsetY, topMs, pxPerHour)` and `epochToOffset(epoch, …)` derived from the active zoom level (`spanHours` → px/hour) and `topMs` (snapped live edge).
- Wire `onScroll` → `offsetToEpoch` → `controller.updateScrub('timeline')` (live preview while scrolling); on scroll-settle → `endScrub`. Add **tap-to-seek** on a row → `controller.seek`.
- When `scrubEpoch`/`playhead` changes from the OTHER surface, programmatically `scrollToOffset(epochToOffset(...))` (echo-guarded).
- Real recorded coverage continues to bound seeks via `nearestCoveredEdge`. The visual rows may stay mock for now, but **the scroll position maps to real time**.

### C. Native — `HeatmapBar` (minimap)
- Keep the existing pan/tap responder. Drag → `controller.updateScrub('heatmap')`; tap → `controller.seek`.
- Render a **cursor** at the fraction of `playheadEpoch` (or `scrubEpoch` while scrubbing) over the day window.
- Coverage backdrop already real.

### D. Embed — scrub renderer (`EmbedRecordingPage` + `scrub/`)
- **Persistent `VideoDecoder`**: configure once per codec; reuse across segments. Reconfigure only on codec change. Close on unmount.
- **Index once per day window**: `ensureLowIndex` builds the `low` index for the whole day (from coverage bounds) and caches it; no per-scrub ±3h refetch. (Relative-URL fix already in.)
- **Caches (LRU, bounded):** fetched segment bytes by `uri`; decoded frames (as `ImageBitmap`/data) by segment `startMs`. A scrub to a cached segment paints instantly.
- **Prefetch:** on `scrubTo`, prefetch the next K segments in the drag direction (fetch + optionally decode) so the upcoming frames are warm.
- **Cancellation:** an `AbortController` per scrub generation; a newer `scrubTo` aborts in-flight fetch + supersedes decode (latest-wins). No more decode/fetch spam.
- **Draw:** the freshest decoded frame wins; stale results are dropped (generation token).

### E. Embed — VOD playback (settle + fixes)
- `scrubEnd(epoch)` → `loadAt(epoch)` (HLS master) → play; the scrub canvas stays visible until the first real `<video>` frame, then hides (no black gap).
- Connect `onPosition` end-to-end (host already parses `position`; native now stores it as `playheadEpoch`).
- Investigate/fix `loadedmetadata w:0 h:0` and "plays one tick then stops" — primary hypothesis: removed once scrub no longer hammers `loadAt`/`play` (no more `AbortError`); confirm `onTimeUpdate`/`position` advance via logs; if it persists, inspect the HLS master/`<video>` on iOS.

## Data flow (a scrub gesture)

1. User drags heatmap OR scrolls vertical timeline → that surface computes `epoch` → `controller.updateScrub(epoch, source)`.
2. Controller throttles → `recRef.scrubTo(epoch)`; the OTHER surface's cursor/scroll updates from state (echo-guarded).
3. Embed `scrubTo`: bump generation, abort previous, `segmentAt(epoch)` on the cached index → cache hit paints instantly, else fetch (cancellable) → decode on the persistent decoder → draw if still latest; prefetch neighbours.
4. Release → `controller.endScrub(epoch)` → `recRef.scrubEnd(epoch)` → embed loads HLS at epoch, plays; `position` flows back → `playheadEpoch` → cursors follow.

## Error handling
- Decode/codec unsupported (iOS HEVC): the embed already surfaces a one-time error state; keep that, and fall back to the VOD `<video>` poster / last good frame rather than black.
- Fetch abort is normal (latest-wins) — never surfaced as an error.
- Empty coverage / no segment at epoch: no-op the scrub (no crash); the seek snaps to `nearestCoveredEdge`.
- All paths logged at `debug` via the unified logger for on-device/server diagnosis.

## Testing / verification
- **Unit:** pure modules — `timeline-geometry` (offset↔epoch round-trip), `scrub-controller` reducers (echo guard, throttle decision), `low-index` (segment parse, relative-URL resolve), `segmentAt`.
- **Manual (logging-driven, cam 99):** debug mode ON → drag heatmap and scroll timeline → expect `embed:scrub segmentAt/decoded/drawn` (no errors), cache hits on re-cross, `rec:position` advancing after settle, heatmap+timeline cursors in sync; confirm no `AbortError` storms.

## Out of scope (explicit)
- Server-generated thumbnail sprites (chosen client-side WebCodecs instead).
- Frame-exact (sub-segment) scrubbing — granularity is keyframe-per-segment (~4 s).
- Moving the timeline into the WebView (kept native; revisit only if the bridge proves limiting).

## Affected files (indicative)
**Viewer:** `srcV2/recording/scrub-controller.ts` (new), `srcV2/components/camera/theater/timeline-geometry.ts` (new), `TheaterTimeline.tsx`, `HeatmapBar.tsx`, `CameraDetailScreen.tsx`, `RecordingPlayerWebView.tsx`.
**Embed (server):** `src/pages/EmbedRecordingPage.tsx`, `src/scrub/low-index.ts`, `src/scrub/keyframe-decoder.ts` (persistent decoder), possibly a new `src/scrub/scrub-engine.ts` (cache/prefetch/cancel).
