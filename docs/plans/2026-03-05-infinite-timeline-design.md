# Infinite Timeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor TheaterTimeline from day-by-day navigation to a FlashList-based infinite vertical scroll that loads days on demand and keeps the date selector synced with scroll position.

**Architecture:** Replace ScrollView + absolute positioning with `@shopify/flash-list`. A new `computeSequentialLayout()` produces flat `TimelineListItem[]` arrays per day. A new `useInfiniteTimelineData` hook manages progressive day loading via `onEndReached`. Each FlashList row renders a 3-column layout (tick | content | activity).

**Tech Stack:** @shopify/flash-list (already installed), React Native, TypeScript, Zustand, TanStack React Query

**Verification:** No unit test framework exists. Verify each task with `npm run ts-check` for type safety and visual testing via `npm run start:dev`.

---

### Task 1: Define TimelineListItem Types

**Files:**
- Modify: `src/components/prototypes/types.ts` (append after line 276)

**Step 1: Add the TimelineListItem union type**

Add at the end of `src/components/prototypes/types.ts`:

```typescript
// ─── FlashList timeline item types (infinite scroll) ─────────────

export interface TimelineListItemBase {
  id: string;
  height: number;
  /** Day this item belongs to (YYYY-MM-DD) */
  dayStr: string;
  /** Epoch ms for time-based lookups */
  timeMs: number;
}

export interface NowListItem extends TimelineListItemBase {
  type: "now";
}

export interface DaySeparatorListItem extends TimelineListItemBase {
  type: "daySeparator";
  /** Human-readable label, e.g. "Mar 4, 2026" */
  label: string;
}

export interface HourListItem extends TimelineListItemBase {
  type: "hour";
  /** e.g. "14:00" */
  label: string;
  isFullHour: boolean;
}

export interface ClusterListItem extends TimelineListItemBase {
  type: "cluster";
  cluster: import("@/lib/eventsAppApi").TimelineClusterFromServer;
  primaryClass: string;
  hasVideoclip: boolean;
  hasMotion: boolean;
  hasRecording: boolean;
}

export interface GapListItem extends TimelineListItemBase {
  type: "gap";
  durationMs: number;
}

export interface SpacerListItem extends TimelineListItemBase {
  type: "spacer";
  hasMotion: boolean;
  hasRecording: boolean;
}

export type TimelineListItem =
  | NowListItem
  | DaySeparatorListItem
  | HourListItem
  | ClusterListItem
  | GapListItem
  | SpacerListItem;
```

**Step 2: Verify types compile**

Run: `npm run ts-check`
Expected: PASS (no new errors)

**Step 3: Commit**

```bash
git add src/components/prototypes/types.ts
git commit -m "feat(timeline): add TimelineListItem types for FlashList infinite scroll"
```

---

### Task 2: Create `computeSequentialLayout()`

**Files:**
- Modify: `src/components/prototypes/TimelineContractLayout.ts` (add new function after line 499)

**Step 1: Add the sequential layout function**

Add at the end of `src/components/prototypes/TimelineContractLayout.ts`:

