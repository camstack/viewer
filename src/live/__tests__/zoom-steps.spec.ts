import { describe, expect, it } from "vitest";
import {
  focalPan,
  nextZoomStep,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
} from "../zoom-steps";

/** Where a content point lands on screen: screen = s*(x - c) + c + pan. */
function project(
  x: number,
  center: number,
  scale: number,
  pan: number,
): number {
  return scale * (x - center) + center + pan;
}
/** The content point currently under a screen point. */
function contentUnder(
  screen: number,
  center: number,
  scale: number,
  pan: number,
): number {
  return (screen - center - pan) / scale + center;
}

describe("nextZoomStep", () => {
  it("climbs the ladder one step per call", () => {
    expect(nextZoomStep(ZOOM_MIN)).toBe(ZOOM_STEPS[0]);
    expect(nextZoomStep(ZOOM_STEPS[0]!)).toBe(ZOOM_STEPS[1]);
    expect(nextZoomStep(ZOOM_STEPS[1]!)).toBe(ZOOM_STEPS[2]);
  });

  it("returns to 1x from the top step — the cycle closes", () => {
    expect(nextZoomStep(ZOOM_MAX)).toBe(ZOOM_MIN);
  });

  it("offers exactly three steps above 1x", () => {
    expect(ZOOM_STEPS).toHaveLength(3);
    expect(ZOOM_STEPS.at(-1)).toBe(ZOOM_MAX);
  });

  it("lands on the next step ABOVE an arbitrary pinch scale, never below it", () => {
    expect(nextZoomStep(1.4)).toBe(2);
    expect(nextZoomStep(2.6)).toBe(3);
    expect(nextZoomStep(3.5)).toBe(4);
  });

  /**
   * A pinch rarely stops exactly on a rung, and a scale a hair under one is
   * the operator sitting AT it. Without the tolerance a double-tap there would
   * re-select the step it is already on and appear to do nothing.
   */
  it("counts a scale a hair under a step as being on it, and advances past", () => {
    expect(nextZoomStep(2.999)).toBe(4);
    expect(nextZoomStep(3.999)).toBe(ZOOM_MIN);
  });

  it("treats a scale at or past the top as the end of the cycle", () => {
    expect(nextZoomStep(4.2)).toBe(ZOOM_MIN);
  });

  it("never answers outside the clamp, whatever it is handed", () => {
    for (const s of [-3, 0, 0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = nextZoomStep(s);
      expect(next).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});

describe("focalPan", () => {
  const center = 200;

  it("keeps the point under a STATIONARY focal exactly where it was", () => {
    const focal = 320;
    const panStart = -18;
    const before = contentUnder(focal, center, 1.5, panStart);
    const pan = focalPan({
      focalNow: focal,
      focalStart: focal,
      center,
      panStart,
      scaleStart: 1.5,
      scaleAfter: 3,
    });
    expect(project(before, center, 3, pan)).toBeCloseTo(focal, 6);
  });

  /**
   * The defect this module exists for. Fingers ALWAYS drift while pinching, so
   * the anchor has to be the focal the gesture STARTED on while the picture
   * follows the focal's travel. Reusing the live focal for both terms silently
   * re-anchors every frame, and the picture is not where it was released.
   */
  it("keeps the point grabbed at the START under the focal after it has MOVED", () => {
    const focalStart = 320;
    const focalNow = 250;
    const panStart = -18;
    const grabbed = contentUnder(focalStart, center, 1.5, panStart);
    const pan = focalPan({
      focalNow,
      focalStart,
      center,
      panStart,
      scaleStart: 1.5,
      scaleAfter: 3,
    });
    expect(project(grabbed, center, 3, pan)).toBeCloseTo(focalNow, 6);
  });

  /**
   * With `pinchExpandsHeight` the box grows under the fingers, so the point the
   * picture scales about — the box centre — MOVES during the gesture, and the
   * total scale is the pinch times the growth. A formula with one centre puts
   * the grabbed point half the growth away from the finger; that drift is
   * what "torna in avanti" felt like.
   */
  it("keeps the grabbed point under the focal when the CENTRE moves with the box", () => {
    const focalStart = 120;
    const focalNow = 140;
    const centerStart = 121; // box 242 tall
    const centerAfter = 233; // box grown to 466
    const totalStart = 1.5 * 242;
    const totalAfter = 3 * 466;
    const panStart = -18;
    // A point of the VIDEO is fixed relative to the wrapper's own centre,
    // which does not move; only the point it is scaled about — the box centre
    // — does. `screen = S * q + boxCentre + pan`.
    const q = (focalStart - centerStart - panStart) / totalStart;
    const pan = focalPan({
      focalNow,
      focalStart,
      center: centerStart,
      centerAfter,
      panStart,
      scaleStart: totalStart,
      scaleAfter: totalAfter,
    });
    expect(totalAfter * q + centerAfter + pan).toBeCloseTo(focalNow, 6);
  });

  it("translates by the focal travel alone when the scale does not change", () => {
    const pan = focalPan({
      focalNow: 260,
      focalStart: 200,
      center,
      panStart: 10,
      scaleStart: 2,
      scaleAfter: 2,
    });
    expect(pan).toBeCloseTo(70, 6);
  });

  it("answers a finite number for a degenerate scale rather than poisoning the transform", () => {
    const pan = focalPan({
      focalNow: 10,
      focalStart: 10,
      center,
      panStart: 0,
      scaleStart: 0,
      scaleAfter: 2,
    });
    expect(Number.isFinite(pan)).toBe(true);
  });
});
