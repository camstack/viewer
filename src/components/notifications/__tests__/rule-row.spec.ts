import { describe, it, expect } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import type { NcConditions, NcMediaPolicy, NcSnooze, NcViewerRule, Target } from '../../../data/notification-center.js'
import {
  buildRuleRowModel,
  isSystemEventRule,
  partitionRules,
  activeRuleSnoozeIds,
  ruleSnoozeSwitchFor,
  sortRulesByName,
  ruleMediaBadges,
} from '../rule-row.js'

/** A persisted target owned by the caller. */
function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: 'tgt-mine',
    name: 'My phone',
    kind: 'push',
    addonId: 'notifiers',
    enabled: true,
    config: {},
    ...overrides,
  }
}

/** A viewer rule fixture. `readOnly` + `targets` + `disabledTargetIds` drive the
 *  model; the rest are neutral valid defaults. */
function makeRule(overrides: Partial<NcViewerRule> = {}): NcViewerRule {
  return {
    id: 'rule-1',
    name: 'Front door people',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 'tgt-mine' }],
    media: { attach: 'best' },
    throttle: { cooldownSec: 60, scope: 'rule-device' },
    priority: 3,
    createdBy: 'admin',
    createdAt: 0,
    updatedAt: 0,
    disabledTargetIds: [],
    readOnly: true,
    ...overrides,
  }
}

describe('buildRuleRowModel — admin (read-only) rule', () => {
  it('exposes a per-target opt-out toggle for a caller-owned target', () => {
    const model = buildRuleRowModel(makeRule(), [makeTarget()])
    expect(model.editable).toBe(false)
    expect(model.optOutTargets).toEqual([
      { targetId: 'tgt-mine', targetName: 'My phone', receiving: true },
    ])
  })

  it('renders the toggle OFF when the target is in disabledTargetIds (toggling opts back in)', () => {
    const model = buildRuleRowModel(
      makeRule({ disabledTargetIds: ['tgt-mine'] }),
      [makeTarget()],
    )
    const toggle = model.optOutTargets[0]
    // OFF: caller currently does NOT receive this rule on this target.
    expect(toggle?.receiving).toBe(false)
    // The row wires onValueChange straight through, so flipping an OFF toggle
    // calls setRuleTargetEnabled(ruleId, targetId, true).
    expect(!toggle!.receiving).toBe(true)
  })

  it('shows no toggle for a target the caller does not own', () => {
    const model = buildRuleRowModel(
      makeRule({ targets: [{ targetId: 'tgt-someone-else' }] }),
      [makeTarget()],
    )
    expect(model.optOutTargets).toEqual([])
  })

  it('shows no toggles when the admin rule touches none of the caller targets', () => {
    const model = buildRuleRowModel(makeRule({ targets: [] }), [makeTarget()])
    expect(model.optOutTargets).toEqual([])
  })

  it('resolves each owned target name and receiving flag independently', () => {
    const model = buildRuleRowModel(
      makeRule({
        targets: [{ targetId: 'tgt-mine' }, { targetId: 'tgt-b' }, { targetId: 'tgt-x' }],
        disabledTargetIds: ['tgt-b'],
      }),
      [makeTarget(), makeTarget({ id: 'tgt-b', name: 'Email' })],
    )
    expect(model.optOutTargets).toEqual([
      { targetId: 'tgt-mine', targetName: 'My phone', receiving: true },
      { targetId: 'tgt-b', targetName: 'Email', receiving: false },
    ])
  })
})

describe('buildRuleRowModel — personal (editable) rule', () => {
  it('is editable and carries NO opt-out toggles', () => {
    const model = buildRuleRowModel(
      makeRule({ readOnly: false, createdBy: 'me', ownerUserId: 'me' }),
      [makeTarget()],
    )
    expect(model.editable).toBe(true)
    expect(model.optOutTargets).toEqual([])
  })
})

