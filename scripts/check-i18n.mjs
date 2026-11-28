/**
 * The viewer's translation census and guard.
 *
 * ## What it prevents
 *
 * A string typed straight into a screen ships in English to an Italian
 * operator, and a key added to one locale renders as the dotted key itself in
 * the other (i18next does not throw). Both happened repeatedly before this
 * guard; each was found by eye, one screen at a time.
 *
 * ## What it reads
 *
 * - `locales/en.json` and `locales/it.json`: the key sets must be identical,
 *   no value may be empty, and both sides of a key must use the same
 *   `{{placeholders}}`.
 * - Every non-test `.ts` / `.tsx` under `src/` and `app/`:
 *   - **hard-coded user-visible text** — JSX text, string literals rendered as
 *     JSX children, and the values of UI-facing props / properties (`title`,
 *     `label`, `placeholder`, `accessibilityLabel`, `message`, …) that contain
 *     a letter. Arguments of `t(…)` / `i18n.t(…)`, logger calls, module
 *     specifiers and literal types are never text.
 *   - **keys that do not exist** — every literal key of a `t('…')` /
 *     `i18n.t('…')` call must resolve in both locales (plural keys resolve
 *     through their `_one` / `_other` forms).
 *
 * `embed/` is out of scope: the embed player has no i18n by design
 * (`embed/src/embed/tile-labels.ts`).
 *
 * ## What may stay
 *
 * - A text in `PINNED_TEXT` below: a brand, a protocol or a unit that reads
 *   the same in every language, with the reason.
 * - A line carrying `// i18n-ok: <reason>` (or `{/* i18n-ok: <reason> *\/}`),
 *   on the line itself or in the comment leading the literal or any node
 *   around it (one pin above a table covers the table): a developer-only
 *   surface, a sample value, a value that is never drawn. The reason is
 *   required.
 * - A module whose header carries `i18n-ok-file: <reason>`: a transport or
 *   diagnostic module whose messages are logged and reported, never copy.
 *   Its `t()` keys are still checked.
 *
 * Run: `node scripts/check-i18n.mjs` (wired into `ts-check`);
 * `--list` prints every finding, `--json` the census as JSON.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOTS = ['src', 'app']
const LOCALES = ['en', 'it']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__', 'testing'])
const TEST_FILE = /\.(spec|test|stories)\.tsx?$|\.d\.ts$/
const LOGGER_CALL = /(^|\.)(log|logger|console|Sentry)\??\.(trace|debug|info|warn|error|log|captureMessage)$/
const T_CALL = /^(t|i18n\.t|i18next\.t|tr|translate)$/
const LETTER = /\p{L}/u
const PIN_COMMENT = /i18n-ok:\s*\S/
/** A string shaped like a key under one of the locale roots (`v2.…`, `eventKind.…`). */
const KEY_LIKE = /^(v2|devices|common|grids|nav|cameras|events|settings|reel|prototype|eventKind)\.[\w-]+(\.[\w-]+)*$/
const PIN_FILE = /i18n-ok-file:\s*\S/

/** Props / properties whose value is shown to (or read aloud for) the operator. */
export const UI_KEYS = new Set([
  'label', 'description', 'title', 'placeholder', 'help', 'helpText', 'hint', 'tooltip',
  'message', 'caption', 'subtitle', 'summary', 'heading', 'emptyText', 'emptyMessage',
  'emptyTitle', 'emptyLabel', 'errorMessage', 'confirmText', 'confirmLabel', 'cancelLabel',
  'okLabel', 'actionLabel', 'buttonLabel', 'accessibilityLabel', 'accessibilityHint',
  'aria-label', 'alt', 'body', 'detail', 'note', 'warning', 'explanation', 'headerTitle',
  'subtitleText', 'titleText', 'sublabel', 'subLabel', 'badge', 'emptyHint', 'unit',
  'destructiveLabel', 'submitLabel', 'reason',
])

/** Properties that hold the i18n DEFAULT of a key sitting next to them. */
const I18N_DEFAULT_KEYS = new Set(['fallback', 'fallbackLabel', 'defaultValue'])

/**
 * Text that is the same in every language. Matched against the trimmed
 * literal; a reason per entry.
 */
