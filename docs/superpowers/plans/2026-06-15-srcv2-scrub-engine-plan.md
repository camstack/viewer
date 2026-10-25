# Scrub Engine (WebCodecs in the recording embed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add frame-accurate scrub over recorded footage to the hub-served recording embed (`?mode=recording`), reusing the recorded `low` HEVC stream + WebCodecs, per `camstack-server/docs/superpowers/specs/2026-06-13-viewer-scrub-client-design.md`. Builds on the Phase-1 VOD plan (`2026-06-15-srcv2-recording-playback-scrub-plan.md`).

**Architecture:** Same surface as VOD — the WebCodecs `ScrubEngine` lives INSIDE `EmbedRecordingPage` (secure context from the hub origin; same-origin Range fetches with token-in-path). The native RN timeline drives it via new `scrubStart/scrubTo/scrubEnd` host commands; on `scrubEnd` the page hands back to the HLS `<video>` at the settled epoch. Two-tier: coarse keyframe-jump during drag, exact decode-forward on settle.

**Tech Stack:** `mp4box.js` (demux fMP4 `.m4s` → `EncodedVideoChunk`), WebCodecs `VideoDecoder` (HEVC hw on Safari/WKWebView ≥ 16.4), canvas render. Added to `camstack-server/packages/addon-pipeline` (bundled into the embed by vite).

**Sequencing (de-risk-first):**
- **Slice A — de-risk (this plan, detailed):** prove WebCodecs HEVC decode of a recorded `low` segment in the target WKWebView; render the covering segment's keyframe on a canvas on `scrubTo` (coarse). Real, committed, testable alongside VOD. If decode is unsupported/black on device → fall back (native `AVAssetImageGenerator`, or coarse `<video>` seek) before investing in B/C.
- **Slice B — exact frame:** decode-forward from the keyframe to the frame at T on settle.
- **Slice C — production engine:** latest-wins ScrubQueue, segment LRU + prefetch, gap handling, segment-not-finalized clamp, endpoint failover, leak-free `VideoFrame.close()`.

**Repos:** `camstack-server` (embed scrub engine) + `camstack-viewer` (timeline scrub gesture + commands). Deploy: `cd camstack-server/packages/addon-pipeline && npm run build && camstack deploy . --no-build --server https://localhost:4443`.

---

## Backend inputs (exist)

- `recording.getPlaybackManifest({deviceId, fromMs, toMs})` → master HLS url (token in path). The master references variant playlists by relative URI; the `low` variant is `low.m3u8` (independently fetchable: `…/playback/<deviceId>/low.m3u8?from=&to=`).
- Segments: per-GOP fMP4 `<startMs>-<durMs>.m4s` (absolute epoch start), `206 Range`-capable, each begins with an IDR keyframe → independently decodable.
- Per-segment epoch↔media mapping: keep a per-segment `epochBase`; never assume a global media clock.

---

## Slice A — de-risk: coarse keyframe scrub

### Task 1: Add mp4box.js to the embed bundle

**Files:** `camstack-server/packages/addon-pipeline/package.json`

- [ ] **Step 1:** `cd camstack-server/packages/addon-pipeline && npm i mp4box@^0.5.2`
- [ ] **Step 2:** Confirm it resolves: `node -e "require('mp4box')"` (no throw) — or that `import MP4Box from 'mp4box'` type-checks in the embed (vite bundles it).
- [ ] **Step 3: Commit** — `git -C camstack-server add packages/addon-pipeline/package.json package-lock.json && git -C camstack-server commit -m "chore(embed): add mp4box.js for scrub demux"`

### Task 2: Low-playlist + segment index resolver (embed, pure-ish)

**Files:** Create `camstack-server/packages/addon-pipeline/embed/src/scrub/low-index.ts`

Resolves a `low` segment index from a master URL: fetch master → find the `low` variant URI → fetch that media playlist → parse `.m4s` URIs + epoch starts from `<startMs>-<durMs>.m4s` filenames.

- [ ] **Step 1: Implement**