```typescript
// ─── Sequential layout for FlashList ─────────────────────────────

import type {
  TimelineListItem,
  ClusterListItem,
  GapListItem,
  HourListItem,
  SpacerListItem,
} from "./types";

/** Height constants for sequential layout */
const SEQ_NOW_HEIGHT = 32;
const SEQ_DAY_SEPARATOR_HEIGHT = 40;
const SEQ_HOUR_HEIGHT_FULL = 20;
const SEQ_HOUR_HEIGHT_SUB = 14;
const SEQ_GAP_MIN_HEIGHT = 20;
const SEQ_GAP_MAX_HEIGHT = 32;
const SEQ_GAP_SHORT_THRESHOLD = 30 * 60_000;

export interface SequentialLayoutOptions {
  clusters: TimelineClusterFromServer[];
  rangeEndMs: number;
  spanMs: number;
  dayStr: string;
  clusterHeight: number;
  mode: "timeline" | "contract";
  motionSegments: { start: number; end: number }[];
  recordings: { start: number; end: number }[];
}

/**
 * Check if a time overlaps with any segment in a list.
 */
function hasOverlap(
  timeMs: number,
  durationMs: number,
  segments: { start: number; end: number }[],
): boolean {
  const end = timeMs + durationMs;
  return segments.some((s) => s.start < end && s.end > timeMs);
}

/**
 * Compute sequential layout items for one day.
 * Returns items in order (newest-first, top-to-bottom).
 * No Y positions — FlashList handles positioning via item heights.
 */
export function computeSequentialLayout(
  options: SequentialLayoutOptions,
): TimelineListItem[] {
  const {
    clusters,
    rangeEndMs,
    spanMs,
    dayStr,
    clusterHeight,
    mode,
    motionSegments,
    recordings,
  } = options;

  const items: TimelineListItem[] = [];
  const rangeStartMs = rangeEndMs - spanMs;

  if (clusters.length === 0) {
    // Just hour marks for an empty day
    const hourMarks = generateSequentialHourMarks(rangeEndMs, spanMs, dayStr);
    items.push(...hourMarks);
    return items;
  }

  if (mode === "timeline") {
    // Proportional mode: insert spacers between clusters
    // Also interleave hour marks at correct positions
    const allTimeItems: Array<{ timeMs: number; item: TimelineListItem }> = [];

    // Add clusters
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const primaryClass = cluster.classes[0] ?? "motion";
      const hasVideoclip = cluster.events.some(
        (e) => "videoUrl" in e && !!e.videoUrl,
      );
      allTimeItems.push({
        timeMs: cluster.startMs,
        item: {
          type: "cluster",
          id: `cluster_${dayStr}_${cluster.startMs}_${i}`,
          height: clusterHeight,
          dayStr,
          timeMs: cluster.startMs,
          cluster,
          primaryClass,
          hasVideoclip,
          hasMotion: hasOverlap(cluster.startMs, cluster.endMs - cluster.startMs, motionSegments),
          hasRecording: hasOverlap(cluster.startMs, cluster.endMs - cluster.startMs, recordings),
        } satisfies ClusterListItem,
      });
    }

    // Add hour marks
    const hourMarks = generateSequentialHourMarks(rangeEndMs, spanMs, dayStr);
    for (const hm of hourMarks) {
      allTimeItems.push({ timeMs: hm.timeMs, item: hm });
    }

    // Sort newest-first (descending by time)
    allTimeItems.sort((a, b) => b.timeMs - a.timeMs);

    // Insert spacers between consecutive items
    const pxPerMs = (clusterHeight * 10) / spanMs; // scale factor
    const minSpacerHeight = 4;

    for (let i = 0; i < allTimeItems.length; i++) {
      items.push(allTimeItems[i].item);

      if (i < allTimeItems.length - 1) {
        const currentTimeMs = allTimeItems[i].timeMs;
        const nextTimeMs = allTimeItems[i + 1].timeMs;
        const gapMs = currentTimeMs - nextTimeMs;

        if (gapMs > 60_000) {
          const spacerHeight = Math.max(minSpacerHeight, Math.round(gapMs * pxPerMs));
          const spacerTimeMs = nextTimeMs + gapMs / 2;
          items.push({
            type: "spacer",
            id: `spacer_${dayStr}_${i}`,
            height: Math.min(spacerHeight, 200), // cap spacer height
            dayStr,
            timeMs: spacerTimeMs,
            hasMotion: hasOverlap(nextTimeMs, gapMs, motionSegments),
            hasRecording: hasOverlap(nextTimeMs, gapMs, recordings),
          } satisfies SpacerListItem);
        }
      }
    }
  } else {
    // Contract mode: compressed gaps between clusters
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const primaryClass = cluster.classes[0] ?? "motion";
      const hasVideoclip = cluster.events.some(
        (e) => "videoUrl" in e && !!e.videoUrl,
      );

      items.push({
        type: "cluster",
        id: `cluster_${dayStr}_${cluster.startMs}_${i}`,
        height: computeClusterItemHeight(cluster),
        dayStr,
        timeMs: cluster.startMs,
        cluster,
        primaryClass,
        hasVideoclip,
        hasMotion: hasOverlap(cluster.startMs, cluster.endMs - cluster.startMs, motionSegments),
        hasRecording: hasOverlap(cluster.startMs, cluster.endMs - cluster.startMs, recordings),
      } satisfies ClusterListItem);

      // Gap to next cluster
      if (i < clusters.length - 1) {
        const nextCluster = clusters[i + 1];
        const gapMs = cluster.startMs - nextCluster.endMs;
        if (gapMs > 60_000) {
          const gapHeight =
            gapMs < SEQ_GAP_SHORT_THRESHOLD
              ? SEQ_GAP_MIN_HEIGHT + (gapMs / SEQ_GAP_SHORT_THRESHOLD) * (SEQ_GAP_MAX_HEIGHT - SEQ_GAP_MIN_HEIGHT)
              : SEQ_GAP_MAX_HEIGHT;
          items.push({
            type: "gap",
            id: `gap_${dayStr}_${i}`,
            height: Math.round(gapHeight),
            dayStr,
            timeMs: cluster.startMs - gapMs / 2,
            durationMs: gapMs,
          } satisfies GapListItem);
        }
      }
    }
  }

  return items;
}

function computeClusterItemHeight(cluster: TimelineClusterFromServer): number {
  const extraEvents = Math.max(0, cluster.events.length - 1);
  return Math.min(72 + extraEvents * 12, 120);
}

function generateSequentialHourMarks(
  rangeEndMs: number,
  spanMs: number,
  dayStr: string,
): HourListItem[] {
  const marks: HourListItem[] = [];
  const rangeStartMs = rangeEndMs - spanMs;

  // Choose interval based on span
  const hours = spanMs / 3_600_000;
  let intervalMin = 60;
  if (hours <= 6) intervalMin = 15;
  else if (hours <= 12) intervalMin = 30;

  const intervalMs = intervalMin * 60_000;
  const startAligned = Math.ceil(rangeStartMs / intervalMs) * intervalMs;

  for (let timeMs = startAligned; timeMs < rangeEndMs; timeMs += intervalMs) {
    const d = new Date(timeMs);
    const isFullHour = d.getMinutes() === 0;
    const label = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    marks.push({
      type: "hour",
      id: `hour_${dayStr}_${timeMs}`,
      height: isFullHour ? SEQ_HOUR_HEIGHT_FULL : SEQ_HOUR_HEIGHT_SUB,
      dayStr,
      timeMs,
      label,
      isFullHour,
    });
  }

  return marks;
}
```

