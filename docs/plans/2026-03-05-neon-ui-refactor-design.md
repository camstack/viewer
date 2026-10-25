# Neon UI Refactor — Full App Design

**Date**: 2026-03-05
**Scope**: Complete app-wide refactor to Neon design system, settings UX redesign, events+videoclips unification

---

## 1. Neon Design System (Foundation Layer)

### 1.1 Design Tokens

Create `src/theme/neon/` as the single source of truth for the entire app's visual language.

**`src/theme/neon/colors.ts`** — Dark-only palette:

```typescript
export const neon = {
  // Backgrounds (darkest → lightest)
  bg:           "#000000",   // Root background
  bgElevated:   "#0A0A0A",   // Elevated surfaces (cards, panels)
  bgSurface:    "#0D0D0D",   // Toolbar backgrounds
  bgInput:      "#111111",   // Input fields, heatmap bars
  bgOverlay:    "rgba(255,255,255,0.04)",  // Card/surface overlay

  // Borders
  borderSubtle: "#1a1a1a",   // Separators, faint dividers
  border:       "#222222",   // Standard borders
  borderStrong: "#333333",   // Emphasized borders, hour lines
  borderInput:  "#48484A",   // Input field borders

  // Text
  textPrimary:    "#FFFFFF",
  textSecondary:  "#888888",
  textTertiary:   "#666666",
  textDisabled:   "#555555",
  textMuted:      "#444444",

  // System accents
  accent:       "#007AFF",   // Primary interactive (iOS blue)
  accentBg:     "rgba(0,122,255,0.15)",  // Accent background
  accentActive: "rgba(0,122,255,0.8)",   // Active state
  danger:       "#FF3B30",   // Destructive actions, alerts
  dangerBg:     "rgba(255,59,48,0.15)",
  success:      "#34C759",   // Success states

  // Event neon colors (per detection class)
  event: {
    person:   "#34C759",
    face:     "#30D158",
    car:      "#FF9500",
    animal:   "#AF52DE",
    audio:    "#FFCC00",
    doorbell: "#FF3B30",
    motion:   "#007AFF",
    package:  "#5856D6",
  },
} as const;

// Helper: neon color with alpha
export const withAlpha = (hex: string, alpha: number) => { /* ... */ };
```

**`src/theme/neon/typography.ts`**:

```typescript
export const type = {
  size: {
    xs:   9,    // Labels, NOW indicator
    sm:   10,   // Hour sub-marks, compact time
    base: 11,   // Compact labels, badges, chips
    md:   12,   // Dates, hour labels, section subtitles
    lg:   13,   // Section headers, hero labels
    xl:   14,   // Body text, form labels
    "2xl": 16,  // Headers, carousel titles
    "3xl": 18,  // Page titles, FAB icons
  },
  weight: {
    regular:  "400" as const,
    medium:   "500" as const,
    semibold: "600" as const,
    bold:     "700" as const,
  },
  tabularNums: { fontVariant: ["tabular-nums"] as const },
} as const;
```

**`src/theme/neon/spacing.ts`**:

```typescript
export const space = {
  "0.5": 2,
  "1":   4,
  "1.5": 6,
  "2":   8,
  "3":   12,
  "4":   16,
  "5":   20,
  "6":   24,
  "8":   32,
} as const;

export const radius = {
  sm:   6,
  md:   8,
  lg:   12,
  xl:   16,
  full: 999,
} as const;
```

**`src/theme/neon/index.ts`** — Barrel export:
```typescript
export { neon, withAlpha } from './colors';
export { type } from './typography';
export { space, radius } from './spacing';
```

### 1.2 Shared Primitive Components

Create `src/components/neon/` with reusable primitives:

#### `NeonCard`
Surface container with consistent dark styling.
- Props: `variant?: "flat" | "elevated" | "outlined"`, `neonColor?: string`, `selected?: boolean`, `children`
- Flat: `bg: neon.bgOverlay`, no border
- Elevated: `bg: neon.bgElevated`, subtle shadow
- Outlined: `bg: transparent`, `border: 1px neon.border`
- Selected: `border: 2px neonColor`

