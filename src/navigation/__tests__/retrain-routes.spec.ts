import { describe, expect, it } from 'vitest'
import { parseRetrainScope, retrainFrameHref } from '../retrain-routes.js'

describe('retrain routes', () => {
  it('carries the Library filter as search params', () => {
    expect(retrainFrameHref('f1', { deviceId: 101, collectionId: 'c1' })).toEqual({
      pathname: '/retrain/[frameId]',
      params: { frameId: 'f1', deviceId: '101', collectionId: 'c1' },
    })
    expect(retrainFrameHref('f1')).toEqual({ pathname: '/retrain/[frameId]', params: { frameId: 'f1' } })
  })

  it('parses a scope, dropping junk', () => {
    expect(parseRetrainScope({ deviceId: '101', collectionId: 'c1' })).toEqual({ deviceId: 101, collectionId: 'c1' })
    expect(parseRetrainScope({ deviceId: 'abc' })).toEqual({ deviceId: null, collectionId: null })
    expect(parseRetrainScope({ deviceId: ['7'], collectionId: '' })).toEqual({ deviceId: 7, collectionId: null })
  })
})
