/**
 * The embed reads the detection class selection exactly as the app does
 * (planning#751): empty OR every listed class = any label, even one outside
 * the list.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_DETECTION_CLASSES, matchesDetectionClass } from '../../../../shared/highlight-classes'

describe('embed detection class match', () => {
  it.each(['use-tile-highlight.ts', 'use-active-devices.ts'])('%s uses the shared matcher', (file) => {
    const src = readFileSync(join(__dirname, '..', file), 'utf8')
    expect(src).toContain('matchesDetectionClass(detectionClasses, d.macroClass)')
    expect(src).not.toMatch(/detectionClasses\.length === 0/)
  })

  it('an all-ticked selection matches a label outside the list', () => {
    expect(matchesDetectionClass([...HIGHLIGHT_DETECTION_CLASSES], 'boat')).toBe(true)
    expect(matchesDetectionClass([], 'boat')).toBe(true)
    expect(matchesDetectionClass(['person'], 'boat')).toBe(false)
  })
})
