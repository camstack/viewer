/**
 * @vitest-environment jsdom
 *
 * `GlassSurface` in the tree: it draws its children on every fallback and never
 * throws on a binary without the glass module (the OTA case).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { Text } from 'react-native'

import { setTestPlatform } from '../../../testing/platform-control.js'
import { ThemeProvider } from '../../../theme/theme-provider.js'
import { GlassSurface } from '../GlassSurface.js'

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

function mount() {
  return render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(
        GlassSurface,
        { testID: 'glass' },
        React.createElement(Text, null, 'inside'),
      ),
    ),
  )
}

describe('GlassSurface fallbacks', () => {
  for (const os of ['ios', 'android', 'web'] as const) {
    it(`draws its children on ${os} with the glass module absent`, () => {
      setTestPlatform(os)
      expect(() => mount()).not.toThrow()
      expect(screen.getByText('inside')).toBeTruthy()
      expect(screen.getByTestId('glass')).toBeTruthy()
    })
  }
})