**Step 2: Add the import at the top of the file**

The file already imports `TimelineClusterFromServer`. Add the new types import alongside it. At the top of `TimelineContractLayout.ts` (after line 13), add:

```typescript
import type {
  TimelineListItem,
  ClusterListItem,
  GapListItem,
  HourListItem,
  SpacerListItem,
} from "./types";
```

**Step 3: Verify types compile**

Run: `npm run ts-check`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/prototypes/TimelineContractLayout.ts
git commit -m "feat(timeline): add computeSequentialLayout() for FlashList items"
```

---

### Task 3: Create `TimelineListRow` Component

**Files:**
- Create: `src/components/prototypes/TimelineListRow.tsx`

**Step 1: Create the component**

This component renders one row of the FlashList with the 3-column layout. It switches on item type.

```typescript
/**
 * Renders a single row in the infinite FlashList timeline.
 * 3-column layout: Tick (52px) | Separator (1px) | Content (flex) | Activity (28px)
 */

import React, { memo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { EventsAppAuth } from "@/lib/eventsAppApi";
import { NeonClusterCard } from "./NeonClusterCard";
import { getNeonColor } from "./useTheaterData";
import { formatGapDuration } from "./TimelineContractLayout";
import type {
  TimelineListItem,
  ClusterListItem,
  CardStyle,
} from "./types";

interface TimelineListRowProps {
  item: TimelineListItem;
  cardStyle: CardStyle;
  hideThumbnails: boolean;
  eventsAppAuth?: EventsAppAuth | null;
  selectedClusterId: string | null;
  onClusterPress: (id: string) => void;
}

export const TimelineListRow = memo(function TimelineListRow({
  item,
  cardStyle,
  hideThumbnails,
  eventsAppAuth,
  selectedClusterId,
  onClusterPress,
}: TimelineListRowProps) {
  return (
    <View style={[styles.row, { height: item.height }]}>
      {/* Tick column */}
      <View style={styles.tickColumn}>
        {renderTick(item)}
      </View>

      {/* Separator line */}
      <View style={styles.separator} />

      {/* Content column */}
      <View style={styles.contentColumn}>
        {renderContent(item, cardStyle, hideThumbnails, eventsAppAuth, selectedClusterId, onClusterPress)}
      </View>

      {/* Activity column */}
      <View style={styles.activityColumn}>
        {renderActivity(item)}
      </View>
    </View>
  );
});

// ─── Tick rendering ──────────────────────────────────────────────

function renderTick(item: TimelineListItem) {
  switch (item.type) {
    case "now":
      return (
        <View style={styles.tickCenter}>
          <View style={styles.nowDot} />
          <Text style={styles.nowLabel}>NOW</Text>
        </View>
      );
    case "hour":
      return (
        <View style={styles.tickCenter}>
          <Text style={item.isFullHour ? styles.hourLabel : styles.subHourLabel}>
            {item.label}
          </Text>
        </View>
      );
    case "daySeparator":
      return (
        <View style={styles.tickCenter}>
          <Ionicons name="calendar-outline" size={12} color="#666" />
        </View>
      );
    default:
      return null;
  }
}

// ─── Content rendering ──────────────────────────────────────────

function renderContent(
  item: TimelineListItem,
  cardStyle: CardStyle,
  hideThumbnails: boolean,
  eventsAppAuth: EventsAppAuth | null | undefined,
  selectedClusterId: string | null,
  onClusterPress: (id: string) => void,
) {
  switch (item.type) {
    case "now":
      return <View style={styles.nowLine} />;

    case "daySeparator":
      return (
        <View style={styles.daySeparator}>
          <View style={styles.daySepLine} />
          <Text style={styles.daySepLabel}>{item.label}</Text>
          <View style={styles.daySepLine} />
        </View>
      );

    case "hour":
      return (
        <View style={styles.hourLine}>
          <View style={item.isFullHour ? styles.hourLineBar : styles.subHourLineBar} />
        </View>
      );

    case "cluster":
      return (
        <View style={styles.clusterContainer}>
          <NeonClusterCard
            cluster={item.cluster}
            height={item.height}
            primaryClass={item.primaryClass}
            hasVideoclip={item.hasVideoclip}
            isSelected={selectedClusterId === item.id}
            variant={cardStyle}
            showCameraName={false}
            eventsAppAuth={eventsAppAuth}
            hideThumbnails={hideThumbnails}
            onPress={() => onClusterPress(item.id)}
          />
        </View>
      );

    case "gap":
      return (
        <View style={styles.gapContainer}>
          <View style={styles.gapLine} />
          <Text style={styles.gapText}>{formatGapDuration(item.durationMs)}</Text>
          <View style={styles.gapLine} />
        </View>
      );

    case "spacer":
      return null; // Empty space for proportional layout

    default:
      return null;
  }
}

// ─── Activity rendering ─────────────────────────────────────────

function renderActivity(item: TimelineListItem) {
  if (item.type !== "cluster" && item.type !== "spacer") return null;
  const { hasMotion, hasRecording } = item;
  if (!hasMotion && !hasRecording) return null;

  return (
    <View style={styles.activityFill}>
      {hasRecording && <View style={styles.actRecording} />}
      {hasMotion && <View style={styles.actMotion} />}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
  },
  tickColumn: {
    width: 52,
    justifyContent: "center",
    alignItems: "center",
  },
  separator: {
    width: 1,
    backgroundColor: "#1a1a1a",
  },
  contentColumn: {
    flex: 1,
    justifyContent: "center",
  },
  activityColumn: {
    width: 28,
    borderLeftWidth: 1,
    borderLeftColor: "#222",
  },

  // Tick styles
  tickCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
  },
  nowLabel: {
    color: "#FF3B30",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 1,
  },
  hourLabel: {
    color: "#ccc",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  subHourLabel: {
    color: "#888",
    fontSize: 10,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },

  // Content styles
  nowLine: {
    height: 1,
    backgroundColor: "#FF3B30",
    opacity: 0.4,
    marginVertical: 15,
  },
  daySeparator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
  },
  daySepLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#333",
  },
  daySepLabel: {
    color: "#888",
    fontSize: 11,
    fontWeight: "600",
  },
  hourLine: {
    justifyContent: "center",
  },
  hourLineBar: {
    height: 1,
    backgroundColor: "#444",
  },
  subHourLineBar: {
    height: 1,
    backgroundColor: "#282828",
  },
  clusterContainer: {
    paddingHorizontal: 4,
    paddingRight: 4,
  },
  gapContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 6,
  },
  gapLine: {
    flex: 1,
    height: 1,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: "#333",
  },
  gapText: {
    color: "#555",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },

  // Activity styles
  activityFill: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  actRecording: {
    position: "absolute",
    width: 10,
    right: 14,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,59,48,0.45)",
    borderRadius: 2,
  },
  actMotion: {
    position: "absolute",
    width: 8,
    right: 2,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,150,255,0.8)",
    borderRadius: 2,
  },
});
```

**Step 2: Verify types compile**

Run: `npm run ts-check`
Expected: FAIL — `hideThumbnails` prop doesn't exist on `NeonClusterCard` yet. This is expected; Task 4 will fix it.

**Step 3: Commit (WIP)**

```bash
git add src/components/prototypes/TimelineListRow.tsx
git commit -m "feat(timeline): add TimelineListRow component for FlashList rendering"
```

---

### Task 4: Add `hideThumbnails` Prop to NeonClusterCard

**Files:**
- Modify: `src/components/prototypes/NeonClusterCard.tsx:68-85` (props interface)

**Step 1: Add the prop to the interface**

In `NeonClusterCard.tsx`, add `hideThumbnails` to `NeonClusterCardProps` (after line 84):

```typescript
interface NeonClusterCardProps {
  cluster: TimelineClusterFromServer;
  height: number;
  primaryClass: string;
  hasVideoclip: boolean;
  isSelected?: boolean;
  variant: "compact" | CardStyle;
  showCameraName?: boolean;
  eventsAppAuth?: EventsAppAuth | null;
  /** Hide all thumbnails (icon-only mode for slow networks) */
  hideThumbnails?: boolean;
  onPress?: () => void;
}
```

**Step 2: Use the prop in the component**

Find the component function signature and destructure `hideThumbnails`. Then find all `<Image>` components rendering thumbnails and wrap them with a `!hideThumbnails &&` condition. The exact locations depend on the variants (hero, carousel, side). Look for `Image` usages with `source={{ uri: ... }}` and add the conditional.

The pattern to apply:
- Where there's an `Image` for a thumbnail, check `if (hideThumbnails)` show the fallback placeholder (icon) instead
- The existing fallback/placeholder views already exist for error states — reuse them

**Step 3: Verify types compile**

Run: `npm run ts-check`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/prototypes/NeonClusterCard.tsx
git commit -m "feat(timeline): add hideThumbnails prop to NeonClusterCard"
```

