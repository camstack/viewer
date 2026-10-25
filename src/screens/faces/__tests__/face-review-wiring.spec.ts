/**
 * Source guards for the two Library → Review changes of 2026-09-01.
 *
 * The behaviour itself is asserted by value (`face-review-suggestions.spec.ts`,
 * `face-cluster-review.spec.ts`) and by mount (`face-review-selection-bar`,
 * `analyze-group-card`). What no other spec can see is whether the SCREEN and
 * the MODAL actually reach for those pieces — a perfectly-tested planner that
 * nothing calls is the residue this repo treats as worse than none.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const screen = readFileSync(join(process.cwd(), 'src/screens/faces/FaceReviewScreen.tsx'), 'utf8')
const jobs = readFileSync(join(process.cwd(), 'src/data/face-review-jobs.ts'), 'utf8')
const modal = readFileSync(join(process.cwd(), 'src/components/faces/FaceReviewAnalyzeModal.tsx'), 'utf8')
const card = readFileSync(join(process.cwd(), 'src/components/faces/AnalyzeGroupCard.tsx'), 'utf8')

describe('the selection bar offers BOTH writes', () => {
  it('the screen derives readiness from the selected ROWS and hands it to the bar', () => {
    expect(screen).toContain('suggestionApplyReadiness(selectionRows)')
    expect(screen).toContain('<FaceReviewSelectionBar')
    expect(screen).toContain('suggestions={suggestions}')
    expect(screen).toContain('onApplySuggestions=')
  })

  // ⚠ LOAD-BEARING: the write is grouped. Iterating the SELECTION instead of
  // the plan would be one `assignFaces` round trip per face — 40 calls where 3
  // are needed — and this is exactly the shape that regresses under a
  // "simplifying" edit. The loop is a queued job now (`applySuggestionsJob`).
  it('hands the plan to the queue, which writes one assignment per IDENTITY', () => {
    expect(screen).toContain('jobs.applySuggestions(plan,')
    expect(jobs).toContain('for (const entry of plan)')
    expect(jobs).toContain('identityId: entry.identityId, defer: true')
  })

  // ⚠ LOAD-BEARING: the loop is a BURST of batch writes. Each one used to
  // await five query invalidations AND this screen's own refetch, so a
  // selection spanning six people cost thirty-six round trips before the
  // operator got the UI back — his "si bloccava" (D434). The gallery is
  // re-read ONCE, after the plan is written.
  it('re-reads the gallery once at the END, not once per person', () => {
    const jobAt = jobs.indexOf('export function applySuggestionsJob')
    const loopAt = jobs.indexOf('for (const entry of plan)', jobAt)
    const flushAt = jobs.indexOf('await ports.flush()', loopAt)
    expect(loopAt).toBeGreaterThan(jobAt)
    expect(flushAt).toBeGreaterThan(loopAt)
  })

  it('reports the honest total, so a failed group cannot be counted as written', () => {
    expect(jobs).toContain('assigned += result.assigned')
    expect(jobs).toContain('v2.faceReview.applySuggestionsResult')
  })
})

describe('the page has no result or progress banner', () => {
  // The banner pushed the whole page down on every action. Its messages are
  // the Activity centre's now.
  it('keeps no banner or progress state, and draws none', () => {
    expect(screen).not.toContain('resultBanner')
    expect(screen).not.toContain('recomputeProgress')
    expect(screen).not.toContain('styles.banner')
    expect(screen).not.toContain('styles.progress')
  })

  it('puts its actions at the end of the ONE Library header row, below the scope bar', () => {
    // 2026-10-21: no second app bar — the `⋯` menu and the primary "+" ride
    // the filter bar's row, so the grid starts two rows under the scope bar.
    expect(screen).not.toContain('<ScreenHeader')
    expect(screen).toContain('more={overflowItems}')
    expect(screen).toContain("id: 'new-person'")
    expect(screen).toContain("id: 'recompute'")
  })

  it('draws the fixed block outside the scrolling list', () => {
    expect(screen).toContain('{top}')
    expect(screen).not.toContain('ListHeaderComponent')
  })

  it('queues every long action instead of awaiting it', () => {
    for (const call of ['jobs.recompute(', 'jobs.assign(', 'jobs.assignToNewPerson(', 'jobs.deleteFaces(', 'jobs.applySuggestions(']) {
      expect(screen).toContain(call)
    }
  })
})

describe('the review tab can delete a parked face, and only a parked one', () => {
  it('derives the deletion readiness from the selected ROWS and hands it to the bar', () => {
    expect(screen).toContain('faceDeletionReadiness(selectionRows)')
    expect(screen).toContain('deletion={deletion}')
    expect(screen).toContain('onDelete=')
  })

  // ⚠ LOAD-BEARING: `deleteFace` takes the crop media with the row. It is the
  // one irreversible action in this tab.
  it('confirms before deleting, and writes only what the rule named', () => {
    expect(screen).toContain("t('v2.faceReview.deleteConfirmTitle'")
    expect(screen).toContain('const targets = deletion.faceIds')
    expect(screen).toContain('if (!deletion.ready || targets.length === 0) return')
    const confirmAt = screen.indexOf("t('v2.faceReview.deleteConfirmTitle'")
    const writeAt = screen.indexOf('jobs.deleteFaces(')
    expect(writeAt).toBeGreaterThan(confirmAt)
  })

  it('reports the honest total the hub gave, not the number asked for', () => {
    expect(jobs).toContain("t('v2.faceReview.deleteResult', { count: result.deleted, total: faceIds.length })")
  })
})

describe('a person can be created without a face in hand', () => {
  it('prompts for a name and writes it through createIdentity', () => {
    expect(screen).toContain("t('v2.faceReview.newPersonButton')")
    expect(screen).toContain('createIdentity.mutateAsync({ name: trimmed })')
    // An empty prompt is a cancel, not a person called "".
    expect(screen).toContain('if (trimmed.length === 0) return')
  })
})

describe('a person is chosen through the searchable picker, never a chip row', () => {
  // ⚠ LOAD-BEARING: this was a chip per identity, drawn once per surface and
  // once per analyze GROUP. It is what the operator reported as unusable.
  it('the screen opens the picker for the sample audit', () => {
    expect(screen).toContain('<IdentityPickerSheet')
    expect(screen).toContain('setAuditPickerOpen(true)')
    expect(screen).toContain('setAuditIdentityId(person.id)')
    expect(screen).not.toContain('identities.map((person) => (')
  })

  it('the analyze modal owns ONE picker for every group', () => {
    expect(modal).toContain('<IdentityPickerSheet')
    expect(modal).toContain('open={pickerForGroup !== null}')
    expect(modal).toContain('onOpenPicker={() => setPickerForGroup(item.representativeFaceId)}')
  })

  it('the card names the chosen person and lists nobody', () => {
    expect(card).toContain('selectedIdentityName')
    expect(card).toContain('onOpenPicker')
    expect(card).not.toContain('identities.map')
    expect(card).not.toContain('ScrollView')
  })
})

describe('the Analyze modal picks a known person and can no longer create one', () => {
  // ⚠ LOAD-BEARING: the free-text field resolved what was typed and MINTED a
  // new identity when nothing matched, so one typo forked a gallery in two.
  it('has no text field and no identity creation left in it', () => {
    expect(modal).not.toContain('TextInput')
    expect(modal).not.toContain('createIdentity')
    expect(modal).not.toContain('resolveIdentityByName')
    expect(modal).not.toContain('analyzeNamePlaceholder')
    // The picker it opens CAN create — for the caller that passes `onCreate`.
    // This one must not, and the absence is the whole guard.
    expect(modal).not.toContain('onCreate=')
  })

  // ⚠ LOAD-BEARING, and the reason the modal went quiet after the first batch:
  // the pool it fetches and the horizon the hub clusters were two different
  // numbers, and `restrictClustersToPool` silently dropped the difference. The
  // window rule itself is asserted by value in
  // `data/__tests__/face-review-analyze-window.spec.ts`; this is whether the
  // label still names a number the window no longer has.
  it('does not put the window size on the button', () => {
    expect(screen).toContain("t('v2.faceReview.analyzeButton')")
    expect(screen).not.toContain('ANALYZE_POOL_SIZE')
    expect(modal).not.toContain('requested: ANALYZE_POOL_SIZE')
  })

  it('assigns to the identity the plan carries, never to a name', () => {
    expect(jobs).toContain('identityId: entry.identityId, defer: true')
    expect(modal).toContain('jobs.analyzeAssign(plan)')
    expect(modal).toContain('seedAnalyzeIdentitySelection(groups)')
    expect(modal).toContain('buildAnalyzeAssignPlan(groups, selection, excluded)')
  })

  // ⚠ LOAD-BEARING: the ✕ existed before — behind a pager, one member at a
  // time. Putting the carousel back would restore the defect the operator
  // reported as "you cannot remove items from a group".
  it('renders the members through the grid card, not a carousel', () => {
    expect(modal).toContain('AnalyzeGroupCard')
    expect(modal).not.toContain('CarouselPager')
  })

  // The header, the confirm dialog and the result banner are the SAME
  // arithmetic over the surviving members — the property that predates the
  // grid and must not drift now that the container changed.
  it('counts the confirm dialog and the write from the same plan', () => {
    expect(modal).toContain('plan.reduce((sum, e) => sum + e.faceIds.length, 0)')
    expect(jobs).toContain('plan.reduce((sum, entry) => sum + entry.faceIds.length, 0)')
    expect(modal).toContain('analyzeCoverage(groups, pool.data?.length ?? 0, excluded)')
  })
})

/**
 * The enlarge-a-crop overlay. Its GESTURE half is asserted by mount
 * (`components/faces/__tests__/analyze-group-card.spec.ts`); these are the two
 * halves a renderer cannot see.
 */
