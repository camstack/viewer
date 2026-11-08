import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { conditionDescriptionText, conditionHintKey } from '../condition-description.js'

const lookupIn = (locale: unknown) => (key: string): string | undefined => {
  let node: unknown = locale
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : undefined
}

describe('condition hint', () => {
  it('never returns the hub English description: no translation draws nothing', () => {
    expect(conditionDescriptionText({ id: 'unknownCondition' }, lookupIn(itLocale))).toBeNull()
  })

  it('the schedule hint is our own text, in both languages', () => {
    const it = conditionDescriptionText({ id: 'schedule' }, lookupIn(itLocale))
    const en = conditionDescriptionText({ id: 'schedule' }, lookupIn(enLocale))
    expect(it).not.toBeNull()
    expect(it).not.toContain('invertible')
    expect(en).not.toContain('invertible')
    expect(it).not.toBe(en)
  })

  it('every hub description that was drawn raw has a hint in en and it', () => {
    for (const id of ['minDwellSeconds', 'packagePhase', 'customZones', 'schedule']) {
      expect(lookupIn(enLocale)(conditionHintKey(id))).toBeTruthy()
      expect(lookupIn(itLocale)(conditionHintKey(id))).toBeTruthy()
    }
  })
})
