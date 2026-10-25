# Recorded-Playback Control Contract — Design

**Date:** 2026-06-16
**Status:** Draft (regroup after device testing on cam 99 showed instability)
**Scope:** viewer (`camstack-viewer/srcV2`) ↔ embed (`addon-pipeline/embed`) ↔ stream-broker WebRTC `TimelineSession`
**Related:** [[project_recorded_webrtc_timeline]], specs `2026-06-16-recording-scrub-vod-design.md`, plan `2026-06-16-recorded-webrtc-timeline-viewer.md`

---

## 1. Why this doc exists

Recorded playback over WebRTC *renders* (the server RTP source-switch rebase works), but device
testing showed the **control layer is incoherent**. Symptoms reported by the user and confirmed in
the server log (`camstack-2026-06-16.log`, cam 99):

| Symptom | Evidence in log | Root area |
| --- | --- | --- |
| Go-Live never returns to live, jumps to random places | **Zero `goLive` control messages ever reach the server** — only `seek` + `scrubCommit` appear in `control dispatch`. Same for `playRecorded` and `setRate`. | viewer→embed handle / stale embed bundle |
| Constant interruptions during playback | Storm of `scrubCommit`/`seek` with wildly jumping epochs (…631→…629→…623→…639→…643 over ~10 s); **each reloads the feeder** (`feeder state loading→playing`). | viewer scrub-controller / heatmap gesture |
| Heatmap tap lands too far back (#1) | Epochs carry fractions (`1781593976651.0776`) and fall outside the intended window → snapped backwards by `nearestCoveredEdge`. | viewer geometry (fraction→epoch) |
| No audio on recorded playback | `RecordedFeeder` is video-only by design (v1). | server feeder (feature gap) |
| Occasional `feeder state: gap` | A `scrubCommit` targeted an uncovered epoch. | recorder gaps (#5) + seek into gap |

**Conclusion:** the server data path is sound. The instability lives in the **viewer↔embed control
contract**, which has no explicit state machine, no debounce/coalescing, no rounding, and (at
runtime) a dead `goLive`/`playRecorded`/`setRate` vocabulary. This doc defines that contract before
any further code changes.

---

## 2. The control vocabulary (today, as built)

Full chain for one command:

```
CameraDetailScreen  →  liveRef (LiveViewHandle)  →  WebView injectJavaScript
   playbackCommandToScript(cmd)  →  window.__camstackEmbed.<method>()
   →  sendControl({kind})  →  hostCommandToControl  →  {t:…}  →  data channel
   →  server TimelineSession.handleControl
```

Message set (`live-control-map.ts` PlaybackCommand ↔ `host-control-map.ts` ControlMessage):

| Host command (RN→embed) | Embed method | Control msg (embed→server) | Server effect |
| --- | --- | --- | --- |
| `playRecorded{deviceId,epochMs,profile}` | `playRecorded` | `{t:'playRecorded',…}` | gate live, start feeder at epoch |
| `seek{epochMs}` | `seek` | `{t:'seek',epoch}` | feeder seek (fresh IDR) |
| `scrubStart` | `scrubStart` | *(client-local, null)* | — |
| `scrubTo{epochMs}` | `scrubTo` | *(client-local, null)* | (preview only; no server hit) |
| `scrubEnd/scrubCommit{epochMs}` | `scrubCommit` | `{t:'scrubCommit',epoch}` | feeder seek + resume |
| `setRate{0|1}` | `setRate` | `{t:'setRate',rate}` | pause/play feeder |
| `goLive` | `goLive` | `{t:'goLive'}` | ungate live, keyframe restart |

The **source mapping is correct and unit-tested** (`host-control-map.spec.ts`). The break is that
`goLive`/`playRecorded`/`setRate` never traverse at runtime — so either the deployed embed bundle is
stale, or `liveRef.goLive()` doesn't inject on the active player. This MUST be verified first (§5.1).

---

## 3. Target contract: a 3-state player model

The viewer owns one explicit playback state per camera-detail surface. Every gesture is a transition.

```
            seek(epoch in coverage) / scrubCommit
   ┌────────────────────────────────────────────────┐
   │                                                  ▼
[LIVE] ──tap/scroll to past──► [SEEKING] ──settle──► [RECORDED]
   ▲                                                  │
   └──────────────── goLive ◄─────────────────────────┘
                 (always returns to live edge = now)
```

- **LIVE** — live feed, no gate. `status.isLive = true`, Go-Live pill hidden.
- **SEEKING** — user dragging; viewer shows local preview (WebCodecs later), emits **throttled**
  `scrubTo` (client-local, NO server reload). No feeder reload during drag.
- **RECORDED** — feeder playing a past epoch. Go-Live pill shown.

### Transition rules (the part that's currently missing)

1. **One server commit per gesture.** A drag emits many `scrubTo` (local preview, throttled ~70 ms)
   but exactly **one** `scrubCommit` on release. A tap emits exactly **one** `seek`. No bursts.
2. **Coalesce / dedupe commits.** Drop a `seek`/`scrubCommit` whose target is within ±N ms
   (e.g. 750 ms) of the epoch already loading/playing — avoids the reload storm. Track
   `lastCommittedEpoch`; ignore near-duplicates and in-flight repeats.
3. **Integer epochs.** Round fraction→epoch to whole ms at the geometry boundary. No fractional
   epochs on the wire.
4. **Go-Live is a distinct command, never a seek.** `goLive` ungates live and targets the live edge
   (now). It must NOT be expressed as `seek(nowMs)` (that re-enters recorded at "now-ish" and races
   the live edge). The pill calls `liveRef.goLive()` → `{t:'goLive'}`, full stop.
5. **Tap vs drag disambiguation must be reliable.** `HeatmapBar` currently flips to "moved" at >4 px;
   verify a clean tap can't be misread as a micro-drag → spurious `scrubCommit`. Treat sub-threshold
   movement as a tap (→ single `seek`).
6. **Echo suppression.** Server `position` updates drive the cursor only (`setPlayhead`); they must
   never feed back into a `seek`/`scrubCommit`.

---

## 4. Recorded audio (now in scope — user decision 2026-06-16)

v1 was video-only. We will add a synchronized audio track to `RecordedFeeder`:

- Demux the audio elementary stream from the stored `.m4s` segments (node-av), alongside video.
- Push audio access units to the session on the **same monotonic 90 kHz-derived clock** as video so
  A/V stay in sync across seeks (reset audio + video together on a seek/source-switch).
- Remove (or invert) the `writeAudio` gate so recorded audio plays while `liveFeedGated`, but **live**
  audio stays gated. Distinguish "recorded audio" from "live audio bleed": gate the *live* source,
  not the audio sender itself.
- Negotiate the audio codec once (Opus/AAC) consistent with the live path; transcode if the stored
  codec differs from what was negotiated.

This is a server-side workstream, parallel to the viewer control fixes.

---

## 5. Workplan (one item at a time, diagnostics ON)

**Pre-req:** restore the diagnostic logs trimmed in `06d7cefc` (user decision), redeploy ONCE so the
running embed+broker == source, then stop redeploying during testing.

### 5.1 Verify the command path end-to-end (BLOCKER — do first)
- Restore diagnostics (`control dispatch`, GATED/UNGATED, `data channel arrived`, embed `console.log`
  of `sendControl ->`). Rebuild ui-library + addon-pipeline, deploy once.
- From the device: tap Go-Live. Confirm whether `__camstackEmbed.goLive()` fires, whether
  `sendControl -> goLive` logs in the WebView console, and whether `{t:'goLive'}` reaches
  `control dispatch`. This localises the break to viewer-handle vs embed-bundle vs server.

### 5.2 Fix Go-Live
- Based on 5.1: ensure `liveRef.goLive()` injects on the **active** player (the WebView player, not the
  native RTC player where recorded-control is a no-op), and that the deployed embed includes the
  `goLive` wiring. Confirm server `handleControl({t:'goLive'})` ungates live + forces keyframe
  (server #3 fix). Device-confirm live actually restarts at NOW.

### 5.3 Kill the commit storm
- Implement §3 rules 1–2 in `scrub-controller.ts` / `HeatmapBar.tsx`: single commit per gesture,
  coalesce/dedupe within ±N ms, drop in-flight repeats. Add tests to the existing vitest suite.

### 5.4 Fix geometry (#1 heatmap offset)
- Round fraction→epoch to integer ms; confirm `viewWindow` (coverage-tightened) is the SAME window used
  for both the heatmap backdrop placement and `fractionToEpoch` (it is, in `TheaterTimeline` — verify no
  day-window vs view-window mismatch remains). Re-test tap accuracy.

### 5.5 Recorded audio (server, §4)
- Add audio demux + synchronized push to `RecordedFeeder`; adjust the gate to pass recorded audio.

### 5.6 Recorder resilience (#5, deferred)
- `SegmentWriter` backoff/resume on brief `:8554` outage instead of "giving up".

---

## 6. Decisions captured (2026-06-16)
- **Audio:** include now (not deferred).
- **Approach:** design contract first (this doc), then implement item-by-item.
- **Diagnostics:** restore the trimmed logs; keep them until the feature is stable. ✅ done (server redeployed @0.1.19).
- **No redeploy churn** while the user is recording/testing (breaks the recorder → gaps).
- **Native iOS player REMOVED entirely** (user decision, Android out of scope for now). ✅ done.
  `LiveViewNative.tsx` deleted; `LiveView.tsx` always renders `LiveViewWebView`; the
  `settings.stream.iosPlayer` setting + its UI + i18n keys + tests removed. This eliminates the
  no-op recorded-control stubs that silently swallowed `goLive`/`seek`/`scrubCommit`. ts-check +
  lint clean, 264 vitest pass. This subsumes §5.2's "ensure active player is the WebView" — there is
  now only one player.

## 7. Open questions
- Is the device on the WebView player or the native RTC player when recorded playback runs? (Recorded
  control is a no-op on the native player — could explain dead `goLive` if the active player is native.)
- Is the deployed embed bundle (0.1.19) actually carrying the `goLive` wiring, or is it stale?
- Stored audio codec on cam 99 segments (Opus vs AAC) → decide passthrough vs transcode for §4.