#### `NeonButton`
- Props: `variant: "fab" | "icon" | "chip" | "action" | "primary" | "danger"`, `label?`, `icon?`, `neonColor?`, `active?`, `disabled?`, `onPress`
- Fab: 36x36 circle, bg `rgba(20,20,20,0.85)`, border #333
- Icon: 30x30, transparent bg, icon-only
- Chip: pill shape, neon border when active, label + optional icon
- Action: text + icon row, neon border
- Primary: accent bg, white text, full-width
- Danger: danger bg, white text

#### `NeonInput`
- Props: `label?`, `value`, `onChangeText`, `placeholder?`, `type?: "text" | "number" | "color"`
- Dark input: bg #111, border #333, white text, placeholder #555
- Color variant: includes preview swatch

#### `NeonSwitch`
- Props: `label`, `value`, `onValueChange`, `description?`
- Row layout: label (left) + switch (right)
- Optional description text below label
- Track color: accent blue when on

#### `NeonSection`
- Props: `title`, `children`, `collapsible?: boolean`, `defaultOpen?: boolean`
- Collapsible accordion with animated chevron
- Title: xs uppercase, textSecondary, semibold, letterSpacing 1
- Content: padded children with borderTop separator
- Maintains open/closed state

#### `NeonChip` (multi-select)
- Props: `label`, `icon?`, `neonColor`, `selected`, `onPress`
- Pill: border neonColor, bg transparent (neonColor+20 when selected)
- Icon + label, 11px medium

#### `NeonModal`
- Props: `visible`, `onClose`, `title?`, `snapPoints?: number[]`, `children`
- Bottom sheet style: slide up, handle bar at top
- Dark bg: #0A0A0A, borderTopRadius 16
- Backdrop: rgba(0,0,0,0.6)
- Snap points for multi-height (50%, 85%)

#### `NeonSelect`
- Props: `label`, `options: {value, label, icon?}[]`, `value`, `onChange`
- Dropdown or horizontal chip row depending on option count
- <=4 options: inline chip row (like mode toggle in TheaterTimeline)
- >4 options: dropdown with NeonModal

#### `NeonTabBar`
- Props: `tabs: {key, label, icon?}[]`, `activeTab`, `onTabChange`
- Horizontal scrollable tab bar
- Active: accent bg pill, white text
- Inactive: transparent, textSecondary

---

## 2. Settings Redesign

### 2.1 Settings Hub (Root)

Replace the current tab-based layout with a **card grid hub**.

