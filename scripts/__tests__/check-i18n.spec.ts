/**
 * The translation guard: what it calls user-visible text, what it lets
 * through, and that the live tree is clean (the gate itself runs in
 * `ts-check`; this spec pins the rules so a loosened rule fails here).
 */
import { describe, expect, it } from 'vitest'
import { census, flatten, localeReport, scanSource } from '../check-i18n.mjs'

interface Finding {
  readonly where: string
  readonly text: string
}

const texts = (src: string, file = 'src/screens/Example.tsx'): readonly string[] =>
  scanSource(file, src).strings.map((f: Finding) => f.text)

const keys = (src: string, file = 'src/screens/Example.tsx'): readonly string[] =>
  [...scanSource(file, src).keys, ...scanSource(file, src).keyLiterals].map((k: { key: string }) => k.key)

describe('hard-coded text', () => {
  it('flags JSX text, UI props, rendered literals and labels chosen in code', () => {
    expect(texts('const A = () => <Text>Assign to person</Text>')).toEqual(['Assign to person'])
    expect(texts('const A = () => <TextInput placeholder="Person name…" />')).toEqual(['Person name…'])
    expect(texts('const A = () => <Pressable accessibilityLabel="Initial audio" />')).toEqual(['Initial audio'])
    expect(texts("const A = (on: boolean) => <Text>{on ? 'Shown' : 'Hidden'}</Text>")).toEqual(['Shown', 'Hidden'])
    expect(texts("const o = { title: 'Delete grid?' }", 'src/data/x.ts')).toEqual(['Delete grid?'])
    expect(texts("function f(k: string) { if (k === 'crop') return 'Crop'; return k }", 'src/x.ts')).toEqual(['Crop'])
    expect(texts("const m = { 'still-busy': 'The recorder is busy. Try again.' }", 'src/x.ts')).toEqual([
      'The recorder is busy. Try again.',
    ])
  })

  it('lets through keys, defaults, logs, errors, comparisons and pinned text', () => {
    expect(texts("const A = () => <Text>{t('v2.common.ok')}</Text>")).toEqual([])
    expect(texts("t('v2.x.y', 'Default English')")).toEqual([])
    expect(texts("const s = { key: 'v2.x', fallback: 'Drawn' }", 'src/x.ts')).toEqual([])
    expect(texts("log.warn('login', 'Sign-in failed hard')", 'src/x.ts')).toEqual([])
    expect(texts("throw new Error('Device certificates need https')", 'src/x.ts')).toEqual([])
    expect(texts("if (m.includes('No procedure found')) {}", 'src/x.ts')).toEqual([])
    expect(texts("const o = { label: 'auto' }", 'src/x.ts')).toEqual([])
    expect(texts('const A = () => <Text>CamStack</Text>')).toEqual([])
    expect(texts('const A = () => <Text>{n} fps</Text>')).toEqual([])
    expect(texts('const A = () => <Text>· —</Text>')).toEqual([])
  })

  it('needs a reason to pin, on the line or above the enclosing node', () => {
    expect(texts('const A = () => <Text>Debug only</Text>')).toEqual(['Debug only'])
    expect(texts('// i18n-ok: developer screen\nconst A = () => <Text>Debug only</Text>')).toEqual([])
    expect(texts("const o = { label: 'Debug only' } // i18n-ok: never drawn", 'src/x.ts')).toEqual([])
    expect(texts('// i18n-ok:\nconst A = () => <Text>Debug only</Text>')).toEqual(['Debug only'])
    expect(texts("// i18n-ok-file: transport diagnostics\nconst o = { message: 'Unexpected shape' }", 'src/x.ts')).toEqual([])
  })
})

describe('keys', () => {
  it('collects t() keys and key-valued properties, not storage keys', () => {
    expect(keys("t('v2.common.ok'); i18n.t('v2.common.cancel', { n: 1 })")).toEqual(['v2.common.ok', 'v2.common.cancel'])
    expect(keys("const c = { labelKey: 'v2.clips.sourceHksv' }", 'src/x.ts')).toEqual(['v2.clips.sourceHksv'])
    expect(keys("const s = { key: 'v2.language' }", 'src/x.ts')).toEqual([])
  })
})

describe('locale parity', () => {
  const pair = (en: object, it: object): readonly string[] =>
    localeReport({ en: flatten(en), it: flatten(it) }).issues

  it('flags a key on one side, an empty value and a lost placeholder', () => {
    expect(pair({ a: 'A', b: 'B' }, { a: 'A' })).toEqual(['missing in it: b'])
    expect(pair({ a: 'A' }, { a: ' ' })).toEqual(['empty in it: a'])
    expect(pair({ a: 'Hi {{name}}' }, { a: 'Ciao' })).toHaveLength(1)
  })

  it('lets a singular form say "one" instead of printing the count', () => {
    expect(pair({ x_one: 'show the {{count}}' }, { x_one: 'mostra quello' })).toEqual([])
    expect(pair({ x_other: 'show the {{count}}' }, { x_other: 'mostrali' })).toHaveLength(1)
  })
})

describe('the viewer tree', () => {
  it('has no hard-coded text, no missing key and both locales in parity', () => {
    const c = census()
    expect(c.localeIssues).toEqual([])
    expect(c.missingKeys).toEqual([])
    expect(c.strings).toEqual([])
    expect(c.keyCount.en).toBe(c.keyCount.it)
  })
})
