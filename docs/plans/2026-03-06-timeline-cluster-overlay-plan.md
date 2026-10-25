# Timeline Cluster Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render detection cluster cards as absolute-positioned overlays on 1px-height list rows, keeping all time ticks equidistant, with card size and gap spacing controlled by `overlayCardHeight` (derived from `bucketMs`), and smooth proximity-based scale animation driven by `nvrPlaybackTimeMs`.

**Architecture:** `ClusterListItem.height` is set to `1` in contract mode. The card is rendered with `position: 'absolute'` centered on the 1px row in `TimelineListRow`. Each gap between clusters is forced to be at least `overlayCardHeight + 8` px. A new `"timeline-overlay"` variant in `NeonClusterCard` uses `Animated.spring` to scale the card based on temporal distance from the NVR cursor.

**Tech Stack:** React Native Animated API, FlashList, expo-image, Ionicons

---

## Task 1: Add `overlayCardHeight` to `TimelineContractLayout` and fix contract mode heights

**Design doc:** `docs/plans/2026-03-06-timeline-cluster-overlay-design.md`

**Files:**
- Modify: `src/components/TheaterTimeline/TimelineContractLayout.ts:510-522` (SequentialLayoutOptions interface)
- Modify: `src/components/TheaterTimeline/TimelineContractLayout.ts:756-801` (contract mode loop)

**Step 1: Add `overlayCardHeight` to `SequentialLayoutOptions`**

In `TimelineContractLayout.ts`, find the `SequentialLayoutOptions` interface (line 510) and add the new field:

```typescript
export interface SequentialLayoutOptions {
  clusters: TimelineClusterFromServer[];
  rangeEndMs: number;
  spanMs: number;
  dayStr: string;
  clusterHeight: number;
  /** Height of the overlay card (px). In contract/overlay mode, cluster rows are
   *  1px and cards are absolutely positioned. Gaps between clusters are forced to
   *  be at least overlayCardHeight + 8 to guarantee no visual overlap. */
  overlayCardHeight?: number;
  mode: "timeline" | "contract";
  motionSegments: { start: number; end: number }[];
  recordings: { start: number; end: number }[];
  audioLevelSegments: { start: number; end: number; level: number }[];
  /** Tick interval in ms — derived from zoom bucketMs. Defaults to 15 min. */
  tickIntervalMs?: number;
}
```

**Step 2: Modify the contract mode cluster rendering (lines 752–801)**

Find the contract mode block (`} else {` at line 752). Replace the cluster push and gap logic:

```typescript
  } else {
    // ─── Contract mode ──────────────────────────────────────────
    // Clusters are already sorted newest-first. Insert gap items between them.

    // In overlay mode, cluster rows are 1px; gaps must be tall enough that
    // adjacent card overlays don't visually touch.
    const isOverlay = overlayCardHeight != null && overlayCardHeight > 0;
    const contractItemHeight = isOverlay ? 1 : clusterHeight;
    const minGapHeight = isOverlay ? overlayCardHeight! + 8 : GAP_MIN_HEIGHT;

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const primaryClass = c.classes[0] ?? "motion";
      const hasVideoclip = c.events.some(
        (e) => "videoUrl" in e && !!e.videoUrl,
      );
      const clusterDuration = c.endMs - c.startMs;
      const realTimeMs = c.representative.timestamp ?? c.startMs;

      items.push({
        type: "cluster",
        id: `cluster_${dayStr}_${c.startMs}_${i}`,
        height: contractItemHeight,
        dayStr,
        timeMs: realTimeMs,
        cluster: c,
        primaryClass,
        hasVideoclip,
        hasMotion: hasOverlap(c.startMs, clusterDuration, motionSegments),
        hasRecording: hasOverlap(c.startMs, clusterDuration, recordings),
        audioLevel: peakAudioLevel(c.startMs, clusterDuration, audioLevelSegments),
      } satisfies ClusterListItem);

      // Gap to the next cluster — always insert in overlay mode (guarantees
      // visual separation); in classic mode only insert if gap > 60s.
      if (i < clusters.length - 1) {
        const nextCluster = clusters[i + 1];
        const gapMs = c.startMs - nextCluster.endMs;
        const shouldInsertGap = isOverlay || gapMs > 60_000;
        if (shouldInsertGap) {
          const scaledGapHeight =
            gapMs > 0 && gapMs < SHORT_GAP_THRESHOLD
              ? GAP_MIN_HEIGHT +
                (gapMs / SHORT_GAP_THRESHOLD) * (GAP_MAX_HEIGHT - GAP_MIN_HEIGHT)
              : GAP_MAX_HEIGHT;
          const gapHeight = Math.max(minGapHeight, Math.round(scaledGapHeight));

          items.push({
            type: "gap",
            id: `gap_${dayStr}_${i}`,
            height: gapHeight,
            dayStr,
            timeMs: nextCluster.endMs,
            durationMs: Math.max(0, gapMs),
          } satisfies GapListItem);
        }
      }
    }
  }
```

