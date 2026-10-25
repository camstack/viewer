# Auto timeline zoom — design

**Status:** implemented.  
**Date:** 2026-10-02  
**Surface:** theater timeline (`TheaterTimeline` / `ZOOM_LEVELS` / `drag-mapping` /
`auto-zoom-map`)

## Goal

While the operator scrubs (finger **or** mouse-wheel / trackpad on web), the
visible time **range** follows scrub velocity: slow → tight (15m floor), fast →
wide (1h–12h). The picture and the playhead stay under the pointer; only the
ladder of how much wall-clock the column shows changes. Zoom/range changes
**animate** (extend/shrink), not jump.

## Operator decisions (2026-10-02)

1. **Chip label:** while Auto is engaged the chip shows **Auto** (option A) —
   not the live effective span.
2. **On velocity decrease / lift:** the **same continuous mapping** applies —
   slower → tighter, faster → wider (symmetric). Lift **freezes** the current
   effective index; there is **no snap-back** to the pre-drag index.
3. **Web scrub:** Auto also reacts to **mouse-wheel / trackpad** scrub, not only
   touch — same velocity stream `use-timeline-scrub` already emits.
4. **Tightest Auto floor is 15 minutes** — a real `ZOOM_LEVELS` entry (manual
   menu + Auto). Default fixed open stays **30m** (`DEFAULT_ZOOM_INDEX`).
5. **Animate** zoom/range changes so the timeline visibly grows/shrinks.

## Inputs already on the path

`utils/drag-mapping.ts` classifies each drag sample as `fine` or `coarse` from
velocity, with hysteresis. `use-timeline-scrub` emits
`{ mode, velocityPxPerS }` on each sample. Auto zoom reads that stream; it must
not invent a second velocity meter.

## Ladder

`ZOOM_LEVELS` (index → span), widest → tightest:

`0 → 12h · 1 → 6h · 2 → 3h · 3 → 1h · 4 → 30m · 5 → 15m`

Default fixed index: **4 (30m)**. Auto floor: **5 (15m)**.

### Velocity → target index (tunables in `AutoZoomConfig`)

| sustained velocity | target span | index |
| --- | --- | --- |
| ≤ enterFine (~80 px/s) | 15m | 5 |
| between enter and mid | 30m | 4 |
| mid band | 1h | 3 |
| above exit, moderate | 3h | 2 |
| fast | 6h | 1 |
| fling | 12h | 0 |

Exact band edges live next to `DragMapConfig`, not as magic numbers in the host.

### Hysteresis

1. **Hold:** only apply a zoom change after the same band has been the candidate
   for ≥ `holdMs` (default 300 ms).
2. **Asymmetric enter/exit** on band edges (wider to leave than to enter).
3. **No zoom change during the first ~100 ms** of a gesture (`settleMs`).
4. Lift freezes the effective index; Auto stays engaged until the operator picks
   a fixed span from the menu.

### Interaction with fine/coarse scrub

| layer | owns |
| --- | --- |
| `drag-mapping` | px → **cursor epoch** (fine vs coarse scale) |
| `auto-zoom-map` | velocity → **zoomIndex** (how much range the column shows) |

They compose: changing `zoomIndex` updates `coarseMsPerPx` for the next sample
without resetting `cursorMs`. Fine `fineMsPerPx` stays fixed.

## UI

- Sixth menu row labelled **Auto** (`v2.theater.zoomAuto` → "Auto" / "Auto").
- Chip shows **Auto** while `zoomMode === 'auto'`; picking a fixed span exits
  Auto.
- Persisted? Per-camera theater session is enough for V1; no hub setting.

## Animation

Same pattern as `timeline-cursor-shift`: layout commits to the new geometry in
one frame; a `scaleY` transform (origin at the playhead) eases from
`oldPxPerHour / newPxPerHour` → `1` so the column visibly grows or shrinks.
Scroll is re-anchored so the scrub epoch stays under the indicator.

## Out of scope for V1

- Server-side zoom.
- Clips mode — Auto forced off (`zoomEnabled === false`); wall-clock range is
  meaningless on the visit-compressed axis.
- Replacing the manual menu.

## Implementation

1. `utils/auto-zoom-map.ts` — pure `(velocity, state) → state`, tested.
2. Wire from scrub velocity hint into `TheaterTimeline` when `zoomMode === 'auto'`.
3. Footer: Auto row + chip label; fixed pick exits Auto.
4. `ZOOM_LEVELS` +15m; specs updated.
5. `timeline-zoom-shift.ts` + scroller/indicator transform.
6. Clips / `zoomEnabled === false` force Auto off.
