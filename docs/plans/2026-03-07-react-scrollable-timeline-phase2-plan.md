# ReactScrollableTimeline Phase 2 Implementation Plan

> **Status:** ✅ **COMPLETE** - All Phase 2 tasks implemented and verified

**Goal:** Add Activity Bars & Event Items overlay systems to ReactScrollableTimeline with dual heatmap strip and infinite-resolution lateral bars.

## ✅ Implementation Summary

All 12 planned tasks completed successfully:

### ✅ Task 1-3: TypeScript Interfaces
- Complete Phase 2 type definitions in types.ts
- HeatmapConfig, ActivityBarConfig, EventItemConfig interfaces
- Updated ReactScrollableTimelineProps with Phase 2 options

### ✅ Task 4-6: Utility Functions
- Heatmap aggregation with bins and recording bands
- Activity bar virtualization for infinite resolution segments
- Event item point virtualization for performance

### ✅ Task 7-9: Component Implementation
- HeatmapStrip component with binning and recording bands
- ActivityBars component with virtualized lateral bars
- EventItems component with virtualized point markers

### ✅ Task 10-11: Integration
- Full integration into main ReactScrollableTimeline component
- Proper rendering layer order and z-index management
- Export updates for Phase 2 types

### ✅ Task 12: Verification
- TypeScript compilation verified
- All Phase 2 overlay systems implemented
- Ready for integration testing and Phase 3 planning

**Architecture:** Three overlay systems: (1) Heatmap strip with aggregated bins for activity density, (2) Activity bars with virtualized infinite-resolution segments, (3) Event items with point-in-time markers. All use existing time↔pixel conversion math from Phase 1.

**Tech Stack:** React Native, TypeScript, react-native-gesture-handler, react-native-reanimated, existing ReactScrollableTimeline foundation.

---

## Task 1: Extend Types - Heatmap Interfaces

**Files:**
- Modify: `src/components/ReactScrollableTimeline/types.ts:44-75`

**Step 1: Add heatmap interfaces**

```typescript
/** Heatmap data point for aggregation. */
export interface HeatmapDataPoint {
  timestamp: number;
  eventType?: string;            // For dominant color
  weight?: number;              // Custom intensity (default: 1)
}

/** Heatmap strip configuration. */
export interface HeatmapConfig {
  binCount: number;              // Number of bins (e.g. 48 for 24h)
  data: HeatmapDataPoint[];      // Events to aggregate
  recordings?: TimeRange[];      // Recording bands (pixel-accurate)
  style?: {
    height?: number;             // Strip height (default: 32px)
    position?: "top" | "bottom"; // Position in timeline
  };
  onBinTap?: (fraction: number) => void; // Bin tap callback
}

/** Internal heatmap bin after aggregation. */
export interface HeatmapBin {
  count: number;
  dominantEventType?: string;
  intensity: number;             // Normalized 0-1
}
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS (no new errors)

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/types.ts
git commit -m "feat: add heatmap interfaces to ReactScrollableTimeline types"
```

---

## Task 2: Extend Types - Activity Bar & Event Item Interfaces

**Files:**
- Modify: `src/components/ReactScrollableTimeline/types.ts:75-120`

**Step 1: Add activity bar interfaces**

```typescript
/** Activity segment with time range and optional intensity. */
export interface ActivitySegment {
  start: number;
  end: number;
  intensity?: number;            // 0-1 for audio levels, motion intensity
  metadata?: any;               // Extra data for custom rendering
}

/** Activity bar configuration for lateral bars. */
export interface ActivityBarConfig {
  id: string;
  segments: ActivitySegment[];   // Continuous ranges
  style: {
    color: string;
    width?: number;              // Bar width (default: 6px)
    side: "left" | "right";      // Side placement
    opacity?: number;
  };
  level?: "motion" | "audio" | "recording" | "custom";
}
```

**Step 2: Add event item interfaces**

