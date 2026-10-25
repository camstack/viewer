/**
 * @vitest-environment jsdom
 *
 * The parity fields, authored through the REAL sub-screens (Rule, Advanced,
 * Notification) over the real draft hook and saved through the real save path.
 * Only the wire is faked: `auth.me`, `userManagement.listUsers`, `nc.*`.
 *
 * Every absence below is asserted beside a positive control reached by the same
 * wait — an "absent" on a blank screen proves nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within, type RenderResult } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { resetRuleDrafts } from '../../../testing/rule-draft-harness.js'
import { NcViewerRuleSchema, type NcViewerRule } from '../../../data/notification-center.js'
import { useRuleDraft, type UseRuleDraft } from '../rule-editor/use-rule-draft.js'
import { RuleSection } from '../rule-editor/sections/RuleSection.js'
import { AdvancedSection } from '../rule-editor/sections/AdvancedSection.js'
import { NotificationSection } from '../rule-editor/sections/NotificationSection.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const TARGET_NAME = 'Phone (pushover)'
const USERS_LABEL = 'Notify users'
const ACTIVE_LABEL = 'Active'
const RESET_DEFAULTS = 'Back to hub defaults'
const LINKED_LABEL = 'Linked cameras'
const IMAGE_LABEL = 'Image'
const TRIGGER_ZONE_LABEL = 'Draw the zone that triggered the rule'
const SUBJECT_PATH_LABEL = "Show the subject's path"
/** A rule a ZONE triggers — the only kind of rule that may draw it. */
const ZONED = { classes: ['person'], zones: { ids: ['z-porch'] } }
const CLIP_SPEED_LABEL = 'Playback speed'
const EXEMPT_HINT = /no snooze can silence it/
const MAX_REACHED = /At most 4 snooze buttons/

function makeRule(overrides: Record<string, unknown> = {}): NcViewerRule {
  return NcViewerRuleSchema.parse({
    id: 'rule-1',
    name: 'Front door',
    enabled: true,
    delivery: 'immediate',
    conditions: { classes: ['person'] },
    targets: [{ targetId: 'tgt-a' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
    ...overrides,
  })
}

function actionOf(input: unknown): string {
  if (input === null || typeof input !== 'object' || !('action' in input)) return ''
  const action: unknown = { ...input }['action']
  return typeof action === 'string' ? action : ''
}

/** The rule as a hub that APPLIES `clear` returns it — an older hub would
 *  return it unchanged, and the save now refuses that (final review I4). */
function applyClears(rule: Readonly<Record<string, unknown>>, input: unknown): Readonly<Record<string, unknown>> {
  const clear: unknown =
    input !== null && typeof input === 'object' && 'clear' in input ? input.clear : undefined
  const keys: readonly unknown[] = Array.isArray(clear) ? clear : []
  return Object.fromEntries(Object.entries(rule).filter(([key]) => !keys.includes(key)))
}

function inputOf(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || !('input' in input)) return undefined
  return { ...input }['input']
}

interface HubLog {
  readonly updates: unknown[]
  meAnswered: boolean
  usersAsked: number
}

function hub(log: HubLog, isAdmin: boolean, rule: NcViewerRule) {
  return {
    'auth.me': (): unknown => {
      log.meAnswered = true
      return { id: 'u1', username: 'operator', isAdmin }
    },
    'userManagement.listUsers': (): unknown => {
      log.usersAsked += 1
      return [
        { id: 'u-anna', username: 'anna', isAdmin: false },
        { id: 'u-bruno', username: 'bruno', isAdmin: false },
      ]
    },
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.listRules') return { rules: [rule] }
      if (action === 'nc.listMyTargets') {
        return { targets: [{ id: 'tgt-a', name: TARGET_NAME, kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      }
      if (action === 'nc.getConditionCatalog') return { catalog: [] }
      if (action === 'nc.getRuleAi') return { sections: [] }
      if (action === 'nc.listAiProfiles') return { profiles: [{ id: 'p1', name: 'Local vision', model: 'qwen' }] }
      if (action === 'nc.updateRule') {
        log.updates.push(inputOf(input))
        return { rule: applyClears(rule, inputOf(input)) }
      }
      throw new Error(`NOT_FOUND: ${action}`)
    },
  }
}

let latest: UseRuleDraft | null = null

function Editor({ ruleId }: { readonly ruleId: string }): React.ReactElement | null {
  const editor = useRuleDraft({ id: ruleId })
  useEffect(() => {
    latest = editor
  })
  if (editor.status !== 'ready' || !editor.draft || !editor.kind) return null
  const props = {
    draft: editor.draft,
    patch: editor.patch,
    kind: editor.kind,
    catalog: [],
    rule: editor.rule,
  }
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(RuleSection, props),
    React.createElement(AdvancedSection, props),
    React.createElement(NotificationSection, props),
  )
}

async function open(log: HubLog, isAdmin: boolean, rule: NcViewerRule): Promise<RenderResult> {
  const screen = mountScreen(React.createElement(Editor, { ruleId: rule.id }), { hub: hub(log, isAdmin, rule) })
  await screen.findByText(TARGET_NAME)
  await vi.waitFor(() => expect(log.meAnswered).toBe(true))
  return screen
}

/** The `patch.media` of one `nc.updateRule` input, or undefined when it sent none. */
function mediaOf(update: unknown): unknown {
  if (update === null || typeof update !== 'object' || !('patch' in update)) return undefined
  const patch: unknown = update.patch
  if (patch === null || typeof patch !== 'object' || !('media' in patch)) return undefined
  return patch.media
}

async function press(el: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(el)
  })
}

