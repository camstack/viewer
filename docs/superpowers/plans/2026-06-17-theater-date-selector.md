# Theater Date Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a date selector to the theater timeline — a custom month-calendar modal that dots days with recordings, plus symmetric ‹ › day-nav arrows that jump ±1 day at the same time-of-day.

**Architecture:** A new backend cap method `recording.getDaysWithRecordings` returns the local-midnight epochs of days that have footage (single pass over the in-memory `RecordingIndex`). The viewer fetches it per visible month, renders a controlled `DatePickerModal`, and on pick/arrow computes a "same time-of-day, different day" epoch and routes it through the EXISTING `onSeekToTime` path (which already enters recorded playback and re-windows the heatmap + events).

**Tech Stack:** TypeScript, Zod, tRPC v11 (server cap); React Native, TanStack Query, vitest (viewer). Viewer vitest env is `node` — no component render tests; all testable logic lives in pure helpers.

**Two repos:**
- Server: `/Users/alice/Documents/Git/camstack/camstack-server` (branch `feat/recorded-webrtc-timeline`)
- Viewer: `/Users/alice/Documents/Git/camstack/camstack-viewer` (branch `feat/recorded-webrtc-timeline`)

**Spec:** `camstack-viewer/docs/superpowers/specs/2026-06-17-theater-date-selector-design.md`

---

## File Structure

**Server (`camstack-server`):**
- Create: `packages/addon-pipeline/src/recorder/day-bucket.ts` — pure day-bucketing helpers (`localMidnightEpoch`, `distinctRecordingDays`)
- Create: `packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts`
- Modify: `packages/types/src/capabilities/recording.cap.ts` — add `RecordingDaysSchema` + `getDaysWithRecordings` method
- Modify: `packages/addon-pipeline/src/recorder/addon/recording-provider.ts` — implement `getDaysWithRecordings`
- Modify: `packages/addon-pipeline/src/recorder/addon/__tests__/recording-provider.spec.ts` — provider tests
- Generated (do not hand-edit): codegen outputs after `npm run codegen`

**Viewer (`camstack-viewer`):**
- Create: `srcV2/components/camera/theater/calendar-grid.ts` — pure month-grid helpers
- Create: `srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts`
- Create: `srcV2/recording/day-nav.ts` — `dayAtSameTime`, `dateLabel`
- Create: `srcV2/recording/__tests__/day-nav.spec.ts`
- Create: `srcV2/components/camera/theater/DatePickerModal.tsx` — controlled calendar modal (presentational)
- Modify: `srcV2/data/use-recording.ts` — add `useDaysWithRecordings`
- Modify: `srcV2/components/camera/theater/TimelineToolbarInline.tsx` — add next-day arrow
- Modify: `srcV2/components/camera/theater/TheaterTimeline.tsx` — wire handlers + modal
- Modify: `locales/en.json`, `locales/it.json` — date-picker i18n keys

---

## Task 1: Backend — pure day-bucketing helpers

**Files:**
- Create: `packages/addon-pipeline/src/recorder/day-bucket.ts`
- Test: `packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { localMidnightEpoch, distinctRecordingDays } from '../day-bucket.js'

describe('localMidnightEpoch', () => {
  it('returns UTC midnight for tz offset 0', () => {
    const ms = Date.UTC(2026, 5, 15, 8, 30, 0) // 2026-06-15T08:30:00Z
    expect(localMidnightEpoch(ms, 0)).toBe(Date.UTC(2026, 5, 15, 0, 0, 0))
  })

  it('buckets by LOCAL day for a +120min (CEST) offset', () => {
    // 2026-06-14T23:30:00Z is 01:30 local (+120) on the 15th → local midnight
    // is 2026-06-15T00:00 local = 2026-06-14T22:00:00Z.
    const ms = Date.UTC(2026, 5, 14, 23, 30, 0)
    expect(localMidnightEpoch(ms, 120)).toBe(Date.UTC(2026, 5, 14, 22, 0, 0))
  })
})

describe('distinctRecordingDays', () => {
  it('returns sorted distinct local-day epochs, dropping out-of-range starts', () => {
    const from = Date.UTC(2026, 5, 1, 0, 0, 0)
    const to = Date.UTC(2026, 5, 30, 0, 0, 0)
    const starts = [
      Date.UTC(2026, 5, 15, 8, 0, 0), // day 15
      Date.UTC(2026, 5, 15, 20, 0, 0), // day 15 (dup)
      Date.UTC(2026, 5, 16, 1, 0, 0), // day 16
      Date.UTC(2026, 4, 31, 12, 0, 0), // before range → dropped
    ]
    expect(distinctRecordingDays(starts, from, to, 0)).toEqual([
      Date.UTC(2026, 5, 15, 0, 0, 0),
      Date.UTC(2026, 5, 16, 0, 0, 0),
    ])
  })

  it('returns [] when no starts fall in range', () => {
    expect(distinctRecordingDays([1, 2, 3], 100, 200, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npx vitest run packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts`