**Step 3: Verify TypeScript**

```bash
cd /Users/alice/Documents/Git/camstack && npm run ts-check 2>&1 | head -40
```

Expected: no new errors (overlayCardHeight is optional so existing callers are unaffected).

**Step 4: Commit**

```bash
git add src/components/TheaterTimeline/TimelineContractLayout.ts
git commit -m "feat(timeline): add overlayCardHeight to contract layout for cluster overlay mode"
```

---

## Task 2: Thread `overlayCardHeight` through `useInfiniteTimelineData`

**Files:**
- Modify: `src/components/TheaterTimeline/useInfiniteTimelineData.ts:56-63` (hook options interface)
- Modify: `src/components/TheaterTimeline/useInfiniteTimelineData.ts:119` (destructuring + pass-through)
- Modify: `src/components/TheaterTimeline/useInfiniteTimelineData.ts:370-381` (computeSequentialLayout call)

**Step 1: Add `overlayCardHeight` to `UseInfiniteTimelineDataOptions`**

Find the interface (around line 56):

```typescript
export interface UseInfiniteTimelineDataOptions {
  adapter: ICameraSource | null | undefined;
  enabledClasses?: string[];
  bucketMs: number;
  mode: "timeline" | "contract";
  cardStyle: "compact" | CardStyle;
  /** Overlay card height (px), derived from bucketMs. When provided,
   *  contract mode sets cluster row height to 1 and enforces minimum gaps. */
  overlayCardHeight?: number;
}
```

**Step 2: Destructure in the hook body (line 119)**

```typescript
const { adapter, enabledClasses, bucketMs, mode, cardStyle, overlayCardHeight } = options;
```

**Step 3: Pass to `computeSequentialLayout` (line 370)**

```typescript
const dayItems = computeSequentialLayout({
  clusters: dayClusters,
  rangeEndMs,
  spanMs,
  dayStr: day,
  clusterHeight,
  overlayCardHeight,   // ← add this line
  mode,
  motionSegments: dayMotion,
  recordings: dayRecordings,
  audioLevelSegments: dayAudio,
  tickIntervalMs: bucketMs,
});
```

**Step 4: Verify TypeScript**

```bash
npm run ts-check 2>&1 | head -40
```

**Step 5: Commit**

```bash
git add src/components/TheaterTimeline/useInfiniteTimelineData.ts
git commit -m "feat(timeline): thread overlayCardHeight through useInfiniteTimelineData hook"
```

---

## Task 3: Compute `overlayCardHeight` in `TheaterTimeline` and pass to hook + `renderItem`

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx` (multiple locations)

**Step 1: Compute `overlayCardHeight` from `zoom.bucketMs` (add after line 451)**

After:
```typescript
const zoom = ZOOM_LEVELS[zoomLevel] ?? ZOOM_LEVELS[1];
```
Add:
```typescript
/** Card height for the cluster overlay variant, scaled by zoom granularity.
 *  Larger buckets → more temporal space → taller card. Range: 40–72px. */