```
┌─────────────────────────────────────────┐
│  Settings                               │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ paintbrush   │  │ wifi         │     │
│  │ Aspetto      │  │ Integrazioni │     │
│  │ Tema, lingua │  │ Separate NVR,     │     │
│  │ highlights   │  │ External hub     │     │
│  └──────────────┘  └──────────────┘     │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ videocam     │  │ construct    │     │
│  │ Telecamere   │  │ Avanzato     │     │
│  │ Ordine,      │  │ Log, export  │     │
│  │ grid layout  │  │ cache, info  │     │
│  └──────────────┘  └──────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

Each card is a `NeonCard variant="elevated"` with:
- Icon (Ionicons, 24px, accent color)
- Title (lg, semibold, white)
- Description (sm, textSecondary)
- Tap → navigates to sub-page

### 2.2 Settings Sub-Pages

Each sub-page uses `NeonSection collapsible` for grouping. Only the active section is expanded, others collapse automatically (optional).

**Aspetto (Appearance)**:
- Section: Lingua → NeonSelect inline (IT/EN)
- Section: Timeline → NeonSelect inline (Classic/Theater)
- Section: Highlight Motion → NeonSwitch + NeonInput color + slider thickness
- Section: Highlight Audio → same
- Section: Highlight Detection → same

**Integrazioni**:
- Keep current IntegrationInstanceCard but restyle with NeonCard
- Add integration button → NeonModal bottom sheet

**Telecamere**:
- Camera list with NeonCard per camera (icon + name + source badge)
- Tap → camera settings sub-page with NeonSection groups
- Drag-to-reorder with grip handle
- Grid layout controls (columns, card style)

**Avanzato**:
- Section: Dati → Export/Import buttons (NeonButton action)
- Section: Cache → Clear cache button with confirmation
- Section: Log → inline log viewer (keep FlatList, restyle)
- Section: Info → Version, build, runtime info

### 2.3 Camera Settings — Contextual Bottom Sheet

**Key improvement**: Camera settings accessible directly from camera/grid view via a gear icon that opens a `NeonModal` bottom sheet.

The bottom sheet has a **horizontal NeonTabBar** at top with tabs:

| Tab | Contents |
|-----|----------|
| **Highlight** | Motion (toggle + color + thickness), Audio (mode select + presets/custom), Detection (classes + hold time) |
| **Timeline** | Data source select, severity filter, custom classes |
| **Status** | Position grid (3x3), indicator toggles (13 types) |
| **Sensors** | Position grid (3x3), sensor toggles |
| **Devices** | Associated devices list + link button |
| **Source** | Separate NVR-specific: stream source, mapping, config viewer |

Each tab content is a single-scroll area with `NeonSection` groups. This replaces the 700-line monolithic form.

**Same component** renders both:
- As bottom sheet (from camera/grid view)
- As full page (from settings hub > telecamere > [camera])

The `variant` prop is removed — styling is always Neon dark.

### 2.4 Position Selector Redesign

Replace the 9-arrow grid with a visual preview:

```
┌──────────────────────┐
│ ●                    │   ← dot shows current position
│                      │
│                      │
│                      │
│              ●       │   ← tap anywhere to set position
└──────────────────────┘
```

A 3x3 invisible grid with visual dot indicator. Tap a zone → position updates. More intuitive than arrow icons.

---

## 3. Unified Events + Videoclips View

### 3.1 Architecture

Merge the two tabs into a single **"Events"** tab. Remove the "Videoclips" tab from navigation.

**Bottom nav changes**: `Cameras | Grids | Events | Settings` (4 tabs instead of 5)

### 3.2 Data Layer

**Unified query hook: `useUnifiedEvents`**

```typescript
interface UnifiedEventGroup {
  // Existing DetectionGroup fields
  events: DetectionEvent[];
  representative: DetectionEvent;
  classes: string[];
  labels: string[];
  // NEW: linked videoclips
  linkedClips: VideoClip[];       // Clips overlapping this group's timerange
  hasClip: boolean;               // Quick check flag
}
```

**Fetching strategy** (performance-first):
1. Fetch events as today (existing `useInfiniteQuery`)
2. Fetch videoclips for same day in **parallel** (existing query)
3. **Client-side link**: For each event group, find clips where:
   ```
   clip.startTime <= group.lastEvent.timestamp + 30s
   AND clip.startTime + clip.duration >= group.firstEvent.timestamp - 30s
   AND clip.deviceId matches any event.deviceId
   ```
4. This linking runs on the already-fetched data — no extra API calls
5. Cache the linked result with React Query

**Why not server-side join**: Separate NVR and External hub have separate APIs for events vs recordings. Client-side join is the only option without a custom backend.

### 3.3 UI Design

**Event card with clip indicator**:

```
┌────────────────────────────────────┐
│ [thumbnail]                        │
│                                    │
│  🟢 Person · Front Door            │
│  14:35 · 3 events                  │
│                         ▶ 0:12     │  ← clip badge (blue pill)
└────────────────────────────────────┘
```

- Card: `NeonCard` with event neon color left accent
- Thumbnail: event snapshot (existing)
- Bottom row: detection info + camera name
- Clip badge: appears only when `hasClip === true`
  - Shows clip duration
  - Blue pill with play icon
  - Tap → opens clip player (reuses existing `VideoclipDetailModal` restyled as NeonModal)

**No clip available**: no badge, card looks like current event card.

**Filters**: Merge EventsFiltersToolbar + VideoclipFiltersToolbar into one:
- Date navigation
- Detection classes (multi-chip)
- Camera filter
- Source filter
- Grouping range
- Columns
- **NEW**: Toggle "Solo con clip" — filters to only show events with linked clips

### 3.4 Detail Modal

When tapping an event card, the modal shows:

```
┌─────────────────────────────────┐
│  ═══  Event Detail              │
├─────────────────────────────────┤
│  [Image carousel]               │   ← clean snapshot, snapshot, GIF
│  ─────────────────────────────  │
│  🟢 Person detected             │
│  Front Door · Separate NVR            │
│  14:35:22 — 14:35:34            │
│  ─────────────────────────────  │
│  📹 Related Clip                 │   ← only if hasClip
│  ┌─────────────────────────────┐│
│  │ [video player inline]       ││   ← tap to play, uses shared RTC
│  │         ▶ 0:12              ││
│  └─────────────────────────────┘│
│  ─────────────────────────────  │
│  [← prev] Group 2/5 [next →]   │   ← browse group events
└─────────────────────────────────┘
```

The clip player is embedded inline in the detail modal — no need to navigate to a separate page.

---

## 4. Full App Reskin

### 4.1 Navigation

**BottomNav** — Restyle to neon:
- Background: #000 (pure black)
- Border top: 1px #1a1a1a
- Icons: textSecondary (#888) inactive, accent (#007AFF) active
- Labels: xs, textSecondary inactive, accent active
- 4 tabs: Cameras, Grids, Events, Settings
- Active indicator: subtle accent glow under icon

**SideNav** (web) — Same treatment:
- Background: #0A0A0A
- Border right: 1px #1a1a1a
- Same icon/label coloring

**AppHeader** — Simplify:
- Background: transparent (blends with #000 page bg)
- Title: 3xl, bold, white
- No border bottom (cleaner look)
- Back button: icon-only, accent color

### 4.2 Cameras Grid

- Page background: #000
- Camera cards: `NeonCard variant="elevated"`
  - Snapshot with rounded corners (radius.lg)
  - Name overlay: bottom gradient + white text
  - Status indicators: neon-colored pills (reuse DeviceStatusPills, restyle)
- EventsReel: restyle with neon tokens (dark bg, accent highlights)
- FAB: use NeonButton fab variant
- Empty states: neon.textSecondary, centered icon + text

### 4.3 Camera Detail

Already mostly dark (#000 background). Changes:
- Toolbar/controls: use neon tokens instead of hardcoded colors
- Drawer: use neon.bgElevated instead of hardcoded rgba
- Timeline: already NeonTimeline styled (no changes needed)
- Settings gear icon: opens NeonModal camera settings bottom sheet

### 4.4 Grid View

Already dark. Changes:
- Controls overlay: use NeonButton variants
- Quality dropdown: use NeonSelect
- Consistent with neon tokens

### 4.5 Events Page (Unified)

- Page background: #000
- Filter toolbar: neon chips + neon select
- Event cards: NeonCard with neon accent per detection class
- Clip badges: accent blue pill
- Time headers: neon.textSecondary, sm, semibold

### 4.6 Modals & Overlays

All modals migrate to NeonModal:
- ReelDetailModal → NeonModal with image carousel
- VideoclipDetailModal → NeonModal with inline player
- AddIntegrationModal → NeonModal with form
- CameraAssociatedDevicesModal → NeonModal with device list
- CameraSelectionModal → NeonModal with searchable list

---

## 5. Migration Strategy

### Phase 1: Foundation (No visual changes yet)
1. Create `src/theme/neon/` with all tokens
2. Create `src/components/neon/` with all primitives
3. Keep existing `colors.ts` and `useThemeColors()` working

### Phase 2: Settings Redesign
4. Rebuild settings hub with NeonCard grid
5. Rebuild settings sub-pages with NeonSection
6. Rebuild CameraSettingsForm with NeonTabBar + NeonSection
7. Add NeonModal bottom sheet for camera settings from detail/grid view

### Phase 3: Events + Videoclips Unification
8. Create `useUnifiedEvents` hook with client-side clip linking
9. Build unified event card with clip badge
10. Merge filter toolbars
11. Build unified detail modal with inline clip player
12. Remove videoclips tab from navigation

### Phase 4: Full App Reskin
13. Restyle BottomNav + SideNav + AppHeader
14. Restyle cameras grid (cards, FAB, empty states)
15. Restyle camera detail (toolbar, drawer, controls)
16. Restyle grid view (controls, dropdown)
17. Restyle all remaining modals

### Phase 5: Cleanup
18. Remove old `colors.ts` light/dark system
19. Remove `useThemeColors()` hook (replace all usages with neon tokens)
20. Remove ThemeProvider component
21. Remove theme mode setting from general settings
22. Delete unused style constants and components

---

## 6. Files Impacted

### New Files
- `src/theme/neon/colors.ts`
- `src/theme/neon/typography.ts`
- `src/theme/neon/spacing.ts`
- `src/theme/neon/index.ts`
- `src/components/neon/NeonCard.tsx`
- `src/components/neon/NeonButton.tsx`
- `src/components/neon/NeonInput.tsx`
- `src/components/neon/NeonSwitch.tsx`
- `src/components/neon/NeonSection.tsx`
- `src/components/neon/NeonChip.tsx`
- `src/components/neon/NeonModal.tsx`
- `src/components/neon/NeonSelect.tsx`
- `src/components/neon/NeonTabBar.tsx`
- `src/components/neon/index.ts`
- `src/hooks/use-unified-events.ts`

### Modified Files
- `app/(tabs)/_layout.tsx` — Remove videoclips tab, update styling
- `app/(tabs)/settings/_layout.tsx` — Hub layout
- `app/(tabs)/settings/index.tsx` — Hub card grid
- `app/(tabs)/settings/general.tsx` → `appearance.tsx` — NeonSection refactor
- `app/(tabs)/settings/stream.tsx` → `cameras.tsx` — NeonSection refactor
- `app/(tabs)/settings/integrations.tsx` — NeonCard restyle
- `app/(tabs)/settings/logs.tsx` → rolled into `advanced.tsx`
- `app/(tabs)/settings/cameras/[id].tsx` — Use refactored CameraSettingsForm
- `app/(tabs)/events.tsx` — Unified events + clips
- `src/components/BottomNav.tsx` — Neon restyle
- `src/components/SideNav.tsx` — Neon restyle
- `src/components/AppHeader.tsx` — Neon restyle
- `src/components/CameraSettingsForm.tsx` — Full rewrite with NeonTabBar
- `src/components/NvrCameraSettings.tsx` — NeonSection restyle
- `src/components/CameraCard.tsx` — NeonCard restyle
- `src/components/EventsGroupElement.tsx` — NeonCard + clip badge
- `src/components/EventsFiltersToolbar.tsx` — Neon chips
- `src/components/IntegrationInstanceCard.tsx` — NeonCard restyle
- `src/components/SettingsTabs.tsx` — Remove (replaced by hub)
- `src/components/DeviceStatusPills.tsx` — Neon colors
- `src/store/eventsStore.ts` — Add clip filter state
- `app.config.ts` — Force dark mode (`userInterfaceStyle: "dark"`)

### Deleted Files
- `app/(tabs)/videoclips.tsx`
- `src/components/VideoclipFiltersToolbar.tsx`
- `src/components/VideoclipsListSection.tsx` (functionality merged into events)
- `src/theme/colors.ts` (replaced by neon/)
- `src/components/ThemeProvider.tsx`
- `src/components/SettingsTabs.tsx`

---

## 7. Performance Considerations

- **Event-clip linking**: Client-side join on already-fetched data, O(n*m) but both sets are small per day (~100-500 events, ~50-200 clips). Memoized with `useMemo`.
- **Clip metadata only**: No video preloading. Clip player loads on demand when badge tapped.
- **NeonSection collapsible**: Unmounts children when collapsed (optional, for heavy sections).
- **FlashList**: Continue using FlashList for events list (virtualized).
- **Bottom sheet**: Native Modal with Animated API, no heavy library dependency.
- **Token imports**: Tree-shakeable const exports, zero runtime overhead.
