import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { remoteRoute } from '../remote-route'

describe('remoteRoute', () => {
  it('names the device and carries an encoded title', () => {
    expect(remoteRoute(12, undefined)).toBe('/remote/12')
    expect(remoteRoute(12, '')).toBe('/remote/12')
    expect(remoteRoute(12, 'Living room TV')).toBe('/remote/12?name=Living%20room%20TV')
  })

  it('the remote sheet opens this route', () => {
    const src = readFileSync(new URL('../../components/camera/remote/RemoteSheet.tsx', import.meta.url), 'utf8')
    expect(src).toContain('remoteRoute(deviceId, deviceName)')
    expect(src).toContain('RemoteKeyPad')
  })
})