---

### Task 5: Create `useInfiniteTimelineData` Hook

**Files:**
- Create: `src/components/prototypes/useInfiniteTimelineData.ts`

**Step 1: Create the hook**

```typescript
/**
 * Hook for infinite timeline data loading.
 *
 * Manages progressive day loading: starts with today, loads older days
 * on demand via onEndReached. Produces a flat TimelineListItem[] array
 * for FlashList consumption.
 */

import { useMemo, useCallback, useState, useRef } from "react";
import type { ICameraSource } from "@/types/camera";
import { useClusteredDayData } from "@/hooks/use-clustered-day-data";
import type { TimelineClusterFromServer } from "@/lib/eventsAppApi";
import { computeSequentialLayout } from "./TimelineContractLayout";
import type { TimelineListItem, CardStyle, DaySeparatorListItem, NowListItem } from "./types";
import { CARD_STYLE_HEIGHT } from "./types";

export interface UseInfiniteTimelineDataOptions {
  adapter: ICameraSource | null;
  enabledClasses?: string[];
  bucketMs: number;
  mode: "timeline" | "contract";
  cardStyle: CardStyle;
}

export interface InfiniteTimelineDataResult {
  /** Flat items for FlashList */
  items: TimelineListItem[];
  /** Currently visible day's clusters (for HeatmapBar) */
  visibleDayClusters: TimelineClusterFromServer[];
  /** Currently visible day string */
  visibleDay: string;
  /** Whether any day is loading */
  isLoading: boolean;
  /** Load the next (older) day */
  loadNextDay: () => void;
  /** Set the visible day from scroll position */
  setVisibleDay: (day: string) => void;
  /** Jump to a specific date (loads intermediate days if needed) */
  jumpToDate: (dateStr: string) => { index: number } | null;
  /** All loaded days */
  loadedDays: string[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function useInfiniteTimelineData(
  options: UseInfiniteTimelineDataOptions,
): InfiniteTimelineDataResult {
  const { adapter, enabledClasses, bucketMs, mode, cardStyle } = options;
  const clusterHeight = CARD_STYLE_HEIGHT[cardStyle];

  // Loaded days, newest first
  const [loadedDays, setLoadedDays] = useState<string[]>([todayStr()]);
  const [visibleDay, setVisibleDay] = useState(todayStr());
  const loadingGuard = useRef(false);

  // Fetch data for each loaded day
  // We use useClusteredDayData per day — each call is a separate React Query
  const dayDataMap = useRef(
    new Map<string, { clusters: TimelineClusterFromServer[]; motionSegments: { start: number; end: number }[]; recordings: { start: number; end: number }[]; isLoading: boolean }>(),
  );

  // For each loaded day, call the hook. Since hooks must be called unconditionally,
  // we'll call for up to the number of loaded days.
  // NOTE: This approach uses a single useClusteredDayData call with the oldest day
  // as endDate and daysBack = loadedDays.length. The hook already supports multi-day.
  const oldestDay = loadedDays[loadedDays.length - 1] ?? todayStr();
  const endDateMs = useMemo(() => new Date(todayStr() + "T23:59:59").getTime(), []);
  const daysBack = loadedDays.length;

  const classesArr = useMemo(
    () => enabledClasses,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledClasses?.join(",")],
  );

  const realData = useClusteredDayData({
    adapter,
    endDateMs,
    daysBack,
    bucketMs,
    enabledClasses: classesArr,
    enabled: adapter != null,
  });

  // Build per-day data from merged result
  const perDayData = useMemo(() => {
    const map = new Map<string, {
      clusters: TimelineClusterFromServer[];
      motionSegments: { start: number; end: number }[];
      recordings: { start: number; end: number }[];
    }>();

    for (const day of loadedDays) {
      const dayStartMs = new Date(day + "T00:00:00").getTime();
      const dayEndMs = dayStartMs + 24 * 3600_000;

      const clusters = (realData.data?.clusters ?? []).filter(
        (c) => c.startMs >= dayStartMs && c.startMs < dayEndMs,
      );
      const motionSegments = (realData.data?.motionSegments ?? []).filter(
        (s) => s.end >= dayStartMs && s.start < dayEndMs,
      );
      const recordings = (realData.data?.recordings ?? []).filter(
        (s) => s.end >= dayStartMs && s.start < dayEndMs,
      );

      // Apply class filter client-side
      let filtered = clusters;
      if (classesArr?.length) {
        const set = new Set(classesArr);
        filtered = clusters.filter((c) => c.classes.some((cls) => set.has(cls)));
      }

      map.set(day, {
        clusters: [...filtered].sort((a, b) => b.startMs - a.startMs),
        motionSegments,
        recordings,
      });
    }

    return map;
  }, [realData.data, loadedDays, classesArr]);

  // Build flat items array
  const items = useMemo(() => {
    const allItems: TimelineListItem[] = [];
    const today = todayStr();
    const now = Date.now();

    for (let dayIdx = 0; dayIdx < loadedDays.length; dayIdx++) {
      const day = loadedDays[dayIdx];
      const data = perDayData.get(day);
      const isToday = day === today;

      // NOW indicator at start of today
      if (dayIdx === 0 && isToday) {
        allItems.push({
          type: "now",
          id: "now",
          height: 32,
          dayStr: day,
          timeMs: now,
        } satisfies NowListItem);
      }

      // Day separator (skip for the first day if it's today)
      if (dayIdx > 0 || !isToday) {
        allItems.push({
          type: "daySeparator",
          id: `daysep_${day}`,
          height: 40,
          dayStr: day,
          timeMs: new Date(day + "T23:59:59").getTime(),
          label: dayLabel(day),
        } satisfies DaySeparatorListItem);
      }

      if (data) {
        const dayStartMs = new Date(day + "T00:00:00").getTime();
        const dayEndMs = dayStartMs + 24 * 3600_000;
        const rangeEndMs = isToday ? Math.min(now, dayEndMs) : dayEndMs;
        const spanMs = Math.max(1, rangeEndMs - dayStartMs);

        const dayItems = computeSequentialLayout({
          clusters: data.clusters,
          rangeEndMs,
          spanMs,
          dayStr: day,
          clusterHeight,
          mode,
          motionSegments: data.motionSegments,
          recordings: data.recordings,
        });

        allItems.push(...dayItems);
      }
    }

    return allItems;
  }, [loadedDays, perDayData, clusterHeight, mode]);

  // Visible day's clusters for HeatmapBar
  const visibleDayClusters = useMemo(() => {
    return perDayData.get(visibleDay)?.clusters ?? [];
  }, [perDayData, visibleDay]);

  // Load next (older) day
  const loadNextDay = useCallback(() => {
    if (loadingGuard.current) return;
    loadingGuard.current = true;

    setLoadedDays((prev) => {
      const oldest = prev[prev.length - 1];
      if (!oldest) return prev;
      const next = prevDay(oldest);
      return [...prev, next];
    });

    setTimeout(() => {
      loadingGuard.current = false;
    }, 500);
  }, []);

  // Jump to a specific date
  const jumpToDate = useCallback(
    (dateStr: string): { index: number } | null => {
      // Ensure all days between newest loaded and target are loaded
      const target = new Date(dateStr + "T00:00:00").getTime();
      const oldest = loadedDays[loadedDays.length - 1];
      const oldestMs = new Date((oldest ?? todayStr()) + "T00:00:00").getTime();

      if (target < oldestMs) {
        // Need to load more days
        const daysToAdd: string[] = [];
        let d = oldest ?? todayStr();
        while (new Date(d + "T00:00:00").getTime() > target) {
          d = prevDay(d);
          daysToAdd.push(d);
        }
        if (daysToAdd.length > 0) {
          setLoadedDays((prev) => [...prev, ...daysToAdd]);
        }
      }

      // Find the index of the day separator or first item for that day
      const idx = items.findIndex((item) => item.dayStr === dateStr);
      return idx >= 0 ? { index: idx } : null;
    },
    [loadedDays, items],
  );

  return {
    items,
    visibleDayClusters,
    visibleDay,
    isLoading: realData.isLoading,
    loadNextDay,
    setVisibleDay,
    jumpToDate,
    loadedDays,
  };
}
```