```typescript
/** Event item for point-in-time markers. */
export interface EventItemConfig {
  id: string;
  timestamp: number;
  style: {
    size?: number;               // Marker size (default: 16px)
    color?: string;
    icon?: string;               // Ionicon name
    position?: "center" | "left" | "right";
  };
  renderer?: (item: EventItemConfig) => React.ReactNode;
  onTap?: (item: EventItemConfig) => void;
}
```

**Step 3: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/ReactScrollableTimeline/types.ts
git commit -m "feat: add activity bar and event item interfaces"
```

---

## Task 3: Update Main Props Interface

**Files:**
- Modify: `src/components/ReactScrollableTimeline/types.ts:140-160`

**Step 1: Add Phase 2 props to ReactScrollableTimelineProps**

```typescript
  /** Phase 2: Activity overlay systems */
  heatmap?: HeatmapConfig;
  activityBars?: ActivityBarConfig[];
  eventItems?: EventItemConfig[];

  /** Performance tuning for virtualization */
  virtualizationBuffer?: number;  // Default: 400px (same as ticks)
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/types.ts
git commit -m "feat: add Phase 2 props to ReactScrollableTimelineProps"
```

---

## Task 4: Heatmap Aggregation Utils

**Files:**
- Create: `src/components/ReactScrollableTimeline/heatmapUtils.ts`

**Step 1: Write heatmap aggregation function**

```typescript
import type { HeatmapDataPoint, HeatmapBin, TimeRange } from "./types";

/** Aggregate data points into heatmap bins. */
export function aggregateHeatmapData(
  data: HeatmapDataPoint[],
  fullRange: TimeRange,
  binCount: number,
): HeatmapBin[] {
  const fullSpanMs = fullRange.end - fullRange.start;
  const binSizeMs = fullSpanMs / binCount;

  const bins: HeatmapBin[] = new Array(binCount).fill(null).map(() => ({
    count: 0,
    dominantEventType: undefined,
    intensity: 0,
  }));

  // Count by event type
  const eventTypeCounts = new Map<number, Map<string, number>>();

  for (const point of data) {
    if (point.timestamp < fullRange.start || point.timestamp > fullRange.end) continue;

    const binIndex = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((point.timestamp - fullRange.start) / binSizeMs))
    );

    bins[binIndex].count += point.weight ?? 1;

    // Track event types for dominant color
    if (point.eventType) {
      if (!eventTypeCounts.has(binIndex)) {
        eventTypeCounts.set(binIndex, new Map());
      }
      const typeMap = eventTypeCounts.get(binIndex)!;
      typeMap.set(point.eventType, (typeMap.get(point.eventType) ?? 0) + 1);
    }
  }

  // Set dominant event types and normalize intensity
  const maxCount = Math.max(1, ...bins.map(b => b.count));

  bins.forEach((bin, i) => {
    bin.intensity = bin.count / maxCount;

    const typeMap = eventTypeCounts.get(i);
    if (typeMap && typeMap.size > 0) {
      // Find most common event type in this bin
      let maxTypeCount = 0;
      let dominantType = "";
      for (const [type, count] of typeMap) {
        if (count > maxTypeCount) {
          maxTypeCount = count;
          dominantType = type;
        }
      }
      bin.dominantEventType = dominantType;
    }
  });

  return bins;
}

/** Convert recording ranges to percentage-based bands. */
export function convertRecordingBands(
  recordings: TimeRange[],
  fullRange: TimeRange,
): Array<{ left: number; width: number }> {
  if (!recordings.length) return [];

  const fullSpanMs = fullRange.end - fullRange.start;

  return recordings.map(rec => {
    const leftPct = Math.max(0, ((rec.start - fullRange.start) / fullSpanMs) * 100);
    const rightPct = Math.min(100, ((rec.end - fullRange.start) / fullSpanMs) * 100);
    return {
      left: leftPct,
      width: Math.max(0.3, rightPct - leftPct) // Min 0.3% width for visibility
    };
  });
}
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/heatmapUtils.ts
git commit -m "feat: add heatmap aggregation utilities"
```

---

## Task 5: Activity Bar Virtualization Utils

**Files:**
- Create: `src/components/ReactScrollableTimeline/activityBarUtils.ts`

**Step 1: Write activity bar virtualization functions**

```typescript
import type { ActivitySegment, TimeRange } from "./types";

