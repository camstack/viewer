/**
 * Pure geometry and timing of the animated splash logo — a port of the approved
 * reference, in the logo's own 64×64 viewBox. Every function is a worklet so the
 * logo can drive its SVG props on the UI thread; they also run as plain JS in specs.
 *
 * One pass is `u` in [0, 1] (linear time). The orbit angle is `easeCycle(u) * 2π`;
 * the seed squashes and the lens clicks as a function of `u`. `u = 0` is the rest
 * frame and equals the static `splash-icon.png`.
 */

export const TWO_PI = 2 * Math.PI
export const ORBIT_TILT = (-14 * Math.PI) / 180
export const ORBIT_CX = 32
export const ORBIT_CY = 41
export const ORBIT_RX = 26
export const ORBIT_RY = 8.2
export const LENS = { cx: 32, cy: 42, r: 5.6 } as const
/** The seed squashes anchored at its base. */
export const SEED_ANCHOR = { x: 32, y: 61 } as const
export const BLADE_COUNT = 6

export type NodeLayer = 'front' | 'back'

export interface NodePlacement {
  readonly cx: number
  readonly cy: number
  readonly r: number
  readonly opacity: number
  readonly layer: NodeLayer
}

export interface SeedScale {
  readonly sx: number
  readonly sy: number
}

export interface BladeSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export function easeInOut(x: number): number {
  'worklet'
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** Cubic in-out: the orbit accelerates, then settles back to the rest angle. */
export function easeCycle(x: number): number {
  'worklet'
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function orbitAngle(u: number): number {
  'worklet'
  return easeCycle(u) * TWO_PI
}

/** A node on the tilted orbit ellipse; `depth > 0` is in front of the seed. */
export function placeNode(theta: number, baseR: number): NodePlacement {
  'worklet'
  const cos = Math.cos(ORBIT_TILT)
  const sin = Math.sin(ORBIT_TILT)
  const lx = ORBIT_RX * Math.cos(theta)
  const ly = ORBIT_RY * Math.sin(theta)
  const depth = Math.sin(theta)
  return {
    cx: ORBIT_CX + lx * cos - ly * sin,
    cy: ORBIT_CY + lx * sin + ly * cos,
    r: baseR * (1 + 0.12 * depth),
    opacity: depth >= -0.0001 ? 1 : 0.86 + 0.14 * (1 + depth),
    layer: depth >= -0.0001 ? 'front' : 'back',
  }
}

/** Anticipation, stretch, then a damped settle. Exactly 1/1 at `u = 0`. */
export function squash(u: number): SeedScale {
  'worklet'
  if (u < 0.14) {
    const a = easeInOut(u / 0.14)
    return { sx: 1 + 0.07 * a, sy: 1 - 0.1 * a }
  }
  if (u < 0.3) {
    const b = easeInOut((u - 0.14) / 0.16)
    return { sx: 1.07 - 0.1 * b, sy: 0.9 + 0.15 * b }
  }
  const t = (u - 0.3) / 0.7
  const d = Math.exp(-5 * t) * Math.cos(t * Math.PI * 3)
  return { sx: 1 - 0.03 * d, sy: 1 + 0.05 * d }
}

/** The pupil opens a little while the seed stretches. */
export function pupilRadius(sy: number): number {
  'worklet'
  const r = 2.4 + ((0.9 * Math.max(0, sy - 1)) / 0.05) * 0.5
  return Math.min(3.4, Math.max(2.4, r))
}

/** Shutter closure 0..1: snaps shut at the top of the stretch, reopens a touch slower. */
export function shutter(u: number): number {
  'worklet'
  if (u >= 0.3 && u < 0.35) return Math.pow((u - 0.3) / 0.05, 2)
  if (u >= 0.35 && u < 0.46) return Math.pow(1 - (u - 0.35) / 0.11, 3)
  return 0
}

/** Glint opacity 0..1 after the click. */
export function glint(u: number): number {
  'worklet'
  if (u < 0.42 || u >= 0.7) return 0
  const g = (u - 0.42) / 0.28
  return g < 0.2 ? g / 0.2 : 1 - (g - 0.2) / 0.8
}

/** Iris ring: closing thickens the stroke inward from the lens edge. */
export function irisRing(closure: number): { readonly r: number; readonly strokeWidth: number } {
  'worklet'
  const w = LENS.r * closure
  return { r: LENS.r - w / 2, strokeWidth: w }
}

/** One iris blade edge; its inner end slides to the centre as the shutter closes. */
export function bladeSegment(index: number, closure: number): BladeSegment {
  'worklet'
  const ri = LENS.r * (1 - closure)
  const a = (index * Math.PI) / 3 + closure * 0.9
  const a2 = a + 1.75
  return {
    x1: LENS.cx + 6 * Math.cos(a),
    y1: LENS.cy + 6 * Math.sin(a),
    x2: LENS.cx + ri * Math.cos(a2),
    y2: LENS.cy + ri * Math.sin(a2),
  }
}

export function bladesOpacity(closure: number): number {
  'worklet'
  return Math.min(1, closure * 3)
}
