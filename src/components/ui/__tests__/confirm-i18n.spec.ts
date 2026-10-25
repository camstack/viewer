/**
 * The confirmation surface's DEFAULT wording, in both locales.
 *
 * `useConfirm({ title })` with no labels falls back to `v2.common.confirm` /
 * `v2.common.cancel`, and `useNotice` to `v2.common.ok`. A missing key does not
 * throw: i18next renders the dotted key itself, so the operator would be asked
 * to press a button reading `v2.common.confirm`. Same guard shape as
 * `screens/faces/__tests__/face-review-i18n.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const DEFAULT_LABEL_KEYS: readonly string[] = [
  'v2.common.confirm',
  'v2.common.cancel',
  'v2.common.ok',
]

describe('the shared confirm/notice labels exist in both locales', () => {
  for (const key of DEFAULT_LABEL_KEYS) {
    it(`${key} — en`, () => {
      const value = lookupLocale(enLocale, key)
      expect(value, `missing en key: ${key}`).toBeTypeOf('string')
      expect(value?.length ?? 0).toBeGreaterThan(0)
    })
    it(`${key} — it`, () => {
      const value = lookupLocale(itLocale, key)
      expect(value, `missing it key: ${key}`).toBeTypeOf('string')
      expect(value?.length ?? 0).toBeGreaterThan(0)
    })
  }

  it('is actually translated, not the English string copied across', () => {
    // A blank or duplicated Italian label is how a "complete" locale still
    // reads in English on the one button an operator must press.
    expect(lookupLocale(itLocale, 'v2.common.confirm')).toBe('Conferma')
    expect(lookupLocale(itLocale, 'v2.common.cancel')).toBe('Annulla')
  })
})
