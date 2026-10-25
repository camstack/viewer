import { describe, it, expect } from 'vitest'

import {
  MOTION_REORDER_INTERVAL_MS,
  mergeMotionRecency,
  motionStartFromStatus,
  orderByMotionRecency,
  parseMotionStart,
  reorderDelay,
  motionRisingEdge,
  motionEdgesFromStatuses,
  type MotionEdgeState,
} from '../motion-recency.js'
import {
  camerasInBucket,
  locationBucket,
  zoneBucket,
} from '../../components/cameras/camera-locations.js'

const cams = (...ids: number[]) => ids.map((id) => ({ id }))
const ids = (list: readonly { id: number }[]) => list.map((c) => c.id)

describe('orderByMotionRecency', () => {
  it('puts the most recent motion first', () => {
    const recency = new Map([[1, 100], [2, 300], [3, 200]])
    expect(ids(orderByMotionRecency(cams(1, 2, 3), recency))).toEqual([2, 3, 1])
  })

  it('keeps cameras never seen in motion at the end, in their existing order', () => {
    const recency = new Map([[4, 50]])
    expect(ids(orderByMotionRecency(cams(9, 4, 1, 7), recency))).toEqual([4, 9, 1, 7])
  })

  it('with no recency at all, is the incoming order unchanged', () => {
    expect(ids(orderByMotionRecency(cams(5, 3, 8), new Map()))).toEqual([5, 3, 8])
  })

  it('breaks ties by the incoming order', () => {
    const recency = new Map([[1, 100], [2, 100]])
    expect(ids(orderByMotionRecency(cams(2, 1), recency))).toEqual([2, 1])
  })

  it('ignores recency for cameras not in the list and does not mutate its input', () => {
    const input = cams(1, 2)
    const out = orderByMotionRecency(input, new Map([[2, 10], [99, 999]]))
    expect(ids(out)).toEqual([2, 1])
    expect(ids(input)).toEqual([1, 2])
  })
})

describe('mergeMotionRecency', () => {
  it('keeps the later timestamp per device and returns a new map', () => {
    const before = new Map([[1, 500]])
    const after = mergeMotionRecency(before, [
      { deviceId: 1, at: 400 },
      { deviceId: 2, at: 300 },
      { deviceId: 2, at: 350 },
    ])
    expect([...after.entries()]).toEqual([[1, 500], [2, 350]])
    expect([...before.entries()]).toEqual([[1, 500]])
  })
})

describe('parseMotionStart', () => {
  it('reads the rising edge with the payload timestamp', () => {
    expect(
      parseMotionStart({ deviceId: 101, detected: true, timestamp: 1234, source: 'onboard' }, 9),
    ).toEqual({ deviceId: 101, at: 1234 })
  })

  it('falls back to the given clock when the payload has no timestamp', () => {
    expect(parseMotionStart({ deviceId: 101, detected: true }, 9)).toEqual({ deviceId: 101, at: 9 })
  })

  it('ignores the falling edge and malformed payloads', () => {
    expect(parseMotionStart({ deviceId: 101, detected: false, timestamp: 1 }, 9)).toBeNull()
    expect(parseMotionStart({ detected: true }, 9)).toBeNull()
    expect(parseMotionStart(null, 9)).toBeNull()
  })
})

/**
 * The wire shape, as the hub pushed it on 2026-10-06: `live.onEvent` hands the
 * ENVELOPE, and the motion payload is its `data`. Read off the envelope itself,
 * every live event was dropped.
 */
const envelope = (data: Record<string, unknown>) => ({
  id: '6d71b962-24ec-49d9-850d-216f9c4eec32',
  timestamp: '2026-10-06T16:58:55.888Z',
  source: { type: 'device', id: data.deviceId, deviceId: data.deviceId },
  category: 'motion.on-motion-changed',
  data,
})

describe('parseMotionStart on the live.onEvent envelope', () => {
  it('reads deviceId, the rising edge and the PAYLOAD timestamp from `data`', () => {
    expect(
      parseMotionStart(
        envelope({
          deviceId: 102,
          detected: true,
          timestamp: 1791305935886,
          source: 'onboard',
          triggeredBy: { kind: 'camera' },
        }),
        9,
      ),
    ).toEqual({ deviceId: 102, at: 1791305935886 })
  })

  it('ignores the falling edge inside an envelope', () => {
    expect(
      parseMotionStart(
        envelope({ deviceId: 102, detected: false, timestamp: 1, source: 'analyzer' }),
        9,
      ),
    ).toBeNull()
  })
})