describe('ruleMediaBadges', () => {
  const detection = (media: NcMediaPolicy, conditions: NcConditions = {}) => ({
    delivery: 'immediate' as const,
    conditions,
    media,
  })

  it('says nothing for the default policy — an ordinary rule stays quiet', () => {
    expect(ruleMediaBadges(detection({}))).toEqual([])
    // `crop` IS a detection rule's own default, so it is not a choice worth announcing.
    expect(ruleMediaBadges(detection({ image: 'crop' }))).toEqual([])
    expect(ruleMediaBadges(detection({ image: 'crop', gif: false, clip: false }))).toEqual([])
    // A legacy `best` is the same subject crop (D897).
    expect(ruleMediaBadges(detection({ attach: 'best' }))).toEqual([])
    // A sensor's default is the clean scene.
    expect(ruleMediaBadges({ delivery: 'device-event', conditions: {}, media: { image: 'clean' } })).toEqual([])
  })

  it('announces the picture and the footage a rule ships, which is the whole reason it exists', () => {
    const ids = ruleMediaBadges(
      detection(
        { image: 'clean', showTriggerZone: true, gif: true, clip: true, profile: 'low' },
        { zones: { ids: ['z1'] } },
      ),
    ).map((badge) => badge.id)
    expect(ids).toEqual(['image:clean', 'triggerZone', 'gif', 'clip', 'profile:low'])
  })

  it('announces the subject path a rule draws (D901)', () => {
    expect(ruleMediaBadges(detection({ image: 'crop', showSubjectPath: true })).map((b) => b.id)).toEqual(['subjectPath'])
    expect(ruleMediaBadges(detection({ image: 'none', showSubjectPath: true })).map((b) => b.id)).toEqual(['image:none'])
  })

  it('reads a legacy triple the way the hub does — a boxed frame is the boxed scene', () => {
    expect(ruleMediaBadges(detection({ attach: 'best', frame: 'boxed' })).map((b) => b.id)).toEqual(['image:scene-boxes'])
    // A legacy zone crop on a zone rule: the clean scene with the trigger zone drawn.
    expect(
      ruleMediaBadges(detection({ attach: 'best', zoneCrop: true }, { zones: { ids: ['z1'] } })).map((b) => b.id),
    ).toEqual(['image:clean', 'triggerZone'])
  })

  it('a kind with no picture says nothing about one', () => {
    expect(
      ruleMediaBadges({ delivery: 'system-event', conditions: { systemEvent: { kinds: ['node-offline'] } }, media: { image: 'none' } }),
    ).toEqual([])
  })

  it('carries the profile as an interpolation param, not baked into the key', () => {
    const [badge] = ruleMediaBadges(detection({ clip: true, profile: 'mid' })).filter((b) => b.id.startsWith('profile:'))
    expect(badge?.labelKey).toBe('v2.nc.rules.mediaBadge.profile')
    expect(badge?.params).toEqual({ profile: 'mid' })
  })

  it('drops a profile with no gif or clip to cut — there is no footage to grade', () => {
    expect(ruleMediaBadges(detection({ profile: 'high' }))).toEqual([])
  })

  it('every badge key exists in both locales', () => {
    const all = [
      ...ruleMediaBadges(
        detection(
          { image: 'scene-boxes', showTriggerZone: true, showSubjectPath: true, gif: true, clip: true },
          { zones: { ids: ['z1'] } },
        ),
      ),
      ...(['scene-boxes', 'clean', 'none'] as const).flatMap((mode) => ruleMediaBadges(detection({ image: mode }))),
      // A sensor's default is `clean`, so its crop is the one non-default left.
      ...ruleMediaBadges({ delivery: 'device-event', conditions: {}, media: { image: 'crop' } }),
    ]
    for (const badge of all) {
      for (const locale of [enLocale, itLocale]) {
        const value = badge.labelKey.split('.').reduce<unknown>(
          (node, key) => (node !== null && typeof node === 'object' ? Object.entries(node).find(([k]) => k === key)?.[1] : undefined),
          locale,
        )
        expect(typeof value, badge.labelKey).toBe('string')
      }
    }
  })

  it('rides on the row model for both a personal and an admin rule', () => {
    const media = { clip: true } as const
    expect(buildRuleRowModel(makeRule({ media }), [makeTarget()]).mediaBadges).toHaveLength(1)
    expect(
      buildRuleRowModel(makeRule({ media, readOnly: false }), [makeTarget()]).mediaBadges,
    ).toHaveLength(1)
  })
})

