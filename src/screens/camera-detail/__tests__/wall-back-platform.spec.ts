/**
 * The platform sources of "back" while a wall is up (#700): Android's hardware
 * back (consumed) and the web's Escape (ignored while typing or in a dialog).
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const rn = vi.hoisted(() => ({
  os: 'android',
  handler: null as null | (() => boolean),
  remove: null as null | ReturnType<typeof vi.fn>,
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return rn.os
    },
  },
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      rn.handler = handler
      rn.remove = vi.fn()
      return { remove: rn.remove }
    },
  },
}))

import { isWallEscape, useCollapseWallOnBack } from '../wall-back.js'

afterEach(() => {
  cleanup()
  rn.handler = null
  rn.remove = null
  document.body.innerHTML = ''
})

describe('useCollapseWallOnBack — Android hardware back', () => {
  it('with a wall up, hardware back collapses it and is consumed', () => {
    rn.os = 'android'
    const collapse = vi.fn()
    renderHook(() => useCollapseWallOnBack(true, collapse))
    expect(rn.handler).not.toBeNull()
    expect(rn.handler?.()).toBe(true)
    expect(collapse).toHaveBeenCalledTimes(1)
  })

  it('with no wall, nothing is registered (the system back runs untouched)', () => {
    rn.os = 'android'
    renderHook(() => useCollapseWallOnBack(false, vi.fn()))
    expect(rn.handler).toBeNull()
  })

  it('the handler is removed when the wall goes away', () => {
    rn.os = 'android'
    const { rerender } = renderHook(({ up }) => useCollapseWallOnBack(up, vi.fn()), { initialProps: { up: true } })
    const remove = rn.remove
    rerender({ up: false })
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('useCollapseWallOnBack — web Escape', () => {
  it('Escape on the page collapses', () => {
    rn.os = 'web'
    const collapse = vi.fn()
    renderHook(() => useCollapseWallOnBack(true, collapse))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(collapse).toHaveBeenCalledTimes(1)
  })

  it('Escape inside an input does not collapse', () => {
    rn.os = 'web'
    const collapse = vi.fn()
    renderHook(() => useCollapseWallOnBack(true, collapse))
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(collapse).not.toHaveBeenCalled()
  })

  it('Escape while a dialog is open does not collapse', () => {
    rn.os = 'web'
    const collapse = vi.fn()
    renderHook(() => useCollapseWallOnBack(true, collapse))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(collapse).not.toHaveBeenCalled()
  })
})

describe('isWallEscape', () => {
  it('ignores other keys, a textarea and a contenteditable', () => {
    const ta = document.createElement('textarea')
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    expect(isWallEscape({ key: 'Enter', target: null, defaultPrevented: false })).toBe(false)
    expect(isWallEscape({ key: 'Escape', target: ta, defaultPrevented: false })).toBe(false)
    expect(isWallEscape({ key: 'Escape', target: ce, defaultPrevented: false })).toBe(false)
    expect(isWallEscape({ key: 'Escape', target: null, defaultPrevented: false })).toBe(true)
  })
})
