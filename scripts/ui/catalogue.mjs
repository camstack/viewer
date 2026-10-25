/**
 * The viewer's UI catalogue — every export of the kit (`src/components/ui/`
 * plus the few shared screen pieces) with its summary and props, and the
 * colour tokens of `src/theme/tokens.ts`. Read syntactically with the
 * TypeScript parser, so it is fast and cannot drift from the source.
 *
 * `ui:find` / `ui:show` build it live. `docs/ui-components.json` is a
 * committed snapshot for readers without node: `npm run ui:catalogue`
 * rewrites it, `--check` says whether it is stale (not run in CI).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

export const CATALOGUE_PATH = 'docs/ui-components.json'
export const KIT_DIR = 'src/components/ui'
/** Shared screen pieces outside the kit directory that every screen reuses. */
export const EXTRA_FILES = ['src/components/ScreenHeader.tsx']
export const TOKENS_FILE = 'src/theme/tokens.ts'

export function summarize(doc) {
  const first = (doc.split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim()
  return first.length > 220 ? `${first.slice(0, 217)}…` : first
}

function jsDoc(node) {
  for (const d of ts.getJSDocCommentsAndTags(node)) {
    if (ts.isJSDoc(d) && d.comment !== undefined) {
      return typeof d.comment === 'string' ? d.comment : d.comment.map((p) => p.text).join('')
    }
  }
  return ''
}

function fileSummary(sf) {
  const m = /^\s*(?:\/\/[^\n]*\n\s*)*\/\*\*([\s\S]*?)\*\//.exec(sf.getFullText())
  if (!m) return ''
  return summarize(m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n'))
}

function isExported(node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function kindOf(name, file, init) {
  if (/^use[A-Z]/.test(name)) return 'hook'
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return 'constant'
  if (/^[A-Z]/.test(name) && file.endsWith('.tsx')) {
    if (!init || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return 'component'
    if (/^(React\.)?(memo|forwardRef)\b/.test(init.getText())) return 'component'
    return 'constant'
  }
  if (init && !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return 'constant'
  return 'function'
}

function propsTypeName(node, init) {
  const ref = (t) => (t && ts.isTypeReferenceNode(t) ? t.typeName.getText() : null)
  if (ts.isFunctionDeclaration(node)) return ref(node.parameters[0]?.type)
  if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return ref(init.parameters[0]?.type)
  if (init && ts.isCallExpression(init)) {
    const inner = init.arguments[0]
    if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return ref(inner.parameters[0]?.type)
  }
  return null
}

function propsOf(sf, typeName) {
  if (!typeName) return null
  for (const stmt of sf.statements) {
    const members =
      ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName
        ? stmt.members
        : ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName && ts.isTypeLiteralNode(stmt.type)
          ? stmt.type.members
          : null
    if (!members) continue
    return members
      .filter((m) => ts.isPropertySignature(m) && m.name)
      .map((m) => ({
        name: m.name.getText(),
        type: (m.type?.getText() ?? 'unknown').replace(/\s+/g, ' ').slice(0, 90),
        optional: m.questionToken !== undefined,
        doc: summarize(jsDoc(m)).slice(0, 140),
      }))
  }
  return null
}

/** Exported values of one file. */
export function fileEntries(root, rel) {
  const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(root, rel), 'utf8'), ts.ScriptTarget.Latest, true)
  const header = fileSummary(sf)
  const out = []
  for (const stmt of sf.statements) {
    if (!isExported(stmt)) continue
    const decls = ts.isFunctionDeclaration(stmt) && stmt.name
      ? [{ name: stmt.name.text, init: undefined }]
      : ts.isVariableStatement(stmt)
        ? stmt.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => ({ name: d.name.text, init: d.initializer }))
        : []
    for (const { name, init } of decls) {
      const kind = kindOf(name, rel, init)
      const props = kind === 'component' ? propsOf(sf, propsTypeName(stmt, init) ?? `${name}Props`) : null
      out.push({
        name,
        kind,
        file: rel,
        summary: summarize(jsDoc(stmt)) || header,
        ...(props ? { props } : {}),
      })
    }
  }
  return out
}

/** `const <label>: ColorTokens = { … }` → Map(key → value). */
export function parseColorBlock(src, label) {
  const m = new RegExp(`const ${label}: ColorTokens = \\{([\\s\\S]*?)\\n\\}`).exec(src)
  const map = new Map()
  if (!m) return map
  for (const kv of m[1].matchAll(/(\w+):\s*'([^']+)'/g)) map.set(kv[1], kv[2])
  return map
}

export function parseTokens(src) {
  const dark = parseColorBlock(src, 'dark')
  const light = parseColorBlock(src, 'light')
  return [...dark].map(([key, value]) => ({ key, dark: value, light: light.get(key) ?? null }))
}

export function buildCatalogue(root) {
  const kit = fs
    .readdirSync(path.join(root, KIT_DIR))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${KIT_DIR}/${f}`)
  const files = [...kit, ...EXTRA_FILES.filter((f) => fs.existsSync(path.join(root, f)))].sort()
  const entries = files.flatMap((f) => fileEntries(root, f)).sort((a, b) => a.name.localeCompare(b.name))
  return {
    generatedBy: 'scripts/ui/cli.mjs catalogue — do not edit; run `npm run ui:catalogue`',
    colors: parseTokens(fs.readFileSync(path.join(root, TOKENS_FILE), 'utf8')),
    entries,
  }
}

export function renderCatalogue(c) {
  const list = (items) => (items.length === 0 ? '[]' : `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]`)
  return ['{', `  "generatedBy": ${JSON.stringify(c.generatedBy)},`, `  "colors": ${list(c.colors)},`, `  "entries": ${list(c.entries)}`, '}', ''].join('\n')
}