export const PINNED_TEXT = new Map([
  ['Dominevo', 'product name'],
  ['Dominevo', 'product name'],
  ['Dominevo Viewer', 'product name'],
  ['Dominevo desktop', 'product name of the desktop app'],
  ['HH:MM', 'time-of-day format, written the same in both languages'],
  ['Home Assistant', 'product name of the integration the operator installed'],
  ['MQTT', 'protocol name'],
  ['RTSP', 'protocol name'],
  ['WebRTC', 'protocol name'],
  ['HLS', 'protocol name'],
  ['ONVIF', 'protocol name'],
  ['HTTP', 'protocol name'],
  ['HTTPS', 'protocol name'],
  ['URL', 'identical in both languages'],
  ['ID', 'identical in both languages'],
  ['IP', 'identical in both languages'],
  ['LIVE', 'the live-edge badge: the same word in the Italian UI'],
  ['Live', 'the same word in the Italian UI'],
  ['PTZ', 'camera control acronym'],
  ['FPS', 'unit'],
  ['fps', 'unit'],
  ['ms', 'unit'],
  ['s', 'unit'],
  ['h', 'unit'],
  ['m', 'unit'],
  ['MB', 'unit'],
  ['GB', 'unit'],
  ['KB', 'unit'],
  ['kbps', 'unit'],
  ['Mbps', 'unit'],
  ['dB', 'unit'],
  ['dBFS', 'unit'],
  ['px', 'unit'],
  ['x', 'multiplication sign spelled as a letter'],
  ['×', 'multiplication sign'],
  ['H.264', 'codec name'],
  ['H.265', 'codec name'],
  ['HEVC', 'codec name'],
  ['JPEG', 'format name'],
  ['MP4', 'format name'],
  ['HD', 'quality badge, identical in both languages'],
  ['SD', 'quality badge, identical in both languages'],
  ['4K', 'quality badge'],
  ['OK', 'identical in both languages'],
  ['Google', 'product name'],
  ['Apple', 'product name'],
  ['Face ID', 'product name'],
  ['Touch ID', 'product name'],
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

/** The literal text a value expression can render, without entering function bodies or `t()` calls. */
function stringsOf(node, out) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node)
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head)
    for (const span of node.templateSpans) {
      out.push(span.literal)
      stringsOf(span.expression, out)
    }
  } else if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    stringsOf(node.expression, out)
  } else if (ts.isConditionalExpression(node)) {
    stringsOf(node.whenTrue, out)
    stringsOf(node.whenFalse, out)
  } else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.PlusToken) {
      stringsOf(node.left, out)
      stringsOf(node.right, out)
    } else if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      // `x && 'text'` renders the right side; `x ?? 'text'` / `x || 'text'` the fallback.
      if (op !== ts.SyntaxKind.AmpersandAmpersandToken) stringsOf(node.left, out)
      stringsOf(node.right, out)
    }
  } else if (ts.isJsxExpression(node) && node.expression) stringsOf(node.expression, out)
}

