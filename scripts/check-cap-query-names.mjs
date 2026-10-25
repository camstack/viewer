#!/usr/bin/env node
/**
 * `capQuery` names a capability and a method with STRING LITERALS, and nothing
 * in TypeScript checks them. This does.
 *
 * ── The bug class this prevents ────────────────────────────────────────────
 * `capQuery(client, 'recording', 'getAvailability', …)` reaches the hub by
 * looking both names up on the tRPC router at runtime:
 *
 *     const router = client[cap]
 *     if (router === undefined || router === null) return null
 *     const fn = router[method]
 *     if (typeof fn?.query !== 'function') return null
 *
 * **A wrong name is not an error — it is `null`**, and every caller folds a
 * `null` into an empty list. So a capability that is renamed, split or moved
 * on the hub leaves this app type-clean, lint-clean, `ts-check`-green, and
 * silently empty on every screen that read it. That is D315's shape
 * (not-yet-known made indistinguishable from known-empty) arriving through a
 * door the compiler does not watch.
 *
 * It is not hypothetical. `recording` is about to become a device-scoped
 * collection with a new `recording-archive` singleton beside it
 * (`docs/design/2026-09-24-onboard-source-for-recordings-motion-events.md`),
 * and this app holds **9 calls across 6 of its methods**. Without this guard
 * the first sign would be an operator reporting that his storage screen went
 * blank.
 *
 * ── What it checks ─────────────────────────────────────────────────────────
 * Every literal `(cap, method)` pair in `src/` against the capability
 * definitions in the `@camstack/types` this app actually resolves — the
 * PUBLISHED package, which is what metro, vitest and CI resolve too, not the
 * workspace source. So the guard fails exactly when the app would 412 at
 * runtime, and passes only once the published types carry the new name.
 *
 * The router key is the capability's name in camelCase (`device-manager` →
 * `deviceManager`), which is the mapping the generated router applies.
 *
 * Calls whose names are not literals cannot be checked and are REPORTED, not
 * ignored: a guard that silently covers 61 of 63 call sites is a guard whose
 * coverage nobody can quote.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const types = require('@camstack/types')
const { expandCapMethods } = types

/**
 * cap name → Set of method names, from the package this app really resolves.
 *
 * `expandCapMethods`, NOT `def.methods`. The mounted surface is larger than the
 * declared one: a cap carrying a `status` block gets a `getStatus` query
 * injected (`DEVICE_STATUS_METHOD`), and `exposesDeviceSettings` adds the three
 * contribution methods. `scripts/generate-cap-routers.ts` on the server emits
 * exactly that expansion, so it is the only definition of "does this name
 * resolve". Comparing against `def.methods` alone reported two live, working
 * calls as unresolvable — `network-link` declares `methods: {}` and its WHOLE
 * surface is the injected `getStatus` — and a guard that calls a working call
 * broken is worse than no guard, because the next session deletes the call.
 */
const CAPS = new Map()
for (const [exportName, value] of Object.entries(types)) {
  if (!exportName.endsWith('Capability')) continue
  if (value === null || typeof value !== 'object') continue
  const { name, methods } = value
  if (typeof name !== 'string' || methods === null || typeof methods !== 'object') continue
  CAPS.set(name, new Set(Object.keys(expandCapMethods(value))))
}

/** `device-manager` → `deviceManager`, the generated router's own mapping. */
const routerKey = (capName) => capName.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const BY_ROUTER_KEY = new Map([...CAPS].map(([name, methods]) => [routerKey(name), { name, methods }]))

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      sources(full, out)
    } else if (/\.tsx?$/.test(entry) && entry !== 'cap-query.ts') {
      out.push(full)
    }
  }
  return out
}

/**
 * Router keys that are NOT capabilities and never will be.
 *
 * `auth` is a hand-written tRPC router (`createAuthRouter`, trpc.router.ts) —
 * it predates the capability system and answers directly. Checking it against
 * the capability list would be the guard asserting the wrong thing.
 */
const NON_CAPABILITY_ROUTERS = new Map([
  ['auth', 'a hand-written tRPC router (createAuthRouter), not a capability'],
])