Expected: FAIL — `Cannot find module '../day-bucket.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/addon-pipeline/src/recorder/day-bucket.ts`:

```ts
/** Pure helpers to bucket recording segment starts into local calendar days. */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Epoch (UTC ms) of the local midnight that starts the day containing `ms`.
 * `tzOffsetMinutes` is minutes to ADD to UTC to get local time — i.e. the client
 * sends `-new Date().getTimezoneOffset()`. Returning a UTC epoch (not a date
 * string) lets the viewer compare directly against the epoch it computes per
 * calendar cell, so markers line up regardless of timezone.
 */
export function localMidnightEpoch(ms: number, tzOffsetMinutes: number): number {
  const off = tzOffsetMinutes * 60_000
  const local = ms + off
  const intoDay = ((local % DAY_MS) + DAY_MS) % DAY_MS
  return local - intoDay - off
}

/**
 * Sorted, distinct local-midnight epochs for every segment start in [fromMs, toMs).
 */
export function distinctRecordingDays(
  startsMs: readonly number[],
  fromMs: number,
  toMs: number,
  tzOffsetMinutes: number,
): number[] {
  const days = new Set<number>()
  for (const s of startsMs) {
    if (s < fromMs || s >= toMs) continue
    days.add(localMidnightEpoch(s, tzOffsetMinutes))
  }
  return [...days].sort((a, b) => a - b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npx vitest run packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-server
git add packages/addon-pipeline/src/recorder/day-bucket.ts packages/addon-pipeline/src/recorder/__tests__/day-bucket.spec.ts
git commit -m "feat(recorder): pure day-bucketing helpers for date-selector"
```

---

## Task 2: Backend — cap method definition + codegen

**Files:**
- Modify: `packages/types/src/capabilities/recording.cap.ts`

- [ ] **Step 1: Add the output schema**

In `recording.cap.ts`, after the `RecordingAvailabilitySchema` block (after line 23), add:

```ts
export const RecordingDaysSchema = z.object({
  deviceId: z.number(),
  /** Local-midnight epochs (UTC ms) of days that have ≥1 recorded segment. */
  days: z.array(z.number()),
})
export type RecordingDays = z.infer<typeof RecordingDaysSchema>
```

- [ ] **Step 2: Add the method to the cap**

In the `methods:` object, immediately after the `getAvailability` method (after line 104), add:

```ts
    /** Which calendar days in [fromMs,toMs) have ≥1 recorded segment, bucketed by
     *  the client's local day (`tzOffsetMinutes` = minutes to add to UTC). Drives
     *  the theater date-picker's day dots. */
    getDaysWithRecordings: method(
      z.object({ deviceId: z.number(), fromMs: z.number(), toMs: z.number(), tzOffsetMinutes: z.number() }),
      RecordingDaysSchema,
      { kind: 'query', auth: 'admin' },
    ),
```

