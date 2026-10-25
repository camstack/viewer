/**
 * Every persisted key has exactly ONE level, and a new one cannot ship
 * without a decision (operator decision 2026-10-21: two levels, no overrides).
 *
 * The guard is a source scan: every storage-key literal the app spells — a
 * `…KEY` / `K_…` constant, the head of a key-building template, a literal
 * handed straight to AsyncStorage — must be declared in `storage-levels.ts`.
 * A literal that is a translation key (it resolves in `locales/en.json`) is
 * not a storage key and is skipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../../locales/en.json'
import { STORAGE_KEY_LEVELS, storageLevelOf } from '../storage-levels.js'
import { SETTINGS_LEVELS, settingsLeafLevels, pickSettingsLevel } from '../settings-levels.js'
import { DEFAULTS } from '../settings-store.js'

const ROOT = join(__dirname, '..', '..', '..')
const SCANNED = ['src', 'app', 'shared']

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'testing' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : []
  })
}

/** The storage-key namespaces this app uses. */
const KEY_SHAPE = /^(@camstack\/|camstack\.|v2\.)/

/** A file that reads or writes a key-value store. */
const TOUCHES_STORAGE = /AsyncStorage|KvStore|sessionStorage|localStorage|\bkv\.|secrets\./

/** Scanned in files that touch storage. */
const STORAGE_FILE_PATTERNS: readonly RegExp[] = [
  // const FOO_KEY = '…' · const K_FOO = '…' · const K_FOO = (id) => `…${id}`
  /const\s+(?:[A-Za-z_]*(?:KEY|Key|PREFIX|Prefix)[A-Za-z_]*|K_[A-Z_]+)\s*(?::\s*[A-Za-z<>[\]]+)?\s*=\s*(?:\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*)?['"`]([^'"`$]+)/g,
  // AsyncStorage.getItem('…') and friends
  /AsyncStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`$]+)/g,
]

/** Scanned everywhere: a key builder may live away from its store. */
const ANY_FILE_PATTERNS: readonly RegExp[] = [
  // function fooStorageKey(id) { return `…${id}` }
  /function\s+\w*(?:StorageKey|CacheKey)\s*\([^)]*\)[^{]*\{\s*return\s+['"`]([^'"`$]+)/g,
]

/** A literal that names a translated STRING is an i18n key, not a storage key. */
function isTranslationKey(literal: string): boolean {
  let node: unknown = en
  for (const part of literal.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false
    node = Reflect.get(node, part)
  }
  return typeof node === 'string'
}

function storageLiterals(): readonly { readonly file: string; readonly literal: string }[] {
  const found: { file: string; literal: string }[] = []
  for (const dir of SCANNED) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8')
      const patterns = TOUCHES_STORAGE.test(text) ? [...STORAGE_FILE_PATTERNS, ...ANY_FILE_PATTERNS] : ANY_FILE_PATTERNS
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const literal = match[1]
          if (literal === undefined || !KEY_SHAPE.test(literal) || isTranslationKey(literal)) continue
          found.push({ file: relative(ROOT, file), literal })
        }
      }
    }
  }
  return found
}

describe('storage levels — every persisted key is declared', () => {
  const literals = storageLiterals()

  it('the scan sees the keys it is meant to guard', () => {
    // A scan that matches nothing would pass forever; pin a few it must see.
    const seen = new Set(literals.map((l) => l.literal))
    for (const key of ['@camstack/v2/settings', 'v2.language', 'v2.servers', 'camstack.activity.v1.', 'v2.cache.cameras.']) {
      expect(seen, key).toContain(key)
    }
  })

  it('every storage-key literal in the source has a declared level', () => {
    const undeclared = literals.filter((l) => storageLevelOf(l.literal) === undefined)
    expect(undeclared, 'declare each in src/store/storage-levels.ts').toEqual([])
  })

  it('each key is declared ONCE — one key, one level', () => {
    const keys = STORAGE_KEY_LEVELS.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of STORAGE_KEY_LEVELS) {
      const matches = STORAGE_KEY_LEVELS.filter((other) => storageLevelOf(entry.key) === other)
      expect(matches, entry.key).toHaveLength(1)
    }
  })

  it('a hub copy of an account key is the account level; of a device key, the device level', () => {
    expect(storageLevelOf('v2.language@hub-a')?.level).toBe('account')
    expect(storageLevelOf('@camstack/v2/camera-local@hub-a')?.level).toBe('device')
    expect(storageLevelOf('v2.token.abc')?.level).toBe('device')
    expect(storageLevelOf('v2.token')?.level).toBe('retired')
    expect(storageLevelOf('@camstack/v2/brand-new')).toBeUndefined()
  })
})

describe('settings levels — every field of the settings document has exactly one', () => {
  it('the table covers every leaf of the document, and nothing else', () => {
    const leaves = Object.entries(DEFAULTS).flatMap(([section, value]) =>
      typeof value === 'object' && value !== null ? Object.keys(value).map((f) => `${section}.${f}`) : [section],
    )
    expect(settingsLeafLevels().map((l) => l.path).sort()).toEqual([...leaves].sort())
  })

  it('the two halves are disjoint and together are the whole document', () => {
    const device = pickSettingsLevel(DEFAULTS, 'device')
    const account = pickSettingsLevel(DEFAULTS, 'account')
    const paths = (doc: Record<string, unknown>): readonly string[] =>
      Object.entries(doc).flatMap(([s, v]) =>
        typeof v === 'object' && v !== null ? Object.keys(v).map((f) => `${s}.${f}`) : [s],
      )
    const d = new Set(paths(device))
    const a = paths(account)
    expect(a.filter((p) => d.has(p))).toEqual([])
    expect([...d, ...a].sort()).toEqual(settingsLeafLevels().map((l) => l.path).sort())
  })

  it('the operator-listed device fields are device; the rest of the document is account', () => {
    const device = settingsLeafLevels()
      .filter((l) => l.level === 'device')
      .map((l) => l.path)
      .sort()
    expect(device).toEqual(
      [
        'clusters.cardWidthFraction',
        'deviceInfo',
        'events.gridDensity',
        'events.reelThumbSize',
        'events.reelThumbSizeRev',
        'haptics.detection',
        'haptics.enabled',
        'haptics.motion',
        'haptics.person',
        'haptics.uiFeedback',
        'stream.landscapeTimeline',
        'stream.navBarOnStream',
        'stream.pinchExpandsHeight',
        'stream.toolbarDensity',
      ].sort(),
    )
    expect(SETTINGS_LEVELS.highlight.motionColor).toBe('account')
  })
})
