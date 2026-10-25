import { describe, expect, it } from 'vitest'
import { createRuleHref, newRuleHref, ruleHref, ruleSectionHref, summaryRuleHref, timelapseRuleHref } from '../rule-routes.js'

describe('rule routes', () => {
  it('builds typed hrefs', () => {
    expect(ruleHref('r 1')).toEqual({ pathname: '/rule/[id]', params: { id: 'r 1' } })
    expect(ruleHref('new', 'sound')).toEqual({ pathname: '/rule/[id]', params: { id: 'new', kind: 'sound' } })
    expect(ruleSectionHref('r1', 'advanced')).toEqual({
      pathname: '/rule/[id]/[section]',
      params: { id: 'r1', section: 'advanced' },
    })
    expect(ruleSectionHref('new', 'advanced', 'sound')).toEqual({
      pathname: '/rule/[id]/[section]',
      params: { id: 'new', section: 'advanced', kind: 'sound' },
    })
    expect(newRuleHref()).toBe('/rule/new')
    expect(timelapseRuleHref('new')).toEqual({ pathname: '/timelapse-rule/[id]', params: { id: 'new' } })
    expect(summaryRuleHref('s1')).toEqual({ pathname: '/summary-rule/[id]', params: { id: 's1' } })
  })
})

describe('the "New rule" button', () => {
  it('opens the kind picker from All, and a seeded rule from a creatable kind', () => {
    expect(createRuleHref('all', ['detection', 'sound'])).toBe('/rule/new')
    expect(createRuleHref('sound', ['detection', 'sound'])).toEqual({
      pathname: '/rule/[id]',
      params: { id: 'new', kind: 'sound' },
    })
  })

  it('never seeds a kind the caller may not create — the picker decides instead', () => {
    expect(createRuleHref('system', ['detection', 'sound'])).toBe('/rule/new')
  })
})
