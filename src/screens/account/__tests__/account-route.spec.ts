/**
 * @vitest-environment jsdom
 *
 * The old `/settings/sign-in` deep link lands on the shell's `/account` (D1102),
 * and `/account` is a route the shell serves (inner bar, cold-link allow-list).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'

import { redirectTargets, resetRouterStub } from '../../../testing/native-stubs/expo-router.js'
import SignInRoute from '../../../../app/(app)/settings/sign-in.js'
import { barKindForPath } from '../../../navigation/bar-kind.js'
import { isStashableDeepLink } from '../../../navigation/pending-deep-link.js'

afterEach(() => {
  cleanup()
  resetRouterStub()
})

describe('/settings/sign-in', () => {
  it('redirects to /account', () => {
    resetRouterStub()
    render(React.createElement(SignInRoute))
    expect(redirectTargets()).toEqual(['/account'])
  })
})

describe('/account', () => {
  it('wears the inner bar and survives a cold link through login', () => {
    expect(barKindForPath('/account')).toBe('inner')
    expect(isStashableDeepLink('/account')).toBe(true)
  })
})
