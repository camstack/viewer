/**
 * Every string the TIMELAPSE and DIGEST surfaces ask for, in BOTH locales.
 *
 * A missing key on this app does not throw — i18next renders the key itself, so
 * an operator sees `v2.nc.timelapse.windowHint` where a sentence should be. That
 * is invisible to a typecheck, invisible to a build, and only visible to the
 * person who least wants to see it. The list below is written out rather than
 * derived, because the thing being checked IS that the screen and the locale
 * agree about a literal — deriving it from the screen would only prove the file
 * agrees with itself.
 *
 * The two editors also REUSE the rule editor's own keys (section headings, the
 * name label, priority, targets, save/cancel) rather than growing a parallel
 * vocabulary — that reuse is asserted here too, because a second "Cameras"
 * string is exactly the divergence this work exists to remove.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const TIMELAPSE_KEYS: readonly string[] = [
  'v2.nc.timelapse.createTitle',
  'v2.nc.timelapse.editTitle',
  'v2.nc.timelapse.namePlaceholder',
  'v2.nc.timelapse.enabledLabel',
  'v2.nc.timelapse.camerasHint',
  'v2.nc.timelapse.windowLabel',
  'v2.nc.timelapse.windowHint',
  'v2.nc.timelapse.samplingLabel',
  'v2.nc.timelapse.cadenceLabel',
  'v2.nc.timelapse.framerateLabel',
  'v2.nc.timelapse.denseCadenceLabel',
  'v2.nc.timelapse.denseCadenceHint',
  'v2.nc.timelapse.minDwellLabel',
  'v2.nc.timelapse.minDwellHint',
  'v2.nc.timelapse.messageLabel',
  'v2.nc.timelapse.messageHint',
  'v2.nc.timelapse.previewTextLabel',
  'v2.nc.timelapse.previewTextHint',
  'v2.nc.timelapse.reportClassesLabel',
  'v2.nc.timelapse.reportClassesHint',
  'v2.nc.timelapse.loadError',
  'v2.nc.rules.editor.saveBlocked.rolePending',
  'v2.nc.rules.editor.saveBlocked.roleUnknown',
  'v2.nc.rules.editor.saveBlocked.targetsPending',
  'v2.nc.rules.editor.saveBlocked.targetsFailed',
  'v2.nc.timelapse.previewTextNoneHint',
  'v2.nc.timelapse.captionPreviewLabel',
  'v2.nc.timelapse.editorTitle',
  'v2.nc.rules.editor.unlistedTargetsKept',
  'v2.nc.rules.editor.unlistedTargetsRemoved',
  'v2.nc.timelapse.previewHint',
  'v2.nc.timelapse.preview.image',
  'v2.nc.timelapse.preview.gif',
  'v2.nc.timelapse.problem.devices',
  'v2.nc.timelapse.problem.schedule',
  'v2.nc.timelapse.problem.denseCadence',
  'v2.nc.timelapse.problem.minDwell',
  'v2.nc.timelapse.problem.template',
  'v2.nc.timelapse.problem.previewText',
  'v2.nc.timelapse.problem.reportClasses',
]

const SUMMARY_KEYS: readonly string[] = [
  'v2.nc.summary.createTitle',
  'v2.nc.summary.editTitle',
  'v2.nc.summary.namePlaceholder',
  'v2.nc.summary.enabledLabel',
  'v2.nc.summary.camerasHint',
  'v2.nc.summary.windowLabel',
  'v2.nc.summary.window.motion',
  'v2.nc.summary.window.schedule',
  'v2.nc.summary.motionHint',
  'v2.nc.summary.scheduleHint',
  'v2.nc.summary.quietLabel',
  'v2.nc.summary.maxWindowLabel',
  'v2.nc.summary.hubTooOld',
  'v2.nc.summary.problem.devices',
  'v2.nc.summary.problem.window',
  'v2.nc.summary.aiEnabledHint',
  'v2.nc.summary.aiEnabledLabel',
  'v2.nc.summary.aiLanguage.default',
  'v2.nc.summary.aiLanguage.en',
  'v2.nc.summary.aiLanguage.it',
  'v2.nc.summary.aiLanguageLabel',
  'v2.nc.summary.aiMaxImagePxHint',
  'v2.nc.summary.aiMaxImagePxLabel',
  'v2.nc.summary.aiOnFailure.deliver-without-text',
  'v2.nc.summary.aiOnFailure.skip',
  'v2.nc.summary.aiOnFailureLabel',
  'v2.nc.summary.aiProfileDefault',
  'v2.nc.summary.aiProfileLabel',
  'v2.nc.summary.aiProfilesUnavailable',
  'v2.nc.summary.aiPromptLabel',
  'v2.nc.summary.aiPromptPlaceholder',
  'v2.nc.summary.aiSkipWarning',
  'v2.nc.summary.aiTimeoutHint',
  'v2.nc.summary.aiTimeoutLabel',
  'v2.nc.summary.barrierHint',
  'v2.nc.summary.barrierLabel',
  'v2.nc.summary.captionTextHint',
  'v2.nc.summary.captionTextLabel',
  'v2.nc.summary.captionTextNoneHint',
  'v2.nc.summary.captions.all',
  'v2.nc.summary.captions.none',
  'v2.nc.summary.captions.tiles',
  'v2.nc.summary.captionsHint',
  'v2.nc.summary.captionsLabel',
  'v2.nc.summary.classesExcludeHint',
  'v2.nc.summary.classesExcludeLabel',
  'v2.nc.summary.classesHint',
  'v2.nc.summary.classesLabel',
  'v2.nc.summary.deliverEmptyHint',
  'v2.nc.summary.deliverEmptyLabel',
  'v2.nc.summary.editorTitle',
  'v2.nc.summary.includeStationaryHint',
  'v2.nc.summary.includeStationaryLabel',
  'v2.nc.summary.loadError',
  'v2.nc.summary.maxAiImagesHint',
  'v2.nc.summary.maxAiImagesLabel',
  'v2.nc.summary.maxTilesLabel',
  'v2.nc.summary.messageHint',
  'v2.nc.summary.minDwellHint',
  'v2.nc.summary.minDwellLabel',
  'v2.nc.summary.minImportanceHint',
  'v2.nc.summary.minImportanceLabel',
  'v2.nc.summary.problem.ai',
  'v2.nc.summary.problem.barrier',
  'v2.nc.summary.problem.budget',
  'v2.nc.summary.problem.caption',
  'v2.nc.summary.problem.filters',
  'v2.nc.summary.problem.template',
  'v2.nc.summary.rank.dwell',
  'v2.nc.summary.rank.importance',
  'v2.nc.summary.rank.recency',
  'v2.nc.summary.rankLabel',
  'v2.nc.summary.section.ai',
  'v2.nc.summary.section.content',
  'v2.nc.summary.section.delivery',
  'v2.nc.summary.section.mosaic',
  'v2.nc.summary.zonesHint',
  'v2.nc.summary.zonesLabel',
]

/** The list-row vocabulary, shared by both families. */
const FAMILY_ROW_KEYS: readonly string[] = [
  'v2.nc.family.never',
  'v2.nc.family.last',
  'v2.nc.family.off',
  'v2.nc.family.readOnly',
  // Plural form, i18next's `_one` / `_other` suffixes.
  'v2.nc.family.cameras_one',
  'v2.nc.family.cameras_other',
]