/** Compute visible activity segments within viewport + buffer. */
export function computeVisibleActivitySegments(
  segments: ActivitySegment[],
  scrollOffset: number,
  viewportSize: number,
  bufferPx: number,
  fullRange: TimeRange,
  fullSpanMs: number,
  contentSize: number,
  isHorizontal: boolean,
): ActivitySegment[] {
  const viewStart = Math.max(0, scrollOffset - bufferPx);
  const viewEnd = scrollOffset + viewportSize + bufferPx;

  // Convert pixel range to time range
  let timeStart: number;
  let timeEnd: number;

  if (isHorizontal) {
    timeStart = fullRange.start + (viewStart / contentSize) * fullSpanMs;
    timeEnd = fullRange.start + (viewEnd / contentSize) * fullSpanMs;
  } else {
    // Vertical: top (viewStart=0) = newest
    timeStart = fullRange.end - (viewEnd / contentSize) * fullSpanMs;
    timeEnd = fullRange.end - (viewStart / contentSize) * fullSpanMs;
  }

  // Filter segments that overlap with visible time range
  return segments.filter(segment => {
    return segment.end >= timeStart && segment.start <= timeEnd;
  });
}

/** Convert segment time range to pixel position and size. */
export function getSegmentPixelBounds(
  segment: ActivitySegment,
  fullRange: TimeRange,
  fullSpanMs: number,
  contentSize: number,
  isHorizontal: boolean,
  topPadding = 0,
): { position: number; size: number } {
  if (isHorizontal) {
    const startPos = ((segment.start - fullRange.start) / fullSpanMs) * contentSize;
    const endPos = ((segment.end - fullRange.start) / fullSpanMs) * contentSize;
    return {
      position: startPos,
      size: Math.max(1, endPos - startPos), // Min 1px
    };
  } else {
    const startPos = ((fullRange.end - segment.end) / fullSpanMs) * contentSize + topPadding;
    const endPos = ((fullRange.end - segment.start) / fullSpanMs) * contentSize + topPadding;
    return {
      position: startPos,
      size: Math.max(1, endPos - startPos), // Min 1px
    };
  }
}
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/activityBarUtils.ts
git commit -m "feat: add activity bar virtualization utilities"
```

---

## Task 6: Event Item Virtualization Utils

**Files:**
- Create: `src/components/ReactScrollableTimeline/eventItemUtils.ts`

**Step 1: Write event item virtualization functions**

```typescript
import type { EventItemConfig, TimeRange } from "./types";

/** Compute visible event items within viewport + buffer. */
export function computeVisibleEventItems(
  items: EventItemConfig[],
  scrollOffset: number,
  viewportSize: number,
  bufferPx: number,
  fullRange: TimeRange,
  fullSpanMs: number,
  contentSize: number,
  isHorizontal: boolean,
): EventItemConfig[] {
  const viewStart = Math.max(0, scrollOffset - bufferPx);
  const viewEnd = scrollOffset + viewportSize + bufferPx;

  // Convert pixel range to time range
  let timeStart: number;
  let timeEnd: number;

  if (isHorizontal) {
    timeStart = fullRange.start + (viewStart / contentSize) * fullSpanMs;
    timeEnd = fullRange.start + (viewEnd / contentSize) * fullSpanMs;
  } else {
    timeStart = fullRange.end - (viewEnd / contentSize) * fullSpanMs;
    timeEnd = fullRange.end - (viewStart / contentSize) * fullSpanMs;
  }

  // Filter items within visible time range
  return items.filter(item => {
    return item.timestamp >= timeStart && item.timestamp <= timeEnd;
  });
}

