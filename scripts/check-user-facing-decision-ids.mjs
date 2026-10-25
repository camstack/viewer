/**
 * Refuse an internal decision id (`D550`, `ADR-0550`) in text the app shows.
 *
 * ## What it prevents
 *
 * Decision ids index the hub's `docs/decisions/` records — something an
 * operator cannot open and should not need. Text in this app says what a thing
 * does and what to do. Code comments keep their ids; this guard never reads
 * them, because it parses the sources with the TypeScript compiler instead of
 * grepping them.
 *
 * ## What it reads
 *
 * - `locales/*.json` — every value.
 * - Every non-test `.tsx` under `src/`, `app/` and `embed/src/`: every string
 *   literal, template part and JSX text, except module specifiers, literal
 *   TYPES and the arguments of a logger / console call.
 * - Every non-test `.ts` there: the values of UI-facing properties (`label`,
 *   `title`, `description`, `message`, …) and the first argument of
 *   `new <Anything>Error(…)` and of `super(…)` in an Error subclass — an error
 *   message can reach the screen.
 *
 * Mirrors the hub's `scripts/check-user-facing-decision-ids.ts` (hub D727).
 *
 * Run: `node scripts/check-user-facing-decision-ids.mjs` (wired into `ts-check`).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DECISION_ID = /\bD\d{1,4}\b|\badr[- ]?\d+\b/i
const SOURCE_ROOTS = ['src', 'app', 'embed/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__'])
const TEST_FILE = /\.(spec|test|stories)\.tsx?$|\.d\.ts$/
const LOGGER_CALL = /(^|\.)(log|logger|console)\??\.(trace|debug|info|warn|error|log)$/

const UI_KEYS = new Set([
  'label', 'description', 'title', 'placeholder', 'help', 'helpText', 'hint', 'tooltip',
  'message', 'caption', 'subtitle', 'summary', 'heading', 'emptyText', 'emptyMessage',
  'errorMessage', 'confirmText', 'confirmLabel', 'accessibilityLabel', 'accessibilityHint',
  'aria-label', 'alt', 'body', 'text', 'detail', 'note', 'warning', 'explanation',
])

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(e.name) && !TEST_FILE.test(e.name)) out.push(full)
  }
  return out
}

/** The literal text a value expression can render, without entering function bodies. */
function stringsOf(node, out) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node)
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head)
    for (const span of node.templateSpans) {
      out.push(span.literal)
      stringsOf(span.expression, out)
    }
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    stringsOf(node.expression, out)
  } else if (ts.isConditionalExpression(node)) {
    stringsOf(node.whenTrue, out)
    stringsOf(node.whenFalse, out)
  } else if (ts.isBinaryExpression(node)) {
    stringsOf(node.left, out)
    stringsOf(node.right, out)
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) stringsOf(el, out)
  } else if (ts.isJsxExpression(node) && node.expression) stringsOf(node.expression, out)
}

const isStringPart = (n) =>
  ts.isStringLiteral(n) ||
  ts.isNoSubstitutionTemplateLiteral(n) ||
  ts.isTemplateHead(n) ||
  ts.isTemplateMiddle(n) ||
  ts.isTemplateTail(n) ||
  ts.isJsxText(n)

function propName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`
  return undefined
}

export function scanSource(rel, src) {
  const tsx = rel.endsWith('.tsx')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const findings = []
  const seen = new Set()
  const judge = (node, where) => {
    const start = node.getStart(sf)
    if (seen.has(start) || !DECISION_ID.test(node.text)) return
    seen.add(start)
    const line = sf.getLineAndCharacterOfPosition(start).line + 1
    findings.push({ file: rel, line, where, text: node.text.trim().replace(/\s+/g, ' ') })
  }
  const judgeValue = (value, where) => {
    const strings = []
    stringsOf(value, strings)
    for (const s of strings) judge(s, where)
  }
  const visit = (node) => {
    if (tsx) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return
      if (ts.isCallExpression(node) && LOGGER_CALL.test(node.expression.getText(sf))) return
      if (isStringPart(node)) judge(node, ts.isJsxText(node) ? 'JSX text' : 'UI string')
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = propName(node.name)
      if (name && UI_KEYS.has(name)) judgeValue(node.initializer, `${name}=`)
    } else if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name)
      if (name && UI_KEYS.has(name)) judgeValue(node.initializer, `${name}:`)
    } else if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(sf)) && node.arguments?.[0]) {
      judgeValue(node.arguments[0], `new ${node.expression.getText(sf)}()`)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
      for (const arg of node.arguments) judgeValue(arg, 'super()')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

export function scanLocale(rel, src) {
  return src.split('\n').flatMap((line, i) =>
    DECISION_ID.test(line) ? [{ file: rel, line: i + 1, where: 'locale', text: line.trim() }] : [],
  )
}

function main() {
  const findings = []
  for (const name of readdirSync(join(ROOT, 'locales'))) {
    if (!name.endsWith('.json')) continue
    const rel = join('locales', name)
    findings.push(...scanLocale(rel, readFileSync(join(ROOT, rel), 'utf8')))
  }
  let count = 0
  for (const r of SOURCE_ROOTS) {
    for (const full of walk(join(ROOT, r), [])) {
      count++
      const src = readFileSync(full, 'utf8')
      if (DECISION_ID.test(src)) findings.push(...scanSource(relative(ROOT, full), src))
    }
  }
  if (findings.length === 0) {
    console.log(`check-user-facing-decision-ids: OK (${count} sources + locales)`)
    return
  }
  for (const f of findings) {
    const at = Math.max(0, (DECISION_ID.exec(f.text)?.index ?? 0) - 80)
    console.error(`${f.file}:${f.line}  [${f.where}]  ${at > 0 ? '…' : ''}${f.text.slice(at, at + 160)}`)
  }
  console.error(
    `\n${findings.length} user-facing string(s) cite an internal decision id. Say what the thing does and ` +
      'what to do; keep the id in a code comment if the link matters to developers.',
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
