import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import {
  toAddFrameFromRecordingOutcome,
  toCreateRetrainCollectionOutcome,
  toRetrainCollection,
  toRetrainCollectionList,
  trainingFrameRefusalText,
  TRAINING_FRAME_REFUSAL_KEY,
} from '../use-retrain-collections.js'

describe('toRetrainCollection', () => {
  it('parses a valid row', () => {
    expect(
      toRetrainCollection({ id: 'c1', name: 'porch night', createdAt: 1, frameCount: 3 }),
    ).toEqual({ id: 'c1', name: 'porch night', createdAt: 1, frameCount: 3 })
  })

  it('rejects a broken row', () => {
    expect(toRetrainCollection({ id: 'c1', name: 'x' })).toBeNull()
    expect(toRetrainCollection(null)).toBeNull()
  })
})

describe('toRetrainCollectionList', () => {
  it('skips broken rows', () => {
    expect(
      toRetrainCollectionList([
        { id: 'a', name: 'A', createdAt: 1, frameCount: 0 },
        { id: 'bad' },
        { id: 'b', name: 'B', createdAt: 2, frameCount: 1 },
      ]),
    ).toEqual([
      { id: 'a', name: 'A', createdAt: 1, frameCount: 0 },
      { id: 'b', name: 'B', createdAt: 2, frameCount: 1 },
    ])
  })
})

describe('toCreateRetrainCollectionOutcome', () => {
  it('parses created and refused', () => {
    expect(
      toCreateRetrainCollectionOutcome({
        kind: 'created',
        collection: { id: 'c1', name: 'x', createdAt: 1, frameCount: 0 },
      }),
    ).toMatchObject({ kind: 'created' })
    expect(toCreateRetrainCollectionOutcome({ kind: 'refused', reason: 'empty-name' })).toEqual({
      kind: 'refused',
      reason: 'empty-name',
    })
  })
})

describe('toAddFrameFromRecordingOutcome', () => {
  it('parses added without requiring the full frame shape beyond id', () => {
    expect(
      toAddFrameFromRecordingOutcome({
        kind: 'added',
        collectionId: 'c1',
        reused: true,
        frame: { id: 'f1' },
      }),
    ).toEqual({ kind: 'added', collectionId: 'c1', reused: true })
  })

  it('parses named refusals', () => {
    expect(
      toAddFrameFromRecordingOutcome({
        kind: 'refused',
        reason: 'still-unavailable',
        detail: 'gap',
      }),
    ).toEqual({ kind: 'refused', reason: 'still-unavailable', detail: 'gap' })
  })
})

describe('trainingFrameRefusalText', () => {
  const en = i18next.createInstance()
  void en.init({ lng: 'en', resources: { en: { translation: enLocale } }, initAsync: false, showSupportNotice: false })

  it('names every refusal and appends detail', () => {
    expect(trainingFrameRefusalText(en.t, 'still-busy')).toMatch(/busy/i)
    expect(trainingFrameRefusalText(en.t, 'write-failed', 'disk full')).toMatch(/disk full/)
  })

  it('every refusal has a sentence in both locales', () => {
    for (const key of [...Object.values(TRAINING_FRAME_REFUSAL_KEY), 'v2.retrain.frameRefusal.withDetail']) {
      for (const tree of [enLocale, itLocale]) {
        const value = key.split('.').reduce<unknown>(
          (node, part) => (node !== null && typeof node === 'object' ? new Map(Object.entries(node)).get(part) : undefined),
          tree,
        )
        expect(value, key).toBeTypeOf('string')
      }
    }
  })
})
