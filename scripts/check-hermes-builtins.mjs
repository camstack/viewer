/**
 * Refuse a JavaScript built-in that Hermes does not implement.
 *
 * The app runs on Hermes 0.17 (`react-native/sdks/.hermesversion`). Hermes is
 * years behind node and Safari on library built-ins, and NOTHING else in this
 * pipeline notices:
 *
 *   • `tsc` type-checks against `lib: esnext` — `Array.prototype.toSorted` is a
 *     perfectly good method as far as TypeScript is concerned.
 *   • `babel-preset-expo`'s Hermes profile (`configs/hermes-v1.js`) transforms
 *     SYNTAX only — block scoping, class static blocks, async generators. It
 *     never injects a polyfill for a missing built-in, so the call reaches the
 *     device verbatim and throws `TypeError: … is not a function`.
 *   • The web build runs on the browser engine, where every one of these works.
 *
 * This cost a production outage. OTA v1.0.336 shipped
 * `NC_DEVICE_TYPE_OPTIONS = Object.values(DeviceType).map(…).toSorted(…)` at
 * MODULE scope in `src/components/notifications/rule-editor.ts`. Evaluating the
 * module threw, the Notifications tab took the whole app down the instant the
 * operator opened it, and 2,917 green tests said nothing.
 *
 * The list is derived from `core-js-compat`'s engine data: a name appears here
 * only when its record carries NO `hermes` key at all, meaning no released
 * Hermes implements it. Built-ins Hermes DOES have are deliberately absent —
 * `Array.prototype.at` (hermes 0.13), `Object.hasOwn` (0.10),
 * `String.prototype.replaceAll` (0.7) are all fine and are used in this repo.
 *
 * The mount harness enforces the same thing at RUNTIME
 * (`src/testing/hermes-globals.ts`), which additionally covers dependencies.
 * This guard covers the far larger set of code that no test renders.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()

/**
 * `pattern` matches the call; `fix` is what to write instead.
 *
 * Deliberately NOT matched, because the name is too common to flag without
 * false alarms that would get this guard switched off:
 * `Array.prototype.with`, and the bare `Set` methods `intersection` /
 * `difference`. `union` IS matched, with an exception for `z.union(` — Zod
 * schemas use that name constantly and are not Set operations.
 */
const BANNED = [
  { pattern: /\.toSorted\s*\(/, name: 'Array.prototype.toSorted', fix: '[...arr].sort(…)' },
  { pattern: /\.toReversed\s*\(/, name: 'Array.prototype.toReversed', fix: '[...arr].reverse()' },
  { pattern: /\.toSpliced\s*\(/, name: 'Array.prototype.toSpliced', fix: 'copy, then splice' },
  { pattern: /\bObject\.groupBy\s*\(/, name: 'Object.groupBy', fix: 'a reduce into a record' },
  { pattern: /\bMap\.groupBy\s*\(/, name: 'Map.groupBy', fix: 'a reduce into a Map' },
  { pattern: /\bPromise\.withResolvers\s*\(/, name: 'Promise.withResolvers', fix: 'a manual deferred' },
  { pattern: /\bPromise\.try\s*\(/, name: 'Promise.try', fix: 'Promise.resolve().then(fn)' },
  { pattern: /\bArray\.fromAsync\s*\(/, name: 'Array.fromAsync', fix: 'a for-await loop' },
  { pattern: /\bRegExp\.escape\s*\(/, name: 'RegExp.escape', fix: 'a manual escape' },
  { pattern: /\bError\.isError\s*\(/, name: 'Error.isError', fix: 'e instanceof Error' },
  { pattern: /\.isWellFormed\s*\(/, name: 'String.prototype.isWellFormed', fix: 'a surrogate check' },
  { pattern: /\.toWellFormed\s*\(/, name: 'String.prototype.toWellFormed', fix: 'a surrogate replace' },
  { pattern: /\.symmetricDifference\s*\(/, name: 'Set.prototype.symmetricDifference', fix: 'filter both ways' },
  { pattern: /\.isSubsetOf\s*\(/, name: 'Set.prototype.isSubsetOf', fix: 'every() over the set' },
  { pattern: /\.isSupersetOf\s*\(/, name: 'Set.prototype.isSupersetOf', fix: 'every() over the set' },
  { pattern: /\.isDisjointFrom\s*\(/, name: 'Set.prototype.isDisjointFrom', fix: '!some() over the set' },
  { pattern: /\.getOrInsertComputed\s*\(/, name: 'Map.prototype.getOrInsertComputed', fix: 'get() ?? set()' },
  { pattern: /\.getOrInsert\s*\(/, name: 'Map.prototype.getOrInsert', fix: 'get() ?? set()' },
  { pattern: /\bMath\.sumPrecise\s*\(/, name: 'Math.sumPrecise', fix: 'reduce((a, b) => a + b, 0)' },
  {
    // Hermes 0.17: `Intl.RelativeTimeFormat` is undefined. `new` of it threw
    // "undefined cannot be used as a constructor" on every yesterday tile
    // after midnight (formatEventTime, OTA 1.0.630+, 2026-10-18).
    pattern: /\bnew\s+Intl\.RelativeTimeFormat\s*\(/,
    name: 'Intl.RelativeTimeFormat',
    fix: 'a locale word table (yesterdayWord)',
  },
  {
    pattern: /(?<![.\w])(?<!z)(?<!zod)\.union\s*\(/,
    name: 'Set.prototype.union',
    fix: 'new Set([...a, ...b])',
    // `z.union([...])` is a Zod schema, not a Set operation.
    allow: (line) => /\bz\.union\s*\(|\bzod\.union\s*\(/.test(line),
  },
]

/** Scanned in full; only tests and the harness itself are exempt. `shared/` runs on the device too (the app imports it), so it is held to the same list. */
const ROOTS = ['src', 'app', 'shared']

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // `__tests__` runs under node, which HAS these. `src/testing` is the
      // harness that deletes them on purpose and must be able to name them.
      if (entry.name === '__tests__') continue
      if (path.relative(ROOT, full) === path.join('src', 'testing')) continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Strip `//` and `/* *\/` comment bodies so prose about a banned name is legal. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
}

const offenders = []
for (const file of ROOTS.flatMap((r) => walk(path.join(ROOT, r)))) {
  const lines = stripComments(fs.readFileSync(file, 'utf-8')).split('\n')
  for (const [index, line] of lines.entries()) {
    for (const banned of BANNED) {
      if (!banned.pattern.test(line)) continue
      if (banned.allow?.(line)) continue
      offenders.push(
        `${path.relative(ROOT, file)}:${index + 1}  ${banned.name} — use ${banned.fix}`,
      )
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `${offenders.length} use(s) of a built-in Hermes does not implement. These type-check ` +
      `and work on web, and throw the moment the device evaluates them:\n  ` +
      offenders.join('\n  '),
  )
  process.exit(1)
}
console.log('hermes builtins ok — nothing used that the device lacks')