const overlayCardHeight = Math.max(40, Math.min(72, Math.round(zoom.bucketMs / 10_000 + 28)));
```

**Step 2: Pass `overlayCardHeight` to `useInfiniteTimelineData` (around line 713)**

Find the `useInfiniteTimelineData` call and add the new prop:
```typescript
const {
  items: flatItems,
  // ...
} = useInfiniteTimelineData({
  adapter: currentAdapter,
  enabledClasses: classFilter,
  bucketMs: zoom.bucketMs,
  mode: timelineMode,
  cardStyle: effectiveCardStyle,
  overlayCardHeight,   // ← add this line
});
```

**Step 3: Add `nvrPlaybackTimeMs` and `overlayCardHeight` to `renderItem`**

Find the `renderItem` useCallback (line 1175) and update it:

```typescript
const renderItem = useCallback(
  ({ item }: { item: TimelineListItem }) => (
    <TimelineListRow
      item={item}
      cardStyle={effectiveCardStyle}
      carouselClusterIds={carouselClusterIds}
      hideThumbnails={hideThumbnails}
      eventsAppAuth={eventsAppAuth}
      selectedClusterId={previewClusterId}
      playingClusterId={playingClusterId}
      nvrPlaybackTimeMs={nvrPlaybackTimeMs}
      overlayCardHeight={overlayCardHeight}
      onClusterPress={handleClusterPress}
      onClusterDetailPress={
        showCarouselSwap ? handleClusterDetailPress : undefined
      }
    />
  ),
  [
    effectiveCardStyle,
    carouselClusterIds,
    hideThumbnails,
    eventsAppAuth,
    previewClusterId,
    playingClusterId,
    nvrPlaybackTimeMs,       // ← add
    overlayCardHeight,       // ← add
    handleClusterPress,
    handleClusterDetailPress,
    showCarouselSwap,
  ],
);
```

**Step 4: Verify TypeScript (will fail until Tasks 4+5 add the props)**

```bash
npm run ts-check 2>&1 | grep "TimelineListRow" | head -10
```

Expected: type errors on `nvrPlaybackTimeMs` and `overlayCardHeight` props — these will be fixed in Tasks 4 and 5.

**Step 5: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx
git commit -m "feat(timeline): compute overlayCardHeight from zoom.bucketMs, pass nvrPlaybackTimeMs to renderItem"
```

---

## Task 4: Add `"timeline-overlay"` variant to `NeonClusterCard`

**Files:**
- Modify: `src/components/TheaterTimeline/NeonClusterCard.tsx`

**Step 1: Add new props to `NeonClusterCardProps` (line 98)**

```typescript
interface NeonClusterCardProps {
  cluster: TimelineClusterFromServer;
  height: number;
  primaryClass: string;
  hasVideoclip: boolean;
  isSelected?: boolean;
  variant: "compact" | CardStyle | "timeline-overlay";
  showCameraName?: boolean;
  eventsAppAuth?: EventsAppAuth | null;
  hideThumbnails?: boolean;
  onPress?: () => void;
  onDetailPress?: () => void;
  /** NVR playback cursor time (epoch ms) — drives proximity scale animation */
  nvrPlaybackTimeMs?: number | null;
  /** This item's timestamp (epoch ms) — used for proximity calculation */
  itemTimeMs?: number;
}
```

**Step 2: Add import for `Animated` and `useEffect`/`useRef`**

At the top of the file, the existing import is:
```typescript
import React, { memo, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ...
} from "react-native";
```

Change to:
```typescript
import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Animated,
  ...
} from "react-native";
```

**Step 3: Create the `OverlayCard` component**

Add this component before the main `NeonClusterCard` export (find a good location near the other variant components, e.g. after `CompactCard`):