/**
 * Calls this guard finds broken and which are defects in the app rather than in
 * the guard. Listed rather than silenced so the guard can ship green while they
 * are triaged — **deleting an entry is how one gets closed**, and an entry that
 * starts resolving fails below, because a recorded reason that no longer
 * applies reads as verification of it.
 *
 * Empty since 2026-09-24. The two entries it shipped with —
 * `networkLink.getStatus` and `navigation.getStatus` — were never app defects:
 * both caps declare a `status` block, so the hub mounts a `getStatus` query for
 * each, and it was this guard that was reading `def.methods` instead of
 * `expandCapMethods`. See the note on CAPS above.
 */
const KNOWN_BROKEN = new Map()

/**
 * Calls to a method the hub gains in a server train this app ships AFTER — not
 * broken, AHEAD. Allowed only for a caller that THROWS when the name does not
 * resolve (so an older hub reads as "could not read", never as an empty
 * answer — D315). Each entry must still be ABSENT from the published types:
 * the day the release carries it, this guard fails until the entry is deleted.
 */
const AHEAD_OF_PUBLISHED = new Map([])

/**
 * Every helper in `cap-query.ts` that addresses a router by STRING.
 * `capMutate` swallows an absent router or method to `null` exactly as
 * `capQuery` does, and `capMutateOrThrow` throws "<cap>.<method> is not
 * available" at the operator — a wrong name there is the same defect wearing a
 * different coat, so the guard watches the write path too.
 */
const CALL = /cap(?:Query|MutateOrThrow|Mutate)\s*\(\s*([\s\S]{0,400}?)\)\s*(?:as|;|,|\n|\.)/g
const failures = []
const unchecked = []
const knownBroken = new Set()
const ahead = new Set()
let checked = 0

for (const file of sources('src')) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(CALL)) {
    const line = text.slice(0, match.index).split('\n').length
    const literals = [...match[1].matchAll(/'([A-Za-z0-9_-]+)'/g)].map((m) => m[1])
    if (literals.length < 2) {
      unchecked.push(`${file}:${line}`)
      continue
    }
    const [cap, method] = literals
    if (NON_CAPABILITY_ROUTERS.has(cap)) continue
    checked += 1
    const entry = BY_ROUTER_KEY.get(cap)
    const resolves = entry !== undefined && entry.methods.has(method)
    const key = `${cap}.${method}`
    if (AHEAD_OF_PUBLISHED.has(key)) {
      if (resolves) {
        failures.push(
          `${file}:${line} — '${key}' is in AHEAD_OF_PUBLISHED but the published types carry it now. Delete the entry.`,
        )
      } else {
        ahead.add(key)
      }
      continue
    }
    if (KNOWN_BROKEN.has(key)) {
      // A stale exemption is worse than none: it reads as verification.
      if (resolves) {
        failures.push(
          `${file}:${line} — '${key}' is listed in KNOWN_BROKEN but now RESOLVES. Delete the entry.`,
        )
      } else {
        knownBroken.add(key)
      }
      continue
    }
    if (entry === undefined) {
      failures.push(`${file}:${line} — no capability answers to '${cap}'`)
    } else if (!entry.methods.has(method)) {
      failures.push(`${file}:${line} — '${cap}' (${entry.name}) has no method '${method}'`)
    }
  }
}

if (failures.length > 0) {
  console.error(`✘ capQuery names a capability or method that does not exist:\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    `\n  These are STRING literals: TypeScript cannot see them, and capQuery\n` +
      `  answers null rather than throwing — so the screen goes empty instead\n` +
      `  of failing. Check @camstack/types (the PUBLISHED one, which is what\n` +
      `  this app resolves) and publish the server package if the name is new.\n`,
  )
  process.exit(1)
}
console.log(
  `✓ capQuery names: ${checked} literal call(s) across ${CAPS.size} capabilities, all resolve` +
    (unchecked.length > 0 ? ` — ${unchecked.length} built at runtime and unchecked: ${unchecked.join(', ')}` : ''),
)
if (ahead.size > 0) {
  console.log(`  …and ${ahead.size} ahead of the published types (ship after the server train): ${[...ahead].join(', ')}`)
}
if (knownBroken.size > 0) {
  console.log(`  …and ${knownBroken.size} KNOWN BROKEN, still owed a fix: ${[...knownBroken].join(', ')}`)
}
