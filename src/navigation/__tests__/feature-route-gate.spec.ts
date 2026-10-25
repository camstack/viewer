/**
 * Feature routes reachable by URL (D921): without the feature they never
 * mount — they wait for `auth.me`, then render or redirect to the Library
 * with "not available for your account".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_ROUTE_FALLBACK, featureRouteDecision } from '../feature-route-gate.js'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

function routeFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name)
    return statSync(join(ROOT, rel)).isDirectory() ? routeFiles(rel) : [rel]
  })
}

/** Every route that mounts a feature screen, and the feature it needs. */
const FEATURE_ROUTES: Readonly<Record<string, string>> = {
  'app/(app)/retrain/[frameId].tsx': 'retrain',
}

/** Screens that belong to a feature section and must never be mounted by a route ungated. */
const FEATURE_SCREENS = [
  'RetrainEditorScreen',
  'RetrainScreen',
  'FaceReviewScreen',
  'FaceReviewDetailModal',
  'IdentityAuditModal',
  'PlateReviewScreen',
  'PlateReviewDetailModal',
  'ScenesScreen',
]

describe('featureRouteDecision', () => {
  it('renders with the feature, even before auth.me settles a refetch', () => {
    expect(featureRouteDecision({ pending: false, held: true })).toBe('render')
    expect(featureRouteDecision({ pending: true, held: true })).toBe('render')
  })

  it('waits while auth.me is unanswered — never mounts the screen, never redirects early', () => {
    expect(featureRouteDecision({ pending: true, held: false })).toBe('wait')
  })

  it('redirects to the Library once the hub answered without the feature', () => {
    expect(featureRouteDecision({ pending: false, held: false })).toBe('redirect')
    expect(FEATURE_ROUTE_FALLBACK).toBe('/events')
  })
})

describe('the retrain editor route (/retrain/[frameId])', () => {
  it('mounts the editor only inside a retrain FeatureRouteGate', () => {
    const src = read('app/(app)/retrain/[frameId].tsx')
    expect(src).toContain('<FeatureRouteGate feature="retrain">')
    expect(src.indexOf('<FeatureRouteGate')).toBeLessThan(src.indexOf('<RetrainEditorScreen'))
  })
})

describe('no other route mounts a feature screen ungated', () => {
  it('every app/ route that renders a feature screen is listed and gated on its feature', () => {
    for (const file of routeFiles('app')) {
      const src = read(file)
      const mounts = FEATURE_SCREENS.filter((name) => src.includes(`<${name}`))
      if (mounts.length === 0) continue
      const feature = FEATURE_ROUTES[file]
      expect(feature, `${file} mounts ${mounts.join(', ')} without a FeatureRouteGate entry`).toBeDefined()
      expect(src).toContain(`<FeatureRouteGate feature="${feature}">`)
    }
  })
})

describe('the gate component', () => {
  it('replaces the route with the Library and tells the person why', () => {
    const src = read('src/navigation/FeatureRouteGate.tsx')
    expect(src).toContain('router.replace(FEATURE_ROUTE_FALLBACK)')
    expect(src).toContain('notice({ title: t(NOT_FOR_YOUR_ACCOUNT_KEY) })')
    expect(src).toContain("if (decision === 'render') return <>{children}</>")
  })
})
