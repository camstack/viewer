/**
 * @vitest-environment jsdom
 *
 * The gate the app did not have: **a confirmation that actually gates.**
 *
 * `Alert.alert` is `static alert() {}` in react-native-web 0.21 — an empty
 * function body. So on the browser and the PWA every action behind a
 * confirmation was mute: no dialog opened, no button existed, and the `onPress`
 * that performs the write was never called. Roughly nineteen confirmations
 * across Settings, Exports, notification Rules/Targets and face Review were
 * dead that way, and nothing failed — the operator discovered it because
 * assigning faces to a group from a browser did nothing at all.
 *
 * Nothing tested it because the only spec that drove a confirmation
 * (`face-review-analyze-modal.spec.ts`) stubbed `Alert.alert` and pressed
 * button index 1 itself — the fake supplied exactly the behaviour production
 * did not have.
 *
 * So the claims held down here are the two halves of "it gates":
 *   - a REFUSED confirmation does not run the action;
 *   - an ACCEPTED confirmation runs it — once;
 * asserted by mounting and clicking, under jsdom, on the web platform branch,
 * which is the branch that was broken.
 *
 * The native branch keeps the system alert (there was never anything wrong with
 * it there), and is asserted separately over a spied `Alert.alert`: both button
 * descriptors must exist, and each must settle the promise the caller awaits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Alert, Pressable, Text, type AlertButton } from 'react-native'

import { setTestPlatform } from '../../../testing/platform-control.js'
import { ThemeProvider } from '../../../theme/theme-provider.js'
import { ConfirmProvider, useConfirm, useNotice } from '../confirm.js'
import '../../../app/i18n.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setTestPlatform('ios')
})

const TITLE = 'Delete the thing?'
const BODY = 'This cannot be undone.'
const CONFIRM_LABEL = 'Delete'
const CANCEL_LABEL = 'Keep'

interface SubjectProps {
  readonly onRun: () => void
}

/**
 * A call site in the exact shape the migrated ones have:
 * `if (!(await confirm(...))) return` — the write is BELOW the gate, so a
 * refused confirmation is indistinguishable from the action never happening.
 */
function Subject({ onRun }: SubjectProps): React.ReactElement {
  const confirm = useConfirm()
  const press = (): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: TITLE,
        message: BODY,
        confirmLabel: CONFIRM_LABEL,
        cancelLabel: CANCEL_LABEL,
        destructive: true,
      })
      if (!ok) return
      onRun()
    })()
  }
  return React.createElement(
    Pressable,
    { accessibilityRole: 'button', accessibilityLabel: 'open', onPress: press },
    React.createElement(Text, null, 'open'),
  )
}

function mountSubject(onRun: () => void): void {
  render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ConfirmProvider, null, React.createElement(Subject, { onRun })),
    ),
  )
}

function press(label: string): void {
  const node = screen.getByText(label)
  act(() => {
    fireEvent.click(node)
  })
}

describe('the confirmation surface on the web platform', () => {
  it('shows a real dialog — the words, not a no-op', async () => {
    setTestPlatform('web')
    mountSubject(() => undefined)

    press('open')

    await waitFor(() => {
      expect(screen.getByText(TITLE)).toBeTruthy()
    })
    expect(screen.getByText(BODY)).toBeTruthy()
    expect(screen.getByText(CONFIRM_LABEL)).toBeTruthy()
    expect(screen.getByText(CANCEL_LABEL)).toBeTruthy()
  })

  it('does NOT run the action when the confirmation is refused', async () => {
    setTestPlatform('web')
    const run = vi.fn()
    mountSubject(run)

    press('open')
    await waitFor(() => {
      expect(screen.getByText(CANCEL_LABEL)).toBeTruthy()
    })
    press(CANCEL_LABEL)

    // The promise resolves on a microtask; give the awaiting call site a turn
    // before claiming it did nothing.
    await act(async () => {
      await Promise.resolve()
    })
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('runs the action exactly once when the confirmation is accepted', async () => {
    setTestPlatform('web')
    const run = vi.fn()
    mountSubject(run)

    press('open')
    await waitFor(() => {
      expect(screen.getByText(CONFIRM_LABEL)).toBeTruthy()
    })
    press(CONFIRM_LABEL)

    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('falls back to the shared Confirm/Cancel wording when a call site names none', async () => {
    setTestPlatform('web')
    function Bare(): React.ReactElement {
      const confirm = useConfirm()
      return React.createElement(
        Pressable,
        { accessibilityRole: 'button', onPress: () => void confirm({ title: TITLE }) },
        React.createElement(Text, null, 'open'),
      )
    }
    render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ConfirmProvider, null, React.createElement(Bare, null)),
      ),
    )

    press('open')

    await waitFor(() => {
      expect(screen.getByText('Confirm')).toBeTruthy()
    })
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('shows a one-button notice, and dismissing it closes it', async () => {
    setTestPlatform('web')
    function Notifier(): React.ReactElement {
      const notice = useNotice()
      return React.createElement(
        Pressable,
        { accessibilityRole: 'button', onPress: () => notice({ title: TITLE, message: BODY }) },
        React.createElement(Text, null, 'open'),
      )
    }
    render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ConfirmProvider, null, React.createElement(Notifier, null)),
      ),
    )

    press('open')
    await waitFor(() => {
      expect(screen.getByText(TITLE)).toBeTruthy()
    })
    // A notice has ONE button: there is nothing to refuse.
    expect(screen.queryByText('Cancel')).toBeNull()

    press('OK')
    await waitFor(() => {
      expect(screen.queryByText(TITLE)).toBeNull()
    })
  })
})

describe('the confirmation surface on a phone', () => {
  it('still goes through the system alert, with both buttons', async () => {
    setTestPlatform('ios')
    const seen: AlertButton[][] = []
    vi.spyOn(Alert, 'alert').mockImplementation(
      (_title: string, _message?: string, buttons?: readonly AlertButton[]) => {
        seen.push([...(buttons ?? [])])
      },
    )
    const run = vi.fn()
    mountSubject(run)

    press('open')

    expect(Alert.alert).toHaveBeenCalledTimes(1)
    const buttons = seen[0] ?? []
    expect(buttons.map((b) => b.text)).toEqual([CANCEL_LABEL, CONFIRM_LABEL])
    expect(buttons[0]?.style).toBe('cancel')
    expect(buttons[1]?.style).toBe('destructive')
    // No web dialog was rendered — the system alert owns the phone.
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('resolves TRUE from the confirm button and FALSE from the cancel button', async () => {
    setTestPlatform('ios')
    let captured: readonly AlertButton[] = []
    vi.spyOn(Alert, 'alert').mockImplementation(
      (_title: string, _message?: string, buttons?: readonly AlertButton[]) => {
        captured = buttons ?? []
      },
    )
    const run = vi.fn()
    mountSubject(run)

    press('open')
    act(() => {
      captured[0]?.onPress?.()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(run).not.toHaveBeenCalled()

    press('open')
    act(() => {
      captured[1]?.onPress?.()
    })
    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1)
    })
  })
})

describe('the provider contract', () => {
  it('refuses to answer without a provider rather than silently doing nothing', () => {
    function Orphan(): React.ReactElement {
      useConfirm()
      return React.createElement(Text, null, 'x')
    }
    // A silent fallback here would recreate the exact bug this replaces: a
    // confirmation that resolves nothing and a write that never runs.
    expect(() =>
      render(React.createElement(ThemeProvider, null, React.createElement(Orphan, null))),
    ).toThrow(/ConfirmProvider/)
  })
})