```typescript
// ─── Timeline-overlay variant ──────────────────────────────────────

const MAX_PROXIMITY_MS = 10 * 60_000; // 10 minutes

const OverlayCard = memo(function OverlayCard({
  cluster,
  height,
  primaryClass,
  isSelected,
  eventsAppAuth,
  hideThumbnails,
  onPress,
  nvrPlaybackTimeMs,
  itemTimeMs,
}: Omit<NeonClusterCardProps, "variant" | "hasVideoclip" | "showCameraName" | "onDetailPress">) {
  const neonColor = getNeonColor(primaryClass);
  const representative = cluster.representative;
  const rawUrl = getCroppedImageUrl(representative);

  // Proximity-based scale animation
  const scaleAnim = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    if (nvrPlaybackTimeMs == null || itemTimeMs == null) {
      Animated.spring(scaleAnim, {
        toValue: 0.75,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
      return;
    }
    const distance = Math.abs(itemTimeMs - nvrPlaybackTimeMs);
    const proximity = Math.max(0, 1 - distance / MAX_PROXIMITY_MS);
    const targetScale = 0.75 + proximity * 0.25;
    Animated.spring(scaleAnim, {
      toValue: targetScale,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [nvrPlaybackTimeMs, itemTimeMs, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.overlayCard,
        {
          height,
          borderColor: isSelected ? neonColor : neonColor + "60",
          borderWidth: isSelected ? 2 : 1,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <Pressable onPress={onPress} style={styles.overlayPressable}>
        {/* Full-frame thumbnail */}
        <ResolvedEventImage
          rawUrl={rawUrl}
          auth={eventsAppAuth}
          primaryClass={primaryClass}
          neonColor={neonColor}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          iconSize={18}
          hideThumbnails={hideThumbnails}
        />

        {/* Class icons strip (bottom-left) */}
        <View style={styles.overlayIconRow}>
          {cluster.classes.slice(0, 3).map((cls, i) => (
            <View
              key={`${cls}_${i}`}
              style={[styles.overlayIconBubble, { backgroundColor: getNeonColor(cls) + "50" }]}
            >
              <Ionicons
                name={getIconName(cls) as never}
                size={9}
                color={getNeonColor(cls)}
              />
            </View>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
});
```

**Step 4: Add overlay styles to the `StyleSheet.create` at the bottom of the file**

Find the `styles` StyleSheet object and add:

```typescript
  // ── Timeline overlay card ──
  overlayCard: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#111",
  },
  overlayPressable: {
    flex: 1,
  },
  overlayIconRow: {
    position: "absolute",
    bottom: 3,
    left: 3,
    flexDirection: "row",
    gap: 2,
  },
  overlayIconBubble: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
```

**Step 5: Wire `OverlayCard` into the main `NeonClusterCard` component**

Find the main `NeonClusterCard` export component and add the overlay branch. The component currently has a switch/if-else on `variant`. Add before the final return or at the top of the function:

```typescript
export const NeonClusterCard = memo(function NeonClusterCard(
  props: NeonClusterCardProps,
) {
  const { variant, nvrPlaybackTimeMs, itemTimeMs } = props;

  if (variant === "timeline-overlay") {
    return (
      <OverlayCard
        {...props}
        nvrPlaybackTimeMs={nvrPlaybackTimeMs}
        itemTimeMs={itemTimeMs}
      />
    );
  }

  // ... existing variant branches unchanged ...
```

**Step 6: Verify TypeScript**

```bash
npm run ts-check 2>&1 | grep "NeonClusterCard" | head -10
```

Expected: no errors in NeonClusterCard itself.

**Step 7: Commit**

```bash
git add src/components/TheaterTimeline/NeonClusterCard.tsx
git commit -m "feat(timeline): add timeline-overlay variant to NeonClusterCard with proximity scale animation"
```

---

## Task 5: Update `TimelineListRow` to render cluster overlays

**Files:**
- Modify: `src/components/TheaterTimeline/TimelineListRow.tsx`

**Step 1: Add new props to `TimelineListRowProps`**

```typescript
interface TimelineListRowProps {
  item: TimelineListItem;
  cardStyle: "compact" | CardStyle;
  carouselClusterIds?: Set<string>;
  hideThumbnails: boolean;
  eventsAppAuth?: EventsAppAuth | null;
  selectedClusterId: string | null;
  playingClusterId?: string | null;
  /** NVR playback cursor time — drives cluster card proximity scale */
  nvrPlaybackTimeMs?: number | null;
  /** Card height for overlay mode (px), derived from zoom.bucketMs */
  overlayCardHeight?: number;
  onClusterPress: (id: string) => void;
  onClusterDetailPress?: (id: string) => void;
}
```