function propName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`
  return undefined
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim()

/** Text an operator would read: a letter, and not a key/identifier/path/format token. */
export function looksLikeText(raw, { prose } = { prose: false }) {
  const text = normalise(raw)
  if (!LETTER.test(text)) return false
  if (PINNED_TEXT.has(text)) return false
  // Strip interpolation fragments and punctuation, then judge what is left.
  const words = text.replace(/[^\p{L}\s']/gu, ' ').trim()
  if (words.length === 0) return false
  if (PINNED_TEXT.has(words)) return false
  if (words.split(/\s+/).every((w) => PINNED_TEXT.has(w))) return false
  if (prose) {
    // A property value in plain code: an identifier, an i18n key, a route or
    // an enum member is not text. Require a space or a capitalised word.
    if (/^[\w.:/#@-]+$/.test(text) && !/^[A-Z][a-z]/.test(text)) return false
    if (/^[a-z][\w]*(\.[\w-]+)+$/.test(text)) return false
  }
  return true
}

const WORD = /\p{L}{2,}/gu
/** Words a person would read: two or more words of letters, nothing that reads as code. */
export function looksLikeProse(raw) {
  const text = normalise(raw)
  // Operator copy is sentence case; a lowercase phrase in plain code is a
  // diagnostic (`'not connected'`), and is caught where it is RENDERED instead.
  if (!/^[\p{Lu}¿¡]/u.test(text)) return false
  if (/[{}<>=;$\\|]|=>|\w\(|^\w+:\/\/|\w\.\w|_\w/.test(text)) return false
  return (text.match(WORD) ?? []).length >= 2 && /\s/.test(text)
}

function isProseLiteral(node) {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
    looksLikeProse(node.text)
  )
}

/**
 * The message of a thrown / rejected error is a diagnostic: it is logged and
 * reported to the hub, and a screen maps the failure to a translated key.
 */
function isDiagnostic(node, sf) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isThrowStatement(p)) return true
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText(sf))) return true
    if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.SuperKeyword || /(^|\.)reject$/.test(p.expression.getText(sf)))) return true
    if (ts.isFunctionLike(p) || ts.isSourceFile(p) || ts.isBlock(p)) return false
  }
  return false
}

/** `labelKey: '…'`, `titleKey: '…'`, `translationKey: '…'`: a property that names a locale key. */
function isKeyProperty(p) {
  if (!ts.isPropertyAssignment(p)) return false
  const name = propName(p.name)
  return name !== undefined && /[a-z]Key$/.test(name)
}

/**
 * One capitalised word handed back as a value (`return 'Crop'`,
 * `on ? 'Live' : 'Off'`): the shape of a label chosen in code.
 */
function isRenderedWord(node) {
  if (!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return false
  if (!/^\p{Lu}\p{Ll}{2,}$/u.test(node.text)) return false
  const p = node.parent
  return (
    ts.isReturnStatement(p) ||
    (ts.isArrowFunction(p) && p.body === node) ||
    (ts.isConditionalExpression(p) && p.condition !== node)
  )
}

/** A literal that is compared, matched or used as a key is not shown. */
const MATCH_CALL = /\.(includes|startsWith|endsWith|indexOf|match|test|replace|split|getItem|setItem|removeItem)$/
function isNonTextPosition(node, sf) {
  const p = node.parent
  if (!p) return false
  if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) return true
  if (ts.isCaseClause(p) || ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isElementAccessExpression(p)) return true
  if (ts.isCallExpression(p) && MATCH_CALL.test(p.expression.getText(sf))) return true
  if (ts.isCallExpression(p) && /^(describe|it|test|require)$/.test(p.expression.getText(sf))) return true
  return isDiagnostic(node, sf)
}

function isInsideCall(node, sf, pattern) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && pattern.test(p.expression.getText(sf))) return true
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false
  }
  return false
}

/**
 * Pinned when its own line carries `i18n-ok: <reason>`, or when the comment
 * leading the literal or any enclosing node (a property, a declaration, a JSX
 * element) does — so one pin above a table covers the table.
 */
function pinnedByComment(sf, node, lines) {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
  if (PIN_COMMENT.test(lines[line] ?? '')) return true
  for (let p = node; p && !ts.isSourceFile(p); p = p.parent) {
    const ranges = ts.getLeadingCommentRanges(sf.text, p.getFullStart()) ?? []
    if (ranges.some((r) => PIN_COMMENT.test(sf.text.slice(r.pos, r.end)))) return true
    // A JSX comment `{/* i18n-ok: … */}` is an expression sibling, not a leading comment.
    if (ts.isJsxElement(p.parent ?? p) || ts.isJsxFragment(p.parent ?? p)) {
      const siblings = p.parent.children
      const i = siblings.indexOf(p)
      for (let j = i - 1; j >= 0; j--) {
        const sib = siblings[j]
        if (ts.isJsxText(sib) && sib.text.trim() === '') continue
        if (ts.isJsxExpression(sib) && !sib.expression && PIN_COMMENT.test(sib.getText(sf))) return true
        break
      }
    }
  }
  return false
}

/**
 * Scan one source file.
 * @returns {{ strings: Array<{file:string,line:number,where:string,text:string}>, keys: Array<{file:string,line:number,key:string}>, dynamicKeys: number }}
 */
export function scanSource(rel, src) {
  const tsx = rel.endsWith('.tsx')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = src.split('\n')
  const strings = []
  const keys = []
  const keyLiterals = []
  let dynamicKeys = 0
  const seen = new Set()
  const filePinned = PIN_FILE.test(src)
  const judge = (node, where, prose) => {
    if (filePinned) return
    const start = node.getStart(sf)
    if (seen.has(start)) return
    seen.add(start)
    if (!looksLikeText(node.text, { prose })) return
    if (isInsideCall(node, sf, T_CALL) || isInsideCall(node, sf, LOGGER_CALL)) return
    if (pinnedByComment(sf, node, lines)) return
    const line = sf.getLineAndCharacterOfPosition(start).line + 1
    strings.push({ file: rel, line, where, text: normalise(node.text) })
  }
  const judgeValue = (value, where, prose) => {
    const found = []
    stringsOf(value, found)
    for (const s of found) judge(s, where, prose)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      if (LOGGER_CALL.test(callee)) return
      if (T_CALL.test(callee) && node.arguments[0]) {
        const arg = node.arguments[0]
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1
          keys.push({ file: rel, line, key: arg.text })
        } else dynamicKeys++
      }
    }
    if (isProseLiteral(node) && !isNonTextPosition(node, sf)) judge(node, 'prose literal', false)
    else if (isRenderedWord(node)) judge(node, 'word literal', false)
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && KEY_LIKE.test(node.text) && isKeyProperty(node.parent) && !isInsideCall(node, sf, T_CALL)) {
      // A key carried as data (`labelKey: 'v2.clips.sourceHksv'`) is checked like a `t()` argument.
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
      keyLiterals.push({ file: rel, line, key: node.text })
    }
    if (tsx && ts.isJsxText(node)) judge(node, 'JSX text', false)
    if (tsx && ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      judgeValue(node.expression, 'JSX child', false)
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = propName(node.name)
      if (name && UI_KEYS.has(name)) judgeValue(node.initializer, `${name}=`, false)
    } else if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name)
      // The default of a key (`{ key, fallback }`, `t(key, { defaultValue })`)
      // is never drawn while the key exists, and the key itself is checked.
      if (name && I18N_DEFAULT_KEYS.has(name)) return
      if (name && UI_KEYS.has(name)) judgeValue(node.initializer, `${name}:`, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { strings, keys, keyLiterals, dynamicKeys }
}

export function flatten(tree, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object') flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const placeholders = (v) => [...String(v).matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',')

/** Locale parity: same keys, no empty value, same placeholders. */
export function localeReport(locales) {
  const [baseName, ...others] = Object.keys(locales)
  const issues = []
  const all = new Set(Object.values(locales).flatMap((m) => [...m.keys()]))
  for (const key of all) {
    for (const [name, map] of Object.entries(locales)) {
      if (!map.has(key)) issues.push(`missing in ${name}: ${key}`)
      else if (typeof map.get(key) !== 'string' || map.get(key).trim() === '') issues.push(`empty in ${name}: ${key}`)
    }
    const base = locales[baseName].get(key)
    // A singular form may say "one" instead of printing `{{count}}`.
    const ignore = /_(zero|one|two)$/.test(key) ? 'count' : ''
    const slots = (v) => placeholders(v).split(',').filter((p) => p !== '' && p !== ignore).join(',')
    for (const name of others) {
      const other = locales[name].get(key)
      if (typeof base === 'string' && typeof other === 'string' && slots(base) !== slots(other)) {
        issues.push(`placeholders differ ${baseName}/${name}: ${key} ({{${placeholders(base)}}} vs {{${placeholders(other)}}})`)
      }
    }
  }
  return { issues, keyCount: Object.fromEntries(Object.entries(locales).map(([n, m]) => [n, m.size])) }
}

/** A key resolves if it is a leaf, or a plural base whose forms exist. */
export function resolves(map, key) {
  if (map.has(key)) return true
  return [...map.keys()].some((k) => PLURAL_SUFFIX.test(k) && k.replace(PLURAL_SUFFIX, '') === key)
}

export function census(root = ROOT) {
  const locales = Object.fromEntries(
    LOCALES.map((n) => [n, flatten(JSON.parse(readFileSync(join(root, 'locales', `${n}.json`), 'utf8')))]),
  )
  const { issues, keyCount } = localeReport(locales)
  const strings = []
  const missingKeys = []
  let dynamicKeys = 0
  let files = 0
  for (const r of SOURCE_ROOTS) {
    for (const full of walk(join(root, r), [])) {
      files++
      const rel = relative(root, full)
      const res = scanSource(rel, readFileSync(full, 'utf8'))
      strings.push(...res.strings)
      dynamicKeys += res.dynamicKeys
      for (const k of [...res.keys, ...res.keyLiterals]) {
        for (const [name, map] of Object.entries(locales)) {
          if (!resolves(map, k.key)) missingKeys.push({ ...k, locale: name })
        }
      }
    }
  }
  return { files, keyCount, localeIssues: issues, strings, missingKeys, dynamicKeys }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const c = census()
  if (args.has('--json')) {
    console.log(JSON.stringify(c, null, 2))
    return
  }
  const byFile = new Map()
  for (const s of c.strings) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1)
  const failed = c.strings.length + c.missingKeys.length + c.localeIssues.length
  const summary =
    `check-i18n: ${c.files} sources; keys ${Object.entries(c.keyCount).map(([n, k]) => `${n}=${k}`).join(' ')}; ` +
    `hard-coded strings ${c.strings.length} in ${byFile.size} files; missing t() keys ${c.missingKeys.length}; ` +
    `locale issues ${c.localeIssues.length}; dynamic t() keys (not checkable) ${c.dynamicKeys}`
  if (failed === 0) {
    console.log(`${summary} — OK`)
    return
  }
  const list = args.has('--list') || failed <= 60
  if (list) {
    for (const i of c.localeIssues) console.error(`locales  ${i}`)
    for (const k of c.missingKeys) console.error(`${k.file}:${k.line}  [t() key missing in ${k.locale}]  ${k.key}`)
    for (const s of c.strings) console.error(`${s.file}:${s.line}  [${s.where}]  ${s.text.slice(0, 120)}`)
  } else {
    for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.error(`${String(n).padStart(4)}  ${f}`)
  }
  console.error(
    `\n${summary}\nEvery user-visible string goes through t('…') with a key in BOTH locales/en.json and locales/it.json. ` +
      'Text that is the same in every language: PINNED_TEXT in scripts/check-i18n.mjs, or `// i18n-ok: <reason>` on the line.',
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
