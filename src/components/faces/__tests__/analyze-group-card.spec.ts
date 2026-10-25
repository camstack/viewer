/**
 * @vitest-environment jsdom
 *
 * One look-alike group in the Analyze modal, MOUNTED.
 *
 * Two claims this file exists to hold down:
 *
 *   1. **Every member is reachable at once.** Excluding a face already worked
 *      before 2026-09-01 — inside a `CarouselPager`, one member per page. The
 *      function was there and the road to it was not, which is why the operator
 *      reported it as missing. The grid must expose one control PER MEMBER,
 *      with no paging in between.
 *   2. **The person is picked, never typed.** The card offers the known people
 *      and nothing else; there is no text field, because a typo in one used to
 *      mint a second identity and split somebody's gallery.
 *
 *   3. **A long press enlarges a crop, and never excludes it.** The grid gave
 *      up the carousel's one big page, so the detail comes back as an overlay.
 *      React Native suppresses `onPress` when `onLongPress` fires — that is
 *      asserted here rather than assumed, because a mis-tap that silently
 *      strikes a face out of the write is exactly the failure the ✕ redesign
 *      exists to prevent.
 *
 * What gets WRITTEN from those three facts is asserted by value in
 * `data/__tests__/face-cluster-review.spec.ts` (`buildAnalyzeAssignPlan`).
 *
 * ⚠ The screen-reader path (`accessibilityActions`) CANNOT be asserted here:
 * react-native-web drops both `accessibilityActions` and `onAccessibilityAction`
 * without a DOM trace (verified 2026-09-01). It is guarded statically instead —
 * `screens/faces/__tests__/face-review-wiring.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { AnalyzeGroupCard } from '../AnalyzeGroupCard.js'
import type { AnalyzeGroupRow } from '../../../data/face-cluster-review.js'
import type { PersonIdentity } from '../../../data/use-face-gallery.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const IDENTITIES: readonly PersonIdentity[] = [
  { id: 'alice', name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
]

const MEMBER_IDS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const

const GROUP: AnalyzeGroupRow = {
  representativeFaceId: 'f1',
  members: MEMBER_IDS.map((faceId, i) => ({
    faceId,
    timestamp: i,
    cropUrl: `/media/${faceId}.jpg`,
    base64: undefined,
  })),
  proposedIdentityId: 'alice',
  proposedName: 'Alice',
}

interface CardOverrides {
  readonly selectedIdentityId?: string | undefined
  readonly excluded?: ReadonlySet<string>
  readonly onToggleMember?: (faceId: string) => void
  readonly onOpenPicker?: () => void
}

function mountCard(overrides: CardOverrides = {}) {
  const selectedIdentityId =
    'selectedIdentityId' in overrides ? overrides.selectedIdentityId : 'alice'
  return mountScreen(
    React.createElement(AnalyzeGroupCard, {
      group: GROUP,
      selectedIdentityId,
      selectedIdentityName: IDENTITIES.find((i) => i.id === selectedIdentityId)?.name,
      excluded: overrides.excluded ?? new Set<string>(),
      cropUriFor: (member) => member.cropUrl ?? null,
      mediaHeaders: undefined,
      disabled: false,
      onToggleMember: overrides.onToggleMember ?? ((): void => undefined),
      onOpenPicker: overrides.onOpenPicker ?? ((): void => undefined),
    }),
  )
}

/**
 * A real long press: press, hold past `delayLongPress`, release.
 *
 * Requires fake timers — react-native-web's press responder schedules the long
 * press on a `setTimeout`. The release is a `mouseUp` and NOT a `click`,
 * because that is what a held finger produces; a `click` here would be a
 * different gesture and would prove nothing about the two coexisting.
 */
function longPress(el: HTMLElement): void {
  act(() => {
    fireEvent.mouseDown(el)
    vi.advanceTimersByTime(600)
    fireEvent.mouseUp(el)
  })
}

/** The overlay is a `Modal` — react-native-web portals it out of `container`. */
function overlayText(): string {
  return document.body.textContent ?? ''
}

function bodyButtonLabelled(label: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll('[role="button"]')].find(
    (el) => el.textContent === label,
  ) as HTMLElement | undefined
}

function buttonsLabelled(container: HTMLElement, label: string): HTMLElement[] {
  return [...container.querySelectorAll('[role="button"]')].filter(
    (el) => el.getAttribute('aria-label') === label,
  ) as HTMLElement[]
}

const EXCLUDE = (): string => i18n.t('v2.faceReview.groupExcludeFace')
const INCLUDE = (): string => i18n.t('v2.faceReview.groupIncludeFace')