describe('the detail overlay has one write path and an accessible way in', () => {
  // ⚠ LOAD-BEARING, and unassertable by mount: react-native-web drops
  // `accessibilityActions` and `onAccessibilityAction` without a DOM trace
  // (verified 2026-09-01), so nothing but this guard stands between the
  // screen-reader path and a silent removal. A long press is not performable
  // with VoiceOver or TalkBack — gesture-only would mean function-less.
  it('offers the detail as a named accessibility action, not only as a gesture', () => {
    expect(card).toContain('export const SHOW_DETAIL_ACTION')
    expect(card).toContain('accessibilityActions={[{ name: SHOW_DETAIL_ACTION')
    expect(card).toContain('onAccessibilityAction=')
    // Advertised name and answered name are the SAME constant: a rename that
    // touched one of the two would kill the accessible path in silence.
    expect(card).toContain('event.nativeEvent.actionName === SHOW_DETAIL_ACTION')
    expect(card).toContain("t('v2.faceReview.groupShowDetail')")
  })

  it('routes both the gesture and the accessible action through one opener', () => {
    expect(card).toContain('onLongPress={() => showDetail(member.faceId)}')
    expect(card).toContain('if (event.nativeEvent.actionName === SHOW_DETAIL_ACTION) showDetail(member.faceId)')
  })

  // ⚠ LOAD-BEARING: excluding from the overlay is the SAME write the grid tile
  // makes. The card holds exactly ONE piece of state — which crop is open —
  // and reads inclusion from the prop; a second `useState` here would be the
  // overlay keeping its own idea of who is in the group.
  it('excludes through the caller, and keeps no second copy of the inclusion', () => {
    expect(card).toContain('onToggleMember(detailMember.faceId)')
    expect(card).toContain('excluded.has(detailMember.faceId)')
    // One `= useState` in the whole file: `detailFaceId`, and nothing else.
    expect(card.match(/= useState/g) ?? []).toHaveLength(1)
    expect(card).not.toContain('toggleGroupFaceExclusion')
  })
})
