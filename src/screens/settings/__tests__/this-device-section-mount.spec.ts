/**
 * @vitest-environment jsdom
 *
 * Settings → Account → This device: the certificate's status and expiry, the
 * "Keep this device signed in" row where it can work, and nothing at all where
 * it cannot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { LEAF_P256_PEM } from '../../../device-cert/__tests__/fixtures/leaf-p256.js'
import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { EnrollmentContext, type DeviceEnrollmentApi } from '../../../device-cert/DeviceEnrollmentProvider.js'
import { ThisDeviceSection } from '../ThisDeviceSection.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const RECORD = {
  credentialId: 'cred-1',
  certPem: 'PEM',
  notAfter: Date.UTC(2027, 9, 16),
  issuedAt: Date.UTC(2026, 9, 16),
  username: 'wife',
  definitiveRefusals: 0,
  autoLogin: true,
}

function mountWith(api: Partial<DeviceEnrollmentApi>) {
  const full: DeviceEnrollmentApi = {
    record: null,
    available: true,
    startEnrollment: async () => undefined,
    disconnect: async () => undefined,
    ...api,
  }
  mountScreen(
    React.createElement(EnrollmentContext.Provider, { value: full }, React.createElement(ThisDeviceSection)),
    { hub: {} },
  )
}

describe('This device section', () => {
  it('offers to keep the device signed in where the hub allows it', () => {
    const startEnrollment = vi.fn(async () => undefined)
    mountWith({ startEnrollment })
    act(() => {
      fireEvent.click(screen.getByText('Keep this device signed in'))
    })
    expect(startEnrollment).toHaveBeenCalledTimes(1)
  })

  it('shows nothing while unread, and nothing on a hub that cannot do it', () => {
    mountWith({ record: undefined })
    expect(screen.queryByText('This device')).toBeNull()
    cleanup()
    mountWith({ record: null, available: false })
    expect(screen.queryByText('This device')).toBeNull()
  })

  it('shows the certificate with its expiry and a Disconnect that calls the provider', () => {
    const disconnect = vi.fn(async () => undefined)
    mountWith({ record: RECORD, disconnect })
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Expires')).toBeTruthy()
    expect(screen.getByText('Last renewed')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByText('Disconnect this device'))
    })
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps showing the certificate even if the hub stopped offering the arm', () => {
    mountWith({ record: RECORD, available: false })
    expect(screen.getByText('Disconnect this device')).toBeTruthy()
  })

  it('opens the certificate details sheet, read locally from the stored PEM', () => {
    const certPem = LEAF_P256_PEM
    mountWith({ record: { ...RECORD, certPem, hubOrigin: 'https://hub.example.com', keyHardwareBacked: true, enrolledAt: Date.UTC(2026, 9, 1) } })
    act(() => {
      fireEvent.click(screen.getByText('Certificate details'))
    })
    expect(screen.getByText('79C218AF58DCCD2C5EC1F9914D0E43DA2EB2ACA0')).toBeTruthy()
    expect(screen.getByText(/camstack:credential:cred-123\s+camstack:user:wife/)).toBeTruthy()
    expect(screen.getByText('EC P-256')).toBeTruthy()
    expect(screen.getByText('Secure Enclave')).toBeTruthy()
    expect(screen.queryByTestId('cert-unreadable')).toBeNull()
  })

  it('says the certificate is unreadable, without crashing, when the PEM is malformed', () => {
    mountWith({ record: RECORD })
    act(() => {
      fireEvent.click(screen.getByText('Certificate details'))
    })
    expect(screen.getByTestId('cert-unreadable')).toBeTruthy()
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0)
  })
})
