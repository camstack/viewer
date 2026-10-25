# ReactScrollableTimeline — Design Document

**Date:** 2026-03-07
**Status:** ✅ Phase 1 Complete | 🎯 Phase 2 Designed — Activity Bars & Event Items architecture

## Goal

A fully **agnostic**, reusable scrollable timeline component with no domain-specific concepts (no cameras, motion, recording, detection). Configurable for any use case.

## ✅ What's Been Implemented (Phase 1)

### Core Features
- **✅ Dual orientation**: Vertical and horizontal timeline support
- **✅ Scroll ↔ time conversion**: Linear, continuous mapping with proportional content sizing
- **✅ Virtualized tick rendering**: Only viewport ± buffer ticks rendered for performance
- **✅ Zoom controls**: Configurable min/max range with built-in UI controls (+/- buttons)
- **✅ Fixed cursor**: Static cursor line at configurable viewport position
- **✅ Draggable cursor**: Interactive handle with pan gestures
- **✅ Children overlay**: Positioned container for custom content layers
- **✅ TypeScript**: Full type safety with comprehensive interfaces
- **✅ Performance optimized**: Refs for high-frequency state, throttled updates

### Technical Architecture
- **ScrollView with proportional content**: `contentSize = (fullSpan / visibleSpan) × viewportSize`
- **Manual tick virtualization**: Only ticks in viewport ± 400px buffer rendered
- **Gesture integration**: Uses `react-native-gesture-handler` for smooth dragging
- **Proven math**: Based on existing Classic DetectionTimelineV2 implementation

### Files Created
```
src/components/ReactScrollableTimeline/
  ├── ReactScrollableTimeline.tsx  ✅ Main component (~900 LOC)
  ├── types.ts                     ✅ TypeScript interfaces
  └── index.ts                     ✅ Module exports
```

## Approach

**ScrollView with proportional content + manual tick virtualization** (Approach C).

- `contentSize = (fullSpan / visibleSpan) × viewportSize` — linear, continuous time↔pixel mapping
- Every pixel corresponds to a fixed amount of time: `msPerPx = fullSpanMs / contentSize`
- Ticks are manually virtualized: only those in viewport ± buffer are rendered
- No caps, no compression, no jumps

## Coordinate System

```
Vertical:   scrollY=0 → newest (top),    scrollY=max → oldest (bottom)
Horizontal: scrollX=0 → oldest (left),   scrollX=max → newest (right)
```

## Props (Phase 1)

```typescript
interface ReactScrollableTimelineProps {
  /** Full scrollable range */
  fullRange: { start: number; end: number };

  /** Current visible time window (determines tick density + content size) */
  visibleSpanMs: number;

  /** Orientation */
  orientation: "vertical" | "horizontal";

  /** Tick configuration */
  ticks?: {
    /** Available intervals in ms (e.g. [5min, 10min, 15min, 30min, 1h]) */
    intervals: number[];
    /** Minimum pixels between two ticks. Default 60 */
    minSpacingPx?: number;
    /** Custom tick label renderer. Default: "HH:mm" */
    renderLabel?: (epochMs: number) => string;
    /** Tick style */
    style?: { color?: string; fontSize?: number };
  };

  /** Zoom configuration */
  zoom?: {
    /** Min/max range for visibleSpanMs */
    min: number;
    max: number;
    /** Multiplicative factor per step. Default 1.5 */
    factor?: number;
    /** Callback when zoom changes */
    onZoomChange?: (newSpanMs: number) => void;
    /** Show built-in zoom controls. Default true */
    showControls?: boolean;
  };

  /** Scrub cursor */
  cursor?: {
    /** "fixed" = fixed position, scroll moves time under cursor.
     *  "draggable" = draggable handle along timeline */
    mode: "fixed" | "draggable";
    /** Cursor position as fraction (0-1). Default 0.2 */
    position?: number;
    /** Custom cursor renderer */
    renderCursor?: (epochMs: number) => React.ReactNode;
    /** Cursor line color */
    color?: string;
  };

  /** Scrub callbacks */
  onScrubTimeChange?: (epochMs: number) => void;
  onScrubEnd?: (epochMs: number) => void;

  /** Visible range change callback */
  onVisibleRangeChange?: (range: { start: number; end: number }) => void;

  /** Programmatic scroll to a specific time */
  scrollToTime?: number;

  /** Children rendered as overlay layers on the scrollable content */
  children?: React.ReactNode;

  /** Fixed dimensions (desktop). If omitted, uses onLayout */
  width?: number;
  height?: number;
}
```

## Tick Virtualization

Only ticks within `viewport ± bufferPx` are rendered:

```
viewportStartPx = scrollOffset - bufferPx
viewportEndPx   = scrollOffset + viewportSize + bufferPx

Chosen interval = first from ticks.intervals where pxPerInterval >= minSpacingPx
firstTick = ceil(timeAtViewportStart / interval) * interval
lastTick  = floor(timeAtViewportEnd / interval) * interval
→ render only [firstTick..lastTick]
```

Buffer default: 400px (same as Classic).

## Zoom

Internal state for `visibleSpanMs`. Zoom in/out applies `factor` (default 1.5x) clamped to `[min, max]`. Optional built-in controls (+/- with duration label). `onZoomChange` notifies parent.

## File Structure

```
src/components/ReactScrollableTimeline/
  ReactScrollableTimeline.tsx   — main component (ScrollView + tick layer + cursor)
  types.ts                      — interfaces and types
  index.ts                      — re-exports
```

## Future Phases

### 🎯 Phase 2: Activity Bars & Event Items (DESIGNED)

**Two separate overlay systems:**

#### 1. Heatmap Strip System
Aggregated activity density strip (Theater-inspired):
```typescript
interface HeatmapConfig {
  binCount: number;              // Number of bins (e.g. 48 for 24h)
  data: HeatmapDataPoint[];      // Events to aggregate
  recordings?: TimeRange[];      // Recording bands (pixel-accurate)
  style?: {
    height?: number;             // Strip height (default: 32px)
    position?: "top" | "bottom"; // Position in timeline
  };
  onBinTap?: (fraction: number) => void; // Bin tap callback
}
```

#### 2. Activity Bars System
Infinite resolution lateral bars (Classic-inspired):
```typescript
interface ActivityBarConfig {
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

#### 3. Event Items System
Point-in-time markers:
```typescript
interface EventItemConfig {
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

**Rendering Strategy:**
- Heatmap: Pre-aggregation in bins, fixed strip
- Activity bars: Virtualized segments with infinite pixel resolution
- Event items: Point virtualization for large datasets
- All systems use existing time↔pixel conversion math

### Phase 3: Advanced Features
- **Clusters**: Grouping logic with configurable bucket size for dense data
- **Infinite scroll**: Load-more on scroll boundaries for large datasets
- **Touch enhancements**: Pinch-to-zoom, momentum scrolling tuning

### Phase 4: CamStack Integration
- **Replace DetectionTimelineV2**: Migrate existing Separate NVR timeline to use ReactScrollableTimeline
- **Multi-camera support**: Extend for grid timeline view
- **Real-time updates**: Live timeline updates for ongoing recordings and detections

## Next Immediate Tasks

1. **Phase 2 Implementation** — Activity bars, heatmap strip, and event items
2. **Create example/demo component** to test all Phase 1+2 features
3. **Performance testing** with large datasets (24+ hour ranges)
4. **Integration planning** with existing CamStack timeline features
