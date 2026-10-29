/**
 * Where a track was inferred (D924): one "Detected on" row when both ends
 * agree, "Opened on" / "Closed on" when they differ, nothing when unknown.
 */
import { describe, expect, it } from 'vitest'
import { formatPlacement, nodeLabel, parseTrackPlacement, placementRows } from '../track-placement.js'
import { toTrackSummary } from '../track-events.js'

const HUB_NPU = { nodeId: 'hub', deviceKey: 'openvino:NPU', modelId: 'yolo11n' }
const AGENT_CORAL = { nodeId: 'agent-1', deviceKey: 'coral:usb0', modelId: 'ssd-mobilenet' }

describe('parseTrackPlacement', () => {
  it('reads a full placement and keeps only the members present', () => {
    expect(parseTrackPlacement(HUB_NPU)).toEqual(HUB_NPU)
    expect(parseTrackPlacement({ nodeId: 'hub', deviceKey: '', modelId: 'm' })).toEqual({ nodeId: 'hub', modelId: 'm' })
  })

  it('is unknown without a node id', () => {
    expect(parseTrackPlacement(undefined)).toBeUndefined()
    expect(parseTrackPlacement({ deviceKey: 'cpu' })).toBeUndefined()
    expect(parseTrackPlacement({ nodeId: '' })).toBeUndefined()
    expect(parseTrackPlacement([HUB_NPU])).toBeUndefined()
  })
})

describe('formatPlacement', () => {
  it('reads node · device (model), leaving out what is not named', () => {
    expect(formatPlacement(HUB_NPU)).toBe('hub · openvino:NPU (yolo11n)')
    expect(formatPlacement({ nodeId: 'hub', modelId: 'yolo11n' })).toBe('hub (yolo11n)')
    expect(formatPlacement({ nodeId: 'hub' })).toBe('hub')
  })
})

describe('placementRows', () => {
  it('one Detected-on row when the two ends agree', () => {
    expect(placementRows(HUB_NPU, { ...HUB_NPU })).toEqual([{ kind: 'detectedOn', placement: HUB_NPU }])
  })

  it('Opened on + Closed on when the track hopped', () => {
    expect(placementRows(HUB_NPU, AGENT_CORAL)).toEqual([
      { kind: 'openedOn', placement: HUB_NPU },
      { kind: 'closedOn', placement: AGENT_CORAL },
    ])
    expect(placementRows(HUB_NPU, { nodeId: 'hub', deviceKey: 'openvino:NPU' }).map((r) => r.kind)).toEqual([
      'openedOn',
      'closedOn',
    ])
  })

  it('only the known end when the other is unknown, nothing when neither is', () => {
    expect(placementRows(HUB_NPU, undefined)).toEqual([{ kind: 'openedOn', placement: HUB_NPU }])
    expect(placementRows(undefined, AGENT_CORAL)).toEqual([{ kind: 'closedOn', placement: AGENT_CORAL }])
    expect(placementRows(undefined, undefined)).toEqual([])
  })
})

describe('toTrackSummary carries the placements', () => {
  const row = { trackId: 't1', deviceId: 3, className: 'person', firstSeen: 1, lastSeen: 2 }

  it('spreads each known placement and leaves an unknown one absent', () => {
    const summary = toTrackSummary({ ...row, openedPlacement: HUB_NPU, closedPlacement: { deviceKey: 'x' } }, 'Cam')
    expect(summary?.openedPlacement).toEqual(HUB_NPU)
    expect(summary !== null && 'closedPlacement' in summary).toBe(false)
  })

  it('a row from before the fields has neither', () => {
    const summary = toTrackSummary(row, 'Cam')
    expect(summary !== null && 'openedPlacement' in summary).toBe(false)
  })
})

describe('nodeLabel', () => {
  const names = new Map([['agent-1', 'Mac mini'], ['hub', 'hub'], ['blank', '']])

  it('shows the display name when the hub has one', () => {
    expect(nodeLabel('agent-1', names)).toBe('Mac mini')
    expect(formatPlacement(AGENT_CORAL, names)).toBe('Mac mini · coral:usb0 (ssd-mobilenet)')
  })

  it('keeps the id when the name is the id or empty', () => {
    expect(nodeLabel('hub', names)).toBe('hub')
    expect(nodeLabel('blank', names)).toBe('blank')
  })

  it('keeps the id for a node the directory does not know', () => {
    expect(nodeLabel('agent-9', names)).toBe('agent-9')
  })

  it('keeps the id while the directory is unanswered', () => {
    expect(nodeLabel('agent-1', undefined)).toBe('agent-1')
    expect(formatPlacement(AGENT_CORAL)).toBe('agent-1 · coral:usb0 (ssd-mobilenet)')
  })
})
