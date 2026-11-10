/**
 * Every string the Actions sub-screen asks for, in BOTH locales.
 *
 * A missing key does not throw — i18next draws the key itself. The list is
 * written out rather than derived from the screen: what is checked is that the
 * screen and the locale agree about a literal.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { NcNotificationActionIconSchema } from '../../../data/notification-center.js'

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const UI = 'v2.nc.rules.editor.actions'
const UI_KEYS: readonly string[] = [
  'securityNote',
  'problemsTitle',
  'actionsHint',
  'actionsNone',
  'actionsLoading',
  'actionsUnavailable',
  'actionsRetry',
  'unknownActions',
  'hook.onActivation.title',
  'hook.onActivation.hint',
  'hook.onDeactivation.title',
  'hook.onDeactivation.hint',
  'hook.onTrigger.title',
  'hook.onTrigger.hint',
  'hook.onTriggerOff.title',
  'hook.onTriggerOff.hint',
  'hookEmpty',
  'actionLabel',
  'actionMissing',
  'actionById',
  'actionSearchPlaceholder',
  'actionNoMatch',
  'pickAction',
  'addAction',
  'moveUp',
  'moveDown',
  'removeBinding',
  'buttonsTitle',
  'buttonsEmpty',
  'buttonsHint',
  'addButton',
  'removeButton',
  'buttonLabelLabel',
  'buttonDefaultLabel',
  'buttonActionLabel',
  'buttonIconLabel',
  'iconNone',
  'destructiveLabel',
  'destructiveHint',
].map((key) => `${UI}.${key}`)

const ICON_KEYS = NcNotificationActionIconSchema.options.map((icon) => `${UI}.icon.${icon}`)

/** Every error `rule-action-form` can raise — they are drawn in the problems list. */
const ERR = 'v2.nc.rules.actions'
const ERROR_KEYS: readonly string[] = [
  'hookMissingAction',
  'tooManyActions',
  'buttonMissingLabel',
  'duplicateButton',
  'buttonMissingAction',
  'tooManyButtons',
  'labelTooLong',
  'idTooLong',
].map((key) => `${ERR}.${key}`)

describe('Actions sub-screen strings', () => {
  it.each([...UI_KEYS, ...ICON_KEYS, ...ERROR_KEYS])('%s exists in en and it', (key) => {
    expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
    expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
  })
  it('the placeholder "admin console only" text is gone — the screen edits now', () => {
    expect(lookupLocale(enLocale, `${UI}.empty`)).toBeUndefined()
    expect(lookupLocale(itLocale, `${UI}.empty`)).toBeUndefined()
  })
})