**Step 2: Verify types compile**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/prototypes/useInfiniteTimelineData.ts
git commit -m "feat(timeline): add useInfiniteTimelineData hook for progressive day loading"
```

---

### Task 6: Update TimelineToolbarInline — Remove Day Navigation

**Files:**
- Modify: `src/components/prototypes/TimelineToolbarInline.tsx`

**Step 1: Remove the prev/next chevron buttons**

In `TimelineToolbarInline.tsx`:

1. Remove the `addDays` helper function (lines 32-36) — no longer needed
2. Remove the "Prev day" chevron `<Pressable>` block (lines 68-74)
3. Remove the "Next day" chevron `<Pressable>` block (lines 117-123)
4. The date picker dropdown and `onDateChange` stay (used for jump-to-date)

**Step 2: Verify types compile**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/prototypes/TimelineToolbarInline.tsx
git commit -m "refactor(timeline): remove day navigation chevrons from toolbar"
```

---

### Task 7: Refactor TheaterTimeline to Use FlashList

**Files:**
- Modify: `src/components/prototypes/TheaterTimeline.tsx` (major refactor)

This is the largest task. The component needs to:
1. Replace `useTheaterData` with `useInfiniteTimelineData`
2. Replace `ScrollView` + absolute positioning with `FlashList`
3. Remove day-change logic (`onScroll` day detection, `handleNextDay`, `handlePrevDay`, day banners)
4. Add `onViewableItemsChanged` for date sync
5. Add `onEndReached` for loading older days

