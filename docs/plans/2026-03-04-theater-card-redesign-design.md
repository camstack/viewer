# Theater Card Redesign — Design Doc

**Date**: 2026-03-04

## Goal

Redesign NeonClusterCard in the Theater timeline to show event thumbnail images, with 3 switchable card variants and improved layout structure.

## Card Variants

### 1. Hero Image + Strip (`hero`, height ~180px)
- Full-width hero thumbnail (16:9, `contentFit="cover"`)
- Bottom strip: neon class icons + time + play button
- If multiple events: mini thumbnail row below hero

### 2. Carousel (`carousel`, height ~160px)
- Horizontal FlatList of event images (aspect ratio preserved)
- Page dots indicator
- Header row: class icons + time
- Uses `pagingEnabled` + `snapToInterval` for clean pagination

### 3. Side Thumbnail (`side`, height ~120px)
- Left: 80×80 square thumbnail with rounded corners
- Right: class labels, time, sequence chips, play button
- Most compact variant

## Dedicated Tick Column

Two-column layout in the ScrollView:
- Left column (~44px): hour marks and NOW/END indicators
- Right column (flex: 1): cluster cards with padding

This ensures hour ticks are always visible and not obscured by cards.

## Enhanced Activity Sidebar

- Width: 18 → 28px
- Recording bars: width 6→10px, color `rgba(255,59,48,0.45)`
- Motion bars: width 5→8px, color `rgba(0,150,255,0.8)`
- Left border separator: 1px `#222`
- Minimum segment height: 4px

## Layout Engine

`computeProportionalLayout` accepts `clusterHeight` parameter:
- hero: 180px
- carousel: 160px
- side: 120px (current ~80px)

## Toggle

Card style toggle button added to `TimelineFabControls` FAB stack. Cycles through hero → carousel → side.

## Files Modified

- `src/components/prototypes/types.ts` — CardStyle type export
- `src/components/prototypes/TimelineContractLayout.ts` — variable clusterHeight
- `src/components/prototypes/NeonClusterCard.tsx` — 3 new card variants
- `src/components/prototypes/TheaterTimeline.tsx` — tick column, sidebar, cardStyle state
- `src/components/prototypes/TimelineFabControls.tsx` — card style toggle
