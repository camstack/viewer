/**
 * @vitest-environment jsdom
 *
 * Removing an ENROLLED sample, mounted over a hub that really deletes.
 *
 * The operator's report (2026-09-13): *"la cancellazione di un sample
 * associato non pare fare niente di niente, rimane lì anche dopo un
 * refresh"*.
 *
 * The write never reached the wire. `useRemoveIdentitySample` resolved the
 * procedure with `isRecord(router) ? router['removeSample'] : undefined` — and
 * `data/cap-query.ts` says, in its own module doc, why that can never work:
 * *"The viewer's tRPC client is a v11 proxy. Its nodes are callable PROXIES —
 * `typeof` is 'function', NOT 'object' — so an `isRecord` guard would wrongly
 * report a router or method as missing."* Every other mutation in this folder
 * reads the leaf `.mutate` off the node without asking what `typeof` it is.
 *
 * So the hook threw `faceGallery.removeSample unavailable` before any call was
 * made, the rejection landed on a floating `void onRemove()` in `AuditRow`, and
 * nothing — no call, no error, no change — reached the operator.
 *
 * This spec holds the claim the way the operator states it: press Remove, and
 * the hub must be asked, and the sample must be gone from the panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import i18n from '../../../app/i18n.js'
import { IdentityAuditModal } from '../IdentityAuditModal.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const ALICE = 'alice-id'

interface AuditRowShape {
  readonly sampleId: string
  readonly enrolledAt: number
  readonly source: 'detected'
  readonly comparable: boolean
  readonly selfMean: number
  readonly suspicion: number
}

const SAMPLES: readonly AuditRowShape[] = [
  { sampleId: 's-good', enrolledAt: 1_700_000_000_000, source: 'detected', comparable: true, selfMean: 0.81, suspicion: 0 },
  { sampleId: 's-bad', enrolledAt: 1_700_000_100_000, source: 'detected', comparable: true, selfMean: 0.31, suspicion: 0.9 },
]

/** What the hub still holds. The audit READS it, the removal WRITES it. */
let onHub: readonly AuditRowShape[] = SAMPLES

beforeEach(() => {
  onHub = SAMPLES
  // The browser branch of `useConfirm`: `Alert.alert` is an empty function on
  // react-native-web, so the drawn dialog is the only one a test can answer.
  setTestPlatform('web')
})

afterEach(() => {
  setTestPlatform('ios')
})

function hub(): Record<string, unknown> {
  return {
    'faceGallery.auditIdentitySamples': () => ({
      identityId: ALICE,
      name: 'Alice',
      modelId: 'm1',
      totalSamples: onHub.length,
      comparableSamples: onHub.length,
      flagged: onHub.filter((r) => r.suspicion >= 0.5).length,
      flagThreshold: 0.5,
      rows: onHub,
    }),
    'faceGallery.removeSample': (input: unknown) => {
      const sampleId = (input as { readonly sampleId: string }).sampleId
      onHub = onHub.filter((r) => r.sampleId !== sampleId)
      return undefined
    },
  }
}

function removeButtons(): HTMLElement[] {
  const label = i18n.t('v2.faceReview.auditRemoveTitle')
  return [...document.body.querySelectorAll('[role="button"]')].filter(
    (el) => el.getAttribute('aria-label') === label,
  ) as HTMLElement[]
}

function dialogButton(label: string): HTMLElement {
  const dialog = document.body.querySelector('[role="alert"]')
  if (dialog === null) throw new Error('no confirmation dialog on screen')
  const button = [...dialog.querySelectorAll('[role="button"]')].find(
    (el) => el.textContent === label,
  )
  if (button === undefined) throw new Error(`the confirmation has no "${label}" button`)
  return button as HTMLElement
}

async function mountPanel(): Promise<void> {
  mountScreen(
    React.createElement(IdentityAuditModal, {
      identityId: ALICE,
      serverUrl: 'http://hub.test:8080',
      onClose: () => undefined,
    }),
    { hub: hub() },
  )
  await waitFor(() => {
    expect(removeButtons().length).toBe(2)
  })
}

describe('removing an enrolled sample', () => {
  it('asks the hub — the call the operator never saw happen', async () => {
    await mountPanel()
    await act(async () => {
      fireEvent.click(removeButtons()[1] as HTMLElement)
    })
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.common.confirm')))
    })
    await waitFor(() => {
      expect(hubCalls().filter((c) => c.path === 'faceGallery.removeSample')).toHaveLength(1)
    })
    expect(hubCalls().find((c) => c.path === 'faceGallery.removeSample')?.input).toEqual({
      identityId: ALICE,
      sampleId: 's-bad',
    })
  })

  it('takes the row off the panel, and it does not come back on a re-read', async () => {
    await mountPanel()
    await act(async () => {
      fireEvent.click(removeButtons()[1] as HTMLElement)
    })
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.common.confirm')))
    })
    await waitFor(() => {
      expect(removeButtons()).toHaveLength(1)
    })
    expect(onHub.map((r) => r.sampleId)).toEqual(['s-good'])
  })

  it('says so when the hub refuses, instead of failing silently', async () => {
    mountScreen(
      React.createElement(IdentityAuditModal, {
        identityId: ALICE,
        serverUrl: 'http://hub.test:8080',
        onClose: () => undefined,
      }),
      {
        hub: {
          ...hub(),
          'faceGallery.removeSample': () => {
            throw new Error('FORBIDDEN: admin only')
          },
        },
      },
    )
    await waitFor(() => {
      expect(removeButtons().length).toBe(2)
    })
    await act(async () => {
      fireEvent.click(removeButtons()[1] as HTMLElement)
    })
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.common.confirm')))
    })
    await waitFor(() => {
      expect(screen.getByText(/admin only/)).toBeTruthy()
    })
  })
})