describe('the seed: motion.getStatus per camera', () => {
  it('reduces a status to its lastDetectedAt; a camera that never moved has none', () => {
    expect(
      motionStartFromStatus(101, {
        detected: false,
        lastDetectedAt: 1791305772852,
        autoClearAfterMs: null,
      }),
    ).toEqual({ deviceId: 101, at: 1791305772852 })
    expect(motionStartFromStatus(103, null)).toBeNull()
    expect(motionStartFromStatus(103, { detected: false, lastDetectedAt: null })).toBeNull()
  })

  /**
   * The operator's report (2026-10-06): with every camera's getStatus `null`,
   * only the camera-grid device was seeded and it sat first. Once the cameras
   * answer, the grid ranks by its own effective motion like any camera.
   */
  it('cameras seeded + grid seeded: most recent first, the grid where its own motion puts it', () => {
    const GRID = 4581
    const statuses: readonly (readonly [number, unknown])[] = [
      [GRID, { detected: false, lastDetectedAt: 1791305756040, autoClearAfterMs: null }],
      [101, { detected: false, lastDetectedAt: 1791305772852, autoClearAfterMs: null }],
      [104, { detected: true, lastDetectedAt: 1791305786690, autoClearAfterMs: 15_000 }],
      [636, null],
      [587, { detected: false, lastDetectedAt: 1791304585333, autoClearAfterMs: null }],
    ]
    const seed = statuses.flatMap(([id, status]) => {
      const start = motionStartFromStatus(id, status)
      return start === null ? [] : [start]
    })
    const recency = mergeMotionRecency(new Map(), seed)
    expect(ids(orderByMotionRecency(cams(GRID, 103, 587, 104, 101, 636), recency))).toEqual([
      104,
      101,
      GRID,
      587,
      103,
      636,
    ])
  })

  it('a live rise lifts its camera above a seeded one', () => {
    const recency = mergeMotionRecency(
      mergeMotionRecency(new Map(), [
        { deviceId: 4581, at: 1791305756040 },
        { deviceId: 101, at: 1791305772852 },
      ]),
      [
        parseMotionStart(
          envelope({ deviceId: 112, detected: true, timestamp: 1791305800000, source: 'onboard' }),
          0,
        )!,
      ],
    )
    expect(ids(orderByMotionRecency(cams(4581, 112, 101), recency))).toEqual([112, 101, 4581])
  })
})

describe('reorderDelay', () => {
  it('is a named 5 s window', () => {
    expect(MOTION_REORDER_INTERVAL_MS).toBe(5_000)
  })

  it('applies at once when nothing was applied yet or the window elapsed', () => {
    expect(reorderDelay(1_000, null)).toBe(0)
    expect(reorderDelay(10_000, 5_000)).toBe(0)
    expect(reorderDelay(20_000, 5_000)).toBe(0)
  })

  it('waits out the rest of the window otherwise', () => {
    expect(reorderDelay(6_000, 5_000)).toBe(4_000)
  })
})

describe('Motion is an ORDER on top of the selected chip, not a bucket', () => {
  const CAMS = [
    { id: 1, location: 'Esterno' },
    { id: 2, location: 'Kitchen' },
    { id: 3, location: 'Esterno' },
    { id: 4, location: 'Camera' },
    { id: 5, location: 'Esterno' },
  ]
  // Camera 2 moved most recently of all, but is not in the selection.
  const recency = new Map([[2, 900], [5, 500], [3, 300]])

  it('a zone + Motion = the zone’s cameras, most recent motion first', () => {
    const zones = [{ zoneKey: 'fuori', label: 'Fuori', locationKeys: ['esterno'] }]
    const zoneCams = camerasInBucket(CAMS, zoneBucket('fuori'), new Set(), zones)
    expect(ids(orderByMotionRecency(zoneCams, recency))).toEqual([5, 3, 1])
  })

  it('a location + Motion keeps the selection and only reorders it', () => {
    const outdoor = camerasInBucket(CAMS, locationBucket('Esterno'), new Set())
    const ordered = orderByMotionRecency(outdoor, recency)
    expect(ids(ordered)).toEqual([5, 3, 1])
    expect(new Set(ids(ordered))).toEqual(new Set(ids(outdoor)))
  })
})

describe('motionRisingEdge — heartbeats are not new starts', () => {
  const ev = (deviceId: number, detected: boolean, timestamp: number) => ({
    id: 'x',
    category: 'motion.on-motion-changed',
    data: { deviceId, detected, timestamp, source: 'analyzer' },
  })

  it('counts the first true, ignores repeated trues, re-arms on false', () => {
    let edges: MotionEdgeState = new Map()
    const starts: number[] = []
    for (const e of [ev(101, true, 1), ev(101, true, 2), ev(101, true, 3), ev(101, false, 4), ev(101, true, 5)]) {
      const r = motionRisingEdge(edges, e, 0)
      edges = r.edges
      if (r.start) starts.push(r.start.at)
    }
    expect(starts).toEqual([1, 5])
  })

  it('a camera already moving at seed time is not re-started by its next heartbeat', () => {
    const seeded = motionEdgesFromStatuses([{ deviceId: 102, detected: true }])
    expect(motionRisingEdge(seeded, ev(102, true, 9), 0).start).toBeNull()
  })
})
