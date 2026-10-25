/**
 * Every body handed to `guardWorklet` is itself a worklet — checked against
 * the REAL babel plugin, not against vitest's plain-JS reading of the file.
 *
 * ## The regression this exists for (1.0.479 → 1.0.483)
 *
 * `guardWorklet(scope, body)` returns a worklet that calls `body` on the UI
 * runtime. The worklets babel plugin workletizes a function in exactly two
 * cases: it carries a `'worklet'` directive, or it is the DIRECT argument of a
 * builder method it knows (`.onStart`, `.onUpdate`, `.onTouchesDown`, …).
 * Wrapping the callback in `guardWorklet(...)` took it out of the second case,
 * and none of the ten bodies carried the directive — so every one of them was
 * captured into the guard's closure as a plain JS function, which the worklets
 * runtime ships to the UI thread as a Remote Function whose only behaviour is
 * to throw:
 *
 *   [Worklets] Tried to synchronously call a Remote Function.
 *   Called "anonymous" on the UI Runtime.
 *
 * The guard did exactly what it promised — caught it and reported it — which is
 * how the hub logged 97 `app:error:worklet:zoom.*` lines between 2026-09-10
 * 14:01Z and 2026-09-11 06:51Z while the operator's pinch and pan were
 * "completely dead". The last successful `zoom pinch end` on the hub is
 * 2026-09-09 16:08Z, before 1.0.479 shipped the guard. The joystick's four
 * bodies had the same defect; nobody had driven it since.
 *
 * `worklet-guard.spec.ts` was green throughout: vitest applies no worklets
 * plugin, so under it `body` is a plain function called by a plain function
 * and the fake supplies what production does not. This spec closes that gap
 * by running `babel-preset-expo` — the preset metro uses, plugin included —
 * over every call site in `src/` and refusing a body the plugin left as a
 * bare function expression.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '..', '..')
const packageJson = resolve(srcRoot, '..', 'package.json')
const require = createRequire(packageJson)

/** The two babel entry points this spec uses; `@babel/core` ships no types
 *  and this repo declares no `@types/babel__core`, so the boundary is typed
 *  here, narrowly, rather than borrowed from a sibling `node_modules`. */
interface BabelTransformResult {
  readonly code: string | null
}
interface AstNode {
  readonly type: string
}
interface BabelCoreLike {
  transformFileSync(file: string, options: Record<string, unknown>): BabelTransformResult | null
  parseSync(code: string, options: Record<string, unknown>): AstNode | null
}

const babel: BabelCoreLike = require('@babel/core')
const presetExpo: string = require.resolve('babel-preset-expo')

/** Files under `src/` that call `guardWorklet(` — the guard's own module and
 *  the specs excluded. Walked, not listed, so a new call site is covered the
 *  day it is written. */
function guardCallSites(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'testing') continue
      found.push(...guardCallSites(full))
      continue
    }
    if (!/\.tsx?$/.test(entry) || entry === 'worklet-guard.ts') continue
    if (readFileSync(full, 'utf8').includes('guardWorklet(')) found.push(full)
  }
  return found
}

/** Transform as metro would for an iOS release: the preset is the one the app
 *  bundles with, so what this reads is what the device runs. */
function transformAsMetro(file: string): string {
  const out = babel.transformFileSync(file, {
    presets: [[presetExpo, {}]],
    caller: { name: 'metro', platform: 'ios', isDev: false, supportsStaticESM: false },
    babelrc: false,
    configFile: false,
    compact: false,
  })
  if (out === null || out.code === null) throw new Error(`babel produced no code for ${file}`)
  return out.code
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
}

/** `(0, _workletGuard.guardWorklet)(...)` is how babel's CommonJS transform
 *  writes an imported call: the callee is a sequence whose LAST expression is
 *  the member. Peel it. */
function unwrapSequence(node: AstNode): AstNode {
  if (node.type !== 'SequenceExpression') return node
  const expressions = Reflect.get(node, 'expressions')
  const last = Array.isArray(expressions) ? expressions[expressions.length - 1] : undefined
  return isAstNode(last) ? last : node
}

function isGuardCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression') return false
  const rawCallee = Reflect.get(node, 'callee')
  if (!isAstNode(rawCallee)) return false
  const callee = unwrapSequence(rawCallee)
  if (callee.type === 'Identifier') return Reflect.get(callee, 'name') === 'guardWorklet'
  if (callee.type === 'MemberExpression') {
    const property = Reflect.get(callee, 'property')
    return isAstNode(property) && Reflect.get(property, 'name') === 'guardWorklet'
  }
  return false
}

interface GuardCallShape {
  readonly scope: string
  /** The body's node type AFTER the plugin ran. A workletized function is
   *  replaced by a factory call; a bare `ArrowFunctionExpression` /
   *  `FunctionExpression` is one the plugin never touched. */
  readonly bodyType: string
}

/** Every `guardWorklet(scope, body)` call in a transformed module. */
function collectGuardCalls(root: AstNode): GuardCallShape[] {
  const calls: GuardCallShape[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isAstNode(value)) return
    if (isGuardCall(value)) {
      const args = Reflect.get(value, 'arguments')
      const [scopeArg, bodyArg] = Array.isArray(args) ? args : []
      const scope = isAstNode(scopeArg) ? String(Reflect.get(scopeArg, 'value')) : '?'
      const bodyType = isAstNode(bodyArg) ? bodyArg.type : 'missing'
      calls.push({ scope, bodyType })
    }
    for (const key of Object.keys(value)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      visit(Reflect.get(value, key))
    }
  }
  visit(root)
  return calls
}

const BARE_FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression'])

describe('guardWorklet call sites, under the real worklets plugin', () => {
  const files = guardCallSites(srcRoot)

  it('finds the call sites it is meant to police', () => {
    // A walk that finds nothing would pass every assertion below for free.
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  it.each(files)('%s hands guardWorklet only workletized bodies', (file) => {
    const code = transformAsMetro(file)
    const ast = babel.parseSync(code, { sourceType: 'unambiguous', filename: file })
    if (ast === null) throw new Error(`babel produced no AST for ${file}`)
    const calls = collectGuardCalls(ast)
    expect(calls.length).toBeGreaterThan(0)
    const bare = calls.filter((c) => BARE_FUNCTION_TYPES.has(c.bodyType)).map((c) => c.scope)
    // A body the plugin left as a bare function reaches the UI runtime as a
    // Remote Function, and the guard reports it on every frame of the gesture
    // instead of running it. Add `'worklet'` as the body's first statement.
    expect(bare).toEqual([])
  })
})