async function save(): Promise<void> {
  await act(async () => {
    await latest?.save()
  })
}

/** The switch in the row whose label is `label`. */
function switchFor(screen: RenderResult, label: string): HTMLElement {
  let row: HTMLElement | null = screen.getByText(label)
  while (row !== null && within(row).queryAllByRole('switch').length === 0) row = row.parentElement
  if (row === null) throw new Error(`no switch for ${label}`)
  return within(row).getAllByRole('switch')[0]
}

/** The `+` of the stepper row whose label is `label` (the second button). */
function plusFor(screen: RenderResult, label: string): HTMLElement {
  let row: HTMLElement | null = screen.getByText(label)
  while (row !== null && within(row).queryAllByRole('button').length < 2) row = row.parentElement
  if (row === null) throw new Error(`no stepper for ${label}`)
  return within(row).getAllByRole('button')[1]
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
  latest = null
})

describe('an ADMIN authors every parity field and the save carries them', () => {
  it('users, enabled, cooldown, snooze buttons + global, the grouped trigger and the confirm gate', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule())
    await screen.findByText('anna')

    await press(screen.getByText('anna'))
    await press(switchFor(screen, ACTIVE_LABEL))
    await press(plusFor(screen, 'Cooldown (s)'))
    // The grouped trigger (D692): the segment seeds 20 s, one step up is 25.
    await press(screen.getByRole('button', { name: 'Immediate, grouped' }))
    await press(plusFor(screen, 'Group for (seconds)'))
    await press(screen.getByText('2h'))
    await press(switchFor(screen, 'Anyone may snooze for everyone'))
    await press(switchFor(screen, 'Confirm with AI before notifying'))
    await save()

    expect(log.updates).toHaveLength(1)
    expect(log.updates[0]).toMatchObject({
      ruleId: 'rule-1',
      patch: {
        enabled: false,
        targetUsers: ['u-anna'],
        throttle: { cooldownSec: 70 },
        delivery: 'immediate',
        groupingSec: 25,
        snoozeOptions: [10, 30, 60, 120],
        snoozeAllowGlobal: true,
        confirm: { enabled: true, onTimeout: 'fire' },
      },
    })
  })

  it('"Back to hub defaults" clears a stored snooze list', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ snoozeOptions: [5] }))
    await press(screen.getByText(RESET_DEFAULTS))
    expect(screen.queryByText(RESET_DEFAULTS)).toBeNull()
    await save()
    expect(log.updates).toHaveLength(1)
    const update = log.updates[0]
    expect(update).toMatchObject({ clear: expect.arrayContaining(['snoozeOptions']) })
  })
})

describe('the grouped trigger (D692) through the real sub-screens and the real save', () => {
  it('a detection rule mounts the grouped control; the retired Advanced controls are gone', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule())
    // Positive control, same wait: Advanced IS drawn.
    expect(screen.queryByText('Cooldown (s)')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Immediate, grouped' })).not.toBeNull()
    expect(screen.queryByText('Group bursts (s)')).toBeNull()
    expect(screen.queryByText('Wait for recognition')).toBeNull()
  })

  it('an untouched save of a plain rule sends neither groupingSec nor a retired key, and clears nothing grouped', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    await open(log, true, makeRule())
    await save()
    expect(log.updates).toHaveLength(1)
    const update = log.updates[0]
    for (const key of ['groupingSec', 'waitForEnhancement', 'groupIdleSec']) {
      expect(update).not.toMatchObject({ patch: { [key]: expect.anything() } })
    }
    expect(update).not.toMatchObject({ clear: expect.arrayContaining(['groupingSec']) })
  })

  it('moving a stored grouped rule to Track end clears groupingSec on the hub, and sends no window', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ groupingSec: 30 }))
    await press(screen.getByRole('button', { name: 'Track end' }))
    await save()
    expect(log.updates).toHaveLength(1)
    const update = log.updates[0]
    expect(update).toMatchObject({ patch: { delivery: 'track-end' }, clear: expect.arrayContaining(['groupingSec']) })
    expect(update).not.toMatchObject({ patch: { groupingSec: expect.anything() } })
  })

  it('a grouped rule whose stored AI confirm expects two subjects is refused BEFORE the hub, by name', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    await open(log, true, makeRule({ groupingSec: 20, confirm: { enabled: true, expect: { op: '>=', count: 2 } } }))
    // The one save path REFUSES, and `markSaveAttempted` lets the summary say which problem.
    await act(async () => {
      await expect(latest?.save()).rejects.toThrow('rule form is incomplete')
    })
    expect(log.updates).toHaveLength(0)
    expect(latest?.draft?.saveAttempted).toBe(true)
  })

  it('the same confirm on a plain Immediate rule saves', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    await open(log, true, makeRule({ confirm: { enabled: true, expect: { op: '>=', count: 2 } } }))
    await save()
    expect(log.updates).toHaveLength(1)
  })
})