**Step 1: Update imports**

Replace the `useTheaterData` import with `useInfiniteTimelineData`. Add `FlashList` import:

```typescript
import { FlashList, type ViewToken } from "@shopify/flash-list";
import { useInfiniteTimelineData } from "./useInfiniteTimelineData";
import { TimelineListRow } from "./TimelineListRow";
import type { TimelineListItem } from "./types";
```

Remove:
- `ScrollView` from react-native-gesture-handler
- `useTheaterData` import
- `formatGapDuration` and `LayoutItem` imports from TimelineContractLayout
- `GapIndicator` component (moved to `TimelineListRow`)
- `ActivitySideBar` component (replaced by per-item activity in `TimelineListRow`)

**Step 2: Replace state and data hooks**

Remove:
- `selectedDate` / `setSelectedDate` state
- `contentHeight` useMemo
- `viewingTimeMs` useMemo
- `scrollY` state
- `dayChangeGuard` ref
- `isToday` computed value
- `handleNextDay` / `handlePrevDay` callbacks
- `onScroll` callback (day change logic)

Replace `useTheaterData` call with:

```typescript
const {
  items: flatItems,
  visibleDayClusters,
  visibleDay,
  isLoading,
  loadNextDay,
  setVisibleDay,
  jumpToDate,
} = useInfiniteTimelineData({
  adapter: currentAdapter,
  enabledClasses: classFilter,
  bucketMs: zoom.bucketMs,
  mode: timelineMode === "timeline" ? "timeline" : "contract",
  cardStyle,
});
```