describe('the members are a grid, not a carousel', () => {
  // ⚠ LOAD-BEARING: ONE control per member, all present simultaneously. A
  // pager renders a single page, so this count collapses to 1 the moment the
  // grid is put back behind one.
  it('exposes one exclusion control per member, all at once', () => {
    const { container } = mountCard()
    expect(buttonsLabelled(container, EXCLUDE())).toHaveLength(MEMBER_IDS.length)
  })

  it('a member deep in the group can be struck out without paging to it', () => {
    const onToggleMember = vi.fn()
    const { container } = mountCard({ onToggleMember })
    const tiles = buttonsLabelled(container, EXCLUDE())
    fireEvent.click(tiles[MEMBER_IDS.length - 1] as HTMLElement)
    expect(onToggleMember).toHaveBeenCalledWith('f5')
  })

  it('an excluded member reads as excluded and offers to come back', () => {
    const onToggleMember = vi.fn()
    const { container } = mountCard({ excluded: new Set(['f2']), onToggleMember })
    const back = buttonsLabelled(container, INCLUDE())
    expect(back).toHaveLength(1)
    expect(buttonsLabelled(container, EXCLUDE())).toHaveLength(MEMBER_IDS.length - 1)
    fireEvent.click(back[0] as HTMLElement)
    expect(onToggleMember).toHaveBeenCalledWith('f2')
  })

  it('the header count follows the survivors, not the membership', () => {
    const { container } = mountCard({ excluded: new Set(['f2', 'f3']) })
    expect(container.textContent).toContain(i18n.t('v2.faceReview.groupSize', { count: 3 }))
  })
})

describe('long press enlarges a crop without excluding it', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // ⚠ LOAD-BEARING: `onLongPress` suppressing `onPress` is a React Native
  // guarantee, and this is the assertion that it still holds for THIS tile —
  // a stray `onPressOut`, or a hand-rolled timer, would break it silently and
  // every enlarge would strike a face out of the write.
  it('holding a tile opens the detail and leaves the inclusion untouched', () => {
    vi.useFakeTimers()
    const onToggleMember = vi.fn()
    const { container } = mountCard({ onToggleMember })
    longPress(buttonsLabelled(container, EXCLUDE())[2] as HTMLElement)
    expect(overlayText()).toContain(i18n.t('v2.faceReview.groupDetailExclude'))
    expect(onToggleMember).not.toHaveBeenCalled()
  })

  it('a short tap still excludes, and opens nothing', () => {
    vi.useFakeTimers()
    const onToggleMember = vi.fn()
    const { container } = mountCard({ onToggleMember })
    fireEvent.click(buttonsLabelled(container, EXCLUDE())[2] as HTMLElement)
    expect(onToggleMember).toHaveBeenCalledWith('f3')
    expect(overlayText()).not.toContain(i18n.t('v2.faceReview.groupDetailExclude'))
  })

  // ⚠ LOAD-BEARING: excluding from the overlay must be the SAME write the grid
  // makes. A second path — the overlay keeping its own idea of who is in —
  // is how the UI ends up showing one thing while the hub is told another.
  it('the overlay excludes through the same callback the grid uses', () => {
    vi.useFakeTimers()
    const onToggleMember = vi.fn()
    const { container } = mountCard({ onToggleMember })
    longPress(buttonsLabelled(container, EXCLUDE())[1] as HTMLElement)
    const toggle = bodyButtonLabelled(i18n.t('v2.faceReview.groupDetailExclude'))
    expect(toggle).toBeDefined()
    fireEvent.click(toggle as HTMLElement)
    expect(onToggleMember).toHaveBeenCalledTimes(1)
    expect(onToggleMember).toHaveBeenCalledWith('f2')
  })

  // The same rule seen from the read side: the overlay REPORTS the state that
  // came down as a prop. A local copy would open on "Exclude" for a member the
  // grid already shows struck out.
  it('the overlay reads the inclusion state from the prop, not from itself', () => {
    vi.useFakeTimers()
    const { container } = mountCard({ excluded: new Set(['f2']) })
    longPress(buttonsLabelled(container, INCLUDE())[0] as HTMLElement)
    expect(overlayText()).toContain(i18n.t('v2.faceReview.groupDetailInclude'))
    expect(bodyButtonLabelled(i18n.t('v2.faceReview.groupDetailExclude'))).toBeUndefined()
  })
})

/**
 * Since 2026-09-13 the card does not LIST the people. A chip per identity,
 * repeated under every group card, is what the operator called a selector that
 * *"li crescerebbe troppo"* — three groups over forty people drew a hundred and
 * twenty chips. The card now names the chosen person and hands the choosing to
 * `IdentityPickerSheet`, which the MODAL owns.
 */
describe('the person is named here and picked elsewhere', () => {
  // ⚠ LOAD-BEARING and unchanged in substance: the free-text field minted an
  // identity from a typo. Nothing in this card may be typed into.
  it('has nothing to type into', () => {
    const { container } = mountCard()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
  })

  // ⚠ LOAD-BEARING: the clustering's proposal PRE-SELECTS, so the common case
  // stays one tap on Confirm — and the operator can SEE who that is without
  // opening anything.
  it('names the proposed person on the row', () => {
    const { container } = mountCard()
    const selected = [...container.querySelectorAll('[role="button"][aria-selected="true"]')]
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toContain('Alice')
  })

  it('asks for a person when the clustering proposed nobody', () => {
    const { container } = mountCard({ selectedIdentityId: undefined })
    expect(container.querySelectorAll('[role="button"][aria-selected="true"]')).toHaveLength(0)
    expect(container.textContent).toContain(i18n.t('v2.faceReview.groupPickNone'))
  })

  it('opens the picker when the row is tapped', () => {
    const onOpenPicker = vi.fn()
    const { container } = mountCard({ onOpenPicker })
    const row = [...container.querySelectorAll('[role="button"]')].find(
      (el) => el.getAttribute('aria-label') === i18n.t('v2.faceReview.groupPickPerson'),
    )
    expect(row).toBeDefined()
    fireEvent.click(row as HTMLElement)
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
  })
})
