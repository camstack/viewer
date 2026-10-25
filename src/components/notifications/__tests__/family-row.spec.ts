/**
 * The row model behind a TIMELAPSE or DIGEST card.
 *
 * Two claims, and both are about the row telling the truth rather than looking
 * tidy:
 *
 *  1. **Editable is the SERVER's verdict.** Every list here stamps `readOnly`
 *     per row from the resolved caller, and the row obeys it — it never
 *     re-derives ownership from `ownerUserId`, which is a second opinion that
 *     can disagree with the one the upsert will enforce. Offering Edit on a rule
 *     the hub will refuse is worse than not offering it.
 *  2. **A rule that has never produced anything SAYS so.** These two families
 *     deliver hours after the window they are about, so "nothing has arrived
 *     yet" is the single most common question about them, and a blank where the
 *     last-run stamp goes reads as a bug.
 */
import { describe, expect, it } from 'vitest'
import { buildFamilyRowModel, familyStatusKey } from '../family-row.js'

const TL = 'v2.nc.rules.section.timelapse'

describe('buildFamilyRowModel', () => {
  it('takes editability from the server verdict, never from the owner field', () => {
    expect(buildFamilyRowModel({ kindLabelKey: TL, readOnly: false, deviceCount: 1 }).editable).toBe(true)
    expect(buildFamilyRowModel({ kindLabelKey: TL, readOnly: true, deviceCount: 1 }).editable).toBe(false)
  })

  it('reports the camera count so a rule that lost its cameras is visible', () => {
    expect(buildFamilyRowModel({ kindLabelKey: TL, readOnly: false, deviceCount: 3 }).deviceCount).toBe(3)
  })

  it('is DISABLED-aware — an off rule must not look like a broken one', () => {
    expect(buildFamilyRowModel({ kindLabelKey: TL, readOnly: false, deviceCount: 1, enabled: false }).enabled).toBe(
      false,
    )
    // Absent reads as ON, which is what every rule authored before the field
    // meant and what the schema's own default says.
    expect(buildFamilyRowModel({ kindLabelKey: TL, readOnly: false, deviceCount: 1 }).enabled).toBe(true)
  })
})

describe('familyStatusKey', () => {
  it('says NEVER when the rule has produced nothing', () => {
    expect(familyStatusKey(undefined)).toBe('v2.nc.family.never')
    expect(familyStatusKey(0)).toBe('v2.nc.family.never')
  })

  it('says LAST when it has', () => {
    expect(familyStatusKey(1_700_000_000_000)).toBe('v2.nc.family.last')
  })
})

/**
 * The Rules tab mixes these cards with detection rule cards, so they share the
 * detection card's layout (2026-09-26): the name alone on its line, the kind /
 * ownership / off words under it, and ONE action row with the switch, Edit and
 * Delete, following the same rule about who gets which.
 */
describe('buildFamilyRowModel — the same card as a detection rule', () => {
  const KIND = 'v2.nc.rules.section.timelapse'

  it('a rule the caller can edit gets the switch, Edit and Delete — and no Snooze switch', () => {
    const model = buildFamilyRowModel({ readOnly: false, deviceCount: 1, kindLabelKey: KIND })
    expect(model.actions).toEqual({ edit: true, remove: true, enableSwitch: true, snoozeSwitch: false })
  })

  it('a read-only rule gets none of them', () => {
    const model = buildFamilyRowModel({ readOnly: true, deviceCount: 1, kindLabelKey: KIND })
    expect(model.actions).toEqual({ edit: false, remove: false, enableSwitch: false, snoozeSwitch: false })
  })

  it('the kind, ownership and off words ride the line under the name', () => {
    // Read-only: no switch on the card, so the words say it is off.
    const off = buildFamilyRowModel({ readOnly: true, deviceCount: 1, enabled: false, kindLabelKey: KIND })
    expect(off.header.meta).toEqual([
      { id: 'kind', labelKey: KIND, tone: 'neutral' },
      { id: 'owner', labelKey: 'v2.nc.rules.adminBadge', tone: 'subtle' },
      { id: 'off', labelKey: 'v2.nc.rules.offNotice', tone: 'warning' },
    ])
    // Editable: the switch already says it — never a second time in words.
    const switched = buildFamilyRowModel({ readOnly: false, deviceCount: 1, enabled: false, kindLabelKey: KIND })
    expect(switched.actions.enableSwitch).toBe(true)
    expect(switched.header.meta.map((chip) => chip.id)).toEqual(['kind', 'owner'])
    const on = buildFamilyRowModel({ readOnly: true, deviceCount: 1, kindLabelKey: KIND })
    expect(on.header.meta.map((chip) => chip.labelKey)).toEqual([KIND, 'v2.nc.rules.adminBadge'])
    expect(on.header.nameMaxLines).toBeGreaterThan(1)
  })
})
