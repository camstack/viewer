/**
 * The viewer's local UI tools (`npm run ui:*`, `scripts/ui/`): `ui:check`
 * flags the off-system shapes with their replacement and nothing legitimate;
 * the catalogue reads the kit; the generated pointer splices idempotently and
 * the committed copies are current.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCatalogue,
  parseTokens,
  renderCatalogue,
} from '../../scripts/ui/catalogue.mjs'
import {
  AGENTS_PATH,
  BLOCK_BEGIN,
  BLOCK_END,
  extractBlock,
  MDC_PATH,
  pointerLines,
  renderBlock,
  renderMdc,
  spliceBlock,
} from '../../scripts/ui/pointers.mjs'
import {
  checkViewerSource,
  isCheckedFile,
  reactNativeImports,
  summarize,
} from '../../scripts/ui/ui-check-rules.mjs'

const ROOT = join(__dirname, '..', '..')
const SCREEN = 'src/screens/Thing.tsx'
const rules = (file: string, src: string, tokens = new Map<string, string>()): string[] =>
  checkViewerSource(file, src, tokens).map((f) => f.rule)

describe('ui:check — React Native rules', () => {
  it('flags raw hex and names the token it already is', () => {
    const [f] = checkViewerSource(SCREEN, "const s = { color: '#F87171' }\n", new Map([['#f87171', 'danger']]))
    expect(f?.rule).toBe('raw-hex')
    expect(f?.message).toContain('useTheme().colors.danger')
  })

  it('leaves tokens.ts alone — it is where the hex lives', () => {
    expect(rules('src/theme/tokens.ts', "  danger: '#f87171',\n")).toEqual([])
  })

  it('flags rgba() and named colours in style props', () => {
    expect(rules(SCREEN, "backgroundColor: 'rgba(0,0,0,0.6)'\n")).toEqual(['raw-color-fn'])
    expect(rules(SCREEN, "<Text style={{ color: 'white' }} />\n")).toEqual(['named-color'])
    expect(rules(SCREEN, "backgroundColor: 'transparent'\n")).toEqual([])
  })

  it('flags a raw Modal / Switch from react-native, multi-line imports included', () => {
    const src = "import {\n  Modal,\n  Switch,\n  View,\n} from 'react-native'\n"
    expect(reactNativeImports(src).map((i) => i.name)).toEqual(['Modal', 'Switch', 'View'])
    expect(rules(SCREEN, src)).toEqual(['raw-modal', 'rn-switch'])
    expect(rules('src/components/ui/SheetModal.tsx', src)).toEqual(['rn-switch'])
  })

  it('flags Alert.alert outside the one module allowed to call it', () => {
    expect(rules(SCREEN, "Alert.alert('t', 'm')\n")).toEqual(['alert-call'])
    expect(rules('src/components/ui/system-alert.ts', "  Alert.alert('t', 'm')\n")).toEqual([])
  })

  it('honours ui-check-ok and skips comments, specs and test helpers', () => {
    expect(rules(SCREEN, "const black = '#000' // ui-check-ok: video letterbox\n")).toEqual([])
    expect(rules(SCREEN, "// was '#ff0000'\n")).toEqual([])
    expect(isCheckedFile('src/x/__tests__/a.spec.ts')).toBe(false)
    expect(isCheckedFile('src/testing/native-stubs/x.tsx')).toBe(false)
    expect(isCheckedFile('scripts/ui/cli.mjs')).toBe(false)
  })
})

describe('ui:check — the embed is web code', () => {
  it('applies the web palette rule there, and not the RN ones', () => {
    const src = '<div className="bg-red-500/10 text-foreground" />\n'
    expect(rules('embed/src/live/Bar.tsx', src)).toEqual(['palette-class'])
    expect(rules(SCREEN, src)).toEqual([])
  })
})

describe('summary', () => {
  it('counts findings per rule and per file', () => {
    const f = [
      ...checkViewerSource(SCREEN, "a = '#000'\nb = '#fff'\n"),
      ...checkViewerSource('src/other.tsx', "c = '#111'\n"),
    ]
    expect(summarize(f)).toEqual({ byRule: { 'raw-hex': 3 }, filesByRule: { 'raw-hex': 2 }, files: 2 })
  })
})

describe('the catalogue', () => {
  const catalogue = buildCatalogue(ROOT)
  const byName = new Map(catalogue.entries.map((e) => [e.name, e]))

  it('reads the kit with props', () => {
    expect(byName.get('SheetModal')?.kind).toBe('component')
    expect(byName.get('SheetModal')?.props?.map((p) => p.name)).toContain('onClose')
    expect(byName.get('useConfirm')?.kind).toBe('hook')
    expect(byName.has('ScreenHeader')).toBe(true)
  })

  it('reads both palettes from tokens.ts', () => {
    const src = "const dark: ColorTokens = {\n  danger: '#f87171',\n}\nconst light: ColorTokens = {\n  danger: '#dc2626',\n}\n"
    expect(parseTokens(src)).toEqual([{ key: 'danger', dark: '#f87171', light: '#dc2626' }])
  })

  it('renders one element per line and round-trips as JSON', () => {
    const text = renderCatalogue(catalogue)
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(catalogue)))
    expect(text.split('\n').length).toBeGreaterThan(catalogue.entries.length)
  })
})

describe('the generated pointer', () => {
  it('is 6–10 lines and points at the skills, not a copy of them', () => {
    const lines = pointerLines()
    expect(lines.length).toBeGreaterThanOrEqual(6)
    expect(lines.length).toBeLessThanOrEqual(10)
    expect(lines.join('\n')).toContain('camstack-ui-viewer/SKILL.md')
    expect(lines.join('\n')).toContain('ask before restructuring')
  })

  it('splices idempotently and only between its markers', () => {
    const text = `# AGENTS.md\n\nIntro.\n\n## Commands\n\nx\n`
    const once = spliceBlock(text, renderBlock())
    expect(once.indexOf(BLOCK_BEGIN)).toBeLessThan(once.indexOf('## Commands'))
    expect(spliceBlock(once, renderBlock())).toBe(once)
    const edited = once.replace('Search before', 'Maybe search')
    expect(extractBlock(spliceBlock(edited, renderBlock()))).toBe(renderBlock())
    expect(renderBlock().endsWith(BLOCK_END)).toBe(true)
  })

  it('the Cursor rule is valid .mdc and auto-attaches to the UI trees', () => {
    const mdc = renderMdc()
    expect(mdc).toMatch(/^---\ndescription: \S.*\nglobs: src\/\*\*, app\/\*\*, embed\/src\/\*\*, locales\/\*\*\nalwaysApply: false\n---\n/)
  })

  it('the committed AGENTS.md block and Cursor rule are current', () => {
    expect(extractBlock(readFileSync(join(ROOT, AGENTS_PATH), 'utf8'))).toBe(renderBlock())
    expect(readFileSync(join(ROOT, MDC_PATH), 'utf8')).toBe(renderMdc())
  })
})
