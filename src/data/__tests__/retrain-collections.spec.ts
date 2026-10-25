import { describe, expect, it } from 'vitest'
import {
  toAddFrameFromRecordingOutcome,
  toCreateRetrainCollectionOutcome,
  toRetrainCollection,
  toRetrainCollectionList,
  trainingFrameRefusalText,
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
  it('names every refusal and appends detail', () => {
    expect(trainingFrameRefusalText('still-busy')).toMatch(/busy/i)
    expect(trainingFrameRefusalText('write-failed', 'disk full')).toMatch(/disk full/)
  })
})
