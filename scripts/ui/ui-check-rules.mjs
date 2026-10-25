/**
 * `ui:check` rules for the viewer — the off-system shapes, each reported with
 * the kit component or token that replaces it. React Native files get the RN
 * rules; `embed/src/**` is browser code (Vite + Tailwind + the camstack theme)
 * and gets the web rules the server's `ui:check` applies.
 *
 * A developer tool, never a CI gate. Escape hatch: `ui-check-ok: <reason>` in
 * a comment on the same line or the line above (a video letterbox that must
 * stay black on every theme).
 *
 * The single source of the UI rules is the `camstack-ui` / `camstack-ui-viewer`
 * skills in the server repository; this file only detects.
 */

const SUPPRESS = /ui-check-ok/
const LINE_COMMENT = /^\s*(\/\/|\*|\/\*)/
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g
const COLOR_FN = /(?<![\w-])(rgba?|hsla?)\(/g
const NAMED_COLOR =
  /\b(color|backgroundColor|borderColor|borderTopColor|borderBottomColor|tintColor|shadowColor|placeholderTextColor|thumbColor|trackColor|fill|stroke)\s*[:=]\s*\{?\s*['"](white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|cyan|silver)['"]/g

const PALETTE_HUES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z0-9-]+:)*(bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder)-(${PALETTE_HUES})-(50|[1-9]00|950)(\\/\\d{1,3})?(?![\\w-])`,
  'g',
)

/** Files that ARE where a rule's raw shape legitimately lives. */
const OWNERS = {
  'raw-hex': ['src/theme/tokens.ts'],
  'raw-color-fn': ['src/theme/tokens.ts'],
  'raw-modal': ['src/components/ui/SheetModal.tsx'],
  'rn-switch': ['src/components/ui/ToggleRow.tsx'],
  'alert-call': ['src/components/ui/confirm.tsx', 'src/components/ui/system-alert.ts'],
}

export function isCheckedFile(file) {
  if (!/\.(tsx?|css)$/.test(file) || file.endsWith('.d.ts')) return false
  if (/(^|\/)(__tests__|__mocks__|testing|node_modules|dist)\//.test(file)) return false
  if (/\.(spec|test)\.[jt]sx?$/.test(file)) return false
  return /^(src|app|embed\/src)\//.test(file)
}

export function isEmbed(file) {
  return file.startsWith('embed/src/')
}

function owned(rule, file) {
  return (OWNERS[rule] ?? []).includes(file)
}

/** `#hex` → viewer token key, so a finding can name the token it already is. */
export function hexMessage(hex, tokens) {
  const key = tokens.get(hex.toLowerCase())
  return key
    ? `raw ${hex} is the \`${key}\` token → \`useTheme().colors.${key}\``
    : `raw ${hex} → a token from src/theme/tokens.ts (\`useTheme().colors.*\`, \`BAND.*\`); a new colour goes into tokens.ts AND the web theme`
}

/** RN names imported from 'react-native' in `text`, with the line of each import. */
export function reactNativeImports(text) {
  const out = []
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g
  for (const m of text.matchAll(re)) {
    const line = text.slice(0, m.index).split('\n').length
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
      if (name) out.push({ name, line })
    }
  }
  return out
}

/**
 * @param {string} file repo-relative path
 * @param {string} source file text
 * @param {Map<string,string>} [tokens] lower-case hex → token key
 * @returns {{file:string,line:number,rule:string,match:string,message:string}[]}
 */
export function checkViewerSource(file, source, tokens = new Map()) {
  if (!isCheckedFile(file)) return []
  const findings = []
  const lines = source.split('\n')
  const push = (line, rule, match, message) => {
    if (owned(rule, file)) return
    const here = lines[line - 1] ?? ''
    const above = lines[line - 2] ?? ''
    if (SUPPRESS.test(here) || SUPPRESS.test(above)) return
    findings.push({ file, line, rule, match, message })
  }
  const embed = isEmbed(file)

  for (const [index, text] of lines.entries()) {
    const lineNo = index + 1
    if (LINE_COMMENT.test(text)) continue
    if (!file.endsWith('.css') || embed) {
      for (const m of text.matchAll(HEX)) push(lineNo, 'raw-hex', m[0], hexMessage(m[0], tokens))
    }
    for (const m of text.matchAll(COLOR_FN)) {
      if (/var\(--/.test(text.slice(m.index ?? 0, (m.index ?? 0) + 24))) continue
      push(lineNo, 'raw-color-fn', `${m[1]}(`, `raw ${m[1]}() → a token; alpha via the token (web: \`bg-danger/10\`)`)
    }
    if (embed) {
      for (const m of text.matchAll(PALETTE_CLASS)) {
        push(lineNo, 'palette-class', m[0], `palette class ${m[0]} → a theme token utility (\`text-danger\`, \`bg-surface\`, \`border-border\`)`)
      }
      continue
    }
    for (const m of text.matchAll(NAMED_COLOR)) {
      push(lineNo, 'named-color', `${m[1]}: '${m[2]}'`, `named colour '${m[2]}' → \`useTheme().colors.*\` (foreground / background / surface …)`)
    }
    if (/\bAlert\.alert\(/.test(text)) {
      push(lineNo, 'alert-call', 'Alert.alert(', 'Alert.alert → `useConfirm` / `useNotice` from src/components/ui/confirm.tsx')
    }
  }

  if (!embed && file.endsWith('.tsx')) {
    for (const { name, line } of reactNativeImports(source)) {
      if (name === 'Modal') {
        push(line, 'raw-modal', 'Modal', 'raw react-native Modal → `SheetModal` (sheet on iOS/Android, centred dialog on web) or `PickerSheet`')
      } else if (name === 'Switch') {
        push(line, 'rn-switch', 'Switch', 'raw react-native Switch → `ToggleRow` inside a `Section`')
      }
    }
  }
  return findings
}

export function summarize(findings) {
  const byRule = {}
  const files = new Map()
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
    const set = files.get(f.rule) ?? new Set()
    set.add(f.file)
    files.set(f.rule, set)
  }
  const filesByRule = {}
  for (const [rule, set] of files) filesByRule[rule] = set.size
  return { byRule, filesByRule, files: new Set(findings.map((f) => f.file)).size }
}
