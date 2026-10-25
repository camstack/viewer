#!/usr/bin/env node
/**
 * The viewer's local UI toolbox (no MCP, no network):
 *
 *   npm run ui:find -- "<need>"        kit components for a need
 *   npm run ui:show -- <Name>          one export: file, summary, props, call sites
 *   npm run ui:tokens                  the colour tokens (dark / light)
 *   npm run ui:check -- <files|dirs…>  off-system UI shapes, each with its replacement
 *       --warn     print, always exit 0     --summary  counts per rule
 *   npm run ui:catalogue [-- --check]  rewrite / verify the snapshot docs/ui-components.json
 *   npm run ui:pointers [-- --check]   rewrite / verify the AGENTS.md block + Cursor rule
 *
 * `ui:check` is a developer tool and is never a CI gate.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCatalogue, CATALOGUE_PATH, renderCatalogue } from './catalogue.mjs'
import { AGENTS_PATH, MDC_PATH, renderBlock, renderMdc, spliceBlock } from './pointers.mjs'
import { checkViewerSource, isCheckedFile, summarize } from './ui-check-rules.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = (line = '') => process.stdout.write(`${line}\n`)

/**
 * Built LIVE from the source (tens of milliseconds), so a search never
 * answers from a stale snapshot. The committed `docs/ui-components.json` is
 * the same data for readers without node; `npm run ui:catalogue` refreshes it.
 */
function loadCatalogue() {
  return buildCatalogue(ROOT)
}

const terms = (text) =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)

function rank(entries, query) {
  const q = terms(query)
  return entries
    .map((e) => {
      const name = terms(e.name)
      const text = terms(`${e.summary} ${(e.props ?? []).map((p) => p.name).join(' ')}`)
      let s = 0
      for (const t of q) {
        if (name.includes(t)) s += 4
        else if (name.some((n) => n.startsWith(t) && t.length >= 4)) s += 2
        if (text.includes(t)) s += 1
      }
      return { e, s: s > 0 && e.kind === 'component' ? s + 1 : s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e)
}

function find(query) {
  const hits = rank(loadCatalogue().entries, query).slice(0, 12)
  if (hits.length === 0) out('No kit export matches. Check docs/ui/need-x-use-y.md in the server repo, then build in src/components/ui/.')
  for (const e of hits) out(`${e.name.padEnd(26)} ${e.kind.padEnd(9)} ${e.file}${e.summary ? `\n${' '.repeat(37)}${e.summary.slice(0, 110)}` : ''}`)
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else acc.push(path.relative(ROOT, p).split(path.sep).join('/'))
  }
  return acc
}

function show(name) {
  const c = loadCatalogue()
  const e = c.entries.find((x) => x.name === name) ?? c.entries.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!e) {
    out(`"${name}" is not in the viewer kit catalogue.`)
    process.exit(1)
  }
  out(`${e.name}  (${e.kind})`)
  out(`  file: ${e.file}`)
  if (e.summary) out(`  ${e.summary}`)
  for (const p of e.props ?? []) {
    out(`    ${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    if (p.doc) out(`        ${p.doc}`)
  }
  const re = new RegExp(`\\b${e.name}\\b`)
  const users = ['src', 'app']
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => f.endsWith('.tsx') && f !== e.file && !f.includes('__tests__') && re.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  out(`  used in ${users.length} file(s)${users.length ? ', e.g.:' : ''}`)
  for (const f of users.slice(0, 3)) out(`    ${f}`)
}

function tokens() {
  out('Viewer colours — src/theme/tokens.ts, read with useTheme().colors.<key>')
  out('The web twin of each key is its kebab-case name in the server repo\'s camstack-theme.css (foregroundMuted ↔ foreground-muted).')
  for (const t of loadCatalogue().colors) out(`  ${t.key.padEnd(20)} ${t.dark.padEnd(9)} ${t.light ?? '—'}`)
}

function check(args) {
  const warn = args.includes('--warn')
  const summaryOnly = args.includes('--summary')
  const targets = args.filter((a) => !a.startsWith('--'))
  const files = targets
    .flatMap((t) => {
      const abs = path.resolve(ROOT, t)
      if (!fs.existsSync(abs)) return []
      return fs.statSync(abs).isDirectory() ? walk(abs) : [path.relative(ROOT, abs).split(path.sep).join('/')]
    })
    .filter(isCheckedFile)
  if (files.length === 0) {
    out('usage: npm run ui:check -- <files|dirs…> [--summary] [--warn]')
    process.exit(2)
  }
  const hexTokens = new Map()
  for (const t of loadCatalogue().colors) {
    if (!hexTokens.has(t.dark.toLowerCase())) hexTokens.set(t.dark.toLowerCase(), t.key)
    if (t.light && !hexTokens.has(t.light.toLowerCase())) hexTokens.set(t.light.toLowerCase(), t.key)
  }
  const findings = files.flatMap((f) => checkViewerSource(f, fs.readFileSync(path.join(ROOT, f), 'utf8'), hexTokens))
  if (summaryOnly) {
    const s = summarize(findings)
    out(`ui:check — ${files.length} file(s) scanned, ${findings.length} finding(s) in ${s.files} file(s)`)
    for (const [rule, n] of Object.entries(s.byRule).sort((a, b) => b[1] - a[1])) {
      out(`  ${rule.padEnd(16)} ${String(n).padStart(5)} in ${s.filesByRule[rule]} file(s)`)
    }
    return
  }
  for (const f of findings) out(`${f.file}:${f.line}  ${f.rule}  ${f.message}`)
  out(findings.length === 0 ? `ui:check — ${files.length} file(s), 0 findings` : `ui:check — ${findings.length} finding(s). Fix new ones; a deliberate exception carries \`ui-check-ok: <reason>\`.`)
  if (findings.length > 0 && !warn) process.exit(1)
}

function writeOrCheck(rel, next, isCheck, stale) {
  const abs = path.join(ROOT, rel)
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
  if (current === next) return
  if (isCheck) stale.push(rel)
  else {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, next)
    out(`  wrote ${rel}`)
  }
}

function catalogue(args) {
  const stale = []
  writeOrCheck(CATALOGUE_PATH, renderCatalogue(buildCatalogue(ROOT)), args.includes('--check'), stale)
  if (stale.length > 0) {
    console.error(`✘ ${CATALOGUE_PATH} is stale — run \`npm run ui:catalogue\``)
    process.exit(1)
  }
}

function pointers(args) {
  const isCheck = args.includes('--check')
  const stale = []
  const agents = fs.readFileSync(path.join(ROOT, AGENTS_PATH), 'utf8')
  writeOrCheck(AGENTS_PATH, spliceBlock(agents, renderBlock()), isCheck, stale)
  writeOrCheck(MDC_PATH, renderMdc(), isCheck, stale)
  if (stale.length > 0) {
    console.error(`✘ UI pointers stale: ${stale.join(', ')} — run \`npm run ui:pointers\``)
    process.exit(1)
  }
}

const [command, ...rest] = process.argv.slice(2)
const commands = {
  find: () => find(rest.join(' ')),
  show: () => show(rest[0] ?? ''),
  tokens,
  check: () => check(rest),
  catalogue: () => catalogue(rest),
  pointers: () => pointers(rest),
}
if (commands[command]) commands[command]()
else {
  out('usage: node scripts/ui/cli.mjs <find|show|tokens|check|catalogue|pointers> …')
  process.exit(2)
}
