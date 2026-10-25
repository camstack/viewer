/**
 * The feature gates outside the Library shell (D921). A viewer sees the NAME
 * on a face (names in events are shown to everyone who sees the events); the
 * controls that CHANGE the assignment are `face-assignment` only, and the
 * retrain staging controls are `retrain` only. Where a track was inferred is
 * diagnostic and shown to an admin only (D924).
 *
 * Source-level, like `library-wiring.spec.ts`: these screens need the whole
 * React Native tree to mount.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the track detail — names for all, assignment for face-assignment', () => {
  const src = read('src/components/events/track/TrackDetailView.tsx')

  it('reads the feature from the hub-confirmed session', () => {
    expect(src).toContain("const canAssignFaces = useHasFeature('face-assignment')")
  })

  it('always renders the person name, outside any gate', () => {
    const name = src.indexOf("{face.identityName ?? t('v2.tracks.notAssigned')}")
    const gate = src.indexOf('{canAssignFaces ? (')
    expect(name).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(name)
  })

  it('draws the assign button and the suggestion confirm only with the feature', () => {
    expect(src).toMatch(/\{canAssignFaces \? \(\s*<Pressable\s+onPress=\{\(\) => \{ hapticTap\(\); setAssignOpen\(true\) \}\}/)
    expect(src).toMatch(/\{canAssignFaces \? \(\s*<FaceSuggestionRow/)
    expect(src).toContain('face={assignOpen && canAssignFaces ? face : null}')
  })

  it('shows where the track was inferred to an admin only', () => {
    expect(src).toContain('const isAdmin = useIsAdmin()')
    expect(src).toContain('showPlacement={isAdmin}')
  })
})

describe('the events gallery — the "?" assignment chip is face-assignment only', () => {
  it('EventsScreen passes the feature and never opens the sheet without it', () => {
    const src = read('src/screens/EventsScreen.tsx')
    expect(src).toContain("const canAssignFaces = useHasFeature('face-assignment')")
    expect(src).toContain('canAssignFaces={canAssignFaces}')
    expect(src).toContain("if (intent === 'assign-face' && canAssignFaces) setAssignRow(row)")
  })

  it('EventsGallery drops the chip handler without the feature', () => {
    const src = read('src/components/events/gallery/EventsGallery.tsx')
    expect(src).toContain('const onAssignFace = canAssignFaces ? assignFace : undefined')
  })
})

describe('retrain staging — retrain only', () => {
  it.each([
    'src/data/use-retrain-collections.ts',
    'src/data/use-retrain-corpus.ts',
    'src/components/camera/theater/SendFrameToTrainingControl.tsx',
  ])('%s gates on the retrain feature, not on admin', (file) => {
    const src = read(file)
    expect(src).toContain("const canRetrain = useHasFeature('retrain')")
    expect(src).not.toContain('useIsAdmin')
  })
})

describe('a refusal tells the person it is not for their account', () => {
  it.each([
    'src/components/events/track/FaceAssignSheet.tsx',
    'src/screens/faces/FaceReviewScreen.tsx',
    'src/screens/plates/PlateReviewScreen.tsx',
  ])('%s maps a FORBIDDEN through refusalAwareKey', (file) => {
    expect(read(file)).toContain('refusalAwareKey(err, ')
  })

  it('capQuery and the query cache both re-ask the role on a refusal', () => {
    expect(read('src/data/cap-query.ts')).toContain('if (isForbiddenError(e)) signalForbidden()')
    const client = read('src/app/query-client.ts')
    expect(client).toContain('signalForbidden()')
    expect(client).toContain('setForbiddenHandler(')
  })
})