describe('partitionRules — the Rules tab sections', () => {
  it('lifts system-event rules OUT of the detection sections', () => {
    // The failure it prevents: a system rule sitting among detection rules is
    // indistinguishable from one until you open it, so "why was I told this?"
    // cannot be answered from the list.
    const mine = makeRule({ id: 'mine', readOnly: false })
    const admin = makeRule({ id: 'admin', readOnly: true })
    const systemAdmin = makeRule({ id: 'sys-admin', readOnly: true, delivery: 'system-event' })
    const systemMine = makeRule({ id: 'sys-mine', readOnly: false, delivery: 'system-event' })

    const sections = partitionRules([mine, admin, systemAdmin, systemMine])
    expect(sections.personal.map((r) => r.id)).toEqual(['mine'])
    expect(sections.admin.map((r) => r.id)).toEqual(['admin'])
    // Ownership is not the axis for system rules — the ROW still decides what
    // controls each one offers.
    expect(sections.system.map((r) => r.id)).toEqual(['sys-admin', 'sys-mine'])
  })

  it('loses no rule — every input lands in exactly one section', () => {
    const rules = [
      makeRule({ id: 'a', readOnly: false }),
      makeRule({ id: 'b', readOnly: true }),
      makeRule({ id: 'c', delivery: 'system-event' }),
      makeRule({ id: 'd', delivery: 'track-end', readOnly: false }),
    ]
    const sections = partitionRules(rules)
    const placed = [...sections.personal, ...sections.admin, ...sections.system].map((r) => r.id)
    expect(placed.toSorted()).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('answers the same question the admin UI asks', () => {
    expect(isSystemEventRule({ delivery: 'system-event' })).toBe(true)
    expect(isSystemEventRule({ delivery: 'immediate' })).toBe(false)
    expect(isSystemEventRule({ delivery: 'device-event' })).toBe(false)
  })
})

describe('buildRuleRowModel — the row names its kind', () => {
  it('a row says what kind of rule it is and whether it is on', () => {
    const model = buildRuleRowModel(makeRule({ enabled: false, delivery: 'device-event' }), [])
    expect(model.kindLabelKey).toBe('v2.nc.rules.kind.sensor')
    expect(model.enabled).toBe(false)
  })

  it('an editable detection rule that is on says so too', () => {
    const model = buildRuleRowModel(makeRule({ readOnly: false }), [])
    expect(model.kindLabelKey).toBe('v2.nc.rules.kind.detection')
    expect(model.enabled).toBe(true)
  })
})

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

describe('buildRuleRowModel — a rule to recreate (D637)', () => {
  const mixed = { delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['device-offline' as const, 'alarm-armed' as const] } } }

  it('a mixed rule must be recreated; its row says so and keeps Delete for its owner', () => {
    const model = buildRuleRowModel(makeRule({ ...mixed, readOnly: false }), [makeTarget()])
    expect(model.mustRecreate).toBe(true)
    // Ownership, not the kind, decides Edit/Delete: the owner can still delete it.
    expect(model.editable).toBe(true)
    expect(model.kindLabelKey).toBe('v2.nc.rules.kind.mixed')
  })

  it('an admin-owned mixed rule is still one to recreate, for a caller who cannot edit it', () => {
    const model = buildRuleRowModel(makeRule({ ...mixed, readOnly: true }), [makeTarget()])
    expect(model.mustRecreate).toBe(true)
    expect(model.editable).toBe(false)
  })

  it('a one-family rule is not', () => {
    const model = buildRuleRowModel(
      makeRule({ delivery: 'system-event', conditions: { systemEvent: { kinds: ['device-battery-low'] } }, readOnly: false }),
      [makeTarget()],
    )
    expect(model.mustRecreate).toBe(false)
    expect(model.kindLabelKey).toBe('v2.nc.rules.kind.device-events')
    expect(buildRuleRowModel(makeRule(), [makeTarget()]).mustRecreate).toBe(false)
  })

  it('the owner is told HOW to recreate it; a caller who cannot edit it is told an admin must', () => {
    const own = buildRuleRowModel(makeRule({ ...mixed, readOnly: false }), [makeTarget()])
    expect(own.recreateNoticeKey).toBe('v2.nc.rules.mustRecreate')
    const theirs = buildRuleRowModel(makeRule({ ...mixed, readOnly: true }), [makeTarget()])
    expect(theirs.recreateNoticeKey).toBe('v2.nc.rules.mustRecreateByAdmin')
    // No notice at all on a rule that needs no recreating.
    expect(buildRuleRowModel(makeRule(), [makeTarget()]).recreateNoticeKey).toBeUndefined()
    expect(buildRuleRowModel(makeRule({ readOnly: false }), [makeTarget()]).recreateNoticeKey).toBeUndefined()
  })

  it('both notices exist in en and it, and the read-only one gives no instruction', () => {
    for (const key of ['v2.nc.rules.mustRecreate', 'v2.nc.rules.mustRecreateByAdmin']) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
    expect(lookupLocale(enLocale, 'v2.nc.rules.mustRecreateByAdmin')).not.toMatch(/delete this one/)
    expect(lookupLocale(enLocale, 'v2.nc.rules.mustRecreateByAdmin')).toMatch(/an admin must recreate it/)
  })
})

/**
 * The operator, 2026-09-26: "Quando una rule è disattivata non si vede il nome.
 * Tieni modifica elimina ed abilitata sulla stessa riga". The name used to share
 * its line with the kind chip, the off notice, the ownership word and the
 * chevron — and the notice won, so an off rule read "Alla…".
 */
