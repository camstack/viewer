import { describe, expect, it } from 'vitest'

import { barKindForPath, homeBarHeight, homeBarVariant } from '../bar-kind.js'

describe('the bar a route wears (#691)', () => {
  it.each(['/cameras', '/events', '/grids', '/notifications', '/settings', '/'])('%s is a list page: the home bar', (path) => {
    expect(barKindForPath(path)).toBe('home')
  })

  it.each([
    '/settings/cameras',
    '/settings/sign-in', // redirect alias of /account (D1102)
    '/account',
    '/settings/notifications',
    '/settings/alarm',
    '/notifications/rule/12/history',
    '/rule/new',
    '/rule/12',
    '/rule/12/conditions',
    '/timelapse-rule/new',
    '/summary-rule/3',
    '/device/102',
    '/retrain/55',
    '/remote/9',
    '/artifacts',
    '/exports',
    '/grid/4/edit',
  ])('%s is a detail page: the inner bar', (path) => {
    expect(barKindForPath(path)).toBe('inner')
  })

  it.each(['/camera/102', '/camera/102?t=1', '/grid/4', '/grid/adhoc', '/grid/adhoc?devices=1,2'])(
    '%s is a picture: no bar, full height',
    (path) => {
      expect(barKindForPath(path)).toBe('none')
    },
  )

  it('a route nobody listed gets no bar, never one by accident', () => {
    expect(barKindForPath('/something-new')).toBe('none')
  })

  it('a trailing slash and a query do not change the answer', () => {
    expect(barKindForPath('/cameras/')).toBe('home')
    expect(barKindForPath('/settings/cameras/?x=1')).toBe('inner')
  })
})

describe('the home bar variant', () => {
  it('a phone in portrait: 48 px', () => {
    expect(homeBarVariant({ showSidebar: false, compact: false })).toBe('phone')
    expect(homeBarHeight('phone')).toBe(48)
  })

  it('a tablet or a wide window: 56 px (h-14, like the admin)', () => {
    expect(homeBarVariant({ showSidebar: true, compact: false })).toBe('wide')
    expect(homeBarHeight('wide')).toBe(56)
  })

  it('phone landscape (compact rail) keeps the small bar: height is scarce there', () => {
    expect(homeBarVariant({ showSidebar: true, compact: true })).toBe('phone')
  })
})
