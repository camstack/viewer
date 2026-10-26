/**
 * Kind colours come from the hub display palette (D939). A second table —
 * a named constant, or a kind key assigned a hex — must not grow back in
 * the app, the embed, or the shared paint module.
 *
 * Operator highlight overrides (`motionColor`) and the theme `live` token
 * are not kind tables and are left alone. Specs are not scanned.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const SCANNED = ['src', 'app', 'embed/src', 'shared']
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

const FORBIDDEN = [
  'CLASS_COLORS',
  'MOTION_COLOR',
  'AUDIO_COLOR',
  'AUDIO_ACCENT',
  'HIGHLIGHT_COLORS',
  'EVENT_KIND_FALLBACK_COLOR',
  'laneMotion',
  'laneAudio',
  'KIND_COLOR',
]

const KIND_HEX =
  /(?:^|[^\w])(person|vehicle|animal|face|plate|car|truck|motion|audio|recording|heatmapScrub)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/

/**
 * @param {string} source
 * @param {string} file
 * @returns {string[]}
 */
export function kindPaletteViolations(source, file) {
  const hits = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const name of FORBIDDEN) {
      const at = line.indexOf(name)
      if (at < 0) continue
      const before = at === 0 ? '' : line[at - 1]
      const after = line[at + name.length] ?? ''
      if (/[\w$]/.test(before) || /[\w$]/.test(after)) continue
      hits.push(`${file}:${i + 1}: forbidden kind-colour name ${name}`)
    }
    if (KIND_HEX.test(line)) {
      hits.push(`${file}:${i + 1}: kind key assigned a hex literal`)
    }
  }
  return hits
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      walk(full, out)
      continue
    }
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) continue
    if (!EXT.has(path.extname(entry.name))) continue
    out.push(full)
  }
}

/** @returns {string[]} */
export function scanKindPalette() {
  const files = []
  for (const dir of SCANNED) walk(path.join(ROOT, dir), files)
  const hits = []
  for (const file of files) {
    const rel = path.relative(ROOT, file)
    hits.push(...kindPaletteViolations(fs.readFileSync(file, 'utf8'), rel))
  }
  return hits
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const hits = scanKindPalette()
  if (hits.length > 0) {
    console.error(`kind palette: ${hits.length} local kind-colour literal(s)`)
    for (const hit of hits) console.error(hit)
    process.exit(1)
  }
  console.log('kind palette: no local kind-colour table')
}
