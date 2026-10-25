/**
 * Make the mount harness run on the ENGINE the operator runs.
 *
 * A mount test executes in node/jsdom, and node is years ahead of Hermes. So a
 * screen can render perfectly here and die on the phone the moment a module is
 * evaluated — which is exactly what happened: `rule-editor.ts` computes a
 * module-level constant with `Array.prototype.toSorted`, node has it, Hermes
 * has never shipped it, and the Notifications tab threw before it drew a pixel.
 *
 * Nothing in the pipeline would have caught it. `tsc` type-checks against
 * `lib: esnext`, and `babel-preset-expo`'s Hermes profile transforms SYNTAX
 * only (`configs/hermes-v1.js` — block scoping, class static blocks, async
 * generators). No polyfill for a missing BUILT-IN is ever injected: the method
 * reaches Hermes verbatim and throws `TypeError: … is not a function`.
 *
 * So the harness deletes what Hermes does not have. A mount test then fails
 * here for the same reason the device fails, including inside a dependency we
 * do not control.
 *
 * Wired as a vitest `setupFile`, which runs BEFORE the spec's own imports — the
 * only point early enough to catch a throw at module-evaluation time.
 *
 * Applies to jsdom specs only. The ~230 node-environment specs are pure-logic
 * tests that assert values, not device fidelity, and several legitimately use
 * `toSorted` in their own assertions.
 *
 * Every entry below was checked against `core-js-compat`'s engine data: a
 * feature is listed here only when its record carries NO `hermes` key at all,
 * meaning no released Hermes implements it. `Array.prototype.at`
 * (hermes 0.13), `Object.hasOwn` (hermes 0.10) and `String.prototype.replaceAll`
 * (hermes 0.7) are supported and are deliberately NOT stripped.
 */

/** `[owner, property]` pairs Hermes does not implement. */
const MISSING: readonly (readonly [object | undefined, string])[] = [
  // Change Array by Copy (ES2023) — the one that shipped the crash.
  [Array.prototype, 'toSorted'],
  [Array.prototype, 'toReversed'],
  [Array.prototype, 'toSpliced'],
  [Array.prototype, 'with'],
  [Array, 'fromAsync'],

  // Object/Map grouping (ES2024).
  [Object, 'groupBy'],
  [Map, 'groupBy'],

  // Promise helpers (ES2024/ES2025).
  [Promise, 'withResolvers'],
  [Promise, 'try'],

  // Set methods (ES2025).
  [Set.prototype, 'union'],
  [Set.prototype, 'intersection'],
  [Set.prototype, 'difference'],
  [Set.prototype, 'symmetricDifference'],
  [Set.prototype, 'isSubsetOf'],
  [Set.prototype, 'isSupersetOf'],
  [Set.prototype, 'isDisjointFrom'],

  // Well-formed unicode strings (ES2024).
  [String.prototype, 'isWellFormed'],
  //
  // `String.prototype.toWellFormed` is DELIBERATELY not stripped, and it is the
  // one exception in this table.
  //
  // jsdom's `URLSearchParams` is the WHATWG implementation (whatwg-url +
  // webidl-conversions), and its USVString conversion calls `toWellFormed()`
  // unconditionally on every `set()`. Deleting it therefore breaks jsdom
  // ITSELF: `buildSnapshotMediaUrl` — which runs happily on the phone — throws
  // inside `URLSearchParams.set` here. That is a harness artefact, not device
  // fidelity: React Native does not use whatwg-url at all, it ships its own
  // plain JS `URLSearchParams` (`Libraries/Blob/URL.js`), which never touches
  // the method.
  //
  // Our own source stays covered by the static guard
  // (`scripts/check-hermes-builtins.mjs`, wired into `ts-check`), which refuses
  // `.toWellFormed(` outright. What is given up is runtime coverage of a
  // DEPENDENCY calling it — and the only dependency that does is the one
  // standing in for a module the device does not run.

  // Misc stage-4 additions with no Hermes release.
  [RegExp, 'escape'],
  [Error, 'isError'],
  [Map.prototype, 'getOrInsert'],
  [Map.prototype, 'getOrInsertComputed'],
  [ArrayBuffer.prototype, 'transfer'],
  [ArrayBuffer.prototype, 'detached'],
]

/** Iterator helpers (ES2025). `Iterator` itself is absent from Hermes. */
const ITERATOR_HELPERS: readonly string[] = [
  'map',
  'filter',
  'take',
  'drop',
  'flatMap',
  'reduce',
  'toArray',
  'forEach',
  'some',
  'every',
  'find',
]

function strip(owner: object | undefined, prop: string): void {
  if (owner === undefined) return
  if (!Object.prototype.hasOwnProperty.call(owner, prop)) return
  Reflect.deleteProperty(owner, prop)
}

/**
 * Delete every built-in Hermes lacks from the current realm.
 *
 * Idempotent, and a no-op outside jsdom so the node-environment specs keep
 * node semantics.
 */
export function installHermesGlobals(): void {
  if (typeof window === 'undefined') return

  for (const [owner, prop] of MISSING) strip(owner, prop)

  const iteratorCtor: unknown = (globalThis as Record<string, unknown>)['Iterator']
  if (typeof iteratorCtor === 'function') {
    const proto: unknown = (iteratorCtor as { prototype?: unknown }).prototype
    if (typeof proto === 'object' && proto !== null) {
      for (const helper of ITERATOR_HELPERS) strip(proto, helper)
      strip(iteratorCtor as unknown as object, 'from')
    }
    Reflect.deleteProperty(globalThis, 'Iterator')
  }
}

installHermesGlobals()
