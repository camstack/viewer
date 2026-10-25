/**
 * Refuse a detection class the hub can emit and this app cannot name.
 *
 * ## What it prevents
 *
 * The events surfaces render a class through `eventKind.<id>`, falling back to
 * `eventKind.<macro>` and, in the last resort, to the raw id SHOWN
 * (`src/data/event-label-vocabulary.ts`). The last resort is deliberate — a
 * class the hub learns tomorrow must stay readable — and it is also silent:
 * the operator simply sees an English word, nobody files a bug for six months,
 * and by then the catalog has moved again. That is exactly how this repo ended
 * up with eleven translated `events.detection*` keys that NOTHING read: reading
 * the locale file made the problem look solved.
 *
 * So the catalogs are checked against the locales on every `ts-check`, in CI.
 * A class joins the check by existing in `@camstack/types` — there is no list
 * here to keep up to date, which is the only reason this cannot rot the way the
 * dead keys did.
 *
 * ## Why it re-derives the macro instead of importing the rule
 *
 * A guard that runs the code it is checking agrees with that code by
 * construction — a bug in `macroIdFor` would be reproduced faithfully here and
 * the check would pass. This reads the catalogs and the locale FILES as data,
 * independently. (It also keeps the guard a plain `.mjs` with no transpiler,
 * the way the other three `check-*` scripts are.)
 *
 * Run: `node scripts/check-event-label-coverage.mjs` (wired into `ts-check`).
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = process.cwd()

const {
  APPLE_SA_TO_MACRO,
  AUDIO_MACRO_LABELS,
  COCO_TO_MACRO,
  EVENT_TAXONOMY,
  MACRO_LABELS,
  YAMNET_TO_MACRO,
} = require('@camstack/types')

/** The locales every operator-facing string must exist in. */
const LOCALES = ['en', 'it']

const AUDIO_PREFIX = 'audio-'

/** `audio-<x>` is already namespaced; a bare label is not. Mirrors
 *  `audioKindId` — idempotent for the same reason. */
const audioId = (label) => {
  const id = String(label).toLowerCase()
  return id.startsWith(AUDIO_PREFIX) ? id : `${AUDIO_PREFIX}${id}`
}

/**
 * Every id a label surface can be asked about, with the macro it falls back to
 * and whether a macro is GOOD ENOUGH for it. Derived from the catalogs — never
 * hand-listed.
 *
 * Two tiers, because they are two different promises:
 *
 *  • the TAXONOMY (`EVENT_TAXONOMY`, the macro list) is the product's own
 *    vocabulary — the words a picker offers, a timeline lane carries and a card
 *    prints. Every one of them owes the operator its own word, so a macro
 *    fallback does NOT satisfy this check. This is the tier that grows on its
 *    own: a new `COCO_TO_MACRO` animal mints a taxonomy sub, and the guard goes
 *    red until someone names it.
 *
 *  • a raw CLASSIFIER label (YAMNet `Bark`, Apple `dog_bark`, and COCO's
 *    package proxies) is a vendor's word, not the product's. There are ~230 of
 *    them, they change with the model, and translating each one by hand is the
 *    list that rots. The macro they are mapped onto is the true statement the
 *    product already speaks, so resolving through it is enough.
 */
function catalogEntries() {
  const out = new Map()
  const add = (id, macro, origin, ownKeyRequired) => {
    if (id.length === 0 || out.has(id)) return
    out.set(id, { macro, origin, ownKeyRequired })
  }
  for (const [kind, entry] of Object.entries(EVENT_TAXONOMY)) {
    add(kind, entry.parentKind ?? null, 'EVENT_TAXONOMY', true)
  }
  for (const label of MACRO_LABELS) add(label.id, null, 'MACRO_LABELS', true)
  for (const label of AUDIO_MACRO_LABELS) {
    add(`${AUDIO_PREFIX}${label.id}`, 'audio', 'AUDIO_MACRO_LABELS', true)
  }
  for (const [cls, macro] of Object.entries(COCO_TO_MACRO.mapping)) {
    add(cls, macro, 'COCO_TO_MACRO', false)
  }
  for (const [name, mapping] of [
    ['YAMNET_TO_MACRO', YAMNET_TO_MACRO.mapping],
    ['APPLE_SA_TO_MACRO', APPLE_SA_TO_MACRO.mapping],
  ]) {
    for (const [label, macro] of Object.entries(mapping)) {
      add(audioId(label), `${AUDIO_PREFIX}${macro}`, name, false)
    }
  }
  return out
}

function loadLocale(lang) {
  const file = path.join(ROOT, 'locales', `${lang}.json`)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const kinds = parsed.eventKind
  if (typeof kinds !== 'object' || kinds === null) {
    throw new Error(`${lang}.json has no "eventKind" section`)
  }
  return kinds
}

function main() {
  const entries = catalogEntries()
  const locales = Object.fromEntries(LOCALES.map((lang) => [lang, loadLocale(lang)]))
  const failures = []

  for (const [id, { macro, origin, ownKeyRequired }] of entries) {
    for (const lang of LOCALES) {
      const words = locales[lang]
      const own = words[id]
      if (typeof own === 'string' && own.length > 0) continue
      if (ownKeyRequired) {
        failures.push(
          `${lang}.json: "${id}" (${origin}) is product vocabulary and has no eventKind.${id}`,
        )
        continue
      }
      const viaMacro = macro === null ? undefined : words[macro]
      if (typeof viaMacro === 'string' && viaMacro.length > 0) continue
      failures.push(
        `${lang}.json: "${id}" (${origin}) has no eventKind.${id}` +
          (macro === null ? ' and no macro to fall back to' : ` and no eventKind.${macro}`),
      )
    }
  }

  // The two locales must name the SAME vocabulary: a key present in one and
  // missing in the other is a word that silently changes language.
  const [first, ...rest] = LOCALES
  for (const lang of rest) {
    for (const key of Object.keys(locales[first])) {
      if (typeof locales[lang][key] !== 'string' || locales[lang][key].length === 0) {
        failures.push(`${lang}.json: eventKind.${key} exists in ${first}.json but not here`)
      }
    }
    for (const key of Object.keys(locales[lang])) {
      if (typeof locales[first][key] !== 'string' || locales[first][key].length === 0) {
        failures.push(`${first}.json: eventKind.${key} exists in ${lang}.json but not here`)
      }
    }
  }

  if (failures.length > 0) {
    console.error('Event label coverage FAILED — a class the hub can emit has no word:\n')
    for (const failure of failures) console.error(`  • ${failure}`)
    console.error(
      `\n${failures.length} problem(s). Add the key to locales/{${LOCALES.join(',')}}.json,` +
        ' or map the class to a macro that has one (see src/data/event-label-vocabulary.ts).',
    )
    process.exit(1)
  }

  console.log(
    `✓ event labels: ${entries.size} catalog classes resolvable in ${LOCALES.join(', ')}`,
  )
}

main()