**Step 2: Destructure new props in the component**

```typescript
export const TimelineListRow = memo(function TimelineListRow({
  item,
  cardStyle,
  carouselClusterIds,
  hideThumbnails,
  eventsAppAuth,
  selectedClusterId,
  playingClusterId,
  nvrPlaybackTimeMs,
  overlayCardHeight,
  onClusterPress,
  onClusterDetailPress,
}: TimelineListRowProps) {
```

**Step 3: Add a fast-path overlay rendering for cluster items**

Add this block at the very TOP of the component body, before the existing `const isPlaying = ...` line:

```typescript
  // ── Cluster overlay fast-path ────────────────────────────────────
  // When overlayCardHeight is provided and item is a cluster, render the
  // card as an absolute overlay on a 1px-height row (height matches item.height = 1).
  if (item.type === "cluster" && overlayCardHeight != null) {
    // Compute z-index from proximity: cluster closest to cursor appears on top
    const distance =
      nvrPlaybackTimeMs != null
        ? Math.abs(item.timeMs - nvrPlaybackTimeMs)
        : Infinity;
    const proximity = Math.max(0, 1 - distance / (10 * 60_000));
    const zIndex = Math.round(1 + proximity * 10);

    return (
      <View style={{ height: 1, overflow: "visible", zIndex }}>
        <View
          style={{
            position: "absolute",
            // Center card vertically on the 1px row
            top: -(overlayCardHeight / 2 - 0.5),
            // Align with content column: after tick (52px) + separator (1px)
            left: 53,
            // Leave room for activity column (28px)
            right: 28,
            height: overlayCardHeight,
          }}
        >
          <NeonClusterCard
            cluster={item.cluster}
            height={overlayCardHeight}
            primaryClass={item.primaryClass}
            hasVideoclip={item.hasVideoclip}
            isSelected={selectedClusterId === item.id}
            variant="timeline-overlay"
            eventsAppAuth={eventsAppAuth}
            hideThumbnails={hideThumbnails}
            nvrPlaybackTimeMs={nvrPlaybackTimeMs}
            itemTimeMs={item.timeMs}
            onPress={() => onClusterPress(item.id)}
            onDetailPress={
              onClusterDetailPress
                ? () => onClusterDetailPress(item.id)
                : undefined
            }
          />
        </View>
      </View>
    );
  }
```

**Step 4: Verify TypeScript**

```bash
npm run ts-check 2>&1 | head -40
```

Expected: clean (all new props are now defined).

**Step 5: Commit**

```bash
git add src/components/TheaterTimeline/TimelineListRow.tsx
git commit -m "feat(timeline): render cluster rows as absolute overlays when overlayCardHeight is set"
```

---

## Task 6: Smoke test and verify

**Step 1: Start the web dev server**

```bash
npm run web
```

**Step 2: Open the TheaterTimeline in the browser and verify:**

- [ ] All time ticks (spacers, hour marks) have equal visual spacing
- [ ] Detection cluster cards appear floating, centered on their tick row
- [ ] Cards at 0-5min from playback cursor are visibly larger than cards far from cursor
- [ ] No two cluster cards visually overlap
- [ ] Tapping a cluster card still triggers seek/play (press handler fires)
- [ ] Zooming in/out (FAB controls) changes card size (smaller at high zoom, larger at low zoom)
- [ ] Live mode (NOW indicator visible) shows no cluster overlays blocking the now row

**Step 3: If issues found**

Check the console for TypeScript or runtime errors. Most likely issues:
- `overflow: "visible"` not working on Android web → wrap in a native `View` with `collapsable={false}`
- `zIndex` not rendering correctly → ensure parent FlashList cell allows z-ordering (try wrapping with `elevation` on Android)

**Step 4: Final commit if all looks good**

```bash
git add -p   # review any uncommitted changes
git commit -m "fix(timeline): adjust overlay positioning and z-index after smoke test"
```