```ts
export interface LowSegment {
  readonly uri: string        // absolute, token-in-path
  readonly startMs: number    // absolute epoch (from filename)
  readonly durMs: number
}

/** Absolute-ize a possibly-relative playlist/segment URI against a base URL. */
function resolveUri(base: string, ref: string): string {
  return new URL(ref, base).toString()
}

/** Parse `<startMs>-<durMs>.m4s` (absolute epoch start). Null if not that shape. */
function parseSegName(uri: string): { startMs: number; durMs: number } | null {
  const name = uri.split('/').pop() ?? ''
  const m = name.match(/(\d+)-(\d+)\.m4s/)
  if (!m) return null
  return { startMs: Number(m[1]), durMs: Number(m[2]) }
}

/** Pick the `low` variant URI from a master playlist (lowest RESOLUTION line). */
function pickLowVariant(masterText: string, masterUrl: string): string | null {
  const lines = masterText.split('\n').map((l) => l.trim())
  // Prefer an explicit low.m3u8; else the last STREAM-INF variant (low is last).
  for (const l of lines) if (/low\.m3u8/i.test(l)) return resolveUri(masterUrl, l)
  let lastUri: string | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      lastUri = resolveUri(masterUrl, lines[i + 1])
    }
  }
  return lastUri
}

/** Build the ordered low-segment index for a master URL. */
export async function buildLowIndex(masterUrl: string): Promise<LowSegment[]> {
  const masterText = await (await fetch(masterUrl)).text()
  const lowUrl = pickLowVariant(masterText, masterUrl)
  if (!lowUrl) return []
  const lowText = await (await fetch(lowUrl)).text()
  const segs: LowSegment[] = []
  for (const raw of lowText.split('\n').map((l) => l.trim())) {
    if (!raw || raw.startsWith('#')) continue
    const abs = resolveUri(lowUrl, raw)
    const named = parseSegName(abs)
    if (named) segs.push({ uri: abs, startMs: named.startMs, durMs: named.durMs })
  }
  segs.sort((a, b) => a.startMs - b.startMs)
  return segs
}

/** The segment covering epochMs (or the nearest one). Null if index empty. */
export function segmentAt(index: readonly LowSegment[], epochMs: number): LowSegment | null {
  if (index.length === 0) return null
  for (const s of index) if (epochMs >= s.startMs && epochMs < s.startMs + s.durMs) return s
  // Nearest by start.
  return index.reduce((best, s) =>
    Math.abs(s.startMs - epochMs) < Math.abs(best.startMs - epochMs) ? s : best, index[0])
}
```

- [ ] **Step 2: Type-check** — `cd camstack-server/packages/addon-pipeline && npx tsc -p embed/tsconfig.json` → 0.
- [ ] **Step 3: Commit** — `git -C camstack-server add packages/addon-pipeline/embed/src/scrub/low-index.ts && git -C camstack-server commit -m "feat(scrub): low-variant segment index resolver"`

### Task 3: Keyframe decoder (embed)

**Files:** Create `camstack-server/packages/addon-pipeline/embed/src/scrub/keyframe-decoder.ts`