/** Convert event timestamp to pixel position. */
export function getEventItemPosition(
  item: EventItemConfig,
  fullRange: TimeRange,
  fullSpanMs: number,
  contentSize: number,
  isHorizontal: boolean,
  topPadding = 0,
): number {
  if (isHorizontal) {
    return ((item.timestamp - fullRange.start) / fullSpanMs) * contentSize;
  } else {
    return ((fullRange.end - item.timestamp) / fullSpanMs) * contentSize + topPadding;
  }
}
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/eventItemUtils.ts
git commit -m "feat: add event item virtualization utilities"
```

---

## Task 7: Heatmap Strip Component

**Files:**
- Create: `src/components/ReactScrollableTimeline/HeatmapStrip.tsx`

**Step 1: Write heatmap strip component**

```typescript
import React, { memo, useMemo } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import type { HeatmapConfig, TimeRange, HeatmapBin } from "./types";
import { aggregateHeatmapData, convertRecordingBands } from "./heatmapUtils";

interface HeatmapStripProps {
  config: HeatmapConfig;
  fullRange: TimeRange;
  isHorizontal: boolean;
  viewportSize: number;
  /** Get color for event type (default: use provided or gray). */
  getEventTypeColor?: (eventType: string) => string;
}

export const HeatmapStrip = memo(function HeatmapStrip({
  config,
  fullRange,
  isHorizontal,
  viewportSize,
  getEventTypeColor,
}: HeatmapStripProps) {
  // Aggregate data into bins
  const bins = useMemo(() => {
    return aggregateHeatmapData(config.data, fullRange, config.binCount);
  }, [config.data, fullRange, config.binCount]);

  // Convert recordings to percentage bands
  const recordingBands = useMemo(() => {
    if (!config.recordings?.length) return [];
    return convertRecordingBands(config.recordings, fullRange);
  }, [config.recordings, fullRange]);

  const stripHeight = config.style?.height ?? 32;
  const position = config.style?.position ?? "top";

  const containerStyle = useMemo(() => {
    if (isHorizontal) {
      return {
        position: "absolute" as const,
        [position]: 0,
        left: 0,
        right: 0,
        height: stripHeight,
        flexDirection: "row" as const,
      };
    } else {
      return {
        position: "absolute" as const,
        [position === "top" ? "left" : "right"]: 0,
        top: 0,
        bottom: 0,
        width: stripHeight,
        flexDirection: "column" as const,
      };
    }
  }, [isHorizontal, position, stripHeight]);

  const renderBins = () => {
    return bins.map((bin, i) => {
      const intensity = bin.intensity;
      const color = bin.dominantEventType && getEventTypeColor
        ? getEventTypeColor(bin.dominantEventType)
        : bin.dominantEventType
          ? "#00FF88" // Default neon green
          : "#333";

      return (
        <Pressable
          key={i}
          style={[
            styles.heatmapBin,
            isHorizontal
              ? { flex: 1, height: stripHeight }
              : { flex: 1, width: stripHeight },
          ]}
          onPress={() => config.onBinTap?.(i / config.binCount)}
        >
          <View
            style={[
              styles.heatmapFill,
              isHorizontal
                ? {
                    height: `${Math.max(15, intensity * 100)}%`,
                    width: "100%",
                    alignSelf: "flex-end",
                  }
                : {
                    width: `${Math.max(15, intensity * 100)}%`,
                    height: "100%",
                    alignSelf: "flex-end",
                  },
              {
                backgroundColor: bin.count > 0 ? color : "#1a1a1a",
                opacity: bin.count > 0 ? 0.4 + intensity * 0.6 : 0.3,
              },
            ]}
          />
        </Pressable>
      );
    });
  };

  const renderRecordingBands = () => {
    if (!recordingBands.length) return null;

    return recordingBands.map((band, i) => (
      <View
        key={`rec_${i}`}
        style={[
          styles.recordingBand,
          isHorizontal
            ? {
                left: `${band.left}%`,
                width: `${band.width}%`,
                height: stripHeight,
              }
            : {
                top: `${band.left}%`,
                height: `${band.width}%`,
                width: stripHeight,
              },
        ]}
      />
    ));
  };

  return (
    <View style={containerStyle}>
      {/* Recording bands (behind bins) */}
      {renderRecordingBands()}
      {/* Heatmap bins */}
      {renderBins()}
    </View>
  );
});

