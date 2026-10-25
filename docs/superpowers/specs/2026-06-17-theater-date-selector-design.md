# Theater Date Selector — Design

**Date:** 2026-06-17
**Repos:** `camstack-viewer` (primary), `camstack-server` (one new cap method)
**Branch:** `feat/recorded-webrtc-timeline` (continues the recorded-over-WebRTC work)
**Status:** Approved design — ready for implementation plan

## Goal

Let the user pick a different day for recorded playback on the theater timeline,
landing at the **same time-of-day** as the current playhead. The date picker must
**mark which calendar days have recordings**. This is cycle 1 of two; cycle 2
(events/clips on the timeline) is a separate spec.

## Decisions (locked)

- **Calendar UI:** custom monthly grid modal. Every day is selectable; days with
  footage show a dot. Days without footage are still tappable and land on the
  existing "No footage" placeholder. Month navigation (‹ ›).
- **Quick day nav:** symmetric `‹ ›` arrows in the toolbar, each jumping ±1 day at
  the **same time-of-day**. `›` (next) disabled when already on today. `‹` (prev)
  uses a **soft** back-bound (no hard disable; empty days show the placeholder).
- **Backend data source:** new cap method `recording.getDaysWithRecordings`
  (requires `codegen` + addon redeploy). Returns **local-midnight epochs**, not
  date strings, to avoid timezone mismatch with the viewer's day boundaries.

## Architecture

Five units, each independently testable:

1. **Backend cap method** (`recording.getDaysWithRecordings`)
2. **Viewer data hook** (`useDaysWithRecordings`)
3. **Calendar grid helper** (pure) + **`DatePickerModal`** (UI)
4. **Day-nav helpers** (pure: `dayAtSameTime`, `dateLabel`)
5. **Timeline/toolbar wiring** (handlers → existing scrub-seek path)

### 1. Backend — `recording.getDaysWithRecordings`

- **`packages/types/src/capabilities/recording.cap.ts`** — new method:
  - input: `{ deviceId: number, fromMs: number, toMs: number, tzOffsetMinutes: number }`
  - output: `{ deviceId: number, days: number[] }` where each entry is the
    **epoch of the local midnight** of a day that contains ≥1 segment.
- **`packages/addon-pipeline/src/recorder/addon/recording-provider.ts`** —
  single pass over `index.segments(deviceId)`: for each segment whose `startMs`
  falls in `[fromMs, toMs)`, compute its local-midnight epoch using
  `tzOffsetMinutes`, collect into a `Set<number>`, return sorted ascending.
  No disk I/O (reuses the in-memory `RecordingIndex`).
- Local-midnight computation: `localMidnight(ms, offMin) = ms - ((ms + offMin*60000) mod DAY_MS)` adjusted back to UTC epoch of that local day's start.
  (Implement as a small pure helper with its own test.)
- Mount one line in `server/backend/src/api/trpc/trpc.router.ts`; run
  `npm run codegen`; add a cap-router spec.

**Why epoch-midnight, not 'YYYY-MM-DD':** the viewer compares directly against the
epoch it already computes per calendar cell (same local-time math as the existing
`dayWindow`), so markers line up exactly — even on remote access from another
timezone. `tzOffsetMinutes` is sent by the client.

### 2. Viewer — `useDaysWithRecordings`

- New file **`srcV2/data/use-recording-days.ts`**:
  `useDaysWithRecordings(deviceId, monthFromMs, monthToMs)` → `Set<number>`.
- React Query, key `['v2','recording-days', deviceId, monthFromMs]`,
  `enabled: state === 'connected'`. Sends
  `tzOffsetMinutes: -new Date().getTimezoneOffset()`. On error → empty `Set`
  (calendar still renders, just without dots; never crashes).

### 3. Calendar grid helper + `DatePickerModal`