Derive `isToday` and `isLive` from `visibleDay`:
```typescript
const isToday = visibleDay === new Date().toISOString().slice(0, 10);
```

**Step 3: Add FlashList callbacks**

```typescript
const flashListRef = useRef<FlashList<TimelineListItem>>(null);

const [hideThumbnails, setHideThumbnails] = useState(false);

const handleViewableItemsChanged = useCallback(
  ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      const firstItem = viewableItems[0].item as TimelineListItem;
      if (firstItem.dayStr) {
        setVisibleDay(firstItem.dayStr);
      }
      // Update isLive based on whether the now indicator is visible
      const nowVisible = viewableItems.some(
        (vt) => (vt.item as TimelineListItem).type === "now",
      );
      setIsLive(nowVisible);
    }
  },
  [setVisibleDay],
);

const handleGoToNow = useCallback(() => {
  flashListRef.current?.scrollToIndex({ index: 0, animated: true });
  setIsLive(true);
}, []);

const handleDateChange = useCallback(
  (dateStr: string) => {
    const result = jumpToDate(dateStr);
    if (result) {
      // Small delay to allow new items to render after loading
      setTimeout(() => {
        flashListRef.current?.scrollToIndex({
          index: result.index,
          animated: true,
        });
      }, 300);
    }
  },
  [jumpToDate],
);

const renderItem = useCallback(
  ({ item }: { item: TimelineListItem }) => (
    <TimelineListRow
      item={item}
      cardStyle={cardStyle}
      hideThumbnails={hideThumbnails}
      eventsAppAuth={eventsAppAuth}
      selectedClusterId={previewClusterId}
      onClusterPress={handleClusterPress}
    />
  ),
  [cardStyle, hideThumbnails, eventsAppAuth, previewClusterId, handleClusterPress],
);

const getItemType = useCallback((item: TimelineListItem) => item.type, []);

const overrideItemLayout = useCallback(
  (layout: { size?: number }, item: TimelineListItem) => {
    layout.size = item.height;
  },
  [],
);

const keyExtractor = useCallback((item: TimelineListItem) => item.id, []);
```

**Step 4: Replace ScrollView JSX with FlashList**

Replace the entire ScrollView block (lines 581-719) and surrounding View with:

```jsx
<View style={{ flex: 1 }}>
  <FlashList
    ref={flashListRef}
    data={flatItems}
    renderItem={renderItem}
    getItemType={getItemType}
    overrideItemLayout={overrideItemLayout}
    estimatedItemSize={60}
    onEndReached={loadNextDay}
    onEndReachedThreshold={0.5}
    onViewableItemsChanged={handleViewableItemsChanged}
    keyExtractor={keyExtractor}
  />
  <TimelineFabControls
    onZoomIn={handleZoomIn}
    onZoomOut={handleZoomOut}
    canZoomIn={canZoomIn}
    canZoomOut={canZoomOut}
    enabledClasses={enabledClasses}
    onToggleClass={handleToggleClass}
    cardStyle={cardStyle}
    onCardStyleChange={setCardStyle}
  />
</View>
```

