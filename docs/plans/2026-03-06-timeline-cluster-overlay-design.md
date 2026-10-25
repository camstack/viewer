# Timeline Cluster Overlay Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

Currently, `ClusterListItem` rows in the TheaterTimeline FlashList have variable height (58–96px depending on event count). This causes non-uniform spacing between time ticks, making scrolling feel unpredictable. Detection clusters "stretch" the tick they belong to.

## Goal

- All time ticks (hour marks, spacers) must have equal, fixed height → equidistant scrolling
- Detection cluster cards appear as **floating overlays** centered on their tick row
- Cluster cards scale with proximity to the NVR playback cursor (`nvrPlaybackTimeMs`):
  - Default (far from cursor): 75% size
  - Near cursor: 100% size, smooth spring animation
- No two cluster cards overlap visually

---

## Architecture

### Approach: Cluster rows height=1, card in absolute position

`ClusterListItem` entries remain in the FlashList but with `height = 1` (not 0, to avoid FlashList virtualization edge cases). The `NeonClusterCard` is rendered with `position: 'absolute'` and `overflow: 'visible'`, centered vertically on the 1px row.

The FlashList list structure becomes:

```
[NOW        32px]
[spacer     14px]  08:00  activity bars
[cluster     1px] ← 07:52  [card floating, centered on this row]
[gap        64px]           ← mandatory min gap
[spacer     14px]  07:50  activity bars
[hour       20px]  07:30
[cluster     1px] ← 07:28  [card floating, centered on this row]
[gap        64px]           ← mandatory min gap
[spacer     14px]  07:25
```

---

## Key Design Decisions

### 1. Card height scales with `bucketMs`

`bucketMs` (the zoom-level cluster window size) already guarantees clusters are temporally separated by at least `bucketMs`. The visual card size scales accordingly:

```
cardHeight = clamp(bucketMs / 10_000 + 28, 40, 72)  [px]

bucketMs = 30s  → 40px
bucketMs = 1min → 40px (clamped)
bucketMs = 3min → 46px
bucketMs = 5min → 58px
bucketMs = 10min → 72px (clamped)
```

`cardHeight` is computed once from `zoom.bucketMs` in `TheaterTimeline` and passed down.

### 2. Mandatory minimum gap between cluster rows

In `TimelineContractLayout.ts`, the gap item between two consecutive clusters is sized:

```
GAP_HEIGHT = max(cardHeight + 8, gapScaledByDuration)
```

This ensures the **visual distance between any two cluster rows ≥ `cardHeight`**, so cards never overlap. The `+8` is a safety margin. Even for consecutive buckets (0ms gap in time), a mandatory spacer of `cardHeight + 8` is inserted.

### 3. Proximity-based scale animation

`nvrPlaybackTimeMs` is stored in a ref (`nvrPlaybackTimeMsRef`) updated in `handleBackendTimeUpdate` without causing `renderItem` to invalidate. However, `nvrPlaybackTimeMs` is also passed as a prop to `renderItem` (added to the `useCallback` dependency) to trigger re-renders when the cursor moves.

Since FlashList only renders ~10–15 visible items at a time, 1 re-render per second is acceptable.

**Scale formula:**
```
MAX_PROXIMITY_MS = 10 * 60_000  (10 minutes)
distance = Math.abs(item.timeMs - nvrPlaybackTimeMs)
proximity = Math.max(0, 1 - distance / MAX_PROXIMITY_MS)
targetScale = 0.75 + proximity * 0.25   // [0.75 .. 1.0]
```

**Animation:** Each cluster card has a `useRef(new Animated.Value(0.75))`. A `useEffect` on `nvrPlaybackTimeMs` calls `Animated.spring(scaleAnim, { toValue: targetScale, ... })`.

**Z-index:** Set proportionally to scale so the card closest to the cursor appears on top.

### 4. Card content in compact state

A new variant `"timeline-overlay"` is added to `NeonClusterCard`:
- Thumbnail of the representative event (fills card, `contentFit: "cover"`)
- Detection class icons overlaid (bottom-left strip)
- No text labels (too small)
- Neon-colored border
- Rounded corners

`cardHeight` (derived from `bucketMs`) is the card's full height at scale=1.0. At scale=0.75 it renders at `cardHeight * 0.75`.

---

## Files to Modify

| File | Change |
|------|--------|
| `TimelineContractLayout.ts` | `ClusterListItem.height = 1`; `GAP_MIN_HEIGHT = cardHeight + 8`; accept `cardHeight` param |
| `TheaterTimeline.tsx` | Compute `cardHeight` from `zoom.bucketMs`; pass to layout + `renderItem`; add `nvrPlaybackTimeMs` to `renderItem` deps |
| `TimelineListRow.tsx` | Render cluster as absolute overlay; accept `cardHeight` + `nvrPlaybackTimeMs` props |
| `NeonClusterCard.tsx` | Add `"timeline-overlay"` variant; `Animated.Value` scale; accept `cardHeight` + `nvrPlaybackTimeMs` |
| `useInfiniteTimelineData.ts` | Pass `cardHeight` to layout function |

---

## Non-Goals

- Rewriting the proportional (timeline) layout mode
- Changing the API or `bucketMs` selection logic
- Overlap resolution between cards (guaranteed by `bucketMs` + min gap)
- Tap target management (standard React Native `pointerEvents` behavior is sufficient)
