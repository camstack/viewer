/**
 * Tree scrub guard — house names, hosts, addresses, rooms and camera ids.
 *
 * The values are stored as hashes so this file, which is public, does not
 * repeat them. Same lists as camstack-server `scripts/check-tree-private-data.ts`,
 * plus the home-directory stem, the employer stem, the store-account local-part
 * and one LAN host that only this repo's still fixtures used.
 *
 * Run: node scripts/check-tree-private-data.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** sha256(lowercase NFC)[0..16]. */
export function termHash(token) {
  return createHash('sha256').update(token.normalize('NFC').toLowerCase()).digest('hex').slice(0, 16)
}

export const PERSON_HASHES = new Set([
  'ec27c5dcb1aba241',
  '926dc6fb2c9459c7',
  'bd3dae5fb91f88a4',
  '05a642215a9ffabd',
  '0da07cfe048ddf1c',
  '58cc6181518fbfb4',
  '5aac48366e75edaf',
  '82e8a5dda420d57d',
  'bc72821ca0faa034', // home-directory and personal-domain stem
  'ee119eb71e4e1e8e', // employer stem
  '77510343668cd659', // store-account local-part
])

export const HOST_HASHES = new Set([
  'ffbdf3346fe9d894',
  'f3f39556097176ef',
  '9630fb853fdd1d9a',
  '442069d9309f9b61',
  'ad2015263f339bff', // also an ML word; see towerIsMl
])

export const ROOM_HASHES = new Set([
  '3ef62019e2ff1b73', // also the Italian word for entry/input
  '135a315c16ea83ae',
  '13337113ce05d55e',
  '46b4eb8144194bab',
  '60e9764981a31bf1',
  '5ce85d37f0c84c52',
  'b77235a7a5e00269',
  '1dd817165d3c0099',
  'f4e6b7a156740be1',
  '17216fd9814fc91b',
])

export const HOME_IP_HASHES = new Set([
  'e41d6b2fda656eef',
  '725b4c8929840ff6',
  '6030d4d6a0d9b264',
  'b3a6c05e6c3e26b2',
  '8dc92b0ba9644d93',
  'b12a705d8feeb382',
  'b5fc5e0389850fc0',
  'fcce5eb16a90e4ae', // LAN host in still fixtures
])

export const CAMERA_ID_HASHES = new Set([
  '3de8392541ace282',
  '85ea151b8c5b5ab0',
  '085bcb597bbd610a',
  'e6fcc0253ed7a328',
  'fa7aec4efb728534',
  '3f1bb7c0da3c01e6',
  '793733573a1dfd14',
  'ee377871c73631fd',
  '219de1387a6743e5',
  '82a93b152b275d4c',
  '298647699bcb31c2',
])

const ENTRY_ROOM_HASH = '3ef62019e2ff1b73'
const BATHROOM_HASH = '60e9764981a31bf1'
const TOWER_HASH = 'ad2015263f339bff'
const BEDROOM_PHRASE = ['89e8b9518d922794', 'aa58b21b01d6b8a9', 'c218787bda9bfe4c']

const ENTRY_BEFORE = /(?:di|in|del|al|col|sul|dal|nel|ritardo|fps|d['’]|dell['’]|all['’])\s*$/i
const IPV4 = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g
const TOKEN = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu
const CAMERA_TOKEN = /(?<![\d.x×A-Za-z@-])(\d{3,4})(?![\dx×@-])/g
const FILE_LINE = /\.(?:ts|tsx|js|mjs|cjs|mts|md|py|go|json|yml|yaml|sh):$/
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mov|woff2?)$/i

function lineOf(text, index) {
  let n = 1
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) n += 1
  return n
}

