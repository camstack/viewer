import { describe, expect, it } from 'vitest'

import { hubImageSource } from '../hub-image-source.js'

const URL_ = 'https://hub/addon/provider-reolink/clip-thumb/3628/c325d136'

describe('hubImageSource', () => {
  it('attaches the session credential to a hub URL', () => {
    // Without it the hub answers 401 and expo-image reports a bare onError —
    // a black tile with nothing to read (2026-09-21).
    expect(hubImageSource(URL_, 'tok')).toEqual({
      uri: URL_,
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('never attaches one to a data: URI — nothing is being asked of a server', () => {
    expect(hubImageSource('data:image/jpeg;base64,AAAA', 'tok')).toEqual({
      uri: 'data:image/jpeg;base64,AAAA',
    })
  })

  it('omits the header rather than sending an empty one when there is no token', () => {
    expect(hubImageSource(URL_, null)).toEqual({ uri: URL_ })
    expect(hubImageSource(URL_, '')).toEqual({ uri: URL_ })
  })
})
