import { describe, expect, it } from 'vitest'

import { backOrCameras } from '../back-or-cameras.js'

function router(canGoBack: boolean) {
  const calls: string[] = []
  return {
    calls,
    canGoBack: () => canGoBack,
    back: () => void calls.push('back'),
    replace: (href: string) => void calls.push(`replace ${href}`),
  }
}

describe('back or Cameras (#745)', () => {
  it('pops one screen when there is history', () => {
    const r = router(true)
    backOrCameras(r)
    expect(r.calls).toEqual(['back'])
  })

  it('lands on the Cameras tab when there is no history', () => {
    const r = router(false)
    backOrCameras(r)
    expect(r.calls).toEqual(['replace /cameras'])
  })
})