describe('buildRuleRowModel — the header gives the NAME its own line', () => {
  it('an off rule with NO switch on its card says so UNDER the name, never beside it', () => {
    const model = buildRuleRowModel(makeRule({ enabled: false, readOnly: true }), [])
    expect(model.actions.enableSwitch).toBe(false)
    expect(model.header.meta.map((chip) => chip.id)).toEqual(['kind', 'owner', 'off'])
    const off = model.header.meta.find((chip) => chip.id === 'off')
    expect(off?.labelKey).toBe('v2.nc.rules.offNotice')
    expect(off?.tone).toBe('warning')
  })

  // Operator, 2026-09-26: "we show the disabled-rule text twice, and there is
  // no need: the switch is already there". A card that draws the switch says
  // the state ONCE, with the switch — the words would be the second time.
  it('an off rule whose card draws the switch carries no second off notice', () => {
    const model = buildRuleRowModel(makeRule({ enabled: false, readOnly: false }), [])
    expect(model.actions.enableSwitch).toBe(true)
    expect(model.header.meta.map((chip) => chip.id)).toEqual(['kind', 'owner'])
  })

  it('an on rule carries no off notice at all', () => {
    const model = buildRuleRowModel(makeRule({ readOnly: false }), [])
    expect(model.header.meta.map((chip) => chip.id)).toEqual(['kind', 'owner'])
  })

  it('the kind and ownership words ride the meta line, not the name line', () => {
    const personal = buildRuleRowModel(makeRule({ readOnly: false, delivery: 'device-event' }), [])
    expect(personal.header.meta[0]).toEqual({ id: 'kind', labelKey: 'v2.nc.rules.kind.sensor', tone: 'neutral' })
    expect(personal.header.meta[1]).toEqual({ id: 'owner', labelKey: 'v2.nc.rules.personalBadge', tone: 'subtle' })
    const admin = buildRuleRowModel(makeRule({ readOnly: true }), [])
    expect(admin.header.meta[1]?.labelKey).toBe('v2.nc.rules.adminBadge')
  })

  it('a long name wraps rather than truncating', () => {
    expect(buildRuleRowModel(makeRule(), []).header.nameMaxLines).toBeGreaterThan(1)
  })

  it('the off notice exists in en and it', () => {
    expect(lookupLocale(enLocale, 'v2.nc.rules.offNotice')).toBeTypeOf('string')
    expect(lookupLocale(itLocale, 'v2.nc.rules.offNotice')).toBeTypeOf('string')
  })
})

describe('buildRuleRowModel — the ONE action row', () => {
  const mixed = {
    delivery: 'system-event' as const,
    conditions: { systemEvent: { kinds: ['device-offline' as const, 'alarm-armed' as const] } },
  }

  it('a rule the caller can edit gets Edit, Delete and the enable switch', () => {
    const model = buildRuleRowModel(makeRule({ readOnly: false }), [makeTarget()])
    expect(model.actions).toEqual({ edit: true, remove: true, enableSwitch: true, snoozeSwitch: true })
  })

  it('an admin rule seen by a non-admin gets none of the owner\'s controls — only its snooze and opt-outs', () => {
    const model = buildRuleRowModel(makeRule({ readOnly: true }), [makeTarget()])
    expect(model.actions).toEqual({ edit: false, remove: false, enableSwitch: false, snoozeSwitch: true })
    expect(model.optOutTargets).toHaveLength(1)
  })

  it('a mixed rule its owner can edit: no Edit, but it can still be switched off and deleted', () => {
    const model = buildRuleRowModel(makeRule({ ...mixed, readOnly: false }), [makeTarget()])
    // It carries an alarm kind: no snooze can silence it.
    expect(model.actions).toEqual({ edit: false, remove: true, enableSwitch: true, snoozeSwitch: false })
    expect(model.recreateNoticeKey).toBe('v2.nc.rules.mustRecreate')
  })

  it('a mixed rule the caller cannot edit offers nothing', () => {
    const model = buildRuleRowModel(makeRule({ ...mixed, readOnly: true }), [makeTarget()])
    expect(model.actions).toEqual({ edit: false, remove: false, enableSwitch: false, snoozeSwitch: false })
  })

  it('the switch label exists in en and it', () => {
    expect(lookupLocale(enLocale, 'v2.nc.rules.enabledSwitch')).toBeTypeOf('string')
    expect(lookupLocale(itLocale, 'v2.nc.rules.enabledSwitch')).toBe('Abilitata')
  })
})

