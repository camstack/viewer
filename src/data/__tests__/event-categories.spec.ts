/**
 * Pin every live-event bus category the viewer subscribes to against the
 * hub's REAL `EventCategory` enum from `@camstack/types`.
 *
 * Why tests instead of importing the enum at runtime: srcV2 deliberately
 * keeps `@camstack/types` OUT of the app bundle (the package's only entry is
 * its full root export — cap schemas, zod — far too heavy for Metro). The
 * hooks use local string constants, and THIS suite is what makes a category
 * rename in the hub break the viewer build instead of silently drifting.
 *
 * That drift is not hypothetical: `use-motion` shipped with the camelCase
 * cap-method name (`'motion.onMotionChanged'`) instead of the kebab-case bus
 * value — the live motion event never fired and the grid highlight "never
 * started" (fixed in d9b0449). Had this suite existed, it would have caught
 * the value at review time and any future rename at CI time.
 */
import { describe, expect, it } from 'vitest'
import { EventCategory } from '@camstack/types/enums'
import { MOTION_CATEGORY } from '../use-motion.js'
import { DETECTION_CATEGORY, FRAME_TRACKED_CATEGORY } from '../use-detections.js'
import { AUDIO_CATEGORY } from '../use-audio.js'

describe('viewer live-event categories match the hub EventCategory enum', () => {
  it('motion', () => {
    expect(MOTION_CATEGORY).toBe(EventCategory.MotionOnMotionChanged)
  })

  it('detection boxes', () => {
    expect(DETECTION_CATEGORY).toBe(EventCategory.DetectionResult)
  })

  it('enriched tracked frames', () => {
    expect(FRAME_TRACKED_CATEGORY).toBe(EventCategory.PipelineAnalyticsFrameTracked)
  })

  it('audio inference', () => {
    expect(AUDIO_CATEGORY).toBe(EventCategory.PipelineAudioInferenceResult)
  })
})