describe('a NON-admin', () => {
  it('sees no "Notify users", never asks for the users, and still saves', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, false, makeRule())
    // Positive control, same wait: the Rule section IS drawn.
    expect(screen.queryByText(ACTIVE_LABEL)).not.toBeNull()
    expect(screen.queryByText(USERS_LABEL)).toBeNull()
    expect(log.usersAsked).toBe(0)

    await press(plusFor(screen, 'Cooldown (s)'))
    await save()
    expect(log.updates).toHaveLength(1)
    const update = log.updates[0]
    expect(update).toMatchObject({ patch: { throttle: { cooldownSec: 70 } } })
    expect(update).not.toMatchObject({ patch: { targetUsers: expect.anything() } })
  })

  it('the admin control is PRESENT for an admin — the same harness, same wait', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule())
    expect(screen.queryByText(USERS_LABEL)).not.toBeNull()
  })
})

describe('media parity controls', () => {
  it('a SENSOR rule offers the linked-cameras mode; a detection rule does not', async () => {
    const sensorLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const sensor = await open(sensorLog, true, makeRule({ delivery: 'device-event', conditions: {} }))
    expect(sensor.queryByText(LINKED_LABEL)).not.toBeNull()
    cleanup()
    resetRuleDrafts()

    const detLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const detection = await open(detLog, true, makeRule())
    expect(detection.queryByText(LINKED_LABEL)).toBeNull()
  })

  it('a SENSOR rule offers the ONE picture choice too (D897) — read as the clean scene it always shipped', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const sensor = await open(log, true, makeRule({ delivery: 'device-event', conditions: {} }))
    expect(sensor.queryByText(IMAGE_LABEL)).not.toBeNull()
    expect(sensor.queryAllByText('Clean scene').length).toBeGreaterThan(0)
    expect(sensor.queryByText('Attach a GIF')).not.toBeNull()
    // The retired triple is gone from the screen.
    expect(sensor.queryByText('Attachment')).toBeNull()
    expect(sensor.queryByText('Picture shows')).toBeNull()
    expect(sensor.queryByText('Crop to the zone')).toBeNull()
    expect(sensor.queryByText(LINKED_LABEL)).not.toBeNull()
  })

  it('a detection rule reads its legacy `best` as the subject crop, with that mode\'s one-line description', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const detection = await open(log, true, makeRule())
    expect(detection.queryAllByText('Subject crop').length).toBeGreaterThan(0)
    expect(detection.queryByText('The subject cut out of the frame at the moment of the event.')).not.toBeNull()
    expect(detection.queryByText('Attach a GIF')).not.toBeNull()
  })

  it('"Draw the zone" is offered only on a rule a ZONE triggers, and only on a scene', async () => {
    const plainLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const plain = await open(plainLog, true, makeRule({ media: { image: 'clean' } }))
    expect(plain.queryAllByText('Clean scene').length).toBeGreaterThan(0)
    expect(plain.queryByText(TRIGGER_ZONE_LABEL)).toBeNull()
    cleanup()
    resetRuleDrafts()

    const cropLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const crop = await open(cropLog, true, makeRule({ conditions: ZONED, media: { image: 'crop' } }))
    expect(crop.queryAllByText('Subject crop').length).toBeGreaterThan(0)
    expect(crop.queryByText(TRIGGER_ZONE_LABEL)).toBeNull()
    cleanup()
    resetRuleDrafts()

    const sceneLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const scene = await open(sceneLog, true, makeRule({ conditions: ZONED, media: { image: 'scene-boxes' } }))
    expect(scene.queryByText(TRIGGER_ZONE_LABEL)).not.toBeNull()
    await press(switchFor(scene, TRIGGER_ZONE_LABEL))
    await save()
    expect(sceneLog.updates[0]).toMatchObject({ patch: { media: { image: 'scene-boxes', showTriggerZone: true } } })
  })

  it('"Show the subject\'s path" is OFF by default, offered on a crop too, saved when on, and gone with no picture (D901)', async () => {
    const noneLog: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const none = await open(noneLog, true, makeRule({ media: { image: 'none' } }))
    expect(none.queryByText(SUBJECT_PATH_LABEL)).toBeNull()
    cleanup()
    resetRuleDrafts()

    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const crop = await open(log, true, makeRule({ media: { image: 'crop' } }))
    const pathSwitch = switchFor(crop, SUBJECT_PATH_LABEL)
    expect(pathSwitch instanceof HTMLInputElement && pathSwitch.checked).toBe(false)
    await press(pathSwitch)
    await save()
    expect(mediaOf(log.updates[0])).toEqual({ image: 'crop', showSubjectPath: true })
  })

  it('a stored subject-path flag opens switched on', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ media: { image: 'clean', showSubjectPath: true } }))
    const pathSwitch = switchFor(screen, SUBJECT_PATH_LABEL)
    expect(pathSwitch instanceof HTMLInputElement && pathSwitch.checked).toBe(true)
  })

  it('a LEGACY zone crop saves as the clean scene with the zone drawn — and never writes the old fields', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(
      log,
      true,
      makeRule({ conditions: ZONED, media: { attach: 'best', frame: 'boxed', zoneCrop: true } }),
    )
    const zoneSwitch = switchFor(screen, TRIGGER_ZONE_LABEL)
    expect(zoneSwitch instanceof HTMLInputElement && zoneSwitch.checked).toBe(true)
    await press(switchFor(screen, 'Attach a GIF'))
    await save()
    expect(log.updates).toHaveLength(1)
    const media = mediaOf(log.updates[0])
    expect(media).toEqual({ image: 'clean', showTriggerZone: true, gif: true })
  })

  it('an untouched SENSOR save writes the clean scene and leaves media.linkedCameras absent (the hub’s mosaic)', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ delivery: 'device-event', conditions: {} }))
    expect(screen.queryByText(LINKED_LABEL)).not.toBeNull()
    await save()
    expect(log.updates).toHaveLength(1)
    expect(mediaOf(log.updates[0])).toEqual({ image: 'clean' })
  })

  it('the speed chips appear for a GIF too — the hub speeds up both', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule())
    expect(screen.queryByText(CLIP_SPEED_LABEL)).toBeNull()
    await press(switchFor(screen, 'Attach a GIF'))
    expect(screen.queryByText(CLIP_SPEED_LABEL)).not.toBeNull()
  })

  it('clip speed chips appear only once the clip is on, and a pick is saved', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule())
    expect(screen.queryByText(CLIP_SPEED_LABEL)).toBeNull()
    await press(switchFor(screen, 'Attach a video clip'))
    expect(screen.queryByText(CLIP_SPEED_LABEL)).not.toBeNull()
    await press(screen.getByText('4×'))
    await save()
    expect(log.updates[0]).toMatchObject({ patch: { media: { clip: true, clipSpeed: 4 } } })
  })
})