mp4box-demux a single `.m4s` (fetched whole — it's ~1 GOP) → `VideoDecoderConfig` + first `EncodedVideoChunk` (key) → `VideoDecoder` → draw the `VideoFrame` to a canvas.

- [ ] **Step 1: Implement** (mp4box.js: `createFile()`, `onReady` gives tracks + `hvcC`/`avcC` description; `appendBuffer` with `fileStart=0`; `onSamples` yields samples with `is_sync`, `data`, `cts`/`timescale`).

```ts
import MP4Box, { type MP4ArrayBuffer } from 'mp4box'

export interface DecodedKeyframe {
  readonly bitmap: VideoFrame
  readonly epochMs: number
}

/** Demux one fMP4 segment → decode its FIRST keyframe → return the VideoFrame.
 *  segStartMs = the segment's absolute epoch (for mapping). Caller closes the
 *  returned VideoFrame. Throws if config is unsupported (de-risk signal). */
export async function decodeFirstKeyframe(segmentBytes: ArrayBuffer, segStartMs: number): Promise<DecodedKeyframe> {
  const file = MP4Box.createFile()
  const config = await new Promise<VideoDecoderConfig>((resolve, reject) => {
    file.onError = (e: string) => reject(new Error(`mp4box: ${e}`))
    file.onReady = (info) => {
      const track = info.videoTracks?.[0]
      if (!track) { reject(new Error('no video track')); return }
      // codec e.g. 'hvc1.1.6.L93.B0'; description = the hvcC/avcC box bytes.
      const trak = file.getTrackById(track.id)
      let description: Uint8Array | undefined
      for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
        const box = entry.hvcC ?? entry.avcC
        if (box) {
          const stream = new (MP4Box as unknown as { DataStream: new (b: undefined, o: number, e: unknown) => { buffer: ArrayBuffer; endianness: unknown } }).DataStream(undefined, 0, /* big-endian */ false)
          box.write(stream as unknown as never)
          description = new Uint8Array(stream.buffer, 8) // strip the 8-byte box header
        }
      }
      resolve({ codec: track.codec, codedWidth: track.video?.width, codedHeight: track.video?.height, description })
    }
    const buf = segmentBytes as MP4ArrayBuffer
    buf.fileStart = 0
    file.appendBuffer(buf)
    file.flush()
  })

  const support = await VideoDecoder.isConfigSupported(config)
  if (!support.supported) throw new Error(`unsupported codec: ${config.codec}`)

  // Pull the first sync sample.
  const chunk = await new Promise<EncodedVideoChunk>((resolve, reject) => {
    file.onSamples = (_id: number, _user: unknown, samples: Array<{ is_sync: boolean; data: ArrayBuffer; cts: number; timescale: number }>) => {
      const key = samples.find((s) => s.is_sync) ?? samples[0]
      if (!key) { reject(new Error('no sample')); return }
      resolve(new EncodedVideoChunk({ type: 'key', timestamp: Math.round((key.cts / key.timescale) * 1e6), data: key.data }))
    }
    const trackId = (file as unknown as { getTrackById: (i: number) => { id: number } }) // typed loosely
    file.setExtractionOptions(1, null, { nbSamples: 1 })
    file.start()
    void trackId
  })

  const frame = await new Promise<VideoFrame>((resolve, reject) => {
    const decoder = new VideoDecoder({
      output: (f) => { resolve(f); decoder.close() },
      error: (e) => reject(e),
    })
    decoder.configure(config)
    decoder.decode(chunk)
    void decoder.flush().catch(reject)
  })

  return { bitmap: frame, epochMs: segStartMs }
}
```

> NOTE for the implementer: mp4box.js typings are loose — `mp4box` ships partial types; if the build complains, add a local `embed/src/scrub/mp4box.d.ts` shim declaring `createFile()`, `DataStream`, and the callback shapes used above (do NOT use `any`; declare the minimal members). The `description`-extraction (hvcC/avcC → decoder `description`) is the one fiddly bit — verify against a real segment in Task 5.

- [ ] **Step 2: Type-check** → 0 (add the d.ts shim if needed).
- [ ] **Step 3: Commit** — `git -C camstack-server add packages/addon-pipeline/embed/src/scrub/ && git -C camstack-server commit -m "feat(scrub): single-segment keyframe decoder (WebCodecs)"`

### Task 4: Wire coarse scrub into the recording embed + host commands

**Files:**
- Modify `camstack-server/packages/addon-pipeline/embed/src/pages/EmbedRecordingPage.tsx`
- Modify `camstack-viewer/srcV2/recording/recording-messages.ts` (+ extend the spec test)
- Modify `camstack-viewer/srcV2/live/RecordingPlayerWebView.tsx`
- Modify `camstack-viewer/srcV2/components/camera/theater/TheaterTimeline.tsx` + `HeatmapBar.tsx`

- [ ] **Step 1 (embed):** add a full-cover `<canvas>` over the `<video>` (hidden unless scrubbing). Add host API `scrubStart()`, `scrubTo(epochMs)`, `scrubEnd(epochMs)`:
  - `scrubStart`: show the canvas; lazily build the low index for the current window via `getPlaybackManifest(epochMs±WINDOW).playbackUrl` → `buildLowIndex`.
  - `scrubTo(epochMs)`: `segmentAt(index, epochMs)` → fetch the segment bytes (`fetch(seg.uri)`) → `decodeFirstKeyframe` → draw to the canvas (`canvas.getContext('2d').drawImage(frame, 0,0, w,h)`, then `frame.close()`). Latest-wins: ignore a result if a newer `scrubTo` arrived (monotonic request id).
  - `scrubEnd(epochMs)`: hide the canvas and `seekTo(epochMs)` (the existing HLS path) — keep the last canvas frame painted until `<video>` plays (reuse the retained-frame idea).
- [ ] **Step 2 (viewer messages):** add `scrubStart | scrubTo(epochMs) | scrubEnd(epochMs)` to `RecordingCommand` + `recordingCommandScript`; extend the spec test (assert `scrubTo(123)` etc.). Run `npx vitest run srcV2/recording`.
- [ ] **Step 3 (viewer WebView):** add `scrubStart/scrubTo/scrubEnd` to `RecordingPlayerHandle` + imperative impl.
- [ ] **Step 4 (viewer timeline):** add a horizontal drag (or vertical-scrub) gesture on the `HeatmapBar` that emits `scrubStart` → `scrubTo(epoch)` per move → `scrubEnd(epoch)` on release; map x-fraction → epoch over the day window (snap to coverage). Only when a `RecordingPlayerHandle` is active (in VOD).
- [ ] **Step 5: build + deploy** — embed `tsc` 0, `npm run build`, `camstack deploy`; viewer `ts-check` + `test:v2`.
- [ ] **Step 6: DEVICE de-risk verify (manual, the go/no-go):** on iOS ≥ 16.4 against the hub, scrub the timeline of a camera with `low` footage:
  - coarse keyframe renders on the canvas during drag (measure finger→frame latency, median + p90);
  - `isConfigSupported` true (HEVC decodes — NOT black);
  - 60s sustained scrub stays memory-flat (no `VideoFrame` leak);
  - on release, hands back to HLS `<video>` at the settled time with no black flash.
  - **GO** ⇒ Slice B/C. **NO-GO** ⇒ record why; fall back (native frame extractor or coarse `<video>` seek).
- [ ] **Step 7: Commit** the embed + viewer scrub wiring.

---

## Slice B — exact frame on settle (own iteration, gated on Slice A GO)
Decode-forward from the segment keyframe to the frame whose `timestamp ≥ T`, emit that one. Reuse one `VideoDecoder` across the segment; cap `decodeQueueSize`; `close()` intermediate frames. Trigger on `scrubEnd`/dwell (not every move).

## Slice C — production engine (own plan, gated on Slice B)
Per `2026-06-13-viewer-scrub-client-design.md` §4: `ScrubQueue` (latest-wins, rAF-coalesced, flush stale), `SegmentSource` (206 Range, LRU 8–16, prefetch N±1 + drag direction), `DecoderPool` (reuse across contiguous same-config segments, reset on discontinuity), gap handling (jump to next range keyframe), segment-not-finalized clamp at the live edge, endpoint failover (LAN→relay via `orderedPlaybackEndpoints`), strict `VideoFrame.close()` + idle-decoder close. LIVE-DVR handoff (§5.2) if/when live-edge scrub is wanted.

---

## Self-Review
- **Spec coverage** (`2026-06-13-viewer-scrub-client-design.md`): §2 reuse-low keyframe → Slice A; §3 server contract (master→low→segments) → Task 2; §4.2 mp4box demux + §4.3 WebCodecs → Task 3; §4.4 coarse phase → Task 4; exact phase → Slice B; latest-wins/LRU/prefetch/gaps/failover/§5.2 → Slice C; §7 iOS 16.4 + isConfigSupported fallback → Task 4 Step 6. ✓
- **Placeholder scan:** Slice A carries full code; the one flagged soft spot is mp4box's `description` extraction + loose typings (Task 3 NOTE) — to verify against a real segment in Task 5/6, not a hidden stub. Slices B/C are explicitly gated outlines, not task-stubs. ✓
- **Type consistency:** `RecordingCommand` extends with `scrubStart/scrubTo/scrubEnd`; `RecordingPlayerHandle` gains the same three; `LowSegment`/`DecodedKeyframe` names consistent across Tasks 2–4. ✓
- **Risk:** WebCodecs HEVC in the target WKWebView is the core unknown — Task 4 Step 6 is the explicit go/no-go BEFORE Slices B/C, per the locked sequencing.

---

## Execution Handoff
Slice A is execution-ready; Slices B and C are gated on the Slice-A device go/no-go. Recommended: subagent-driven or inline executing-plans for Slice A, then re-evaluate after the device measurement.