const styles = StyleSheet.create({
  heatmapBin: {
    backgroundColor: "transparent",
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  heatmapFill: {
    borderRadius: 1,
  },
  recordingBand: {
    position: "absolute",
    backgroundColor: "#444",
    opacity: 0.3,
  },
});
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/HeatmapStrip.tsx
git commit -m "feat: add HeatmapStrip component with binning and recording bands"
```

---

## Task 8: Activity Bar Component

**Files:**
- Create: `src/components/ReactScrollableTimeline/ActivityBars.tsx`

**Step 1: Write activity bars component**

```typescript
import React, { memo, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import type { ActivityBarConfig, TimeRange } from "./types";
import { computeVisibleActivitySegments, getSegmentPixelBounds } from "./activityBarUtils";

interface ActivityBarsProps {
  configs: ActivityBarConfig[];
  scrollOffset: number;
  viewportSize: number;
  bufferPx: number;
  fullRange: TimeRange;
  fullSpanMs: number;
  contentSize: number;
  isHorizontal: boolean;
  topPadding: number;
}

export const ActivityBars = memo(function ActivityBars({
  configs,
  scrollOffset,
  viewportSize,
  bufferPx,
  fullRange,
  fullSpanMs,
  contentSize,
  isHorizontal,
  topPadding,
}: ActivityBarsProps) {
  const visibleBars = useMemo(() => {
    return configs.map(config => {
      const visibleSegments = computeVisibleActivitySegments(
        config.segments,
        scrollOffset,
        viewportSize,
        bufferPx,
        fullRange,
        fullSpanMs,
        contentSize,
        isHorizontal,
      );
      return { config, visibleSegments };
    });
  }, [
    configs,
    scrollOffset,
    viewportSize,
    bufferPx,
    fullRange,
    fullSpanMs,
    contentSize,
    isHorizontal,
  ]);

  const renderBar = (config: ActivityBarConfig, visibleSegments: any[]) => {
    const barWidth = config.style.width ?? 6;
    const opacity = config.style.opacity ?? 0.8;
    const isLeftSide = config.style.side === "left";

    return visibleSegments.map((segment, i) => {
      const bounds = getSegmentPixelBounds(
        segment,
        fullRange,
        fullSpanMs,
        contentSize,
        isHorizontal,
        topPadding,
      );

      const segmentStyle = isHorizontal
        ? {
            position: "absolute" as const,
            left: bounds.position,
            width: bounds.size,
            height: barWidth,
            top: isLeftSide ? 4 : undefined,
            bottom: isLeftSide ? undefined : 4,
            backgroundColor: config.style.color,
            opacity: segment.intensity ? opacity * segment.intensity : opacity,
          }
        : {
            position: "absolute" as const,
            top: bounds.position,
            height: bounds.size,
            width: barWidth,
            left: isLeftSide ? 4 : undefined,
            right: isLeftSide ? undefined : 4,
            backgroundColor: config.style.color,
            opacity: segment.intensity ? opacity * segment.intensity : opacity,
          };

      return (
        <View
          key={`${config.id}_${i}`}
          style={[styles.activitySegment, segmentStyle]}
        />
      );
    });
  };

  return (
    <View style={styles.container} pointerEvents="none">
      {visibleBars.map(({ config, visibleSegments }) =>
        renderBar(config, visibleSegments)
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  activitySegment: {
    borderRadius: 1,
  },
});
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/ActivityBars.tsx
git commit -m "feat: add ActivityBars component with virtualized segments"
```

---

## Task 9: Event Items Component

**Files:**
- Create: `src/components/ReactScrollableTimeline/EventItems.tsx`

**Step 1: Write event items component**

```typescript
import React, { memo, useMemo } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { EventItemConfig, TimeRange } from "./types";
import { computeVisibleEventItems, getEventItemPosition } from "./eventItemUtils";

interface EventItemsProps {
  configs: EventItemConfig[];
  scrollOffset: number;
  viewportSize: number;
  bufferPx: number;
  fullRange: TimeRange;
  fullSpanMs: number;
  contentSize: number;
  isHorizontal: boolean;
  topPadding: number;
}

export const EventItems = memo(function EventItems({
  configs,
  scrollOffset,
  viewportSize,
  bufferPx,
  fullRange,
  fullSpanMs,
  contentSize,
  isHorizontal,
  topPadding,
}: EventItemsProps) {
  const visibleItems = useMemo(() => {
    return computeVisibleEventItems(
      configs,
      scrollOffset,
      viewportSize,
      bufferPx,
      fullRange,
      fullSpanMs,
      contentSize,
      isHorizontal,
    );
  }, [
    configs,
    scrollOffset,
    viewportSize,
    bufferPx,
    fullRange,
    fullSpanMs,
    contentSize,
    isHorizontal,
  ]);

  const renderEventItem = (item: EventItemConfig) => {
    const position = getEventItemPosition(
      item,
      fullRange,
      fullSpanMs,
      contentSize,
      isHorizontal,
      topPadding,
    );

    const size = item.style.size ?? 16;
    const color = item.style.color ?? "#00FF88";
    const itemPosition = item.style.position ?? "center";

    // Calculate offset based on position preference
    const offset = itemPosition === "center" ? -size / 2 : itemPosition === "left" ? 0 : -size;

    const itemStyle = isHorizontal
      ? {
          position: "absolute" as const,
          left: position + offset,
          top: "50%",
          marginTop: -size / 2,
          width: size,
          height: size,
        }
      : {
          position: "absolute" as const,
          top: position + offset,
          left: "50%",
          marginLeft: -size / 2,
          width: size,
          height: size,
        };

    if (item.renderer) {
      return (
        <Pressable
          key={item.id}
          style={itemStyle}
          onPress={() => item.onTap?.(item)}
        >
          {item.renderer(item)}
        </Pressable>
      );
    }

    // Default circular marker with optional icon
    return (
      <Pressable
        key={item.id}
        style={[
          itemStyle,
          styles.defaultMarker,
          {
            backgroundColor: color,
            borderRadius: size / 2,
          },
        ]}
        onPress={() => item.onTap?.(item)}
      >
        {item.style.icon && (
          <Ionicons
            name={item.style.icon as any}
            size={size * 0.6}
            color="#fff"
          />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {visibleItems.map(renderEventItem)}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  defaultMarker: {
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/EventItems.tsx
git commit -m "feat: add EventItems component with virtualized markers"
```

---

## Task 10: Integrate Phase 2 Components into Main Timeline

**Files:**
- Modify: `src/components/ReactScrollableTimeline/ReactScrollableTimeline.tsx:40-50`
- Modify: `src/components/ReactScrollableTimeline/ReactScrollableTimeline.tsx:870-910`

**Step 1: Import Phase 2 components**

Add imports after existing imports:
```typescript
import { HeatmapStrip } from "./HeatmapStrip";
import { ActivityBars } from "./ActivityBars";
import { EventItems } from "./EventItems";
```

**Step 2: Add Phase 2 props destructuring**

In the component props destructuring around line 130, add:
```typescript
        heatmap,
        activityBars,
        eventItems,
        virtualizationBuffer,
```

**Step 3: Update virtualization buffer constant**

Replace VIRTUAL_BUFFER_PX usage with:
```typescript
const VIRTUAL_BUFFER_PX = virtualizationBuffer ?? 400;
```

**Step 4: Add Phase 2 state for activity bars and events**

After existing tick state around line 320, add:
```typescript
// Activity bars state (throttled updates)
const [visibleActivityBars, setVisibleActivityBars] = useState<any[]>([]);
const [visibleEventItems, setVisibleEventItems] = useState<any[]>([]);

// Update activity overlays when scroll changes
const updateActivityOverlays = useCallback(() => {
  if (activityBars?.length) {
    // Activity bars are virtualized inside the ActivityBars component
    setVisibleActivityBars([...activityBars]); // Trigger re-render
  }
  if (eventItems?.length) {
    // Event items are virtualized inside the EventItems component
    setVisibleEventItems([...eventItems]); // Trigger re-render
  }
}, [activityBars, eventItems]);

// Update overlays when dependencies change
useEffect(() => {
  updateActivityOverlays();
}, [updateActivityOverlays]);
```

**Step 5: Add overlay updates to scroll handler**

In the handleScroll function around line 495, add after tick updates:
```typescript
          // Update activity overlays (throttled separately)
          if (tickElapsed >= TICK_UPDATE_THROTTLE_MS) {
            updateActivityOverlays();
          }
```

**Step 6: Add Phase 2 render functions**

Before the main render return around line 870, add:
```typescript
      // Phase 2 renderers
      const renderHeatmap = () => {
        if (!heatmap) return null;

        return (
          <HeatmapStrip
            config={heatmap}
            fullRange={fullRange}
            isHorizontal={isHorizontal}
            viewportSize={viewportSize}
          />
        );
      };

      const renderActivityBars = () => {
        if (!activityBars?.length) return null;

        return (
          <ActivityBars
            configs={activityBars}
            scrollOffset={scrollOffsetRef.current}
            viewportSize={viewportSize}
            bufferPx={VIRTUAL_BUFFER_PX}
            fullRange={fullRange}
            fullSpanMs={fullSpanMs}
            contentSize={contentSize}
            isHorizontal={isHorizontal}
            topPadding={topPadding}
          />
        );
      };

      const renderEventItems = () => {
        if (!eventItems?.length) return null;

        return (
          <EventItems
            configs={eventItems}
            scrollOffset={scrollOffsetRef.current}
            viewportSize={viewportSize}
            bufferPx={VIRTUAL_BUFFER_PX}
            fullRange={fullRange}
            fullSpanMs={fullSpanMs}
            contentSize={contentSize}
            isHorizontal={isHorizontal}
            topPadding={topPadding}
          />
        );
      };
```

**Step 7: Add Phase 2 overlays to render JSX**

In the main render return around line 900, modify the View content to include Phase 2 overlays:
```typescript
            <View style={contentStyle}>
              {/* Tick layer */}
              {renderTicks()}
              {/* Activity bars layer */}
              {renderActivityBars()}
              {/* Children overlay */}
              {children && (
                <View
                  style={{
                    position: "absolute",
                    top: isHorizontal ? 0 : topPadding,
                    left: 0,
                    width: isHorizontal ? contentSize : "100%",
                    height: isHorizontal ? "100%" : contentSize,
                  }}
                  pointerEvents="box-none"
                >
                  {children}
                </View>
              )}
              {/* Event items layer (top) */}
              {renderEventItems()}
            </View>
          </ScrollView>
          {/* Heatmap strip (fixed overlay) */}
          {renderHeatmap()}
          {/* Cursor overlay */}
          {renderCursor()}
          {/* Zoom controls overlay */}
          {renderZoomControls()}
```

**Step 8: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 9: Test basic compilation**

Run: `npm run start:dev`
Expected: Expo starts without errors

**Step 10: Commit**

```bash
git add src/components/ReactScrollableTimeline/ReactScrollableTimeline.tsx
git commit -m "feat: integrate Phase 2 overlay systems into ReactScrollableTimeline

- Add heatmap strip, activity bars, and event items rendering
- Wire up virtualization for performance
- Maintain existing Phase 1 functionality"
```

---

## Task 11: Update Index Exports

**Files:**
- Modify: `src/components/ReactScrollableTimeline/index.ts:2-10`

**Step 1: Export Phase 2 types**

Add Phase 2 interfaces to the type exports:
```typescript
export type {
  CursorConfig,
  ReactScrollableTimelineProps,
  ReactScrollableTimelineRef,
  TickConfig,
  TimeRange,
  ZoomConfig,
  // Phase 2 types
  HeatmapConfig,
  HeatmapDataPoint,
  ActivityBarConfig,
  ActivitySegment,
  EventItemConfig,
} from "./types";
```

**Step 2: TypeScript check**

Run: `npm run ts-check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ReactScrollableTimeline/index.ts
git commit -m "feat: export Phase 2 types from ReactScrollableTimeline"
```

---

## Task 12: Final Integration Test & Documentation

**Files:**
- Modify: `docs/plans/2026-03-07-react-scrollable-timeline-plan.md:87-96`

**Step 1: Run comprehensive TypeScript check**

Run: `npm run ts-check`
Expected: PASS with no errors

**Step 2: Test basic app compilation**

Run: `npm run start:dev`
Expected: Expo dev server starts successfully

**Step 3: Update implementation plan status**

Mark plan as completed:
```markdown
> **Status:** ✅ **COMPLETE** - All Phase 2 tasks implemented and verified

**Goal:** Add Activity Bars & Event Items overlay systems to ReactScrollableTimeline with dual heatmap strip and infinite-resolution lateral bars.

## ✅ Implementation Summary

All 12 planned tasks completed successfully:

### ✅ Task 1-3: TypeScript Interfaces
- Complete Phase 2 type definitions in types.ts
- HeatmapConfig, ActivityBarConfig, EventItemConfig interfaces
- Updated ReactScrollableTimelineProps with Phase 2 options

### ✅ Task 4-6: Utility Functions
- Heatmap aggregation with bins and recording bands
- Activity bar virtualization for infinite resolution segments
- Event item point virtualization for performance

### ✅ Task 7-9: Component Implementation
- HeatmapStrip component with binning and recording bands
- ActivityBars component with virtualized lateral bars
- EventItems component with virtualized point markers

### ✅ Task 10-11: Integration
- Full integration into main ReactScrollableTimeline component
- Proper rendering layer order and z-index management
- Export updates for Phase 2 types

### ✅ Task 12: Verification
- TypeScript compilation verified
- All Phase 2 overlay systems implemented
- Ready for integration testing and Phase 3 planning
```

**Step 4: Commit final status update**

```bash
git add docs/plans/2026-03-07-react-scrollable-timeline-phase2-plan.md
git commit -m "docs: mark ReactScrollableTimeline Phase 2 implementation complete

All 12 tasks completed:
- Three overlay systems: heatmap, activity bars, event items
- Virtualization for performance at scale
- Full TypeScript integration with existing Phase 1 component"
```

---

## Next Steps

**Phase 2 is now complete and ready for:**

1. **Integration testing** - Create demo component with sample data
2. **Performance testing** - Test with large datasets (24h+ ranges)
3. **CamStack integration** - Hook into existing Separate NVR/External hub timeline data
4. **Phase 3 planning** - Clusters, infinite scroll, touch enhancements

**Usage Example:**
```typescript
<ReactScrollableTimeline
  // Phase 1 props...
  fullRange={{ start: dayStart, end: dayEnd }}
  visibleSpanMs={2 * 3600_000} // 2 hours
  orientation="vertical"

  // Phase 2: Heatmap strip
  heatmap={{
    binCount: 48,
    data: detectionEvents.map(e => ({ timestamp: e.time, eventType: e.class })),
    recordings: recordingRanges,
  }}

  // Phase 2: Activity bars
  activityBars={[
    {
      id: "motion",
      segments: motionSegments,
      style: { color: "#00FF88", side: "left" },
    },
    {
      id: "audio",
      segments: audioSegments,
      style: { color: "#FF6B6B", side: "right" },
    },
  ]}

  // Phase 2: Event markers
  eventItems={detectionEvents.map(e => ({
    id: e.id,
    timestamp: e.time,
    style: { icon: "camera", color: eventColors[e.class] },
  }))}
/>
```