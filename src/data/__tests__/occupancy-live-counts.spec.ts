/**
 * The class chips count what is MOVING, not what is parked.
 *
 * ## The defect
 *
 * Verified on the live hub, camera Parking, 2026-09-02:
 *
 *     frame.byClass      { "vehicle": 3 }
 *     stationaryObjects  [ vehicle, vehicle, vehicle ]
 *
 * The same three parked cars, counted twice — once in the per-class chips and
 * once in the PARKED chip beside them. So "3 vehicles" never meant "three
 * vehicles are in the scene": it meant three cars have been parked there for
 * hours. The number never changes, and when a car actually drives through it
 * becomes 4, with nothing to say which one is new.
 *
 * The hub is not wrong to report both — `frame` is occupancy, and a parked car
 * IS occupying. The chips are what read it wrong.
 *
 * ## Why this is subtracted here and not fixed at the source
 *
 * Because it can be done exactly. Every entry in `stationaryObjects` carries
 * its own `className`, from the SAME snapshot instant as `frame.byClass`, so
 * this is a per-class subtraction and not a total-minus-total guess. Changing
 * the hub's `frame` to mean "moving only" would instead redefine a field named
 * occupancy for every other reader of it.
 */
import { describe, expect, it } from 'vitest'
import { occupancyClassCounts, toCameraOccupancy } from '../occupancy.js'

function snapshot(
  byClass: Record<string, number>,
  stationary: readonly string[],
): ReturnType<typeof toCameraOccupancy> {
  return toCameraOccupancy({
    ts: 1_000,
    frame: {
      totalObjects: Object.values(byClass).reduce((a, b) => a + b, 0),
      byClass,
    },
    stationaryObjects: stationary.map((className, i) => ({
      id: `s${i}`,
      className,
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      frameWidth: 100,
      frameHeight: 100,
      becameStationaryAt: 900,
    })),
  })
}

describe('occupancyClassCounts — the chips are the LIVE scene', () => {
  it('the live Parking case: three parked cars leave no vehicle chip', () => {
    expect(occupancyClassCounts(snapshot({ vehicle: 3 }, ['vehicle', 'vehicle', 'vehicle']))).toEqual(
      [],
    )
  })

  it('a car driving past three parked ones is reported as ONE', () => {
    const counts = occupancyClassCounts(
      snapshot({ vehicle: 4 }, ['vehicle', 'vehicle', 'vehicle']),
    )
    expect(counts).toEqual([{ className: 'vehicle', count: 1 }])
  })

  it('subtracts PER CLASS — a person is not cancelled by a parked car', () => {
    const counts = occupancyClassCounts(
      snapshot({ vehicle: 2, person: 1 }, ['vehicle', 'vehicle']),
    )
    expect(counts).toEqual([{ className: 'person', count: 1 }])
  })

  it('nothing parked leaves the counts untouched', () => {
    expect(occupancyClassCounts(snapshot({ person: 2 }, []))).toEqual([
      { className: 'person', count: 2 },
    ])
  })

  it('never reports a negative count if the two disagree', () => {
    // Defensive: the two halves come from one snapshot, so this should not
    // happen — but a negative chip would be a visible nonsense, and clamping
    // costs nothing.
    const counts = occupancyClassCounts(snapshot({ vehicle: 1 }, ['vehicle', 'vehicle']))
    expect(counts).toEqual([])
  })
})
