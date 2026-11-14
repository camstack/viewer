/**
 * @vitest-environment jsdom
 *
 * "Reanalyse samples" froze the UI (issue 557).
 *
 * The audit answers EVERY enrolled sample of one person — 672 rows for the
 * largest person on the operator's hub — and the panel drew them all at once,
 * each row with its own crop request. The list must mount only the rows near
 * the viewport, however long the answer is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { AUDIT_INITIAL_ROWS, IdentityAuditModal } from '../IdentityAuditModal.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const TOTAL = 672

function rows(): readonly Record<string, unknown>[] {
  return Array.from({ length: TOTAL }, (_, i) => ({
    sampleId: `s-${String(i)}`,
    enrolledAt: 1_700_000_000_000 + i,
    source: 'detected',
    comparable: true,
    selfMean: 0.8,
    suspicion: 0,
    mediaId: `m-${String(i)}`,
  }))
}

function removeButtons(): Element[] {
  const label = i18n.t('v2.faceReview.auditRemoveTitle')
  return [...document.body.querySelectorAll('[role="button"]')].filter(
    (el) => el.getAttribute('aria-label') === label,
  )
}

describe('the identity audit panel', () => {
  it(`mounts a window of rows, not all ${String(TOTAL)}`, async () => {
    mountScreen(
      React.createElement(IdentityAuditModal, {
        identityId: 'alice',
        serverUrl: 'http://hub.test:8080',
        onClose: () => undefined,
      }),
      {
        hub: {
          'faceGallery.auditIdentitySamples': () => ({
            identityId: 'alice',
            name: 'Alice',
            modelId: 'm1',
            totalSamples: TOTAL,
            comparableSamples: TOTAL,
            flagged: 0,
            flagThreshold: 0.5,
            rows: rows(),
          }),
        },
      },
    )
    await waitFor(() => {
      expect(removeButtons().length).toBeGreaterThan(0)
    })
    expect(removeButtons().length).toBeLessThanOrEqual(AUDIT_INITIAL_ROWS * 2)
    expect(document.body.querySelectorAll('img').length).toBeLessThanOrEqual(AUDIT_INITIAL_ROWS * 2)
  })
})
