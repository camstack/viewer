/**
 * @vitest-environment jsdom
 *
 * The joystick mounts: ring, thumb and the accessible label. Everything
 * gestural is inert under the stubs (`native-stubs/gesture-handler.tsx`), so
 * this proves only that the component renders without throwing and exposes
 * itself to assistive tech — the feel needs the phone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'

import '../../../../app/i18n.js'
import { DriveJoystick, DRIVE_JOYSTICK_TEST_ID } from '../DriveJoystick.js'

afterEach(cleanup)

describe('DriveJoystick', () => {
  it('renders the ring with an adjustable, labelled control', () => {
    const { container } = render(
      React.createElement(DriveJoystick, {
        onVector: vi.fn(),
        onRelease: vi.fn(),
      }),
    )
    const ring = container.querySelector(`[data-testid="${DRIVE_JOYSTICK_TEST_ID}"]`)
    expect(ring).not.toBeNull()
    expect(container.querySelector('[aria-label="Drive joystick"]')).not.toBeNull()
  })
})
