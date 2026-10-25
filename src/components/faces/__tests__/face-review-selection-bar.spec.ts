/**
 * @vitest-environment jsdom
 *
 * The review tab's selection bar, MOUNTED.
 *
 * What is under test is the operator-facing half of "Apply suggestion": that
 * the button is offered only for a selection where every face has one, that it
 * SAYS why when it is not (a mute disabled control sends the operator hunting
 * through the grid for a face the app already identified), and that the label
 * carries the count of what would be written.
 *
 * The write itself — the grouping by identity — is asserted by value in
 * `data/__tests__/face-review-suggestions.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { buildFaceReviewRows } from '../../../data/face-cluster-review.js'
import { suggestionApplyReadiness } from '../../../data/face-review-suggestions.js'
import { faceDeletionReadiness } from '../../../data/face-review-deletion.js'
import { FaceReviewSelectionBar } from '../FaceReviewSelectionBar.js'
import type { PersonIdentity, TrackFace } from '../../../data/use-face-gallery.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const IDENTITIES: readonly PersonIdentity[] = [
  { id: 'alice', name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
]

function face(faceId: string, suggestedIdentityId?: string): TrackFace {
  return {
    faceId,
    deviceId: 1,
    trackId: `t-${faceId}`,
    timestamp: 0,
    assigned: false,
    identityId: undefined,
    identityName: undefined,
    cropUrl: undefined,
    base64: undefined,
    bestMatchScore: undefined,
    nativeFaceShortSidePx: undefined,
    suggestedIdentityId,
    suggestedMatchScore: suggestedIdentityId === undefined ? undefined : 0.42,
  }
}

interface BarHandlers {
  readonly onApplySuggestions: () => void
  readonly onAssign: () => void
  readonly onDelete?: () => void
}

function mountBar(faces: readonly TrackFace[], handlers: BarHandlers) {
  const rows = buildFaceReviewRows(faces, IDENTITIES, new Map())
  return mountScreen(
    React.createElement(FaceReviewSelectionBar, {
      selectedCount: rows.length,
      suggestions: suggestionApplyReadiness(rows),
      deletion: faceDeletionReadiness(rows),
      onCancel: () => undefined,
      onAssign: handlers.onAssign,
      onApplySuggestions: handlers.onApplySuggestions,
      onDelete: handlers.onDelete ?? ((): void => undefined),
    }),
  )
}

/** The apply button, found by the exact copy the shipped locale renders. */
function applyButton(container: HTMLElement, count: number): HTMLElement {
  const label = i18n.t('v2.faceReview.applySuggestions', { count })
  const node = [...container.querySelectorAll('*')].find(
    (el) => el.textContent === label && el.children.length === 0,
  )
  expect(node, `no control labelled "${label}"`).toBeDefined()
  const button = (node as HTMLElement).closest('[role="button"]')
  expect(button, 'the label is not inside a button').not.toBeNull()
  return button as HTMLElement
}

describe('Apply suggestions — a homogeneous selection', () => {
  it('offers the action, counting what it would write', () => {
    const onApplySuggestions = vi.fn()
    const { container } = mountBar([face('f1', 'alice'), face('f2', 'bob'), face('f3', 'alice')], {
      onApplySuggestions,
      onAssign: vi.fn(),
    })
    const button = applyButton(container, 3)
    expect(button.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(button)
    expect(onApplySuggestions).toHaveBeenCalledTimes(1)
  })

  // Certainty is not a filter: 0.42 is `uncertain`, and it is applied anyway.
  it('says nothing about missing suggestions when none are missing', () => {
    const { container } = mountBar([face('f1', 'alice')], {
      onApplySuggestions: vi.fn(),
      onAssign: vi.fn(),
    })
    expect(container.textContent).not.toContain(i18n.t('v2.faceReview.applySuggestionsBlocked', { count: 1 }))
  })
})

describe('Apply suggestions — a MIXED selection', () => {
  // ⚠ LOAD-BEARING: this is the operator decision. Half-firing would drop the
  // suggestion-less faces without a word.
  it('refuses to fire', () => {
    const onApplySuggestions = vi.fn()
    const { container } = mountBar([face('f1', 'alice'), face('f2'), face('f3')], {
      onApplySuggestions,
      onAssign: vi.fn(),
    })
    const button = applyButton(container, 1)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onApplySuggestions).not.toHaveBeenCalled()
  })

  // ⚠ LOAD-BEARING: a disabled control that will not say why is a dead end.
  it('states how many of the selected faces have no suggestion', () => {
    const { container } = mountBar([face('f1', 'alice'), face('f2'), face('f3')], {
      onApplySuggestions: vi.fn(),
      onAssign: vi.fn(),
    })
    expect(container.textContent).toContain(i18n.t('v2.faceReview.applySuggestionsBlocked', { count: 2 }))
  })

  it('leaves Assign — one person for all — available regardless', () => {
    const onAssign = vi.fn()
    const { container } = mountBar([face('f1', 'alice'), face('f2')], {
      onApplySuggestions: vi.fn(),
      onAssign,
    })
    const label = i18n.t('v2.faceReview.assign')
    const node = [...container.querySelectorAll('[role="button"]')].find((el) => el.textContent === label)
    expect(node).toBeDefined()
    fireEvent.click(node as HTMLElement)
    expect(onAssign).toHaveBeenCalledTimes(1)
  })
})
