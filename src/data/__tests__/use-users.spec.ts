/**
 * `userManagement.listUsers` → the picker's options. The wire is untrusted: a
 * row without an id cannot be addressed, so it is dropped rather than rendered.
 */
import { describe, expect, it } from 'vitest'
import { parseUserOptions } from '../use-users.js'

describe('parseUserOptions', () => {
  it('keeps id + username, and ignores the rest of the summary', () => {
    expect(
      parseUserOptions([
        { id: 'u1', username: 'anna', isAdmin: true, allowedProviders: '*', createdAt: 1, updatedAt: 2 },
        { id: 'u2', username: 'bruno' },
      ]),
    ).toEqual([
      { id: 'u1', username: 'anna' },
      { id: 'u2', username: 'bruno' },
    ])
  })

  it('drops a row it cannot address', () => {
    expect(parseUserOptions([{ username: 'ghost' }, { id: 'u3', username: 'carla' }])).toEqual([
      { id: 'u3', username: 'carla' },
    ])
  })

  it('refuses a payload that is not a list — unknown is never "no users"', () => {
    expect(() => parseUserOptions(null)).toThrow()
    expect(() => parseUserOptions({ users: [] })).toThrow()
  })

  it('an empty list is a real, answered "no users"', () => {
    expect(parseUserOptions([])).toEqual([])
  })
})