describe('snooze controls', () => {
  const ALARM = { delivery: 'system-event', conditions: { systemEvent: { kinds: ['alarm-armed'] } }, media: { attach: 'none' } }
  const OFFLINE = { delivery: 'system-event', conditions: { systemEvent: { kinds: ['device-offline'] } }, media: { attach: 'none' } }

  it('an ALARM rule shows them DISABLED, with the reason', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ ...ALARM, snoozeOptions: [10] }))
    expect(screen.queryByText(EXEMPT_HINT)).not.toBeNull()
    expect(screen.getByText('10 min').closest('[role="checkbox"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(RESET_DEFAULTS).closest('[role="button"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(switchFor(screen, 'Anyone may snooze for everyone').hasAttribute('disabled')).toBe(true)
  })

  it('a non-alarm system rule keeps them live — the same harness, same wait', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ ...OFFLINE, snoozeOptions: [10] }))
    expect(screen.queryByText(EXEMPT_HINT)).toBeNull()
    expect(screen.getByText('10 min').closest('[role="checkbox"]')?.getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getByText(RESET_DEFAULTS).closest('[role="button"]')?.getAttribute('aria-disabled')).not.toBe('true')
    expect(switchFor(screen, 'Anyone may snooze for everyone').hasAttribute('disabled')).toBe(false)
  })

  it('a refused fifth chip SAYS so, and the list is unchanged', async () => {
    const log: HubLog = { updates: [], meAnswered: false, usersAsked: 0 }
    const screen = await open(log, true, makeRule({ snoozeOptions: [5, 10, 30, 60] }))
    expect(screen.queryByText(MAX_REACHED)).toBeNull()
    await press(screen.getByText('2h'))
    expect(screen.queryByText(MAX_REACHED)).not.toBeNull()
    expect(latest?.draft?.form.snoozeOptions).toEqual([5, 10, 30, 60])
  })
})