- **`srcV2/components/camera/theater/calendar-grid.ts`** (pure, no React):
  - `monthBounds(year, month)` → `{ fromMs, toMs }` (local).
  - `buildMonthGrid(year, month)` → 6×7 cells `{ epoch, inMonth, isFuture }`,
    week starting Monday.
- **`srcV2/components/camera/theater/DatePickerModal.tsx`**:
  - Props: `visible`, `monthAnchorMs`, `selectedDayMs`, `daysSet: Set<number>`,
    `onChangeMonth(deltaMonths)`, `onPick(dayEpoch)`, `onClose`.
  - Renders the month header with `‹ ›`, a 7×6 grid; each cell shows the day
    number + a dot when `daysSet.has(cell.epoch)`; future cells disabled; today
    highlighted; the selected day marked. Tap → `onPick(cell.epoch)` then close.
  - Theme-driven colors, consistent with `TimelineToolbarInline`/heatmap.

### 4. Day-nav helpers (pure)

- **`srcV2/recording/day-nav.ts`** (or extend `playback-status.ts`):
  - `dayAtSameTime(currentEpoch, targetDayMidnightEpoch)` → sets the target day's
    H:M:S:ms to the current playhead's H:M:S:ms. If the result is in the future
    (today, time-of-day not yet reached) → clamp to `Date.now()`.
  - `dateLabel(dayFromMs, nowMs, t)` → "Oggi" / "Ieri" / "Mar 17 Giu".

### 5. Timeline / toolbar wiring

- **`TimelineToolbarInline.tsx`**: add props `onNextDay?`, `nextDayDisabled?`;
  add the `›` arrow (the `‹` arrow + date pill already exist). Date pill text
  comes from the dynamic `dateLabel`.
- **`TheaterTimeline.tsx`**: replace the `noop`s.
  - `onPrevDay` → `onSeekToTime(dayAtSameTime(viewedEpoch, dayFrom - DAY_MS))`.
  - `onNextDay` → same with `dayFrom + DAY_MS`; disabled when `dayFrom === todayStart`.
  - `onOpenDatePicker` → opens `DatePickerModal` (local modal state); on pick →
    `onSeekToTime(dayAtSameTime(viewedEpoch, pickedDayEpoch))`.
  - Wire `useDaysWithRecordings` for the modal's currently-anchored month.
  - Pass the dynamic `dateLabel` to the toolbar.
- The seek reuses the **existing** scrub path (`onSeekToTime` → `scrub.seek`):
  `playheadEpoch` updates → `dayWindow` re-derives → heatmap + `useEvents`
  re-window automatically. The screen sets `playbackMode='recorded'`.
- New i18n keys in `locales/{en,it}.json` (today/yesterday/month-day label,
  date-picker title).

## Edge cases

- Selected day has no footage at the requested time → existing "No footage"
  placeholder. No new work.
- Same-time-of-day in the future on "today" → clamp to `Date.now()`.
- Month change in the calendar → new `useDaysWithRecordings` fetch (per-month cache).
- Timezone: `tzOffsetMinutes` keeps backend day-buckets aligned with the calendar
  cells and the viewer's `dayWindow`.
- Back-bound: **soft** — `‹` is never hard-disabled (the global min-footage day is
  not cheaply available); empty earlier days simply show the placeholder.

## Testing

- **Server:** spec for `getDaysWithRecordings` — segments across multiple days /
  a timezone offset → correct day epochs; partial range; empty device. Plus a
  unit test for the `localMidnight` helper.
- **Viewer:** unit tests for `calendar-grid.ts` (month grid, future flags, week
  boundaries), `dayAtSameTime` (incl. future-clamp), `dateLabel` (Oggi/Ieri/date).
  `DatePickerModal` render test with a mock `daysSet` (dots on the right cells).

## Out of scope (cycle 2)

Events/clips rendered on the vertical timeline: V1 grouping port
(`clusterEventsInRangeFixedGrid`, 5-min buckets), `layoutClustersVertical`
no-overlap, the multi-image scrollable carousel, and an "important events" filter.
Captured separately; this spec does not implement it.