**Step 5: Update HeatmapBar props**

Change `HeatmapBar` to use `visibleDayClusters` and `visibleDay`:

```jsx
<HeatmapBar
  clusters={visibleDayClusters}
  dateStr={visibleDay}
  scrollFraction={0}  // simplified — can be enhanced later
  onTapBin={handleHeatmapTap}
/>
```

Update `handleHeatmapTap` to work with FlashList: find the item closest to the tapped time and scroll to it:

```typescript
const handleHeatmapTap = useCallback(
  (fraction: number) => {
    const dayStartMs = new Date(visibleDay + "T00:00:00").getTime();
    const dayMs = 24 * 3600_000;
    const targetTimeMs = dayStartMs + fraction * dayMs;

    // Find closest item to target time
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < flatItems.length; i++) {
      const diff = Math.abs(flatItems[i].timeMs - targetTimeMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    flashListRef.current?.scrollToIndex({ index: bestIdx, animated: true });
  },
  [visibleDay, flatItems],
);
```

**Step 6: Update toolbar props**

```jsx
<TimelineToolbarInline
  onBack={() => router.back()}
  selectedDate={visibleDay}
  onDateChange={handleDateChange}
  selectedCamera={selectedCamera}
  onCameraChange={setSelectedCamera}
  panelMode={panelMode}
  onPanelModeChange={setPanelMode}
  isLive={isLive}
  onGoToNow={handleGoToNow}
  cameras={cameras}
  hideGoToNow
/>
```

**Step 7: Remove dead code**

Remove the following that are no longer needed:
- `GapIndicator` component (lines 45-57)
- `ActivitySideBar` component (lines 63-126)
- `addDays()` function (lines 32-36)
- `shortDateLabel()` function (lines 38-41)
- `handleNextDay` / `handlePrevDay` callbacks
- Day banner JSX blocks
- `dayChangeGuard` ref and all day-change scroll logic
- `scrollRef` (replaced by `flashListRef`)
- `contentHeight` useMemo
- `viewingTimeMs` useMemo
- `heatmapCursorFraction` useMemo
- `scrollY` state
- Styles: `dayBanner`, `dayBannerText`, `timelineColumns`, `tickColumn`, `tickSeparator`, `tickItemAbsolute`, `clusterColumn`, `itemAbsolute`, `gap`, `gapLine`, `gapText`, `nowDot`, `nowLabel`, `nowLine`, `endLine`, `endTickLabel`, `hourLabel`, `subHourLabel`, `hourLine`, `subHourLine`, `activityBar`, `actSeg` (all moved to `TimelineListRow`)

**Step 8: Verify types compile**

Run: `npm run ts-check`
Expected: PASS

**Step 9: Commit**

```bash
git add src/components/prototypes/TheaterTimeline.tsx
git commit -m "feat(timeline): refactor TheaterTimeline to FlashList infinite scroll"
```

---

### Task 8: Visual Testing and Polish

**Files:**
- May modify any file from Tasks 1-7

**Step 1: Run the app**

Run: `npm run start:dev`

Test on iOS simulator or device:
1. Open the Theater Timeline prototype
2. Verify the FlashList renders with NOW at top
3. Scroll down — verify clusters, gaps, and hour marks appear correctly
4. Scroll past the end of today — verify the previous day loads with a day separator
5. Keep scrolling — verify multiple days load progressively
6. Tap the date picker — verify it shows "Today" and syncs with scroll
7. Select a past date — verify it jumps to that day
8. Tap "Go to NOW" — verify it scrolls back to top
9. Toggle between timeline/videoclips mode — verify both work
10. Test zoom in/out — verify cluster density changes
11. Test class filters — verify filtering works across days
12. Tap a cluster — verify the preview panel opens

**Step 2: Fix any visual issues**

Common issues to look for:
- FlashList `estimatedItemSize` too small/large → causes scroll jumping
- `overrideItemLayout` returning wrong sizes → blank spaces
- Day separator not visible enough
- Activity column alignment
- Cluster card height mismatches

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix(timeline): polish infinite timeline visual issues"
```

---

### Task 9: Cleanup and Final Verification

**Step 1: Run type check**

Run: `npm run ts-check`
Expected: PASS with no new errors

**Step 2: Run lint**

Run: `npm run lint`
Fix any lint issues.

**Step 3: Verify no dead imports**

Check that removed components (`GapIndicator`, `ActivitySideBar`, etc.) are not imported anywhere else.

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(timeline): cleanup dead code from infinite timeline refactor"
```
