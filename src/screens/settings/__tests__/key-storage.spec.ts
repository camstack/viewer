import { describe, expect, it } from 'vitest'
import { keyStorageOf } from '../CertificateDetailsSheet.js'

describe('keyStorageOf', () => {
  it('names the store from the recorded flag and the platform', () => {
    expect(keyStorageOf('ios', true)).toBe('secureEnclave')
    expect(keyStorageOf('android', true)).toBe('hardware')
    expect(keyStorageOf('web', false)).toBe('software')
    expect(keyStorageOf('ios', undefined)).toBe('unknown')
  })
})
