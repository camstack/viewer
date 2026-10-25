# srcV2 Camera·Timeline Page — Implementation Plan (Plan C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the srcV2 camera·timeline page — live, VOD playback, frame-accurate scrub, and motion/audio/recording activity bands — reusing the current app's structure, restyled to camstack.

**Architecture:** RN-native. A `ScrubEngine` with a platform-swappable decode backend (native `AVAssetImageGenerator`/`MediaMetadataRetriever`; WebCodecs on web) scrubs the recorded LOW substream (reuse-low, HEVC 640×360 GOP≈4s, two-tier coarse-keyframe + decode-forward). Live = native WebRTC; VOD = native HLS ABR. The timeline data layer is pure TS over `recording.getAvailability` (coverage) + `pipeline-analytics.getEventDensity` (bands).

**Tech Stack:** TypeScript, vitest, `@camstack/sdk`, `react-native-video`, React Native.

**Spec:** `docs/superpowers/specs/2026-06-13-srcv2-camera-timeline-design.md`

---

## Phasing & gates

This plan is phased because the scrub decode approach is **gated by the iOS de-risk spike**
(`docs/superpowers/plans/2026-06-13-srcv2-ios-scrub-spike.md`):

- **Phase C1 — Timeline data layer (UNBLOCKED, in this plan, full TDD).** Pure-TS, spike-independent,
  low rework risk regardless of which decode backend wins. Built now.
- **Phase C2 — ScrubEngine + native decode (GATED on the spike GO/NO-GO).** TimelineModel
  (epoch↔segment), SegmentSource (reuses `data-plane-failover`), DecodeBackend (native + WebCodecs),
  ScrubQueue (latest-wins), Renderer. Tasks authored AFTER the spike confirms the approach.
- **Phase C3 — Camera·timeline RN screen + restyle (GATED on the srcV2 ThemeProvider).** The screen
  scaffold, vertical-scroll scrubber, overlay controls, live/VOD/scrub wiring, and camstack restyle.
  Needs the `ThemeProvider`/`useColorScheme` plumbing (dark+light) which also unlocks the tracked
  `BAND`/`ConnectionBanner` light-mode follow-up.

Only Phase C1 has executable tasks below. C2/C3 are outlined so the data layer is built against the
right contracts; their full TDD tasks are written once their gates clear.

---

## File Structure (Phase C1)

- `srcV2/timeline/coverage.ts` — merge/union recorded `ranges`, coverage test, nearest-edge snapping. One responsibility: recorded-coverage geometry.
- `srcV2/timeline/density-bands.ts` — turn `getEventDensity` buckets into normalized motion/audio band intensities for the heatmap. One responsibility: density→band mapping.
- Tests co-located under `srcV2/timeline/__tests__/`.

---

### Task 1: Recorded-coverage geometry

**Files:**
- Create: `srcV2/timeline/coverage.ts`
- Test: `srcV2/timeline/__tests__/coverage.spec.ts`

- [ ] **Step 1: Write the failing test** — create `srcV2/timeline/__tests__/coverage.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeRanges, isCovered, nearestCoveredEdge, type TimeRange } from '../coverage.js'

const r = (startMs: number, endMs: number): TimeRange => ({ startMs, endMs })

describe('mergeRanges', () => {
  it('merges overlapping and adjacent ranges, sorted, ignoring profile origin', () => {
    expect(mergeRanges([r(30, 40), r(0, 10), r(10, 20), r(15, 35)])).toEqual([r(0, 40)])
  })

  it('keeps disjoint ranges separate and sorted', () => {
    expect(mergeRanges([r(100, 110), r(0, 10)])).toEqual([r(0, 10), r(100, 110)])
  })

  it('returns [] for no ranges', () => {
    expect(mergeRanges([])).toEqual([])
  })
})

describe('isCovered', () => {
  const merged = [r(0, 10), r(100, 110)]
  it('is true inside a range (inclusive start, exclusive end)', () => {
    expect(isCovered(0, merged)).toBe(true)
    expect(isCovered(9, merged)).toBe(true)
    expect(isCovered(10, merged)).toBe(false)
  })
  it('is false in a gap', () => {
    expect(isCovered(50, merged)).toBe(false)
  })
})

describe('nearestCoveredEdge', () => {
  const merged = [r(0, 10), r(100, 110)]
  it('returns the closest range edge to a gap time', () => {
    expect(nearestCoveredEdge(40, merged)).toBe(10)   // closer to first range end
    expect(nearestCoveredEdge(70, merged)).toBe(100)  // closer to second range start
  })
  it('returns the time itself when already covered', () => {
    expect(nearestCoveredEdge(5, merged)).toBe(5)
  })
  it('returns null when there is no coverage', () => {
    expect(nearestCoveredEdge(5, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- coverage`