/** Reused from the rule editor rather than duplicated — see the docblock. */
const REUSED_KEYS: readonly string[] = [
  'v2.nc.rules.editor.section.rule',
  'v2.nc.rules.editor.section.devices',
  'v2.nc.rules.editor.section.notification',
  'v2.nc.rules.editor.nameLabel',
  'v2.nc.rules.editor.priorityLabel',
  'v2.nc.rules.editor.targetsLabel',
  'v2.nc.rules.editor.save',
  'v2.nc.rules.editor.create',
  'v2.nc.rules.cancel',
  'v2.nc.rules.loadError',
  'v2.nc.rules.personalBadge',
  'v2.nc.rules.adminBadge',
  'v2.nc.rules.edit',
  'v2.nc.rules.delete',
  'v2.nc.rules.deleteConfirmMessage',
  'v2.nc.rules.editor.templateTitleLabel',
  'v2.nc.rules.editor.templateBodyLabel',
  'v2.nc.rules.editor.readOnly',
  'v2.nc.rules.editor.missing',
  'v2.nc.rules.editor.unsaved.title',
  'v2.nc.rules.editor.unsaved.body',
  'v2.nc.rules.editor.unsaved.keep',
  'v2.nc.rules.editor.unsaved.discard',
]

describe.each([
  ['timelapse editor', TIMELAPSE_KEYS],
  ['summary editor', SUMMARY_KEYS],
  ['family list rows', FAMILY_ROW_KEYS],
  ['reused rule-editor strings', REUSED_KEYS],
])('%s', (_label, keys) => {
  it.each(keys)('%s is in both locales', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })
})

describe('the interpolations the screens actually pass', () => {
  it('counts the unlisted targets, kept or removed', () => {
    for (const key of ['v2.nc.rules.editor.unlistedTargetsKept', 'v2.nc.rules.editor.unlistedTargetsRemoved']) {
      expect(lookupLocale(enLocale, key)).toContain('{{count}}')
      expect(lookupLocale(itLocale, key)).toContain('{{count}}')
    }
  })

  it('names the rule in both edit titles', () => {
    for (const key of ['v2.nc.timelapse.editTitle', 'v2.nc.summary.editTitle']) {
      expect(lookupLocale(enLocale, key)).toContain('{{name}}')
      expect(lookupLocale(itLocale, key)).toContain('{{name}}')
    }
  })

  it('places the timestamp in the "last produced" line', () => {
    // The row passes `{ when }`; a translation that forgot the placeholder
    // would silently drop the one fact the line exists to carry.
    expect(lookupLocale(enLocale, 'v2.nc.family.last')).toContain('{{when}}')
    expect(lookupLocale(itLocale, 'v2.nc.family.last')).toContain('{{when}}')
  })
})