/**
 * Operator, 2026-10-01: the list is sorted by NAME, and a Snooze SWITCH
 * replaces the words "Snooze disabled (alarm rule)" — drawn off and disabled
 * where no snooze can silence the rule, never explained in prose.
 */
describe('sortRulesByName', () => {
  it('orders by name, case- and accent-blind, and never sorts in place', () => {
    const rules = [
      { id: '3', name: 'zeta' },
      { id: '1', name: 'Allarme' },
      { id: '2', name: 'éntrata' },
      { id: '4', name: 'Buca' },
    ]
    const sorted = sortRulesByName(rules)
    expect(sorted.map((rule) => rule.name)).toEqual(['Allarme', 'Buca', 'éntrata', 'zeta'])
    expect(rules.map((rule) => rule.id)).toEqual(['3', '1', '2', '4'])
  })

  it('breaks a name tie on the id, so two rules of one name never swap on a refresh', () => {
    const sorted = sortRulesByName([
      { id: 'b', name: 'Porta' },
      { id: 'a', name: 'porta' },
    ])
    expect(sorted.map((rule) => rule.id)).toEqual(['a', 'b'])
  })
})

/**
 * Controller ruling (R3, 2026-10-01): the list switch SNOOZES THIS RULE — a
 * live rule-scoped window, 30 minutes, exactly like the admin column. It is
 * not the notification's snooze-button config (that stays in the editor).
 */
describe('the list Snooze switch reads live rule-scoped windows', () => {
  const NOW = 1_000_000
  const window = (over: Partial<NcSnooze>): NcSnooze => ({
    id: 's1',
    userId: 'u1',
    scope: 'rule',
    ruleId: 'rule-1',
    startedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    global: false,
    summary: true,
    ...over,
  })

  it('only a live window of THIS rule counts — expiry is exclusive', () => {
    const snoozes = [
      window({ id: 'live' }),
      window({ id: 'other-rule', ruleId: 'rule-2' }),
      window({ id: 'device', scope: 'device', ruleId: undefined, deviceId: 7 }),
      window({ id: 'over', expiresAt: NOW }),
      window({ id: 'future', startedAt: NOW + 1 }),
    ]
    expect(activeRuleSnoozeIds(snoozes, 'rule-1', NOW)).toEqual(['live'])
  })

  it('on while a window is live, off otherwise; unknown while the list has not answered', () => {
    const rule = makeRule()
    expect(ruleSnoozeSwitchFor(rule, [window({})], NOW)).toEqual({ state: 'on', activeIds: ['s1'] })
    expect(ruleSnoozeSwitchFor(rule, [], NOW)).toEqual({ state: 'off', activeIds: [] })
    expect(ruleSnoozeSwitchFor(rule, undefined, NOW)).toEqual({ state: 'unknown', activeIds: [] })
  })

  it('a rule no snooze can silence (alarm, or one that arms the panel) gets NO switch', () => {
    const alarm = makeRule({
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: ['alarm-triggered'] } },
    })
    expect(buildRuleRowModel(alarm, []).actions.snoozeSwitch).toBe(false)
    const arms = makeRule({
      actions: { onTrigger: [{ kind: 'do', action: { kind: 'cap', deviceId: 9, cap: 'alarm-panel', method: 'arm' } }] },
    })
    expect(buildRuleRowModel(arms, []).actions.snoozeSwitch).toBe(false)
  })

  it('a BUTTON whose shared sequence arms the panel counts — resolved through the shared list', () => {
    const viaButton = makeRule({ actions: { buttons: [{ id: 'b', label: 'Arm', sequenceId: 'seq-arm' }] } })
    const sequences = [
      { id: 'seq-arm', name: 'arm', actions: [{ kind: 'cap' as const, deviceId: 9, cap: 'alarm-panel', method: 'arm' }] },
    ]
    expect(buildRuleRowModel(viaButton, [], sequences).actions.snoozeSwitch).toBe(false)
    // Without the list (a non-admin), the binding proves nothing.
    expect(buildRuleRowModel(viaButton, []).actions.snoozeSwitch).toBe(true)
  })

  it('a snooze is personal: every other rule gets the switch, read-only ones included', () => {
    expect(buildRuleRowModel(makeRule({ readOnly: false }), []).actions.snoozeSwitch).toBe(true)
    expect(buildRuleRowModel(makeRule({ readOnly: true }), []).actions.snoozeSwitch).toBe(true)
  })

  it('its words exist in en and it', () => {
    for (const key of ['v2.nc.rules.snoozeSwitch', 'v2.nc.rules.snoozeFailed']) {
      expect(lookupLocale(enLocale, key)).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key)).toBeTypeOf('string')
    }
  })
})
