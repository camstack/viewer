/**
 * The repo's one honest re-render metric.
 *
 * React gives a test no way to ask "how many components re-rendered", and
 * `Profiler` reports commits and durations rather than counts. Every
 * `View`/`Text`/`Pressable` in a mounted tree goes through the guards in
 * `native-stubs/react-native.tsx`, so counting them there counts the WORK a
 * re-render did — and the KIND makes it precise: a theater cluster card's root
 * is its subtree's only `Pressable`, so `testRenderTally('Pressable')` is
 * literally "how many cards re-rendered".
 *
 * It lives in its OWN module, apart from the stub that feeds it, for one
 * boring reason: `tsconfig.json` excludes `src/testing`, so the ambient
 * `declare module 'react-native-web'` beside the stub is not in the program —
 * and a spec that imports the stub directly drags an untyped `react-native-web`
 * into `tsc` and turns the type check red. This module imports nothing.
 *
 * Written for `timeline-window.ts`: "the whole day's cards re-render on every
 * live-edge tick" is a claim about a number, and a fix for a number that cannot
 * be measured is a fix nobody can keep.
 */

const tallies = new Map<string, number>()

/** Renders since the last reset — all of them, or just one element kind. */
export function testRenderTally(name?: string): number {
  if (name !== undefined) return tallies.get(name) ?? 0
  let total = 0
  for (const count of tallies.values()) total += count
  return total
}

export function resetTestRenderTally(): void {
  tallies.clear()
}

/** Called by the native stubs' guards, once per element render. */
export function countRender(name: string): void {
  tallies.set(name, (tallies.get(name) ?? 0) + 1)
}