function wordPieces(word) {
  const pieces = word.split(/(?<=[\p{Ll}])(?=\p{Lu})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
  return pieces.length > 1 ? [word, ...pieces] : [word]
}

function roomFile(file) {
  return (
    file.endsWith('locales/it.json') ||
    file.endsWith('/i18n/it.json') ||
    file.endsWith('state-labels.ts') ||
    file.endsWith('icon-synonyms.ts') ||
    file.startsWith('assets/embed/') ||
    file.startsWith('public/embed/') ||
    file.includes('assets/viewer/')
  )
}

function towerIsMl(line, word, piece, before) {
  if (piece.length < word.length) return true
  if (/^(?:text|vision|image|embedding)tower$/i.test(word)) return true
  if (/(?:text|vision|image|embedding|per-)\s*$/i.test(before)) return true
  if (before.endsWith('-')) return true
  if (/\b(?:a|the|its|that|one|each|other|idle|loaded|this|every)\s+$/i.test(before)) return true
  if (/embedding|clip|encoder|siglip|mobileclip/i.test(line)) return true
  return line.includes('EmbeddingTower')
}

function towerIsHostLeak(file, word, piece, before, after, line) {
  if (after.startsWith('_') || before.endsWith('_')) return false
  if (piece.toLowerCase() !== 'tower') return true
  if (towerIsMl(line, word, piece, before)) return false
  if (word === word.toLowerCase()) return after.startsWith('.local') || /\b(?:hostname|nas)\b/i.test(line)
  if (word === 'Tower' && /\b(?:format|precision|image|text|vision)\b/i.test(line)) return false
  return true
}

function cameraContext(line, index) {
  if (line.startsWith('@@')) return false
  if (FILE_LINE.test(line.slice(Math.max(0, index - 24), index))) return false
  if (/yolo|viewport|width|height|resolution|\bpx\b/i.test(line)) return false
  return /device|camera|doorbell|\bcam\b/i.test(line)
}

/**
 * @param {string} text
 * @param {string} file
 * @param {{ person?: Set<string>, host?: Set<string>, room?: Set<string>, homeIp?: Set<string>, cameraId?: Set<string> }} [options]
 */
export function findTreePrivateData(text, file, options = {}) {
  const person = options.person ?? PERSON_HASHES
  const host = options.host ?? HOST_HASHES
  const room = options.room ?? ROOM_HASHES
  const homeIp = options.homeIp ?? HOME_IP_HASHES
  const cameraId = options.cameraId ?? CAMERA_ID_HASHES
  const found = []
  const add = (category, index, match) => {
    found.push({ file, line: lineOf(text, index), category, match })
  }

  for (const m of text.matchAll(IPV4)) {
    if (homeIp.has(termHash(m[0] ?? ''))) add('home-ip', m.index ?? 0, m[0] ?? '')
  }

  const phrase = []
  for (const m of text.matchAll(TOKEN)) {
    const index = m.index ?? 0
    const word = m[0] ?? ''
    const before = text.slice(Math.max(0, index - 16), index)
    const after = text.slice(index + word.length, index + word.length + 12)
    const lineStart = text.lastIndexOf('\n', index - 1) + 1
    const lineEnd = text.indexOf('\n', index)
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
    let tagged = false
    for (const piece of wordPieces(word)) {
      const hash = termHash(piece)
      if (person.has(hash)) {
        add('person', index, word)
        tagged = true
        break
      }
      if (host.has(hash)) {
        if (line.includes('runs-on:') || line.includes('runner_labels')) break
        if (hash === TOWER_HASH && !towerIsHostLeak(file, word, piece, before, after, line)) break
        add('host', index, word)
        tagged = true
        break
      }
      if (room.has(hash) && !roomFile(file)) {
        if (hash === ENTRY_ROOM_HASH && ENTRY_BEFORE.test(before)) break
        if (hash === BATHROOM_HASH && /^-a-ripoli/i.test(after)) break
        add('room', index, word)
        tagged = true
        break
      }
    }
    phrase.push(termHash(word))
    if (!tagged && phrase.length >= 3 && !roomFile(file)) {
      const tail = phrase.slice(-3)
      if (tail[0] === BEDROOM_PHRASE[0] && tail[1] === BEDROOM_PHRASE[1] && tail[2] === BEDROOM_PHRASE[2])
        add('room', index, word)
    }
  }

  if (!file.startsWith('assets/embed/') && !file.startsWith('public/embed/') && !file.includes('assets/viewer/')) {
    for (const m of text.matchAll(CAMERA_TOKEN)) {
      const id = m[1] ?? ''
      if (!cameraId.has(termHash(id))) continue
      const index = m.index ?? 0
      const lineStart = text.lastIndexOf('\n', index - 1) + 1
      const lineEnd = text.indexOf('\n', index)
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
      if (!cameraContext(line, index - lineStart)) continue
      const around = line.slice(Math.max(0, index - lineStart - 4), index - lineStart)
      if (/\d $/.test(around)) continue
      add('camera-id', index, id)
    }
  }
  return found
}

function listedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter((file) => file.length > 0 && !BINARY_EXT.test(file))
}

function main() {
  const findings = []
  const files = listedFiles()
  for (const rel of files) {
    const abs = path.join(ROOT, rel)
    if (!existsSync(abs)) continue
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    findings.push(...findTreePrivateData(text, rel))
  }
  if (findings.length > 0) {
    console.error(
      `\n✗ tree private-data guard: ${findings.length} finding(s).\n` +
        '  Replace a person with Alice/Bob/Carol/Dave, a host with agent-a/agent-b/\n' +
        '  agent-mac/ci-runner, a home address with 192.0.2.0/24, a room with an\n' +
        '  English name (Front door, Porch, Kitchen), a camera id with 101, 102, …\n',
    )
    for (const finding of findings.slice(0, 80))
      console.error(`  ${finding.file}:${finding.line}  [${finding.category}]  ${finding.match}`)
    if (findings.length > 80) console.error(`  … ${findings.length - 80} more`)
    process.exitCode = 1
    return
  }
  console.log(`✔ tree private-data guard: ${files.length} files, 0 findings`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