- [ ] **Step 3: Run codegen**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npm run codegen`
Expected: completes without error; regenerates cap routers + status types. (The `recording` router is already mounted in `trpc.router.ts`, so the new method appears automatically — no new mount line.)

- [ ] **Step 4: Verify types package compiles**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npx tsc --noEmit -p packages/types/tsconfig.json`
Expected: PASS. (Note: the addon-pipeline typecheck will now FAIL until Task 3 implements the method — that's expected and resolved next.)

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-server
git add packages/types/src/capabilities/recording.cap.ts server/backend/src/api/trpc/generated-cap-routers.ts packages/types/src/generated/
git commit -m "feat(recording): add getDaysWithRecordings cap method + codegen"
```

(If `git status` shows other regenerated files, add them too — codegen output belongs in the commit.)

---

## Task 3: Backend — provider implementation + tests

**Files:**
- Modify: `packages/addon-pipeline/src/recorder/addon/recording-provider.ts`
- Test: `packages/addon-pipeline/src/recorder/addon/__tests__/recording-provider.spec.ts`

- [ ] **Step 1: Write the failing test**

In `recording-provider.spec.ts`, add this describe block at the end of the file (it reuses the existing `harness` + `seg` helpers defined at the top):

```ts
describe('buildRecordingProvider — getDaysWithRecordings', () => {
  it('returns sorted distinct local-day epochs for in-range segment starts', async () => {
    const day15 = Date.UTC(2026, 5, 15, 8, 0, 0)
    const day15b = Date.UTC(2026, 5, 15, 20, 0, 0)
    const day16 = Date.UTC(2026, 5, 16, 1, 0, 0)
    const { deps } = harness({
      segments: [
        seg({ startMs: day15, path: '99/mid/d/15a.m4s' }),
        seg({ startMs: day15b, path: '99/mid/d/15b.m4s' }),
        seg({ startMs: day16, path: '99/mid/d/16a.m4s' }),
      ],
    })
    const provider = buildRecordingProvider(deps)

    const res = await provider.getDaysWithRecordings({
      deviceId: 99,
      fromMs: Date.UTC(2026, 5, 1, 0, 0, 0),
      toMs: Date.UTC(2026, 5, 30, 0, 0, 0),
      tzOffsetMinutes: 0,
    })

    expect(res).toEqual({
      deviceId: 99,
      days: [Date.UTC(2026, 5, 15, 0, 0, 0), Date.UTC(2026, 5, 16, 0, 0, 0)],
    })
  })

  it('returns empty days for a device with no footage', async () => {
    const { deps } = harness({ segments: [] })
    const provider = buildRecordingProvider(deps)

    const res = await provider.getDaysWithRecordings({
      deviceId: 99,
      fromMs: 0,
      toMs: Date.now(),
      tzOffsetMinutes: 0,
    })

    expect(res).toEqual({ deviceId: 99, days: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npx vitest run packages/addon-pipeline/src/recorder/addon/__tests__/recording-provider.spec.ts -t getDaysWithRecordings`
Expected: FAIL — `provider.getDaysWithRecordings is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `recording-provider.ts`, add the import near the other recorder imports at the top of the file:

```ts
import { distinctRecordingDays } from '../day-bucket.js'
```

Also import the `RecordingDays` type from the cap module alongside the other recording type imports (find the existing `import { ... } from '@camstack/types'` or the recording-cap import and add `RecordingDays`).

Then, inside the object returned by `buildRecordingProvider`, immediately after the `getAvailability` method (after line 213), add:

```ts
    getDaysWithRecordings: async ({ deviceId, fromMs, toMs, tzOffsetMinutes }): Promise<RecordingDays> => {
      const starts = deps.index.segments(deviceId).map((s) => s.startMs)
      return { deviceId, days: distinctRecordingDays(starts, fromMs, toMs, tzOffsetMinutes) }
    },
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server && npx vitest run packages/addon-pipeline/src/recorder/addon/__tests__/recording-provider.spec.ts -t getDaysWithRecordings && npx tsc --noEmit -p packages/addon-pipeline/tsconfig.json`
Expected: tests PASS (2), typecheck PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-server
git add packages/addon-pipeline/src/recorder/addon/recording-provider.ts packages/addon-pipeline/src/recorder/addon/__tests__/recording-provider.spec.ts
git commit -m "feat(recording): implement getDaysWithRecordings provider method"
```

---

## Task 4: Viewer — calendar-grid pure helpers

**Files:**
- Create: `srcV2/components/camera/theater/calendar-grid.ts`
- Test: `srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { monthBounds, monthBoundsForMs, buildMonthGrid } from '../calendar-grid.js'

describe('monthBounds', () => {
  it('returns local first-of-month → first-of-next-month', () => {
    const { fromMs, toMs } = monthBounds(2026, 5) // June 2026 (month is 0-based)
    expect(fromMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(toMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })
})

describe('monthBoundsForMs', () => {
  it('derives the month of an arbitrary ms', () => {
    const ms = new Date(2026, 5, 17, 9, 30, 0).getTime()
    const { fromMs, toMs } = monthBoundsForMs(ms)
    expect(fromMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(toMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })
})

describe('buildMonthGrid', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime() // 2026-06-17 noon

  it('returns 42 cells starting on a Monday', () => {
    const cells = buildMonthGrid(2026, 5, now)
    expect(cells).toHaveLength(42)
    // June 1 2026 is a Monday → no leading days; first cell IS June 1.
    expect(cells[0].epoch).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(cells[0].inMonth).toBe(true)
  })

  it('flags inMonth correctly (June has 30 days)', () => {
    const cells = buildMonthGrid(2026, 5, now)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30)
  })

  it('flags future cells relative to today-midnight', () => {
    const cells = buildMonthGrid(2026, 5, now)
    const d18 = cells.find((c) => c.epoch === new Date(2026, 5, 18, 0, 0, 0, 0).getTime())
    const d17 = cells.find((c) => c.epoch === new Date(2026, 5, 17, 0, 0, 0, 0).getTime())
    expect(d18?.isFuture).toBe(true)
    expect(d17?.isFuture).toBe(false) // today is not "future"
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npx vitest run srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts`
Expected: FAIL — `Cannot find module '../calendar-grid.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `srcV2/components/camera/theater/calendar-grid.ts`:

```ts
/** Pure month-grid helpers for the theater date picker. All epochs are LOCAL
 *  midnights (new Date(y, m, d).getTime()), matching the viewer's dayWindow math
 *  and the backend's local-midnight day buckets. */

export interface DayCell {
  /** Local-midnight epoch (ms) of this calendar day. */
  readonly epoch: number
  /** True when the day belongs to the displayed month (vs leading/trailing fill). */
  readonly inMonth: boolean
  /** True when the day is strictly after today (un-selectable). */
  readonly isFuture: boolean
}

/** Local [first-of-month, first-of-next-month) bounds. `month` is 0-based. */
export function monthBounds(year: number, month: number): { fromMs: number; toMs: number } {
  return {
    fromMs: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    toMs: new Date(year, month + 1, 1, 0, 0, 0, 0).getTime(),
  }
}

/** Month bounds for the month that contains `ms`. */
export function monthBoundsForMs(ms: number): { fromMs: number; toMs: number } {
  const d = new Date(ms)
  return monthBounds(d.getFullYear(), d.getMonth())
}

/**
 * A 6×7 (42-cell) grid covering `month`, weeks starting Monday, with leading and
 * trailing days from the adjacent months. `nowMs` flags future cells.
 */
export function buildMonthGrid(year: number, month: number, nowMs: number): DayCell[] {
  const first = new Date(year, month, 1, 0, 0, 0, 0)
  // JS getDay(): 0=Sun..6=Sat → Monday-first index 0..6.
  const lead = (first.getDay() + 6) % 7
  const todayMidnight = new Date(nowMs)
  todayMidnight.setHours(0, 0, 0, 0)
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i, 0, 0, 0, 0)
    cells.push({
      epoch: d.getTime(),
      inMonth: d.getMonth() === month,
      isFuture: d.getTime() > todayMidnight.getTime(),
    })
  }
  return cells
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npx vitest run srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/components/camera/theater/calendar-grid.ts srcV2/components/camera/theater/__tests__/calendar-grid.spec.ts
git commit -m "feat(theater): pure month-grid helpers for the date picker"
```

---

## Task 5: Viewer — day-nav helpers

**Files:**
- Create: `srcV2/recording/day-nav.ts`
- Test: `srcV2/recording/__tests__/day-nav.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `srcV2/recording/__tests__/day-nav.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dayAtSameTime, dateLabel } from '../day-nav.js'

describe('dayAtSameTime', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime()

  it('keeps the time-of-day on the target day', () => {
    const current = new Date(2026, 5, 17, 19, 30, 45, 0).getTime()
    const targetDay = new Date(2026, 5, 15, 0, 0, 0, 0).getTime()
    expect(dayAtSameTime(current, targetDay, now)).toBe(
      new Date(2026, 5, 15, 19, 30, 45, 0).getTime(),
    )
  })

  it('clamps to now when the resulting instant is in the future', () => {
    // current time-of-day 19:30 on TODAY would be future (now is noon) → clamp.
    const current = new Date(2026, 5, 17, 19, 30, 0, 0).getTime()
    const targetDay = new Date(2026, 5, 17, 0, 0, 0, 0).getTime()
    expect(dayAtSameTime(current, targetDay, now)).toBe(now)
  })
})

describe('dateLabel', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime()
  const t = (k: string): string => (k === 'v2.theater.today' ? 'Oggi' : k === 'v2.theater.yesterday' ? 'Ieri' : k)

  it('returns Today for the current day', () => {
    expect(dateLabel(new Date(2026, 5, 17, 0, 0, 0).getTime(), now, t)).toBe('Oggi')
  })

  it('returns Yesterday for the previous day', () => {
    expect(dateLabel(new Date(2026, 5, 16, 0, 0, 0).getTime(), now, t)).toBe('Ieri')
  })

  it('returns a formatted date for older days', () => {
    const label = dateLabel(new Date(2026, 5, 10, 0, 0, 0).getTime(), now, t)
    expect(label).not.toBe('Oggi')
    expect(label).not.toBe('Ieri')
    expect(label.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npx vitest run srcV2/recording/__tests__/day-nav.spec.ts`
Expected: FAIL — `Cannot find module '../day-nav.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `srcV2/recording/day-nav.ts`:

```ts
/** Day-navigation helpers for the theater date selector. */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant on `targetDayMidnightEpoch`'s day at the SAME time-of-day as
 * `currentEpoch`. Clamped to `nowMs` when that would land in the future (e.g.
 * picking "today" at a time-of-day not yet reached).
 */
export function dayAtSameTime(currentEpoch: number, targetDayMidnightEpoch: number, nowMs: number): number {
  const cur = new Date(currentEpoch)
  const target = new Date(targetDayMidnightEpoch)
  target.setHours(cur.getHours(), cur.getMinutes(), cur.getSeconds(), cur.getMilliseconds())
  const t = target.getTime()
  return t > nowMs ? nowMs : t
}

/** "Oggi" / "Ieri" / a localized "Mar 17 Giu"-style date for the date pill. */
export function dateLabel(dayFromMs: number, nowMs: number, t: (key: string) => string): string {
  const day = new Date(dayFromMs)
  day.setHours(0, 0, 0, 0)
  const today = new Date(nowMs)
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - day.getTime()) / DAY_MS)
  if (diffDays === 0) return t('v2.theater.today')
  if (diffDays === 1) return t('v2.theater.yesterday')
  return new Date(dayFromMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npx vitest run srcV2/recording/__tests__/day-nav.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/recording/day-nav.ts srcV2/recording/__tests__/day-nav.spec.ts
git commit -m "feat(theater): day-nav helpers (same time-of-day, date label)"
```

---

## Task 6: Viewer — useDaysWithRecordings hook

**Files:**
- Modify: `srcV2/data/use-recording.ts`

This hook mirrors the existing `useRecordingAvailability` (defensive `capQuery`, degrades to empty on any error). No new test — it's a thin React-Query wrapper over `capQuery`, consistent with the other untested hooks in this file (the viewer has no hook-render harness).

- [ ] **Step 1: Add the hook**

At the end of `srcV2/data/use-recording.ts`, add:

```ts
/** Local-midnight epochs of days WITH footage in [monthFromMs, monthToMs);
 *  empty Set when none / not connected / method absent. Drives the date-picker dots. */
export function useDaysWithRecordings(
  deviceId: number,
  monthFromMs: number,
  monthToMs: number,
  enabled: boolean,
): UseQueryResult<Set<number>> {
  const { controller, state } = useConnection()
  const tzOffsetMinutes = -new Date().getTimezoneOffset()
  return useQuery<Set<number>>({
    queryKey: ['v2', 'recording', 'days', deviceId, monthFromMs],
    enabled: enabled && state === 'connected',
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return new Set<number>()
      const raw = await capQuery(system.trpcClient as Record<string, unknown>, 'recording', 'getDaysWithRecordings', {
        deviceId,
        fromMs: monthFromMs,
        toMs: monthToMs,
        tzOffsetMinutes,
      })
      const days =
        isRecord(raw) && Array.isArray(raw.days)
          ? raw.days.filter((d): d is number => typeof d === 'number')
          : []
      return new Set(days)
    },
  })
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npm run ts-check`
Expected: PASS (0 errors).

- [ ] **Step 3: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/data/use-recording.ts
git commit -m "feat(theater): useDaysWithRecordings hook"
```

---

## Task 7: Viewer — DatePickerModal component

**Files:**
- Create: `srcV2/components/camera/theater/DatePickerModal.tsx`

Fully controlled, presentational. The parent owns the anchored month and supplies `daysSet`; the modal renders the grid and reports picks. No render test (viewer vitest is `node`); its logic is covered by `calendar-grid` tests.

- [ ] **Step 1: Write the component**

Create `srcV2/components/camera/theater/DatePickerModal.tsx`:

```tsx
/**
 * DatePickerModal — a controlled month-calendar for theater recorded playback.
 *
 * The parent owns the anchored month (`monthAnchorMs`) and supplies `daysSet`
 * (local-midnight epochs that have footage) for it. Every day is selectable;
 * days with footage show a dot; future days are disabled.
 */
import React, { memo, useMemo } from 'react'
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'

import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { buildMonthGrid } from './calendar-grid.js'

export interface DatePickerModalProps {
  readonly visible: boolean
  /** Any ms within the month to display. */
  readonly monthAnchorMs: number
  /** Currently-selected day (local-midnight epoch), highlighted. */
  readonly selectedDayMs: number
  /** Local-midnight epochs that have footage in the displayed month. */
  readonly daysSet: ReadonlySet<number>
  /** Current wall-clock — flags future (disabled) cells + "today". */
  readonly nowMs: number
  readonly onChangeMonth: (deltaMonths: number) => void
  readonly onPick: (dayEpoch: number) => void
  readonly onClose: () => void
}

export const DatePickerModal = memo(function DatePickerModal(props: DatePickerModalProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const anchor = new Date(props.monthAnchorMs)
  const cells = useMemo(
    () => buildMonthGrid(anchor.getFullYear(), anchor.getMonth(), props.nowMs),
    [anchor.getFullYear(), anchor.getMonth(), props.nowMs],
  )
  const monthTitle = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const weekdays = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
  const todayMid = new Date(props.nowMs)
  todayMid.setHours(0, 0, 0, 0)

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <Pressable style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {/* Header: ‹ Month YYYY › */}
          <View style={styles.header}>
            <Pressable style={styles.navBtn} onPress={() => props.onChangeMonth(-1)} hitSlop={8}>
              <ChevronLeft size={18} color={colors.foregroundMuted} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>{monthTitle}</Text>
            <Pressable style={styles.navBtn} onPress={() => props.onChangeMonth(1)} hitSlop={8}>
              <ChevronRight size={18} color={colors.foregroundMuted} />
            </Pressable>
          </View>

          {/* Weekday header */}
          <View style={styles.weekRow}>
            {weekdays.map((w, i) => (
              <Text key={i} style={[styles.weekday, { color: colors.foregroundSubtle }]}>
                {w}
              </Text>
            ))}
          </View>

          {/* 6×7 grid */}
          <View style={styles.grid}>
            {cells.map((c) => {
              const hasFootage = props.daysSet.has(c.epoch)
              const isSelected = c.epoch === props.selectedDayMs
              const isToday = c.epoch === todayMid.getTime()
              return (
                <Pressable
                  key={c.epoch}
                  style={[
                    styles.cell,
                    isSelected && { backgroundColor: colors.primary },
                    !isSelected && isToday && { borderColor: colors.primary, borderWidth: 1 },
                  ]}
                  disabled={c.isFuture}
                  onPress={() => props.onPick(c.epoch)}
                >
                  <Text
                    style={[
                      styles.cellText,
                      {
                        color: c.isFuture
                          ? colors.foregroundSubtle
                          : isSelected
                            ? colors.primaryForeground
                            : c.inMonth
                              ? colors.foreground
                              : colors.foregroundMuted,
                      },
                    ]}
                  >
                    {new Date(c.epoch).getDate()}
                  </Text>
                  {hasFootage && !isSelected ? (
                    <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                  ) : null}
                </Pressable>
              )
            })}
          </View>

          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>{t('v2.theater.selectDate')}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  )
})

const CELL = 40

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  card: { width: CELL * 7 + SPACING.md * 2, borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  weekRow: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md },
  cellText: { fontSize: 13, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  hint: { fontSize: 11, textAlign: 'center', marginTop: SPACING.sm },
})
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npm run ts-check`
Expected: PASS. (If `colors.primaryForeground`/`foregroundSubtle`/`surface` names differ, open `srcV2/theme/theme-provider.ts` and use the actual token names — match those already used in `TimelineToolbarInline.tsx`.)

- [ ] **Step 3: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/components/camera/theater/DatePickerModal.tsx
git commit -m "feat(theater): controlled month-calendar DatePickerModal"
```

---

## Task 8: Viewer — next-day arrow in the toolbar

**Files:**
- Modify: `srcV2/components/camera/theater/TimelineToolbarInline.tsx`

- [ ] **Step 1: Add the props**

In `TimelineToolbarInlineProps` (after line 32, `onOpenDatePicker`), add:

```ts
  readonly onNextDay?: () => void
  readonly nextDayDisabled?: boolean
```

- [ ] **Step 2: Import the icon**

In the `lucide-react-native` import block (lines 13-22), add `ChevronRight` next to `ChevronLeft`:

```ts
  ChevronLeft,
  ChevronRight,
```

- [ ] **Step 3: Add the next-day arrow after the date pill**

Immediately after the Date pill `</Pressable>` (after line 88) and before `<View style={styles.spacer} />`, add:

```tsx
        {/* Next day */}
        <Pressable
          style={styles.dateArrow}
          onPress={props.onNextDay}
          disabled={props.nextDayDisabled}
          hitSlop={6}
        >
          <ChevronRight size={16} color={props.nextDayDisabled ? colors.foregroundSubtle : colors.foregroundMuted} />
        </Pressable>
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npm run ts-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/components/camera/theater/TimelineToolbarInline.tsx
git commit -m "feat(theater): next-day arrow in the timeline toolbar"
```

---

## Task 9: Viewer — wire handlers + modal in TheaterTimeline + i18n

**Files:**
- Modify: `srcV2/components/camera/theater/TheaterTimeline.tsx`
- Modify: `locales/en.json`, `locales/it.json`

- [ ] **Step 1: Add i18n keys**

In `locales/it.json`, inside the `"v2"` → `"theater"` object (around line 679), ensure these keys exist (add any missing):

```json
        "yesterday": "Ieri",
        "selectDate": "Seleziona una data"
```

In `locales/en.json`, in the same `v2.theater` object:

```json
        "yesterday": "Yesterday",
        "selectDate": "Pick a date"
```

(Keep `"today"` as-is; it already exists in both files.)

- [ ] **Step 2: Add imports**

In `TheaterTimeline.tsx`, near the existing theater imports (after line 50, the `event-highlights` import), add:

```ts
import { DatePickerModal } from './DatePickerModal.js'
import { monthBoundsForMs } from './calendar-grid.js'
import { dayAtSameTime, dateLabel } from '../../../recording/day-nav.js'
import { useDaysWithRecordings } from '../../../data/use-recording.js'
```

Ensure `useState` and `useCallback` are imported from `react` at the top (add them to the existing React import if absent).

- [ ] **Step 3: Add state, derived values, and handlers**

Immediately after the `dayWindow` useMemo (after line 215), add:

```ts
  const DAY_MS_NAV = 24 * 60 * 60 * 1000
  const todayStart = useMemo(() => {
    const d = new Date(nowMs)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [nowMs])

  // Date-picker modal state: the anchored month + open flag. The hook fetches the
  // recording-day dots only while the modal is open.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerAnchorMs, setPickerAnchorMs] = useState(dayFrom)
  const { fromMs: pickerMonthFrom, toMs: pickerMonthTo } = useMemo(
    () => monthBoundsForMs(pickerAnchorMs),
    [pickerAnchorMs],
  )
  const { data: recordingDays } = useDaysWithRecordings(
    props.deviceId,
    pickerMonthFrom,
    pickerMonthTo,
    pickerOpen,
  )

  const seekToTime = props.onSeekToTime
  const handlePrevDay = useCallback(() => {
    seekToTime?.(dayAtSameTime(viewedEpoch, dayFrom - DAY_MS_NAV, nowMs))
  }, [seekToTime, viewedEpoch, dayFrom, nowMs])
  const handleNextDay = useCallback(() => {
    if (dayFrom >= todayStart) return
    seekToTime?.(dayAtSameTime(viewedEpoch, dayFrom + DAY_MS_NAV, nowMs))
  }, [seekToTime, viewedEpoch, dayFrom, todayStart, nowMs])
  const handleOpenPicker = useCallback(() => {
    setPickerAnchorMs(dayFrom)
    setPickerOpen(true)
  }, [dayFrom])
  const handlePickDay = useCallback(
    (dayEpoch: number) => {
      setPickerOpen(false)
      seekToTime?.(dayAtSameTime(viewedEpoch, dayEpoch, nowMs))
    },
    [seekToTime, viewedEpoch, nowMs],
  )
  const handleChangeMonth = useCallback((delta: number) => {
    setPickerAnchorMs((prev) => {
      const d = new Date(prev)
      return new Date(d.getFullYear(), d.getMonth() + delta, 1, 0, 0, 0, 0).getTime()
    })
  }, [])
```

- [ ] **Step 4: Wire the toolbar props**

Replace the toolbar's date props (lines 383-385):

```tsx
        dateLabel={t('v2.theater.today')}
        onPrevDay={noop}
        onOpenDatePicker={noop}
```

with:

```tsx
        dateLabel={dateLabel(dayFrom, nowMs, t)}
        onPrevDay={seekToTime ? handlePrevDay : noop}
        onOpenDatePicker={seekToTime ? handleOpenPicker : noop}
        onNextDay={seekToTime ? handleNextDay : noop}
        nextDayDisabled={!seekToTime || dayFrom >= todayStart}
```

- [ ] **Step 5: Render the modal**

Immediately before the final closing `</View>` of the component's returned tree (just after the existing last child, e.g. the filter panel / FAB block near the end of the `return`), add:

```tsx
      <DatePickerModal
        visible={pickerOpen}
        monthAnchorMs={pickerAnchorMs}
        selectedDayMs={dayFrom}
        daysSet={recordingDays ?? new Set<number>()}
        nowMs={nowMs}
        onChangeMonth={handleChangeMonth}
        onPick={handlePickDay}
        onClose={() => setPickerOpen(false)}
      />
```

- [ ] **Step 6: Verify typecheck + full viewer test suite**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npm run ts-check && npx vitest run srcV2`
Expected: ts-check PASS; all suites PASS (existing 272 + the new calendar-grid/day-nav tests).

- [ ] **Step 7: Lint the changed files**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-viewer && npx eslint srcV2/components/camera/theater/TheaterTimeline.tsx srcV2/components/camera/theater/DatePickerModal.tsx srcV2/components/camera/theater/TimelineToolbarInline.tsx srcV2/data/use-recording.ts srcV2/recording/day-nav.ts srcV2/components/camera/theater/calendar-grid.ts`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git add srcV2/components/camera/theater/TheaterTimeline.tsx locales/en.json locales/it.json
git commit -m "feat(theater): wire date selector (arrows + calendar modal) into the timeline"
```

---

## Task 10: Deploy backend, manual verification, final checks

**Files:** none (build/deploy/verify).

- [ ] **Step 1: Server full typecheck + targeted tests + lint**

Run:
```bash
cd /Users/alice/Documents/Git/camstack/camstack-server
npx tsc --noEmit -p packages/addon-pipeline/tsconfig.json
npx vitest run packages/addon-pipeline/src/recorder
npx eslint packages/types/src/capabilities/recording.cap.ts packages/addon-pipeline/src/recorder/day-bucket.ts packages/addon-pipeline/src/recorder/addon/recording-provider.ts
```
Expected: all PASS / 0 errors.

- [ ] **Step 2: Deploy the addon (the new cap method must reach the running hub)**

Run: `cd /Users/alice/Documents/Git/camstack/camstack-server/packages/addon-pipeline && camstack deploy . --server https://localhost:4443`
Expected: builds embed+addon, respawns runner, hub-healthy. (Per the memory: avoid deploying while the user is actively recording/testing — coordinate first.)

- [ ] **Step 3: Manual verification on the device**

After a full app restart:
1. Open a camera with footage (e.g. cam99) → theater timeline.
2. Tap the date pill → calendar opens; days with footage show a dot; future days are greyed/disabled.
3. Pick a past day with footage → player seeks to that day at the same time-of-day; heatmap + events re-window to that day; date pill shows "Ieri"/the date.
4. Tap a day WITHOUT footage → lands on the "No footage" placeholder (no crash).
5. Use ‹ › arrows → moves ±1 day same time-of-day; › is disabled on today.
6. Change month in the calendar (‹ ›) → dots update for the new month.

- [ ] **Step 4: Push both branches** (only after the user confirms the manual checks pass)

```bash
cd /Users/alice/Documents/Git/camstack/camstack-server && git push
cd /Users/alice/Documents/Git/camstack/camstack-viewer && git push
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** backend method (Tasks 1-3), data hook (Task 6), calendar grid + modal (Tasks 4, 7), day-nav + label (Task 5), toolbar arrow (Task 8), wiring + i18n (Task 9), edge cases (future-clamp in `dayAtSameTime`, empty-day placeholder reused, per-month fetch, tz alignment), testing (server + viewer pure-helper specs). All present.
- **Soft back-bound:** `‹` (prev) is intentionally never disabled — empty earlier days show the placeholder. Only `›` (next) is bounded (disabled on today).
- **No SDK regen on the viewer:** `useDaysWithRecordings` uses the same defensive `capQuery` proxy access as `useRecordingAvailability`, so the viewer needs no `@camstack/sdk` type regen — only the server `npm run codegen`.
- **Theme tokens:** `DatePickerModal` assumes the same tokens `TimelineToolbarInline` uses (`colors.foreground/foregroundMuted/foregroundSubtle/surface/border/background/primary/primaryForeground`). Confirm against `theme-provider.ts` during Task 7.
