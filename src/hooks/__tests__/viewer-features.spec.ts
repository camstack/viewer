/**
 * Which features a session holds (D921): an admin all of them, a viewer the
 * ones its row lists, a legacy `scoped` user and an unanswered `auth.me` none.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_VIEWER_FEATURES,
  grantedFeatures,
  holdsFeature,
  isViewerFeatureId,
  parseViewerFeatures,
  type FeatureSessionInput,
  type ViewerFeatureId,
} from '../viewer-features.js'

const viewer = (features: readonly ViewerFeatureId[]): FeatureSessionInput => ({
  isAdmin: false,
  scope: { role: 'viewer', features },
})

describe('grantedFeatures', () => {
  it('an unanswered session holds nothing (fail-closed)', () => {
    expect(grantedFeatures(undefined)).toEqual([])
    expect(grantedFeatures(null)).toEqual([])
  })

  it('an admin holds every feature — by the top-level flag, on a hub with no scope too', () => {
    expect(grantedFeatures({ isAdmin: true, scope: null })).toEqual(ALL_VIEWER_FEATURES)
    expect(grantedFeatures({ isAdmin: true, scope: { role: 'admin', features: [] } })).toEqual(ALL_VIEWER_FEATURES)
    expect(grantedFeatures({ isAdmin: false, scope: { role: 'admin', features: [] } })).toEqual(ALL_VIEWER_FEATURES)
  })

  it('a viewer holds exactly the features its row lists', () => {
    expect(grantedFeatures(viewer([]))).toEqual([])
    expect(grantedFeatures(viewer(['plate-assignment']))).toEqual(['plate-assignment'])
  })

  it('a legacy scoped user, and a non-admin on a hub with no scope, hold none', () => {
    expect(grantedFeatures({ isAdmin: false, scope: { role: 'scoped', features: [] } })).toEqual([])
    expect(grantedFeatures({ isAdmin: false, scope: null })).toEqual([])
  })

  it.each(ALL_VIEWER_FEATURES)('a viewer with only %s holds it and nothing else', (feature) => {
    const granted = grantedFeatures(viewer([feature]))
    for (const other of ALL_VIEWER_FEATURES) expect(holdsFeature(granted, other)).toBe(other === feature)
  })
})

describe('the catalog', () => {
  it('knows the four seeded features in catalog order', () => {
    expect(ALL_VIEWER_FEATURES).toEqual(['face-assignment', 'plate-assignment', 'retrain', 'scenes'])
  })

  it('refuses ids it does not know, and anything that is not a string', () => {
    expect(isViewerFeatureId('retrain')).toBe(true)
    expect(isViewerFeatureId('toString')).toBe(false)
    expect(isViewerFeatureId(3)).toBe(false)
    expect(parseViewerFeatures('retrain')).toEqual([])
    expect(parseViewerFeatures(['scenes', 'scenes', 7, 'x'])).toEqual(['scenes'])
  })
})