Expected: FAIL — cannot find module `../coverage.js`.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/timeline/coverage.ts`:

```typescript
/** A half-open recorded interval [startMs, endMs). Profile is dropped here —
 *  coverage is the union across all recorded profiles. */
export interface TimeRange {
  readonly startMs: number
  readonly endMs: number
}

/** Union of recorded ranges (possibly per-profile / overlapping / unsorted)
 *  into sorted, non-overlapping intervals. Adjacent ranges (a.end === b.start)
 *  merge into one. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const out: TimeRange[] = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.startMs <= last.endMs) {
      out[out.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, cur.endMs) }
    } else {
      out.push({ startMs: cur.startMs, endMs: cur.endMs })
    }
  }
  return out
}

/** True when t falls in a recorded interval (inclusive start, exclusive end). */
export function isCovered(t: number, merged: readonly TimeRange[]): boolean {
  return merged.some((r) => t >= r.startMs && t < r.endMs)
}

/** The nearest covered time to t: t itself when covered, else the closest range
 *  edge (start or end). Null when there is no coverage. */
export function nearestCoveredEdge(t: number, merged: readonly TimeRange[]): number | null {
  if (merged.length === 0) return null
  if (isCovered(t, merged)) return t
  let best: number | null = null
  let bestDist = Infinity
  for (const r of merged) {
    for (const edge of [r.startMs, r.endMs]) {
      const d = Math.abs(edge - t)
      if (d < bestDist) {
        bestDist = d
        best = edge
      }
    }
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- coverage`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/timeline/coverage.ts srcV2/timeline/__tests__/coverage.spec.ts
git commit -m "feat(srcV2): recorded-coverage geometry (merge ranges, isCovered, nearest edge)"
```

---

### Task 2: Density → activity-band mapping

**Files:**
- Create: `srcV2/timeline/density-bands.ts`
- Test: `srcV2/timeline/__tests__/density-bands.spec.ts`

- [ ] **Step 1: Write the failing test** — create `srcV2/timeline/__tests__/density-bands.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toBands, type DensityBucket, type ActivityBand } from '../density-bands.js'

const b = (bucketStart: number, motion: number, object: number, audio: number): DensityBucket => ({
  bucketStart,
  motion,
  object,
  audio,
})

describe('toBands', () => {
  it('normalizes motion and audio each to its own max (0..1), ignoring object', () => {
    const out = toBands([b(0, 2, 99, 1), b(10, 4, 0, 4), b(20, 0, 0, 2)])
    expect(out).toEqual<ActivityBand[]>([
      { bucketStart: 0, motion: 0.5, audio: 0.25 },
      { bucketStart: 10, motion: 1, audio: 1 },
      { bucketStart: 20, motion: 0, audio: 0.5 },
    ])
  })

  it('returns [] for no buckets', () => {
    expect(toBands([])).toEqual([])
  })

  it('maps an all-zero kind to all zeros (no divide-by-zero)', () => {
    expect(toBands([b(0, 0, 5, 3), b(10, 0, 5, 3)])).toEqual<ActivityBand[]>([
      { bucketStart: 0, motion: 0, audio: 1 },
      { bucketStart: 10, motion: 0, audio: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- density-bands`
Expected: FAIL — cannot find module `../density-bands.js`.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/timeline/density-bands.ts`:

```typescript
/** One bucket from `pipeline-analytics.getEventDensity`. */
export interface DensityBucket {
  readonly bucketStart: number
  readonly motion: number
  readonly object: number
  readonly audio: number
}

/** A timeline heatmap bucket: motion/audio intensities normalized to 0..1.
 *  `object` is intentionally dropped (bands-only scope; no event markers). */
export interface ActivityBand {
  readonly bucketStart: number
  readonly motion: number
  readonly audio: number
}

/** Map density buckets to normalized motion/audio bands. Each kind is scaled to
 *  its OWN max across the window so each band uses its full dynamic range; an
 *  all-zero kind maps to all zeros (no divide-by-zero). */
export function toBands(buckets: readonly DensityBucket[]): ActivityBand[] {
  if (buckets.length === 0) return []
  const maxMotion = Math.max(...buckets.map((x) => x.motion))
  const maxAudio = Math.max(...buckets.map((x) => x.audio))
  const norm = (v: number, max: number): number => (max > 0 ? v / max : 0)
  return buckets.map((x) => ({
    bucketStart: x.bucketStart,
    motion: norm(x.motion, maxMotion),
    audio: norm(x.audio, maxAudio),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- density-bands`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/timeline/density-bands.ts srcV2/timeline/__tests__/density-bands.spec.ts
git commit -m "feat(srcV2): density→activity-band mapping (motion/audio normalized)"
```

---

### Task 3: Full suite + type-check gate

- [ ] **Step 1: Run the full srcV2 suite**

Run: `npm run test:v2`
Expected: all green (the 20 connection-foundation tests + 11 new timeline tests = 31).

- [ ] **Step 2: Type-check**

Run: `npm run ts-check`
Expected: no NEW errors in any `srcV2/` path (pre-existing legacy `src/` and `@camstack/sdk` source errors are acceptable).

---

## Phase C2 outline (GATED on iOS spike — author full TDD after GO)

- **TimelineModel** — given `recording.getAvailability` ranges + the LOW media playlist, build a
  segment index `[{ epochStart, epochEnd, uri }]` with a per-segment `epoch↔mediaTime` offset.
- **SegmentSource** — resolve the LOW variant from the master playlist; fetch via the existing
  `fetchWithFailover` (LAN→relay, token-in-path); LRU + prefetch N±1 around the playhead.
- **DecodeBackend interface** — `frameAt(epochMs): Promise<Frame>`; implementations: iOS
  `AVAssetImageGenerator`, Android `MediaMetadataRetriever`, web mp4box+WebCodecs. **Exact shape
  fixed by the spike's chosen native API.**
- **ScrubQueue** — latest-wins coalescing on a display-link/rAF; flush superseded decodes; two-tier
  (coarse keyframe during drag → exact decode-forward on settle).
- **Renderer** — paint Frame to an RN Image/Skia surface (canvas on web); live = WebRTC `<video>`.
- Edge cases per spec §4: gap snap (uses Phase C1 `nearestCoveredEdge`), live-edge not-finalized
  clamp, endpoint/token failover, memory bounds.

## Phase C3 outline (GATED on srcV2 ThemeProvider)

- **ThemeProvider** (`useColorScheme` → dark/light `ColorTokens`); resolves the tracked
  `BAND`/`ConnectionBanner` light-mode follow-up.
- **Camera·timeline screen** — port the current structure (verified against the live mobile view:
  video top, vertical-scroll scrubber with fixed amber cursor ~70%, activity strip + recording band,
  `↑ ORA`/go-live, day picker, quality, floating zoom/filter/record controls, tab bar). Restyle to
  camstack tokens. Wire live (WebRTC), VOD (`react-native-video` on the master HLS), scrub
  (ScrubEngine), bands (Phase C1 `toBands` + `mergeRanges`).

---

## Self-Review

**Spec coverage (Phase C1):**
- §5.1 recorded coverage (`getAvailability` ranges) → Task 1 (`mergeRanges`/`isCovered`/`nearestCoveredEdge`). ✓
- §5.1 motion/audio bands (`getEventDensity`, motion+audio only, object dropped) → Task 2 (`toBands`). ✓
- §4 gap snapping primitive used by ScrubEngine → Task 1 `nearestCoveredEdge` (consumed in C2). ✓
- Spike-gated scrub internals + UI → Phases C2/C3 (correctly deferred per spec §6 gate). ✓

**Placeholder scan:** Phase C1 tasks show full code + commands + expected output. C2/C3 are explicitly
outlines pending their gates — not placeholders within an executable task. ✓

**Type consistency:** `TimeRange` (Task 1) and `DensityBucket`/`ActivityBand` (Task 2) are
self-contained; `DensityBucket` matches the server `getEventDensity` element
`{ bucketStart, motion, object, audio }`; `TimeRange` matches `RecordingRange` minus `profile`. ✓
