/**
 * @vitest-environment jsdom
 *
 * The person picker that replaced the review tab's chip rows, MOUNTED.
 *
 * The matching rule is asserted by value in `data/__tests__/identity-picker.spec.ts`.
 * What only a renderer can see is whether the field is actually WIRED to that
 * rule, whether a search that matches nothing says so instead of showing an
 * empty list that reads as an empty gallery, and whether the create row is
 * really absent for the caller that must not be able to mint an identity — the
 * Analyze modal, where a typo used to fork a gallery in two.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { IdentityPickerSheet } from '../IdentityPickerSheet.js'
import type { PersonIdentity } from '../../../data/use-face-gallery.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

function person(id: string, name: string): PersonIdentity {
  return { id, name, sampleCount: 3, coverMediaId: undefined, coverBase64: undefined }
}

const PEOPLE: readonly PersonIdentity[] = [
  person('alice', 'Alice'),
  person('bob', 'Bob'),
  person('nic', 'Niccolò'),
]

interface Handlers {
  readonly onPick?: (identity: PersonIdentity) => void
  readonly onCreate?: (name: string) => void
}

function mountSheet(handlers: Handlers = {}) {
  return mountScreen(
    React.createElement(IdentityPickerSheet, {
      open: true,
      title: 'Assign this group to',
      identities: PEOPLE,
      serverUrl: null,
      mediaHeaders: undefined,
      onPick: handlers.onPick ?? ((): void => undefined),
      ...(handlers.onCreate === undefined ? {} : { onCreate: handlers.onCreate }),
      onClose: (): void => undefined,
    }),
  )
}

/** The sheet is a `Modal` — react-native-web portals it into `document.body`. */
function body(): string {
  return document.body.textContent ?? ''
}

function searchField(): HTMLElement {
  const field = document.body.querySelector('input')
  if (field === null) throw new Error('the picker has no search field')
  return field
}

function personRow(name: string): HTMLElement {
  const node = [...document.body.querySelectorAll('[role="button"]')].find((el) =>
    (el.textContent ?? '').includes(name),
  )
  if (node === undefined) throw new Error(`no row for "${name}"`)
  return node as HTMLElement
}

describe('the picker', () => {
  it('lists everybody before anything is typed', () => {
    mountSheet()
    for (const p of PEOPLE) expect(body()).toContain(p.name)
  })

  it('narrows to the typed name', () => {
    mountSheet()
    fireEvent.change(searchField(), { target: { value: 'bo' } })
    expect(body()).toContain('Bob')
    expect(body()).not.toContain('Alice')
  })

  // The accent rule, end to end: the operator types what is on the keyboard.
  it('finds an accented name typed without the accent', () => {
    mountSheet()
    fireEvent.change(searchField(), { target: { value: 'niccolo' } })
    expect(body()).toContain('Niccolò')
  })

  // ⚠ A search that matched nothing over an empty FlatList is indistinguishable
  // from a gallery with nobody in it — and one of those is a reason to create a
  // person, the other is a typo.
  it('says the search matched nobody, rather than showing an empty gallery', () => {
    mountSheet()
    fireEvent.change(searchField(), { target: { value: 'zzz' } })
    expect(body()).toContain(i18n.t('v2.faceReview.pickPersonNoMatch', { query: 'zzz' }))
    expect(body()).not.toContain(i18n.t('v2.tracks.noPersons'))
  })

  it('reports the person that was tapped', () => {
    const onPick = vi.fn()
    mountSheet({ onPick })
    fireEvent.click(personRow('Bob'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ id: 'bob' })
  })
})

describe('creating a person from the picker', () => {
  // ⚠ LOAD-BEARING: the Analyze modal passes no `onCreate`, because a typo
  // there used to mint a second "Danlel" and split a gallery in half.
  it('offers nothing to create when the caller did not ask for it', () => {
    mountSheet()
    fireEvent.change(searchField(), { target: { value: 'Carla' } })
    expect(body()).not.toContain(i18n.t('v2.faceReview.pickPersonCreate', { name: 'Carla' }))
  })

  it('offers the typed name, and only once something is typed', () => {
    const onCreate = vi.fn()
    mountSheet({ onCreate })
    expect(body()).not.toContain(i18n.t('v2.faceReview.pickPersonCreate', { name: '' }))
    fireEvent.change(searchField(), { target: { value: 'Carla' } })
    const label = i18n.t('v2.faceReview.pickPersonCreate', { name: 'Carla' })
    expect(body()).toContain(label)
    fireEvent.click(personRow(label))
    expect(onCreate).toHaveBeenCalledWith('Carla')
  })
})
