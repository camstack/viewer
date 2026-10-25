import { describe, it, expect } from 'vitest'

import { resolveRecordMenu, trainingCollectVisible, type RecordMenuInput } from '../record-menu.js'
import type { PlaybackMode } from '../playback-machine.js'

const RECORDED: readonly PlaybackMode[] = ['seeking', 'playback', 'gap', 'error']

function input(over: Partial<RecordMenuInput>): RecordMenuInput {
  return {
    mode: 'playback',
    isAdmin: false,
    canSnapshot: true,
    canSelect: true,
    canRecordLive: true,
    ...over,
  }
}

describe('the REC menu in PLAYBACK', () => {
  for (const mode of RECORDED) {
    it(`${mode}: a viewer gets Select export and the snapshot, never Delete`, () => {
      expect(resolveRecordMenu(input({ mode, isAdmin: false }))).toEqual(['selectExport', 'snapshot'])
    })
    it(`${mode}: an admin also gets Delete recording`, () => {
      expect(resolveRecordMenu(input({ mode, isAdmin: true }))).toEqual([
        'selectExport',
        'snapshot',
        'deleteRecording',
      ])
    })
  }

  it('the live clip recorder is never on offer off the live edge', () => {
    expect(resolveRecordMenu(input({ isAdmin: true }))).not.toContain('recordLive')
  })

  it('without a selection to arm (a clip holds the frame) there is no export and no delete', () => {
    expect(resolveRecordMenu(input({ isAdmin: true, canSelect: false }))).toEqual(['snapshot'])
  })
})

describe('the REC menu at the LIVE edge', () => {
  it('leads with the snapshot — for an admin too, and never with Delete or Select', () => {
    for (const isAdmin of [false, true]) {
      const menu = resolveRecordMenu(input({ mode: 'live', isAdmin }))
      expect(menu[0]).toBe('snapshot')
      expect(menu).not.toContain('deleteRecording')
      expect(menu).not.toContain('selectExport')
    }
  })

  it('keeps the live clip recording the button has always started', () => {
    expect(resolveRecordMenu(input({ mode: 'live' }))).toEqual(['snapshot', 'recordLive'])
  })

  it('the snapshot alone is enough to show the button', () => {
    expect(resolveRecordMenu(input({ mode: 'live', canRecordLive: false }))).toEqual(['snapshot'])
  })
})

describe('an empty menu means no button', () => {
  it('nothing available → no entries', () => {
    expect(
      resolveRecordMenu(input({ mode: 'live', canSnapshot: false, canRecordLive: false })),
    ).toEqual([])
    expect(resolveRecordMenu(input({ canSnapshot: false, canSelect: false }))).toEqual([])
  })
})

describe('the training collect', () => {
  it('shows on a paused recorded frame', () => {
    expect(trainingCollectVisible({ isLive: false, paused: true, selectionArmed: false })).toBe(true)
  })

  it('is hidden while a selection is armed — export or delete', () => {
    expect(trainingCollectVisible({ isLive: false, paused: true, selectionArmed: true })).toBe(false)
  })

  it('is hidden live and while playing, as before', () => {
    expect(trainingCollectVisible({ isLive: true, paused: true, selectionArmed: false })).toBe(false)
    expect(trainingCollectVisible({ isLive: false, paused: false, selectionArmed: false })).toBe(false)
  })
})
