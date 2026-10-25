/**
 * Guard: a Reanimated worklet may only call functions that are worklets.
 *
 * A callback handed to `useAnimatedStyle` / `useDerivedValue` / `withSpring` /
 * `Gesture.*().on*` … runs on the UI thread. A plain JS function called from it
 * is not there and throws; on iOS that is a Hermes `throwPendingError` inside
 * `AnimationFrameBatchinator::flush` and the app aborts (1.0.630 died 0.5 s
 * after launch). Unit tests cannot see it — vitest runs worklets as ordinary JS.
 *
 * Walks every `src/**` and `shared/**` source with the TypeScript parser, finds
 * worklet contexts, and for each plain call `fn(...)` inside one resolves `fn`
 * (same file, or a relative import) and requires a `'worklet'` directive on it,
 * transitively. Member calls (`sv.value.x()`, `manager.fail()`), calls through
 * `runOnJS(...)` and package imports are not judged. A deliberate exception
 * carries `worklet-ok: <reason>` on the call's line.
 *
 * `node scripts/check-worklet-calls.mjs [--dir <root>]`
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : '.')

const HOOKS = new Set([
  'useAnimatedStyle', 'useAnimatedProps', 'useDerivedValue', 'useAnimatedReaction',
  'useAnimatedScrollHandler', 'useAnimatedGestureHandler', 'useFrameCallback', 'runOnUI',
  'withTiming', 'withSpring', 'withDecay', 'withRepeat', 'withSequence', 'withDelay',
])
const GESTURE_EVENTS = new Set([
  'onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize',
  'onTouchesDown', 'onTouchesMove', 'onTouchesUp', 'onTouchesCancelled',
])
/** Callees that exist on the UI runtime already (reanimated's own). */
const BUILTIN = new Set(['runOnJS', 'runOnUI', 'interpolate', 'interpolateColor', 'withTiming', 'withSpring',
  'withDecay', 'withRepeat', 'withSequence', 'withDelay', 'cancelAnimation', 'clamp', 'measure',
  'scrollTo', 'Easing', 'Number', 'String', 'Boolean', 'Math', 'isNaN', 'Array', 'Object'])

const cache = new Map()
function parse(file) {
  if (!cache.has(file)) {
    const text = readFileSync(file, 'utf8')
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    cache.set(file, { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) })
  }
  return cache.get(file)
}

function hasWorklet(fn) {
  const body = fn.body
  if (body === undefined || !ts.isBlock(body)) return false
  const first = body.statements[0]
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet'
}

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''))
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c)) return c
  return null
}

/** Top-level function named `name` in `file`: { fn, file } or null. */
function topLevelFunction(file, name) {
  for (const st of parse(file).sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer
      }
    }
  }
  return null
}

function importedFrom(file, name) {
  for (const st of parse(file).sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue
    for (const el of st.importClause.namedBindings.elements) {
      if (el.name.text === name) {
        const target = resolveImport(file, st.moduleSpecifier.text)
        return { target, exported: (el.propertyName ?? el.name).text, relative: st.moduleSpecifier.text.startsWith('.') }
      }
    }
  }
  return null
}

const problems = []

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart()).line
}

/** Collect plain `ident(...)` calls inside `fn`, skipping names declared inside it. */
function checkBody(file, fn, seen, origin) {
  const { sf, text } = parse(file)
  const declaredInside = new Set()
  const visitDecl = (n) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) declaredInside.add(n.name.text)
    if (ts.isFunctionDeclaration(n) && n.name) declaredInside.add(n.name.text)
    ts.forEachChild(n, visitDecl)
  }
  visitDecl(fn)
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text
      const line = lineOf(sf, n)
      const lineText = text.split('\n')[line] ?? ''
      if (!BUILTIN.has(name) && !declaredInside.has(name) && !lineText.includes('worklet-ok:')) judge(file, name, line, seen, origin)
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(fn.body ?? fn, visit)
}

function judge(file, name, line, seen, origin) {
  let target = file
  let exported = name
  const imp = importedFrom(file, name)
  if (imp !== null) {
    if (!imp.relative || imp.target === null) return
    target = imp.target
    exported = imp.exported
  }
  const fn = topLevelFunction(target, exported)
  if (fn === null) return // a parameter, a shared value, a non-function: not judged
  if (!hasWorklet(fn)) {
    problems.push(`${origin}: calls ${name}() which has no 'worklet' directive (${target.replace(`${ROOT}/`, '')})`)
    return
  }
  const key = `${target}:${exported}`
  if (seen.has(key)) return
  seen.add(key)
  checkBody(target, fn, seen, `${origin} -> ${name}`)
}

function isWorkletContext(node) {
  const call = node.parent
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node)) return false
  const callee = call.expression
  if (ts.isIdentifier(callee)) return HOOKS.has(callee.text)
  if (ts.isPropertyAccessExpression(callee)) {
    if (ts.isIdentifier(callee.name) && HOOKS.has(callee.name.text)) return true
    if (GESTURE_EVENTS.has(callee.name.text)) {
      let chain = callee.expression
      while (chain) {
        if (ts.isCallExpression(chain)) {
          if (ts.isIdentifier(chain.expression) && chain.expression.text === 'runOnJS') return false
          if (ts.isPropertyAccessExpression(chain.expression) && chain.expression.name.text === 'runOnJS'
              && chain.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword) return false
          chain = ts.isPropertyAccessExpression(chain.expression) ? chain.expression.expression : undefined
        } else if (ts.isPropertyAccessExpression(chain)) chain = chain.expression
        else break
      }
      return /Gesture/.test(callee.getText())
    }
  }
  return false
}

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules' || e === '__tests__') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e) && !e.endsWith('.d.ts') && !/\.spec\.tsx?$/.test(e)) out.push(p)
  }
}

const files = []
for (const d of ['src', 'shared']) if (existsSync(join(ROOT, d))) walk(join(ROOT, d), files)
let contexts = 0
for (const file of files) {
  const { sf } = parse(file)
  const visit = (n) => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && isWorkletContext(n)) {
      contexts += 1
      const where = `${file.replace(`${ROOT}/`, '')}:${lineOf(sf, n) + 1}`
      checkBody(file, n, new Set(), where)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

if (problems.length > 0) {
  console.error(`worklet calls: ${problems.length} plain function(s) called from the UI thread —`)
  for (const p of [...new Set(problems)]) console.error(`  ${p}`)
  console.error("Add the 'worklet' directive to the callee (or inline it).")
  process.exit(1)
}
console.log(`worklet calls ok — ${contexts} worklet context(s), every callee is a worklet`)
