/**
 * The generated UI pointer for this repository: a block in `AGENTS.md`
 * (Codex, Cursor and — through `CLAUDE.md` = `@AGENTS.md` — Claude Code read
 * it) and `.cursor/rules/camstack-ui-viewer.mdc` (Cursor auto-attaches it to
 * UI files). Both POINT at the one source of the rules — the `camstack-ui`
 * and `camstack-ui-viewer` skills and `docs/ui/viewer.md` in the server
 * repository — and copy none of it.
 *
 * `npm run ui:pointers` writes them; `--check` (in `ts-check`) fails when one
 * is missing or edited by hand.
 */
export const BLOCK_BEGIN =
  '<!-- camstack-ui-pointer:begin — written by `node scripts/ui/cli.mjs pointers`; edit the generator, not this block -->'
export const BLOCK_END = '<!-- camstack-ui-pointer:end -->'
export const MDC_PATH = '.cursor/rules/camstack-ui-viewer.mdc'
export const AGENTS_PATH = 'AGENTS.md'

const SERVER = 'https://github.com/camstack/server/blob/main'

export const VIEWER_UI_GLOBS = ['src/**', 'app/**', 'embed/src/**', 'locales/**']

export function pointerLines() {
  return [
    `**UI work here** (a screen, sheet, row, the embed player): follow the \`camstack-ui\` then \`camstack-ui-viewer\` skills. They live in the server repository — \`../.claude/skills/camstack-ui/SKILL.md\` and \`../.claude/skills/camstack-ui-viewer/SKILL.md\` when this repo is its \`camstack/\` submodule, else ${SERVER}/.claude/skills/camstack-ui-viewer/SKILL.md — with the rules in \`docs/ui/viewer.md\` there.`,
    '',
    '- **Layout changes are co-designed with the operator: ask before restructuring a screen.**',
    '- Search before building: `npm run ui:find -- "<need>"`, `npm run ui:show -- <Name>`, `npm run ui:tokens`.',
    '- Colours only from `src/theme/tokens.ts` via `useTheme().colors`; no hex or named colours, no raw `Modal` (→ `SheetModal`), no `Alert.alert` (→ `useConfirm`).',
    '- Every user-facing string is `t(…)` with a key in `locales/en.json` AND `locales/it.json`.',
    '- Done = `npm run ui:check -- <files>` with 0 new findings, **`npm run verify:push` GREEN** (same gates as TypeScript Check: ts-check + test:v2 + embed when touched), and the screen seen on a simulator and the web build (≈390 px and desktop), dark and light.',
    '- **Before every commit (and before push) — `npm run verify:push` GREEN.** It grades the changed set against `origin/main` (working tree included). A single green vitest file is NOT the CI gate.',
  ]
}

export function renderBlock() {
  return [BLOCK_BEGIN, ...pointerLines(), BLOCK_END].join('\n')
}

export function extractBlock(text) {
  const start = text.indexOf(BLOCK_BEGIN)
  if (start === -1) return null
  const end = text.indexOf(BLOCK_END, start)
  return end === -1 ? null : text.slice(start, end + BLOCK_END.length)
}

/** `text` with the block replaced, or inserted as a section before the first `## ` heading. */
export function spliceBlock(text, block) {
  const current = extractBlock(text)
  if (current !== null) return text.replace(current, block)
  const section = `## UI work\n\n${block}\n\n`
  const firstH2 = text.search(/^## /m)
  if (firstH2 === -1) return `${text.replace(/\s+$/, '')}\n\n${section}`
  return `${text.slice(0, firstH2)}${section}${text.slice(firstH2)}`
}

export function renderMdc() {
  return [
    '---',
    'description: CamStack viewer UI rules — the kit, tokens.ts, SheetModal, i18n en+it; layout changes need the operator',
    `globs: ${VIEWER_UI_GLOBS.join(', ')}`,
    'alwaysApply: false',
    '---',
    '<!-- Written by `node scripts/ui/cli.mjs pointers` — a pointer, not a copy. -->',
    '',
    ...pointerLines(),
    '',
  ].join('\n')
}
